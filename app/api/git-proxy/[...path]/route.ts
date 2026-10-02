import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// isomorphic-git's `corsProxy` option points browser-side git operations at
// this route instead of the public https://cors.isomorphic-git.org demo
// proxy. That proxy is a free, shared, rate-limited community service — for
// anything but a tiny repo it's slow or stalls outright, which is why clones
// of larger repos looked "stuck." Self-hosting removes that shared
// bottleneck.
//
// This route forwards a request to a hostname taken from the URL path
// (e.g. /api/git-proxy/github.com/owner/repo.git/info/refs), so without
// restrictions it would be an open SSRF-capable proxy reachable by anyone who
// can reach this app. Three layers keep that from happening:
//   1. Only signed-in users can call it at all.
//   2. Only a fixed allowlist of real git hosting domains can be targeted.
//   3. Only requests that look exactly like the git smart-HTTP protocol
//      (info/refs negotiation or an upload-pack/receive-pack POST) are
//      forwarded — nothing else, regardless of host.

export const runtime = "nodejs";

const ALLOWED_HOSTS = new Set(["github.com", "gitlab.com", "bitbucket.org"]);

const FORWARD_REQUEST_HEADERS = [
  "accept",
  "accept-encoding",
  "accept-language",
  "content-type",
  "git-protocol",
];

const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "expires",
  "pragma",
  "etag",
  "last-modified",
  "x-github-request-id",
];

function isAllowedGitRequest(
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  contentType: string | null,
): boolean {
  const isInfoRefs =
    pathname.endsWith("/info/refs") &&
    (searchParams.get("service") === "git-upload-pack" ||
      searchParams.get("service") === "git-receive-pack");

  if (method === "GET") return isInfoRefs;

  if (method === "POST") {
    return (
      (contentType === "application/x-git-upload-pack-request" &&
        pathname.endsWith("/git-upload-pack")) ||
      (contentType === "application/x-git-receive-pack-request" &&
        pathname.endsWith("/git-receive-pack"))
    );
  }

  return false;
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": FORWARD_RESPONSE_HEADERS.join(","),
  };
}

async function handleProxy(request: Request, path: string[]): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const [host, ...rest] = path;

  if (!host || !ALLOWED_HOSTS.has(host) || rest.length === 0) {
    return NextResponse.json({ error: "This host is not allowed." }, { status: 403 });
  }

  const incomingUrl = new URL(request.url);
  const targetPathname = `/${rest.join("/")}`;
  const contentType = request.headers.get("content-type");

  if (
    !isAllowedGitRequest(request.method, targetPathname, incomingUrl.searchParams, contentType)
  ) {
    return NextResponse.json({ error: "Unsupported git operation." }, { status: 403 });
  }

  const headers: Record<string, string> = { "user-agent": "git/@mightguy-git-proxy" };
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }

  const targetUrl = `https://${host}${targetPathname}${incomingUrl.search}`;

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method === "POST" ? request.body : undefined,
      redirect: "manual",
      // Required by Node's fetch when streaming a request body.
      // @ts-expect-error -- `duplex` isn't in the lib.dom.d.ts RequestInit type yet.
      duplex: request.method === "POST" ? "half" : undefined,
    });
  } catch (error) {
    console.error("git-proxy upstream fetch failed:", error);
    return NextResponse.json({ error: "Upstream request failed." }, { status: 502 });
  }

  // A redirect (e.g. a renamed repo) must only be followed toward another
  // allowed host — otherwise a crafted redirect could smuggle a request
  // anywhere.
  if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.has("location")) {
    let redirectHost: string;
    try {
      redirectHost = new URL(upstream.headers.get("location")!).host;
    } catch {
      return NextResponse.json({ error: "Invalid redirect from upstream." }, { status: 502 });
    }

    if (!ALLOWED_HOSTS.has(redirectHost)) {
      return NextResponse.json({ error: "Blocked redirect to a disallowed host." }, { status: 502 });
    }
  }

  const responseHeaders = new Headers(corsHeaders());
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (upstream.headers.has("location")) {
    responseHeaders.set("location", upstream.headers.get("location")!);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return handleProxy(request, (await params).path);
}

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return handleProxy(request, (await params).path);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(),
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": FORWARD_REQUEST_HEADERS.join(","),
      "Access-Control-Max-Age": "86400",
    },
  });
}

import crypto from "crypto";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { GITHUB_STATE_COOKIE } from "@/lib/github";

// Step ① of connecting GitHub: send the user to install the app, tagged with a
// random `state` that's also stored in a cookie. GitHub passes `state` back to
// /api/github/callback, which only accepts the return trip if both match —
// proving the flow was started here, by this browser.
export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      { error: "You must be signed in to CodeClik." },
      { status: 401 }
    );
  }

  const state = crypto.randomBytes(32).toString("hex");

  const installUrl = new URL("https://github.com/apps/codeforge-niket/installations/new");
  installUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(installUrl);
  response.cookies.set(GITHUB_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // "lax" is still sent on GitHub's top-level redirect back to us.
    sameSite: "lax",
    path: "/api/github",
    maxAge: 10 * 60,
  });

  return response;
}

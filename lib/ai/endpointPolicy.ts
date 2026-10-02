import { lookup } from "dns/promises";
import { isIP } from "net";

// Users can point the custom/Ollama providers at any URL, and this server then
// calls it. Without limits that lets anyone make the server reach places only
// it can reach — localhost services, the private network, cloud metadata
// (169.254.169.254) — and read the replies (SSRF). Every user-supplied
// endpoint is checked here, both when it's saved and right before each call.

/** Ollama runs on the user's own machine, so localhost is only allowed in local development. */
const LOCAL_MODEL_PROVIDERS = new Set(["ollama", "local"]);

export class EndpointNotAllowedError extends Error {}

function ipv4ToNumber(ip: string): number {
  return ip.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}

function inIpv4Range(ip: string, base: string, prefixBits: number): boolean {
  const size = 2 ** (32 - prefixBits);
  const start = ipv4ToNumber(base);
  const value = ipv4ToNumber(ip);
  return value >= start && value < start + size;
}

const PRIVATE_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback (localhost)
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) {
    return PRIVATE_IPV4_RANGES.some(([base, bits]) => inIpv4Range(ip, base, bits));
  }

  if (version === 6) {
    const normalized = ip.toLowerCase();
    // IPv4-mapped (::ffff:127.0.0.1) — judge the embedded IPv4 address. The
    // URL parser rewrites it in hex (::ffff:7f00:1), so handle both forms.
    const mappedDotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedDotted) return isPrivateAddress(mappedDotted[1]);

    const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const high = parseInt(mappedHex[1], 16);
      const low = parseInt(mappedHex[2], 16);
      return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }

    return (
      normalized === "::" ||
      normalized === "::1" ||
      /^f[cd]/.test(normalized) || // unique local fc00::/7
      /^fe[89ab]/.test(normalized) || // link-local fe80::/10
      /^ff/.test(normalized) // multicast
    );
  }

  return true; // not an IP at all — treat as unsafe
}

function allowsLocalEndpoints(provider: string): boolean {
  return LOCAL_MODEL_PROVIDERS.has(provider) && process.env.NODE_ENV !== "production";
}

/**
 * Throws EndpointNotAllowedError unless `endpoint` is a public https URL (or,
 * for Ollama/local during development, a local address). Resolves the
 * hostname too, so a domain that points at 127.0.0.1 is caught.
 */
export async function assertEndpointAllowed(endpoint: string, provider: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new EndpointNotAllowedError("The endpoint must be a full URL, like https://api.example.com/v1.");
  }

  if (url.username || url.password) {
    throw new EndpointNotAllowedError("Put API keys in the API key field, not in the endpoint URL.");
  }

  const localAllowed = allowsLocalEndpoints(provider);

  // URL keeps IPv6 hosts in brackets: [::1]
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  const blockedMessage = LOCAL_MODEL_PROVIDERS.has(provider)
    ? "Local models (localhost / private addresses) only work when CodeClik runs on your own computer."
    : "The endpoint must be a public address — localhost and private network addresses aren't allowed.";

  const isLocalName =
    hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".internal");

  // Checked before the protocol so a blocked local address gets the real reason.
  if (!localAllowed && (isLocalName || (isIP(hostname) && isPrivateAddress(hostname)))) {
    throw new EndpointNotAllowedError(blockedMessage);
  }

  if (url.protocol !== "https:" && !(localAllowed && url.protocol === "http:")) {
    throw new EndpointNotAllowedError("The endpoint must use https://.");
  }

  if (localAllowed) return;

  const addresses = isIP(hostname)
    ? [hostname]
    : await lookup(hostname, { all: true })
        .then((results) => results.map((result) => result.address))
        .catch(() => {
          throw new EndpointNotAllowedError(`Couldn't find the server "${hostname}". Check the endpoint URL.`);
        });

  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new EndpointNotAllowedError(blockedMessage);
  }
}

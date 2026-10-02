import crypto from "crypto";
import jwt from "jsonwebtoken";

/** Cookie holding the `state` value for the GitHub install round trip. */
export const GITHUB_STATE_COOKIE = "github_install_state";

/** Constant-time string comparison, so timing can't reveal the expected value. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Exchanges the one-time `code` GitHub returns after the user authorizes the
 * app for a user access token. Requires the app's client secret, so only
 * this server can do it — a copied code is useless to anyone else.
 */
export async function exchangeCodeForUserToken(code: string): Promise<string> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("GitHub OAuth credentials are missing");
  }

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const data = await response.json().catch(() => null);

  // GitHub reports a bad/expired/reused code as a 200 with an `error` field.
  if (!response.ok || !data?.access_token) {
    throw new GitHubVerificationError(
      "GitHub could not verify this sign-in. Please try connecting again."
    );
  }

  return data.access_token as string;
}

/**
 * Whether the GitHub user behind `userToken` can access `installationId`
 * (an installation of this app). This is the ownership check: it's what
 * stops someone from claiming another user's installation by typing its ID.
 */
export async function userCanAccessInstallation(
  userToken: string,
  installationId: string
): Promise<boolean> {
  const perPage = 100;

  for (let page = 1; ; page++) {
    const response = await fetch(
      `https://api.github.com/user/installations?per_page=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub installations lookup failed (${response.status})`);
    }

    const data = await response.json();
    const installations: Array<{ id: number }> = data.installations ?? [];

    if (installations.some((installation) => String(installation.id) === installationId)) {
      return true;
    }

    if (installations.length < perPage) return false;
  }
}

/** A connection attempt GitHub didn't vouch for — safe to show to the user. */
export class GitHubVerificationError extends Error {}

export async function getInstallationToken(
  installationId: string
) {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;

  if (!appId || !privateKey) {
    throw new Error("GitHub App credentials are missing");
  }

  const appJwt = jwt.sign(
    {
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 10 * 60,
      iss: appId,
    },
    privateKey,
    {
      algorithm: "RS256",
    }
  );

  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Failed to create GitHub installation token: ${error}`
    );
  }

  const data = await response.json();

  return data.token as string;
}
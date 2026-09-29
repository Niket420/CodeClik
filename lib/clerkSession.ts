type ClerkGlobal = {
  session?: { getToken: (options?: { skipCache?: boolean }) => Promise<string | null> } | null;
};

/**
 * Clerk's session cookie expires about every minute and is renewed by a
 * background timer, which browsers throttle in hidden tabs. So a request can
 * go out with an expired cookie and get a 401 even though the user is still
 * signed in. Fetching a fresh token also rewrites the cookie, so a retry
 * afterward succeeds. Returns false when there's no session to renew (the
 * user really is signed out).
 */
async function refreshClerkSession(): Promise<boolean> {
  const clerk = (globalThis as typeof globalThis & { Clerk?: ClerkGlobal }).Clerk;
  if (!clerk?.session) return false;

  try {
    return Boolean(await clerk.session.getToken({ skipCache: true }));
  } catch {
    return false;
  }
}

/** `fetch` that renews an expired Clerk session and retries once on 401. */
export async function fetchWithSessionRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);

  if (response.status === 401 && (await refreshClerkSession())) {
    return fetch(input, init);
  }

  return response;
}

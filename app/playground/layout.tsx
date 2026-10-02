import { auth } from "@clerk/nextjs/server";

// The editor requires sign-in. Checked here on the server (Clerk's recommended
// place for auth checks), so it covers every way in — buttons, bookmarks, and
// typed URLs. Signed-out visitors go to sign-in and come back here afterward.
export default async function PlaygroundLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, redirectToSignIn } = await auth();

  if (!userId) {
    return redirectToSignIn();
  }

  return <>{children}</>;
}

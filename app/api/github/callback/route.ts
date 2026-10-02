import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  exchangeCodeForUserToken,
  GITHUB_STATE_COOKIE,
  GitHubVerificationError,
  safeEqual,
  userCanAccessInstallation,
} from "@/lib/github";

// GitHub redirects here after the app is installed, with
// ?installation_id=…&code=…&state=…
//
// The installation_id alone proves nothing — anyone can type any number into
// this URL. So before saving it, three checks:
//   ④ `state` matches the cookie set by /api/github/install (we started this)
//   ⑤ `code` exchanges for a user token (GitHub vouches for who signed in;
//      needs our client secret, so a copied code is useless elsewhere)
//   ⑥⑦ that GitHub user can actually access this installation
// Requires "Request user authorization (OAuth) during installation" to be
// enabled in the GitHub App settings — that's what makes GitHub send `code`.
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "You must be signed in to CodeClik." },
        { status: 401 }
      );
    }

    const { searchParams } = request.nextUrl;

    const installationId = searchParams.get("installation_id");
    const setupAction = searchParams.get("setup_action");
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const expectedState = request.cookies.get(GITHUB_STATE_COOKIE)?.value;

    // The state is single-use: clear it on every outcome.
    const reply = (body: Record<string, unknown>, status = 200) => {
      const response = NextResponse.json(body, { status });
      response.cookies.delete({ name: GITHUB_STATE_COOKIE, path: "/api/github" });
      return response;
    };

    if (!installationId) {
      return reply({ success: false, error: "Missing installation_id." }, 400);
    }

    // ④ This return trip must belong to a connection started in this browser.
    if (!state || !expectedState || !safeEqual(state, expectedState)) {
      return reply(
        {
          success: false,
          error: "This GitHub connection link is invalid or expired. Please start connecting again from CodeClik.",
        },
        403
      );
    }

    if (!code) {
      return reply(
        {
          success: false,
          error:
            "GitHub didn't send a sign-in code. Enable \"Request user authorization (OAuth) during installation\" in the GitHub App settings.",
        },
        400
      );
    }

    // ⑤ Who actually signed in on GitHub?
    const userToken = await exchangeCodeForUserToken(code);

    // ⑥⑦ Does that GitHub user own (have access to) this installation?
    if (!(await userCanAccessInstallation(userToken, installationId))) {
      return reply(
        {
          success: false,
          error: "That GitHub installation doesn't belong to your GitHub account.",
        },
        403
      );
    }

    await prisma.gitHubConnection.upsert({
      where: {
        clerkUserId: userId,
      },
      update: {
        installationId,
      },
      create: {
        clerkUserId: userId,
        installationId,
      },
    });

    return reply({
      success: true,
      message: "GitHub connected successfully.",
      installationId,
      setupAction,
    });
  } catch (error) {
    console.error("GitHub callback error:", error);

    if (error instanceof GitHubVerificationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "You must be signed in to MightGuy." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);

    const installationId = searchParams.get("installation_id");
    const setupAction = searchParams.get("setup_action");

    if (!installationId) {
      return NextResponse.json(
        { error: "Missing installation_id." },
        { status: 400 }
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

    return NextResponse.json({
      success: true,
      message: "GitHub connected successfully.",
      installationId,
      setupAction,
    });
  } catch (error) {
    console.error("GitHub callback error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
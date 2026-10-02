import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getInstallationToken } from "@/lib/github";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "You must be signed in to MightGuy." },
        { status: 401 }
      );
    }

    const connection = await prisma.gitHubConnection.findUnique({
      where: { clerkUserId: userId },
    });

    if (!connection) {
      return NextResponse.json(
        { error: "No GitHub installation found for this user." },
        { status: 404 }
      );
    }

    const token = await getInstallationToken(connection.installationId);

    return NextResponse.json({
      success: true,
      token,
    });
  } catch (error) {
    console.error("GitHub token error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
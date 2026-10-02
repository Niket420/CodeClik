import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "You must be signed in to MightGuy." },
        { status: 401 }
      );
    }

    const connection = await prisma.gitHubConnection.findUnique({
      where: { clerkUserId: userId },
    });

    return NextResponse.json({
      success: true,
      connected: !!connection,
    });
  } catch (error) {
    console.error("GitHub status error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

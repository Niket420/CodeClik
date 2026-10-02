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

    const response = await fetch(
      "https://api.github.com/installation/repositories",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${error}`);
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      repositories: data.repositories.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        cloneUrl: repo.clone_url,
      })),
    });
  } catch (error) {
    console.error("GitHub repositories error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
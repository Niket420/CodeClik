import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { assertEndpointAllowed, EndpointNotAllowedError } from "@/lib/ai/endpointPolicy";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    const body = await request.json();

    const {
      provider,
      model,
      apiKey: rawApiKey,
      endpoint,
    } = body;

    // Trim defensively — a copy-pasted key with a stray trailing space or
    // newline would otherwise get encrypted as-is and silently fail auth
    // against the provider later.
    const apiKey = typeof rawApiKey === "string" ? rawApiKey.trim() : rawApiKey;

    if (!provider || !model) {
      return NextResponse.json(
        { error: "Provider and model are required." },
        { status: 400 }
      );
    }

    // Local models don't necessarily require an API key.
    if (provider !== "local" && !apiKey) {
      return NextResponse.json(
        { error: "API key is required." },
        { status: 400 }
      );
    }

    // Reject endpoints that would make this server call localhost, the
    // private network or cloud metadata (SSRF). Checked again before each call.
    if (endpoint) {
      if (typeof endpoint !== "string") {
        return NextResponse.json({ error: "Endpoint must be a URL." }, { status: 400 });
      }
      try {
        await assertEndpointAllowed(endpoint.trim(), provider);
      } catch (error) {
        if (error instanceof EndpointNotAllowedError) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        throw error;
      }
    }

    const encryptedApiKey = apiKey ? encrypt(apiKey) : "";

    const connection = await prisma.aIProviderConnection.upsert({
      where: {
        clerkUserId_provider: {
          clerkUserId: userId,
          provider,
        },
      },
      update: {
        model,
        encryptedApiKey,
        endpoint: endpoint || null,
      },
      create: {
        clerkUserId: userId,
        provider,
        model,
        encryptedApiKey,
        endpoint: endpoint || null,
      },
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        model: connection.model,
        endpoint: connection.endpoint,
      },
    });
  } catch (error) {
    console.error("AI provider save error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    const providers = await prisma.aIProviderConnection.findMany({
      where: {
        clerkUserId: userId,
      },
      select: {
        id: true,
        provider: true,
        model: true,
        endpoint: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      providers,
    });
  } catch (error) {
    console.error("AI provider fetch error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load AI providers.",
      },
      { status: 500 }
    );
  }
}
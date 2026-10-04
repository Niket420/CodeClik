import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { BEDROCK_REGIONS } from "@/lib/ai/bedrock";

// Lists the Bedrock models a user's API key can use, for the provider
// settings dropdown. Runs server-side so the key never has to be sent to AWS
// from the browser; when editing an existing connection with the key field
// left blank, the saved (encrypted) key is used.
//
// Only AWS hosts built from an allowlisted region are ever called.

type BedrockModel = { id: string; name: string; provider: string };

type FoundationModelSummary = {
  modelId: string;
  modelName?: string;
  providerName?: string;
  outputModalities?: string[];
  inferenceTypesSupported?: string[];
  modelLifecycle?: { status?: string };
};

type InferenceProfileSummary = {
  inferenceProfileId: string;
  inferenceProfileName?: string;
  status?: string;
};

const REQUEST_TIMEOUT_MS = 15_000;

// "us.anthropic.claude-sonnet-4-6" → "Anthropic"
function providerFromId(id: string): string {
  const parts = id.split(".");
  const vendor = parts.length > 2 && parts[0].length <= 4 ? parts[1] : parts[0];
  return vendor ? vendor.charAt(0).toUpperCase() + vendor.slice(1) : "Other";
}

async function getJson(url: string, apiKey: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body };
}

async function listRuntimeModels(region: string, apiKey: string): Promise<BedrockModel[]> {
  const base = `https://bedrock.${region}.amazonaws.com`;
  const [models, profiles] = await Promise.all([
    getJson(`${base}/foundation-models?byOutputModality=TEXT`, apiKey),
    getJson(`${base}/inference-profiles?maxResults=1000`, apiKey),
  ]);

  if (!models.ok) {
    throw Object.assign(new Error("list failed"), { status: models.status });
  }

  const result: BedrockModel[] = [];

  for (const model of (models.body?.modelSummaries ?? []) as FoundationModelSummary[]) {
    const active = (model.modelLifecycle?.status ?? "ACTIVE") === "ACTIVE";
    const onDemand = model.inferenceTypesSupported?.includes("ON_DEMAND");
    if (active && onDemand) {
      result.push({
        id: model.modelId,
        name: model.modelName ?? model.modelId,
        provider: model.providerName ?? providerFromId(model.modelId),
      });
    }
  }

  // Newer models (e.g. recent Claude) are only callable through an inference
  // profile ID such as "us.anthropic.claude-sonnet-4-6". Missing permission
  // for this list just means fewer options, not an error.
  if (profiles.ok) {
    for (const profile of (profiles.body?.inferenceProfileSummaries ?? []) as InferenceProfileSummary[]) {
      if ((profile.status ?? "ACTIVE") !== "ACTIVE") continue;
      result.push({
        id: profile.inferenceProfileId,
        name: profile.inferenceProfileName ?? profile.inferenceProfileId,
        provider: providerFromId(profile.inferenceProfileId),
      });
    }
  }

  return result;
}

async function listMantleModels(region: string, apiKey: string): Promise<BedrockModel[]> {
  const response = await getJson(`https://bedrock-mantle.${region}.api.aws/v1/models`, apiKey);
  if (!response.ok) {
    throw Object.assign(new Error("list failed"), { status: response.status });
  }

  return ((response.body?.data ?? []) as Array<{ id: string }>).map((model) => ({
    id: model.id,
    name: model.id,
    provider: providerFromId(model.id),
  }));
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const region = typeof body?.region === "string" ? body.region : "";
  const endpointType = body?.endpointType === "mantle" ? "mantle" : "runtime";

  if (!BEDROCK_REGIONS.includes(region)) {
    return NextResponse.json({ error: "Unknown AWS region." }, { status: 400 });
  }

  let apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) {
    const saved = await prisma.aIProviderConnection.findUnique({
      where: { clerkUserId_provider: { clerkUserId: userId, provider: "bedrock" } },
      select: { encryptedApiKey: true },
    });
    if (saved?.encryptedApiKey) apiKey = decrypt(saved.encryptedApiKey).trim();
  }
  if (!apiKey) {
    return NextResponse.json({ error: "Paste your Bedrock API key first." }, { status: 400 });
  }

  try {
    const models = endpointType === "mantle"
      ? await listMantleModels(region, apiKey)
      : await listRuntimeModels(region, apiKey);

    const unique = [...new Map(models.map((model) => [model.id, model])).values()].sort(
      (a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name),
    );

    return NextResponse.json({ success: true, models: unique });
  } catch (error) {
    const status = (error as { status?: number })?.status;
    console.error("Bedrock model list error:", status ?? error);

    const message =
      status === 401 || status === 403
        ? "AWS rejected this key, or it isn't allowed to list models. Check the key and region — you can still type a model ID."
        : "Couldn't load models from AWS right now — you can still type a model ID.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// AWS Bedrock's OpenAI-compatible endpoints. The settings form builds the
// endpoint URL from a region + endpoint type, so users only paste a key and a
// model ID.
export const BEDROCK_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-2",
  "ca-central-1",
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-north-1",
  "ap-south-1",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "sa-east-1",
];

export type BedrockEndpointType = "runtime" | "mantle";

export const BEDROCK_DEFAULT_REGION = "us-east-1";

export function bedrockEndpoint(region: string, type: BedrockEndpointType): string {
  return type === "mantle"
    ? `https://bedrock-mantle.${region}.api.aws/v1`
    : `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`;
}

/** Reads region + type back out of a saved Bedrock endpoint URL. */
export function parseBedrockEndpoint(endpoint?: string): { region: string; type: BedrockEndpointType } {
  const match = endpoint?.match(/^https:\/\/bedrock-(runtime|mantle)\.([a-z0-9-]+)\./);
  return {
    type: match?.[1] === "mantle" ? "mantle" : "runtime",
    region: match?.[2] && BEDROCK_REGIONS.includes(match[2]) ? match[2] : BEDROCK_DEFAULT_REGION,
  };
}

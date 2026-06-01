import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function getAiConfig() {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "";
  const hasUsableKey = Boolean(apiKey) && apiKey !== "dev-placeholder";

  return { apiKey, baseUrl, hasUsableKey };
}

function getModelsUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("models", normalizedBaseUrl).toString();
}

function getModelIds(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null || !("data" in payload)) return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((model) => (typeof model === "object" && model !== null && "id" in model ? model.id : undefined))
    .filter((id): id is string => typeof id === "string");
}

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/ai/status", (_req, res) => {
  const { baseUrl, hasUsableKey } = getAiConfig();

  res.json({
    configured: Boolean(baseUrl) && hasUsableKey,
    baseUrlConfigured: Boolean(baseUrl),
    apiKeyConfigured: hasUsableKey,
    realtimeEnabled: process.env.AI_REALTIME_ENABLED === "true" && hasUsableKey,
    voiceFallbackEnabled: true,
    models: {
      realtime: process.env.AI_REALTIME_MODEL ?? "gpt-realtime-mini",
      transcribe: process.env.AI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe",
      tts: process.env.AI_TTS_MODEL ?? "gpt-4o-mini-tts",
      voiceParse: process.env.AI_VOICE_PARSE_MODEL ?? process.env.AI_TEXT_MODEL ?? "gpt-5.4-mini",
    },
  });
});

router.get("/ai/connectivity", async (_req, res) => {
  const { apiKey, baseUrl, hasUsableKey } = getAiConfig();

  if (!baseUrl || !hasUsableKey) {
    res.status(503).json({
      ok: false,
      configured: false,
      error: "AI base URL or API key is not configured.",
    });
    return;
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(getModelsUrl(baseUrl), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    const elapsedMs = Date.now() - startedAt;
    const payload: unknown = await response.json().catch(() => null);
    const models = getModelIds(payload);

    res.status(response.ok ? 200 : 502).json({
      ok: response.ok,
      configured: true,
      status: response.status,
      elapsedMs,
      baseUrl,
      models,
      error: response.ok ? null : "AI model endpoint returned an error.",
    });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "AI model endpoint timed out."
        : error instanceof Error
          ? error.message
          : "AI model endpoint request failed.";

    res.status(502).json({
      ok: false,
      configured: true,
      elapsedMs,
      baseUrl,
      models: [],
      error: message,
    });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;

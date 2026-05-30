import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/ai/status", (_req, res) => {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "";
  const hasUsableKey = Boolean(apiKey) && apiKey !== "dev-placeholder";

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

export default router;

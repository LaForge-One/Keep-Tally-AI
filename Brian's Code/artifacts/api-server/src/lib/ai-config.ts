function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const AI_MODELS = {
  commandParser: process.env.AI_COMMAND_MODEL ?? process.env.AI_TEXT_MODEL ?? "gpt-5.4-mini",
  voiceParser: process.env.AI_VOICE_PARSE_MODEL ?? process.env.AI_TEXT_MODEL ?? "gpt-5.4-mini",
  planningAgent: process.env.AI_AGENT_MODEL ?? "gpt-5.5",
} as const;

export const AI_LIMITS = {
  commandParserMaxOutputTokens: envInt("AI_COMMAND_MAX_OUTPUT_TOKENS", 512),
  voiceParserMaxOutputTokens: envInt("AI_VOICE_PARSE_MAX_OUTPUT_TOKENS", 256),
} as const;

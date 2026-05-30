import { openai } from "./openai";
import type { ItemRow } from "@workspace/db";
import { AI_LIMITS, AI_MODELS } from "./ai-config";

export type ParsedCommand =
  | {
      kind: "set";
      itemHint: string;
      locationHint: string | null;
      categoryHint: string | null;
      newQuantity: number;
    }
  | {
      kind: "add";
      itemHint: string;
      locationHint: string | null;
      categoryHint: string | null;
      delta: number;
    }
  | {
      kind: "reduce";
      itemHint: string;
      locationHint: string | null;
      categoryHint: string | null;
      delta: number;
    }
  | {
      kind: "create";
      itemName: string;
      category: string | null;
      location: string | null;
      quantity: number;
      parLevel: number | null;
    }
  | {
      kind: "delete";
      itemHint: string;
      locationHint: string | null;
    }
  | {
      kind: "unknown";
      reason: string;
    };

const SYSTEM_PROMPT = `You translate short English inventory commands from a vending/micro-market operator into structured JSON.

Return ONLY valid JSON matching one of these shapes:

{ "kind": "set",    "itemHint": string, "locationHint": string|null, "categoryHint": string|null, "newQuantity": integer >= 0 }
{ "kind": "add",    "itemHint": string, "locationHint": string|null, "categoryHint": string|null, "delta": integer > 0 }
{ "kind": "reduce", "itemHint": string, "locationHint": string|null, "categoryHint": string|null, "delta": integer > 0 }
{ "kind": "create", "itemName": string, "category": string|null, "location": string|null, "quantity": integer >= 0, "parLevel": integer|null }
{ "kind": "delete", "itemHint": string, "locationHint": string|null }
{ "kind": "unknown", "reason": string }

Rules:
- "Set X in Y to N" -> set
- "Add N X to Y" or "Add N X" -> add
- "Reduce X by N" or "Remove N X" or "Sold N X" -> reduce
- "Create/Add new item X" with category/par -> create
- "Delete X" or "Remove X entirely" -> delete
- itemHint is the product name as the user wrote it (e.g. "Coke Zero", "Snickers"). Do NOT invent locations.
- locationHint is the place name as the user wrote it (e.g. "Mesa warehouse", "Route 3"), or null.
- If you cannot understand, return kind "unknown" with a one-sentence reason.
- Always respond with a single JSON object, no prose, no code fences.`;

export async function parseCommand(text: string): Promise<ParsedCommand> {
  const response = await openai.chat.completions.create({
    model: AI_MODELS.commandParser,
    max_completion_tokens: AI_LIMITS.commandParserMaxOutputTokens,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content?.trim() ?? "";
  if (!content) {
    return { kind: "unknown", reason: "Empty response from parser" };
  }

  try {
    const parsed = JSON.parse(content) as ParsedCommand;
    if (!parsed || typeof parsed !== "object" || !("kind" in parsed)) {
      return { kind: "unknown", reason: "Invalid parser output" };
    }
    return parsed;
  } catch {
    return { kind: "unknown", reason: "Could not parse command" };
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function findBestItem(
  items: ItemRow[],
  itemHint: string,
  locationHint: string | null,
): ItemRow | null {
  if (items.length === 0) return null;
  const itemNorm = normalize(itemHint);
  const locNorm = locationHint ? normalize(locationHint) : null;

  const scored = items.map((item) => {
    const nameNorm = normalize(item.name);
    const itemLocNorm = normalize(item.location);

    let score = 0;
    if (nameNorm === itemNorm) score += 100;
    else if (nameNorm.includes(itemNorm) || itemNorm.includes(nameNorm))
      score += 50;
    else {
      // token overlap
      const itemTokens = itemNorm.split(" ").filter(Boolean);
      const nameTokens = nameNorm.split(" ").filter(Boolean);
      const overlap = itemTokens.filter((t) => nameTokens.includes(t)).length;
      if (overlap > 0) score += overlap * 10;
    }

    if (locNorm) {
      if (itemLocNorm === locNorm) score += 40;
      else if (itemLocNorm.includes(locNorm) || locNorm.includes(itemLocNorm))
        score += 20;
    }

    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score <= 0) return null;
  return best.item;
}

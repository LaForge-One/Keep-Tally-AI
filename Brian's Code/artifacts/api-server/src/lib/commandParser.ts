import { openai } from "./openai";
import type { ItemRow } from "@workspace/db";
import { AI_LIMITS, AI_MODELS } from "./ai-config";

export type ParsedCommand =
  | {
      kind: "set";
      itemHint: string;
      locationHint: string | null;
      categoryHint: string | null;
      matchedItemId?: number | null;
      newQuantity: number;
    }
  | {
      kind: "add";
      itemHint: string;
      locationHint: string | null;
      categoryHint: string | null;
      matchedItemId?: number | null;
      delta: number;
    }
  | {
      kind: "reduce";
      itemHint: string;
      locationHint: string | null;
      categoryHint: string | null;
      matchedItemId?: number | null;
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
      matchedItemId?: number | null;
    }
  | {
      kind: "unknown";
      reason: string;
    };

export type CommandCatalogueItem = Pick<ItemRow, "id" | "name" | "location" | "category" | "barcode">;

const BRAND_ALIASES = [
  "coke -> Coca-Cola",
  "coca cola -> Coca-Cola",
  "redbull -> Red Bull",
  "rb -> Red Bull",
  "gatoraid -> Gatorade",
  "selsius -> Celsius",
  "smart water -> Smartwater",
  "vitamin water -> Vitaminwater",
];

const SYSTEM_PROMPT = `You translate short English inventory commands from a vending/micro-market operator into structured JSON.

Return ONLY valid JSON matching one of these shapes:

{ "kind": "set",    "itemHint": string, "locationHint": string|null, "categoryHint": string|null, "matchedItemId": integer|null, "newQuantity": integer >= 0 }
{ "kind": "add",    "itemHint": string, "locationHint": string|null, "categoryHint": string|null, "matchedItemId": integer|null, "delta": integer > 0 }
{ "kind": "reduce", "itemHint": string, "locationHint": string|null, "categoryHint": string|null, "matchedItemId": integer|null, "delta": integer > 0 }
{ "kind": "create", "itemName": string, "category": string|null, "location": string|null, "quantity": integer >= 0, "parLevel": integer|null }
{ "kind": "delete", "itemHint": string, "locationHint": string|null, "matchedItemId": integer|null }
{ "kind": "unknown", "reason": string }

Rules:
- "Set X in Y to N" -> set
- "Add N X to Y" or "Add N X" -> add
- "Reduce X by N" or "Remove N X" or "Sold N X" -> reduce
- "Create/Add new item X" with category/par -> create
- "Delete X" or "Remove X entirely" -> delete
- itemHint must be only the cleaned product name. Strip verbs, quantity words, filler words, and location words.
- locationHint is the place name as the user wrote it (e.g. "Mesa warehouse", "Route 3"), or null.
- matchedItemId is the integer id from Known items when there is a confident match, otherwise null.
- Only use matchedItemId values from Known items. Never invent ids.
- Brand shorthand operators use: ${BRAND_ALIASES.join("; ")}.
- If you cannot understand, return kind "unknown" with a one-sentence reason.
- Always respond with a single JSON object, no prose, no code fences.`;

function buildCataloguePrompt(items: readonly CommandCatalogueItem[] = []): string {
  if (items.length === 0) return "";
  const catalogue = items
    .slice(0, 150)
    .map((item) => {
      const fields = [
        `${item.id}:"${item.name}"`,
        item.location ? `loc="${item.location}"` : null,
        item.category ? `cat="${item.category}"` : null,
        item.barcode ? `upc="${item.barcode}"` : null,
      ].filter(Boolean);
      return fields.join(" ");
    })
    .join("\n");

  return `\nKnown items:\n${catalogue}\nWhen the operator names a product, match it to the closest Known item and return matchedItemId.`;
}

export async function parseCommand(text: string, catalogueItems: readonly CommandCatalogueItem[] = []): Promise<ParsedCommand> {
  const response = await openai.chat.completions.create({
    model: AI_MODELS.commandParser,
    max_completion_tokens: AI_LIMITS.commandParserMaxOutputTokens,
    messages: [
      { role: "system", content: `${SYSTEM_PROMPT}${buildCataloguePrompt(catalogueItems)}` },
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
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

const TOKEN_ALIASES: Record<string, string[]> = {
  coke: ["coca", "cola"],
  coca: ["coca"],
  cola: ["cola"],
  redbull: ["red", "bull"],
  rb: ["red", "bull"],
  selsius: ["celsius"],
  gatoraid: ["gatorade"],
  smartwater: ["smart", "water"],
  vitaminwater: ["vitamin", "water"],
};

function normalizeTokens(value: string): string[] {
  const tokens = normalize(value).split(" ").filter(Boolean);
  const expanded: string[] = [];
  for (const token of tokens) {
    expanded.push(...(TOKEN_ALIASES[token] ?? [token]));
  }
  return expanded;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + substitutionCost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j]!;
  }

  return previous[b.length]!;
}

function tokenSimilarityScore(queryTokens: string[], nameTokens: string[]): number {
  if (queryTokens.length === 0 || nameTokens.length === 0) return 0;
  let exactMatches = 0;
  let fuzzyMatches = 0;

  for (const queryToken of queryTokens) {
    if (nameTokens.includes(queryToken)) {
      exactMatches += 1;
      continue;
    }
    const fuzzyMatch = nameTokens.some((nameToken) => {
      if (queryToken.length < 5 || nameToken.length < 5) return false;
      return editDistance(queryToken, nameToken) <= 2;
    });
    if (fuzzyMatch) fuzzyMatches += 1;
  }

  return (exactMatches / queryTokens.length) * 45 + (fuzzyMatches / queryTokens.length) * 30;
}

export function findBestItem(
  items: ItemRow[],
  itemHint: string,
  locationHint: string | null,
  categoryHint: string | null = null,
): ItemRow | null {
  if (items.length === 0) return null;
  const itemNorm = normalize(itemHint);
  const locNorm = locationHint ? normalize(locationHint) : null;
  const catNorm = categoryHint ? normalize(categoryHint) : null;
  const queryTokens = normalizeTokens(itemHint);

  const scored = items.map((item) => {
    const nameNorm = normalize(item.name);
    const itemLocNorm = normalize(item.location);
    const itemCatNorm = normalize(item.category);
    const nameTokens = normalizeTokens(item.name);

    let score = 0;
    if (nameNorm === itemNorm) score += 100;
    else if (nameNorm.includes(itemNorm) || itemNorm.includes(nameNorm))
      score += 50;
    else score += tokenSimilarityScore(queryTokens, nameTokens);

    if (editDistance(nameNorm, itemNorm) <= 2) score += 30;

    if (locNorm) {
      if (itemLocNorm === locNorm) score += 40;
      else if (itemLocNorm.includes(locNorm) || locNorm.includes(itemLocNorm))
        score += 20;
    }

    if (catNorm) {
      if (itemCatNorm === catNorm) score += 25;
      else if (itemCatNorm.includes(catNorm) || catNorm.includes(itemCatNorm))
        score += 15;
    }

    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  const confidenceMin = 35;
  const confidenceGap = 12;
  if (!best || best.score < confidenceMin) return null;
  if (second && best.score - second.score < confidenceGap) return null;
  return best.item;
}

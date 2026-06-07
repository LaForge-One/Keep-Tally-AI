export type ConfirmationChoice = "yes" | "no" | "unknown";
export type VoiceCountSaveAction = "verify" | "adjust";
export type VoiceCountResultStatus = "verified" | "updated-lower" | "updated-higher" | "skipped";

export type VoiceCountSaveDecision = {
  shouldSave: boolean;
  action: VoiceCountSaveAction | null;
  status: VoiceCountResultStatus;
};

export type VoiceInventoryItemLike = {
  name: string;
  quantity: number;
};

export type VoiceInventoryCommandResult<TItem extends VoiceInventoryItemLike> =
  | { status: "none" }
  | { status: "ambiguous"; candidates: TItem[] }
  | { status: "match"; item: TItem; quantity: number };

const SPOKEN_NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

const QUANTITY_FILLER_RE =
  /\b(about|around|approximately|roughly|only|just|left|remaining|on hand|in stock|count|counted|quantity|qty|there are|there is|i have|we have)\b/g;

export function parseSpokenNumber(transcript: string): number | null {
  const normalized = transcript
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(QUANTITY_FILLER_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

  const digitMatch = normalized.match(/\b(\d+)\b/);
  if (digitMatch) return Number.parseInt(digitMatch[1]!, 10);

  const words = normalized.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    const current = SPOKEN_NUMBER_WORDS[words[i]!];
    if (current === undefined) continue;

    const next = SPOKEN_NUMBER_WORDS[words[i + 1]!];
    if (words[i] === "two" && words[i + 1] === "dozen") return 24;
    if (words[i] === "three" && words[i + 1] === "dozen") return 36;
    if (next !== undefined && current >= 20 && current < 100 && next < 10) {
      return current + next;
    }
    if (words[i + 1] === "hundred" && current > 0 && current < 10) {
      const afterHundred = SPOKEN_NUMBER_WORDS[words[i + 2]!];
      return current * 100 + (afterHundred && afterHundred < 100 ? afterHundred : 0);
    }
    return current;
  }

  return null;
}

function normalizeVoiceText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripQuantityWords(value: string): string {
  const numberWords = Object.keys(SPOKEN_NUMBER_WORDS).join("|");
  return normalizeVoiceText(value)
    .replace(/\b\d+\b/g, " ")
    .replace(new RegExp(`\\b(${numberWords})\\b`, "g"), " ")
    .replace(QUANTITY_FILLER_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumberPhrase(words: readonly string[]): number | null {
  if (words.length === 0 || words.length > 3) return null;
  const phrase = words.join(" ");
  const digitOnly = phrase.match(/^\d+$/);
  if (digitOnly) return Number.parseInt(digitOnly[0], 10);
  if (words.length === 1) return SPOKEN_NUMBER_WORDS[words[0]!] ?? null;
  if (words.length === 2) {
    if (words[0] === "two" && words[1] === "dozen") return 24;
    if (words[0] === "three" && words[1] === "dozen") return 36;
    const first = SPOKEN_NUMBER_WORDS[words[0]!];
    const second = SPOKEN_NUMBER_WORDS[words[1]!];
    if (first !== undefined && second !== undefined && first >= 20 && first < 100 && second < 10) {
      return first + second;
    }
    if (words[1] === "hundred" && first !== undefined && first > 0 && first < 10) {
      return first * 100;
    }
  }
  if (words.length === 3 && words[1] === "hundred") {
    const first = SPOKEN_NUMBER_WORDS[words[0]!];
    const third = SPOKEN_NUMBER_WORDS[words[2]!];
    if (first !== undefined && third !== undefined && first > 0 && first < 10 && third < 100) {
      return first * 100 + third;
    }
  }
  return null;
}

function stripQuantityFiller(value: string): string {
  return normalizeVoiceText(value)
    .replace(QUANTITY_FILLER_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractInventoryCommandParts(transcript: string): { itemQuery: string; quantity: number; quantityPosition: "leading" | "trailing" | "unknown" } | null {
  const normalized = stripQuantityFiller(transcript);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  for (let length = Math.min(3, words.length - 1); length >= 1; length -= 1) {
    const quantity = parseNumberPhrase(words.slice(words.length - length));
    if (quantity !== null) {
      return {
        quantity,
        itemQuery: words.slice(0, words.length - length).join(" "),
        quantityPosition: "trailing",
      };
    }
  }

  for (let length = Math.min(3, words.length - 1); length >= 1; length -= 1) {
    const quantity = parseNumberPhrase(words.slice(0, length));
    if (quantity !== null) {
      return {
        quantity,
        itemQuery: words.slice(length).join(" "),
        quantityPosition: "leading",
      };
    }
  }

  const quantity = parseSpokenNumber(transcript);
  if (quantity === null) return null;
  return {
    quantity,
    itemQuery: stripQuantityWords(transcript),
    quantityPosition: "unknown",
  };
}

function rankVoiceItemMatches<TItem extends VoiceInventoryItemLike>(
  query: string,
  items: readonly TItem[],
): Array<{ item: TItem; score: number }> {
  const normalizedQuery = normalizeVoiceText(query);
  if (!normalizedQuery) return [];

  const queryWords = normalizedQuery.split(/\s+/).filter((word) => word.length > 1);
  const ranked: Array<{ item: TItem; score: number }> = [];

  for (const item of items) {
    const normalizedName = normalizeVoiceText(item.name);
    const itemWords = normalizedName.split(/\s+/).filter((word) => word.length > 1);
    let score = 0;

    if (normalizedName === normalizedQuery) {
      score = 110;
    } else if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) {
      score = (Math.min(normalizedName.length, normalizedQuery.length) / Math.max(normalizedName.length, normalizedQuery.length)) * 100;
    } else {
      const matchCount = queryWords.filter((queryWord) =>
        itemWords.some((itemWord) => itemWord.includes(queryWord) || queryWord.includes(itemWord)),
      ).length;
      score = queryWords.length > 0 ? (matchCount / queryWords.length) * 100 : 0;
    }

    if (score >= 40) ranked.push({ item, score });
  }

  return ranked.sort((a, b) => b.score - a.score);
}

export function parseVoiceInventoryCommand<TItem extends VoiceInventoryItemLike>(
  transcript: string,
  items: readonly TItem[],
): VoiceInventoryCommandResult<TItem> {
  const commandParts = extractInventoryCommandParts(transcript);
  if (!commandParts) return { status: "none" };

  const ranked = rankVoiceItemMatches(commandParts.itemQuery || transcript, items);
  if (ranked.length === 0) return { status: "none" };

  const [best, second] = ranked;
  const normalizedItemQuery = normalizeVoiceText(commandParts.itemQuery);
  const secondName = second ? normalizeVoiceText(second.item.name) : "";
  if (
    second &&
    commandParts.quantityPosition === "trailing" &&
    best!.score >= 100 &&
    normalizedItemQuery.length > 0 &&
    second.score >= 60 &&
    secondName !== normalizedItemQuery &&
    secondName.includes(normalizedItemQuery)
  ) {
    return { status: "ambiguous", candidates: ranked.slice(0, 3).map((match) => match.item) };
  }
  if (second && best!.score < 90 && Math.abs(best!.score - second.score) < 12) {
    return { status: "ambiguous", candidates: ranked.slice(0, 3).map((match) => match.item) };
  }

  return { status: "match", item: best!.item, quantity: commandParts.quantity };
}

export function parseVoiceCountConfirmation(transcript: string): ConfirmationChoice {
  const t = transcript.toLowerCase().trim();
  if (!t) return "unknown";
  if (/\b(no|nope|cancel|wrong|incorrect|retry|try again|don't save|do not save|skip)\b/.test(t)) {
    return "no";
  }
  if (/\b(yes|yeah|yep|correct|right|confirmed|confirm|affirmative|agreed|approve|approved|ok|okay|save|save it|proceed|do it|that's right|that is right)\b/.test(t)) {
    return "yes";
  }
  return "unknown";
}

export function decideVoiceCountSave(currentQuantity: number, countedQuantity: number, confirmation: ConfirmationChoice): VoiceCountSaveDecision {
  if (confirmation !== "yes") {
    return {
      shouldSave: false,
      action: null,
      status: "skipped",
    };
  }

  if (countedQuantity === currentQuantity) {
    return {
      shouldSave: true,
      action: "verify",
      status: "verified",
    };
  }

  return {
    shouldSave: true,
    action: "adjust",
    status: countedQuantity > currentQuantity ? "updated-higher" : "updated-lower",
  };
}

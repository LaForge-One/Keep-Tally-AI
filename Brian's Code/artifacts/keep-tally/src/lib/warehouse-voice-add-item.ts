export type WarehouseVoiceAddItemDraft = {
  name: string | null;
  category: string | null;
  quantity: number | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  barcode: string | null;
  location: string;
};

export type WarehouseVoiceAddItemDraftResponse = {
  status: "draft" | "need_more_info";
  draft: WarehouseVoiceAddItemDraft;
  missingFields: string[];
  warnings: string[];
  confidence: number;
  nextQuestion: string | null;
};

export type WarehouseVoiceAddItemConfirmation = "yes" | "no" | "unknown";

export type WarehouseItemCreatePayload = {
  name: string;
  barcode: string;
  category: string;
  quantity: number;
  minPar: number;
  maxPar: number;
  reorderPoint: number;
  unitsPerCase: number;
};

export function parseWarehouseVoiceAddItemConfirmation(transcript: string): WarehouseVoiceAddItemConfirmation {
  const text = transcript.toLowerCase().trim();
  if (/\b(no|nope|cancel|stop|negative|do not|don't|dont|skip)\b/.test(text)) return "no";
  if (/\b(yes|yep|yeah|correct|confirm|confirmed|affirmative|approve|approved|create|save|do it|go ahead)\b/.test(text)) {
    return "yes";
  }
  return "unknown";
}

export function isCompleteWarehouseVoiceAddItemDraft(draft: WarehouseVoiceAddItemDraft): draft is WarehouseVoiceAddItemDraft & {
  name: string;
  category: string;
  quantity: number;
  minQuantity: number;
  maxQuantity: number;
} {
  return Boolean(
    draft.name &&
    draft.category &&
    draft.quantity !== null &&
    draft.minQuantity !== null &&
    draft.maxQuantity !== null &&
    draft.minQuantity <= draft.maxQuantity,
  );
}

export function warehouseVoiceAddItemDraftSummary(draft: WarehouseVoiceAddItemDraft): string {
  const parts = [
    draft.name,
    `category ${draft.category}`,
    `quantity ${draft.quantity}`,
    `minimum ${draft.minQuantity}`,
    `maximum ${draft.maxQuantity}`,
  ];
  if (draft.barcode) parts.push(`barcode ${draft.barcode}`);
  return parts.filter(Boolean).join(", ");
}

export function buildWarehouseItemCreatePayloadFromVoiceDraft(
  draft: WarehouseVoiceAddItemDraft,
): WarehouseItemCreatePayload {
  if (!isCompleteWarehouseVoiceAddItemDraft(draft)) {
    throw new Error("Voice warehouse item draft is incomplete");
  }

  return {
    name: draft.name,
    barcode: draft.barcode ?? "",
    category: draft.category,
    quantity: draft.quantity,
    minPar: draft.minQuantity,
    maxPar: draft.maxQuantity,
    reorderPoint: draft.minQuantity,
    unitsPerCase: 1,
  };
}

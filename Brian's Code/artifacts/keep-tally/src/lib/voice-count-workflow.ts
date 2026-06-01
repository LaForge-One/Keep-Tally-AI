export type ConfirmationChoice = "yes" | "no" | "unknown";
export type VoiceCountSaveAction = "verify" | "adjust";
export type VoiceCountResultStatus = "verified" | "updated-lower" | "updated-higher" | "skipped";

export type VoiceCountSaveDecision = {
  shouldSave: boolean;
  action: VoiceCountSaveAction | null;
  status: VoiceCountResultStatus;
};

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

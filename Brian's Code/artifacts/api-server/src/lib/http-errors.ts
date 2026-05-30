export type ApiErrorBody = {
  error: string;
  requestId?: string;
  details?: unknown;
};

export function getErrorMessage(error: unknown, fallback = "Unexpected error"): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

export function errorBody(error: string, requestId?: string, details?: unknown): ApiErrorBody {
  return {
    error,
    ...(requestId ? { requestId } : {}),
    ...(details !== undefined ? { details } : {}),
  };
}

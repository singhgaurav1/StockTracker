export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function statusForError(error: unknown): number {
  if (error instanceof ApiError) return error.status;
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Please check") || message.startsWith("Invalid") || message.startsWith("No options")) {
    return 400;
  }
  return 502;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

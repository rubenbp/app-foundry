export function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const value = error as {
    name?: string;
    _tag?: string;
    message?: string;
    data?: { message?: string };
  };

  return `${value.name ?? value._tag ?? "OpenCode error"}: ${value.message ?? value.data?.message ?? "No safe error message available"}`;
}

// The network SDK is separate from OpenCode's embedded host and stays compatible with Node 24.

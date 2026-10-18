// Decode untrusted network responses before translating to domain facts.
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid remote object");
  }
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Invalid remote text");
  }
  return value;
}
export function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("Invalid remote identifier");
  }
  return value;
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid remote list");
  }
  return value;
}
export function sha(value: unknown) {
  const result = text(value);
  if (!/^[a-f0-9]{40}$/.test(result)) {
    throw new Error("Invalid remote commit SHA");
  }
  return result;
}
export function timestamp(value: unknown) {
  const result = Date.parse(text(value));
  if (!Number.isFinite(result)) {
    throw new Error("Invalid remote timestamp");
  }
  return result;
}
export function githubUrl(value: unknown, expected: string) {
  const result = text(value);
  if (result !== expected) {
    throw new Error("Unexpected GitHub resource identity");
  }
  return result;
}
export function previewOrigin(value: unknown) {
  const url = new URL(text(value));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname.endsWith(".vercel.app") ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Untrusted preview deployment URL");
  }
  return url.origin;
}

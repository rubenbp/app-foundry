const privateKeyPattern = new RegExp(
  "-----BEGIN [^-]*PRIVATE KEY-----[\\s\\S]*?" +
    "(?:-----END [^-]*PRIVATE KEY-----|$)",
  "g",
);
const tokenPattern = new RegExp(
  "\\b(?:sk-[\\w-]{8,}|gh[pousr]_[\\w]{8,}|" +
    "github_pat_[\\w_]{8,}|AIza[\\w-]{20,})",
  "g",
);
const credentialPattern = new RegExp(
  "((?:authorization|api[_-]?key|access[_-]?token|" +
    "refresh[_-]?token|password|secret)\\s*[\"']?\\s*[:=]\\s*[\"']?)" +
    "(?:Bearer\\s+)?[^\\s,\"'<>}]+",
  "gi",
);

export function sanitizer(secrets: string[] = []) {
  const known = secrets
    .filter((s) => s.length >= 4)
    .sort((a, b) => b.length - a.length);

  return (input: string, limit = 65_536) => {
    let text = input;
    for (const secret of known) text = text.split(secret).join("[REDACTED]");
    text = text
      .replace(privateKeyPattern, "[REDACTED PRIVATE KEY]")
      .replace(tokenPattern, "[REDACTED]")
      .replace(credentialPattern, "$1[REDACTED]")
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[REDACTED]@")
      // eslint-disable-next-line no-control-regex -- strip ANSI escape codes
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
    const truncated = text.length > limit;

    return {
      text: truncated ? text.slice(0, limit) + "\n[TRUNCATED]" : text,
      truncated,
    };
  };
}

export function sanitizedRecord<T>(
  value: T,
  clean: ReturnType<typeof sanitizer>,
): T {
  if (typeof value === "string")
    return clean(value, Number.MAX_SAFE_INTEGER).text as T;
  if (Array.isArray(value))
    return value.map((item) => sanitizedRecord(item, clean)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sanitizedRecord(item, clean),
      ]),
    ) as T;
  return value;
}

export function sanitizer(secrets: string[] = []) {
  const known = secrets.filter(s => s.length >= 4).sort((a, b) => b.length - a.length);
  return (input: string, limit = 65_536) => {
    let text = input;
    for (const secret of known) text = text.split(secret).join("[REDACTED]");
    text = text
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, "[REDACTED PRIVATE KEY]")
      .replace(/\b(?:sk-[\w-]{8,}|gh[pousr]_[\w]{8,}|github_pat_[\w_]{8,}|AIza[\w-]{20,})/g, "[REDACTED]")
      .replace(/((?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s,"'<>}]+/gi, "$1[REDACTED]")
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[REDACTED]@")
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
    const truncated = text.length > limit;
    return { text: truncated ? text.slice(0, limit) + "\n[TRUNCATED]" : text, truncated };
  };
}

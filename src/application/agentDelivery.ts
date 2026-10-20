/** Separate the agent's per-attempt explanation from its cumulative PR delivery.
 * Older conversations without a summary block keep their original response.
 * This is transport parsing, not an editorial review gate.
 */
export function agentDelivery(text: string) {
  const summary = /<factory-summary>\s*([\s\S]*?)\s*<\/factory-summary>/.exec(
    text,
  );

  return {
    description: summary ? text.replace(summary[0], "").trim() : text,
    summary: summary?.[1].trim() || text.trim(),
  };
}

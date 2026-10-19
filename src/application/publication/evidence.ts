import type { Factory } from "../factory.ts";
import type { Run } from "../../domain/run.ts";

export function assertCandidateEvidence(factory: Factory, run: Run) {
  const verification = run.verification!;
  const output = (id: string) => {
    const part = run.parts.find((part) => part.id === id);
    const text = factory.output(run.id, id);
    if (!part || part.truncated || text === null) {
      throw new Error(`Complete evidence missing: ${id}`);
    }
    return text;
  };
  if (
    verification.headSha !== run.publication!.head ||
    verification.status !== "passed" ||
    verification.effectsUncertain ||
    !verification.checks.length ||
    verification.checks.some(
      (check) =>
        check.status !== "passed" ||
        check.code !== 0 ||
        check.cleanup !== "confirmed",
    )
  ) {
    throw new Error(
      "Valid complete technical evidence for the current head required",
    );
  }
  for (const id of [
    verification.diffPartId,
    verification.configurationPartId,
    ...verification.checks.map((check) => check.partId),
  ]) {
    output(id);
  }
}

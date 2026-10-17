export interface VerificationCheck {
  command: string;
  executedCommand: string | null;
  status: "not_run" | "running" | "passed" | "failed" | "uncertain";
  code: number | null;
  partId: string;
  startedAt: number | null;
  endedAt: number | null;
}

export interface CriterionEvidence {
  text: string;
  status: "missing_evidence" | "human_pending";
  evidence: string[];
  missing: string[];
}

export interface Verification {
  baseSha: string;
  headSha: string | null;
  status: "running" | "passed" | "failed" | "intervention";
  diffPartId: string;
  configurationPartId: string;
  checks: VerificationCheck[];
  criteria: CriterionEvidence[];
  controls: string[];
  e2e?: {
    origin: string;
    serves: string;
    reuseExistingServer: false;
    offline: boolean;
    browsers: {
      name: string;
      channel: string | null;
      executablePath: string | null;
    }[];
    executedTests: number;
    skippedTests: number;
  };
  limitations: string[];
  error: string | null;
}

export function verificationPlan(
  baseSha: string,
  commands: string[],
  body: string,
): Verification {
  const criteriaHeading = new RegExp(
    "^#{1,6}\\s+(?:Acceptance criteria|Criterios de aceptaci[oó]n)" +
      "\\s*\\r?\\n([\\s\\S]*?)(?=^#{1,6}\\s|$(?![\\s\\S]))",
    "im",
  );
  const section = body.match(criteriaHeading)?.[1]?.trim();
  const criteria = section
    ?.split(/\r?\n(?=\s*(?:[-*]|\d+\.)\s)/)
    .filter(Boolean) ?? [body];

  return {
    baseSha,
    headSha: null,
    status: "running",
    diffPartId: "verification-diff",
    configurationPartId: "verification-configuration",
    checks: commands.map((command, index) => ({
      command,
      executedCommand: null,
      status: "not_run",
      code: null,
      partId: `verification-check-${index + 1}`,
      startedAt: null,
      endedAt: null,
    })),
    criteria: criteria.map((text) => ({
      text,
      status: "missing_evidence",
      evidence: [],
      missing: [
        "No criterion-specific automated evidence. Human judgment required; a passing suite does not prove this criterion.",
      ],
    })),
    controls: [],
    limitations: [
      "Control comparison is conservative and cannot detect every semantic weakening.",
      "Local verification does not accredit preview, acceptance, merge or production.",
    ],
    error: null,
  };
}

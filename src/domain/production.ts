import type { Preview, ConversationComment } from "./publication.ts";

export interface PublicCheck {
  criterion: number;
  path: string;
  selector: string;
  text?: string;
  href?: string;
  follow?: boolean;
}
export interface PublicEvidence {
  origin: string;
  servedHead: string | null;
  error?: string;
  browser: string;
  checks: { check: PublicCheck; observed: string; passed: boolean }[];
  screenshots: string[];
}
export interface Production {
  status: "pending" | "verified" | "intervention";
  deployment?: Preview;
  observations: { at: number; deployment: Preview | null }[];
  servedHead?: string;
  evidencePartId?: string;
  verifiedAt?: number;
  report?: Pick<ConversationComment, "id" | "url">;
  closedAt?: number;
  error?: string;
}

// The fixed authorized request supplies assertions, never executable code.
// Unsupported behavior must receive human intervention instead of a green HTTP check.
export function publicChecks(
  body: string,
  criteriaCount: number,
): PublicCheck[] {
  const blocks = [
    ...body.matchAll(/^```factory-production\s*\n([\s\S]*?)^```\s*$/gm),
  ];
  if (blocks.length !== 1) {
    throw new Error(
      "One factory-production check plan required in the authorized request",
    );
  }
  const checks: unknown = JSON.parse(blocks[0][1]);
  if (!Array.isArray(checks) || !checks.length || checks.length > 30) {
    throw new Error("Production requires 1–30 public checks");
  }
  for (const value of checks) {
    if (!value || typeof value !== "object") {
      throw new Error("Invalid public check");
    }
    const check = value as Record<string, unknown>;
    const boundedText = (value: unknown) =>
      typeof value === "string" && value.length > 0 && value.length <= 4000;
    if (
      !Number.isSafeInteger(check.criterion) ||
      Number(check.criterion) < 1 ||
      Number(check.criterion) > criteriaCount ||
      !boundedText(check.path) ||
      !/^\/[\w/-]*$/.test(String(check.path)) ||
      !boundedText(check.selector) ||
      (check.text === undefined && check.href === undefined) ||
      (check.text !== undefined && !boundedText(check.text)) ||
      (check.href !== undefined &&
        (!boundedText(check.href) ||
          !/^\/[\w/-]*$/.test(String(check.href)))) ||
      (check.follow !== undefined &&
        (typeof check.follow !== "boolean" || !check.href))
    ) {
      throw new Error(
        "Invalid public check; require criterion, local path, selector and exact text or internal href",
      );
    }
  }
  for (let index = 1; index <= criteriaCount; index++) {
    if (!checks.some((check) => check.criterion === index)) {
      throw new Error(`Production evidence missing for criterion ${index}`);
    }
  }
  return checks.map((check) => ({
    criterion: check.criterion,
    path: check.path,
    selector: check.selector,
    ...(check.text !== undefined ? { text: check.text } : {}),
    ...(check.href !== undefined ? { href: check.href } : {}),
    ...(check.follow !== undefined ? { follow: check.follow } : {}),
  }));
}

import type { ManagedProject } from "../domain/request.ts";
import { mergeContext } from "../domain/publication.ts";
import { remoteCommand, type RemoteCommand } from "./remoteCommand.ts";

interface Protection {
  required_status_checks?: {
    strict: boolean;
    contexts: string[];
    checks?: { context: string; app_id: number | null }[];
  };
  required_pull_request_reviews?: Record<string, unknown>;
  restrictions?: {
    users: { login: string }[];
    teams: { slug: string }[];
    apps: { slug: string }[];
  } | null;
  [key: string]: unknown;
}

// Explicit setup operation. The poller never receives administrative duties.
// Preserve existing checks, reviews, restrictions and protection flags.
export async function configureMergeProtection(
  project: ManagedProject,
  command: RemoteCommand = remoteCommand,
) {
  const path = `repos/${project.repository}/branches/${encodeURIComponent(project.baseBranch)}/protection`;
  const before = JSON.parse(await command("gh", ["api", path])) as Protection;
  const checks =
    before.required_status_checks?.checks?.map((check) => ({ ...check })) ??
    before.required_status_checks?.contexts.map((context) => ({
      context,
      app_id: -1,
    })) ??
    [];
  if (!checks.some((check) => check.context === "Vercel")) {
    checks.push({ context: "Vercel", app_id: 8329 });
  }
  if (!checks.some((check) => check.context === mergeContext)) {
    checks.push({ context: mergeContext, app_id: -1 });
  }
  const existingReviews = before.required_pull_request_reviews;
  const reviews: Record<string, unknown> = {
    required_approving_review_count: 0,
  };
  for (const key of [
    "dismiss_stale_reviews",
    "require_code_owner_reviews",
    "required_approving_review_count",
    "require_last_push_approval",
  ]) {
    if (existingReviews?.[key] !== undefined) {
      reviews[key] = existingReviews[key];
    }
  }
  for (const key of [
    "dismissal_restrictions",
    "bypass_pull_request_allowances",
  ]) {
    const restrictions = existingReviews?.[key] as Protection["restrictions"];
    if (restrictions) {
      reviews[key] = {
        users: restrictions.users.map((user) => user.login),
        teams: restrictions.teams.map((team) => team.slug),
        apps: restrictions.apps?.map((app) => app.slug) ?? [],
      };
    }
  }
  const body: Record<string, unknown> = {
    required_status_checks: { strict: true, checks },
    enforce_admins: true,
    required_pull_request_reviews: reviews,
    required_conversation_resolution: true,
    restrictions: before.restrictions
      ? {
          users: before.restrictions.users.map((user) => user.login),
          teams: before.restrictions.teams.map((team) => team.slug),
          apps: before.restrictions.apps.map((app) => app.slug),
        }
      : null,
  };
  for (const key of [
    "required_linear_history",
    "allow_force_pushes",
    "allow_deletions",
    "block_creations",
    "lock_branch",
    "allow_fork_syncing",
  ]) {
    const flag = before[key];
    if (flag && typeof flag === "object" && "enabled" in flag) {
      body[key] = flag.enabled;
    }
  }
  await command("gh", ["api", path, "--method", "PUT", "--input", "-"], body);
  const after = JSON.parse(await command("gh", ["api", path])) as Protection;
  const contexts = after.required_status_checks?.contexts ?? [];
  if (
    !after.required_pull_request_reviews ||
    after.required_status_checks?.strict !== true ||
    !contexts.includes(mergeContext) ||
    !contexts.includes("Vercel")
  ) {
    throw new Error("Merge protection could not be confirmed");
  }
  return after;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GitHubPublication,
  VercelPreviewAccess,
  type RemoteCommand,
} from "../src/infrastructure/publication.ts";
import { configureMergeProtection } from "../src/infrastructure/merge-protection.ts";
import { verificationFixture } from "./support/verification.ts";
import { execute } from "../src/infrastructure/workspace.ts";

test("the Workflow crosses the real GitHub/Vercel adapters without exposing credentials or sending merge and closes commands", async () => {
  let remoteHead: string | null = null;
  let pull: Record<string, unknown> | null = null;
  let deployment = false;
  let time = Date.now();
  const comments: Record<string, unknown>[] = [];
  const statuses: Record<string, unknown>[] = [];
  const writes: string[] = [];
  const origin = "https://catalogue-random.vercel.app";
  let access: "good" | "protected" | "wrong project" | "dirty" = "good";
  const command: RemoteCommand = async (executable, args, body) => {
    const path = args[1];
    const context = s.workflow.list()[0];
    if (executable === "vercel") {
      if (args.includes("curl")) {
        assert.ok(args.includes("--max-time"));
        return access === "protected"
          ? "Authentication required\n401"
          : `${JSON.stringify({ sha: remoteHead, dirty: access === "dirty" })}\n200`;
      }
      return JSON.stringify({
        projectId: access === "wrong project" ? "other" : "catalogue",
        url: new URL(origin).hostname,
        target: null,
        readyState: "READY",
        meta: {
          githubCommitOrg: s.project.repository.split("/")[0],
          githubCommitRepo: s.project.repository.split("/")[1],
          githubCommitSha: remoteHead,
        },
      });
    }
    assert.equal(executable, "gh");
    assert.ok(!path.includes("/merge"));
    const prefix = `repos/${s.project.repository}`;
    if (body) {
      assert.ok(
        Object.values(context.publication!.operations).some(
          (operation) => operation.state === "intent",
        ),
        "intent must be durable before remote writes",
      );
      writes.push(path);
      const input = body as Record<string, unknown>;
      if (path === `${prefix}/pulls`) {
        assert.doesNotMatch(
          String(input.body),
          /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#\d+/i,
        );
        pull = {
          number: 2,
          html_url: `https://github.com/${s.project.repository}/pull/2`,
          state: "open",
          merged: false,
          head: {
            sha: remoteHead,
            ref: context.workspace!.branch,
            repo: { full_name: s.project.repository },
          },
          base: { ref: "main", repo: { full_name: s.project.repository } },
        };
        return JSON.stringify(pull);
      }
      if (path.endsWith("/comments")) {
        const id = comments.length + 1;
        const comment = {
          id,
          html_url: `https://github.com/${s.project.repository}/pull/2#issuecomment-${id}`,
          body: input.body,
          user: { login: "shared", type: "User" },
          created_at: new Date((time += 1000)).toISOString(),
          updated_at: new Date(time).toISOString(),
        };
        comments.push(comment);
        return JSON.stringify(comment);
      }
      if (path.includes("/statuses/")) {
        statuses.unshift(input);
        return JSON.stringify(input);
      }
      assert.fail(`Unexpected mutation ${path}`);
    }
    const paged = (values: unknown[]) => JSON.stringify([values]);
    if (path === `${prefix}/issues/1`)
      return JSON.stringify({
        title: context.request!.title,
        body: context.request!.body,
        state: "open",
      });
    if (path.includes("/pulls?")) return paged(pull ? [pull] : []);
    if (path.includes("/git/matching-refs/"))
      return paged(
        remoteHead
          ? [
              {
                ref: `refs/heads/${context.workspace!.branch}`,
                object: { sha: remoteHead },
              },
            ]
          : [],
      );
    if (path.includes("/issues/1/comments?")) return paged([]);
    if (path.includes("/issues/2/comments?")) return paged(comments);
    if (path.includes("/commits/")) {
      assert.ok(remoteHead, "unpublished commit must not be queried");
      return paged(statuses);
    }
    if (path.includes("/deployments?"))
      return paged(
        deployment
          ? [
              {
                id: 9,
                sha: remoteHead,
                environment: "Preview",
                repository_url: `https://api.github.com/repos/${s.project.repository}`,
                creator: { login: "vercel[bot]" },
              },
            ]
          : [],
      );
    if (path.includes("/deployments/9/statuses?"))
      return paged([{ id: 10, state: "success", environment_url: origin }]);
    if (path.includes("/permission"))
      return JSON.stringify({ permission: "write" });
    assert.fail(`Unexpected read ${path}`);
  };
  // The filesystem and local Git remain real. Only remote transport is replaced.
  const processPort: typeof execute = async (program, args, settings) => {
    if (program === "git" && args.includes("push")) {
      const run = s.workflow.list()[0];
      assert.equal(
        run.publication!.operations[`push:${run.verification!.headSha}`].state,
        "intent",
      );
      assert.ok(
        args.includes(`https://github.com/${s.project.repository}.git`),
      );
      assert.ok(!args.includes("origin"));
      assert.equal(settings.env.GIT_CONFIG_VALUE_0, "/dev/null");
      remoteHead = run.verification!.headSha;
      writes.push("push");
      return { code: 0, output: "Pushed exact verified commit" };
    }
    return execute(program, args, settings);
  };
  // Construct the adapter after the fixture path is available through a lazy port.
  const s = verificationFixture({
    publication: {
      inspect: (...args) => adapter.inspect(...args),
      push: (...args) => adapter.push(...args),
      openPull: (...args) => adapter.openPull(...args),
      comment: (...args) => adapter.comment(...args),
      status: (...args) => adapter.status(...args),
      canWrite: (...args) => adapter.canWrite(...args),
      prepareHead: (...args) => adapter.prepareHead(...args),
    },
  });
  const adapter = new GitHubPublication(s.config.dataDir, {
    command,
    process: processPort,
  });
  s.project.publication.teamId = "team-test";
  try {
    const run = await s.start();
    s.commit("footer.txt", "Remote candidate", "Footer");
    s.finish();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_preview");
    deployment = true;
    access = "wrong project";
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.publication?.report, undefined);
    assert.match(s.workflow.view(run.id)!.error!, /identity/);
    access = "protected";
    await s.workflow.poll();
    assert.equal(
      s.workflow.view(run.id)?.publication?.preview?.access,
      "protected",
    );
    access = "dirty";
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.publication?.report, undefined);
    assert.match(s.workflow.view(run.id)!.error!, /dirty/);
    access = "good";
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    const report = s.workflow.view(run.id)!.publication!.report!;
    const id = 99;
    comments.push({
      id,
      html_url: `https://github.com/${s.project.repository}/pull/2#issuecomment-${id}`,
      body: `Acepto la versión ${remoteHead} y su preview ${report.preview}.`,
      user: { login: "shared", type: "User" },
      created_at: new Date((time += 1000)).toISOString(),
      updated_at: new Date(time).toISOString(),
    });
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_merge");
    assert.equal(statuses[0].state, "success");
    assert.equal(writes.filter((write) => write === "push").length, 1);
  } finally {
    s.close();
  }
});

test("merge protection preserves existing checks and restrictions while requiring a PR, updated branch, Vercel and Factory", async () => {
  const s = verificationFixture();
  try {
    let state: Record<string, unknown> = {
      required_status_checks: {
        strict: false,
        contexts: ["Existing CI", "Vercel"],
        checks: [
          { context: "Existing CI", app_id: 42 },
          { context: "Vercel", app_id: 8329 },
        ],
      },
      required_pull_request_reviews: {
        required_approving_review_count: 1,
        dismiss_stale_reviews: true,
      },
      restrictions: { users: [{ login: "maintainer" }], teams: [], apps: [] },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_linear_history: { enabled: true },
    };
    let sent: Record<string, unknown> | undefined;
    await configureMergeProtection(s.project, async (program, args, body) => {
      assert.equal(program, "gh");
      if (body) {
        sent = body as Record<string, unknown>;
        state = {
          ...sent,
          required_status_checks: {
            ...(sent.required_status_checks as object),
            contexts: ["Existing CI", "Vercel", "Factory / ready-to-merge"],
          },
        };
      }
      return JSON.stringify(state);
    });
    assert.equal(sent?.required_linear_history, true);
    assert.deepEqual(sent?.restrictions, {
      users: ["maintainer"],
      teams: [],
      apps: [],
    });
    assert.equal(
      (sent?.required_pull_request_reviews as Record<string, unknown>)
        .required_approving_review_count,
      1,
    );
    assert.deepEqual(
      (sent?.required_status_checks as Record<string, unknown>).checks,
      [
        { context: "Existing CI", app_id: 42 },
        { context: "Vercel", app_id: 8329 },
        { context: "Factory / ready-to-merge", app_id: -1 },
      ],
    );
  } finally {
    s.close();
  }
});

test("the authorized preview transport refuses credentialed URLs and dirty version markers", async () => {
  const access = new VercelPreviewAccess("/tmp", async () => {
    throw new Error("Transport must not be called");
  });
  await assert.rejects(
    access.inspect("https://user:password@example.vercel.app", {} as never),
    /Untrusted/,
  );
});

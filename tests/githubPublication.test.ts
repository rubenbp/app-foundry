import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubPublication } from "../src/infrastructure/publication.ts";
import { VercelPreviewAccess } from "../src/infrastructure/vercelPreview.ts";
import { type RemoteCommand } from "../src/infrastructure/remoteCommand.ts";
import { configureMergeProtection } from "../src/infrastructure/mergeProtection.ts";
import { verificationFixture } from "./support/verification.ts";
import { execute } from "../src/infrastructure/process.ts";

for (const gate of [
  "unchanged",
  "edited issue",
  "merge during preview",
  "revoked after merge",
  "success only after merge",
  "revoked before merge",
] as const) {
  test(`el Workflow correlaciona la condición de integración (${({ unchanged: "sin cambios", "edited issue": "issue editado", "merge during preview": "integración durante la vista previa", "revoked after merge": "revocación tras integrar", "success only after merge": "éxito solo tras integrar", "revoked before merge": "revocación antes de integrar" } as const)[gate]}) mediante los adaptadores reales de GitHub y Vercel`, async () => {
    let remoteHead: string | null = null;
    let pull: Record<string, unknown> | null = null;
    let deployment = false;
    let integrated = false;
    let requestOpen = true;
    const integrationSha = "a".repeat(40);
    let time = Date.now();
    const comments: Record<string, unknown>[] = [];
    const issueComments: Record<string, unknown>[] = [];
    const statuses: Record<string, unknown>[] = [];
    const writes: string[] = [];
    const origin = "https://catalogue-random.vercel.app";
    let access: "good" | "protected" | "wrong project" | "dirty" = "good";
    const command: RemoteCommand = async (executable, args, body) => {
      const path = args[1];
      const context = s.workflow.list()[0];
      if (executable === "vercel") {
        assert.equal(
          integrated,
          false,
          "Vercel must not be queried after merge",
        );
        if (args.includes("curl")) {
          assert.ok(args.includes("--max-time"));
          return access === "protected"
            ? "Authentication required\n401"
            : `${JSON.stringify({ sha: remoteHead, dirty: access === "dirty" })}\n200`;
        }
        return JSON.stringify({
          projectId: access === "wrong project" ? "other" : "catalogue",
          url: new URL(origin).hostname,
          target: integrated ? "production" : null,
          readyState: "READY",
          meta: {
            githubCommitOrg: s.project.repository.split("/")[0],
            githubCommitRepo: s.project.repository.split("/")[1],
            githubCommitSha: integrated ? integrationSha : remoteHead,
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
        if (path === `${prefix}/issues/1`) {
          assert.ok(context.publication?.integrationReport);
          assert.equal(input.state, "closed");
          requestOpen = false;
          return JSON.stringify({ state: "closed" });
        }
        if (path.endsWith("/comments")) {
          const issue = path === `${prefix}/issues/1/comments`;
          const id = comments.length + issueComments.length + 1;
          const comment = {
            id,
            html_url: `https://github.com/${s.project.repository}/${issue ? "issues/1" : "pull/2"}#issuecomment-${id}`,
            body: input.body,
            user: { login: "shared", type: "User" },
            created_at: new Date((time += 1000)).toISOString(),
            updated_at: new Date(time).toISOString(),
          };
          (issue ? issueComments : comments).push(comment);
          return JSON.stringify(comment);
        }
        if (path.includes("/statuses/")) {
          statuses.unshift({
            ...input,
            created_at: new Date((time += 1000)).toISOString(),
          });
          return JSON.stringify(input);
        }
        assert.fail(`Unexpected mutation ${path}`);
      }
      const paged = (values: unknown[]) => JSON.stringify([values]);
      if (path === `${prefix}/issues/1`) {
        return JSON.stringify({
          title:
            gate === "edited issue" ? "Otro título" : context.request!.title,
          body: gate === "edited issue" ? null : context.request!.body,
          state: requestOpen ? "open" : "closed",
        });
      }
      if (path === `${prefix}/pulls/2`) {
        return JSON.stringify(pull);
      }
      if (path.includes("/pulls?")) {
        return paged(pull ? [pull] : []);
      }
      if (path.includes("/git/matching-refs/")) {
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
      }
      if (path.includes("/issues/1/comments?")) {
        return paged(issueComments);
      }
      if (path.includes("/issues/2/comments?")) {
        return paged(comments);
      }
      if (path.includes("/commits/")) {
        assert.ok(remoteHead, "unpublished commit must not be queried");
        return paged(statuses);
      }
      if (
        path.includes("/deployments?") &&
        gate === "merge during preview" &&
        !integrated &&
        statuses[0]?.state === "success"
      ) {
        integrated = true;
        Object.assign(pull!, {
          state: "closed",
          merged: true,
          merged_at: new Date(time + 1000).toISOString(),
          merged_by: { login: "maintainer", type: "User" },
          merge_commit_sha: integrationSha,
        });
        return paged([]);
      }
      if (path.includes("/deployments?")) {
        assert.equal(
          integrated,
          false,
          "Deployments must not be queried after merge",
        );
        return paged(
          deployment
            ? [
                {
                  id: 9,
                  sha: integrated ? integrationSha : remoteHead,
                  environment: integrated ? "Production" : "Preview",
                  production_environment: false,
                  repository_url: `https://api.github.com/repos/${s.project.repository}`,
                  creator: { login: "vercel[bot]" },
                },
              ]
            : [],
        );
      }
      if (path.includes("/deployments/9/statuses?")) {
        return paged([{ id: 10, state: "success", environment_url: origin }]);
      }
      if (path.includes("/permission")) {
        return JSON.stringify({ permission: "write" });
      }
      assert.fail(`Unexpected read ${path}`);
    };
    // El sistema de archivos y Git local siguen siendo reales. Solo se sustituye el transporte remoto.
    const processPort: typeof execute = async (program, args, settings) => {
      if (program === "git" && args.includes("push")) {
        const run = s.workflow.list()[0];
        assert.equal(
          run.publication!.operations[`push:${run.verification!.headSha}`]
            .state,
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
    // Construye el adaptador cuando la ruta de la fixture esté disponible mediante un puerto diferido.
    const s = verificationFixture({
      body: "Quiero mostrar el catálogo. Debe ser visible al abrir la página.",
      publication: {
        inspect: (...args) => adapter.inspect(...args),
        push: (...args) => adapter.push(...args),
        openPull: (...args) => adapter.openPull(...args),
        comment: (...args) => adapter.comment(...args),
        commentIssue: (...args) => adapter.commentIssue(...args),
        closeIssue: (...args) => adapter.closeIssue(...args),
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
      if (gate !== "merge during preview") {
        integrated = true;
        Object.assign(pull!, {
          state: "closed",
          merged: true,
          merged_at: new Date(time + 1000).toISOString(),
          merged_by: { login: "maintainer", type: "User" },
          merge_commit_sha: integrationSha,
        });
      }
      if (gate === "revoked after merge" || gate === "revoked before merge") {
        statuses.unshift({
          ...statuses[0],
          state: "pending",
          created_at: new Date(
            time + (gate === "revoked after merge" ? 2000 : 500),
          ).toISOString(),
        });
      }
      if (gate === "success only after merge") {
        for (const status of statuses) {
          if (status.state === "success") {
            status.created_at = new Date(time + 2000).toISOString();
          }
        }
      }
      await s.workflow.poll();
      if (
        gate === "success only after merge" ||
        gate === "revoked before merge"
      ) {
        assert.equal(s.workflow.view(run.id)?.status, "intervention");
        assert.equal(requestOpen, true);
        assert.equal(issueComments.length, 0);
        return;
      }
      assert.equal(
        s.workflow.view(run.id)?.status,
        "completed",
        s.workflow.view(run.id)?.error ?? "",
      );
      assert.equal(requestOpen, false);
      assert.match(String(issueComments[0].body), /Commit integrado: a{40}/);
      assert.ok(writes.includes(`repos/${s.project.repository}/issues/1`));
    } finally {
      s.close();
    }
  });
}

test("la protección de integración conserva las comprobaciones y restricciones existentes, y exige una PR, una rama actualizada, Vercel y Factory", async () => {
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

test("el transporte autorizado de la vista previa rechaza URLs con credenciales y marcadores de versión modificados", async () => {
  const access = new VercelPreviewAccess("/tmp", async () => {
    throw new Error("Transport must not be called");
  });
  await assert.rejects(
    access.inspect("https://user:password@example.vercel.app", {} as never),
    /Untrusted/,
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VercelPreviewAccess } from "../src/infrastructure/vercelPreview.ts";
import type { PublicationContext } from "../src/application/publication/ports.ts";

function previewFixture() {
  const root = mkdtempSync(join(tmpdir(), "foundry-preview-"));
  const context: PublicationContext = {
    runId: "execution",
    repository: "team/catalogue",
    issue: 1,
    head: "a".repeat(40),
    project: {
      id: "catalogue",
      repository: "team/catalogue",
      baseBranch: "main",
      instructions: [],
      preparation: { command: "npm ci" },
      verification: { commands: ["npm test"] },
      publication: {
        provider: "vercel",
        projectId: "catalogue",
        teamId: "team-test",
        humanMergeRequired: true,
      },
    },
    workspace: {
      directory: root,
      branch: "candidate",
      baseSha: "b".repeat(40),
      instructions: [],
    },
    description: { title: "Catalogue", body: "Catalogue" },
  };
  const deployment = {
    uid: "dpl-preview",
    projectId: "catalogue",
    created: 200,
    target: null,
    readyState: "READY",
    url: "catalogue-unique.vercel.app",
    meta: {
      githubCommitOrg: "team",
      githubCommitRepo: "catalogue",
      githubCommitSha: context.head,
    },
  };
  let entries: unknown[] = [deployment];
  let next: number | null = null;
  let marker = { sha: context.head, dirty: false };
  let http = "200";
  let detail = { ...deployment, projectId: "catalogue" };
  let error: Error | undefined;
  const queries: URL[] = [];
  const calls: string[] = [];
  const access = new VercelPreviewAccess(
    root,
    async (executable, args) => {
      assert.equal(executable, "trusted-vercel");
      calls.push(args[0] === "curl" ? "marker" : args[1]);
      if (error) {
        throw error;
      }
      if (args[0] === "curl") {
        assert.equal(args[1], `https://${deployment.url}/version.json`);
        return `${JSON.stringify(marker)}\n${http}`;
      }
      const query = new URL(args[1], "https://api.vercel.com");
      assert.equal(query.searchParams.get("teamId"), "team-test");
      if (query.pathname === "/v7/deployments") {
        assert.equal(query.searchParams.get("projectId"), "catalogue");
        assert.equal(query.searchParams.get("sha"), context.head);
        queries.push(query);
        return JSON.stringify({ deployments: entries, pagination: { next } });
      }
      assert.equal(query.pathname, `/v13/deployments/${deployment.url}`);
      return JSON.stringify(detail);
    },
    "trusted-vercel",
  );

  return {
    access,
    context,
    deployment,
    calls,
    queries,
    entries(value: unknown[]) {
      entries = value;
    },
    next(value: number | null) {
      next = value;
    },
    marker(value: typeof marker) {
      marker = value;
    },
    http(value: string) {
      http = value;
    },
    detail(value: typeof detail) {
      detail = value;
    },
    error(value: Error) {
      error = value;
    },
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("descubre y acredita el preview en Vercel sin depender de deployments de GitHub", async () => {
  const s = previewFixture();
  try {
    const preview = await s.access.discover(s.context);
    assert.deepEqual(preview, {
      id: "dpl-preview",
      head: s.context.head,
      repository: s.context.repository,
      projectId: "catalogue",
      environment: "Preview",
      state: "success",
      url: "https://catalogue-unique.vercel.app",
      access: "verified",
      servedHead: s.context.head,
    });
    assert.equal(s.calls.length, 3);
  } finally {
    s.close();
  }
});

for (const mismatch of [
  "project",
  "repository",
  "head",
  "production",
  "custom environment",
] as const) {
  test(`no acredita un deployment de otro ${mismatch}`, async () => {
    const s = previewFixture();
    try {
      const entry: Record<string, unknown> = { ...s.deployment };
      if (mismatch === "project") {
        entry.projectId = "other";
      }
      if (mismatch === "repository") {
        entry.meta = { ...s.deployment.meta, githubCommitRepo: "other" };
      }
      if (mismatch === "head") {
        entry.meta = { ...s.deployment.meta, githubCommitSha: "b".repeat(40) };
      }
      if (mismatch === "production") {
        entry.target = "production";
      }
      if (mismatch === "custom environment") {
        entry.customEnvironment = { slug: "staging" };
      }
      s.entries([entry]);
      assert.equal(await s.access.discover(s.context), null);
      assert.equal(s.calls.length, 1);
    } finally {
      s.close();
    }
  });
}

for (const state of [
  "BUILDING",
  "INITIALIZING",
  "QUEUED",
  "ERROR",
  "CANCELED",
  "BLOCKED",
]) {
  test(`el último deployment ${state} impide reutilizar un preview anterior READY`, async () => {
    const s = previewFixture();
    try {
      s.entries([
        s.deployment,
        { ...s.deployment, uid: "dpl-latest", created: 300, readyState: state },
      ]);
      const preview = await s.access.discover(s.context);
      assert.equal(preview?.id, "dpl-latest");
      assert.equal(
        preview?.state,
        ["ERROR", "CANCELED"].includes(state)
          ? "failure"
          : state === "BLOCKED"
            ? "error"
            : "pending",
      );
      assert.equal(preview?.access, "pending");
      assert.equal(s.calls.length, 1);
    } finally {
      s.close();
    }
  });
}

for (const failure of [
  "wrong identity",
  "dirty",
  "wrong served head",
  "protected",
  "unknown state",
  "network",
] as const) {
  test(`conserva la evidencia de ${failure} sin acreditar otro Commit candidato`, async () => {
    const s = previewFixture();
    try {
      if (failure === "wrong identity") {
        s.detail({ ...s.deployment, projectId: "other" });
      }
      if (failure === "dirty") {
        s.marker({ sha: s.context.head, dirty: true });
      }
      if (failure === "wrong served head") {
        s.marker({ sha: "b".repeat(40), dirty: false });
      }
      if (failure === "protected") {
        s.http("401");
      }
      if (failure === "unknown state") {
        s.entries([{ ...s.deployment, readyState: "UNKNOWN" }]);
      }
      if (failure === "network") {
        s.error(new Error("Vercel unavailable"));
      }
      if (failure === "protected") {
        const preview = await s.access.discover(s.context);
        assert.equal(preview?.access, "protected");
        assert.equal(preview?.servedHead, null);
      } else if (failure === "wrong served head") {
        assert.notEqual(
          (await s.access.discover(s.context))?.servedHead,
          s.context.head,
        );
      } else {
        await assert.rejects(
          s.access.discover(s.context),
          /identity|dirty|Unknown|unavailable/,
        );
      }
    } finally {
      s.close();
    }
  });
}

test("pagina con el mismo equipo, proyecto y SHA, y rechaza un cursor que no avanza", async () => {
  const s = previewFixture();
  try {
    s.entries([]);
    s.next(100);
    await assert.rejects(
      s.access.discover(s.context),
      /pagination did not advance/,
    );
    assert.equal(s.queries[1].searchParams.get("until"), "100");
  } finally {
    s.close();
  }
});

for (const missing of ["team", "environment"]) {
  test(`rechaza la configuración inválida de ${missing} antes de consultar Vercel`, async () => {
    const s = previewFixture();
    try {
      if (missing === "team") {
        delete s.context.project.publication.teamId;
      } else {
        s.context.project.publication.previewEnvironment = "Production";
      }
      await assert.rejects(s.access.discover(s.context), /teamId|environment/);
      assert.equal(s.calls.length, 0);
    } finally {
      s.close();
    }
  });
}

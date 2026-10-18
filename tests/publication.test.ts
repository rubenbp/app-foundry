import { test } from "node:test";
import assert from "node:assert/strict";
import { verificationFixture } from "./support/verification.ts";
import type {
  PublicationPort,
  PublicationFacts,
} from "../src/application/publication/ports.ts";
import { publicationFixture } from "./support/publication.ts";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

test("large reports publish the complete accumulated diff and sanitized outputs in bounded comments", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate(
      "Full diff\n" +
        "x".repeat(80_000) +
        "\nLAST_DIFF_EVIDENCE password=fictional-publication-secret",
    );
    await s.workflow.poll();
    const reports = s.writes
      .filter((write) => write.kind === "comment")
      .map((write) => write.body!);
    assert.ok(reports.length > 2);
    assert.ok(reports.every((body) => body.length <= 60_000));
    assert.match(
      reports.join("\n"),
      /LAST_DIFF_EVIDENCE password=\[REDACTED\]/,
    );
    assert.doesNotMatch(reports.join("\n"), /fictional-publication-secret/);
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    s.comment();
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "success");
    const fragment = s.facts.comments.find((comment) =>
      comment.body.includes(":evidence:"),
    )!;
    s.facts.comments.splice(s.facts.comments.indexOf(fragment), 1);
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "pending");
    assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
  } finally {
    s.close();
  }
});

test("publication persistence failure prevents any remote effect", async () => {
  const s = publicationFixture();
  let blocker: DatabaseSync | undefined;
  try {
    const run = await s.start();
    s.commit("footer.txt", "Candidate", "Footer");
    s.finish();
    await s.workflow.verifyCandidate();
    blocker = new DatabaseSync(join(s.config.dataDir, "factory.sqlite"));
    blocker.exec("BEGIN IMMEDIATE");
    await assert.rejects(s.workflow.poll(), /Persistence unavailable/);
    assert.equal(s.writes.length, 0);
    assert.equal(s.workflow.view(run.id)?.publication, undefined);
  } finally {
    blocker?.exec("ROLLBACK");
    blocker?.close();
    s.close();
  }
});

test("restart observes an uncertain PR creation but holds intervention without resuming publication", async () => {
  const s = publicationFixture();
  try {
    s.uncertainEffect("pull");
    const run = await s.candidate();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    s.reopen();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.match(s.workflow.view(run.id)!.error!, /reinicio/i);
    assert.equal(
      s.writes.filter((write) => write.kind === "comment").length,
      0,
    );
    assert.equal(s.writes.filter((write) => write.kind === "pull").length, 1);
    assert.equal(s.writes.filter((write) => write.kind === "push").length, 1);
  } finally {
    s.close();
  }
});

test("an accepted merge preserves its accepted head and integration SHA across repeated observations", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    s.merge();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)!.status, "checking_production");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)!.status, "checking_production");
    assert.equal(
      s.workflow.view(run.id)?.publication?.mergeSha,
      "a".repeat(40),
    );
  } finally {
    s.close();
  }
});

test("an edited or deleted report invalidates acceptance and local stop revokes the merge check", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "success");
    s.facts.comments[0].body = "Report evidence removed";
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
    assert.equal(s.facts.status?.state, "pending");
    s.comment();
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "success");
    await s.workflow.stop(run.id);
    assert.equal(s.facts.status?.state, "failure");
    assert.equal(s.workflow.view(run.id)?.status, "stopped");
  } finally {
    s.close();
  }
});

test("early, ambiguous, edited, unauthorized, own and obsolete instructions never accept the result", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    s.comment(); // Before the report.
    await s.workflow.poll();
    const report = s.workflow.view(run.id)!.publication!.report!;
    s.comment("Acepto esta versión");
    s.comment("¿Acepto esta versión?");
    s.comment("No acepto esta versión");
    s.comment(
      `Acepto la versión ${"a".repeat(40)} y su preview ${report.preview}.`,
    );
    s.comment(undefined, { updatedAt: Date.now() + 1_000_000 });
    s.comment(
      `<!-- app-foundry:forged-origin -->\nAcepto la versión ${s.facts.pull!.head} y su preview ${report.preview}.`,
    );
    s.comment(undefined, { human: false });
    s.writer(false);
    const denied = s.comment();
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "pending");
    assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
    assert.match(
      s.workflow
        .view(run.id)!
        .publication!.consumed.find((entry) => entry.id === denied.id)!.reason,
      /Permiso/,
    );
    assert.equal(
      s.writes.filter((write) =>
        write.body?.includes("La referencia no identifica"),
      ).length,
      1,
    );
    // Editing a consumed comment never creates a fresh instruction.
    s.writer(true);
    denied.body = `Acepto la versión ${s.facts.pull!.head} y su preview ${report.preview}.`;
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "pending");
    s.comment();
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "success");
  } finally {
    s.close();
  }
});

test("a preview must identify the exact head, environment, repository, project and served version", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    const good = structuredClone(s.facts.preview!);
    for (const invalid of [
      { head: "a".repeat(40) },
      { servedHead: "a".repeat(40) },
      { environment: "Production" },
      { repository: "wrong/repository" },
      { projectId: "wrong" },
      { access: "protected" as const },
      { state: "inactive" as const },
      { state: "failure" as const },
    ]) {
      s.facts.preview = { ...good, ...invalid };
      await s.workflow.poll();
      assert.equal(
        s.workflow.view(run.id)?.publication?.report,
        undefined,
        JSON.stringify(invalid),
      );
      assert.notEqual(s.facts.status?.state, "success");
    }
    s.facts.preview = good;
    await s.workflow.poll();
    assert.ok(s.workflow.view(run.id)?.publication?.report);
    s.observationFails(true);
    await s.workflow.poll();
    assert.match(
      s.workflow.view(run.id)!.publication!.observationError!,
      /GitHub unavailable/,
    );
    assert.equal(
      s.workflow.view(run.id)?.publication?.preview?.state,
      "success",
    );
  } finally {
    s.close();
  }
});

test("a lost remote confirmation is reconciled without duplicate push, PR, report or status", async () => {
  for (const effect of ["push", "pull", "comment", "status"]) {
    const s = publicationFixture();
    try {
      s.uncertainEffect(effect);
      const run = await s.candidate();
      await s.workflow.poll();
      await s.workflow.poll();
      assert.equal(s.workflow.view(run.id)?.status, "awaiting_review", effect);
      assert.equal(
        s.writes.filter((write) => write.kind === "push").length,
        1,
        effect,
      );
      assert.equal(
        s.writes.filter((write) => write.kind === "pull").length,
        1,
        effect,
      );
      assert.equal(
        s.writes.filter((write) => write.kind === "comment").length,
        1,
        effect,
      );
      assert.equal(
        s.writes.filter((write) => write.kind === "pending").length,
        1,
        effect,
      );
    } finally {
      s.close();
    }
  }
});

test("a new head invalidates acceptance and requires a new complete verification, preview and report", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    const original = s.facts.pull!.head;
    s.commit("second.txt", "New candidate", "New version");
    const head = s.git("rev-parse", "HEAD");
    s.facts.pull!.head = head;
    s.facts.remoteHead = head;
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_verification");
    assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
    assert.equal(s.workflow.view(run.id)?.publication?.report, undefined);
    assert.equal(s.facts.status?.head, head);
    assert.equal(s.facts.status?.state, "pending");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.verification?.headSha, head);
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_preview");
    s.facts.preview = {
      ...s.facts.preview!,
      head,
      servedHead: head,
      id: "deployment-2",
      url: "https://catalogue-next.vercel.app",
    };
    await s.workflow.poll();
    s.comment(
      `Acepto la versión ${original} y su preview https://catalogue-unique.vercel.app.`,
    );
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "pending");
    s.comment();
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "success");
  } finally {
    s.close();
  }
});

test("a changed request, revoked permission or correction revokes favorable merge status", async () => {
  for (const change of ["request", "permission", "correction"]) {
    const s = publicationFixture();
    try {
      const run = await s.candidate();
      await s.workflow.poll();
      s.comment();
      await s.workflow.poll();
      assert.equal(s.facts.status?.state, "success");
      if (change === "request") s.facts.request.body += "Changed criteria";
      if (change === "permission") s.writer(false);
      if (change === "correction")
        s.comment("Corrige el pie antes de integrar.");
      await s.workflow.poll();
      assert.notEqual(s.facts.status?.state, "success");
      assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
    } finally {
      s.close();
    }
  }
});

test("the Workflow publishes a verified candidate and only enables human merge after a later acceptance of its SHA and preview", async () => {
  const writes: string[] = [];
  const facts: PublicationFacts = {
    request: {
      title: "Accessible catalogue",
      body: "## Acceptance criteria\n- Keep keyboard navigation.\n- Show the catalogue.",
      open: true,
    },
    remoteHead: null,
    pull: null,
    comments: [],
    preview: null,
    status: null,
  };
  const port: PublicationPort = {
    async inspect() {
      return structuredClone(facts);
    },
    async push(context) {
      writes.push("push");
      facts.remoteHead = context.head;
    },
    async openPull(context) {
      writes.push("pull");
      facts.pull = {
        number: 2,
        url: `https://github.com/${context.repository}/pull/2`,
        head: context.head,
        base: "main",
        open: true,
        merged: false,
      };
      return facts.pull;
    },
    async comment(context, body) {
      writes.push("report");
      const comment = {
        id: "report-1",
        url: `${facts.pull!.url}#issuecomment-1`,
        body,
        author: "shared",
        human: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: "pull" as const,
      };
      facts.comments.push(comment);
      return comment;
    },
    async status(context, state) {
      writes.push(state);
      facts.status = { head: context.head, state };
    },
    async canWrite() {
      return true;
    },
    async prepareHead() {
      throw new Error("No new head");
    },
  };
  const s = verificationFixture({ publication: port });
  try {
    const run = await s.start();
    s.commit("footer.txt", "Candidate footer", "Add footer");
    s.finish();
    await s.workflow.poll();
    const head = s.git("rev-parse", "HEAD");
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_preview");
    assert.deepEqual(writes, ["push", "pull", "pending"]);
    facts.preview = {
      id: "deployment-1",
      head,
      repository: s.project.repository,
      projectId: "catalogue",
      environment: "Preview",
      state: "success",
      url: "https://catalogue-unique.vercel.app",
      access: "verified",
      servedHead: head,
    };
    await s.workflow.poll();
    const reported = s.workflow.view(run.id)!;
    assert.equal(reported.status, "awaiting_review");
    assert.match(facts.comments[0].body, /Candidate footer/);
    assert.match(facts.comments[0].body, /Keep keyboard navigation/);
    assert.match(facts.comments[0].body, /Juicio humano pendiente/);
    facts.comments.push({
      id: "human-1",
      url: "https://github.com/example/comment/2",
      body: `Acepto la versión ${head} y su preview ${facts.preview.url}.`,
      author: "shared",
      human: true,
      createdAt: facts.comments[0].createdAt + 1000,
      updatedAt: facts.comments[0].createdAt + 1000,
      source: "issue",
    });
    await s.workflow.poll();
    const accepted = s.workflow.view(run.id)!;
    assert.equal(accepted.status, "awaiting_merge");
    assert.equal(accepted.publication?.acceptance?.head, head);
    assert.equal(facts.status?.state, "success");
    await s.workflow.poll();
    assert.equal(writes.filter((write) => write === "report").length, 1);
    assert.equal(writes.filter((write) => write === "success").length, 1);
    s.reopen();
    assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
    assert.equal(
      s.workflow.view(run.id)?.publication?.acceptances.at(-1)?.head,
      head,
    );
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.equal(facts.status?.state, "pending");
    assert.equal(writes.filter((write) => write === "success").length, 1);
  } finally {
    s.close();
  }
});

test("an accepted squash merge waits for production, persists public evidence before issue closure and survives restart as completed", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    const candidate = s.facts.pull!.head;
    s.merge();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "checking_production");
    assert.equal(
      s.workflow.view(run.id)?.publication?.mergeSha,
      "a".repeat(40),
    );
    assert.equal(
      s.workflow.view(run.id)?.publication?.integratedAcceptance?.head,
      candidate,
    );
    assert.equal(
      s.writes.some((write) => write.kind === "close-issue"),
      false,
    );
    s.productionReady();
    await s.workflow.poll();
    const completed = s.workflow.view(run.id)!;
    assert.equal(completed.status, "completed");
    assert.equal(completed.publication?.production?.servedHead, "a".repeat(40));
    assert.ok(completed.publication?.production?.report?.url);
    assert.ok(
      s.workflow.output(
        run.id,
        completed.publication!.production!.evidencePartId!,
      ),
    );
    assert.equal(s.workflow.factory.active, null);
    assert.equal(
      s.writes.filter((write) => write.kind === "close-issue").length,
      1,
    );
    s.reopen();
    assert.equal(s.workflow.view(run.id)?.status, "completed");
    assert.equal(s.workflow.factory.active, null);
  } finally {
    s.close();
  }
});

test("production failure keeps public evidence and the issue open; later polling cannot silently resume", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    s.merge();
    s.productionReady();
    s.publicFailure(true);
    await s.workflow.poll();
    const failed = s.workflow.view(run.id)!;
    assert.equal(failed.status, "intervention");
    assert.ok(failed.publication?.production?.evidencePartId);
    assert.match(
      s.workflow.output(
        run.id,
        failed.publication!.production!.evidencePartId!,
      )!,
      /Wrong page/,
    );
    assert.equal(s.facts.request.open, true);
    s.publicFailure(false);
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.equal(
      s.writes.some((write) => write.kind === "close-issue"),
      false,
    );
  } finally {
    s.close();
  }
});

test("merge without current human acceptance is an incident even when the issue was manually closed", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.merge();
    s.productionReady();
    s.facts.request.open = false;
    await s.workflow.poll();
    const observed = s.workflow.view(run.id)!;
    assert.equal(observed.status, "intervention");
    assert.equal(observed.publication?.mergeSha, "a".repeat(40));
    assert.match(observed.error!, /Incidencia/);
    assert.equal(observed.publication?.integratedAcceptance, undefined);
    assert.equal(observed.publication?.production, undefined);
  } finally {
    s.close();
  }
});

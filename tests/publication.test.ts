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

test("los informes extensos publican el diff acumulado completo y las salidas saneadas en comentarios acotados", async () => {
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

test("un fallo al guardar la publicación impide cualquier efecto remoto", async () => {
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

test("tras reiniciar, se detecta una creación de PR incierta y se mantiene la intervención sin reanudar la publicación", async () => {
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

test("una integración aceptada conserva su commit aceptado y el SHA integrado en observaciones repetidas", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    s.merge();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)!.status, "completed");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)!.status, "completed");
    assert.equal(
      s.workflow.view(run.id)?.publication?.mergeSha,
      "a".repeat(40),
    );
  } finally {
    s.close();
  }
});

test("editar o borrar el informe invalida la aceptación y detener localmente revoca la comprobación de integración", async () => {
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

test("las instrucciones tempranas, ambiguas, editadas, no autorizadas, propias u obsoletas nunca aceptan el resultado", async () => {
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
    // Editar un comentario ya consumido nunca crea una instrucción nueva.
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

test("la vista previa debe identificar el commit, entorno, repositorio, proyecto y versión servida exactos", async () => {
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

test("una confirmación remota perdida se concilia sin duplicar el envío, la PR, el informe ni el estado", async () => {
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

test("un commit nuevo invalida la aceptación y requiere una verificación, una vista previa y un informe completos nuevos", async () => {
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

test("una petición modificada, un permiso revocado o una corrección revocan el estado favorable de integración", async () => {
  for (const change of ["request", "permission", "correction"]) {
    const s = publicationFixture();
    try {
      const run = await s.candidate();
      await s.workflow.poll();
      s.comment();
      await s.workflow.poll();
      assert.equal(s.facts.status?.state, "success");
      if (change === "request") {
        s.facts.request.body += "Changed criteria";
      }
      if (change === "permission") {
        s.writer(false);
      }
      if (change === "correction") {
        s.comment("Corrige el pie antes de integrar.");
      }
      await s.workflow.poll();
      assert.notEqual(s.facts.status?.state, "success");
      assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
    } finally {
      s.close();
    }
  }
});

test("el Workflow publica un Commit candidato verificado y solo permite la integración humana tras aceptar después su SHA y su vista previa", async () => {
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
    async commentIssue() {
      throw new Error("No integration expected");
    },
    async closeIssue() {
      throw new Error("No integration expected");
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

test("un issue en lenguaje natural completa la integración squash, publica el resumen y sigue completado tras reiniciar", async () => {
  const body =
    "Quiero mostrar el catálogo y conservar la navegación con teclado. El catálogo debe ser visible y se debe poder recorrer sin ratón.";
  const s = publicationFixture({ body });
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.request?.body, body);
    assert.equal(s.workflow.view(run.id)?.verification?.criteria[0].text, body);
    s.comment();
    await s.workflow.poll();
    const candidate = s.facts.pull!.head;
    s.merge();
    await s.workflow.poll();
    const completed = s.workflow.view(run.id)!;
    assert.equal(completed.status, "completed");
    assert.equal(completed.publication?.mergeSha, "a".repeat(40));
    assert.equal(completed.publication?.integratedAcceptance?.head, candidate);
    assert.ok(completed.publication?.integrationReport?.url);
    assert.ok(completed.publication?.closedAt);
    const report = s.facts.comments.find(
      (comment) => comment.id === completed.publication?.integrationReport?.id,
    )!;
    assert.equal(report.source, "issue");
    assert.match(report.body, /Integración completada/);
    assert.match(report.body, new RegExp(`Candidato aceptado: ${candidate}`));
    assert.match(report.body, /Commit integrado: a{40}/);
    assert.equal(s.facts.request.open, false);
    assert.equal(s.workflow.factory.active, null);
    assert.equal(
      s.writes.filter((write) => write.kind === "close-issue").length,
      1,
    );
    await s.workflow.poll();
    s.reopen();
    assert.equal(s.workflow.view(run.id)?.status, "completed");
    assert.equal(s.workflow.factory.active, null);
  } finally {
    s.close();
  }
});

test("integrar sin una aceptación humana vigente es un incidente, aunque el issue se haya cerrado manualmente", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.merge();
    s.facts.request.open = false;
    await s.workflow.poll();
    const observed = s.workflow.view(run.id)!;
    assert.equal(observed.status, "intervention");
    assert.equal(observed.publication?.mergeSha, "a".repeat(40));
    assert.match(observed.error!, /Incidencia/);
    assert.equal(observed.publication?.integratedAcceptance, undefined);
    assert.equal(observed.publication?.integrationReport, undefined);
  } finally {
    s.close();
  }
});

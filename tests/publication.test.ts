import { test } from "node:test";
import assert from "node:assert/strict";
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
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "success");
    const fragment = s.facts.comments.find((comment) =>
      comment.body.includes(":evidence:"),
    )!;
    s.facts.comments.splice(s.facts.comments.indexOf(fragment), 1);
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "success");
    assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
  } finally {
    s.close();
  }
});

test("los cambios informativos en controles permiten publicar y completar el resultado aceptado", async () => {
  const s = publicationFixture();
  try {
    const run = await s.start();
    s.commit(
      "package.json",
      '{"private":true}',
      "Update product configuration",
    );
    s.finish();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_preview");
    assert.ok(s.workflow.view(run.id)?.verification?.controls.length);
    assert.equal(s.writes.filter((write) => write.kind === "push").length, 1);
    const head = s.git("rev-parse", "HEAD");
    s.facts.preview = {
      id: "deployment-controls",
      head,
      repository: s.project.repository,
      projectId: "catalogue",
      environment: "Preview",
      state: "success",
      url: "https://catalogue-controls.vercel.app",
      access: "verified",
      servedHead: head,
    };
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    const report = s.writes
      .filter((write) => write.kind === "comment")
      .map((write) => write.body)
      .join("\n");
    assert.match(report, /Cambios en controles.*informativos/i);
    assert.match(report, /package.json/);
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    s.merge();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "completed");
    assert.equal(s.facts.request.open, false);
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
    await assert.rejects(s.workflow.poll(), /persistencia no está disponible/);
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

test("editar el informe exige republicarlo y detener revoca el control de merge", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "success");
    const original = s.workflow.view(run.id)!.publication!.report!;
    s.facts.comments.find((comment) => comment.id === original.id)!.body =
      "Removed";
    await s.workflow.poll();
    assert.notEqual(
      s.workflow.view(run.id)?.publication?.report?.id,
      original.id,
    );
    assert.equal(s.facts.status?.state, "success");
    assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
    await s.workflow.stop(run.id);
    assert.equal(s.facts.status?.state, "failure");
    assert.equal(s.workflow.view(run.id)?.status, "stopped");
  } finally {
    s.close();
  }
});

test("los comentarios de aceptación ya no aceptan ni exigen fórmulas técnicas", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    for (const body of [
      "Acepto",
      "¿Acepto esta versión?",
      "No acepto esta versión",
      "I accept version " + "a".repeat(40),
    ]) {
      s.comment(body);
    }
    s.comment(undefined, { human: false });
    s.comment(undefined, {
      author: "outsider",
      updatedAt: Date.now() + 1_000_000,
    });
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "success");
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
    assert.equal(
      s.writes.filter((write) =>
        write.body?.includes("La referencia no identifica"),
      ).length,
      0,
    );
    assert.doesNotMatch(
      s.workflow.view(run.id)!.publication!.report!.url,
      /SHA_COMPLETO/,
    );
    s.merge();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "completed");
    assert.equal(
      s.workflow.view(run.id)?.publication?.acceptance?.author,
      "maintainer",
    );
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
    assert.equal(s.facts.status?.state, "success");
  } finally {
    s.close();
  }
});

test("editar el issue conserva el encargo capturado y permite aceptar solo mediante merge", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    const captured = run.request!.body;
    s.issue.title = "Otro título";
    s.issue.body = "Otros criterios";
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    assert.equal(s.facts.status?.state, "success");
    assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
    assert.equal(s.workflow.view(run.id)?.request?.body, captured);
    s.merge();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "completed");
  } finally {
    s.close();
  }
});

test("una corrección autorizada revoca el control favorable de merge", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "success");
    s.comment("Corrige el pie antes de integrar.");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.notEqual(s.facts.status?.state, "success");
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
    await s.workflow.poll();
    const candidate = s.facts.pull!.head;
    s.merge();
    await s.workflow.poll();
    const completed = s.workflow.view(run.id)!;
    assert.equal(completed.status, "completed");
    assert.equal(completed.publication?.mergeSha, "a".repeat(40));
    assert.equal(completed.publication?.acceptance?.head, candidate);
    assert.ok(completed.publication?.integrationReport?.url);
    assert.ok(completed.publication?.closedAt);
    const report = s.facts.comments.find(
      (comment) => comment.id === completed.publication?.integrationReport?.id,
    )!;
    assert.equal(report.source, "issue");
    assert.match(report.body, /El código de este issue se ha integrado/);
    assert.ok(report.body.includes(s.facts.pull!.url));
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

test("integrar sin control técnico favorable es un incidente, aunque el issue se haya cerrado manualmente", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.facts.status = { head: s.facts.pull!.head, state: "pending" };
    s.merge();
    s.facts.request.open = false;
    await s.workflow.poll();
    const observed = s.workflow.view(run.id)!;
    assert.equal(observed.status, "intervention");
    assert.equal(observed.publication?.mergeSha, "a".repeat(40));
    assert.match(observed.error!, /Incidencia/);
    assert.equal(observed.publication?.acceptance, undefined);
    assert.equal(observed.publication?.integrationReport, undefined);
  } finally {
    s.close();
  }
});

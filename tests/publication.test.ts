import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publicationFixture,
  catalogueDelivery,
} from "./support/publication.ts";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

test("la PR abre con una descripción funcional y la evidencia técnica extensa permanece saneada en el Dashboard", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate(
      "Full diff\n" +
        "x".repeat(80_000) +
        "\nLAST_DIFF_EVIDENCE password=fictional-publication-secret",
    );
    // La descripción ya está disponible antes de observar la preview.
    assert.equal(s.description.title, catalogueDelivery.split("\n")[0]);
    assert.match(s.description.body, /## Resumen/);
    assert.match(s.description.body, /## Evidencia/);
    assert.match(s.description.body, /## Riesgo de fusión/);
    assert.ok(s.description.body.includes(run.request!.url));
    assert.doesNotMatch(s.description.body, /LAST_DIFF_EVIDENCE/);
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_preview");
    await s.workflow.poll();
    const verified = s.workflow.view(run.id)!.verification!;
    const diff = s.workflow.factory.output(run.id, verified.diffPartId)!;
    assert.match(diff, /LAST_DIFF_EVIDENCE password=\[REDACTED\]/);
    assert.doesNotMatch(diff, /fictional-publication-secret/);
    assert.equal(s.facts.comments.filter((c) => c.source === "pull").length, 0);
    assert.equal(
      s.facts.comments.filter((c) => c.source === "issue").length,
      1,
    );
    assert.equal(s.facts.status?.state, "success");
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
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
    assert.ok(
      s.workflow
        .view(run.id)!
        .verification!.controls.some((control) =>
          control.includes("package.json"),
        ),
    );
    assert.equal(s.facts.comments.filter((c) => c.source === "pull").length, 0);
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

test("la publicación no añade una validación editorial ni bloquea una respuesta sin secciones", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate("Footer", "Entrega pendiente de describir");
    await s.workflow.poll();
    assert.equal(s.description.title, "Entrega pendiente de describir");
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    assert.equal(s.facts.status?.state, "success");
  } finally {
    s.close();
  }
});

test("una actualización incierta de la descripción se puede repetir sin duplicar PR ni avisos", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    // Otra versión verificada en la misma rama exige actualizar la misma PR.
    s.commit("next.txt", "Next delivery", "Next candidate");
    const head = s.git("rev-parse", "HEAD");
    s.facts.remoteHead = head;
    s.facts.pull!.head = head;
    await s.workflow.poll();
    s.uncertainEffect("description");
    s.facts.preview = {
      ...s.facts.preview!,
      head,
      servedHead: head,
      id: "next-deployment",
    };
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.notEqual(s.facts.status?.state, "success");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    assert.equal(s.writes.filter((w) => w.kind === "pull").length, 1);
    assert.equal(s.facts.comments.filter((c) => c.source === "pull").length, 0);
    assert.equal(
      s.facts.comments.filter((c) => c.body.includes("listo para validar"))
        .length,
      2,
    );
    const writes = s.writes.length;
    await s.workflow.poll();
    assert.equal(s.writes.length, writes);
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

test("editar la descripción conserva el estado y permite completar el merge; detener sigue revocando el control", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    const original = s.workflow.view(run.id)!.publication!.report!;
    s.description.title = "Título corregido por una persona";
    s.description.body = "Corrección editorial";
    const writes = s.writes.length;
    await s.workflow.poll();
    assert.equal(s.description.body, "Corrección editorial");
    assert.equal(s.writes.length, writes);
    assert.deepEqual(s.workflow.view(run.id)!.publication!.report, original);
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    assert.equal(s.facts.status?.state, "success");
    s.merge();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "completed");
    assert.equal(s.facts.request.open, false);
  } finally {
    s.close();
  }
  const stopped = publicationFixture();
  try {
    const run = await stopped.candidate();
    await stopped.workflow.poll();
    await stopped.workflow.stop(run.id);
    assert.equal(stopped.facts.status?.state, "failure");
    assert.equal(stopped.workflow.view(run.id)?.status, "stopped");
  } finally {
    stopped.close();
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

test("una confirmación remota perdida se concilia sin duplicar el envío, la PR, los avisos ni el estado", async () => {
  for (const effect of ["push", "pull", "status"]) {
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
        0,
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

test("un commit nuevo invalida la aceptación y requiere una verificación, una vista previa y un registro de revisión nuevos", async () => {
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
    s.facts.status = {
      head: s.facts.pull!.head,
      state: "pending",
      at: Date.now(),
    };
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

test("perder la respuesta del aviso de preview no duplica comentarios ni repite el desarrollo", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    s.uncertainEffect("review-notice");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.notEqual(s.facts.status?.state, "success");
    const reviewNotices = () =>
      s.facts.comments.filter(
        (comment) =>
          comment.source === "issue" &&
          comment.body.includes("listo para validar"),
      );
    assert.equal(reviewNotices().length, 1);
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    assert.equal(s.facts.status?.state, "success");
    assert.equal(reviewNotices().length, 1);
    assert.equal(s.sessions, 1);
    assert.equal(s.writes.filter((write) => write.kind === "push").length, 1);
    assert.equal(s.writes.filter((write) => write.kind === "pull").length, 1);
  } finally {
    s.close();
  }
});

test("la revisión estable no repite inspecciones para efectos de publicación ya observados", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    const before = s.inspections;
    const writes = s.writes.length;
    await s.workflow.poll();
    assert.ok(
      s.inspections - before <= 3,
      `Inspecciones: ${s.inspections - before}`,
    );
    assert.equal(s.writes.length, writes);
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
  } finally {
    s.close();
  }
});

test("una nueva versión revisable publica otro aviso con su preview vigente", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.commit("second.txt", "Second candidate", "Second delivery");
    const head = s.git("rev-parse", "HEAD");
    s.facts.remoteHead = head;
    s.facts.pull!.head = head;
    await s.workflow.poll();
    await s.workflow.poll();
    const notices = () =>
      s.facts.comments.filter(
        (comment) =>
          comment.source === "issue" &&
          comment.body.includes("listo para validar"),
      );
    assert.equal(notices().length, 1);
    s.facts.preview = {
      ...s.facts.preview!,
      head,
      servedHead: head,
      id: "deployment-2",
      url: "https://second-preview.vercel.app",
    };
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    assert.equal(notices().length, 2);
    assert.ok(
      notices().at(-1)!.body.includes("https://second-preview.vercel.app"),
    );
    assert.ok(!notices().at(-1)!.body.includes(head));
    await s.workflow.poll();
    assert.equal(notices().length, 2);
  } finally {
    s.close();
  }
});

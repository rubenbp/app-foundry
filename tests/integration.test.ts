import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { publicationFixture } from "./support/publication.ts";

test("una corrección no autorizada antes de integrar no puede invalidar una integración aceptada por una persona", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    s.comment("Corrige el catálogo.", { author: "outsider" });
    s.merge();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "completed");
  } finally {
    s.close();
  }
});

for (const inspection of [2, 3, 4, 5, 6, 7]) {
  test(`una integración humana durante la observación ${inspection} de la publicación conserva la aceptación y completa el cierre del issue`, async () => {
    const s = publicationFixture();
    try {
      const run = await s.candidate();
      await s.workflow.poll();
      s.comment();
      await s.workflow.poll();
      const before = s.inspections;
      const writes = s.writes.length;
      s.onInspect((count) => {
        if (count === before + inspection) {
          s.merge();
        }
      });
      await s.workflow.poll();
      assert.equal(
        s.workflow.view(run.id)?.status,
        "completed",
        s.workflow.view(run.id)?.error ?? "",
      );
      assert.ok(s.workflow.view(run.id)?.publication?.integratedAcceptance);
      assert.equal(
        s.writes
          .slice(writes)
          .some((write) =>
            ["pending", "failure", "error", "success"].includes(write.kind),
          ),
        false,
        "no post-merge status revocation",
      );
    } finally {
      s.close();
    }
  });
}

test("una PR abierta obsoleta con una vista previa retirada no puede borrar la aceptación antes de observar la integración", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    const before = s.inspections;
    const writes = s.writes.length;
    s.onInspect((count) => {
      if (count === before + 4) {
        const stale = structuredClone(s.facts);
        s.merge();
        return { ...stale, preview: null };
      }
    });
    await s.workflow.poll();
    assert.equal(
      s.workflow.view(run.id)?.status,
      "completed",
      s.workflow.view(run.id)?.error ?? "",
    );
    assert.ok(s.workflow.view(run.id)?.publication?.integratedAcceptance);
    assert.equal(
      s.writes
        .slice(writes)
        .some((write) =>
          ["pending", "failure", "error", "success"].includes(write.kind),
        ),
      false,
    );
  } finally {
    s.close();
  }
});

test("tras observar una integración, la recuperación omite cambios de estado sin confirmar una revocación ni reanudar", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    s.merge();
    const before = s.workflow.view(run.id)!.publication!.operations;
    const writes = s.writes.length;
    s.reopen();
    await s.workflow.poll();
    const current = s.workflow.view(run.id)!;
    assert.equal(current.status, "intervention");
    assert.equal(current.publication?.integratedAcceptance, undefined);
    assert.equal(s.facts.status?.state, "success");
    assert.deepEqual(current.publication?.operations, before);
    assert.equal(s.writes.length, writes);
    assert.ok(current.history.some((entry) => entry.kind === "status-skipped"));
  } finally {
    s.close();
  }
});

test("una revocación registrada tras una integración concurrente conserva el informe aceptado histórico", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    const before = s.inspections;
    s.onInspect((count) => {
      if (count === before + 4) {
        return { ...structuredClone(s.facts), preview: null };
      }
      if (count === before + 5) {
        const stale = structuredClone(s.facts);
        s.merge();
        return stale;
      }
    });
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "pending");
    assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
    await s.workflow.poll();
    assert.equal(
      s.workflow.view(run.id)?.status,
      "completed",
      s.workflow.view(run.id)?.error ?? "",
    );
    assert.ok(s.workflow.view(run.id)?.publication?.integratedAcceptance);
    assert.ok(s.workflow.view(run.id)?.publication?.report);
  } finally {
    s.close();
  }
});

test("una aceptación histórica no puede reanudar una intervención operativa sin resolver tras una integración posterior", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    s.observationFails(true);
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    s.observationFails(false);
    s.merge();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.equal(
      s.workflow.view(run.id)?.publication?.integratedAcceptance,
      undefined,
    );
    assert.equal(s.facts.request.open, true);
    assert.equal(
      s.writes.some((write) => write.kind === "close-issue"),
      false,
    );
  } finally {
    s.close();
  }
});

test("un issue cerrado manualmente tras el merge conserva su resumen y completa sin repetir el cierre", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    s.merge();
    s.facts.request.open = false;
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "completed");
    assert.ok(s.workflow.view(run.id)?.publication?.integrationReport);
    assert.equal(
      s.writes.some((write) => write.kind === "close-issue"),
      false,
    );
  } finally {
    s.close();
  }
});

for (const effect of ["integration-report", "close-issue"]) {
  test(`perder la respuesta de ${effect} conserva el puesto hasta conciliar el cierre sin duplicar efectos`, async () => {
    const s = publicationFixture();
    try {
      const run = await s.candidate();
      await s.workflow.poll();
      s.comment();
      await s.workflow.poll();
      s.merge();
      s.uncertainEffect(effect);
      await s.workflow.poll();
      assert.equal(s.workflow.view(run.id)?.status, "intervention");
      assert.equal(s.workflow.factory.active, run.id);
      assert.equal(s.workflow.view(run.id)?.endedAt, null);
      await s.workflow.poll();
      assert.equal(s.workflow.view(run.id)?.status, "completed");
      assert.equal(s.workflow.factory.active, null);
      assert.equal(
        s.facts.comments.filter(
          (comment) =>
            comment.source === "issue" &&
            comment.body.includes("## Integración completada"),
        ).length,
        1,
      );
      assert.equal(
        s.writes.filter((write) => write.kind === "close-issue").length,
        1,
      );
    } finally {
      s.close();
    }
  });
}

test("editar el issue entre el resumen y el cierre conserva el encargo y permite completar la Ejecución", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    s.merge();
    s.onInspect(() => {
      if (s.workflow.view(run.id)?.publication?.integrationReport) {
        s.issue.title = "Otro título";
        s.issue.body = "Un objetivo diferente.";
      }
    });
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "completed");
    assert.ok(s.workflow.view(run.id)?.publication?.integrationReport);
    assert.equal(s.workflow.view(run.id)?.request?.body, run.request?.body);
    assert.equal(s.facts.request.open, false);
    assert.equal(s.workflow.factory.active, null);
    assert.equal(
      s.writes.some((write) => write.kind === "close-issue"),
      true,
    );
  } finally {
    s.close();
  }
});

test("un registro anterior pendiente de producción se lee como cierre pendiente y conserva la intervención tras reiniciar", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    s.merge();
    s.uncertainEffect("close-issue");
    await s.workflow.poll();
    const current = s.workflow.view(run.id)!;
    const legacy = {
      ...current,
      status: "checking_production",
      publication: {
        ...current.publication,
        production: { status: "pending", observations: [] },
      },
    };
    const db = new DatabaseSync(join(s.config.dataDir, "factory.sqlite"));
    try {
      db.prepare("UPDATE runs SET body = ? WHERE id = ?").run(
        JSON.stringify(legacy),
        run.id,
      );
    } finally {
      db.close();
    }
    assert.equal(s.workflow.view(run.id)?.status, "closing_issue");
    assert.deepEqual(
      s.workflow.view(run.id)?.publication?.integratedAcceptance,
      current.publication?.integratedAcceptance,
    );
    const writes = s.writes.length;
    s.reopen();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.equal(s.writes.length, writes);
    assert.equal(s.workflow.factory.active, run.id);
  } finally {
    s.close();
  }
});

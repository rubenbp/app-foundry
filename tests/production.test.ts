import { test } from "node:test";
import assert from "node:assert/strict";
import { publicationFixture } from "./support/publication.ts";

for (const invalid of [
  "head",
  "repository",
  "projectId",
  "environment",
  "failure",
  "query",
  "marker",
  "coverage",
] as const) {
  test(`una incertidumbre de producción (${({ head: "commit", repository: "repositorio", projectId: "identificador del proyecto", environment: "entorno", failure: "fallo", query: "consulta", marker: "marcador", coverage: "cobertura" } as const)[invalid]}) no puede cerrar el issue ni acreditar la finalización`, async () => {
    const s = publicationFixture();
    try {
      const run = await s.candidate();
      await s.workflow.poll();
      s.comment();
      await s.workflow.poll();
      s.merge();
      s.productionReady();
      s.productionFault(invalid);
      await s.workflow.poll();
      const current = s.workflow.view(run.id)!;
      assert.equal(current.status, "intervention", invalid);
      assert.equal(current.publication?.production?.status, "intervention");
      assert.equal(s.facts.request.open, true);
      assert.equal(
        s.writes.some((write) => write.kind === "close-issue"),
        false,
      );
      if (invalid === "query") {
        assert.equal(current.publication?.production?.observations.length, 0);
        assert.match(current.error!, /observation unavailable/);
      }
      if (invalid === "marker" || invalid === "coverage") {
        assert.ok(
          current.parts.some(
            (part) =>
              part.id === current.publication?.production?.evidencePartId,
          ),
        );
      }
    } finally {
      s.close();
    }
  });
}

test("una Petición cerrada manualmente sigue requiriendo todas las pruebas de producción", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    s.merge();
    s.facts.request.open = false;
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "checking_production");
    assert.equal(s.workflow.factory.active, run.id);
    s.productionReady();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "completed");
    assert.ok(s.workflow.view(run.id)?.publication?.production?.report);
  } finally {
    s.close();
  }
});

test("una corrección no autorizada antes de integrar no puede invalidar una integración aceptada por una persona", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    s.comment("Corrige el catálogo.", { author: "outsider" });
    s.merge();
    s.productionReady();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "completed");
  } finally {
    s.close();
  }
});

for (const inspection of [2, 3, 4, 5, 6, 7]) {
  test(`una integración humana durante la observación ${inspection} de la publicación conserva la aceptación y llega a producción`, async () => {
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
        "checking_production",
        s.workflow.view(run.id)?.error ?? "",
      );
      assert.ok(s.workflow.view(run.id)?.publication?.integratedAcceptance);
      assert.equal(s.writes.length, writes, "no post-merge status revocation");
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
      "checking_production",
      s.workflow.view(run.id)?.error ?? "",
    );
    assert.ok(s.workflow.view(run.id)?.publication?.integratedAcceptance);
    assert.equal(s.writes.length, writes);
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
      "checking_production",
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
    s.productionReady();
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

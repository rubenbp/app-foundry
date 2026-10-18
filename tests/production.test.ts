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
]) {
  test(`production ${invalid} uncertainty cannot close the issue or accredit completion`, async () => {
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
      if (invalid === "marker" || invalid === "coverage")
        assert.ok(
          current.parts.some(
            (part) =>
              part.id === current.publication?.production?.evidencePartId,
          ),
        );
    } finally {
      s.close();
    }
  });
}

test("a manually closed request still requires the complete production proof", async () => {
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

test("an unauthorized correction before merge cannot invalidate a human accepted integration", async () => {
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
  test(`a human merge during publication observation ${inspection} preserves acceptance and reaches production`, async () => {
    const s = publicationFixture();
    try {
      const run = await s.candidate();
      await s.workflow.poll();
      s.comment();
      await s.workflow.poll();
      const before = s.inspections;
      const writes = s.writes.length;
      s.onInspect((count) => {
        if (count === before + inspection) s.merge();
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

test("a stale open PR with a retired preview cannot erase acceptance before observing the merge", async () => {
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

test("recovery after an observed merge skips status writes without confirming a revocation or resuming", async () => {
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

test("a revocation written after a concurrent merge preserves the historical accepted report", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.comment();
    await s.workflow.poll();
    const before = s.inspections;
    s.onInspect((count) => {
      if (count === before + 4)
        return { ...structuredClone(s.facts), preview: null };
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

test("historical acceptance cannot resume an unresolved operational intervention after a later merge", async () => {
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

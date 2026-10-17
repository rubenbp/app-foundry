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

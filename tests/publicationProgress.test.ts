import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publicationFixture,
  catalogueDelivery,
} from "./support/publication.ts";

test("los comentarios confirmados conservan cuerpo completo, enlace y saneado al consultar y reiniciar", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate(
      "Footer",
      `${catalogueDelivery}\n\n${"x".repeat(5000)}\nFINAL password=private-progress-secret`,
    );
    await s.workflow.poll();
    const comments = () =>
      s.workflow.view(run.id)!.history.filter((entry) => entry.comment);
    assert.equal(comments().length, 1);
    assert.deepEqual(comments()[0].comment, {
      id: s.facts.comments[0].id,
      url: s.facts.comments[0].url,
      body: s.facts.comments[0].body,
    });
    assert.ok(comments()[0].comment!.body.length > 4096);
    assert.match(comments()[0].comment!.body, /FINAL password=\[REDACTED\]/);
    assert.doesNotMatch(JSON.stringify(comments()), /private-progress-secret/);
    const original = structuredClone(comments()[0]);
    await s.workflow.poll();
    assert.equal(comments().length, 1);
    s.merge();
    await s.workflow.poll();
    assert.equal(comments().length, 2);
    assert.match(comments()[1].comment!.body, /se ha integrado/);
    s.reopen();
    assert.equal(comments().length, 2);
    assert.deepEqual(comments()[0], original);
  } finally {
    s.close();
  }
});

test("una publicación incierta aparece solo al confirmarla y no duplica el comentario ni el registro", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    s.uncertainEffect("review-notice");
    await s.workflow.poll();
    assert.equal(s.facts.comments.length, 1);
    assert.equal(
      s.workflow.view(run.id)!.history.filter((entry) => entry.comment).length,
      0,
    );
    await s.workflow.poll();
    await s.workflow.poll();
    assert.equal(s.facts.comments.length, 1);
    assert.equal(
      s.workflow.view(run.id)!.history.filter((entry) => entry.comment).length,
      1,
    );
  } finally {
    s.close();
  }
});

test("los comentarios antiguos ya confirmados no se recuperan como nuevos envíos", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    const stored = s.workflow.view(run.id)!;
    stored.history = stored.history.filter((entry) => !entry.comment);
    s.workflow.factory.persist(stored);
    const writes = s.writes.length;
    await s.workflow.poll();
    assert.equal(s.writes.length, writes);
    assert.equal(
      s.workflow.view(run.id)!.history.filter((entry) => entry.comment).length,
      0,
    );
  } finally {
    s.close();
  }
});

test("si la política de publicación vuelve a enviar un comentario modificado registra el nuevo envío", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    const original = s.workflow
      .view(run.id)!
      .history.find((entry) => entry.comment)!.comment!;
    s.facts.comments[0].body = "Comentario editado en GitHub";
    await s.workflow.poll();
    const comments = s.workflow
      .view(run.id)!
      .history.filter((entry) => entry.comment);
    assert.equal(comments.length, 2);
    assert.deepEqual(comments[0].comment, original);
    assert.notEqual(comments[1].comment!.id, original.id);
    assert.equal(comments[1].comment!.body, original.body);
  } finally {
    s.close();
  }
});

test("la espera se persiste antes de consultar preview, supera un minuto y solo confirma la versión comprobada", async () => {
  const s = publicationFixture();
  try {
    s.onInspect(() => {
      if (s.facts.pull) {
        const current = s.workflow.view(s.workflow.factory.active!)!;
        assert.ok(
          current.history.some((entry) => entry.kind === "preview-waiting"),
        );
      }
    });
    const run = await s.candidate();
    const wait = s.workflow.view(run.id)!.publication!.previewWait!;
    const events = () =>
      s.workflow
        .view(run.id)!
        .history.filter((entry) => entry.kind.startsWith("preview-"));
    assert.equal(events().length, 1);
    assert.equal(events()[0].kind, "preview-waiting");
    s.workflow.factory.now = () => wait.startedAt + 74_000;
    const preview = structuredClone(s.facts.preview!);
    s.facts.preview!.servedHead = "a".repeat(40);
    await s.workflow.poll();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)!.status, "awaiting_preview");
    assert.equal(events().length, 1);
    s.facts.preview = preview;
    await s.workflow.poll();
    assert.equal(events().length, 2);
    assert.match(events()[1].text, /Preview listo · 74 s/);
    assert.equal(
      s.workflow.view(run.id)!.publication!.previewWait!.state,
      "ready",
    );
    await s.workflow.poll();
    assert.equal(events().length, 2);
  } finally {
    s.close();
  }
});

for (const failure of ["deployment", "observation"] as const) {
  test(`el fallo de ${failure} conserva motivo y duración sin repetir hitos y permite confirmar la recuperación`, async () => {
    const s = publicationFixture();
    try {
      const run = await s.candidate();
      const wait = s.workflow.view(run.id)!.publication!.previewWait!;
      s.workflow.factory.now = () => wait.startedAt + 90_000;
      if (failure === "deployment") {
        s.facts.preview!.state = "failure";
      } else {
        s.observationFails(true);
      }
      await s.workflow.poll();
      await s.workflow.poll();
      const events = () =>
        s.workflow
          .view(run.id)!
          .history.filter((entry) => entry.kind.startsWith("preview-"));
      assert.equal(events().length, 2);
      assert.equal(events()[1].kind, "preview-error");
      assert.match(events()[1].text, /90 s/);
      assert.match(
        events()[1].text,
        failure === "deployment" ? /deployment.*failure/ : /GitHub unavailable/,
      );
      s.observationFails(false);
      s.facts.preview!.state = "success";
      s.workflow.factory.now = () => wait.startedAt + 120_000;
      await s.workflow.poll();
      assert.equal(events().length, 3);
      assert.match(events()[2].text, /Preview listo · 120 s/);
    } finally {
      s.close();
    }
  });
}

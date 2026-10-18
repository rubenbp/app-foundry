import { test } from "node:test";
import assert from "node:assert/strict";
import type { IssueComment } from "../src/domain/intervention.ts";
import type { IssueConversation } from "../src/application/issueConversation.ts";
import { publicationFixture } from "./support/publication.ts";
import { verificationFixture } from "./support/verification.ts";

function conversationFixture() {
  const comments: IssueComment[] = [];
  let posts = 0;
  let loseConfirmation = false;
  const add = (body: string, human = true): IssueComment => {
    const id = String(comments.length + 1);
    const comment = {
      id,
      url: `https://github.com/team/product/issues/1#issuecomment-${id}`,
      body,
      author: "anyone",
      human,
      createdAt: Number(id) * 1000,
    };
    comments.push(comment);
    return comment;
  };
  const port: IssueConversation = {
    async close() {},
    async comments() {
      return structuredClone(comments);
    },
    async comment(_repository, _issue, body) {
      posts++;
      const comment = add(body);
      if (loseConfirmation) {
        loseConfirmation = false;
        throw new Error("Comment published but response lost");
      }
      return comment;
    },
  };

  return {
    comments,
    port,
    add,
    get posts() {
      return posts;
    },
    loseConfirmation() {
      loseConfirmation = true;
    },
  };
}

function ask(
  s: ReturnType<typeof verificationFixture>,
  messageId: string,
  questions: string,
) {
  s.emit({
    type: "finished",
    messageId,
    text: `<factory-intervention>\n${questions}\n</factory-intervention>`,
  });
}

test("varias rondas de dudas usan el mismo thread y terminan en código verificado, PR y preview", async () => {
  const conversation = conversationFixture();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.start();
    assert.match(s.tasks[0].text, /Group all currently known doubts/);
    conversation.add("Un comentario mientras el agente trabaja se ignora.");
    ask(s, "m1", "1. ¿Qué título?\n2. ¿Mostramos los precios?");
    s.emit({ type: "pending", pending: [] });
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "waiting");
    assert.equal(s.workflow.view(run.id)?.pending.length, 1);
    assert.match(
      conversation.comments.at(-1)!.body,
      /1\. ¿Qué título\?\n2\. ¿Mostramos los precios\?/,
    );
    assert.equal(await s.workflow.startNext(), null);
    conversation.add("Build completed", false);
    const response = conversation.add(
      "Corrige el título a Catálogo.\nSí, con IVA. `$(touch /tmp/never)`",
    );
    conversation.add("Otro comentario posterior.");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "running");
    assert.equal(s.tasks.at(-1)?.text, response.body);
    assert.equal(s.tasks.at(-1)?.sessionId, run.sessionId);
    assert.equal(
      s.workflow.view(run.id)?.interventions?.[0].response?.author,
      "anyone",
    );
    // El observador vuelve a leer mensajes anteriores en cada conciliación.
    ask(s, "m1", "1. ¿Qué título?\n2. ¿Mostramos los precios?");
    assert.equal(s.workflow.view(run.id)?.status, "running");
    ask(s, "m2", "¿Orden alfabético?");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "waiting");
    assert.equal(
      s.tasks.length,
      2,
      "un comentario antiguo no responde otra intervención",
    );
    conversation.add("Acepto el orden alfabético.");
    await s.workflow.poll();
    assert.equal(s.sessions, 1);
    assert.equal(s.tasks.length, 3);
    assert.ok(s.tasks.every((task) => task.sessionId === run.sessionId));
    assert.equal(s.workflow.view(run.id)?.interventions?.length, 2);
    s.facts.comments.push(
      ...conversation.comments.map((comment) => ({
        ...comment,
        source: "issue" as const,
        updatedAt: comment.createdAt,
      })),
    );
    s.commit(
      "footer.txt",
      "Catálogo con precios y orden alfabético.",
      "Implement clarified catalogue",
    );
    s.finish();
    await s.workflow.poll();
    const head = s.git("rev-parse", "HEAD");
    s.facts.preview = {
      id: "preview-1",
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
    assert.equal(s.workflow.view(run.id)?.verification?.status, "passed");
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    assert.ok(s.facts.pull);
    assert.ok(s.workflow.view(run.id)?.publication?.report);
    assert.equal(conversation.posts, 2);
    assert.equal(
      s.writes.some((write) =>
        write.body?.includes("La referencia no identifica"),
      ),
      false,
    );
    s.comment();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_merge");
    s.merge();
    await s.workflow.poll();
    assert.equal(
      s.workflow.view(run.id)?.status,
      "completed",
      s.workflow.view(run.id)?.error ?? "",
    );
  } finally {
    s.close();
  }
});

for (const graceful of [true, false]) {
  test(`reiniciar ${graceful ? "ordenadamente" : "sin parada previa"} durante la espera recupera el thread sin reenviar el encargo`, async () => {
    const conversation = conversationFixture();
    const s = verificationFixture({ issueConversation: conversation.port });
    try {
      const run = await s.start();
      ask(s, "m1", "¿Qué título?");
      await s.workflow.poll();
      if (graceful) {
        await s.workflow.shutdown();
      }
      s.reopen();
      assert.equal(s.workflow.view(run.id)?.status, "waiting");
      await s.workflow.poll();
      assert.equal(s.tasks.length, 1);
      assert.equal(s.sessions, 1);
      conversation.add("Nuevo catálogo");
      await s.workflow.poll();
      assert.equal(
        s.workflow.view(run.id)?.status,
        "running",
        s.workflow.view(run.id)?.error ?? "",
      );
      assert.deepEqual(s.resumed, [run.sessionId]);
      assert.equal(s.sessions, 1);
      assert.equal(s.tasks.length, 2);
      assert.equal(s.tasks.at(-1)?.sessionId, run.sessionId);
      assert.equal(conversation.posts, 1);
    } finally {
      s.close();
    }
  });

  test(`detener una espera recuperada ${graceful ? "con el servidor parado" : "con el servidor vivo"} cancela sin reenviar tareas`, async () => {
    const conversation = conversationFixture();
    const s = verificationFixture({ issueConversation: conversation.port });
    try {
      const run = await s.start();
      ask(s, "m1", "¿Qué título?");
      await s.workflow.poll();
      if (graceful) {
        await s.workflow.shutdown();
      }
      s.reopen();
      const stopped = await s.workflow.stop(run.id);
      assert.equal(stopped.status, "stopped");
      assert.equal(s.workflow.factory.active, null);
      conversation.add("Catálogo");
      await s.workflow.poll();
      assert.equal(s.tasks.length, 1);
      assert.deepEqual(s.resumed, graceful ? [] : [run.sessionId]);
    } finally {
      s.close();
    }
  });
}

test("detener durante la lectura de comentarios impide publicar o reanudar después de cancelar", async () => {
  const conversation = conversationFixture();
  const s = verificationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.start();
    ask(s, "m1", "¿Qué título?");
    let release!: (comments: IssueComment[]) => void;
    conversation.port.comments = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const polling = s.workflow.poll();
    await s.workflow.stop(run.id);
    release([]);
    await polling;
    assert.equal(conversation.posts, 0);
    assert.equal(s.tasks.length, 1);
    assert.equal(s.workflow.view(run.id)?.status, "stopped");
  } finally {
    s.close();
  }
});

test("perder la confirmación del comentario no duplica la pregunta en el issue", async () => {
  const conversation = conversationFixture();
  const s = verificationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.start();
    ask(s, "m1", "¿Qué título?");
    conversation.loseConfirmation();
    await s.workflow.poll();
    assert.equal(
      s.workflow.view(run.id)?.interventions?.[0].comment,
      undefined,
    );
    await s.workflow.poll();
    assert.ok(s.workflow.view(run.id)?.interventions?.[0].comment);
    assert.equal(conversation.posts, 1);
  } finally {
    s.close();
  }
});

test("un fallo al entregar la respuesta mantiene el error sin reenviarla automáticamente", async () => {
  const conversation = conversationFixture();
  const s = verificationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.start();
    ask(s, "m1", "¿Qué título?");
    await s.workflow.poll();
    conversation.add("Catálogo");
    let attempts = 0;
    s.agent.send = async () => {
      attempts++;
      throw new Error("Provider unavailable");
    };
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.match(
      s.workflow.view(run.id)?.error ?? "",
      /continuation unconfirmed/,
    );
    await s.workflow.poll();
    assert.equal(attempts, 1);
    assert.equal(
      s.workflow.view(run.id)?.interventions?.[0].deliveredAt,
      undefined,
    );
  } finally {
    s.close();
  }
});

test("una petición explícita incompleta no se considera un Commit candidato terminado", async () => {
  const s = verificationFixture();
  try {
    const run = await s.start();
    s.emit({
      type: "finished",
      messageId: "m1",
      text: "<factory-intervention>\n¿Cuál?",
    });
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.equal(s.workflow.view(run.id)?.verification, undefined);
  } finally {
    s.close();
  }
});

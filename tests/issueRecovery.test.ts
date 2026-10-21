import { test } from "node:test";
import assert from "node:assert/strict";
import { verificationFixture } from "./support/verification.ts";
import {
  publicationFixture,
  catalogueDelivery,
} from "./support/publication.ts";
import { recoveryConversation } from "./support/recovery.ts";
import { execute } from "../src/infrastructure/process.ts";

for (const body of [
  "Cambia el texto del pie.",
  "Cancelar el botón rojo",
  "Reintenta",
  "Corregir: Cambia el texto del pie.",
  "¿Qué has cambiado?",
  "gracias",
  "Acepto",
]) {
  test(`en revisión el mensaje «${body}» llega íntegro al mismo agente una sola vez`, async () => {
    const conversation = recoveryConversation();
    const s = publicationFixture({ issueConversation: conversation.port });
    try {
      const run = await s.candidate();
      await s.workflow.poll();
      const comment = conversation.add(body);
      s.facts.comments.push({
        ...comment,
        updatedAt: comment.createdAt,
        source: "issue",
      });
      await s.workflow.poll();
      await s.workflow.poll();
      const current = s.workflow.view(run.id)!;
      assert.equal(current.status, "running", current.error ?? "");
      assert.equal(current.attempt, 2);
      assert.equal(s.tasks.length, 2);
      assert.ok(s.tasks[1].text.includes(`\n\n${body}\n\n`));
      assert.equal(s.tasks[1].sessionId, run.sessionId);
      assert.equal(s.sessions, 1);
      assert.equal(s.facts.status?.state, "pending");
      assert.deepEqual(conversation.closures, []);
      assert.ok(current.recovery?.consumed.includes(comment.id));
      assert.equal(
        conversation.comments.some((item) =>
          item.body.includes("La Factory necesita intervención"),
        ),
        false,
      );
    } finally {
      s.close();
    }
  });
}

test("el aviso de revisión explica la conversación libre y los comandos completos", async () => {
  const s = publicationFixture();
  try {
    await s.candidate();
    await s.workflow.poll();
    const notice = s.facts.comments[0].body;
    assert.match(notice, /Para hablar con el agente.*responde.*este issue/i);
    assert.match(notice, /`Cancelar`/);
    assert.match(notice, /`Reintentar`/);
    assert.doesNotMatch(notice, /Corregir: instrucciones/);
  } finally {
    s.close();
  }
});

test("los mensajes enviados mientras se trabaja o se espera preview no se ejecutan al volver a revisión", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  const add = (body: string) => {
    const comment = conversation.add(body);
    s.facts.comments.push({
      ...comment,
      updatedAt: comment.createdAt,
      source: "issue",
    });
    return comment;
  };
  try {
    const run = await s.candidate();
    const duringPreview = add("Haz el pie verde antes de revisar.");
    await s.workflow.poll();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    assert.equal(s.tasks.length, 1);
    // Incluso con la misma precisión temporal, un comentario anterior ya observado se excluye.
    duringPreview.createdAt = s.workflow.view(run.id)!.publication!.report!.at;
    await s.workflow.poll();
    assert.equal(s.tasks.length, 1);
    add("Haz el pie azul.");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "running");
    add("Este mensaje se publicó mientras trabajabas.");
    // No hay ninguna consulta durante el trabajo que pueda marcar el mensaje como ignorado.
    s.finish(catalogueDelivery);
    await s.workflow.poll();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    assert.equal(s.tasks.length, 2);
    assert.equal(s.workflow.view(run.id)?.attempt, 2);
    s.merge();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "completed");
  } finally {
    s.close();
  }
});

test("en revisión se excluyen bots, comentarios propios y aclaraciones ya entregadas", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const previous = conversation.add("Cancelar");
    previous.createdAt = 0;
    s.facts.comments.push({
      ...previous,
      updatedAt: previous.createdAt,
      source: "issue",
    });
    const run = await s.candidate();
    await s.workflow.poll();
    conversation.add("Mensaje del bot", false);
    conversation.add("Mensaje propio <!-- app-foundry:test -->");
    conversation.comments.push({
      ...s.facts.comments.at(-1)!,
      body: "Aviso propio editado sin marcador",
      human: true,
    });
    conversation.add(" \n\t ");
    const response = conversation.add("Aclaración ya entregada");
    const current = s.workflow.view(run.id)!;
    current.interventions = [
      {
        id: "question",
        questions: "¿Qué color quieres?",
        requestedAt: response.createdAt - 1,
        response,
        deliveredAt: response.createdAt,
      },
    ];
    s.workflow.factory.persist(current);
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    assert.equal(s.tasks.length, 1);
    assert.equal(s.facts.status?.state, "success");
  } finally {
    s.close();
  }
});

for (const beforeMerge of [true, false]) {
  test(`un mensaje libre ${beforeMerge ? "anterior" : "posterior"} al merge ${beforeMerge ? "invalida" : "conserva"} la aceptación`, async () => {
    const conversation = recoveryConversation();
    const s = publicationFixture({ issueConversation: conversation.port });
    try {
      const run = await s.candidate();
      await s.workflow.poll();
      const comment = conversation.add("Cambia el texto del pie.");
      comment.createdAt = s.workflow.view(run.id)!.publication!.report!.at;
      s.merge();
      if (!beforeMerge) {
        comment.createdAt = s.facts.pull!.mergedAt! + 1;
      }
      s.facts.comments.push({
        ...comment,
        updatedAt: comment.createdAt,
        source: "issue",
      });
      await s.workflow.poll();
      assert.equal(s.tasks.length, 1);
      assert.equal(
        s.workflow.view(run.id)?.status,
        beforeMerge ? "intervention" : "completed",
      );
      assert.equal(
        Boolean(s.workflow.view(run.id)?.publication?.acceptance),
        !beforeMerge,
      );
    } finally {
      s.close();
    }
  });
}

test("Corregir durante la espera de preview inicia otro Intento sin esperar al deployment", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.candidate();
    s.facts.preview = null;
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_preview");
    conversation.add("Corregir: haz que la animación sea más impactante");

    await s.workflow.poll();

    assert.equal(s.workflow.view(run.id)?.status, "running");
    assert.equal(s.workflow.view(run.id)?.attempt, 2);
    assert.equal(s.tasks.length, 2);
    assert.match(s.tasks[1].text, /haz que la animación sea más impactante/);
    assert.notEqual(s.facts.status?.state, "success");
  } finally {
    s.close();
  }
});

for (const inspection of [1, 2, 3]) {
  test(`un mensaje libre recibido en la consulta ${inspection} revoca el control sin intervención y se entrega una sola vez`, async () => {
    const conversation = recoveryConversation();
    const s = publicationFixture({ issueConversation: conversation.port });
    try {
      const run = await s.candidate();
      await s.workflow.poll();
      assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
      const beforeComment = s.inspections;
      s.onInspect((count) => {
        if (count === beforeComment + 3) {
          s.comment("Haz que la animación sea más impactante", {
            source: "pull",
          });
        }
      });
      await s.workflow.poll();
      assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
      const before = s.inspections;
      const writes = s.writes.length;
      let correction: ReturnType<typeof conversation.add> | undefined;
      s.onInspect((count) => {
        if (count === before + inspection) {
          correction = conversation.add("Corrige el pie antes de integrar.");
          correction.author = "maintainer";
          s.facts.comments.push({
            ...correction,
            updatedAt: correction.createdAt,
            source: "issue",
          });
        }
      });

      await s.workflow.poll();
      assert.ok(correction);
      const correctionId = correction.id;
      assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
      assert.equal(s.workflow.view(run.id)?.error, null);
      assert.equal(conversation.comments.length, 1);
      assert.notEqual(s.facts.status?.state, "success");
      assert.equal(
        s.writes.slice(writes).some((write) => write.kind === "success"),
        false,
      );
      await s.workflow.poll();
      await s.workflow.poll();

      const current = s.workflow.view(run.id)!;
      assert.equal(current.status, "running", current.error ?? "");
      assert.equal(current.attempt, 2);
      assert.equal(s.tasks.length, 2);
      assert.match(s.tasks[1].text, /Corrige el pie antes de integrar/);
      assert.ok(current.recovery?.consumed.includes(correctionId));
      assert.equal(current.recovery?.pending, undefined);
      const responses = conversation.comments.filter((comment) =>
        comment.body.includes(`recovery-response:${run.id}:${correctionId}`),
      );
      assert.equal(responses.length, 1);
      assert.match(responses[0].body, /Intento 2 iniciado/);
    } finally {
      s.close();
    }
  });
}

test("una corrección pendiente sobrevive a dos fallos y Reintentar entrega sus instrucciones una sola vez", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    const correction = conversation.add(
      "Corregir: Evita que el hero tape los botones.",
    );
    s.facts.comments.push({
      ...correction,
      updatedAt: correction.createdAt,
      source: "issue",
    });
    let fail = true;
    s.onInspect(() => {
      if (fail) {
        fail = false;
        throw new Error("net/http: TLS handshake timeout");
      }
    });
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.match(s.workflow.view(run.id)?.error ?? "", /TLS handshake timeout/);
    assert.equal(s.tasks.length, 1);
    assert.notEqual(s.facts.status?.state, "success");
    fail = true;
    conversation.add("Reintentar");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    s.reopen();
    conversation.add("Reintentar");
    await s.workflow.poll();
    assert.equal(
      s.workflow.view(run.id)?.status,
      "running",
      s.workflow.view(run.id)?.error ?? "",
    );
    assert.equal(s.workflow.view(run.id)?.attempt, 2);
    assert.match(s.tasks.at(-1)!.text, /Evita que el hero tape los botones/);
    await s.workflow.poll();
    assert.equal(s.tasks.length, 2);
  } finally {
    s.close();
  }
});

test("Reintentar sin incidencia recibe una explicación una sola vez", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    const retry = conversation.add("  rEiNtEnTaR \n");
    await s.workflow.poll();
    await s.workflow.poll();
    const responses = conversation.comments.filter((c) =>
      c.body.includes(`recovery-response:${run.id}:${retry.id}`),
    );
    assert.equal(responses.length, 1);
    assert.match(responses[0].body, /no hay.*pendiente/i);
    assert.equal(s.tasks.length, 1);
  } finally {
    s.close();
  }
});

test("un Reintentar recibido durante la recuperación responde sin programar otro Intento", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    conversation.add("Corregir: Ajusta el hero.");
    let retry: ReturnType<typeof conversation.add> | undefined;
    s.onInspect(() => {
      retry ??= conversation.add("Reintentar");
    });
    await s.workflow.poll();
    await s.workflow.poll();
    assert.equal(s.tasks.length, 2);
    assert.equal(s.workflow.view(run.id)?.recovery?.pending, undefined);
    assert.match(conversation.comments.at(-1)!.body, /ya estaba en curso/);
    assert.ok(s.workflow.view(run.id)?.recovery?.consumed.includes(retry!.id));
  } finally {
    s.close();
  }
});

test("un envío al agente sin confirmación queda en intervención y no se reenvía", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    const send = s.agent.send.bind(s.agent);
    s.agent.send = async (id, text) => {
      await send(id, text);
      throw new Error("Lost agent response");
    };
    conversation.add("Corregir: Ajusta el hero.");
    await s.workflow.poll();
    assert.equal(
      s.workflow.view(run.id)?.recovery?.pending?.delivery,
      "uncertain",
    );
    s.reopen();
    conversation.add("Reintentar");
    await s.workflow.poll();
    assert.equal(s.tasks.length, 2);
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.match(
      conversation.comments.at(-1)!.body,
      /requiere inspección local/,
    );
  } finally {
    s.close();
  }
});

for (const remoteConfirmed of [false, true]) {
  test(`una respuesta perdida se recupera sin repetir la corrección (efecto remoto: ${remoteConfirmed})`, async () => {
    const conversation = recoveryConversation();
    const publish = conversation.port.comment;
    let fail = true;
    conversation.port.comment = async (repository, issue, body) => {
      if (body.includes("recovery-response:") && fail) {
        fail = false;
        if (remoteConfirmed) {
          await publish(repository, issue, body);
        }
        throw new Error("Lost comment response");
      }
      return publish(repository, issue, body);
    };
    const s = publicationFixture({ issueConversation: conversation.port });
    try {
      const run = await s.candidate();
      await s.workflow.poll();
      const correction = conversation.add("Corregir: Ajusta el hero.");
      await s.workflow.poll();
      assert.equal(s.tasks.length, 2);
      assert.equal(s.workflow.view(run.id)?.recovery?.pending, undefined);
      assert.ok(s.workflow.view(run.id)?.recovery?.response);
      await s.workflow.poll();
      assert.equal(s.tasks.length, 2);
      assert.equal(s.workflow.view(run.id)?.recovery?.response, undefined);
      assert.equal(
        conversation.comments.filter((c) =>
          c.body.includes(`recovery-response:${run.id}:${correction.id}`),
        ).length,
        1,
      );
    } finally {
      s.close();
    }
  });
}

test("un fallo se avisa una vez y Reintentar vuelve a verificar sin otro Intento del agente", async () => {
  const conversation = recoveryConversation();
  const s = verificationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.start();
    s.commit("catalogue.txt", "defect", "Introduce defect");
    s.finish();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.match(
      conversation.comments[0].body,
      /La Factory necesita intervención/,
    );
    const notice = conversation.comments[0].body;
    assert.equal(
      s.workflow.view(run.id)!.history.find((entry) => entry.comment)?.comment
        ?.body,
      notice,
    );
    assert.match(notice, /Corregir: instrucciones/);
    assert.match(notice, /Comando afectado: `node check.mjs`/);
    assert.match(notice, /Código de salida: 7/);
    assert.match(notice, /despliega la salida de «node check.mjs»/);
    assert.match(notice, /repite la verificación del mismo código/);
    assert.match(notice, /Corregir: Corrige el fallo de verificación indicado/);
    await s.workflow.poll();
    assert.equal(
      s.tasks.length,
      1,
      "A failed check does not start an automatic correction",
    );
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    conversation.add("Reintentar", false);
    await s.workflow.poll();
    assert.equal(
      conversation.comments.filter((c) => c.body.includes("## La Factory"))
        .length,
      1,
    );
    s.commit("catalogue.txt", "Fixed catalogue", "Fix defect");
    const retry = conversation.add("Reintentar");
    await s.workflow.poll();
    assert.equal(
      s.workflow.view(run.id)?.verification?.status,
      "passed",
      s.workflow.view(run.id)?.error ?? "",
    );
    assert.equal(s.tasks.length, 1);
    assert.equal(s.workflow.view(run.id)?.attempt, 1);
    assert.ok(s.workflow.view(run.id)?.recovery?.consumed.includes(retry.id));
    assert.equal(
      s.workflow
        .view(run.id)!
        .history.filter((entry) => entry.comment)
        .at(-1)?.comment?.body,
      conversation.comments.at(-1)!.body,
    );
    await s.workflow.poll();
    assert.equal(s.tasks.length, 1);
  } finally {
    s.close();
  }
});

test("el aviso de verificación identifica los comandos posteriores que no se ejecutaron", async () => {
  const conversation = recoveryConversation();
  const s = verificationFixture({
    commands: ["node check.mjs", "node --version"],
    issueConversation: conversation.port,
  });
  try {
    const run = await s.start();
    s.commit("catalogue.txt", "defect", "Introduce defect");
    s.finish();
    await s.workflow.poll();
    const notice = conversation.comments[0].body;
    assert.match(notice, /Los comandos posteriores no se han ejecutado/);
    assert.match(notice, new RegExp(s.git("rev-parse", "HEAD")));
    assert.equal(
      s.workflow.view(run.id)?.verification?.checks[1].status,
      "not_run",
    );
    assert.equal(s.tasks.length, 1);
  } finally {
    s.close();
  }
});

test("un comando sin código de salida confirmado conserva la causa saneada en el aviso", async () => {
  const conversation = recoveryConversation();
  let checks = 0;
  const s = verificationFixture({
    issueConversation: conversation.port,
    process: async (command, args, options) => {
      if (
        command === "/bin/sh" &&
        args[1] === "node check.mjs" &&
        ++checks === 2
      ) {
        throw new Error("Command launch failed password=private-notice-secret");
      }
      return execute(command, args, options);
    },
  });
  try {
    await s.start();
    s.finish();
    await s.workflow.poll();
    const notice = conversation.comments[0].body;
    assert.match(notice, /Command launch failed/);
    assert.match(notice, /Código de salida sin confirmar/);
    assert.match(notice, /Comando afectado: `node check.mjs`/);
    assert.doesNotMatch(notice, /private-notice-secret/);
    assert.equal(s.tasks.length, 1);
  } finally {
    s.close();
  }
});

test("Corregir reutiliza thread, rama y PR, y exige otra verificación y aceptación", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    const branch = run.workspace!.branch;
    const oldHead = s.facts.remoteHead;
    s.description.body = "Una edición humana de la entrega anterior";
    const correctedDelivery = catalogueDelivery.replace(
      "mostrar el catálogo",
      "mostrar el catálogo y el nuevo pie",
    );
    s.writer(false);
    const correction = conversation.add("Corregir: Cambia el texto del pie.");
    s.facts.comments.push({
      ...correction,
      updatedAt: correction.createdAt,
      source: "issue",
    });
    await s.workflow.poll();
    assert.equal(
      s.workflow.view(run.id)?.status,
      "running",
      s.workflow.view(run.id)?.error ?? "",
    );
    assert.equal(s.workflow.view(run.id)?.attempt, 2);
    assert.equal(s.sessions, 1);
    assert.deepEqual(s.resumed, [run.sessionId]);
    assert.equal(s.tasks.at(-1)?.sessionId, run.sessionId);
    assert.match(s.tasks.at(-1)!.text, /Cambia el texto del pie/);
    assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
    assert.equal(s.facts.status?.state, "pending");
    s.commit("footer.txt", "New footer", "Correct footer");
    s.finish(correctedDelivery);
    await s.workflow.poll();
    const head = s.git("rev-parse", "HEAD");
    assert.notEqual(head, oldHead);
    assert.equal(s.facts.remoteHead, head);
    assert.equal(s.workflow.view(run.id)?.workspace?.branch, branch);
    assert.equal(s.writes.filter((w) => w.kind === "pull").length, 1);
    assert.equal(s.workflow.view(run.id)?.verification?.status, "passed");
    assert.equal(s.description.title, correctedDelivery.split("\n")[0]);
    assert.match(s.description.body, /Se conserva el pie existente/);
    assert.doesNotMatch(s.description.body, /Una edición humana/);
    assert.match(s.tasks[0].text, /## Resumen/);
    assert.match(s.tasks.at(-1)!.text, /entire accumulated change/);
    assert.equal(s.writes.filter((w) => w.kind === "description").length, 1);
    s.facts.preview = {
      ...s.facts.preview!,
      head,
      servedHead: head,
      id: "preview-2",
      url: "https://catalogue-correction.vercel.app",
    };
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    s.writer(true);
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
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

test("una corrección ya aplicada no impide la aceptación del intento posterior", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    const correctedDelivery = catalogueDelivery.replace(
      "mostrar el catálogo",
      "mostrar el catálogo y el nuevo pie",
    );
    s.writer(false);
    const correction = conversation.add("Corregir: Cambia el texto del pie.");
    correction.author = "maintainer";
    s.facts.comments.push({
      ...correction,
      updatedAt: correction.createdAt,
      source: "issue",
    });
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "running");
    s.commit("footer.txt", "New footer", "Correct footer");
    s.finish(correctedDelivery);
    await s.workflow.poll();
    const head = s.git("rev-parse", "HEAD");
    s.facts.preview = {
      ...s.facts.preview!,
      head,
      servedHead: head,
      id: "preview-2",
      url: "https://catalogue-correction.vercel.app",
    };
    await s.workflow.poll();
    s.writer(true);
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    assert.equal(s.facts.status?.state, "success");
    s.merge();
    await s.workflow.poll();
    assert.equal(
      s.workflow.view(run.id)?.status,
      "completed",
      s.workflow.view(run.id)?.error ?? "",
    );
    assert.equal(s.workflow.view(run.id)?.publication?.acceptance?.head, head);
  } finally {
    s.close();
  }
});

test("Reintentar vuelve a juzgar un merge rechazado cuando la corrección es anterior al informe", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    await s.workflow.poll();
    const comment = s.comment("Corrige el pie antes de integrar.", {
      author: "maintainer",
    });
    s.merge();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
    comment.createdAt = s.workflow.view(run.id)!.publication!.report!.at - 1;
    conversation.add("Reintentar");
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

test("parar con la PR ya integrada no graba una revocación del merge", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "success");
    s.merge();
    await s.workflow.shutdown();
    const current = s.workflow.view(run.id)!;
    assert.equal(current.publication?.blocked, undefined);
    assert.notEqual(current.status, "stopped");
    assert.equal(s.facts.status?.state, "success");
    assert.equal(
      s.writes.some((write) => write.kind === "failure"),
      false,
    );
  } finally {
    s.close();
  }
});

test("Reintentar cierra el issue aunque una parada anterior hubiera revocado el merge", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    await s.workflow.poll();
    s.merge();
    const current = s.workflow.view(run.id)!;
    current.status = "intervention";
    current.publication!.blocked =
      "Detención local solicitada; control de merge revocado.";
    current.publication!.pull = { ...s.facts.pull! };
    s.workflow.factory.persist(current);
    await s.workflow.poll();
    conversation.add("Reintentar");
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

test("Reintentar no acepta un merge que sigue sin control favorable", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.facts.status = {
      head: s.facts.pull!.head,
      state: "pending",
      at: Date.now(),
    };
    s.merge();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    conversation.add("Reintentar");
    await s.workflow.poll();
    assert.equal(
      s.workflow.view(run.id)?.status,
      "intervention",
      s.workflow.view(run.id)?.error ?? "",
    );
    assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
    assert.equal(s.facts.request.open, true);
  } finally {
    s.close();
  }
});

test("Corregir autoriza sustituir un requisito inicial y comunica el resultado sin cambios una sola vez", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({
    body: "Añade Suikoden con el año 1995.",
    issueConversation: conversation.port,
  });
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    const previousHead = s.facts.remoteHead;
    const previousDescription = structuredClone(s.description);
    conversation.add(
      "Corregir: Muestra 1998 aunque el encargo inicial diga 1995.",
    );
    await s.workflow.poll();
    assert.match(s.tasks.at(-1)!.text, /supersede conflicting requirements/);
    assert.match(s.tasks.at(-1)!.text, /1998/);
    s.finish(
      `${catalogueDelivery}\n\n<factory-summary>El año ya es 1998 en la ficha. No he necesitado cambiar archivos.</factory-summary>`,
    );
    await s.workflow.poll();
    const notices = () =>
      s.facts.comments.filter((c) =>
        c.body.includes("No he necesitado cambiar archivos"),
      );
    assert.equal(notices().length, 1);
    assert.match(notices()[0].body, /No se han realizado cambios/);
    assert.doesNotMatch(
      notices()[0].body,
      /El desarrollo está listo para validar/,
    );
    assert.equal(s.facts.remoteHead, previousHead);
    assert.deepEqual(s.description, previousDescription);
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    await s.workflow.poll();
    assert.equal(notices().length, 1);
  } finally {
    s.close();
  }
});

test("el resultado de una corrección con cambios espera a su preview e incluye el resumen del LLM", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    conversation.add("Corregir: Cambia 1995 por 1998.");
    await s.workflow.poll();
    s.commit("footer.txt", "1998", "Correct year");
    s.finish(
      `${catalogueDelivery}\n\n<factory-summary>He cambiado el año de 1995 a 1998.</factory-summary>`,
    );
    await s.workflow.poll();
    const notices = () =>
      s.facts.comments.filter((c) =>
        c.body.includes("He cambiado el año de 1995 a 1998"),
      );
    assert.equal(notices().length, 0);
    assert.doesNotMatch(s.description.body, /factory-summary/);
    const head = s.git("rev-parse", "HEAD");
    s.facts.preview = {
      ...s.facts.preview!,
      id: "corrected-preview",
      head,
      servedHead: head,
      url: "https://correction.vercel.app",
    };
    await s.workflow.poll();
    assert.equal(notices().length, 1);
    assert.match(notices()[0].body, /revisa la preview/);
    assert.match(notices()[0].body, /https:\/\/correction.vercel.app/);
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    await s.workflow.poll();
    assert.equal(notices().length, 1);
  } finally {
    s.close();
  }
});

test("un fallo de lectura queda en el Dashboard sin comentarios y se recupera sin intervención", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    const comments = conversation.comments.length;
    const notices = s.facts.comments.length;
    s.observationFails(true);
    await s.workflow.poll();
    await s.workflow.poll();
    assert.equal(conversation.comments.length, comments);
    assert.equal(s.facts.comments.length, notices);
    assert.ok(
      s.workflow
        .view(run.id)!
        .history.some(
          (event) =>
            event.kind === "publication-error" &&
            event.text.includes("GitHub unavailable"),
        ),
    );
    s.observationFails(false);
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    assert.equal(s.workflow.view(run.id)?.error, null);
    assert.equal(conversation.comments.length, comments);
    assert.ok(
      s.workflow
        .view(run.id)!
        .history.some((event) => event.text.includes("GitHub unavailable")),
    );
  } finally {
    s.close();
  }
});

test("Cancelar desde un comentario sin permisos confirma parada y cierra como no implementado", async () => {
  const conversation = recoveryConversation();
  const s = verificationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.start();
    conversation.add("  cAnCeLaR \n");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "stopped");
    assert.equal(s.workflow.factory.active, null);
    assert.deepEqual(conversation.closures, [
      { repository: s.project.repository, issue: 1 },
    ]);
    assert.equal(
      s.workflow.view(run.id)!.history.findLast((entry) => entry.comment)
        ?.comment?.body,
      conversation.comments.at(-1)!.body,
    );
    await s.workflow.poll();
    assert.equal(conversation.closures.length, 1);
  } finally {
    s.close();
  }
});

test("Cancelar mantiene el issue abierto y el puesto si la parada no se confirma", async () => {
  const conversation = recoveryConversation();
  const s = verificationFixture({
    issueConversation: conversation.port,
    stopConfirmed: false,
  });
  try {
    const run = await s.start();
    conversation.add("Cancelar");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.equal(s.workflow.factory.active, run.id);
    assert.deepEqual(conversation.closures, []);
    assert.match(conversation.comments.at(-1)!.body, /parada/i);
  } finally {
    s.close();
  }
});

for (const command of ["Cancelar", "Corregir: Otro cambio"]) {
  test(`${command} después del merge conserva la integración y no cierra como no implementado`, async () => {
    const conversation = recoveryConversation();
    const s = publicationFixture({ issueConversation: conversation.port });
    try {
      const run = await s.candidate();
      await s.workflow.poll();
      await s.workflow.poll();
      s.merge();
      conversation.add(command);
      await s.workflow.poll();
      assert.equal(
        s.workflow.view(run.id)?.status,
        "completed",
        s.workflow.view(run.id)?.error ?? "",
      );
      assert.deepEqual(conversation.closures, []);
      assert.equal(s.tasks.length, 1);
    } finally {
      s.close();
    }
  });
}

test("Reintentar recupera un fallo de instalación reutilizando el clon y entrega el encargo una sola vez", async () => {
  const conversation = recoveryConversation();
  let broken = true;
  const s = verificationFixture({
    issueConversation: conversation.port,
    process: async (command, args, options) => {
      if (command === "/bin/sh" && args.at(-1) === "node --version" && broken) {
        return { code: 1, output: "Installation failed" };
      }
      return execute(command, args, options);
    },
  });
  try {
    await s.workflow.observe([
      {
        repository: s.project.repository,
        number: 1,
        title: "Catalogue",
        body: "Show catalogue",
        author: "owner",
        url: `https://github.com/${s.project.repository}/issues/1`,
      },
    ]);
    const run = (await s.workflow.startNext())!;
    assert.equal(run.status, "intervention");
    assert.equal(s.tasks.length, 0);
    const directory = run.workspace!.directory;
    await s.workflow.poll();
    broken = false;
    conversation.add("Reintentar");
    await s.workflow.poll();
    assert.equal(
      s.workflow.view(run.id)?.status,
      "running",
      s.workflow.view(run.id)?.error ?? "",
    );
    assert.equal(s.workflow.view(run.id)?.workspace?.directory, directory);
    assert.equal(s.tasks.length, 1);
  } finally {
    s.close();
  }
});

test("Reintentar tras un fallo del agente crea otro Intento en el mismo thread", async () => {
  const conversation = recoveryConversation();
  const s = verificationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.start();
    s.emit({ type: "error", text: "Agent failed" });
    await s.workflow.poll();
    conversation.add("Reintentar");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "running");
    assert.equal(s.workflow.view(run.id)?.attempt, 2);
    assert.equal(s.sessions, 1);
    assert.equal(s.tasks.length, 2);
    assert.deepEqual(s.resumed, [run.sessionId]);
    assert.match(s.tasks.at(-1)!.text, /Agent failed/);
  } finally {
    s.close();
  }
});

test("Reintentar después del merge completa el cierre pendiente sin repetir el trabajo del agente", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    await s.workflow.poll();
    s.merge();
    s.uncertainEffect("integration-report");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.ok(s.workflow.view(run.id)?.publication?.acceptance);
    conversation.add("Reintentar");
    await s.workflow.poll();
    assert.equal(
      s.workflow.view(run.id)?.status,
      "completed",
      s.workflow.view(run.id)?.error ?? "",
    );
    assert.equal(s.tasks.length, 1);
    assert.deepEqual(conversation.closures, []);
    assert.equal(s.writes.filter((w) => w.kind === "close-issue").length, 1);
  } finally {
    s.close();
  }
});

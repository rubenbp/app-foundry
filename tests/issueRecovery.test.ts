import { test } from "node:test";
import assert from "node:assert/strict";
import { verificationFixture } from "./support/verification.ts";
import {
  publicationFixture,
  catalogueDelivery,
} from "./support/publication.ts";
import { recoveryConversation } from "./support/recovery.ts";
import { execute } from "../src/infrastructure/process.ts";

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

test("Cancelar desde un comentario sin permisos confirma parada y cierra como no implementado", async () => {
  const conversation = recoveryConversation();
  const s = verificationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.start();
    conversation.add("Cancelar");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "stopped");
    assert.equal(s.workflow.factory.active, null);
    assert.deepEqual(conversation.closures, [
      { repository: s.project.repository, issue: 1 },
    ]);
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

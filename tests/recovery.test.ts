import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recoveryCommand,
  issueRecoveryCommand,
} from "../src/domain/recovery.ts";
import { publicationPlan } from "../src/domain/publication.ts";
import type { Run } from "../src/domain/run.ts";

test("las órdenes de recuperación son explícitas y las instrucciones se conservan como texto", () => {
  assert.deepEqual(recoveryCommand(" Reintentar \n"), { kind: "retry" });
  assert.deepEqual(recoveryCommand("cancelar"), { kind: "cancel" });
  assert.deepEqual(
    recoveryCommand("Corregir: Arregla el catálogo.\n`$(literal)`"),
    {
      kind: "correct",
      instructions: "Arregla el catálogo.\n`$(literal)`",
    },
  );
  for (const body of [
    "¿Reintentar?",
    "No cancelar",
    "Corregir:",
    "Corregir:   ",
    "Corregir el título",
    "Acepto",
  ]) {
    assert.equal(recoveryCommand(body), null, body);
  }
});

test("en revisión solo Reintentar y Cancelar completos se interpretan como comandos", () => {
  const publication = publicationPlan("candidate");
  publication.report = {
    id: "review",
    url: "https://github.com/team/product/pull/2",
    at: 100,
    head: publication.head,
    preview: "https://preview.example.com",
  };
  const run: Pick<Run, "status" | "publication"> = {
    status: "awaiting_review",
    publication,
  };
  const comment = { id: "message", body: "", createdAt: 101 };
  for (const body of [
    "Cancelar el botón rojo",
    "Reintentar con otro color",
    "Reintenta",
    "Corregir: Ajusta el título",
    "  ¿Qué has cambiado?\n\nGracias.  ",
  ]) {
    assert.deepEqual(issueRecoveryCommand(run, { ...comment, body }), {
      kind: "correct",
      instructions: body,
    });
  }
  assert.deepEqual(
    issueRecoveryCommand(run, { ...comment, body: " \n cAnCeLaR  " }),
    { kind: "cancel" },
  );
  assert.deepEqual(
    issueRecoveryCommand(run, { ...comment, body: "  rEiNtEnTaR \n" }),
    { kind: "retry" },
  );
  assert.equal(issueRecoveryCommand(run, { ...comment, body: " \n\t" }), null);
  assert.equal(
    issueRecoveryCommand(run, {
      ...comment,
      body: "Cambia el título",
      createdAt: 99,
    }),
    null,
  );
  publication.consumed.push({ id: comment.id, reason: "Antes de revisión" });
  assert.equal(
    issueRecoveryCommand(run, { ...comment, body: "Cambia el título" }),
    null,
  );
  for (const status of [
    "awaiting_preview",
    "intervention",
    "running",
    "waiting",
  ] satisfies Run["status"][]) {
    assert.equal(
      issueRecoveryCommand(
        { ...run, status },
        {
          ...comment,
          body: "Cambia el título",
        },
      ),
      null,
    );
  }
});

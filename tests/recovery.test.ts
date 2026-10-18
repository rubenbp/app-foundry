import { test } from "node:test";
import assert from "node:assert/strict";
import { recoveryCommand } from "../src/domain/recovery.ts";

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

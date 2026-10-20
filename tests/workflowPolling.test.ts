import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as flush } from "node:timers/promises";
import { workflowPolling } from "../src/infrastructure/workflowPolling.ts";
import { verificationFixture } from "./support/verification.ts";

test("un candidato persistido despierta el workflow sin esperar el intervalo y conserva la serialización", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let release!: () => void;
  const polling = workflowPolling(
    async () => {
      calls++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    () => assert.fail("Unexpected polling failure"),
  );
  polling.wake();
  await flush();
  assert.equal(calls, 1);
  polling.wake();
  polling.wake();
  assert.equal(calls, 1);
  release();
  await polling.pending;
  context.mock.timers.tick(0);
  await flush();
  assert.equal(calls, 2);
  release();
  await polling.pending;
  context.mock.timers.tick(14_999);
  await flush();
  assert.equal(calls, 2);
  polling.wake();
  await flush();
  assert.equal(calls, 3);
  polling.halt();
  release();
  await polling.pending;
  context.mock.timers.tick(30_000);
  polling.wake();
  await flush();
  assert.equal(calls, 3);
});

test("el final del agente solo avisa después de persistir el candidato y no avisa por una intervención", async () => {
  const s = verificationFixture();
  try {
    const run = await s.start();
    let wakeups = 0;
    s.workflow.factory.onCandidateReady = () => {
      assert.equal(s.workflow.view(run.id)?.status, "awaiting_verification");
      assert.equal(s.workflow.view(run.id)?.attemptSummary, "Terminado");
      wakeups++;
    };
    s.finish("<factory-intervention>¿Qué título?</factory-intervention>");
    assert.equal(wakeups, 0);
    s.finish("Entrega\n\n<factory-summary>Terminado</factory-summary>");
    assert.equal(wakeups, 1);
  } finally {
    s.close();
  }
});

test("un fallo del ciclo permite la siguiente observación periódica sin solapar ni quedar bloqueado", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let errors = 0;
  const polling = workflowPolling(
    async () => {
      if (++calls === 1) {
        throw new Error("Unavailable");
      }
    },
    () => {
      errors++;
    },
  );
  polling.wake();
  await polling.pending;
  assert.equal(errors, 1);
  context.mock.timers.tick(15_000);
  await polling.pending;
  assert.equal(calls, 2);
  polling.halt();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkflow } from "../src/composition/workflow.ts";
import { factoryView } from "../src/application/factoryView.ts";
import { setup } from "./support/admission.ts";
import { recoveryConversation } from "./support/recovery.ts";

for (const priced of [true, false]) {
  test(`el snapshot de tarifas ${priced ? "configuradas" : "ausentes"} sobrevive al reinicio y al reintento de preparación`, async () => {
    const s = setup();
    const conversation = recoveryConversation();
    const tokenPrices = priced
      ? {
          inputUsdPerMillion: 2,
          outputUsdPerMillion: 8,
          cacheReadUsdPerMillion: 0.5,
        }
      : undefined;
    const newPrices = {
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 12,
      cacheReadUsdPerMillion: 1,
    };
    let failPreparation = true;
    const options = {
      createAgent: () => s.agent,
      github: {
        async ready() {
          return [];
        },
        async setRunLabel() {},
      },
      issueConversation: conversation.port,
      workspace: {
        async prepare(id: string) {
          // Both the runtime and prices must already be durable before effects.
          const saved = workflow.view(id)!;
          assert.equal(saved.request?.runtime.model, s.config.model);
          assert.deepEqual(saved.tokenPrices, tokenPrices);
          if (failPreparation) {
            failPreparation = false;
            throw new Error("Temporary preparation failure");
          }

          return {
            directory: s.root,
            branch: "work",
            baseSha: "base",
            instructions: [],
          };
        },
        async validate() {},
      },
    };
    let workflow = createWorkflow({ ...s.config, tokenPrices }, options);
    try {
      await workflow.observe([s.ready()]);
      const queued = workflow.list()[0];
      assert.equal(queued.tokenPrices, undefined);
      const started = await workflow.startNext();
      assert.equal(started?.status, "intervention");
      assert.deepEqual(started.tokenPrices, tokenPrices);
      workflow.close();
      workflow = createWorkflow(
        { ...s.config, tokenPrices: newPrices },
        options,
      );
      await workflow.poll();
      conversation.add("Reintentar");
      await workflow.poll();
      const retried = workflow.view(queued.id)!;
      assert.equal(retried.status, "running", retried.error ?? "");
      assert.deepEqual(retried.tokenPrices, tokenPrices);
      workflow.factory.ingest(retried.id, {
        type: "usage",
        usage: {
          id: "message",
          provider: s.config.provider,
          model: s.config.model,
          tokens: {
            input: 1_000_000,
            output: 0,
            reasoning: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
          sdkCost: 99,
          completed: true,
        },
      });
      assert.equal(
        factoryView(workflow.factory, retried.id, 0).consumption?.estimatedCost,
        priced ? 2 : null,
      );
      await workflow.stop(retried.id);
      workflow.close();
      workflow = createWorkflow(
        { ...s.config, model: "new-model", tokenPrices: newPrices },
        {
          ...options,
          workspace: {
            ...options.workspace,
            async prepare() {
              return {
                directory: s.root,
                branch: "new-work",
                baseSha: "base",
                instructions: [],
              };
            },
          },
        },
      );
      await workflow.observe([s.ready(2)]);
      const next = await workflow.startNext();
      assert.equal(next?.status, "running", next?.error ?? "");
      assert.equal(next.request?.runtime.model, "new-model");
      assert.deepEqual(next.tokenPrices, newPrices);
      assert.equal(
        workflow.view(retried.id)?.request?.runtime.model,
        s.config.model,
      );
      assert.equal(
        factoryView(workflow.factory, retried.id, 0).consumption?.estimatedCost,
        priced ? 2 : null,
      );
      await workflow.stop(next.id);
    } finally {
      workflow.close();
    }
  });
}

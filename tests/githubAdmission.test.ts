import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkflow } from "../src/composition/workflow.ts";
import { GitHub } from "../src/infrastructure/github.ts";

test("la autorización de GitHub requiere que quien aplicó la etiqueta tenga permiso efectivo de escritura y que el contenido no haya cambiado", async () => {
  for (const scenario of [
    "writer",
    "reader",
    "permission unavailable",
    "edited",
    "renamed",
    "racing edit",
    "bot",
  ]) {
    const root = mkdtempSync(join(tmpdir(), "foundry-github-"));
    const repository = `team/github-${root.split("-").at(-1)}`;
    const issue = {
      number: 15,
      title: "Show games",
      body: "## Acceptance criteria\nAll games are visible",
      user: { login: "owner" },
      html_url: `https://github.com/${repository}/issues/15`,
      updated_at: "2026-10-17T10:00:00Z",
      state: "open",
      labels: [{ name: "factory:ready" }],
    };
    const github = new GitHub(async (args) => {
      const path = args[1];
      if (path.includes("?state=")) {
        return [[issue]];
      }
      if (path.includes("/events?")) {
        return [
          [
            {
              id: 100,
              event: "labeled",
              label: { name: "factory:ready" },
              actor: {
                login: "approver",
                type: scenario === "bot" ? "Bot" : "User",
              },
              created_at: issue.updated_at,
            },
            ...(scenario === "renamed"
              ? [{ id: 101, event: "renamed", created_at: issue.updated_at }]
              : []),
          ],
        ];
      }
      if (path.includes("/permission")) {
        if (scenario === "permission unavailable") {
          throw new Error("HTTP 403");
        }
        return { permission: scenario === "reader" ? "read" : "write" };
      }
      if (path === "graphql") {
        return {
          data: {
            repository: {
              issue: {
                lastEditedAt: scenario === "edited" ? issue.updated_at : null,
              },
            },
          },
        };
      }
      return {
        ...issue,
        ...(scenario === "racing edit" ? { body: "Changed in flight" } : {}),
      };
    });
    const workflow = createWorkflow(
      {
        dataDir: root,
        projectDir: root + "/probe",
        provider: "openai",
        model: "gpt-6-luna",
        auth: "opencode",
        managedProject: {
          id: "catalogue",
          repository,
          baseBranch: "main",
          instructions: ["README.md"],
          preparation: { command: "npm ci" },
          verification: { commands: ["npm test"] },
          publication: {
            provider: "vercel",
            projectId: "example",
            productionOrigin: "https://example.com",
            humanMergeRequired: true,
          },
        },
      },
      {
        github,
        createAgent: () => ({
          async start() {
            throw new Error("Not started");
          },
          async create() {
            return "s";
          },
          async send() {},
          async stop() {
            return { exited: true, detail: "Absent" };
          },
        }),
      },
    );
    try {
      await workflow.poll();
      assert.equal(
        workflow.list().length,
        scenario === "writer" ? 1 : 0,
        scenario,
      );
      if (scenario === "writer") {
        assert.equal(
          workflow.list()[0].request?.authorization.actor,
          "approver",
        );
      } else {
        assert.ok(workflow.observation.error, scenario);
      }
    } finally {
      workflow.close();
    }
  }
});

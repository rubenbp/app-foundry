import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubIssueConversation } from "../src/infrastructure/issueConversation.ts";

test("la conversación del issue pagina comentarios y publica texto literal sin comprobar colaboradores", async () => {
  const calls: { args: string[]; input: unknown }[] = [];
  const comment = (id: number, bot = false) => ({
    id,
    html_url: `https://github.com/team/product/issues/7#issuecomment-${id}`,
    body: "Texto\n`$(literal)`",
    user: { login: bot ? "vercel[bot]" : "anyone", type: bot ? "Bot" : "User" },
    created_at: "2026-10-18T10:00:00Z",
  });
  const github = new GitHubIssueConversation(
    async (executable, args, input) => {
      assert.equal(executable, "gh");
      calls.push({ args, input });
      return JSON.stringify(
        input ? comment(3) : [[comment(1)], [comment(2, true)]],
      );
    },
  );
  const comments = await github.comments("team/product", 7);
  assert.deepEqual(
    comments.map((value) => value.human),
    [true, false],
  );
  await github.comment("team/product", 7, "Pregunta\n`$(literal)`");
  assert.deepEqual(calls[0].args, [
    "api",
    "repos/team/product/issues/7/comments?per_page=100",
    "--paginate",
    "--slurp",
  ]);
  assert.deepEqual(calls[1].input, { body: "Pregunta\n`$(literal)`" });
  assert.equal(calls.length, 2);
});

test("cancelar cierra el issue como no implementado mediante state_reason not_planned", async () => {
  const github = new GitHubIssueConversation(
    async (executable, args, input) => {
      assert.equal(executable, "gh");
      assert.deepEqual(args, [
        "api",
        "repos/team/product/issues/7",
        "--method",
        "PATCH",
        "--input",
        "-",
      ]);
      assert.deepEqual(input, { state: "closed", state_reason: "not_planned" });
      return "{}";
    },
  );
  await github.close("team/product", 7);
});

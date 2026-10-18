import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHub } from "../src/infrastructure/github.ts";

test("GitHub admite issues abiertos con factory:ready mediante una sola consulta paginada, sin acreditar actores ni ediciones", async () => {
  const repository = "team/product";
  const issue = {
    number: 15,
    title: "Show games",
    body: null,
    user: { login: "automation[bot]", type: "Bot" },
    state: "open",
    labels: [{ name: "factory:ready" }],
    updated_at: "2026-10-18T10:00:00Z",
  };
  const calls: string[][] = [];
  const github = new GitHub(async (args) => {
    calls.push(args);
    assert.deepEqual(args, [
      "api",
      `repos/${repository}/issues?state=open&labels=factory%3Aready&per_page=100`,
      "--paginate",
      "--slurp",
    ]);
    return [
      [
        issue,
        { ...issue, number: 16, pull_request: { url: "pull" } },
        { ...issue, number: 17, state: "closed" },
        { ...issue, number: 18, labels: [] },
      ],
      [{ ...issue, number: 19, body: "Quiero mejorar el catálogo." }],
    ];
  });
  const issues = await github.ready(repository);
  assert.equal(calls.length, 1);
  assert.deepEqual(issues, [
    {
      repository,
      number: 15,
      title: "Show games",
      body: "",
      author: "automation[bot]",
      url: `https://github.com/${repository}/issues/15`,
    },
    {
      repository,
      number: 19,
      title: "Show games",
      body: "Quiero mejorar el catálogo.",
      author: "automation[bot]",
      url: `https://github.com/${repository}/issues/19`,
    },
  ]);
});

test("un fallo al consultar los issues sigue siendo un fallo de observación", async () => {
  const github = new GitHub(async () => {
    throw new Error("GitHub unavailable");
  });
  await assert.rejects(github.ready("team/product"), /GitHub unavailable/);
});

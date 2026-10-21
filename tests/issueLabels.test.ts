import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHub } from "../src/infrastructure/github.ts";
import type { GitHubPort } from "../src/application/ports.ts";
import type { IssueLabel } from "../src/domain/issueLabels.ts";
import { publicationFixture } from "./support/publication.ts";
import { verificationFixture } from "./support/verification.ts";

for (const uncertain of ["definition", "addition", "removal"] as const) {
  test(`las etiquetas se concilian sin perder etiquetas ajenas tras una respuesta perdida: ${uncertain}`, async () => {
    const repository = "team/product";
    const defined = new Set(["factory:ready"]);
    const labels = new Set(["factory:ready", "bug", "factory:custom"]);
    const writes: string[] = [];
    let loseResponse = true;
    const github = new GitHub(async (args, input) => {
      const path = args[1];
      const method = args[args.indexOf("--method") + 1];
      if (!args.includes("--method")) {
        const names = path.includes("/issues/") ? labels : defined;

        return [[...names].map((name) => ({ name }))];
      }
      if (path === `repos/${repository}/labels`) {
        const body = input as { name: string };
        defined.add(body.name);
        writes.push("definition");
        if (uncertain === "definition" && loseResponse) {
          loseResponse = false;
          throw new Error("Lost definition response");
        }
        return { name: body.name };
      }
      if (method === "POST") {
        assert.deepEqual(input, { labels: ["factory:queued"] });
        labels.add("factory:queued");
        writes.push("addition");
        if (uncertain === "addition" && loseResponse) {
          loseResponse = false;
          throw new Error("Lost addition response");
        }
        return [...labels].map((name) => ({ name }));
      }
      assert.equal(method, "DELETE");
      assert.equal(path, `repos/${repository}/issues/1/labels/factory%3Aready`);
      labels.delete("factory:ready");
      writes.push("removal");
      if (uncertain === "removal" && loseResponse) {
        loseResponse = false;
        throw new Error("Lost removal response");
      }
      return null;
    });
    if (uncertain === "definition") {
      await github.setRunLabel(repository, 1, "factory:queued");
    } else {
      await assert.rejects(
        github.setRunLabel(repository, 1, "factory:queued"),
        /Lost/,
      );
    }
    await github.setRunLabel(repository, 1, "factory:queued");
    await github.setRunLabel(repository, 1, "factory:queued");
    assert.deepEqual([...labels].sort(), [
      "bug",
      "factory:custom",
      "factory:queued",
    ]);
    assert.deepEqual(writes, ["definition", "addition", "removal"]);
  });
}

test("un error real al crear una etiqueta no se oculta ni retira la autorización", async () => {
  const github = new GitHub(async (args) => {
    if (args.includes("--method")) {
      throw new Error("Write permission denied");
    }
    return [[{ name: "factory:ready" }]];
  });
  await assert.rejects(
    github.setRunLabel("team/product", 1, "factory:queued"),
    /Write permission denied/,
  );
});

test("los issues distinguen cola, trabajo, respuesta humana, revisión, cierre y parada", async () => {
  const labels = new Map<number, IssueLabel>();
  const github: GitHubPort = {
    async ready() {
      return [];
    },
    async setRunLabel(_repository, issue, label) {
      const run = s.workflow
        .list()
        .find((run) => run.request?.number === issue)!;
      assert.deepEqual(run.issueLabel, { name: label, state: "intent" });
      labels.set(issue, label);
    },
  };
  const s = publicationFixture({ github });
  try {
    const run = await s.start();
    assert.equal(labels.get(1), "factory:in-progress");
    await s.workflow.observe([
      {
        repository: s.project.repository,
        number: 2,
        title: "Next issue",
        body: "Another change",
        author: "owner",
        url: `https://github.com/${s.project.repository}/issues/2`,
      },
    ]);
    assert.equal(labels.get(2), "factory:queued");
    assert.equal(s.workflow.factory.active, run.id);
    s.emit({
      type: "pending",
      pending: [{ id: "question", kind: "question", text: "Which title?" }],
    });
    await s.workflow.poll();
    assert.equal(labels.get(1), "factory:needs-human");
    s.emit({ type: "pending", pending: [] });
    s.commit("footer.txt", "Candidate", "Footer");
    s.finish();
    await s.workflow.poll();
    assert.equal(labels.get(1), "factory:in-progress");
    assert.equal(
      s.facts.comments.filter((comment) => comment.source === "issue").length,
      0,
    );
    const head = s.git("rev-parse", "HEAD");
    s.facts.preview = {
      id: "deployment-1",
      head,
      servedHead: head,
      repository: s.project.repository,
      projectId: "catalogue",
      environment: "Preview",
      state: "success",
      url: "https://catalogue.vercel.app",
      access: "verified",
    };
    await s.workflow.poll();
    assert.equal(labels.get(1), "factory:pending-review");
    assert.equal(labels.get(2), "factory:queued");
    assert.equal(s.workflow.view(run.id)?.publication?.acceptance, undefined);
    const notice = s.facts.comments.find(
      (comment) => comment.source === "issue",
    )!;
    assert.match(notice.body, /listo para validar/);
    assert.match(notice.body, /haz merge de la PR/);
    assert.ok(notice.body.includes(s.facts.preview.url!));
    assert.ok(notice.body.includes(s.facts.pull!.url));
    assert.ok(!notice.body.includes(head));
    assert.match(notice.body, /responde en este issue con tu mensaje/);
    assert.match(notice.body, /`Cancelar`/);
    await s.workflow.poll();
    assert.equal(
      s.facts.comments.filter((comment) => comment.source === "issue").length,
      1,
    );
    s.merge();
    await s.workflow.poll();
    assert.equal(labels.get(1), "factory:completed");
    assert.equal(labels.get(2), "factory:in-progress");
    await s.workflow.stop(s.workflow.factory.active!);
    assert.equal(labels.get(2), "factory:stopped");
  } finally {
    s.close();
  }
});

test("una etiqueta incierta mantiene la cola, sobrevive al reinicio y no duplica el encargo", async () => {
  const labels = new Map<number, IssueLabel>();
  let uncertain = true;
  let writes = 0;
  const github: GitHubPort = {
    async ready() {
      return [
        {
          repository: s.project.repository,
          number: 1,
          title: "Catalogue",
          body: "Show catalogue",
          author: "owner",
          url: `https://github.com/${s.project.repository}/issues/1`,
        },
      ];
    },
    async setRunLabel(_repository, issue, label) {
      if (labels.get(issue) !== label) {
        labels.set(issue, label);
        writes++;
      }
      if (uncertain) {
        uncertain = false;
        throw new Error("Label confirmation lost");
      }
    },
  };
  const s = verificationFixture({ github });
  try {
    await s.workflow.poll();
    const queued = s.workflow.list()[0];
    assert.equal(queued.status, "queued");
    assert.equal(queued.issueLabel?.state, "intent");
    assert.match(s.workflow.observation.error!, /Label confirmation lost/);
    assert.equal(s.tasks.length, 0);
    s.reopen();
    await s.workflow.poll();
    assert.equal(s.workflow.list().length, 1);
    assert.equal(s.tasks.length, 1);
    assert.equal(
      s.workflow.view(queued.id)?.issueLabel?.name,
      "factory:in-progress",
    );
    assert.equal(s.workflow.view(queued.id)?.issueLabel?.state, "confirmed");
    assert.equal(writes, 2);
  } finally {
    s.close();
  }
});

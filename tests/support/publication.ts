import assert from "node:assert/strict";
import type {
  PublicationPort,
  PublicationFacts,
  ProductionPort,
} from "../../src/application/publication.ts";
import { verificationFixture } from "./verification.ts";

export function publicationFixture(
  options: { verify?: ProductionPort["verify"]; origin?: string } = {},
) {
  const writes: { kind: string; body?: string }[] = [];
  const facts: PublicationFacts = {
    request: {
      title: "Accessible catalogue",
      body: "## Acceptance criteria\n- Keep keyboard navigation.\n- Show the catalogue.",
      open: true,
    },
    remoteHead: null,
    pull: null,
    comments: [],
    preview: null,
    status: null,
  };
  let clock = Date.now();
  let writer = true;
  let observationError = false;
  let uncertain: string | null = null;
  let inspections = 0;
  const port: PublicationPort = {
    async inspect() {
      inspections++;
      if (observationError) throw new Error("GitHub unavailable");
      return structuredClone(facts);
    },
    async push(context) {
      writes.push({ kind: "push" });
      facts.remoteHead = context.head;
      if (uncertain === "push") {
        uncertain = null;
        throw new Error("Lost push response");
      }
    },
    async openPull(context) {
      writes.push({ kind: "pull" });
      facts.pull = {
        number: 2,
        url: `https://github.com/${context.repository}/pull/2`,
        head: context.head,
        base: "main",
        open: true,
        merged: false,
      };
      if (uncertain === "pull") {
        uncertain = null;
        throw new Error("Lost PR response");
      }
      return facts.pull;
    },
    async comment(context, body) {
      writes.push({ kind: "comment", body });
      const comment = {
        id: `comment-${writes.length}`,
        url: `${facts.pull!.url}#issuecomment-${writes.length}`,
        body,
        author: "shared",
        human: true,
        createdAt: (clock += 1000),
        updatedAt: clock,
        source: "pull" as const,
      };
      facts.comments.push(comment);
      if (uncertain === "comment") {
        uncertain = null;
        throw new Error("Lost comment response");
      }
      return comment;
    },
    async status(context, state) {
      writes.push({ kind: state });
      facts.status = { head: context.head, state };
      if (uncertain === "status") {
        uncertain = null;
        throw new Error("Lost status response");
      }
    },
    async canWrite() {
      return writer;
    },
    async prepareHead() {
      writes.push({ kind: "prepare-head" });
    },
  };
  let ready = false;
  let publicFailure = false;
  let fault = "";
  const production: ProductionPort = {
    async inspect(context, head) {
      if (fault === "query")
        throw new Error("Production observation unavailable");
      const deployment: Awaited<ReturnType<ProductionPort["inspect"]>> = ready
        ? {
            id: "production-1",
            head,
            repository: context.repository,
            projectId: context.project.publication.projectId,
            environment: "Production",
            state: "success",
            url: "https://catalogue-prod.vercel.app",
            access: "pending",
            servedHead: null,
          }
        : null;
      if (
        deployment &&
        ["head", "repository", "projectId", "environment"].includes(fault)
      )
        Object.assign(deployment, { [fault]: "wrong" });
      if (deployment && fault === "failure") deployment.state = "failure";
      return deployment;
    },
    async verify(context, head, checks) {
      if (options.verify) return options.verify(context, head, checks);
      return {
        origin: context.project.publication.productionOrigin,
        servedHead: fault === "marker" ? "b".repeat(40) : head,
        browser: "Chrome test transport",
        checks: (fault === "coverage" ? checks.slice(1) : checks).map(
          (check) => ({
            check,
            observed: publicFailure ? "Wrong page" : "Expected content visible",
            passed: !publicFailure,
          }),
        ),
        screenshots: [],
      };
    },
    async comment(context, body) {
      const persisted = s.workflow.view(context.runId)!;
      assert.ok(persisted.publication?.production?.evidencePartId);
      assert.equal(persisted.publication?.production?.status, "verified");
      const comment = await port.comment(context, body);
      comment.source = "issue";
      comment.url = `https://github.com/${context.repository}/issues/${context.issue}#issuecomment-${comment.id}`;
      Object.assign(facts.comments.at(-1)!, comment);
      return comment;
    },
    async closeIssue(context) {
      assert.ok(
        s.workflow.view(context.runId)!.publication?.production?.report,
      );
      writes.push({ kind: "close-issue" });
      facts.request.open = false;
      if (uncertain === "close-issue") {
        uncertain = null;
        throw new Error("Lost close response");
      }
    },
  };
  const plan =
    "\n\n## Production checks\n```factory-production\n" +
    JSON.stringify([
      { criterion: 1, path: "/", selector: "nav", text: "Keyboard navigation" },
      { criterion: 2, path: "/", selector: "h1", text: "Catalogue" },
    ]) +
    "\n```\n";
  facts.request.body += plan;
  const s = verificationFixture({
    publication: port,
    production,
    body: facts.request.body,
  });

  if (options.origin) s.project.publication.productionOrigin = options.origin;

  return {
    ...s,
    get workflow() {
      return s.workflow;
    },
    get directory() {
      return s.directory;
    },
    writes,
    facts,
    merge() {
      Object.assign(facts.pull!, {
        merged: true,
        open: false,
        mergeSha: "a".repeat(40),
        mergedAt: clock + 1000,
        mergedBy: "maintainer",
      });
    },
    productionFault(value: string) {
      fault = value;
    },
    productionReady() {
      ready = true;
    },
    publicFailure(value: boolean) {
      publicFailure = value;
    },
    get inspections() {
      return inspections;
    },
    writer(value: boolean) {
      writer = value;
    },
    observationFails(value: boolean) {
      observationError = value;
    },
    uncertainEffect(value: string) {
      uncertain = value;
    },
    async candidate(contents = "Candidate footer") {
      const run = await s.start();
      s.commit("footer.txt", contents, "Add footer");
      s.finish();
      await s.workflow.poll();
      const head = s.git("rev-parse", "HEAD");
      facts.preview = {
        id: "deployment-1",
        head,
        repository: s.project.repository,
        projectId: "catalogue",
        environment: "Preview",
        state: "success",
        url: "https://catalogue-unique.vercel.app",
        access: "verified",
        servedHead: head,
      };
      return run;
    },
    comment(
      body?: string,
      change: Partial<PublicationFacts["comments"][number]> = {},
    ) {
      const head = facts.pull!.head;
      const comment = {
        id: `human-${facts.comments.length}`,
        url: `${facts.pull!.url}#issuecomment-human`,
        body:
          body ??
          `Acepto la versión ${head} y su preview ${facts.preview!.url}.`,
        author: "shared",
        human: true,
        createdAt: (clock += 1000),
        updatedAt: clock,
        source: "issue" as const,
        ...change,
      };
      facts.comments.push(comment);
      return comment;
    },
  };
}

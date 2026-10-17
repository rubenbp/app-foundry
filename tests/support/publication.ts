import type {
  PublicationPort,
  PublicationFacts,
} from "../../src/application/publication.ts";
import { verificationFixture } from "./verification.ts";

export function publicationFixture() {
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
  const s = verificationFixture({ publication: port });

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

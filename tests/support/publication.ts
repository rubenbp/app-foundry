import assert from "node:assert/strict";
import type {
  PublicationPort,
  PublicationFacts,
} from "../../src/application/publication/ports.ts";
import { verificationFixture } from "./verification.ts";
import type { GitHubPort } from "../../src/application/ports.ts";
import type { IssueConversation } from "../../src/application/issueConversation.ts";

export const catalogueDelivery = `feat(catálogo): mostrar el catálogo con navegación por teclado

## Resumen
Las personas pueden consultar el catálogo y recorrerlo con el teclado. Se conserva el pie existente. El pago queda fuera de esta entrega. No hay migraciones ni variables nuevas.

## Evidencia
Antes faltaba el catálogo. Después se puede consultar sin usar el ratón.
Prueba de catálogo: node check.mjs, exit 0.
- [ ] Abrir el catálogo y recorrerlo con Tab.
- [ ] Comprobar el mensaje cuando no hay productos.
- [ ] Comprobar el aviso si falla la carga.

## Riesgo de fusión
Revertir restaura la vista anterior. No deja datos que recuperar ni requiere activar servicios.`;

export function publicationFixture(
  options: {
    body?: string;
    issueConversation?: IssueConversation;
    github?: GitHubPort;
  } = {},
) {
  const writes: { kind: string; title?: string; body?: string }[] = [];
  const description = { title: "", body: "" };
  const issue = {
    title: "Accessible catalogue",
    body:
      options.body ??
      "## Acceptance criteria\n- Keep keyboard navigation.\n- Show the catalogue.",
    open: true,
  };
  const facts: PublicationFacts = {
    request: issue,
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
  let statusAt = clock;
  let inspections = 0;
  let onInspect:
    | ((
        inspection: number,
      ) => PublicationFacts | void | Promise<PublicationFacts | void>)
    | undefined;
  const port: PublicationPort = {
    async inspect() {
      inspections++;
      const observed = await onInspect?.(inspections);
      if (observationError) {
        throw new Error("GitHub unavailable");
      }
      return structuredClone(observed ?? facts);
    },
    async push(context) {
      writes.push({ kind: "push" });
      facts.remoteHead = context.head;
      if (facts.pull) {
        facts.pull.head = context.head;
      }
      if (uncertain === "push") {
        uncertain = null;
        throw new Error("Lost push response");
      }
    },
    async openPull(context) {
      writes.push({ kind: "pull", ...context.description });
      Object.assign(description, context.description);
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
    async updatePull(context) {
      assert.ok(facts.pull?.open);
      assert.equal(facts.pull.head, context.head);
      writes.push({ kind: "description", ...context.description });
      Object.assign(description, context.description);
      if (uncertain === "description") {
        uncertain = null;
        throw new Error("Lost description response");
      }
      return facts.pull;
    },
    async status(context, state) {
      writes.push({ kind: state });
      statusAt = clock = Math.max(clock, Date.now());
      facts.status = { head: context.head, state, at: statusAt };
      if (uncertain === "status") {
        uncertain = null;
        throw new Error("Lost status response");
      }
      return { at: statusAt };
    },
    async commentIssue() {
      throw new Error("Issue comment transport not initialized");
    },
    async closeIssue() {
      throw new Error("Issue closure transport not initialized");
    },
    async canWrite(_repository, author) {
      return writer && author !== "outsider";
    },
    async prepareHead() {
      writes.push({ kind: "prepare-head" });
    },
  };
  port.commentIssue = async (context, body) => {
    const integrated = body.includes(":integration:");
    assert.ok(
      s.workflow.view(context.runId)!.publication?.[
        integrated ? "acceptance" : "report"
      ],
    );
    writes.push({ kind: "issue-comment", body });
    const comment = {
      id: `comment-${writes.length}`,
      url: `https://github.com/${context.repository}/issues/${context.issue}#issuecomment-${writes.length}`,
      body,
      author: "shared",
      human: true,
      createdAt: (clock = Math.max(clock, Date.now())),
      updatedAt: clock,
      source: "issue" as const,
    };
    facts.comments.push(comment);
    if (uncertain === (integrated ? "integration-report" : "review-notice")) {
      uncertain = null;
      throw new Error("Lost issue comment response");
    }
    return comment;
  };
  port.closeIssue = async (context) => {
    assert.ok(s.workflow.view(context.runId)!.publication?.integrationReport);
    writes.push({ kind: "close-issue" });
    facts.request.open = false;
    if (uncertain === "close-issue") {
      uncertain = null;
      throw new Error("Lost close response");
    }
  };
  const s = verificationFixture({
    publication: port,
    body: issue.body,
    issueConversation: options.issueConversation,
    github: options.github,
  });

  return {
    ...s,
    get workflow() {
      return s.workflow;
    },
    get directory() {
      return s.directory;
    },
    writes,
    description,
    get sessions() {
      return s.sessions;
    },
    facts,
    issue,
    onInspect(
      callback: (
        inspection: number,
      ) => PublicationFacts | void | Promise<PublicationFacts | void>,
    ) {
      onInspect = callback;
    },
    merge() {
      facts.mergeStatus = facts.status
        ? { ...facts.status, at: statusAt }
        : null;
      facts.preview = null;
      Object.assign(facts.pull!, {
        merged: true,
        open: false,
        mergeSha: "a".repeat(40),
        mergedAt: clock + 1000,
        mergedBy: "maintainer",
      });
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
    async candidate(
      contents = "Candidate footer",
      delivery = catalogueDelivery,
    ) {
      const run = await s.start();
      s.commit("footer.txt", contents, "Add footer");
      s.finish(delivery);
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
        createdAt: (clock = Math.max(clock + 1, Date.now())),
        updatedAt: clock,
        source: "issue" as const,
        ...change,
      };
      facts.comments.push(comment);
      return comment;
    },
  };
}

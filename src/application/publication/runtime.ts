import type { Factory } from "../factory.ts";
import { sanitizedRecord } from "../sanitize.ts";
import type { Run } from "../../domain/run.ts";
import type {
  PublicationContext,
  PublicationFacts,
  PublicationPort,
} from "./ports.ts";
import { canMerge } from "./reviewPolicy.ts";

class StatusSkippedAfterMerge extends Error {}

export class ObservedMerge extends Error {
  readonly facts: PublicationFacts;

  constructor(facts: PublicationFacts) {
    super("Human merge observed during candidate publication");
    this.facts = facts;
  }
}

export class PublicationRuntime {
  readonly factory: Factory;
  readonly port: PublicationPort;
  stopping = false;

  constructor(factory: Factory, port: PublicationPort) {
    this.factory = factory;
    this.port = port;
  }

  save(run: Run) {
    this.factory.assertRunning(run.id);
    this.factory.persist({
      ...run,
      publication: sanitizedRecord(run.publication, this.factory.clean),
    });
  }

  context(run: Run): PublicationContext {
    return {
      repository: run.request!.repository,
      issue: run.request!.number,
      runId: run.id,
      head: run.publication!.head,
      project: run.request!.configuration,
      workspace: run.workspace!,
      pull: run.publication!.pull,
    };
  }

  async effect<T>(
    run: Run,
    key: string,
    observe: () => Promise<T | undefined>,
    perform: () => Promise<T>,
  ): Promise<T> {
    this.factory.assertRunning(run.id);
    if (this.stopping) {
      throw new Error("Publication stopping; no new remote effects allowed");
    }
    // Consulta antes de cada reintento, incluso si se perdió la confirmación tras el éxito remoto.
    const found = await observe();
    this.factory.assertRunning(run.id);
    let result: T;
    if (found !== undefined) {
      result = found;
    } else {
      if (this.stopping) {
        throw new Error("Publication stopping; no new remote effects allowed");
      }
      run.publication!.operations[key] = {
        state: "intent",
        at: this.factory.now(),
      };
      this.factory.record(run, "intent", key);
      this.save(run);
      result = await perform();
      this.factory.assertRunning(run.id);
    }
    if (run.publication!.operations[key]?.state !== "confirmed") {
      run.publication!.operations[key] = {
        state: "confirmed",
        at: this.factory.now(),
      };
      this.factory.record(run, "confirmed", key);
      this.save(run);
    }
    return result;
  }

  async facts(run: Run, preview = true) {
    const facts = await this.port.inspect(this.context(run), { preview });
    // Cada lectura previa a la integración puede coincidir con la integración humana. Cambia de estado antes de
    // considerar que la PR cerrada o la vista previa retirada invalidan el candidato.
    if (
      facts.pull?.merged &&
      !run.publication!.integratedAcceptance &&
      !run.publication!.recoveryRequired
    ) {
      throw new ObservedMerge(facts);
    }
    return facts;
  }

  async setStatus(
    run: Run,
    state: "pending" | "success" | "failure" | "error",
  ) {
    const context = this.context(run);
    try {
      await this.effect(
        run,
        `status:${context.head}:${state}`,
        async () => {
          const facts = await this.facts(run, state === "success");
          if (facts.pull?.merged) {
            throw new StatusSkippedAfterMerge();
          }
          if (state === "success" && !(await canMerge(run, facts, this.port))) {
            throw new Error(
              "Candidate changed before favorable merge status; acceptance revoked",
            );
          }
          const status = facts.status;

          return status?.head === context.head && status.state === state
            ? true
            : undefined;
        },
        async () => {
          await this.port.status(context, state);
          return true;
        },
      );
    } catch (error) {
      if (!(error instanceof StatusSkippedAfterMerge)) {
        throw error;
      }
      this.factory.record(
        run,
        "status-skipped",
        `${state}: PR already integrated; no status effect confirmed`,
      );
      this.save(run);
    }
  }

  async comment(run: Run, key: string, text: string) {
    const origin = `<!-- app-foundry:${run.id}:${key} -->`;
    const body = this.factory.clean(
      `${origin}\n${text}`,
      Number.MAX_SAFE_INTEGER,
    ).text;
    if (body.length > 60_000) {
      throw new Error("Publication comment exceeds GitHub limit");
    }
    const result = await this.effect(
      run,
      key,
      async () => {
        const facts = await this.facts(run, false);
        if (
          !facts.request.open ||
          facts.request.title !== run.request!.title ||
          facts.request.body !== run.request!.body ||
          facts.pull?.head !== run.publication!.head ||
          !facts.pull.open ||
          facts.pull.merged
        ) {
          throw new Error(
            "Request or PR changed before publishing review guidance",
          );
        }

        return facts.comments.find((comment) => comment.body === body);
      },
      () => this.port.comment(this.context(run), body),
    );
    if (!run.publication!.ownComments.includes(result.id)) {
      run.publication!.ownComments.push(result.id);
    }
    this.save(run);
    return result;
  }
}

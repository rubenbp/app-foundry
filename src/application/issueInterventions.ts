import {
  firstInterventionResponse,
  interventionComment,
  pendingIntervention,
} from "../domain/intervention.ts";
import type { Factory } from "./factory.ts";
import type { IssueConversation } from "./issueConversation.ts";
import { sanitizedRecord } from "./sanitize.ts";

export class IssueInterventions {
  private factory: Factory;
  private conversation: IssueConversation;
  private restore: () => Promise<void>;

  constructor(
    factory: Factory,
    conversation: IssueConversation,
    restore: () => Promise<void>,
  ) {
    this.factory = factory;
    this.conversation = conversation;
    this.restore = restore;
  }

  async poll() {
    const id = this.factory.active;
    const run = id ? this.factory.view(id) : null;
    const intervention = pendingIntervention(run?.interventions);
    if (!run?.request || run.status !== "waiting" || !intervention) {
      return;
    }
    const { repository, number } = run.request;
    const comments = await this.conversation.comments(repository, number);
    this.factory.assertRunning(run.id);
    if (this.factory.view(run.id)?.status !== "waiting") {
      return;
    }
    if (!intervention.comment) {
      const body = interventionComment(run.id, intervention);
      const publishing = this.factory.view(run.id)!;
      this.factory.record(
        publishing,
        "intent",
        `Publish agent intervention ${intervention.id} in the issue`,
      );
      this.factory.persist(publishing);
      const comment =
        comments.find((comment) => comment.body === body) ??
        (await this.conversation.comment(repository, number, body));
      this.factory.assertRunning(run.id);
      const current = this.factory.view(run.id)!;
      current.interventions!.find(
        (item) => item.id === intervention.id,
      )!.comment = sanitizedRecord(comment, this.factory.clean);
      this.factory.record(current, "intervention-published", comment.url);
      this.factory.persist(current);
      return;
    }
    const response =
      intervention.response ??
      firstInterventionResponse(comments, intervention.comment);
    if (!response) {
      return;
    }
    const current = this.factory.view(run.id)!;
    current.interventions!.find(
      (item) => item.id === intervention.id,
    )!.response = sanitizedRecord(response, this.factory.clean);
    this.factory.record(current, "human-response", response.url);
    this.factory.persist(current);
    try {
      await this.restore();
      this.factory.assertRunning(run.id);
      const ready = this.factory.view(run.id)!;
      ready.status = "running";
      ready.pending = [];
      this.factory.record(
        ready,
        "intent",
        `Continue thread ${run.sessionId} with issue comment ${response.id}`,
      );
      this.factory.persist(ready);
      await this.factory.agent.send(run.sessionId!, response.body);
      this.factory.assertRunning(run.id);
      const delivered = this.factory.view(run.id)!;
      delivered.interventions!.find(
        (item) => item.id === intervention.id,
      )!.deliveredAt = this.factory.now();
      this.factory.record(
        delivered,
        "response-delivered",
        `Comment ${response.id} delivered to the same agent thread`,
      );
      this.factory.persist(delivered);
    } catch (error) {
      this.factory.assertWritable();
      this.factory.ingest(run.id, {
        type: "error",
        text: `Agent continuation unconfirmed: ${String(error)}. The reply will not be automatically resent.`,
      });
    }
  }
}

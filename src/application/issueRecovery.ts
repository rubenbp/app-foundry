import {
  recoveryActions,
  recoveryCommand,
  recoveryNotice,
} from "../domain/recovery.ts";
import type { RecoveryCommand } from "../domain/recovery.ts";
import type { Factory } from "./factory.ts";
import type { IssueConversation } from "./issueConversation.ts";
import { sanitizedRecord } from "./sanitize.ts";

export class IssueRecovery {
  private factory: Factory;
  private conversation: IssueConversation;
  private recover: (id: string, command: RecoveryCommand) => Promise<string>;

  constructor(
    factory: Factory,
    conversation: IssueConversation,
    recover: (id: string, command: RecoveryCommand) => Promise<string>,
  ) {
    this.factory = factory;
    this.conversation = conversation;
    this.recover = recover;
  }

  async notify() {
    const run = this.factory.view(this.factory.active ?? "");
    if (
      !run?.request ||
      run.status !== "intervention" ||
      run.recovery?.notice
    ) {
      return;
    }
    const notice = await this.conversation.comment(
      run.request.repository,
      run.request.number,
      recoveryNotice(run),
    );
    this.factory.assertRunning(run.id);
    const current = this.factory.view(run.id)!;
    (current.recovery ??= { consumed: [] }).notice = sanitizedRecord(
      notice,
      this.factory.clean,
    );
    this.factory.record(current, "intervention-notified", notice.url);
    this.factory.persist(current);
  }

  async poll() {
    const run = this.factory.view(this.factory.active ?? "");
    if (!run?.request) {
      return;
    }
    const comments = await this.conversation.comments(
      run.request.repository,
      run.request.number,
    );
    this.factory.assertRunning(run.id);
    for (const comment of comments.toSorted(
      (a, b) =>
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id, "en", { numeric: true }),
    )) {
      const current = this.factory.view(run.id)!;
      const recovery = (current.recovery ??= { consumed: [] });
      if (
        !comment.human ||
        comment.body.includes("<!-- app-foundry:") ||
        recovery.consumed.includes(comment.id) ||
        current.interventions?.some(
          (item) => item.response?.id === comment.id,
        ) ||
        comment.createdAt < current.startedAt
      ) {
        continue;
      }
      const command = recoveryCommand(comment.body);
      if (!command) {
        continue;
      }
      // Las respuestas libres a dudas no se reinterpretan como órdenes de corrección.
      if (current.status === "waiting" && command.kind !== "cancel") {
        continue;
      }
      if (
        command.kind === "retry" &&
        (!recovery.notice ||
          comment.createdAt < recovery.notice.createdAt ||
          comment.id === recovery.notice.id)
      ) {
        continue;
      }
      recovery.consumed.push(comment.id);
      this.factory.record(
        current,
        "recovery-requested",
        `${command.kind}: ${comment.url}`,
      );
      this.factory.persist(current);
      let message: string;
      if (!recoveryActions(current).includes(command.kind)) {
        message = "La orden no corresponde al estado actual de la Ejecución.";
      } else {
        delete recovery.notice;
        this.factory.persist(current);
        try {
          message = await this.recover(run.id, command);
        } catch (error) {
          this.factory.assertWritable();
          const failed = this.factory.view(run.id)!;
          failed.status = "intervention";
          failed.error = this.factory.clean(String(error)).text;
          this.factory.record(failed, "recovery-error", failed.error);
          this.factory.persist(failed);
          message = `No se ha podido completar la recuperación: ${failed.error}`;
        }
      }
      await this.conversation.comment(
        run.request.repository,
        run.request.number,
        `${message}\n\n<!-- app-foundry:recovery-response:${run.id}:${comment.id} -->`,
      );
      return;
    }
  }
}

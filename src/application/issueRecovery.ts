import {
  recoveryActions,
  issueRecoveryCommand,
  recoveryNotice,
} from "../domain/recovery.ts";
import type { RecoveryCommand } from "../domain/recovery.ts";
import type { Factory } from "./factory.ts";
import type { IssueConversation } from "./issueConversation.ts";
import type { IssueComment } from "../domain/intervention.ts";
import type { Run } from "../domain/run.ts";
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
      (run.phase === "publication" &&
        run.publication?.failureKind === "observation" &&
        !run.publication.recoveryRequired &&
        !run.publication.blocked &&
        !run.recovery?.pending) ||
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
    this.factory.recordIssueComment(current, notice);
    this.factory.persist(current);
  }

  async poll() {
    const run =
      this.factory
        .list()
        .find(
          (item) => item.stopReason !== "discarded" && item.recovery?.response,
        ) ?? this.factory.view(this.factory.active ?? "");
    if (!run?.request || run.stopReason === "discarded") {
      return;
    }
    const comments = await this.conversation.comments(
      run.request.repository,
      run.request.number,
    );
    this.factory.assertWritable();
    if (run.recovery?.response) {
      await this.flushResponse(run.id, comments);
    }
    if (this.factory.active !== run.id) {
      return;
    }
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
        current.history.some((entry) => entry.comment?.id === comment.id) ||
        recovery.consumed.includes(comment.id) ||
        current.interventions?.some(
          (item) => item.response?.id === comment.id,
        ) ||
        comment.createdAt < current.startedAt
      ) {
        continue;
      }
      const command = issueRecoveryCommand(current, comment);
      if (!command) {
        continue;
      }
      // Las respuestas libres a dudas no se reinterpretan como órdenes de corrección.
      if (current.status === "waiting" && command.kind !== "cancel") {
        continue;
      }
      recovery.consumed.push(comment.id);
      this.factory.record(
        current,
        "recovery-requested",
        `${command.kind}: ${comment.url}`,
      );
      this.factory.persist(current);
      const rejection = this.rejection(current, comment, command);
      if (rejection) {
        await this.respond(run.id, comment.id, rejection);
        return;
      }
      const effective =
        command.kind === "retry" && recovery.pending
          ? recovery.pending.command
          : command;
      if (command.kind !== "retry" || !recovery.pending) {
        recovery.pending = {
          command: sanitizedRecord(effective, this.factory.clean),
          commentId: comment.id,
          delivery: "pending",
        };
      }
      this.factory.persist(current);
      let message: string;
      try {
        const acknowledgement = await this.respond(
          run.id,
          comment.id,
          "Orden recibida. La recuperación está en curso.",
          "start",
        );
        const acknowledged = this.factory.view(run.id)!;
        acknowledged.recovery!.lastAction = {
          startedAt: acknowledgement.createdAt,
          finishedAt: Number.MAX_SAFE_INTEGER,
        };
        const recovery = acknowledged.recovery!;
        delete recovery.notice;
        this.factory.persist(acknowledged);
        message = await this.recover(run.id, effective);
        const applied = this.factory.view(run.id)!;
        delete applied.recovery!.pending;
        this.factory.persist(applied);
      } catch (error) {
        this.factory.assertWritable();
        const failed = this.factory.view(run.id)!;
        failed.status = "intervention";
        failed.error = this.factory.clean(String(error)).text;
        this.factory.record(failed, "recovery-error", failed.error);
        this.factory.persist(failed);
        message = `No se ha podido completar la recuperación. Se conserva la orden pendiente. Detalle: ${failed.error}`;
      }
      await this.respond(run.id, comment.id, message);
      return;
    }
  }

  private rejection(run: Run, comment: IssueComment, command: RecoveryCommand) {
    const recovery = run.recovery!;
    const action = recovery.lastAction;
    if (
      action &&
      command.kind !== "cancel" &&
      comment.createdAt >= action.startedAt &&
      comment.createdAt <= action.finishedAt
    ) {
      return "La recuperación ya estaba en curso al recibir esta orden. No se ha programado otro Intento. Si vuelve a fallar, publica una nueva orden después del resultado.";
    }
    if (!recoveryActions(run).includes(command.kind)) {
      return command.kind === "retry"
        ? run.status === "awaiting_review"
          ? "No hay una recuperación pendiente en el estado actual. Para hablar con el agente, responde en este issue con tu mensaje."
          : "No hay una recuperación pendiente en el estado actual. Para pedir cambios, usa Corregir: instrucciones."
        : "La orden no corresponde al estado actual de la Ejecución.";
    }
    if (recovery.pending && command.kind !== "cancel") {
      if (command.kind !== "retry") {
        return "Hay una orden pendiente. Usa Reintentar para retomarla o Cancelar para detener la Ejecución.";
      }
      if (recovery.pending.delivery === "uncertain") {
        return "El envío de la orden al agente no está confirmado. Se requiere inspección local antes de continuar; no se reenviará automáticamente.";
      }
    }
    if (
      command.kind === "retry" &&
      !recovery.pending &&
      (!recovery.notice || comment.createdAt < recovery.notice.createdAt)
    ) {
      return "No hay un aviso de intervención vigente para esta orden. Publica un nuevo Reintentar después del aviso actual.";
    }
    return null;
  }

  private async respond(
    id: string,
    commentId: string,
    message: string,
    kind = "response",
  ) {
    const run = this.factory.view(id)!;
    run.recovery!.response = {
      commentId,
      body: this.factory.clean(
        `${message}\n\n<!-- app-foundry:recovery-${kind}:${id}:${commentId} -->`,
        Number.MAX_SAFE_INTEGER,
      ).text,
    };
    this.factory.persist(run);
    return this.flushResponse(id);
  }

  private async flushResponse(id: string, comments?: IssueComment[]) {
    const run = this.factory.view(id)!;
    const response = run.recovery!.response!;
    const observed =
      comments ??
      (await this.conversation.comments(
        run.request!.repository,
        run.request!.number,
      ));
    const confirmed =
      observed.find((comment) => comment.body === response.body) ??
      (await this.conversation.comment(
        run.request!.repository,
        run.request!.number,
        response.body,
      ));
    // Cancellation can release the active run before its acknowledgement is published.
    this.factory.assertWritable();
    const current = this.factory.view(id)!;
    if (
      response.body.includes(`<!-- app-foundry:recovery-response:${id}:`) &&
      current.recovery!.lastAction?.finishedAt === Number.MAX_SAFE_INTEGER
    ) {
      current.recovery!.lastAction.finishedAt = confirmed.createdAt;
    }
    delete current.recovery!.response;
    this.factory.recordIssueComment(current, confirmed);
    this.factory.persist(current);
    return confirmed;
  }
}

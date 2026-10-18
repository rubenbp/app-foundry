import type {
  OpenCodeClient,
  V2Event,
  SessionMessageInfo,
} from "@opencode/client";
import type { Fact } from "../../application/agent.ts";
import type { Pending } from "../../domain/run.ts";
import { errorText } from "./errors.ts";

export class Observer {
  client: OpenCodeClient;
  sessionId: string;
  emit: (fact: Fact) => void;
  abort = new AbortController();
  timer: ReturnType<typeof setTimeout> | undefined;
  polling = false;
  pending = new Map<string, Pending>();

  constructor(
    client: OpenCodeClient,
    sessionId: string,
    emit: (fact: Fact) => void,
  ) {
    this.client = client;
    this.sessionId = sessionId;
    this.emit = emit;
  }

  async start() {
    let connected!: () => void;
    const ready = new Promise<void>((resolve) => {
      connected = resolve;
    });
    const stream = this.client.event.subscribe({ signal: this.abort.signal });
    const timeout = setTimeout(
      () => this.abort.abort(new Error("OpenCode stream connection timeout")),
      5000,
    );

    void (async () => {
      try {
        for await (const event of stream) {
          connected();
          clearTimeout(timeout);
          if (this.abort.signal.aborted) {
            break;
          }
          this.event(event);
        }

        if (!this.abort.signal.aborted) {
          this.emit({
            type: "gap",
            text: "OpenCode event stream ended; short transitions may be missing. Poll reconciliation continues without resending work.",
          });
        }
      } catch {
        if (!this.abort.signal.aborted) {
          this.emit({
            type: "gap",
            text: "OpenCode event stream interrupted. Poll reconciliation continues; replay is not assumed.",
          });
        }
      } finally {
        clearTimeout(timeout);
        connected();
      }
    })().catch(() => this.close());

    await ready;
    this.abort.signal.throwIfAborted();
  }

  message(message: SessionMessageInfo) {
    if (message.type !== "assistant") {
      return;
    }

    const t = message.tokens;
    const counters = t
      ? [t.input, t.output, t.reasoning, t.cache?.read, t.cache?.write]
      : [];

    this.emit({
      type: "usage",
      usage: {
        id: message.id,
        provider: message.model.providerID,
        model: message.model.id,
        tokens:
          t &&
          counters.length === 5 &&
          counters.every((n) => Number.isFinite(n) && n >= 0) &&
          counters.some((n) => n > 0)
            ? {
                input: t.input,
                output: t.output,
                reasoning: t.reasoning,
                cacheRead: t.cache.read,
                cacheWrite: t.cache.write,
              }
            : null,
        sdkCost:
          message.cost !== undefined &&
          Number.isFinite(message.cost) &&
          message.cost >= 0
            ? message.cost
            : null,
        completed: Boolean(message.time.completed),
      },
    });

    if (message.error) {
      this.emit({ type: "error", text: errorText(message.error) });
    }

    for (const [index, part] of message.content.entries()) {
      if (part.type === "text") {
        this.emit({
          type: "part",
          id: `${message.id}-text-${index}`,
          messageId: message.id,
          kind: "text",
          text: part.text,
        });
      }

      if (part.type === "tool") {
        const state = part.state;
        const content =
          "content" in state
            ? (state.content ?? [])
                .flatMap((c) => (c.type === "text" ? [c.text] : []))
                .join("\n")
            : "";
        this.emit({
          type: "part",
          id: part.id,
          messageId: message.id,
          kind: "tool",
          label: `${part.name} · ${state.status}`,
          text: JSON.stringify(
            {
              tool: part.name,
              status: state.status,
              input: state.input,
              output: content,
              error:
                state.status === "error" ? errorText(state.error) : undefined,
            },
            null,
            2,
          ),
        });
      }
    }
  }

  event(event: V2Event) {
    const data = event.data;
    if (!("sessionID" in data) || data.sessionID !== this.sessionId) {
      return;
    }
    if (event.type === "session.status") {
      this.emit({ type: "status", status: event.data.status.type });
    } else if (event.type === "session.step.started") {
      this.emit({ type: "status", status: "busy" });
    } else if (event.type === "session.step.failed") {
      this.emit({ type: "error", text: errorText(event.data.error) });
    } else if (event.type === "session.execution.failed") {
      this.emit({ type: "error", text: errorText(event.data.error) });
    } else if (event.type === "permission.asked") {
      const p = event.data;
      this.pending.set(p.id, {
        id: p.id,
        kind: "permission",
        text: `${p.action}: ${p.resources.join(", ")}`,
      });
      this.emit({ type: "pending", pending: [...this.pending.values()] });
    } else if (event.type === "permission.replied") {
      this.pending.delete(event.data.requestID);
      this.emit({ type: "pending", pending: [...this.pending.values()] });
    } else if (event.type.startsWith("session.tool.")) {
      this.emit({
        type: "status",
        status: event.type.slice("session.".length),
      });
    }
  }

  async poll() {
    if (this.polling || this.abort.signal.aborted) {
      return;
    }
    this.polling = true;
    try {
      const signal = AbortSignal.any([
        this.abort.signal,
        AbortSignal.timeout(5000),
      ]);
      const options = { signal, throwOnError: true as const };
      const [messages, active, permissions, forms] = await Promise.all([
        this.client.message.list(
          { sessionID: this.sessionId, limit: 200, order: "asc" },
          options,
        ),
        this.client.session.active(options),
        this.client.permission.request.list({}, options),
        this.client.form.list({}, options),
      ]);
      if (this.abort.signal.aborted) {
        return;
      }
      let page = messages;
      let last: SessionMessageInfo | undefined;
      const cursors = new Set<string>();
      while (true) {
        signal.throwIfAborted();
        const rows = page.data ?? [];
        for (const row of rows) {
          this.message(row);
          if (row.type === "assistant") {
            last = row;
          }
        }
        const next = page.cursor.next;
        if (!rows.length || !next) {
          break;
        }
        if (cursors.has(next)) {
          throw new Error(
            "OpenCode repeated a message cursor; coverage partial",
          );
        }
        cursors.add(next);
        page = await this.client.message.list(
          { sessionID: this.sessionId, limit: 200, cursor: next },
          options,
        );
      }
      const pending: Pending[] = [
        ...(permissions.data ?? [])
          .filter((p) => p.sessionID === this.sessionId)
          .map((p) => ({
            id: p.id,
            kind: "permission" as const,
            text: `${p.action}: ${p.resources.join(", ")}`,
          })),
        ...(forms.data ?? [])
          .filter((f) => f.sessionID === this.sessionId)
          .map((f) => ({
            id: f.id,
            kind: "question" as const,
            text:
              f.title +
              "\n" +
              f.fields.map((field) => field.title ?? field.key).join("\n"),
          })),
      ];
      this.pending = new Map(pending.map((p) => [p.id, p]));
      this.emit({ type: "pending", pending });
      this.emit({
        type: "status",
        status: active[this.sessionId] ? "busy" : "idle",
      });
      this.emit({ type: "observed" });
      if (
        !pending.length &&
        last?.type === "assistant" &&
        last.time.completed &&
        last.finish === "stop" &&
        !last.error
      ) {
        this.emit({
          type: "finished",
          text: last.content
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n"),
        });
      }
    } catch (error) {
      if (!this.abort.signal.aborted) {
        this.emit({
          type: "gap",
          text: `OpenCode observation failed: ${errorText(error)}. No task retry.`,
        });
      }
    } finally {
      this.polling = false;
    }
  }

  watch() {
    const tick = async () => {
      await this.poll();
      if (!this.abort.signal.aborted) {
        this.timer = setTimeout(() => {
          void tick().catch(() => this.close());
        }, 2000);
      }
    };
    void tick().catch(() => this.close());
  }

  close() {
    this.abort.abort();
    clearTimeout(this.timer);
  }
}

import type { Run } from "../domain/run.ts";

export interface RunFiles {
  /** Remove only this run's owned local files. Missing files are already removed. */
  remove(run: Run): void;
}

export class RunDeletionRejected extends Error {
  readonly reason: "missing" | "unfinished" | "busy";

  constructor(reason: RunDeletionRejected["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

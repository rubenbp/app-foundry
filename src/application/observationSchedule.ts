/** Live scheduling evidence; a process restart must never reuse an old timer. */
export type ObservationSchedule =
  | { state: "stopped" }
  | { state: "running"; startedAt: number }
  | { state: "scheduled"; nextAt: number };

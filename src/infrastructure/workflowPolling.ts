import type { ObservationSchedule } from "../application/observationSchedule.ts";

/** Serialize periodic observations and immediate candidate wakeups in the same loop. */
export function workflowPolling(
  poll: () => Promise<void>,
  onError: () => void,
  options: {
    now?: () => number;
    onSchedule?: (schedule: ObservationSchedule) => void;
  } = {},
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let requested = false;
  let halted = false;
  const now = options.now ?? Date.now;

  function wake() {
    if (halted) {
      return;
    }
    clearTimeout(timer);
    if (pending) {
      requested = true;
      return;
    }
    options.onSchedule?.({ state: "running", startedAt: now() });
    pending = Promise.resolve()
      .then(poll)
      .catch(onError)
      .finally(() => {
        pending = undefined;
        if (!halted) {
          const delayMs = requested ? 0 : 15_000;
          options.onSchedule?.({ state: "scheduled", nextAt: now() + delayMs });
          timer = setTimeout(wake, delayMs);
          requested = false;
        }
      });
  }

  return {
    wake,
    halt() {
      halted = true;
      clearTimeout(timer);
      options.onSchedule?.({ state: "stopped" });
    },
    get pending() {
      return pending;
    },
  };
}

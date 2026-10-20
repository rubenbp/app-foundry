/** Serialize periodic observations and immediate candidate wakeups in the same loop. */
export function workflowPolling(
  poll: () => Promise<void>,
  onError: () => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let requested = false;
  let halted = false;

  function wake() {
    if (halted) {
      return;
    }
    clearTimeout(timer);
    if (pending) {
      requested = true;
      return;
    }
    pending = Promise.resolve()
      .then(poll)
      .catch(onError)
      .finally(() => {
        pending = undefined;
        if (!halted) {
          timer = setTimeout(wake, requested ? 0 : 15_000);
          requested = false;
        }
      });
  }

  return {
    wake,
    halt() {
      halted = true;
      clearTimeout(timer);
    },
    get pending() {
      return pending;
    },
  };
}

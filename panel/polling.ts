export function poll<T>(
  url: () => string,
  receive: (value: T) => void,
  failed: () => void,
) {
  let closed = false;
  let timer: ReturnType<typeof setTimeout>;
  let controller: AbortController | undefined;
  const tick = async () => {
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 5000);
    try {
      const response = await fetch(url(), {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Observación local no disponible");
      }
      const value: T = await response.json();
      if (!closed) {
        receive(value);
      }
    } catch {
      if (!closed) {
        failed();
      }
    } finally {
      clearTimeout(timeout);
      if (!closed) {
        timer = setTimeout(() => {
          void tick();
        }, 2000);
      }
    }
  };
  void tick();
  return () => {
    closed = true;
    clearTimeout(timer);
    controller?.abort();
  };
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Run } from "../domain/run.ts";

/** Inspect only recorded identities. Never signal or stop an unverified process. */
export function assertRunProcessesStopped(dataDir: string, run: Run): void {
  const pids = new Set<number>();
  if (run.process) {
    pids.add(run.process.pid);
  }
  for (const check of run.verification?.checks ?? []) {
    if (check.pid != null) {
      pids.add(check.pid);
    }
  }
  // The connection can outlive a crash between spawning OpenCode and saving Run.process.
  let connection: string | undefined;
  try {
    connection = readFileSync(
      join(dataDir, "conversations", run.id, "connection.json"),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("No se pudo comprobar la conexión local del agente.", {
        cause: error,
      });
    }
  }
  if (connection !== undefined) {
    let saved: unknown;
    try {
      saved = JSON.parse(connection);
    } catch {
      throw new Error("El registro de conexión local del agente no es válido.");
    }
    if (
      !saved ||
      typeof saved !== "object" ||
      !("pid" in saved) ||
      typeof saved.pid !== "number"
    ) {
      throw new Error(
        "El registro de conexión local del agente no contiene un PID válido.",
      );
    }
    pids.add(saved.pid);
  }
  for (const pid of pids) {
    if (!Number.isSafeInteger(pid) || pid < 1) {
      throw new Error(
        "La Ejecución contiene un PID no válido; inspecciona sus procesos.",
      );
    }
    // A group can still contain children after its leader has exited.
    for (const target of [pid, -pid]) {
      try {
        process.kill(target, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          continue;
        }
        throw new Error(
          `No se pudo comprobar el proceso o grupo ${pid}; inspecciónalo antes de descartar.`,
          { cause: error },
        );
      }
      throw new Error(
        `El proceso o grupo ${pid} sigue activo. Detenlo manualmente antes de descartar la Ejecución.`,
      );
    }
  }
}

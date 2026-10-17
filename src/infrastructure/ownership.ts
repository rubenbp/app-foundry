import {
  mkdirSync,
  realpathSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { acquireLock } from "../lock.ts";
import type { FactoryConfig } from "../types.ts";
import type { WorkflowOwnership } from "../application/ports.ts";

export function acquireWorkflowOwnership(
  config: FactoryConfig,
): WorkflowOwnership {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const dataDir = realpathSync(config.dataDir);
  const releaseData = acquireLock(join(dataDir, "factory.lock"));
  let releaseProject: (() => void) | undefined;
  try {
    const identity = createHash("sha256")
      .update(config.managedProject!.repository.toLowerCase())
      .digest("hex");
    const root = join(
      realpathSync("/tmp"),
      `app-foundry-repository-${identity}`,
    );
    releaseProject = acquireLock(root + ".lock");
    const reservationPath = root + ".reservation.json";
    const reservation = () => {
      if (!existsSync(reservationPath)) return null;
      const value = JSON.parse(readFileSync(reservationPath, "utf8")) as {
        dataDir: string;
        runId: string;
      };
      if (value.dataDir !== dataDir || typeof value.runId !== "string")
        throw new Error(
          "Managed project reserved by uncertain work in another data root; inspect the reservation and owned processes",
        );
      return value.runId;
    };
    reservation();
    return {
      reservation,
      reserve(runId) {
        const previous = reservation();
        if (previous && previous !== runId)
          throw new Error("Managed project reserved by another Ejecución");
        if (!previous)
          writeFileSync(reservationPath, JSON.stringify({ dataDir, runId }), {
            flag: "wx",
            mode: 0o600,
          });
      },
      releaseRun(runId) {
        if (reservation() === runId) unlinkSync(reservationPath);
      },
      close() {
        releaseProject!();
        releaseData();
      },
    };
  } catch (error) {
    releaseProject?.();
    releaseData();
    throw error;
  }
}

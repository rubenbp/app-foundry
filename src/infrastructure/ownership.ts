import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { acquireLock } from "../lock.ts";
import type { FactoryConfig } from "../types.ts";

export function acquireWorkflowOwnership(config: FactoryConfig) {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const releaseData = acquireLock(
    join(realpathSync(config.dataDir), "factory.lock"),
  );
  try {
    const identity = createHash("sha256")
      .update(config.managedProject!.repository.toLowerCase())
      .digest("hex");
    const releaseProject = acquireLock(
      join(tmpdir(), `app-foundry-repository-${identity}.lock`),
    );

    return () => {
      releaseProject();
      releaseData();
    };
  } catch (error) {
    releaseData();
    throw error;
  }
}

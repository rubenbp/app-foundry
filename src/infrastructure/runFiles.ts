import { lstatSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Run } from "../domain/run.ts";
import type { RunFiles } from "../application/runDeletion.ts";
import { artifactPath } from "./persistence/artifactPath.ts";

export class LocalRunFiles implements RunFiles {
  private root: string;

  constructor(dataDir: string) {
    this.root = realpathSync(dataDir);
  }

  remove(run: Run) {
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(run.id)) {
      throw new Error("Invalid Ejecución identity for local cleanup");
    }
    if (realpathSync(this.root) !== this.root) {
      throw new Error("Local data root changed before cleanup");
    }
    // Check every parent before deleting anything. Recursive rm does not follow child symlinks.
    for (const name of ["workspaces", "conversations", "artifacts"]) {
      const directory = join(this.root, name);
      let stat;
      try {
        stat = lstatSync(directory);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          continue;
        }
        throw error;
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`Local cleanup requires an owned directory: ${name}`);
      }
    }
    for (const name of ["workspaces", "conversations"]) {
      rmSync(join(this.root, name, run.id), { recursive: true, force: true });
    }
    for (const part of run.parts) {
      const path = artifactPath(this.root, run.id, part.id);
      rmSync(path, { force: true });
      rmSync(path + ".tmp", { force: true });
    }
  }
}

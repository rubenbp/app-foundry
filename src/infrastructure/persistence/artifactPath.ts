import { createHash } from "node:crypto";
import { join } from "node:path";

export function artifactPath(root: string, runId: string, partId: string) {
  const name = createHash("sha256")
    .update(runId + ":" + partId)
    .digest("hex");

  return join(root, "artifacts", name + ".txt");
}

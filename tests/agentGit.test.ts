import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { installLocalGitGuard } from "../src/infrastructure/agentGit.ts";
import { reducedEnvironment } from "../src/infrastructure/process.ts";
import { verificationFixture } from "./support/verification.ts";

test("an agent build can read its version and commit a candidate while its Git process guard rejects remote effects and changed identity", async () => {
  const s = verificationFixture();
  try {
    const run = await s.start();
    const runtime = mkdtempSync(join(tmpdir(), "foundry-agent-git-"));
    const guard = installLocalGitGuard(
      runtime,
      s.directory,
      s.project.repository,
    );
    const env = {
      ...reducedEnvironment(runtime),
      PATH: `${guard}:${process.env.PATH}`,
    };
    const command = (program: string, args: string[]) =>
      spawnSync(program, args, { cwd: s.directory, env, encoding: "utf8" });
    const marker = command(process.execPath, [
      "-e",
      "console.log(require('node:child_process').execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim())",
    ]);
    assert.equal(marker.status, 0, marker.stderr);
    assert.equal(marker.stdout.trim(), s.baseSha);
    for (const args of [
      ["push"],
      ["rev-parse", "--git-dir"],
      ["remote", "set-url", "origin", "https://example.com/other.git"],
    ])
      assert.notEqual(command("git", args).status, 0);
    writeFileSync(join(s.directory, "footer.txt"), "Committed agent footer");
    assert.equal(command("git", ["add", "footer.txt"]).status, 0);
    const commit = command("git", ["commit", "-m", "Agent footer"]);
    assert.equal(commit.status, 0, commit.stderr);
    s.finish();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_preview");
    assert.equal(
      s.workflow.view(run.id)?.verification?.headSha,
      s.git("rev-parse", "HEAD"),
    );
    s.git("remote", "set-url", "origin", "https://example.com/other.git");
    assert.notEqual(command("git", ["rev-parse", "HEAD"]).status, 0);
  } finally {
    s.close();
  }
});

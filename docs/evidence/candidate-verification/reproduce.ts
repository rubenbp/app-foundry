import { randomUUID, createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  GitWorkspace,
  execute,
  reducedEnvironment,
} from "../../../src/infrastructure/workspace.ts";
import { CandidateVerifier } from "../../../src/infrastructure/verification.ts";
import { verificationPlan } from "../../../src/domain/verification.ts";
import {
  sanitizer,
  sanitizedRecord,
} from "../../../src/application/sanitize.ts";

const factoryDirectory = resolve(import.meta.dirname, "../../..");
const evidence = join(factoryDirectory, "docs/evidence/candidate-verification");
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "foundry-issue16-rebobina-"));
const secrets = Object.entries(process.env)
  .filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD/.test(key))
  .map(([, value]) => value!)
  .filter(Boolean);
const sanitize = sanitizer(secrets);
const clean = (text: string, limit = Number.MAX_SAFE_INTEGER) =>
  sanitize(
    text.replaceAll(root, "<probe-root>").replaceAll(homedir(), "<home>"),
    limit,
  );
const project = JSON.parse(
  readFileSync(
    join(factoryDirectory, "config/managed-projects/rebobina.json"),
    "utf8",
  ),
);
const factorySha = (
  await execute("git", ["rev-parse", "HEAD"], {
    cwd: factoryDirectory,
    env: process.env,
  })
).output.trim();
const manifest: Record<string, unknown> = {
  factorySha,
  startedAt: new Date().toISOString(),
  mode: "Local diagnostic; real GitHub clone, Git, dependency installation, five configured commands and Chrome. No agent/model/admission/preview/acceptance/merge/production accreditation.",
  configuration: project,
  baseEffects: [],
  candidateCommits: [],
};
const save = () => {
  const path = join(evidence, "rebobina-verification.json");
  writeFileSync(
    path + ".tmp",
    JSON.stringify(sanitizedRecord(manifest, clean), null, 2) + "\n",
  );
  renameSync(path + ".tmp", path);
};
save();
console.log(`Diagnostic root: ${root}`);
try {
  const workspace = await new GitWorkspace(root).prepare(
    randomUUID(),
    project,
    async (id, description, action) => {
      const entry: Record<string, unknown> = {
        id,
        description,
        startedAt: new Date().toISOString(),
        status: "intent",
      };
      (manifest.baseEffects as unknown[]).push(entry);
      save();
      const result = await action();
      entry.status = "observed";
      entry.endedAt = new Date().toISOString();
      entry.label = result.label;
      if ("code" in result) {
        entry.code = result.code;
      }
      const file = `base-${id}.log`;
      writeFileSync(join(evidence, file), clean(result.output).text);
      entry.output = file;
      save();
      console.log(`${id}: ${result.label}`);
      return result;
    },
  );
  manifest.workspace = {
    directory: workspace.directory,
    branch: workspace.branch,
    baseSha: workspace.baseSha,
    instructionPaths: workspace.instructions.map(
      (instruction) => instruction.path,
    ),
  };
  const options = {
    cwd: workspace.directory,
    env: reducedEnvironment(join(root, "command-home")),
  };
  const command = async (binary: string, args: string[]) => {
    const result = await execute(binary, args, options);
    if (result.code !== 0) {
      throw new Error(`${binary} ${args.join(" ")}: ${result.output}`);
    }
    return result.output.trim();
  };
  manifest.observedToolchain = {
    node: await command("node", ["--version"]),
    pnpm: await command("pnpm", ["--version"]),
    python: await command("python3", ["--version"]),
    packageManager: JSON.parse(
      readFileSync(join(workspace.directory, "package.json"), "utf8"),
    ).packageManager,
    lockfileSha256: createHash("sha256")
      .update(readFileSync(join(workspace.directory, "pnpm-lock.yaml")))
      .digest("hex"),
  };
  mkdirSync(join(workspace.directory, "docs"), { recursive: true });
  for (const [index, name] of [
    "factory-verification-probe.md",
    "factory-verification-probe-followup.md",
  ].entries()) {
    writeFileSync(
      join(workspace.directory, "docs", name),
      `# Disposable verification probe ${index + 1}\n\nIssue #16 diagnostic only. No product behavior or verification controls changed.\n`,
    );
    await command("git", ["add", "--", `docs/${name}`]);
    await command("git", [
      "commit",
      "-m",
      `Disposable verification probe ${index + 1}`,
    ]);
    (manifest.candidateCommits as unknown[]).push(
      await command("git", ["rev-parse", "HEAD"]),
    );
  }
  manifest.editorState =
    "No agent process was started. Probe editing finished and committed before fixing head; no remote writes were performed.";
  const report = verificationPlan(
    workspace.baseSha,
    project.verification.commands,
    "## Acceptance criteria\n- Execute every configured check on the complete Rebobina candidate.\n- Serve its build with an exclusive local E2E server and preserve evidence.",
  );
  await new CandidateVerifier(root).verify(
    workspace,
    project,
    report,
    (current, output) => {
      manifest.verification = current;
      if (output) {
        writeFileSync(
          join(evidence, `${output.id}.log`),
          clean(output.text).text,
        );
      }
      save();
      if (output) {
        console.log(`${output.id}: ${output.label}`);
      }
    },
    new AbortController().signal,
  );
  manifest.finalWorktree = await command("git", [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  manifest.finishedAt = new Date().toISOString();
  save();
  if (report.status !== "passed") {
    throw new Error(
      report.error ?? "Independent candidate verification did not pass",
    );
  }
  console.log(
    `Verified ${report.baseSha} -> ${report.headSha}; ${report.e2e?.executedTests} E2E tests`,
  );
} catch (error) {
  manifest.error = String(error);
  manifest.finishedAt = new Date().toISOString();
  save();
  console.error(clean(String(error)).text);
  process.exitCode = 1;
}

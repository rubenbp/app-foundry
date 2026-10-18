import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import { createFactory } from "../src/composition/factory.ts";
import { OpenCode } from "../src/infrastructure/opencode/agent.ts";
import { panelServer } from "../src/infrastructure/http/panelServer.ts";
import { consumption } from "../src/domain/run.ts";
import type { Run } from "../src/domain/run.ts";

// Explicit opt-in only. This script calls a real paid model; it is never part of npm test.
if (!process.argv.includes("--real")) {
  throw new Error("Pass --real to authorize the bounded model experiment");
}
const source = process.env.FACTORY_EXPERIMENT_PROJECT;
if (!source) {
  throw new Error(
    "Set FACTORY_EXPERIMENT_PROJECT to a prepared Managed project repository (local path or public HTTPS URL)",
  );
}
const root = mkdtempSync(join(tmpdir(), "foundry-experiment-"));
const projectDir = join(root, "project");
const clone = spawnSync(
  "git",
  [
    "-c",
    "core.hooksPath=/dev/null",
    "clone",
    ...(source.startsWith("https://")
      ? ["--depth=1"]
      : ["--local", "--no-hardlinks"]),
    source,
    projectDir,
  ],
  { encoding: "utf8" },
);
if (clone.status !== 0) {
  throw new Error("Could not create disposable clone");
}
const dataDir = join(root, "data");
mkdirSync(dataDir, { mode: 0o700 });
const config = {
  dataDir,
  projectDir,
  provider: "openai",
  model: "gpt-6-luna",
  auth: "opencode" as const,
  opencodeCli: process.env.FACTORY_OPENCODE_CLI ?? "/opt/homebrew/bin/opencode",
};
const agent = new OpenCode(config);
let factory = createFactory(config, agent, {
  secrets: [process.env.GEMINI_API_KEY ?? ""],
});
const server = panelServer(factory);
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const evidence: Record<string, unknown> = {
  at: new Date().toISOString(),
  node: process.version,
  root,
  model: "openai/gpt-6-luna",
  auth: "opencode-oauth",
  panel: origin,
  cases: [],
};
const cases = evidence.cases as unknown[];
const summarize = (run: Run) => ({
  id: run.id,
  status: run.status,
  startedAt: run.startedAt,
  endedAt: run.endedAt,
  sessionId: run.sessionId,
  process: run.process,
  lastObservation: run.lastObservation,
  lastActivity: run.lastActivity,
  result: run.result,
  error: run.error,
  pending: run.pending,
  parts: run.parts.map((p) => ({
    id: p.id,
    kind: p.kind,
    label: p.label,
    truncated: p.truncated,
  })),
  usage: consumption(run.usage),
  transitions: run.history.filter((h) =>
    ["opencode-status", "stop", "error"].includes(h.kind),
  ),
  gaps: run.gaps,
});
const waitFor = async (
  id: string,
  predicate: (status: string, pending: number) => boolean,
) => {
  for (let i = 0; i < 90; i++) {
    const run = factory.view(id)!;
    if (
      predicate(run.status, run.pending.length) ||
      run.status === "intervention"
    ) {
      return run;
    }
    await delay(1000);
  }
  return factory.view(id)!;
};
try {
  console.log(`Experiment panel: ${origin}`);
  const task =
    "Use the read tool to inspect package.json in this directory. Report the package name and its build script in one sentence. Do not edit files, run commands, or delegate. This is a bounded observation experiment.";
  const first = await factory.run(task);
  let result = await waitFor(
    first.id,
    (status) => status === "awaiting_verification",
  );
  const packageInfo = JSON.parse(
    readFileSync(join(projectDir, "package.json"), "utf8"),
  );
  evidence.readVerification = {
    source: "Independent comparison with cloned package.json",
    package: packageInfo.name,
    build: packageInfo.scripts?.build,
    matches:
      typeof packageInfo.name === "string" &&
      typeof packageInfo.scripts?.build === "string" &&
      Boolean(
        result.result?.includes(packageInfo.name) &&
        result.result?.includes(packageInfo.scripts.build),
      ),
  };
  const api = await fetch(`${origin}/api/view`).then((r) => r.json());
  cases.push({
    kind: "read",
    run: summarize(result),
    apiObservedRun: api.run?.id === first.id,
  });
  console.log(
    `Read experiment: ${result.status}; messages=${result.parts.length}; tokens=${consumption(result.usage).observedTokens}`,
  );
  await factory.stop(first.id);
  cases.push({
    kind: "stop-after-read",
    id: first.id,
    status: factory.view(first.id)!.status,
    processAbsent: factory.view(first.id)!.process?.exited,
    detail: factory.view(first.id)!.history.at(-1)?.text,
  });
  if (result.status !== "awaiting_verification") {
    throw new Error("Read task did not complete; inspect sanitized evidence");
  }
  const second = await factory.run(
    "Use the edit/write tool to create factory-permission-probe.txt containing only permission-probe. Do not use bash or any other tool to bypass permission. Request permission and wait if required. Do not delegate.",
  );
  result = await waitFor(second.id, (_status, pending) => pending > 0);
  cases.push({ kind: "permission", run: summarize(result) });
  console.log(
    `Permission experiment: ${result.status}; pending=${result.pending.length}`,
  );
  const stopped = await factory.stop(second.id);
  cases.push({
    kind: "manual-stop",
    id: stopped.id,
    status: stopped.status,
    processAbsent: stopped.process?.exited,
    detail: stopped.history.at(-1)?.text,
  });
  if (!result.pending.length) {
    throw new Error("Permission was not observed");
  }
  const diff = spawnSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "status", "--porcelain"],
    { cwd: projectDir, encoding: "utf8" },
  );
  evidence.projectUnchanged = diff.status === 0 && !diff.stdout.trim();
  evidence.nativeRuntimeRemoved =
    agent.runtime !== null && !existsSync(agent.runtime);
  factory.close();
  factory = createFactory(config, new OpenCode(config));
  evidence.restart = {
    count: factory.list().length,
    statuses: factory.list().map((r) => r.status),
    taskResent: false,
  };
  evidence.package = packageInfo.name;
} catch (error) {
  evidence.error = factory.clean(String(error)).text;
  process.exitCode = 1;
} finally {
  if (factory.active && agent.process) {
    try {
      await factory.stop(factory.active);
    } catch {
      evidence.stopUncertain = true;
    }
  }
  server.closeAllConnections();
  server.close();
  factory.close();
  const out = resolve("docs/evidence/opencode-panel");
  mkdirSync(out, { recursive: true });
  const priorPath = join(out, "experiment.json");
  if (existsSync(priorPath)) {
    const prior = JSON.parse(readFileSync(priorPath, "utf8"));
    evidence.previousExperiments = [
      ...(prior.previousExperiments ?? []),
      {
        at: prior.at,
        error: prior.error ?? null,
        cases: prior.cases.map((c: { kind: string; run?: Run }) => ({
          kind: c.kind,
          id: c.run?.id,
          status: c.run?.status,
          error: c.run?.error,
        })),
      },
    ];
  }
  writeFileSync(
    join(out, "experiment.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(`Sanitized evidence: ${out}/experiment.json`);
}

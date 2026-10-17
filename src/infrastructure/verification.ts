import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Workspace, ManagedProject } from "../domain/request.ts";
import type { Verification } from "../domain/verification.ts";
import { controlChange } from "../domain/verification-controls.ts";
import { execute, reducedEnvironment, type ProcessPort } from "./workspace.ts";

export type VerificationProgress = (
  report: Verification,
  output?: { id: string; label: string; text: string },
) => void;

export class CandidateVerifier {
  constructor(privateRoot: string, processPort: ProcessPort = execute) {
    this.root = privateRoot;
    this.process = processPort;
  }
  private root: string;
  private process: ProcessPort;

  async verify(
    workspace: Workspace,
    project: ManagedProject,
    report: Verification,
    progress: VerificationProgress,
    signal: AbortSignal,
  ) {
    const home = join(this.root, "verification-home");
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const options = {
      cwd: workspace.directory,
      env: reducedEnvironment(home),
      signal,
    };
    const git = async (...args: string[]) => {
      const result = await this.process(
        "git",
        ["-c", "core.hooksPath=/dev/null", ...args],
        options,
      );
      if (result.code !== 0)
        throw new Error(`Candidate inspection failed: ${result.output}`);
      if (result.output.endsWith("\n[TRUNCATED]"))
        throw new Error(
          "Candidate inspection truncated; complete diff/control evidence unavailable",
        );
      return result.output;
    };
    report.headSha = (await git("rev-parse", "HEAD")).trim();
    progress(report);
    await git("merge-base", "--is-ancestor", report.baseSha, report.headSha);
    const unchanged = async () => {
      const status = await git(
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      );
      const head = (await git("rev-parse", "HEAD")).trim();
      progress(report, {
        id: "verification-worktree",
        label: "Candidate tree integrity",
        text: `Expected head ${report.headSha}\nObserved head ${head}\n${status || "Clean worktree"}`,
      });
      if (status)
        throw new Error(
          "Candidate has uncommitted changes; incorporate all edits before verification",
        );
      if (head !== report.headSha)
        throw new Error("Candidate head changed during verification");
    };
    await unchanged();
    const diff = await git(
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      `${report.baseSha}...${report.headSha}`,
      "--",
    );
    progress(report, {
      id: report.diffPartId,
      label: "Cumulative candidate diff",
      text: `Base ${report.baseSha}\nHead ${report.headSha}\n${diff}`,
    });
    progress(report, {
      id: report.configurationPartId,
      label: "Independent verification configuration",
      text: JSON.stringify(
        {
          baseSha: report.baseSha,
          headSha: report.headSha,
          scope: "Complete candidate tree and cumulative branch diff",
          verification: project.verification,
          environment:
            "Reduced environment; same-user processes are not an OS sandbox",
        },
        null,
        2,
      ),
    });
    const changed = (
      await git(
        "diff",
        "--no-renames",
        "--name-only",
        "-z",
        report.baseSha,
        report.headSha,
        "--",
      )
    )
      .split("\0")
      .filter(Boolean);
    for (const path of changed) {
      const patch = await git(
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--unified=0",
        report.baseSha,
        report.headSha,
        "--",
        path,
      );
      const concern = controlChange(path, patch, project.verification);
      if (concern) report.controls.push(concern);
    }
    progress(report, {
      id: "verification-controls",
      label: "Verification control comparison",
      text: `Base ${report.baseSha}\nHead ${report.headSha}\n${report.controls.join("\n") || "No suspicious control changes found by conservative comparison."}\nThis comparison cannot detect every semantic weakening.`,
    });
    if (report.controls.length)
      throw new Error(
        "Verification controls changed; human intervention required",
      );
    for (const check of report.checks) {
      check.status = "running";
      check.startedAt = Date.now();
      const e2e =
        project.verification.e2e?.command === check.command
          ? project.verification.e2e
          : null;
      check.executedCommand = check.command;
      if (e2e) {
        const wrapper = join(home, "candidate-playwright.mjs");
        writeFileSync(
          wrapper,
          playwrightConfiguration(workspace.directory, e2e),
          { mode: 0o600 },
        );
        check.executedCommand += ` --config '${wrapper.replaceAll("'", "'\\''")}'`;
      }
      progress(report);
      let result;
      try {
        result = await this.process(
          "/bin/sh",
          ["-c", check.executedCommand],
          options,
        );
      } catch (error) {
        check.status = "failed";
        check.endedAt = Date.now();
        progress(report, {
          id: check.partId,
          label: `${check.command} · execution unavailable`,
          text: `Base ${report.baseSha}\nHead ${report.headSha}\nCommand: ${check.executedCommand}\nNo exit code observed: ${String(error)}`,
        });
        throw error;
      }
      check.code = result.code;
      check.endedAt = Date.now();
      check.status = result.code === 0 ? "passed" : "failed";
      for (const criterion of report.criteria)
        criterion.evidence.push(check.partId);
      progress(report, {
        id: check.partId,
        label: `${check.command} · exit ${result.code}`,
        text: `Base ${report.baseSha}\nHead ${report.headSha}\nCommand: ${check.executedCommand}\nExit: ${result.code}\n${result.output}`,
      });
      await unchanged();
      if (result.code !== 0) {
        report.status = "failed";
        report.error = `Candidate verification failed: ${check.command} (exit ${result.code})`;
        progress(report);
        return;
      }
      if (e2e) {
        try {
          report.e2e = e2eEvidence(result.output, e2e);
        } catch (error) {
          check.status = "failed";
          progress(report);
          throw error;
        }
        progress(report);
      }
    }
    report.status = "passed";
    for (const criterion of report.criteria) {
      criterion.status = "human_pending";
      criterion.evidence = report.checks.map((check) => check.partId);
    }
    progress(report);
  }
}

function playwrightConfiguration(
  directory: string,
  e2e: NonNullable<ManagedProject["verification"]["e2e"]>,
) {
  // The Factory controls the server, scope and reporter. Candidate tests remain untrusted same-user code.
  return `
import configuration from ${JSON.stringify(pathToFileURL(resolve(directory, e2e.configFile)).href)};
import { resolve } from 'node:path';
const directory = ${JSON.stringify(directory)};
const contract = ${JSON.stringify(e2e)};
const projects = configuration.projects ?? [{}];
console.log('FACTORY_E2E_METADATA=' + JSON.stringify(projects.map(project => {
  const use = { ...configuration.use, ...project.use };
  return { name: use.browserName ?? use.defaultBrowserType ?? 'chromium', channel: use.channel ?? null, executablePath: use.launchOptions?.executablePath ?? null };
})));
export default {
  ...configuration,
  testDir: resolve(directory, configuration.testDir ?? '.'),
  outputDir: resolve(${JSON.stringify(join(directory, ".."))}, 'verification-playwright-output'),
  forbidOnly: true,
  use: { ...configuration.use, baseURL: contract.origin, offline: contract.offline },
  projects: configuration.projects?.map(project => ({ ...project,
    testDir: resolve(directory, project.testDir ?? configuration.testDir ?? '.'),
    use: { ...project.use, baseURL: contract.origin, offline: contract.offline },
  })),
  reporter: [['json']],
  webServer: { command: contract.serverCommand, cwd: directory, url: contract.origin, reuseExistingServer: false, timeout: 30000 },
};
`;
}

function e2eEvidence(
  output: string,
  e2e: NonNullable<ManagedProject["verification"]["e2e"]>,
): NonNullable<Verification["e2e"]> {
  const metadata = output.match(/^FACTORY_E2E_METADATA=(.+)$/m)?.[1];
  const start = output.indexOf('{\n  "config":');
  if (!metadata || start < 0)
    throw new Error(
      "E2E evidence absent: browser and executed-test report required",
    );
  const browsers: unknown = JSON.parse(metadata);
  const result = JSON.parse(output.slice(start));
  if (
    !Array.isArray(browsers) ||
    !browsers.length ||
    !browsers.every(
      (browser) =>
        browser &&
        typeof browser.name === "string" &&
        (browser.channel === null || typeof browser.channel === "string") &&
        (browser.executablePath === null ||
          typeof browser.executablePath === "string"),
    ) ||
    !Number.isSafeInteger(result.stats?.expected) ||
    result.stats.expected < 1 ||
    result.stats.skipped !== 0 ||
    result.stats.unexpected !== 0 ||
    result.stats.flaky !== 0 ||
    !Array.isArray(result.errors) ||
    result.errors.length
  )
    throw new Error(
      "E2E evidence invalid: empty, skipped, flaky or failed tests cannot approve a candidate",
    );
  return {
    origin: e2e.origin,
    serves: e2e.serves,
    reuseExistingServer: false,
    offline: e2e.offline,
    browsers: browsers.map((browser) => ({
      name: browser.name,
      channel: browser.channel,
      executablePath: browser.executablePath,
    })),
    executedTests: result.stats.expected,
    skippedTests: result.stats.skipped,
  };
}

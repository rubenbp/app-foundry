import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Workspace, ManagedProject } from "../domain/request.ts";
import type { Verification } from "../domain/verification.ts";
import { controlChange } from "../domain/verificationControls.ts";
import { execute, reducedEnvironment, type ProcessPort } from "./process.ts";

import type {
  CandidateVerification,
  VerificationProgress,
} from "../application/verification.ts";

export class CandidateVerifier implements CandidateVerification {
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
      if (result.code !== 0) {
        throw new Error(`Candidate inspection failed: ${result.output}`);
      }
      if (result.output.endsWith("\n[TRUNCATED]")) {
        throw new Error(
          "Candidate inspection truncated; complete diff/control evidence unavailable",
        );
      }
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
      if (status) {
        throw new Error(
          "Candidate has uncommitted changes; incorporate all edits before verification",
        );
      }
      if (head !== report.headSha) {
        throw new Error("Candidate head changed during verification");
      }
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
      if (concern) {
        report.controls.push(concern);
      }
    }
    progress(report, {
      id: "verification-controls",
      label: "Verification control comparison",
      text: `Base ${report.baseSha}\nHead ${report.headSha}\nInformational comparison; product test and configuration changes do not block verification.\n${report.controls.join("\n") || "No verification file changes identified by the comparison."}\nThis comparison cannot establish the semantic quality of the tests.`,
    });
    for (const check of report.checks) {
      check.status = "running";
      check.startedAt = Date.now();
      const e2e =
        project.verification.e2e?.command === check.command
          ? project.verification.e2e
          : null;
      const existingServer = e2e ? await serverListening(e2e.origin) : false;
      if (existingServer) {
        check.status = "failed";
        check.endedAt = Date.now();
        report.status = "failed";
        report.error = `E2E origin already used or unavailable for exclusive ownership: ${e2e!.origin}; command not executed`;
        progress(report, {
          id: check.partId,
          label: `${check.command} · not executed`,
          text: report.error,
        });
        return;
      }
      check.executedCommand = check.command;
      check.cleanup = "pending";
      let runtime: string | undefined;
      if (e2e) {
        runtime = mkdtempSync(join(tmpdir(), "foundry-e2e-"));
        const wrapper = join(runtime, "candidate-playwright.mjs");
        writeFileSync(
          wrapper,
          playwrightConfiguration(workspace.directory, e2e, runtime),
          { mode: 0o600 },
        );
        check.executedCommand += ` --config '${wrapper.replaceAll("'", "'\\''")}'`;
      }
      progress(report);
      let result;
      try {
        result = await this.process("/bin/sh", ["-c", check.executedCommand], {
          ...options,
          interruptSignal: e2e ? "SIGINT" : "SIGTERM",
          onStart: (pid) => {
            check.pid = pid;
            progress(report);
          },
        });
      } catch (error) {
        check.status = "failed";
        check.cleanup = check.pid ? "uncertain" : "confirmed";
        if (check.pid) {
          report.effectsUncertain = true;
        }
        check.endedAt = Date.now();
        progress(report, {
          id: check.partId,
          label: `${check.command} · execution unavailable`,
          text: `Base ${report.baseSha}\nHead ${report.headSha}\nCommand: ${check.executedCommand}\nNo exit code observed: ${String(error)}`,
        });
        throw error;
      } finally {
        if (runtime) {
          rmSync(runtime, { recursive: true, force: true });
        }
      }
      check.code = result.code;
      check.endedAt = Date.now();
      for (const criterion of report.criteria) {
        criterion.evidence.push(check.partId);
      }
      progress(report, {
        id: check.partId,
        label: `${check.command} · exit ${result.code}`,
        text: `Base ${report.baseSha}\nHead ${report.headSha}\nCommand: ${check.executedCommand}\nExit: ${result.code}\n${e2e ? withoutNativeAttachments(result.output) : result.output}`,
      });
      if (
        result.forcedStop ||
        (result.code === null && !signal.aborted) ||
        (e2e && !(await serverStopped(e2e.origin)))
      ) {
        report.effectsUncertain = true;
        check.cleanup = "uncertain";
        check.status = "uncertain";
        progress(report);
        throw new Error(
          `Verification cleanup unconfirmed; inspect command group ${check.pid ?? "unavailable"} and its E2E server/browser processes before releasing the execution`,
        );
      }
      check.cleanup = "confirmed";
      check.status = result.code === 0 ? "passed" : "failed";
      progress(report);
      if (result.truncated || result.output.endsWith("\n[TRUNCATED]")) {
        check.status = "failed";
        progress(report);
        throw new Error(
          "Verification command output truncated; complete evidence unavailable",
        );
      }
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
  runtime: string,
) {
  // La Factory controla el servidor, el ámbito y el generador de informes. Las pruebas candidatas siguen siendo código no confiable del mismo usuario.
  return `
import configuration from ${JSON.stringify(pathToFileURL(resolve(directory, e2e.configFile)).href)};
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const directory = ${JSON.stringify(directory)};
const contract = ${JSON.stringify(e2e)};
const configDirectory = dirname(resolve(directory, contract.configFile));
const require = createRequire(${JSON.stringify(pathToFileURL(resolve(directory, e2e.configFile)).href)});
const resolvePaths = value => value ? [value].flat().map(path => resolve(configDirectory, path)) : undefined;
const setupPaths = value => value ? [value].flat().map(path => existsSync(resolve(configDirectory, path)) ? resolve(configDirectory, path) : require.resolve(path)) : undefined;
const templatePath = value => value && !['{testDir}', '{/testDir}', '{snapshotDir}', '{/snapshotDir}'].some(prefix => value.startsWith(prefix)) ? resolve(configDirectory, value) : value;
const snapshotExpect = value => value ? {
  ...value,
  ...(value.toHaveScreenshot ? { toHaveScreenshot: { ...value.toHaveScreenshot, stylePath: resolvePaths(value.toHaveScreenshot.stylePath), pathTemplate: templatePath(value.toHaveScreenshot.pathTemplate) } } : {}),
  ...(value.toMatchAriaSnapshot ? { toMatchAriaSnapshot: { ...value.toMatchAriaSnapshot, pathTemplate: templatePath(value.toMatchAriaSnapshot.pathTemplate) } } : {}),
} : value;
const projects = configuration.projects ?? [{}];
console.log('FACTORY_E2E_METADATA=' + JSON.stringify(projects.map(project => {
  const use = { ...configuration.use, ...project.use };
  return { name: use.browserName ?? use.defaultBrowserType ?? 'chromium', channel: use.channel ?? null, executablePath: use.launchOptions?.executablePath ?? null };
})));
export default {
  ...configuration,
  testDir: resolve(configDirectory, configuration.testDir ?? '.'),
  outputDir: ${JSON.stringify(join(runtime, "output"))},
  globalSetup: setupPaths(configuration.globalSetup),
  globalTeardown: setupPaths(configuration.globalTeardown),
  expect: snapshotExpect(configuration.expect),
  snapshotDir: configuration.snapshotDir ? resolve(configDirectory, configuration.snapshotDir) : undefined,
  snapshotPathTemplate: templatePath(configuration.snapshotPathTemplate),
  forbidOnly: true,
  use: { ...configuration.use, baseURL: contract.origin, offline: contract.offline, trace: 'off', video: 'off', screenshot: 'off' },
  projects: configuration.projects?.map(project => ({ ...project,
    testDir: resolve(configDirectory, project.testDir ?? configuration.testDir ?? '.'),
    expect: snapshotExpect(project.expect),
    snapshotDir: project.snapshotDir ? resolve(configDirectory, project.snapshotDir) : undefined,
    snapshotPathTemplate: templatePath(project.snapshotPathTemplate),
    use: { ...project.use, baseURL: contract.origin, offline: contract.offline, trace: 'off', video: 'off', screenshot: 'off' },
  })),
  reporter: [['json']],
  webServer: { command: contract.serverCommand, cwd: directory, url: contract.origin, reuseExistingServer: false, timeout: 30000 },
};
`;
}

async function serverStopped(origin: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const listening = await serverListening(origin);
    if (!listening) {
      return true;
    }
    await delay(100);
  }
  return false;
}

function serverListening(origin: string) {
  const url = new URL(origin);

  return new Promise<boolean>((resolve) => {
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(200, () => finish(true));
    socket.once("connect", () => finish(true));
    socket.once("error", (error) =>
      finish((error as NodeJS.ErrnoException).code !== "ECONNREFUSED"),
    );
  });
}

function e2eEvidence(
  output: string,
  e2e: NonNullable<ManagedProject["verification"]["e2e"]>,
): NonNullable<Verification["e2e"]> {
  const metadata = output.match(/^FACTORY_E2E_METADATA=(.+)$/m)?.[1];
  const start = output.indexOf('{\n  "config":');
  if (!metadata || start < 0) {
    throw new Error(
      "E2E evidence absent: browser and executed-test report required",
    );
  }
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
  ) {
    throw new Error(
      "E2E evidence invalid: empty, skipped, flaky or failed tests cannot approve a candidate",
    );
  }
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

function withoutNativeAttachments(output: string) {
  const start = output.indexOf('{\n  "config":');
  if (start < 0) {
    return output;
  }
  try {
    const report = JSON.parse(output.slice(start), (key, value) => {
      if (key === "attachments" && Array.isArray(value)) {
        return value.map((attachment) => ({
          name: attachment.name,
          contentType: attachment.contentType,
          omitted:
            "Native attachment removed; only sanitized textual evidence retained",
        }));
      }
      if (key === "buffer" || key === "metadata") {
        return "[OMITTED]";
      }
      return value;
    });

    return output.slice(0, start) + JSON.stringify(report, null, 2);
  } catch {
    return (
      output.slice(0, start) +
      "\n[OMITTED INVALID PLAYWRIGHT REPORT: textual evidence unavailable; E2E cannot be approved]"
    );
  }
}

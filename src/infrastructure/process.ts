import { spawn } from "node:child_process";

export interface ProcessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onStart?: (pid: number) => void;
  interruptSignal?: "SIGINT" | "SIGTERM";
}
export interface CommandResult {
  code: number | null;
  output: string;
  truncated?: boolean;
  forcedStop?: boolean;
}
export type ProcessPort = (
  command: string,
  args: string[],
  options: ProcessOptions,
) => Promise<CommandResult>;

export const execute: ProcessPort = (command, args, options) =>
  new Promise((resolve, reject) => {
    const {
      signal,
      onStart,
      interruptSignal = "SIGTERM",
      ...settings
    } = options;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const child = spawn(command, args, {
      ...settings,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let forcedStop = false;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) {
          process.kill(-child.pid, signal);
        }
      } catch {
        /* La salida se comprueba más abajo. */
      }
    };
    const abort = () => {
      kill(interruptSignal);
      escalation = setTimeout(() => {
        forcedStop = true;
        kill("SIGKILL");
      }, 3000);
    };
    signal?.addEventListener("abort", abort, { once: true });
    let output = "";
    let truncated = false;
    const collect = (chunk: Buffer) => {
      if (output.length < 1_000_000) {
        output += String(chunk);
      } else {
        truncated = true;
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error) => {
      clearTimeout(escalation);
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(escalation);
      signal?.removeEventListener("abort", abort);
      resolve({
        code,
        output: output + (truncated ? "\n[TRUNCATED]" : ""),
        truncated,
        forcedStop,
      });
    });
    try {
      if (child.pid) {
        onStart?.(child.pid);
      }
    } catch (error) {
      kill("SIGKILL");
      reject(error);
    }
  });

// Esto reduce el acceso accidental. Los procesos del mismo usuario de macOS no están aislados por el sistema operativo.
export function reducedEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    LANG: "en_US.UTF-8",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "",
    GIT_AUTHOR_NAME: "App Foundry",
    GIT_AUTHOR_EMAIL: "factory@localhost",
    GIT_COMMITTER_NAME: "App Foundry",
    GIT_COMMITTER_EMAIL: "factory@localhost",
  };
}

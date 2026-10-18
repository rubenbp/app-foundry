import { execFile } from "node:child_process";

export type RemoteCommand = (
  executable: string,
  args: string[],
  input?: unknown,
  options?: { cwd: string },
) => Promise<string>;
export const remoteCommand: RemoteCommand = (
  executable,
  args,
  input,
  options,
) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      args,
      { timeout: 30_000, maxBuffer: 16_000_000, ...options },
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      },
    );
    child.stdin?.end(input === undefined ? undefined : JSON.stringify(input));
  });

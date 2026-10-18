import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Instala el límite de procesos del agente. Cada invocación vuelve a comprobar la identidad
// del clon propio; solo se añade la lectura exacta que usa la compilación de marcadores de versión.
export function installLocalGitGuard(
  runtime: string,
  directory: string,
  repository: string,
) {
  writeFileSync(
    join(runtime, "package.json"),
    JSON.stringify({ type: "commonjs" }),
    { mode: 0o600 },
  );
  const guards = join(runtime, "bin");
  mkdirSync(guards, { mode: 0o700 });
  const script = `#!${process.execPath}
const { spawnSync } = require("node:child_process");
const { realpathSync } = require("node:fs");
const args = process.argv.slice(2);
const inspect = (params) => {
  const r = spawnSync("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", ...params], { encoding: "utf8" });
  if (r.status !== 0) process.exit(1);
  return r.stdout.trim();
};
const versionRead = args.length === 2 && args[0] === "rev-parse" && args[1] === "HEAD";
if ((!versionRead && !["status", "diff", "add", "commit", "log", "show"].includes(args[0])) ||
    realpathSync(process.cwd()) !== ${JSON.stringify(directory)} ||
    inspect(["rev-parse", "--show-toplevel"]) !== ${JSON.stringify(directory)} ||
    inspect(["remote", "get-url", "origin"]) !== ${JSON.stringify(`https://github.com/${repository}.git`)} ||
    inspect(["branch", "--show-current"]) !== ${JSON.stringify("codex/execution-")} + require("node:path").basename(${JSON.stringify(directory)})) {
  console.error("Factory local Git policy rejected this command or workspace"); process.exit(1);
}
const r = spawnSync("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", ...args], { stdio: "inherit" });
process.exit(r.status ?? 1);
`;
  writeFileSync(join(guards, "git"), script, { mode: 0o700 });
  return guards;
}

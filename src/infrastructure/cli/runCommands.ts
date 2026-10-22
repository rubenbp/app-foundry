import { shellQuote } from "./shellQuote.ts";

/** Commands are pasted beside factory.local.json, independently of the server's cwd. */
export function runCommands(
  id: string,
  installation: { nodePath: string; cliPath: string; canDiscard: boolean },
) {
  const prefix = `${shellQuote(installation.nodePath)} --experimental-strip-types ${shellQuote(installation.cliPath)}`;
  const command = (action: "stop" | "discard") =>
    `${prefix} ${action} --config ./factory.local.json --id ${shellQuote(id)}`;

  return {
    stop: command("stop"),
    discard: installation.canDiscard ? command("discard") : null,
  };
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readConfig } from "./infrastructure/configuration.ts";
import { sendControlCommand } from "./infrastructure/cli/controlClient.ts";
import { serveFactory } from "./composition/serve.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);

  return index < 0 ? undefined : args[index + 1];
};
const config = readConfig(option("--config") ?? "factory.local.json");
const socket = `/tmp/app-foundry-${createHash("sha256").update(config.dataDir).digest("hex").slice(0, 16)}.sock`;
const command = args[0] ?? "serve";

if (command === "serve") {
  await serveFactory(config, socket, Number(option("--port") ?? 4310));
} else if (command === "run" || command === "stop") {
  const data =
    command === "run"
      ? {
          command,
          task: readFileSync(option("--task-file") ?? "task.txt", "utf8"),
        }
      : { command, id: option("--id") };
  sendControlCommand(socket, data);
} else {
  throw new Error(
    "Commands: serve, run --task-file PATH, stop --id ID; all accept --config PATH",
  );
}

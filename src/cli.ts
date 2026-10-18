import { createServer, request } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, unlinkSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import { readConfig } from "./infrastructure/configuration.ts";
import { OpenCode } from "./infrastructure/opencode/agent.ts";
import { createFactory } from "./composition/factory.ts";
import { panelServer } from "./infrastructure/http/panel-server.ts";
import { createWorkflow } from "./composition/workflow.ts";
import { GitHub } from "./infrastructure/github.ts";
import { GitWorkspace } from "./infrastructure/workspace.ts";
import { GitHubPublication } from "./infrastructure/publication.ts";
import { acquireLock } from "./infrastructure/lock.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);

  return index < 0 ? undefined : args[index + 1];
};
const config = readConfig(option("--config") ?? "factory.local.json");
const socket = `/tmp/app-foundry-${createHash("sha256").update(config.dataDir).digest("hex").slice(0, 16)}.sock`;
const command = args[0] ?? "serve";

if (command === "serve") {
  const lock = join(config.dataDir, "factory.lock");
  const releaseData = config.managedProject ? () => {} : acquireLock(lock);
  const projectLock = `/tmp/app-foundry-project-${createHash("sha256").update(config.projectDir).digest("hex").slice(0, 16)}.lock`;
  let releaseProject: () => void;
  try {
    releaseProject = config.managedProject
      ? () => {}
      : acquireLock(projectLock);
  } catch (error) {
    releaseData();
    throw error;
  }
  const agent = new OpenCode(config);
  const secrets = Object.entries(process.env)
    .filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD/.test(key))
    .map(([, value]) => value!)
    .filter(Boolean);
  const publication = new GitHubPublication(config.dataDir, {
    vercelCli: config.vercelCli,
  });
  const workflow = config.managedProject
    ? createWorkflow(config, {
        createAgent: (config) => new OpenCode(config),
        workspace: new GitWorkspace(config.dataDir),
        github: new GitHub(),
        publication,
        production: publication.production,
        secrets,
      })
    : null;
  if (existsSync(socket)) unlinkSync(socket);
  const factory =
    workflow?.factory ?? createFactory(config, agent, { secrets });
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let closing = false;
  let polling: Promise<void> | undefined;
  const tick = () => {
    if (!workflow || closing) return;
    polling = workflow
      .poll()
      .catch(() => {
        console.error(
          "Workflow persistence failed; inspect panel and owned processes.",
        );
      })
      .finally(() => {
        if (!closing) pollTimer = setTimeout(tick, 15_000);
      });
  };
  const panel = panelServer(factory);
  const control = createServer(async (req, res) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    try {
      if (req.method !== "POST") throw new Error("Control requires POST");
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 65_536) throw new Error("Control payload too large");
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString());
      let result;
      if (data.command === "run" && !workflow && typeof data.task === "string")
        result = await factory.run(data.task);
      else if (data.command === "stop" && typeof data.id === "string")
        result = await (workflow
          ? workflow.stop(data.id)
          : factory.stop(data.id));
      else throw new Error("Use run with a task or stop with the Ejecución ID");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: result.id,
          status: result.status,
          error: result.error,
        }),
      );
    } catch (error) {
      res.writeHead(409);
      res.end(JSON.stringify({ error: factory.clean(String(error)).text }));
    }
  });
  control.listen(socket);
  await once(control, "listening");
  chmodSync(socket, 0o600);
  panel.listen(Number(option("--port") ?? 4310), "127.0.0.1");
  await once(panel, "listening");
  console.log(
    `Factory panel: http://127.0.0.1:${(panel.address() as { port: number }).port}`,
  );
  console.log(`Factory PID ${process.pid}; local control socket ${socket}`);
  tick();
  const close = async () => {
    if (closing) return;
    closing = true;
    workflow?.halt();
    clearTimeout(pollTimer);
    try {
      if (factory.active)
        await (workflow
          ? workflow.stop(factory.active)
          : factory.stop(factory.active));
      await polling;
    } catch {
      console.error(
        "Stop unconfirmed; inspect recorded OpenCode PID manually.",
      );
    }
    panel.closeAllConnections();
    panel.close();
    control.closeAllConnections();
    control.close();
    if (workflow) workflow.close();
    else factory.close();
    releaseProject();
    releaseData();
  };
  process.on("SIGINT", () => {
    void close();
  });
  process.on("SIGTERM", () => {
    void close();
  });
} else if (command === "run" || command === "stop") {
  const data =
    command === "run"
      ? {
          command,
          task: readFileSync(option("--task-file") ?? "task.txt", "utf8"),
        }
      : { command, id: option("--id") };
  const req = request(
    {
      socketPath: socket,
      path: "/",
      method: "POST",
      timeout: 30_000,
      headers: { "Content-Type": "application/json" },
    },
    (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => process.stdout.write(chunk));
      res.on("end", () => {
        process.stdout.write("\n");
        if (res.statusCode !== 200) process.exitCode = 1;
      });
    },
  );
  req.on("timeout", () =>
    req.destroy(
      new Error(
        "Control timeout; work may have started. Inspect panel before retrying.",
      ),
    ),
  );
  req.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  req.end(JSON.stringify(data));
} else
  throw new Error(
    "Commands: serve, run --task-file PATH, stop --id ID; all accept --config PATH",
  );

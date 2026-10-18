import { createHash } from "node:crypto";
import { unlinkSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import { OpenCode } from "../infrastructure/opencode/agent.ts";
import { createFactory } from "./factory.ts";
import { panelServer } from "../infrastructure/http/panel-server.ts";
import { createWorkflow } from "./workflow.ts";
import { GitHub } from "../infrastructure/github.ts";
import { GitWorkspace } from "../infrastructure/workspace.ts";
import { GitHubPublication } from "../infrastructure/publication.ts";
import { acquireLock } from "../infrastructure/lock.ts";

import type { FactoryConfig } from "../application/configuration.ts";
import { controlServer } from "../infrastructure/http/control-server.ts";

export async function serveFactory(
  config: FactoryConfig,
  socket: string,
  port: number,
) {
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
  const control = controlServer(factory, workflow);
  control.listen(socket);
  await once(control, "listening");
  chmodSync(socket, 0o600);
  panel.listen(port, "127.0.0.1");
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
}

import { Factory } from "../application/factory.ts";
import type { AgentPort } from "../application/agent.ts";
import type { FactoryConfig } from "../application/configuration.ts";
import { Store } from "../infrastructure/persistence/store.ts";
import { LocalRunFiles } from "../infrastructure/runFiles.ts";
import type { RunFiles } from "../application/runDeletion.ts";

export function createFactory(
  config: FactoryConfig,
  agent: AgentPort,
  options: {
    secrets?: string[];
    now?: () => number;
    reservedRun?: string;
    runFiles?: RunFiles;
  } = {},
) {
  const store = new Store(config.dataDir);
  try {
    return new Factory(config, agent, store, {
      ...options,
      runFiles: options.runFiles ?? new LocalRunFiles(config.dataDir),
    });
  } catch (error) {
    store.close();
    throw error;
  }
}

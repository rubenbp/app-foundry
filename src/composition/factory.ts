import { Factory } from "../application/factory.ts";
import type { AgentPort } from "../application/agent.ts";
import type { FactoryConfig } from "../application/configuration.ts";
import { Store } from "../infrastructure/persistence/store.ts";

export function createFactory(
  config: FactoryConfig,
  agent: AgentPort,
  options: {
    secrets?: string[];
    now?: () => number;
    reservedRun?: string;
  } = {},
) {
  const store = new Store(config.dataDir);
  try {
    return new Factory(config, agent, store, options);
  } catch (error) {
    store.close();
    throw error;
  }
}

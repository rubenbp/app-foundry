import type { ManagedProject } from "../domain/request.ts";
import type { TokenPrices } from "../domain/tokenPricing.ts";

export interface FactoryConfig {
  dataDir: string;
  projectDir: string;
  provider: string;
  model: string;
  tokenPrices?: TokenPrices;
  reasoningEffort?: string;
  auth: "opencode";
  opencodeCli?: string;
  vercelCli?: string;
  managedProject?: ManagedProject;
  conversationId?: string;
}

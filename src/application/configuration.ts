import type { ManagedProject } from "../domain/request.ts";

export interface FactoryConfig {
  dataDir: string;
  projectDir: string;
  provider: string;
  model: string;
  auth: "opencode";
  opencodeCli?: string;
  vercelCli?: string;
  managedProject?: ManagedProject;
}

import { readFileSync } from "node:fs";
import { validateProject } from "../src/domain/configuration.ts";
import { configureMergeProtection } from "../src/infrastructure/mergeProtection.ts";

const path = process.argv[2];
if (!path)
  throw new Error(
    "Usage: node --experimental-strip-types scripts/configureMergeProtection.ts MANAGED_PROJECT_JSON",
  );
const project: unknown = JSON.parse(readFileSync(path, "utf8"));
validateProject(project);
await configureMergeProtection(project);
console.log(
  `Confirmed PR, current branch, Vercel and Factory / ready-to-merge protection for ${project.repository}:${project.baseBranch}`,
);

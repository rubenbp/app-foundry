import type { ManagedProject } from "./request.ts";

const configurationPath = new RegExp(
  "(?:^|/)(?:package\\.json|[^/]*lock[^/]*|[^/]*config\\.[^/]+|" +
    "\\.?npmrc|\\.node-version|\\.gitignore|\\.gitattributes)$|^\\.github/",
  "i",
);
const testPath = new RegExp(
  "(?:^|/)(?:tests?|__tests__|__mocks__|fixtures?|scripts?)/|" +
    "\\.(?:test|spec)\\.[^/]+$",
  "i",
);
const omission = new RegExp(
  "\\.(?:skip|only|todo|fixme)\\s*\\(|" +
    "\\b(?:skip|only|testIgnore|testMatch|exclude|grep|" +
    "failOnEmptyTestSuite)\\s*[:=(]",
  "i",
);

/** Observaciones para el informe humano; modificar controles del producto no bloquea la verificación. */
export function controlChange(
  path: string,
  patch: string,
  verification: ManagedProject["verification"],
) {
  const configured =
    path === verification.e2e?.configFile ||
    verification.surfaces?.some(
      (surface) => path === surface || path.startsWith(surface + "/"),
    );
  const commandSource = verification.commands.some((command) =>
    [
      ...command.matchAll(/(?:^|[\s"'])([\w./-]+\.(?:mjs|cjs|js|ts|py|sh))/g),
    ].some((match) => match[1].replace(/^\.\//, "") === path),
  );
  if (configurationPath.test(path) || configured || commandSource) {
    return `${path}: verification command or configuration changed`;
  }
  if (!testPath.test(path)) {
    return null;
  }
  const lines = patch.split("\n");
  if (lines.some((line) => /^\+(?!\+\+)/.test(line) && omission.test(line))) {
    return `${path}: possible omission or exclusive test`;
  }
  if (lines.some((line) => /^-(?!--)/.test(line) && line.slice(1).trim())) {
    return `${path}: test, fixture or script modified; review the cumulative diff`;
  }
  return null;
}

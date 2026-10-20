import type { Run } from "../src/domain/run.ts";

export function Commit({ run, head }: { run: Run; head: string | undefined }) {
  if (!head) {
    return <>Sin observar</>;
  }
  return run.request ? (
    <a
      href={`https://github.com/${run.request.repository}/commit/${head}`}
      target="_blank"
      rel="noreferrer"
      title={head}
    >
      <code>{head.slice(0, 7)}</code> ↗
    </a>
  ) : (
    <code title={head}>{head.slice(0, 7)}</code>
  );
}

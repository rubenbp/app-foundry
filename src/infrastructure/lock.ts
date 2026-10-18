import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

export function acquireLock(path: string) {
  if (existsSync(path)) {
    const previous = Number(readFileSync(path, "utf8"));
    if (!Number.isInteger(previous) || previous <= 0) {
      throw new Error("Invalid Factory lock; inspect manually");
    }
    let alive = true;
    try {
      process.kill(previous, 0);
    } catch (error) {
      alive = (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
    if (alive) {
      throw new Error("Another Factory owns this data root or Managed project");
    }
    unlinkSync(path);
  }
  writeFileSync(path, String(process.pid), { flag: "wx", mode: 0o600 });
  let released = false;

  return () => {
    if (released) {
      return;
    }
    released = true;
    if (
      existsSync(path) &&
      readFileSync(path, "utf8") === String(process.pid)
    ) {
      unlinkSync(path);
    }
  };
}

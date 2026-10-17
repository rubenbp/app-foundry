import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Run } from "./types.ts";

// Only sanitized domain records reach this boundary. No SDK payloads or raw logs.
export class Store {
  db: DatabaseSync;
  root: string;
  failed = false;
  constructor(root: string) {
    this.root = root;
    mkdirSync(join(root, "artifacts"), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(root, "factory.sqlite"));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
  }
  save(run: Run) {
    if (this.failed) throw new Error("Persistence unavailable: effects blocked");
    try {
      this.db.prepare("INSERT INTO runs VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(run.id, JSON.stringify(run));
    } catch (error) { this.failed = true; throw error; }
  }
  list(): Run[] { return this.db.prepare("SELECT body FROM runs ORDER BY rowid DESC").all().map(row => JSON.parse(String(row.body))); }
  artifact(runId: string, partId: string) {
    return join(this.root, "artifacts", createHash("sha256").update(runId + ":" + partId).digest("hex") + ".txt");
  }
  write(runId: string, partId: string, text: string) {
    if (this.failed) throw new Error("Persistence unavailable: effects blocked");
    try {
      const path = this.artifact(runId, partId);
      writeFileSync(path + ".tmp", text, { mode: 0o600 });
      renameSync(path + ".tmp", path);
    } catch (error) { this.failed = true; throw error; }
  }
  output(runId: string, partId: string) {
    try { return readFileSync(this.artifact(runId, partId), "utf8"); } catch { return null; }
  }
  close() { this.db.close(); }
}

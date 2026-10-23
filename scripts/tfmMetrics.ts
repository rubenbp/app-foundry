import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Extrae métricas de Ejecuciones reales para la memoria del TFM.
// Uso: node --experimental-strip-types scripts/tfmMetrics.ts <factory.local.json>...
// Cada configuración aporta su dataDir y la tarifa de su modelo. Las bases se
// copian a un directorio temporal para no tocar una Factory en marcha.

interface TokenPrices {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
}

interface Source {
  label: string;
  dataDir: string;
  pricesByModel: Map<string, TokenPrices>;
}

interface HistoryEntry {
  at: number;
  kind: string;
}

interface UsageEntry {
  model?: string;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cacheRead?: number;
  };
}

interface RunRecord {
  id: string;
  status: string;
  attempt: number;
  startedAt?: number;
  endedAt?: number;
  request: { title: string; url: string };
  history: HistoryEntry[];
  usage?: UsageEntry[];
  tokenPrices?: TokenPrices;
  verification?: { checks?: { command: string; status: string }[] };
}

const minuteMs = 60_000;

function readSources(configPaths: string[]): Source[] {
  const byDataDir = new Map<string, Source>();
  for (const path of configPaths) {
    const config = JSON.parse(readFileSync(path, "utf8")) as {
      dataDir: string;
      model: string;
      tokenPrices?: TokenPrices;
    };
    const dataDir = resolve(dirname(path), config.dataDir);
    const source = byDataDir.get(dataDir) ?? {
      label: dirname(resolve(path)).split("/").at(-1) ?? dataDir,
      dataDir,
      pricesByModel: new Map(),
    };
    if (config.tokenPrices) {
      source.pricesByModel.set(config.model, config.tokenPrices);
    }
    byDataDir.set(dataDir, source);
  }
  return [...byDataDir.values()];
}

function readRuns(dataDir: string): RunRecord[] {
  const copy = mkdtempSync(join(tmpdir(), "tfm-metrics-"));
  try {
    for (const suffix of ["", "-wal"]) {
      const file = join(dataDir, `factory.sqlite${suffix}`);
      if (existsSync(file)) {
        cpSync(file, join(copy, `factory.sqlite${suffix}`));
      }
    }
    const database = new DatabaseSync(join(copy, "factory.sqlite"));
    try {
      const rows = database.prepare("SELECT body FROM runs").all() as {
        body: string;
      }[];

      return rows
        .map((row) => JSON.parse(row.body) as RunRecord)
        .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    } finally {
      database.close();
    }
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

// Suma los tramos que empiezan en un hito y terminan en el primer hito de cierre posterior.
function spanMs(
  history: HistoryEntry[],
  starts: string[],
  ends: string[],
): number {
  let total = 0;
  let openedAt: number | undefined;
  for (const entry of history) {
    if (openedAt === undefined && starts.includes(entry.kind)) {
      openedAt = entry.at;
    } else if (openedAt !== undefined && ends.includes(entry.kind)) {
      total += entry.at - openedAt;
      openedAt = undefined;
    }
  }
  return total;
}

function count(history: HistoryEntry[], kinds: string[]): number {
  return history.filter((entry) => kinds.includes(entry.kind)).length;
}

function phases(run: RunRecord) {
  const history = run.history;
  const totalMs =
    (run.endedAt ?? history.at(-1)?.at ?? 0) -
    (run.startedAt ?? history[0]?.at ?? 0);
  const questionsMs = spanMs(
    history,
    ["agent-intervention"],
    ["response-delivered"],
  );
  const agentMs =
    spanMs(
      history,
      ["process-started"],
      ["result", "stop", "conversation-suspended", "discarded"],
    ) - questionsMs;
  const verificationMs = spanMs(history, ["agent-stop"], ["verification"]);
  const previewMs = spanMs(
    history,
    ["preview-waiting"],
    ["preview-ready", "preview-error"],
  );
  const hasPreviewEvents = history.some(
    (entry) => entry.kind === "preview-ready",
  );
  const reviewMs = spanMs(
    history,
    [hasPreviewEvents ? "preview-ready" : "verification"],
    ["recovery-requested", "merge-observed", "stop"],
  );
  const closingMs = spanMs(history, ["merge-observed"], ["completed"]);
  const humanMs = questionsMs + reviewMs;
  const accountedMs =
    agentMs + verificationMs + previewMs + humanMs + closingMs;

  return {
    totalMs,
    agentMs,
    verificationMs,
    previewMs,
    humanMs,
    closingMs,
    otherMs: Math.max(0, totalMs - accountedMs),
  };
}

function consumption(run: RunRecord, source: Source) {
  const usage = run.usage ?? [];
  const sum = (key: "input" | "output" | "reasoning" | "cacheRead") =>
    usage.reduce((total, entry) => total + (entry.tokens?.[key] ?? 0), 0);
  const models = [
    ...new Set(usage.map((entry) => entry.model).filter(Boolean)),
  ] as string[];
  const prices =
    run.tokenPrices ??
    (models[0] ? source.pricesByModel.get(models[0]) : undefined);
  const tokens = {
    input: sum("input"),
    output: sum("output") + sum("reasoning"),
    cacheRead: sum("cacheRead"),
  };
  const costUsd = prices
    ? (tokens.input * prices.inputUsdPerMillion +
        tokens.output * prices.outputUsdPerMillion +
        tokens.cacheRead * prices.cacheReadUsdPerMillion) /
      1_000_000
    : undefined;

  return {
    models,
    tokens,
    costUsd,
    priceSource: run.tokenPrices
      ? "Ejecución"
      : prices
        ? "Config. del modelo"
        : "Sin tarifa",
  };
}

const minutes = (ms: number) => (ms / minuteMs).toFixed(1);
const thousands = (value: number) => `${(value / 1000).toFixed(1)} k`;
const usd = (value: number | undefined) =>
  value === undefined ? "n/d" : `${value.toFixed(3)}`;

function report(sources: Source[]): string {
  const lines: string[] = [];
  const totals = {
    runs: 0,
    completed: 0,
    agentMs: 0,
    humanMs: 0,
    costUsd: 0,
    tokens: 0,
  };
  lines.push(
    "# Datos medidos de las Ejecuciones",
    "",
    `Generado el ${new Date().toISOString().slice(0, 10)} con \`scripts/tfmMetrics.ts\` a partir de las bases SQLite de la Factory. No editar a mano: volver a generar.`,
    "",
    "## Cómo leer las cifras",
    "",
    "- **Medido**: tokens por mensaje (protocolo de OpenCode), intentos, estado, hitos con fecha y resultado de las comprobaciones.",
    "- **Calculado**: duración de cada fase, aproximada como la distancia entre hitos del historial (`process-started` → `result` para el agente, `preview-ready` → orden o merge para la revisión humana, etc.).",
    "- **Calculado con tarifa configurada**: el coste en USD multiplica tokens por la tarifa de `tokenPrices`. Con OAuth, OpenCode informa coste 0; el importe mostrado es un equivalente en API, no un cargo facturado.",
    "- **Espera humana** es tiempo de reloj hasta la siguiente decisión (responder, corregir o hacer merge). Es un límite superior del tiempo humano activo, que no se mide.",
    "- **Otros** agrupa errores, reinicios de la Factory, recuperaciones y esperas no atribuibles a otra fase.",
    "",
  );
  for (const source of sources) {
    const runs = readRuns(source.dataDir);
    lines.push(
      `## Tanda \`${source.label}\` (${runs.length} Ejecuciones)`,
      "",
      "| # | Issue | Estado | Intentos | Modelo | Agente (min) | Verificación (min) | Preview (min) | Espera humana (min) | Otros (min) | Total (min) | Tokens entrada | Tokens salida | Tokens caché | Coste USD | Tarifa | Comprobaciones |",
      "| - | ----- | ------ | -------- | ------ | ------------ | ------------------ | ------------- | ------------------- | ----------- | ----------- | -------------- | ------------- | ------------ | --------- | ------ | -------------- |",
    );
    runs.forEach((run, index) => {
      const time = phases(run);
      const used = consumption(run, source);
      const checks = run.verification?.checks ?? [];
      const passed = checks.filter((check) => check.status === "passed").length;
      const issueNumber = run.request.url.split("/").at(-1);
      lines.push(
        `| ${index + 1} | [${run.request.title}](${run.request.url}) (#${issueNumber}) | ${run.status} | ${run.attempt} | ${used.models.join(", ") || "n/d"} | ${minutes(time.agentMs)} | ${minutes(time.verificationMs)} | ${minutes(time.previewMs)} | ${minutes(time.humanMs)} | ${minutes(time.otherMs)} | ${minutes(time.totalMs)} | ${thousands(used.tokens.input)} | ${thousands(used.tokens.output)} | ${thousands(used.tokens.cacheRead)} | ${usd(used.costUsd)} | ${used.priceSource} | ${passed}/${checks.length} |`,
      );
      totals.runs += 1;
      if (run.status === "completed") {
        totals.completed += 1;
      }
      totals.agentMs += time.agentMs;
      totals.humanMs += time.humanMs;
      totals.costUsd += used.costUsd ?? 0;
      totals.tokens +=
        used.tokens.input + used.tokens.output + used.tokens.cacheRead;
    });
    lines.push(
      "",
      "Incidencias registradas por Ejecución:",
      "",
      "| # | Issue | Preguntas del agente | Intentos adicionales (corrección o reintento) | Errores de agente/publicación | Conversaciones suspendidas | Recuperaciones tras reinicio |",
      "| - | ----- | -------------------- | --------------------------------------------- | ----------------------------- | -------------------------- | ---------------------------- |",
    );
    runs.forEach((run, index) => {
      const history = run.history;
      lines.push(
        `| ${index + 1} | ${run.request.title} | ${count(history, ["agent-intervention"])} | ${count(history, ["attempt-started"])} | ${count(history, ["error", "publication-error", "preview-error", "observation-error", "recovery-error"])} | ${count(history, ["conversation-suspended"])} | ${count(history, ["recovery", "operator-recovery"])} |`,
      );
    });
    lines.push("");
  }
  lines.push(
    "## Totales",
    "",
    `- Ejecuciones: ${totals.runs} (${totals.completed} completadas).`,
    `- Tiempo de agente acumulado: ${minutes(totals.agentMs)} min; media ${minutes(totals.agentMs / totals.runs)} min por Ejecución.`,
    `- Espera humana acumulada (límite superior): ${minutes(totals.humanMs)} min.`,
    `- Tokens totales: ${thousands(totals.tokens)}. Coste equivalente en API: ${usd(totals.costUsd)} USD; media ${usd(totals.costUsd / totals.runs)} USD por Ejecución.`,
    "",
  );
  return lines.join("\n");
}

const configPaths = process.argv.slice(2);
if (configPaths.length === 0) {
  console.error(
    "Uso: node --experimental-strip-types scripts/tfmMetrics.ts <factory.local.json>...",
  );
  process.exit(1);
}
process.stdout.write(report(readSources(configPaths)));

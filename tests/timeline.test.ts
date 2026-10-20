import { test } from "node:test";
import assert from "node:assert/strict";
import { timelineEntries } from "../panel/timeline.ts";
import type { History, PartView } from "../src/domain/run.ts";

test("la cronología intercala eventos y salidas con desempate determinista, conserva eventos iguales y omite anuncios duplicados", () => {
  const history: History[] = [
    { at: 20, kind: "admitted", text: "Issue autorizado" },
    { at: 20, kind: "admitted", text: "Issue autorizado" },
    { at: 20, kind: "part", text: "text: Mensaje" },
    { at: 10, kind: "error", text: "Fallo observado" },
  ];
  const parts: PartView[] = [
    {
      id: "z",
      messageId: "m",
      kind: "tool",
      label: "read · completed",
      updatedAt: 20,
      truncated: false,
    },
    {
      id: "a",
      messageId: "m",
      kind: "text",
      label: "Mensaje",
      updatedAt: 20,
      truncated: false,
    },
  ];
  assert.deepEqual(
    timelineEntries({ history, parts }).map(({ id, at }) => ({ id, at })),
    [
      { id: "history-3", at: 10 },
      { id: "history-0", at: 20 },
      { id: "history-1", at: 20 },
      { id: "part-a", at: 20 },
      { id: "part-z", at: 20 },
    ],
  );
});

test("actualizar una salida mantiene su identidad, cambia su versión y la reordena por última observación sin inventar inicio", () => {
  const history = [
    { at: 30, kind: "verification", text: "Comprobación terminada" },
  ];
  const part = {
    id: "p",
    messageId: "m",
    kind: "text",
    label: "Mensaje",
    updatedAt: 10,
    truncated: false,
  };
  const before = timelineEntries({ history, parts: [part] });
  const after = timelineEntries({
    history,
    parts: [{ ...part, updatedAt: 40 }],
  });
  assert.deepEqual(
    before.map((entry) => entry.id),
    ["part-p", "history-0"],
  );
  assert.deepEqual(
    after.map((entry) => entry.id),
    ["history-0", "part-p"],
  );
  assert.equal(after[1]!.at, 40);
  assert.notEqual(before[0]!.version, after[1]!.version);
});

test("los estados técnicos no se atribuyen a herramientas y los fallos permanecen distinguibles en la vista habitual", () => {
  const entries = timelineEntries({
    history: [
      { at: 1, kind: "intent", text: "Create OpenCode session" },
      { at: 2, kind: "opencode-status", text: "session.tool.started" },
      { at: 3, kind: "opencode-status", text: "session.tool.failed" },
      { at: 4, kind: "gap", text: "Observación perdida" },
    ],
    parts: [
      {
        id: "p",
        messageId: "m",
        kind: "tool",
        label: "read · error",
        updatedAt: 3,
        truncated: false,
      },
    ],
  });
  assert.deepEqual(
    entries.map((entry) => [entry.id, entry.kind]),
    [
      ["history-0", "technical"],
      ["history-1", "technical"],
      ["history-2", "error"],
      ["part-p", "error"],
      ["history-3", "error"],
    ],
  );
  assert.equal(entries[2]!.text, "session.tool.failed");
  assert.equal(entries[2]!.part, undefined);
});

test("las salidas de proceso permanecen como hechos técnicos y el resultado retenido continúa consultable con su evento", () => {
  const entries = timelineEntries({
    history: [
      { at: 1, kind: "process-exit", text: "Proceso terminado" },
      { at: 2, kind: "result", text: "Agent finished. Result unverified." },
    ],
    parts: [],
    result: "Resultado final conservado",
  });
  assert.equal(entries[0]!.kind, "technical");
  assert.equal(entries[1]!.result, "Resultado final conservado");
  assert.equal(entries[1]!.at, 2);
});

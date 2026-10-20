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

test("las salidas de proceso conservan el fallo observado y el resultado retenido continúa consultable con su evento", () => {
  const entries = timelineEntries({
    history: [
      { at: 1, kind: "process-exit", text: "Proceso terminado" },
      { at: 2, kind: "result", text: "Agent finished. Result unverified." },
    ],
    parts: [],
    result: "Resultado final conservado",
  });
  assert.equal(entries[0]!.kind, "error");
  assert.equal(entries[1]!.result, "Resultado final conservado");
  assert.equal(entries[1]!.at, 2);
});

test("inicio y confirmación conocidos forman una operación estable situada en la primera observación", () => {
  const intent = { at: 10, kind: "intent", text: "Create OpenCode session" };
  const before = timelineEntries({ history: [intent], parts: [] });
  const after = timelineEntries({
    history: [
      intent,
      { at: 30, kind: "confirmed", text: "OpenCode session created" },
    ],
    parts: [],
  });
  assert.equal(after.length, 1);
  assert.equal(after[0]!.id, before[0]!.id);
  assert.equal(after[0]!.at, 10);
  assert.notEqual(after[0]!.version, before[0]!.version);
  assert.equal(after[0]!.operation?.state, "confirmed");
  assert.equal(after[0]!.label, "Crear la sesión de OpenCode");
  assert.deepEqual(
    after[0]!.operation?.records.map(({ record }) => record.at),
    [10, 30],
  );
});

test("los ciclos iguales se emparejan una sola vez y los extremos huérfanos explican su límite", () => {
  const entries = timelineEntries({
    history: [
      { at: 1, kind: "confirmed", text: "Owned OpenCode server started" },
      { at: 2, kind: "intent", text: "Start owned OpenCode server" },
      { at: 3, kind: "confirmed", text: "Owned OpenCode server started" },
      { at: 4, kind: "intent", text: "Start owned OpenCode server" },
      { at: 5, kind: "confirmed", text: "Owned OpenCode server started" },
      { at: 6, kind: "intent", text: "Start owned OpenCode server" },
      { at: 7, kind: "intent", text: "mystery:42" },
      { at: 8, kind: "confirmed", text: "mystery:42" },
    ],
    parts: [],
  });
  assert.deepEqual(
    entries.map((entry) => entry.id),
    [
      "history-0",
      "history-1",
      "history-3",
      "history-5",
      "history-6",
      "history-7",
    ],
  );
  assert.deepEqual(
    entries.map((entry) => entry.operation?.records.length),
    [1, 2, 2, 1, 1, 1],
  );
  assert.match(entries[0]!.operation!.note!, /sin inicio observado/i);
  assert.equal(entries[3]!.operation!.state, "started");
  assert.match(entries[3]!.operation!.note!, /sin confirmación/i);
  assert.match(entries[4]!.operation!.note!, /efecto/i);
  assert.equal(entries[4]!.text, "mystery:42");
  assert.equal(entries[4]!.label, "Operación interna de la Factory");
});

test("acciones de publicación y preparación usan claves acreditadas y referencias con su significado de origen", () => {
  const head = "a".repeat(40);
  const keys = [
    `push:${head}`,
    "pull",
    `status:${head}:success`,
    `report:${head}:preview-7:digest`,
    "review-ready:preview-7",
    "review-ready:unobserved",
    "Prepare base: npm ci",
    "Check pre-existing base: npm test",
    "Issue label: factory:in-progress",
    `prepare:${head}`,
    `description:${head}`,
    `integration-report:${head}`,
    `close-issue:${head}`,
  ];
  const entries = timelineEntries({
    history: keys.flatMap((text, index) => [
      { at: index * 2, kind: "intent", text },
      { at: index * 2 + 1, kind: "confirmed", text },
    ]),
    parts: [],
  });
  assert.equal(entries.length, 13);
  assert.deepEqual(
    entries.slice(0, 5).map(({ label }) => label),
    [
      "Publicar el Commit candidato en GitHub",
      "Preparar la PR del Commit candidato",
      "Actualizar el check de merge a «correcto»",
      "Publicar el informe de revisión",
      "Avisar de que el resultado está listo para revisión",
    ],
  );
  assert.deepEqual(entries[0]!.operation!.references, [
    { label: "Commit candidato", value: head },
  ]);
  assert.deepEqual(entries[4]!.operation!.references, [
    { label: "Referencia de la notificación", value: "preview-7" },
  ]);
  assert.match(entries[5]!.operation!.references[0]!.label, /Referencia/);
  assert.equal(entries[6]!.label, "Preparar la base · npm ci");
  assert.equal(entries[7]!.label, "Comprobar la base · npm test");
  assert.match(entries[8]!.label, /Etiquetar el issue/);
});

test("detener se empareja con la respuesta acreditada como observación, sin certificar efectos del proveedor", () => {
  const entries = timelineEntries({
    history: [
      {
        at: 1,
        kind: "intent",
        text: "Stop agent editing before fixing candidate head",
      },
      { at: 2, kind: "opencode-status", text: "session.tool.started" },
      {
        at: 3,
        kind: "agent-stop",
        text: "Local process stopped; provider effects unknown",
      },
      {
        at: 4,
        kind: "intent",
        text: "Abort session and stop owned process group",
      },
      { at: 5, kind: "stop", text: "Owned group stopped" },
      { at: 6, kind: "agent-stop", text: "Unpaired observation" },
    ],
    parts: [],
  });
  assert.equal(entries.length, 4);
  assert.deepEqual(
    entries.map((entry) => entry.operation!.state),
    ["observed", "observed", "observed", "observed"],
  );
  assert.deepEqual(
    entries[0]!.operation!.records.map(({ index }) => index),
    [0, 2],
  );
  assert.deepEqual(
    entries[2]!.operation!.records.map(({ index }) => index),
    [3, 4],
  );
  assert.match(entries[0]!.operation!.note!, /proveedor/);
  assert.match(entries[3]!.operation!.note!, /sin inicio observado/);
  assert.equal(entries[1]!.part, undefined);
});

test("señales y comentarios solo se reducen en tramos técnicos contiguos y conservan cada registro sin ocultar fallos", () => {
  const history = [
    { at: 1, kind: "opencode-status", text: "session.busy" },
    { at: 2, kind: "comment-consumed", text: "comment-1" },
    { at: 3, kind: "opencode-status", text: "session.idle" },
    { at: 4, kind: "comment-consumed", text: "comment-2" },
    { at: 6, kind: "opencode-status", text: "session.busy" },
    { at: 7, kind: "opencode-status", text: "session.tool.failed" },
    { at: 8, kind: "opencode-status", text: "session.idle" },
    { at: 9, kind: "opencode-status", text: "session.observed" },
  ];
  const parts = [
    {
      id: "message",
      messageId: "m",
      kind: "text",
      label: "Actividad intermedia",
      updatedAt: 5,
      truncated: false,
    },
  ];
  const entries = timelineEntries({ history, parts });
  assert.deepEqual(
    entries.map(({ id }) => id),
    [
      "history-0",
      "history-1",
      "part-message",
      "history-4",
      "history-5",
      "history-6",
    ],
  );
  assert.deepEqual(
    entries[0]!.operation!.records.map(({ index }) => index),
    [0, 2],
  );
  assert.deepEqual(
    entries[1]!.operation!.records.map(({ index }) => index),
    [1, 3],
  );
  assert.equal(entries[4]!.kind, "error");
  assert.equal(entries[4]!.text, "session.tool.failed");
  const retained = entries
    .flatMap(({ operation }) => operation?.records ?? [])
    .sort((a, b) => a.index - b.index);
  assert.deepEqual(
    retained.map(({ record }) => record),
    history,
  );
  assert.deepEqual(
    retained.map(({ index }) => index),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  assert.deepEqual(
    history.map(({ at }) => at),
    [1, 2, 3, 4, 6, 7, 8, 9],
  );
});

test("una referencia solo se nombra como preview o informe con evidencia y las claves heredadas del lenguaje siguen siendo datos", () => {
  const publication = {
    head: "a".repeat(40),
    consumed: [],
    ownComments: [],
    deployments: [],
    operations: {},
    observedAt: null,
    observationError: null,
    limitations: [],
    reports: [
      {
        id: "report-4",
        url: "https://example.test/report",
        at: 1,
        head: "a".repeat(40),
        preview: "p-3",
      },
    ],
  };
  const entries = timelineEntries({
    history: [
      { at: 1, kind: "intent", text: "review-ready:report-4" },
      { at: 2, kind: "confirmed", text: "review-ready:report-4" },
      { at: 3, kind: "intent", text: "toString" },
      { at: 4, kind: "confirmed", text: "toString" },
    ],
    parts: [],
    publication,
  });
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0]!.operation!.references, [
    { label: "ID del informe publicado", value: "report-4" },
  ]);
  assert.equal(entries[1]!.label, "Operación interna de la Factory");
  assert.equal(entries[2]!.text, "toString");
});

test("las salidas de proceso y los checks de merge fallidos conservan el fallo observado aunque su operación se compacte", () => {
  const entries = timelineEntries({
    history: [
      { at: 1, kind: "process-exit", text: "Owned server exited unexpectedly" },
      { at: 2, kind: "intent", text: `status:${"a".repeat(40)}:failure` },
      { at: 3, kind: "confirmed", text: `status:${"a".repeat(40)}:failure` },
    ],
    parts: [],
  });
  assert.deepEqual(
    entries.map(({ kind }) => kind),
    ["error", "error"],
  );
});

test("las señales sin referencia a una llamada no se interpretan como acciones aunque su texto coincida con una clave conocida", () => {
  const entries = timelineEntries({
    history: [
      { at: 1, kind: "opencode-status", text: "pull" },
      { at: 2, kind: "comment-consumed", text: "Create OpenCode session" },
    ],
    parts: [],
  });
  assert.deepEqual(
    entries.map(({ label }) => label),
    ["Señales internas de OpenCode", "Comentarios procesados por la Factory"],
  );
  assert.deepEqual(
    entries.map(({ operation }) => operation!.state),
    ["observed", "observed"],
  );
  assert.deepEqual(
    entries.map(({ operation }) => operation!.references),
    [[], []],
  );
});

test("el texto repetido no sustituye las correspondencias específicas del arranque ni convierte una detención en confirmación", () => {
  const entries = timelineEntries({
    history: [
      { at: 1, kind: "intent", text: "Create OpenCode session" },
      { at: 2, kind: "confirmed", text: "Create OpenCode session" },
      { at: 3, kind: "confirmed", text: "OpenCode session created" },
      {
        at: 4,
        kind: "intent",
        text: "Stop agent editing before fixing candidate head",
      },
      {
        at: 5,
        kind: "confirmed",
        text: "Stop agent editing before fixing candidate head",
      },
    ],
    parts: [],
  });
  assert.deepEqual(
    entries.map(({ id }) => id),
    ["history-0", "history-1", "history-3", "history-4"],
  );
  assert.deepEqual(
    entries[0]!.operation!.records.map(({ index }) => index),
    [0, 2],
  );
  assert.equal(entries[2]!.operation!.state, "started");
});

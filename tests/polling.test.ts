import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as flush } from "node:timers/promises";
import { poll } from "../panel/polling.ts";

test("panel polls immediately, never overlaps, times out, and resumes reads without work submission", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let failures = 0;
  let responses = 0;
  let release!: (response: Response) => void;
  context.mock.method(globalThis, "fetch", (_url: string, options: RequestInit) => {
    calls++;
    return new Promise<Response>((resolve, reject) => {
      release = resolve;
      options.signal!.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    });
  });
  const close = poll(() => "/api/view", () => { responses++; }, () => { failures++; });
  assert.equal(calls, 1);
  context.mock.timers.tick(4000); await flush();
  assert.equal(calls, 1);
  context.mock.timers.tick(1000); await flush();
  assert.equal(failures, 1);
  context.mock.timers.tick(2000); await flush();
  assert.equal(calls, 2);
  release(new Response(JSON.stringify({ status: "waiting" })));
  await flush();
  assert.equal(responses, 1);
  close(); context.mock.timers.tick(10_000); await flush();
  assert.equal(calls, 2);
});

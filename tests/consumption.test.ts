import { test } from "node:test";
import assert from "node:assert/strict";
import { consumption, type Usage } from "../src/domain/run.ts";
import { createTokenPrices } from "../src/domain/tokenPricing.ts";

const prices = {
  inputUsdPerMillion: 2,
  outputUsdPerMillion: 8,
  cacheReadUsdPerMillion: 0.5,
};
const message: Usage = {
  id: "m1",
  provider: "openai",
  model: "test-model",
  tokens: {
    input: 1_000_000,
    output: 100_000,
    reasoning: 50_000,
    cacheRead: 400_000,
    cacheWrite: 200_000,
  },
  sdkCost: 99,
  completed: true,
};

test("el consumo agrupa escritura en entrada y razonamiento en salida sin duplicar tokens", () => {
  const summary = consumption([message], prices);
  assert.deepEqual(summary.tokens, {
    input: 1_200_000,
    output: 150_000,
    cacheRead: 400_000,
  });
  assert.equal(summary.usedTokens, 1_750_000);
  assert.deepEqual(summary.costs, { input: 2.4, output: 1.2, cacheRead: 0.2 });
  assert.ok(Math.abs(summary.estimatedCost! - 3.8) < 1e-12);
  assert.equal(summary.coverage, "complete");
});

test("sin tarifas guardadas se conservan los tokens pero no se usa el importe del SDK", () => {
  const summary = consumption([message]);
  assert.equal(summary.usedTokens, 1_750_000);
  assert.equal(summary.prices, null);
  assert.equal(summary.costs, null);
  assert.equal(summary.estimatedCost, null);
});

test("los datos ausentes y mensajes en curso dejan una estimación parcial", () => {
  for (const incomplete of [
    { ...message, id: "missing", tokens: null },
    { ...message, id: "streaming", completed: false },
  ]) {
    const summary = consumption([message, incomplete], prices);
    assert.equal(summary.coverage, "partial");
    assert.ok(summary.estimatedCost! > 0);
  }
  const partial = consumption([message, { ...message, tokens: null }], prices);
  assert.equal(partial.usedTokens, 1_750_000);
  assert.ok(Math.abs(partial.estimatedCost! - 3.8) < 1e-12);
});

test("sin ningún dato de tokens el total y coste no aparecen como cero", () => {
  for (const usage of [[], [{ ...message, tokens: null }]]) {
    const summary = consumption(usage, prices);
    assert.equal(summary.usedTokens, null);
    assert.equal(summary.costs, null);
    assert.equal(summary.estimatedCost, null);
    assert.equal(summary.coverage, "unavailable");
  }
});

test("las tarifas gratuitas son válidas y producen un coste cero conocido", () => {
  const free = createTokenPrices({
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
    cacheReadUsdPerMillion: 0,
  });
  assert.equal(consumption([message], free).estimatedCost, 0);
});

test("las tarifas exigen los tres precios numéricos, finitos y no negativos", () => {
  assert.deepEqual(createTokenPrices(prices), prices);
  for (const invalid of [null, [], "2", {}, { inputUsdPerMillion: 2 }]) {
    assert.throws(() => createTokenPrices(invalid), /tokenPrices/);
  }
  for (const key of Object.keys(prices)) {
    for (const invalid of [-1, NaN, Infinity, null, "2", undefined]) {
      assert.throws(
        () => createTokenPrices({ ...prices, [key]: invalid }),
        /finite nonnegative number/,
      );
    }
  }
});

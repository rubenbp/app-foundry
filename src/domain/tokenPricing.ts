/** Prices for the selected model, in USD per million tokens. */
export interface TokenPrices {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
}

export function createTokenPrices(value: unknown): TokenPrices {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tokenPrices must be an object");
  }
  const prices = value as Record<string, unknown>;
  for (const key of [
    "inputUsdPerMillion",
    "outputUsdPerMillion",
    "cacheReadUsdPerMillion",
  ]) {
    if (
      typeof prices[key] !== "number" ||
      !Number.isFinite(prices[key]) ||
      prices[key] < 0
    ) {
      throw new Error(`tokenPrices.${key} must be a finite nonnegative number`);
    }
  }

  return {
    inputUsdPerMillion: prices.inputUsdPerMillion as number,
    outputUsdPerMillion: prices.outputUsdPerMillion as number,
    cacheReadUsdPerMillion: prices.cacheReadUsdPerMillion as number,
  };
}

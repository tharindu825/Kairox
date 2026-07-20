export const FUTURES_MULTIPLIER_MAP: Record<string, number> = {
  'SHIBUSDT': 1000,
  'XECUSDT': 1000,
  'LUNCUSDT': 1000,
  'PEPEUSDT': 1000,
  'FLOKIUSDT': 1000,
  'BONKUSDT': 1000,
  'SATSUSDT': 1000,
  'RATSUSDT': 1000,
  'PEPEUSDC': 1000,
  'SHIBUSDC': 1000,
  'BONKUSDC': 1000,
  'CATUSDT': 1000,
  'XUSDT': 1000,
  'CHEEMSUSDT': 1000,
  'WHYUSDT': 1000,
  'MOGUSDT': 1000000,
  'BOBUSDT': 1000000
};

export function formatFuturesSymbol(symbol: string): { displaySymbol: string; multiplier: number } {
  const upperSymbol = symbol.toUpperCase();
  const multiplier = FUTURES_MULTIPLIER_MAP[upperSymbol];
  
  if (multiplier) {
    return {
      displaySymbol: `${multiplier}${upperSymbol}`,
      multiplier: multiplier
    };
  }
  
  return {
    displaySymbol: upperSymbol,
    multiplier: 1
  };
}

export function formatPrice(price: number, multiplier: number): string {
  const adjusted = price * multiplier;
  // Format up to 8 decimal places, removing trailing zeros
  return parseFloat(adjusted.toFixed(8)).toString();
}

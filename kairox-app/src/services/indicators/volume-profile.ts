import { NormalizedCandle } from '../market-data/binance';

export interface VolumeProfileLevel {
  price: number;
  volume: number;
}

export interface VolumeProfileResult {
  poc: number; // Point of Control (highest volume price)
  vah: number; // Value Area High
  val: number; // Value Area Low
  profile: VolumeProfileLevel[];
}

export class VolumeProfileService {
  /**
   * Calculates the Volume Profile (Fixed Range) for a given set of candles.
   * Groups volume into specified number of price bins.
   * @param candles Array of historical candles
   * @param valueAreaPct Percentage of volume to include in Value Area (default 70%)
   * @param numBins Number of price levels (bins) to distribute volume into
   */
  public calculate(candles: NormalizedCandle[], valueAreaPct: number = 0.70, numBins: number = 50): VolumeProfileResult | null {
    if (!candles || candles.length === 0) return null;

    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    let totalVolume = 0;

    for (const c of candles) {
      if (c.high > highestHigh) highestHigh = c.high;
      if (c.low < lowestLow) lowestLow = c.low;
      totalVolume += c.volume;
    }

    if (totalVolume === 0 || highestHigh === lowestLow) return null;

    const binSize = (highestHigh - lowestLow) / numBins;
    const bins: VolumeProfileLevel[] = Array(numBins).fill(null).map((_, i) => ({
      price: lowestLow + (i * binSize) + (binSize / 2),
      volume: 0,
    }));

    // Distribute volume into bins
    for (const c of candles) {
      // Simple approximation: distribute volume evenly across the candle's price range
      const candleRange = c.high - c.low;
      if (candleRange === 0) {
        // If 0 range (doji), put all volume into the closest bin
        const binIndex = Math.min(
          Math.floor((c.close - lowestLow) / binSize),
          numBins - 1
        );
        if (bins[binIndex]) bins[binIndex].volume += c.volume;
        continue;
      }

      // Distribute proportionally to bins that overlap with the candle
      for (let i = 0; i < numBins; i++) {
        const binBottom = lowestLow + i * binSize;
        const binTop = binBottom + binSize;

        // Check if candle overlaps with this bin
        if (c.low <= binTop && c.high >= binBottom) {
          const overlapBottom = Math.max(c.low, binBottom);
          const overlapTop = Math.min(c.high, binTop);
          const overlapRange = overlapTop - overlapBottom;
          
          const volumeFraction = overlapRange / candleRange;
          bins[i].volume += c.volume * volumeFraction;
        }
      }
    }

    // Find POC (Point of Control)
    let poc = 0;
    let maxBinVol = -1;
    let pocIndex = -1;

    for (let i = 0; i < bins.length; i++) {
      if (bins[i].volume > maxBinVol) {
        maxBinVol = bins[i].volume;
        poc = bins[i].price;
        pocIndex = i;
      }
    }

    // Calculate Value Area (70% of total volume centered around POC)
    const targetVaVolume = totalVolume * valueAreaPct;
    let currentVaVolume = maxBinVol;
    
    let upIndex = pocIndex + 1;
    let downIndex = pocIndex - 1;

    let vahIndex = pocIndex;
    let valIndex = pocIndex;

    while (currentVaVolume < targetVaVolume && (upIndex < numBins || downIndex >= 0)) {
      const upVol = upIndex < numBins ? bins[upIndex].volume : -1;
      const downVol = downIndex >= 0 ? bins[downIndex].volume : -1;

      if (upVol >= downVol && upVol !== -1) {
        currentVaVolume += upVol;
        vahIndex = upIndex;
        upIndex++;
      } else if (downVol > upVol && downVol !== -1) {
        currentVaVolume += downVol;
        valIndex = downIndex;
        downIndex--;
      } else {
        break;
      }
    }

    return {
      poc,
      vah: bins[vahIndex].price,
      val: bins[valIndex].price,
      profile: bins,
    };
  }
}

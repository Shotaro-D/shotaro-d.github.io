"use strict";

/**
 * Calculate descriptive statistics for independently sampled particle sizes.
 *
 * Standard deviation is the sample standard deviation (n - 1 denominator).
 * It is intentionally null for n < 2 because dispersion cannot then be
 * estimated from a sample.
 */
export function numberStats(values) {
  const data = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!data.length) {
    return {
      count: 0,
      mean: null,
      standardDeviation: null,
      cvPercent: null,
      median: null,
      sum: 0,
      sumSquares: 0,
    };
  }
  const sum = data.reduce((total, value) => total + value, 0);
  const sumSquares = data.reduce((total, value) => total + value ** 2, 0);
  const mean = sum / data.length;
  const squaredResiduals = data.reduce((total, value) => total + (value - mean) ** 2, 0);
  const standardDeviation = data.length > 1
    ? Math.sqrt(Math.max(0, squaredResiduals / (data.length - 1)))
    : null;
  const sorted = [...data].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    count: data.length,
    mean,
    standardDeviation,
    cvPercent: mean > 0 && standardDeviation !== null ? 100 * standardDeviation / mean : null,
    median,
    sum,
    sumSquares,
  };
}

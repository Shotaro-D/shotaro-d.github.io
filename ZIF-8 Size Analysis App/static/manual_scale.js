"use strict";

// BMP/TIFF scale-bar detection is deliberately independent of application
// state so it can be exercised directly in Node and reused by the UI.
const FOOTER_DARK_FRACTION_MIN = 0.65;

function localPixelLuminance(pixels, width, x, y) {
  const offset = (y * width + x) * 4;
  return (0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2]) / 255;
}

function trueRunsAbove(values, threshold) {
  const runs = [];
  let start = null;
  for (let index = 0; index <= values.length; index += 1) {
    const qualifies = index < values.length && values[index] >= threshold;
    if (qualifies && start === null) start = index;
    if (!qualifies && start !== null) {
      runs.push([start, index]);
      start = null;
    }
  }
  return runs;
}

export function detectLocalFooter(image) {
  const pixels = image?.tiffPixels;
  const width = Number(image?.naturalWidth || 0);
  const height = Number(image?.naturalHeight || 0);
  if (!pixels || width <= 0 || height <= 0) return null;
  const rowDarkFraction = new Float32Array(height);
  for (let y = 0; y < height; y += 1) {
    let dark = 0;
    for (let x = 0; x < width; x += 1) {
      if (localPixelLuminance(pixels, width, x, y) <= 0.06) dark += 1;
    }
    rowDarkFraction[y] = dark / width;
  }
  const start = Math.max(0, Math.round(height * 0.55));
  let yStart = null;
  for (let y = start; y <= height - 6; y += 1) {
    let qualifies = true;
    for (let row = y; row < y + 6; row += 1) {
      if (rowDarkFraction[row] < FOOTER_DARK_FRACTION_MIN) {
        qualifies = false;
        break;
      }
    }
    if (qualifies) {
      yStart = y;
      break;
    }
  }
  if (yStart === null) return null;
  const beforeStart = Math.max(0, yStart - 3);
  const beforeRows = Math.max(1, yStart - beforeStart);
  let before = 0;
  for (let y = beforeStart; y < yStart; y += 1) before += rowDarkFraction[y];
  let after = 0;
  for (let y = yStart; y < Math.min(height, yStart + 6); y += 1) after += rowDarkFraction[y];
  const transitionContrast = Math.min(1, Math.max(0, ((1 - before / beforeRows) - (1 - after / 6)) / 0.35));
  let darkMean = 0;
  for (let y = yStart; y < Math.min(height, yStart + 6); y += 1) darkMean += rowDarkFraction[y];
  darkMean /= 6;
  const darknessScore = Math.min(1, Math.max(0, (darkMean - FOOTER_DARK_FRACTION_MIN) / (1 - FOOTER_DARK_FRACTION_MIN)));
  const locationScore = Math.min(1, Math.max(0, (yStart / height - 0.55) / 0.35));
  return {
    x_start: 0,
    y_start: yStart,
    x_end: width,
    y_end: height,
    confidence: Math.min(1, Math.max(0, 0.45 * darknessScore + 0.35 * transitionContrast + 0.20 * locationScore)),
    method: "dark_row_transition",
  };
}

function selectLocalTickSpan(centers, expectedLength) {
  if (centers.length < 2) return [0, Math.max(0, centers.length - 1)];
  if (expectedLength > 0) {
    let best = null;
    for (let first = 0; first < centers.length - 2; first += 1) {
      for (let last = first + 2; last < centers.length; last += 1) {
        const span = centers[last] - centers[first];
        const relativeError = Math.abs(span - expectedLength) / expectedLength;
        const candidate = [relativeError, first, last];
        if (!best || candidate[0] < best[0]) best = candidate;
      }
    }
    if (best) return [best[1], best[2]];
  }
  return [0, centers.length - 1];
}

export function detectLocalScaleMarker(image, micronMarkerNm, pixelSizeNmPerPx) {
  const pixels = image?.tiffPixels;
  const width = Number(image?.naturalWidth || 0);
  const height = Number(image?.naturalHeight || 0);
  const footer = detectLocalFooter(image);
  if (!pixels || width <= 0 || height <= 0 || !footer || footer.y_end - footer.y_start < 4) {
    return { footer, marker: null };
  }
  const expectedLength = micronMarkerNm > 0 && pixelSizeNmPerPx > 0
    ? micronMarkerNm / pixelSizeNmPerPx
    : null;
  const bandHeight = Math.max(4, Math.min(40, Math.floor((footer.y_end - footer.y_start) / 3)));
  const bandYEnd = Math.min(height, footer.y_start + bandHeight);
  const columnCoverage = new Float32Array(width);
  for (let y = footer.y_start; y < bandYEnd; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (localPixelLuminance(pixels, width, x, y) >= 0.88) columnCoverage[x] += 1;
    }
  }
  for (let x = 0; x < width; x += 1) columnCoverage[x] /= bandHeight;
  const rightStart = Math.max(footer.x_start, Math.round(width * 0.50));
  const maxTickWidth = Math.max(12, Math.round(width * 0.012));
  const tickRuns = trueRunsAbove(columnCoverage, 0.35).filter(([start, end]) => (
    start >= rightStart && end - start >= 2 && end - start <= maxTickWidth
  ));

  if (tickRuns.length >= 3) {
    const centers = tickRuns.map(([start, end]) => (start + end - 1) / 2);
    const [first, last] = selectLocalTickSpan(centers, expectedLength);
    const selectedRuns = tickRuns.slice(first, last + 1);
    const selectedCenters = centers.slice(first, last + 1);
    const xStart = selectedRuns[0][0];
    const xEnd = selectedRuns[selectedRuns.length - 1][1];
    let occupiedStart = null;
    let occupiedEnd = null;
    for (let y = footer.y_start; y < bandYEnd; y += 1) {
      for (const [start, end] of selectedRuns) {
        let occupied = false;
        for (let x = start; x < end; x += 1) {
          if (localPixelLuminance(pixels, width, x, y) >= 0.88) {
            occupied = true;
            break;
          }
        }
        if (occupied) {
          occupiedStart = occupiedStart === null ? y : Math.min(occupiedStart, y);
          occupiedEnd = Math.max(occupiedEnd ?? y, y + 1);
          break;
        }
      }
    }
    const spacings = selectedCenters.slice(1).map((center, index) => center - selectedCenters[index]);
    const meanSpacing = spacings.length ? spacings.reduce((sum, value) => sum + value, 0) / spacings.length : 0;
    const spacingCv = meanSpacing > 0
      ? Math.sqrt(spacings.reduce((sum, value) => sum + (value - meanSpacing) ** 2, 0) / spacings.length) / meanSpacing
      : 1;
    const uniformity = Math.min(1, Math.max(0, 1 - spacingCv / 0.20));
    const coverage = selectedRuns.reduce((sum, [start, end]) => sum + columnCoverage.slice(start, end).reduce((inner, value) => inner + value, 0) / Math.max(1, end - start), 0) / selectedRuns.length;
    const detectedLength = xEnd - xStart;
    const relativeError = expectedLength ? Math.abs(detectedLength - expectedLength) / expectedLength : null;
    const agreement = relativeError === null ? 0.55 : Math.exp(-relativeError / 0.08);
    const countScore = Math.min(1, Math.max(0, (selectedRuns.length - 2) / 6));
    return {
      footer,
      marker: {
        marker_kind: "tick_ruler",
        x_start: xStart,
        x_end: xEnd,
        y_start: occupiedStart ?? footer.y_start,
        y_end: occupiedEnd ?? bandYEnd,
        detected_length_px: detectedLength,
        expected_length_px: expectedLength,
        relative_error: relativeError,
        tick_count: selectedRuns.length,
        confidence: Math.min(1, Math.max(0, 0.30 * uniformity + 0.30 * agreement + 0.25 * coverage + 0.15 * countScore)),
      },
    };
  }

  let best = null;
  for (let row = 0; row < bandHeight; row += 1) {
    const values = new Uint8Array(width);
    const y = footer.y_start + row;
    for (let x = 0; x < width; x += 1) values[x] = localPixelLuminance(pixels, width, x, y) >= 0.88 ? 1 : 0;
    for (const [start, end] of trueRunsAbove(values, 1)) {
      const length = end - start;
      if (start < rightStart || length < Math.max(8, Math.round(width * 0.02))) continue;
      const score = expectedLength ? Math.abs(length - expectedLength) / expectedLength : -length;
      if (!best || score < best.score) best = {score, row, start, end};
    }
  }
  if (!best) return { footer, marker: null };
  const detectedLength = best.end - best.start;
  const relativeError = expectedLength ? Math.abs(detectedLength - expectedLength) / expectedLength : null;
  const agreement = relativeError === null ? 0.55 : Math.exp(-relativeError / 0.08);
  return {
    footer,
    marker: {
      marker_kind: "horizontal_bar",
      x_start: best.start,
      x_end: best.end,
      y_start: footer.y_start + best.row,
      y_end: footer.y_start + best.row + 1,
      detected_length_px: detectedLength,
      expected_length_px: expectedLength,
      relative_error: relativeError,
      tick_count: 0,
      confidence: Math.min(1, Math.max(0, 0.55 + 0.45 * agreement)),
    },
  };
}

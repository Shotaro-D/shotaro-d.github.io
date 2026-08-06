import assert from "node:assert/strict";

import { localAnalysisRun, isExcludedLocalPath } from "../static/manual_local_paths.js";
import { detectLocalFooter, detectLocalScaleMarker } from "../static/manual_scale.js";

const width = 1800;
const height = 652;
const footerStart = 436;
const barStart = 1189;
const barEnd = 1722;
const rgba = new Uint8ClampedArray(width * height * 4);

function fillRect(xStart, xEnd, yStart, yEnd, intensity) {
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const offset = 4 * (y * width + x);
      rgba[offset] = intensity;
      rgba[offset + 1] = intensity;
      rgba[offset + 2] = intensity;
      rgba[offset + 3] = 255;
    }
  }
}

// Reproduce the supplied BMP layout: a broad white bar over the upper part
// of a black SEM-information footer, not a Hitachi Regulus tick ruler.
fillRect(0, width, 0, height, 100);
fillRect(0, width, footerStart, 548, 0);
fillRect(barStart, barEnd, footerStart + 2, footerStart + 16, 255);

const image = { naturalWidth: width, naturalHeight: height, tiffPixels: rgba };
const footer = detectLocalFooter(image);
const detection = detectLocalScaleMarker(image, null, null);

assert.equal(footer.y_start, footerStart);
assert.equal(detection.marker.marker_kind, "horizontal_bar");
assert.equal(detection.marker.detected_length_px, barEnd - barStart);
assert.ok(detection.marker.confidence >= 0.65);

assert.equal(
  localAnalysisRun("experiment/SEM_25k/MLZIF99_image.bmp"),
  "experiment/SEM_25k",
);
assert.equal(isExcludedLocalPath("experiment/Archive/image.bmp"), true);
assert.equal(isExcludedLocalPath("experiment/gomi/image.bmp"), true);
assert.equal(isExcludedLocalPath("experiment/trash/image.bmp"), true);
assert.equal(isExcludedLocalPath("experiment/SEM_25k/image.bmp"), false);

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const manualSource = fs.readFileSync(path.join(projectRoot, "static", "manual.js"), "utf8");
const sandbox = {
  window: {
    SemTiffDecoder: { decodeTiff: () => null },
    ManualGeometry: {},
  },
  console,
};
vm.createContext(sandbox);
vm.runInContext(
  `${manualSource}\nglobalThis.__manualFunctions = { detectLocalFooter, detectLocalScaleMarker, localAnalysisRun, isExcludedLocalPath };`,
  sandbox,
  { filename: "manual.js" },
);

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
const footer = sandbox.__manualFunctions.detectLocalFooter(image);
const detection = sandbox.__manualFunctions.detectLocalScaleMarker(image, null, null);

assert.equal(footer.y_start, footerStart);
assert.equal(detection.marker.marker_kind, "horizontal_bar");
assert.equal(detection.marker.detected_length_px, barEnd - barStart);
assert.ok(detection.marker.confidence >= 0.65);

assert.equal(
  sandbox.__manualFunctions.localAnalysisRun({
    name: "MLZIF99_image.bmp",
    webkitRelativePath: "experiment/SEM_25k/MLZIF99_image.bmp",
  }),
  "experiment/SEM_25k",
);
assert.equal(sandbox.__manualFunctions.isExcludedLocalPath("experiment/Archive/image.bmp"), true);
assert.equal(sandbox.__manualFunctions.isExcludedLocalPath("experiment/gomi/image.bmp"), true);
assert.equal(sandbox.__manualFunctions.isExcludedLocalPath("experiment/trash/image.bmp"), true);
assert.equal(sandbox.__manualFunctions.isExcludedLocalPath("experiment/SEM_25k/image.bmp"), false);

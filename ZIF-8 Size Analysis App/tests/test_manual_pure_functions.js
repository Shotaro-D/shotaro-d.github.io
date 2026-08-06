import assert from "node:assert/strict";

import { wheelInteraction } from "../static/manual_geometry.js";
import { numberStats } from "../static/manual_statistics.js";

const sample = numberStats([2, 4]);
assert.equal(sample.count, 2);
assert.equal(sample.mean, 3);
assert.ok(Math.abs(sample.standardDeviation - Math.sqrt(2)) < 1e-12);
assert.ok(Math.abs(sample.cvPercent - 100 * Math.sqrt(2) / 3) < 1e-12);

const single = numberStats([7]);
assert.equal(single.standardDeviation, null);
assert.equal(single.cvPercent, null);

const trackpadDiagonal = wheelInteraction(5, -3, false, true);
assert.equal(trackpadDiagonal.target, "model");
assert.equal(trackpadDiagonal.delta, -3);

const explicitImageZoom = wheelInteraction(0, -3, true, true);
assert.equal(explicitImageZoom.target, "image");
assert.equal(explicitImageZoom.source, "modified-index");

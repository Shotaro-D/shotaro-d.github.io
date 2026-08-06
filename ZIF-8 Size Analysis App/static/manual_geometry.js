"use strict";

  function quaternionFromAxisAngle(axis, angle) {
    const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    const half = angle / 2;
    const s = Math.sin(half) / length;
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
  }

  function quaternionMultiply(a, b) {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    const result = [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    ];
    const norm = Math.hypot(...result) || 1;
    const normalised = result.map((value) => value / norm);
    return normalised[3] < 0
      ? normalised.map((value) => -value)
      : normalised;
  }

  function dragRotationQuaternion(dx, dy, radiansPerPixel) {
    const sensitivity = Number(radiansPerPixel);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)
      || !Number.isFinite(sensitivity) || sensitivity <= 0) {
      throw new TypeError("drag rotation requires finite deltas and a positive sensitivity");
    }
    const yaw = quaternionFromAxisAngle([0, 1, 0], -dx * sensitivity);
    const pitch = quaternionFromAxisAngle([1, 0, 0], dy * sensitivity);
    return quaternionMultiply(pitch, yaw);
  }

  function axisConstrainedDragQuaternion(axisName, dx, dy, radiansPerPixel) {
    const axis = String(axisName || "").toLowerCase();
    const horizontal = Number(dx);
    const vertical = Number(dy);
    const sensitivity = Number(radiansPerPixel);
    if (!["x", "y", "z"].includes(axis)
      || !Number.isFinite(horizontal) || !Number.isFinite(vertical)
      || !Number.isFinite(sensitivity) || sensitivity <= 0) {
      throw new TypeError("axis-constrained rotation requires x/y/z, finite deltas, and positive sensitivity");
    }
    const definitions = {
      x: { vector: [1, 0, 0], angle: vertical * sensitivity },
      y: { vector: [0, 1, 0], angle: -horizontal * sensitivity },
      z: { vector: [0, 0, 1], angle: horizontal * sensitivity },
    };
    const definition = definitions[axis];
    return quaternionFromAxisAngle(definition.vector, definition.angle);
  }

  function rotationAxisForShortcut(event) {
    if (!event || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return null;
    const key = String(event.key || "").toLowerCase();
    return ["x", "y", "z"].includes(key) ? key : null;
  }

  function actionForShortcut(event) {
    if (!event || event.isComposing || event.repeat) return null;
    const key = String(event.key || "").toLowerCase();
    const commandDown = Boolean(event.metaKey || event.ctrlKey);
    if (commandDown && !event.altKey && key === "s") return "commit";
    if (commandDown && !event.altKey && key === "c") return "copy-particle";
    if (commandDown && !event.altKey && key === "v") return "paste-particle";
    if (!commandDown && !event.altKey && (key === "delete" || key === "backspace")) {
      return "delete-particle";
    }
    if (!commandDown && !event.altKey && key === "t") return "new-particle";
    return null;
  }

  function particleNumberLabel(particleId, fallbackIndex) {
    const match = String(particleId || "").match(/(\d+)$/);
    if (match) return String(Number.parseInt(match[1], 10));
    const fallback = Number(fallbackIndex);
    return Number.isInteger(fallback) && fallback > 0 ? String(fallback) : "?";
  }

  function offsetPastedTranslation(position, width, height, screenOffset = 14, viewScale = 1) {
    const x = Number(position?.[0]);
    const y = Number(position?.[1]);
    const maxX = Number(width);
    const maxY = Number(height);
    const offset = Number(screenOffset);
    const scale = Number(viewScale);
    if (![x, y, maxX, maxY, offset, scale].every(Number.isFinite)
      || maxX < 0 || maxY < 0 || offset < 0 || scale <= 0) {
      throw new TypeError("paste offset requires finite coordinates and positive bounds/scale");
    }
    const delta = offset / scale;
    const shifted = (value, maximum) => {
      if (value + delta <= maximum) return value + delta;
      if (value - delta >= 0) return value - delta;
      return Math.min(maximum, Math.max(0, value));
    };
    return [shifted(x, maxX), shifted(y, maxY)];
  }

  function dragToolForModifiers(shiftKey = false, optionKey = false) {
    if (Boolean(shiftKey)) return "move";
    if (Boolean(optionKey)) return "roll";
    return "rotate";
  }

  function wheelScaleFactor(deltaY, deltaMode = 0, viewportHeight = 800) {
    const delta = Number(deltaY);
    const mode = Number(deltaMode);
    const pageHeight = Number(viewportHeight);
    if (!Number.isFinite(delta) || !Number.isFinite(mode)
      || !Number.isFinite(pageHeight) || pageHeight <= 0) {
      throw new TypeError("wheel scaling requires finite values and a positive viewport height");
    }
    const pixelDelta = mode === 1
      ? delta * 16
      : (mode === 2 ? delta * pageHeight : delta);
    const limitedDelta = Math.min(240, Math.max(-240, pixelDelta));
    return Math.exp(-limitedDelta * 0.001);
  }

  function wheelInteraction(deltaX, deltaY, imageZoomModifier = false, hasWorkingParticle = false) {
    const x = Number(deltaX);
    const y = Number(deltaY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError("wheel interaction requires finite deltas");
    }
    // Browsers do not expose a reliable distinction between a mouse thumb
    // wheel and a trackpad's diagonal scroll.  Do not infer image zoom from
    // deltaX: it would make trackpad use silently alter the image instead of
    // the working particle.  Image zoom is always an explicit modifier.
    const imageZoom = Boolean(imageZoomModifier);
    return Object.freeze({
      source: imageZoom ? "modified-index" : "index",
      target: imageZoom || !Boolean(hasWorkingParticle)
        ? "image"
        : "model",
      delta: y,
    });
  }

  function relativeZoomForActualPixels(fitScale) {
    const scale = Number(fitScale);
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new TypeError("fit scale must be a positive finite number");
    }
    return 1 / scale;
  }

  function shouldSmoothImage(viewScale) {
    const scale = Number(viewScale);
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new TypeError("view scale must be a positive finite number");
    }
    return scale < 1 - 1e-9;
  }

  function rotateVector(q, vector) {
    const [qx, qy, qz, qw] = q;
    const [x, y, z] = vector;
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    return [
      x + qw * tx + (qy * tz - qz * ty),
      y + qw * ty + (qz * tx - qx * tz),
      z + qw * tz + (qx * ty - qy * tx),
    ];
  }

  function convexHull(points) {
    const sorted = points
      .map((point) => [Number(point[0]), Number(point[1])])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const unique = sorted.filter((point, index) =>
      index === 0 || point[0] !== sorted[index - 1][0] || point[1] !== sorted[index - 1][1],
    );
    if (unique.length <= 2) return unique;
    const cross = (o, a, b) =>
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const point of unique) {
      while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
      lower.push(point);
    }
    const upper = [];
    for (let index = unique.length - 1; index >= 0; index -= 1) {
      const point = unique[index];
      while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
      upper.push(point);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function polygonArea(points) {
    if (!points || points.length < 3) return 0;
    let twiceArea = 0;
    for (let index = 0; index < points.length; index += 1) {
      const next = (index + 1) % points.length;
      twiceArea += points[index][0] * points[next][1]
        - points[index][1] * points[next][0];
    }
    return Math.abs(twiceArea) / 2;
  }

  function pointInPolygon(point, polygon) {
    if (!polygon || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const xi = polygon[i][0];
      const yi = polygon[i][1];
      const xj = polygon[j][0];
      const yj = polygon[j][1];
      const intersects = ((yi > point.y) !== (yj > point.y))
        && point.x < ((xj - xi) * (point.y - yi))
          / (yj - yi || Number.EPSILON) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function intersectVertical(a, b, x) {
    const t = (x - a[0]) / (b[0] - a[0] || Number.EPSILON);
    return [x, a[1] + t * (b[1] - a[1])];
  }

  function intersectHorizontal(a, b, y) {
    const t = (y - a[1]) / (b[1] - a[1] || Number.EPSILON);
    return [a[0] + t * (b[0] - a[0]), y];
  }

  function clipPolygonToRect(points, minX, minY, maxX, maxY) {
    let output = points.map((point) => [point[0], point[1]]);
    const boundaries = [
      { inside: (p) => p[0] >= minX, intersect: (a, b) => intersectVertical(a, b, minX) },
      { inside: (p) => p[0] <= maxX, intersect: (a, b) => intersectVertical(a, b, maxX) },
      { inside: (p) => p[1] >= minY, intersect: (a, b) => intersectHorizontal(a, b, minY) },
      { inside: (p) => p[1] <= maxY, intersect: (a, b) => intersectHorizontal(a, b, maxY) },
    ];
    for (const boundary of boundaries) {
      const input = output;
      output = [];
      if (!input.length) break;
      let previous = input.at(-1);
      for (const current of input) {
        const currentInside = boundary.inside(current);
        const previousInside = boundary.inside(previous);
        if (currentInside) {
          if (!previousInside) output.push(boundary.intersect(previous, current));
          output.push(current);
        } else if (previousInside) {
          output.push(boundary.intersect(previous, current));
        }
        previous = current;
      }
    }
    return output;
  }

export {
  actionForShortcut,
  axisConstrainedDragQuaternion,
  clipPolygonToRect,
  convexHull,
  dragToolForModifiers,
  dragRotationQuaternion,
  pointInPolygon,
  particleNumberLabel,
  offsetPastedTranslation,
  polygonArea,
  quaternionFromAxisAngle,
  quaternionMultiply,
  relativeZoomForActualPixels,
  rotateVector,
  rotationAxisForShortcut,
  shouldSmoothImage,
  wheelInteraction,
  wheelScaleFactor,
};

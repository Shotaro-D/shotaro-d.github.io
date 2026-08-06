/* Browser-local analysis core.
 *
 * This file deliberately never calls fetch(), XMLHttpRequest, FormData, or
 * any upload API for user-selected files. It reads File objects supplied by
 * the user and returns plain JSON/CSV-compatible data to app.js.
 */
(function exposeLocalAnalysis(global) {
  "use strict";

  const OUTPUT_COLUMNS = [
    "Shape",
    "Average diameter (nm)",
    "standard deviation (nm)",
    "CV (%)",
    "Counts",
  ];
  const SHAPE_LABELS = {
    rhombic_dodecahedron: "Rhombic dodecahedron",
    chamfered_cube: "Chamfered cube",
    cube: "Cube",
  };
  const SHAPE_ORDER = ["rhombic_dodecahedron", "chamfered_cube", "cube"];
  const SHAPE_ALIASES = {
    "rhombic dodecahedron": "rhombic_dodecahedron",
    rhombic_dodecahedron: "rhombic_dodecahedron",
    "rhombic-dodecahedron": "rhombic_dodecahedron",
    "chamfered cube": "chamfered_cube",
    chamfered_cube: "chamfered_cube",
    "chamfered-cube": "chamfered_cube",
    cube: "cube",
  };
  const EXCLUDED_DIRECTORY_NAMES = new Set([
    ".git",
    ".pytest_cache",
    "__pycache__",
    "archive",
    "archive code",
  ]);

  function relativePath(file) {
    return String(file.webkitRelativePath || file.name || "").replaceAll("\\", "/");
  }

  function isExcludedPath(path) {
    return relativePath(path)
      .split("/")
      .some((part) => EXCLUDED_DIRECTORY_NAMES.has(part.toLowerCase()));
  }

  function isJson(file) {
    return /\.json$/i.test(file.name || relativePath(file));
  }

  function isTiff(file) {
    return /\.(tif|tiff)$/i.test(file.name || relativePath(file));
  }

  function isTxt(file) {
    return /\.txt$/i.test(file.name || relativePath(file));
  }

  function isJpeg(file) {
    return /\.(jpe?g)$/i.test(file.name || relativePath(file));
  }

  function isCsv(file) {
    return /\.csv$/i.test(file.name || relativePath(file));
  }

  function sessionIdentity(session, file) {
    const dataset = session && typeof session.dataset === "object" ? session.dataset : null;
    const hash = String(dataset && dataset.image_sha256 || "").trim().toLowerCase();
    if (hash) return `image_sha256\u001f${hash}`;
    const image = session && typeof session.image === "object" ? session.image : null;
    const imageName = String(image && image.name || file.name || "").trim();
    const sample = String(session && session.sample || "").trim();
    return `sample_and_image\u001f${sample}\u001f${imageName}`.toLowerCase();
  }

  function timestampKey(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return Number(digits.slice(0, 17)) || Number.NEGATIVE_INFINITY;
  }

  function candidatePriority(candidate) {
    const path = relativePath(candidate.file).toLowerCase();
    return [
      /(^|\/)outputs(\/|$)|(^|\/)work(\/|$)/.test(path) ? 1 : 0,
      candidate.file.name.endsWith("_manual_count_session.json") ? 1 : 0,
      -timestampKey(candidate.session.updated_at),
      path,
    ];
  }

  function comparePriority(left, right) {
    const a = candidatePriority(left);
    const b = candidatePriority(right);
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] < b[index]) return -1;
      if (a[index] > b[index]) return 1;
    }
    return 0;
  }

  function chooseCandidate(candidates) {
    return candidates.slice().sort(comparePriority)[0];
  }

  async function discoverSessions(files) {
    const candidates = [];
    for (const file of files) {
      if (!isJson(file) || isExcludedPath(file)) continue;
      let session;
      try {
        session = JSON.parse(await file.text());
      } catch (_) {
        continue;
      }
      if (!session || typeof session !== "object" || !Array.isArray(session.particles)) continue;
      candidates.push({
        file,
        session,
        identity: sessionIdentity(session, file),
      });
    }
    return candidates;
  }

  function inventory(files, sessions) {
    const activeFiles = files.filter((file) => !isExcludedPath(file));
    const extensions = {};
    activeFiles.forEach((file) => {
      const match = /\.[^.]+$/.exec(file.name || relativePath(file));
      const extension = match ? match[0].toLowerCase() : "(なし)";
      extensions[extension] = (extensions[extension] || 0) + 1;
    });
    return {
      file_count: activeFiles.length,
      total_bytes: activeFiles.reduce((sum, file) => sum + (Number(file.size) || 0), 0),
      tiff_count: activeFiles.filter(isTiff).length,
      txt_count: activeFiles.filter(isTxt).length,
      jpeg_count: activeFiles.filter(isJpeg).length,
      csv_count: activeFiles.filter(isCsv).length,
      json_count: activeFiles.filter(isJson).length,
      session_count: sessions.length,
      extensions,
      session_files: sessions.map((candidate) => relativePath(candidate.file)),
    };
  }

  function normaliseShape(value) {
    const raw = String(value || "").trim().toLowerCase().replaceAll("_", " ");
    return SHAPE_ALIASES[raw] || null;
  }

  function diameterNm(particle) {
    for (const key of ["equivalent_diameter_nm", "d_eq_nm"]) {
      if (!(key in particle)) continue;
      const value = Number(particle[key]);
      if (!Number.isFinite(value) || value < 0) return null;
      return value;
    }
    return null;
  }

  function row(label, diameters) {
    if (!diameters.length) {
      return {
        Shape: label,
        "Average diameter (nm)": "",
        "standard deviation (nm)": "",
        "CV (%)": "",
        Counts: 0,
      };
    }
    const mean = diameters.reduce((sum, value) => sum + value, 0) / diameters.length;
    const variance = diameters.reduce((sum, value) => sum + (value - mean) ** 2, 0) / diameters.length;
    const standardDeviation = Math.sqrt(Math.max(0, variance));
    return {
      Shape: label,
      "Average diameter (nm)": mean,
      "standard deviation (nm)": standardDeviation,
      "CV (%)": mean > 0 ? 100 * standardDeviation / mean : "",
      Counts: diameters.length,
    };
  }

  function aggregate(sessions, includeExcluded) {
    const groups = new Map();
    sessions.forEach((candidate) => {
      const group = groups.get(candidate.identity) || [];
      group.push(candidate);
      groups.set(candidate.identity, group);
    });

    const values = new Map(SHAPE_ORDER.map((shape) => [shape, []]));
    const used = [];
    for (const group of groups.values()) {
      const candidate = chooseCandidate(group);
      used.push(candidate);
      for (const particle of candidate.session.particles) {
        if (!particle || typeof particle !== "object") continue;
        if (!includeExcluded && particle.included_in_statistics === false) continue;
        const shape = normaliseShape(particle.shape || particle.shape_label);
        const diameter = diameterNm(particle);
        if (!shape || diameter === null) continue;
        if (!values.has(shape)) values.set(shape, []);
        values.get(shape).push(diameter);
      }
    }
    const rows = SHAPE_ORDER.map((shape) => row(SHAPE_LABELS[shape], values.get(shape)));
    for (const [shape, diameters] of values.entries()) {
      if (!(shape in SHAPE_LABELS)) rows.push(row(shape, diameters));
    }
    return { rows, used };
  }

  function formatNumber(value) {
    return typeof value === "number" ? Number(value.toPrecision(10)).toString() : value;
  }

  function csvText(rows) {
    const quote = (value) => {
      const text = value === null || value === undefined ? "" : String(formatNumber(value));
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    return [
      OUTPUT_COLUMNS.map(quote).join(","),
      ...rows.map((item) => OUTPUT_COLUMNS.map((column) => quote(item[column])).join(",")),
    ].join("\n") + "\n";
  }

  async function inspect(files) {
    const sessions = await discoverSessions(files);
    return { files, sessions, inventory: inventory(files, sessions) };
  }

  function analyse(inspection, includeExcluded = false) {
    const result = aggregate(inspection.sessions, includeExcluded);
    return {
      rows: result.rows,
      used_files: result.used.map((candidate) => relativePath(candidate.file)),
      session_count: result.used.length,
      particle_count: result.rows.reduce((sum, item) => sum + Number(item.Counts || 0), 0),
      csv: csvText(result.rows),
    };
  }

  global.Zif8LocalAnalysis = { inspect, analyse, csvText };
}(window));

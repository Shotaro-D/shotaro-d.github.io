"use strict";

if (!window.SemTiffDecoder) {
  throw new Error("tiff_decoder.js was not loaded before manual.js");
}
if (!window.ManualGeometry) {
  throw new Error("manual_geometry.js was not loaded before manual.js");
}
const {
  actionForShortcut,
  axisConstrainedDragQuaternion,
  clipPolygonToRect,
  convexHull,
  dragToolForModifiers,
  dragRotationQuaternion,
  offsetPastedTranslation,
  particleNumberLabel,
  pointInPolygon,
  polygonArea,
  quaternionFromAxisAngle,
  quaternionMultiply,
  relativeZoomForActualPixels,
  rotateVector,
  rotationAxisForShortcut,
  shouldSmoothImage,
  wheelInteraction,
  wheelScaleFactor,
} = window.ManualGeometry;
const { decodeTiff } = window.SemTiffDecoder;

const SHAPE_LABELS = {
  rhombic_dodecahedron: "Rhombic dodecahedron",
  chamfered_cube: "Chamfered cube",
  cube: "Cube",
};

const SHAPE_SYMBOLS = {
  rhombic_dodecahedron: "◇",
  chamfered_cube: "⬡",
  cube: "□",
};

const SIZE_DISTRIBUTION_SHAPE_ORDER = Object.keys(SHAPE_LABELS);
const SIZE_DISTRIBUTION_FIGURE = {
  width: Math.round(60 / 25.4 * 900),
  height: Math.round(80 / 25.4 * 900),
  dpi: 900,
};
const SIZE_DISTRIBUTION_FONT_PT = 7;
const SIZE_DISTRIBUTION_TICK_LABEL_PT = SIZE_DISTRIBUTION_FONT_PT - 1;
const SIZE_DISTRIBUTION_OUTPUT_DIRECTORY = "Particle size";
const SIZE_DISTRIBUTION_FRAME_WIDTH_PT = 0.5;
const SIZE_DISTRIBUTION_LINE_WIDTH_PT = 0.75;
const SIZE_DISTRIBUTION_TICK_LENGTH_PT = 3.5;
const SIZE_DISTRIBUTION_GRID_WIDTH_PT = SIZE_DISTRIBUTION_FRAME_WIDTH_PT * 0.5;
const SIZE_DISTRIBUTION_FONT_PX = SIZE_DISTRIBUTION_FONT_PT * SIZE_DISTRIBUTION_FIGURE.dpi / 72;
const SIZE_DISTRIBUTION_TICK_LABEL_PX = SIZE_DISTRIBUTION_TICK_LABEL_PT * SIZE_DISTRIBUTION_FIGURE.dpi / 72;
const SIZE_DISTRIBUTION_FRAME_WIDTH_PX = SIZE_DISTRIBUTION_FRAME_WIDTH_PT * SIZE_DISTRIBUTION_FIGURE.dpi / 72;
const SIZE_DISTRIBUTION_LINE_WIDTH_PX = SIZE_DISTRIBUTION_LINE_WIDTH_PT * SIZE_DISTRIBUTION_FIGURE.dpi / 72;
const SIZE_DISTRIBUTION_TICK_LENGTH_PX = SIZE_DISTRIBUTION_TICK_LENGTH_PT * SIZE_DISTRIBUTION_FIGURE.dpi / 72;
const SIZE_DISTRIBUTION_GRID_WIDTH_PX = SIZE_DISTRIBUTION_GRID_WIDTH_PT * SIZE_DISTRIBUTION_FIGURE.dpi / 72;
const SIZE_DISTRIBUTION_TARGET_BIN_COUNT = 20;
const SIZE_DISTRIBUTION_HISTOGRAM_Y_MARGIN = 1.25;
const SIZE_DISTRIBUTION_HISTOGRAM_ALPHA = 0.6;
const SIZE_DISTRIBUTION_X_MARGIN = 0.05;
const NATURAL_ORDER_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

// Shape colours are deliberately distinct from the yellow selection colour.
// RD keeps the original turquoise; chamfered cubes use orange and cubes use
// purple so the same identity is visible in the palette, particle list,
// overlay, and number badge.
const SHAPE_COLORS = {
  rhombic_dodecahedron: {
    rgb: [81, 218, 199],
    css: "#51dac7",
    labelText: "#073d39",
  },
  chamfered_cube: {
    rgb: [244, 159, 83],
    css: "#f49f53",
    labelText: "#3d210d",
  },
  cube: {
    rgb: [181, 138, 235],
    css: "#b58aeb",
    labelText: "#24163a",
  },
};

const ROTATION_RADIANS_PER_PIXEL = 0.0105;
const INTERACTION_HELP_TEXT = "通常ドラッグ＝3D回転，X／Y／Z＋ドラッグ＝各モデル軸回転，Shift＋ドラッグ＝移動，Option＋ドラッグ＝2D回転です。人差し指ホイール＝図形サイズ（Shiftで画像ズーム），親指ホイール＝画像ズームです。";
const PARTICLE_NUMBER_PREFERENCE_KEY = "manual-sem-show-particle-numbers";
const SCALE_BAR_AUTO_DETECTION_MIN_CONFIDENCE = 0.65;
// The BMP footer can include a long white scale bar.  A footer row is still
// valid when up to 35% of its width is occupied by that overlay.
const FOOTER_DARK_FRACTION_MIN = 0.65;
const LOCAL_DIRECTORY_DATABASE_NAME = "zif8-manual-local-directory";
const LOCAL_DIRECTORY_DATABASE_VERSION = 1;
const LOCAL_DIRECTORY_STORE_NAME = "handles";
const LOCAL_DIRECTORY_RECORD_KEY = "active-directory";
const LOCAL_DIRECTORY_LAST_IMAGE_KEY = "zif8-manual-last-image";

const state = {
  session: null,
  meshes: {},
  chamferedMeshes: {},
  image: null,
  selectedShape: "rhombic_dodecahedron",
  working: null,
  workingId: null,
  workingOriginal: null,
  isDraft: false,
  isPlacing: false,
  dirty: false,
  saving: false,
  showParticleNumbers: true,
  particleClipboard: null,
  rotationAxisLock: null,
  view: { zoom: 1, panX: 0, panY: 0, mode: "actual" },
  pointer: null,
  spaceDown: false,
  canvasMetrics: null,
  drawPending: false,
  availableImages: [],
  selectedImageId: null,
  openTiffDirectories: new Set(),
  tiffDirectoryStateInitialized: false,
  switchingImage: false,
  shortcutsOpen: false,
  localFiles: [],
  localFileMap: new Map(),
  localFilePaths: new WeakMap(),
  localJsonFilesByName: new Map(),
  localSessionIndexReady: false,
  localDirectoryHandle: null,
  savedLocalDirectoryHandle: null,
  savedLocalDirectoryName: "",
  pendingRestoredImagePath: null,
  currentImageFile: null,
  currentImageBuffer: null,
  currentImageHash: "",
  localSessions: new Map(),
  localImageInspections: new Map(),
  localStarted: false,
  sizeDistributionLoading: false,
  sizeDistributionPayload: null,
};

const dom = {};

async function startManualApp() {
  if (state.localStarted) return;
  state.localStarted = true;
  cacheDom();
  state.showParticleNumbers = readBooleanPreference(PARTICLE_NUMBER_PREFERENCE_KEY, true);
  dom.showParticleNumbersInput.checked = state.showParticleNumbers;
  bindEvents();
  dom.interactionHelp.textContent = INTERACTION_HELP_TEXT;
  setConnection("loading", "モデル読込中");
  try {
    const meshPayload = await apiJson("/api/manual/meshes");
    state.meshes = meshPayload.meshes || {};
    state.chamferedMeshes = meshPayload.chamfered_meshes || {};
    setConnection("online", "ローカルのみ");
    const restoration = await restorePreviousLocalDirectory();
    if (restoration === "reconnect") {
      dom.openTiffButton.textContent = "前回のフォルダを再接続";
      dom.manualCanvasMessage.querySelector(".spinner").hidden = true;
      dom.manualCanvasMessage.querySelector("span:last-child").textContent = `前回のローカルフォルダ「${state.savedLocalDirectoryName}」は，このブラウザーで再接続できます。`;
      dom.manualCanvasMessage.classList.remove("is-error");
      dom.manualCanvasMessage.hidden = false;
    } else if (restoration !== "restored") {
      dom.manualCanvasMessage.querySelector(".spinner").hidden = true;
      dom.manualCanvasMessage.querySelector("span:last-child").textContent = "ローカルフォルダからTIFF／BMPを選択してください。";
      dom.manualCanvasMessage.classList.remove("is-error");
      dom.manualCanvasMessage.hidden = false;
    }
  } catch (error) {
    setConnection("error", "読込失敗");
    dom.manualCanvasMessage.querySelector(".spinner").hidden = true;
    dom.manualCanvasMessage.classList.add("is-error");
    dom.manualCanvasMessage.querySelector("span:last-child").textContent = error.message;
    toast(error.message, true);
  }
}

function cacheDom() {
  const ids = [
    "connectionStatus", "openTiffButton", "reloadButton", "importJsonButton", "importJsonInput", "saveJsonButton", "savePngButton", "saveJpegButton", "saveTxtButton", "sizeDistributionButton",
    "summaryCount", "summaryCountDetail", "summaryMean", "summaryStd", "summaryCv", "summaryScale",
    "scaleBadge", "scaleMarker", "scalePixels", "scaleConfidence", "scaleMethod",
    "scaleMarkerInput", "scalePixelsInput", "scaleVerificationNote", "verifyScaleButton",
    "shapePalette", "newParticleButton", "newParticleButtonLabel", "particleCountChip", "manualParticleList",
    "manualCanvas", "manualCanvasShell", "manualCanvasMessage", "zoomReadout", "currentImageName",
    "zoomOutButton", "zoomInButton", "actualPixelButton", "fitViewButton", "showParticleNumbersInput", "interactionHelp",
    "cursorCoordinate", "inspectorHeading", "editStateBadge", "inspectorEmpty",
    "inspectorContent", "inspectorShape", "chamferControl", "chamferHInput", "chamferHValue", "metricArea", "metricRadius",
    "metricDiameter", "metricScale", "resetOrientationButton", "centerParticleButton",
    "qualityWarning", "includeStatisticsInput", "exclusionReasonField", "exclusionReasonInput",
    "particleNotes", "commitParticleButton", "commitParticleButtonLabel", "cancelEditButton", "deleteParticleButton",
    "folderInput", "tiffDialog", "closeTiffDialogButton", "changeProjectButton", "refreshTiffIndexButton", "cancelTiffButton", "confirmTiffButton",
    "tiffImageList", "tiffDialogStatus", "sizeDistributionDialog", "refreshSizeDistributionButton", "closeSizeDistributionDialogButton", "cancelSizeDistributionButton", "saveSizeDistributionCsvButton", "sizeDistributionDialogStatus", "sizeDistributionList", "toastRegion", "shortcutPanel", "shortcutToggleButton",
    "shortcutList", "shortcutCloseButton",
  ];
  for (const id of ids) dom[id] = document.getElementById(id);
  dom.ctx = dom.manualCanvas.getContext("2d");
  if (!dom.ctx) throw new Error("Canvas 2D表示を初期化できませんでした。");
}

function bindEvents() {
  dom.openTiffButton.addEventListener("click", () => {
    if (!state.localFiles.length && state.savedLocalDirectoryHandle) reconnectSavedLocalFolder();
    else if (!state.localFiles.length) selectLocalFolder();
    else openTiffDialog();
  });
  dom.folderInput.addEventListener("change", (event) => {
    setLocalFiles(Array.from(event.target.files || [])).catch((error) => {
      toast(`ローカルフォルダを読み込めません：${error.message}`, true);
    });
  });
  dom.reloadButton.addEventListener("click", () => window.location.reload());
  dom.importJsonButton.addEventListener("click", () => dom.importJsonInput.click());
  dom.importJsonInput.addEventListener("change", importJsonFile);
  dom.saveJsonButton.addEventListener("click", () => saveArtifact("json"));
  dom.savePngButton.addEventListener("click", () => saveArtifact("png"));
  dom.saveJpegButton.addEventListener("click", () => saveArtifact("jpeg"));
  dom.saveTxtButton.addEventListener("click", () => saveArtifact("txt"));
  dom.sizeDistributionButton.addEventListener("click", openSizeDistributionDialog);
  dom.refreshSizeDistributionButton.addEventListener("click", refreshSizeDistribution);
  dom.closeSizeDistributionDialogButton.addEventListener("click", closeSizeDistributionDialog);
  dom.cancelSizeDistributionButton.addEventListener("click", closeSizeDistributionDialog);
  dom.saveSizeDistributionCsvButton.addEventListener("click", () => saveSizeDistributionCsv());
  dom.sizeDistributionList.addEventListener("click", onSizeDistributionListClick);
  dom.verifyScaleButton.addEventListener("click", verifyOrUpdateScale);
  dom.shapePalette.addEventListener("click", onShapePaletteClick);
  dom.newParticleButton.addEventListener("click", startDraft);
  dom.manualParticleList.addEventListener("click", onParticleListClick);
  dom.inspectorShape.addEventListener("change", () => {
    if (!state.working) return;
    state.working.shape = dom.inspectorShape.value;
    state.working.h = state.working.shape === "rhombic_dodecahedron"
      ? 0
      : (state.working.shape === "cube" ? 1 : 0.5);
    markDirty();
    renderInspector();
    requestDraw();
  });
  dom.chamferHInput.addEventListener("input", () => {
    if (!state.working || state.working.shape !== "chamfered_cube") return;
    state.working.h = Number(dom.chamferHInput.value);
    markDirtyAndRender();
  });
  dom.includeStatisticsInput.addEventListener("change", () => {
    if (!state.working) return;
    state.working.included_in_statistics = dom.includeStatisticsInput.checked;
    if (state.working.included_in_statistics) state.working.exclusion_reason = "";
    markDirty();
  });
  dom.exclusionReasonInput.addEventListener("input", () => {
    if (!state.working) return;
    state.working.exclusion_reason = dom.exclusionReasonInput.value;
    markDirty();
  });
  dom.particleNotes.addEventListener("input", () => {
    if (!state.working) return;
    state.working.notes = dom.particleNotes.value;
    markDirty();
  });
  dom.commitParticleButton.addEventListener("click", commitWorkingParticle);
  dom.cancelEditButton.addEventListener("click", cancelWorkingParticle);
  dom.deleteParticleButton.addEventListener("click", deleteWorkingParticle);
  dom.resetOrientationButton.addEventListener("click", () => {
    if (!state.working) return;
    state.working.quaternion_xyzw = [0, 0, 0, 1];
    markDirtyAndRender();
  });
  dom.centerParticleButton.addEventListener("click", () => {
    if (!state.working) return;
    state.working.translation_xy_px = viewportCenterInImage();
    markDirtyAndRender();
  });
  document.querySelectorAll("[data-nudge]").forEach((button) => {
    button.addEventListener("click", () => applyNudge(button.dataset.nudge));
  });
  dom.zoomOutButton.addEventListener("click", () => zoomAtCanvasCenter(1 / 1.25));
  dom.zoomInButton.addEventListener("click", () => zoomAtCanvasCenter(1.25));
  dom.actualPixelButton.addEventListener("click", showActualPixels);
  dom.fitViewButton.addEventListener("click", fitImageToCanvas);
  dom.showParticleNumbersInput.addEventListener("change", () => {
    state.showParticleNumbers = dom.showParticleNumbersInput.checked;
    writeBooleanPreference(PARTICLE_NUMBER_PREFERENCE_KEY, state.showParticleNumbers);
    requestDraw();
  });
  dom.shortcutToggleButton.addEventListener("click", () => {
    setShortcutPanelOpen(!state.shortcutsOpen);
  });
  dom.shortcutCloseButton.addEventListener("click", () => {
    setShortcutPanelOpen(false);
  });
  document.addEventListener("click", (event) => {
    if (state.shortcutsOpen && !dom.shortcutPanel.contains(event.target)) {
      setShortcutPanelOpen(false);
    }
  });
  dom.closeTiffDialogButton.addEventListener("click", closeTiffDialog);
  dom.changeProjectButton.addEventListener("click", selectAnotherProject);
  dom.refreshTiffIndexButton.addEventListener("click", refreshTiffIndex);
  dom.cancelTiffButton.addEventListener("click", closeTiffDialog);
  dom.confirmTiffButton.addEventListener("click", openSelectedTiff);
  dom.tiffImageList.addEventListener("click", onTiffImageListClick);

  dom.manualCanvas.addEventListener("pointerdown", onPointerDown);
  dom.manualCanvas.addEventListener("pointermove", onPointerMove);
  dom.manualCanvas.addEventListener("pointerup", onPointerUp);
  dom.manualCanvas.addEventListener("pointercancel", onPointerUp);
  dom.manualCanvas.addEventListener("wheel", onWheel, { passive: false });
  dom.manualCanvas.addEventListener("contextmenu", (event) => event.preventDefault());

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clearRotationAxisLock);
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty && !state.isPlacing) return;
    event.preventDefault();
    event.returnValue = "";
  });
  if (window.ResizeObserver) {
    new ResizeObserver(resizeCanvas).observe(dom.manualCanvasShell);
  }
}

function setShortcutPanelOpen(isOpen) {
  state.shortcutsOpen = Boolean(isOpen);
  dom.shortcutList.hidden = !state.shortcutsOpen;
  dom.shortcutToggleButton.setAttribute("aria-expanded", String(state.shortcutsOpen));
  dom.shortcutPanel.classList.toggle("is-open", state.shortcutsOpen);
  if (state.shortcutsOpen) dom.shortcutCloseButton.focus({ preventScroll: true });
  requestDraw();
}

async function apiJson(url, options = {}) {
  if (url === "/api/manual/meshes") {
    const response = await fetch(url, { credentials: "same-origin" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `${response.status} ${response.statusText}`);
    return payload;
  }
  if (url.startsWith("/api/manual/")) {
    return localManualApi(url, options);
  }
  throw new Error(`サーバーへ送信する解析APIは許可されていません：${url}`);
}

function normalisedFilePath(file) {
  return String(state.localFilePaths?.get(file) || file?.webkitRelativePath || file?.name || "").replaceAll("\\", "/");
}

function fileDirectory(file) {
  const path = normalisedFilePath(file);
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function isExcludedLocalPath(path) {
  return String(path).split("/").some((part) => (
    ["archive", "archive code", "gomi", "trash", ".git", "__pycache__"].includes(part.toLowerCase())
  ));
}

function localFileByPath(path) {
  return state.localFileMap.get(String(path).replaceAll("\\", "/")) || null;
}

async function collectLocalDirectoryFiles(directoryHandle, prefix = "") {
  const entries = [];
  for await (const entry of directoryHandle.values()) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "file") {
      entries.push({ file: await entry.getFile(), relativePath });
      continue;
    }
    if (entry.kind === "directory") {
      entries.push(...await collectLocalDirectoryFiles(entry, relativePath));
    }
  }
  return entries;
}

function openLocalDirectoryDatabase() {
  if (!window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = window.indexedDB.open(LOCAL_DIRECTORY_DATABASE_NAME, LOCAL_DIRECTORY_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LOCAL_DIRECTORY_STORE_NAME)) {
        database.createObjectStore(LOCAL_DIRECTORY_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => resolve(null);
  });
}

function indexedDbResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("ブラウザー保存を読み書きできませんでした。"));
  });
}

function indexedDbTransactionResult(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error("ブラウザー保存を完了できませんでした。"));
  });
}

async function readSavedLocalDirectory() {
  const database = await openLocalDirectoryDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(LOCAL_DIRECTORY_STORE_NAME, "readonly");
    return await indexedDbResult(transaction.objectStore(LOCAL_DIRECTORY_STORE_NAME).get(LOCAL_DIRECTORY_RECORD_KEY));
  } catch (_) {
    return null;
  } finally {
    database.close();
  }
}

async function persistLocalDirectoryHandle(directoryHandle) {
  state.savedLocalDirectoryHandle = directoryHandle || null;
  state.savedLocalDirectoryName = String(directoryHandle?.name || "");
  if (!directoryHandle) return false;
  const database = await openLocalDirectoryDatabase();
  if (!database) return false;
  try {
    const transaction = database.transaction(LOCAL_DIRECTORY_STORE_NAME, "readwrite");
    transaction.objectStore(LOCAL_DIRECTORY_STORE_NAME).put({
      id: LOCAL_DIRECTORY_RECORD_KEY,
      directoryHandle,
      name: state.savedLocalDirectoryName,
      saved_at: new Date().toISOString(),
    });
    await indexedDbTransactionResult(transaction);
    return true;
  } catch (_) {
    return false;
  } finally {
    database.close();
  }
}

function readLastLocalImagePath() {
  try {
    return window.localStorage.getItem(LOCAL_DIRECTORY_LAST_IMAGE_KEY) || null;
  } catch (_) {
    return null;
  }
}

function persistLastLocalImagePath(imageFile) {
  if (!imageFile) return;
  try {
    window.localStorage.setItem(LOCAL_DIRECTORY_LAST_IMAGE_KEY, normalisedFilePath(imageFile));
  } catch (_) {
    // The current folder can still be restored when this convenience key is unavailable.
  }
}

function clearLastLocalImagePath() {
  try {
    window.localStorage.removeItem(LOCAL_DIRECTORY_LAST_IMAGE_KEY);
  } catch (_) {
    // Ignore unavailable browser storage.
  }
}

async function directoryPermission(directoryHandle, requestPermission = false) {
  if (!directoryHandle) return "denied";
  const options = { mode: "readwrite" };
  try {
    let permission = typeof directoryHandle.queryPermission === "function"
      ? await directoryHandle.queryPermission(options)
      : "prompt";
    if (permission !== "granted" && requestPermission && typeof directoryHandle.requestPermission === "function") {
      permission = await directoryHandle.requestPermission(options);
    }
    return permission;
  } catch (_) {
    return "denied";
  }
}

async function loadLocalDirectoryHandle(directoryHandle, options = {}) {
  const entries = await collectLocalDirectoryFiles(directoryHandle);
  const pathMap = new Map(entries.map((entry) => [entry.file, entry.relativePath]));
  await setLocalFiles(entries.map((entry) => entry.file), {
    directoryHandle,
    pathMap,
    restoreImagePath: options.restoreImagePath || null,
  });
}

async function restorePreviousLocalDirectory() {
  const record = await readSavedLocalDirectory();
  const directoryHandle = record?.directoryHandle;
  if (!directoryHandle) return "none";
  state.savedLocalDirectoryHandle = directoryHandle;
  state.savedLocalDirectoryName = String(record.name || directoryHandle.name || "前回のフォルダ");
  if (await directoryPermission(directoryHandle) !== "granted") return "reconnect";
  try {
    const restoreImagePath = readLastLocalImagePath();
    await loadLocalDirectoryHandle(directoryHandle, { restoreImagePath });
    if (restoreImagePath && state.selectedImageId === restoreImagePath) await openSelectedTiff();
    return "restored";
  } catch (error) {
    toast(`前回のローカルフォルダを復元できません：${error.message}`, true);
    return "reconnect";
  }
}

async function reconnectSavedLocalFolder() {
  const directoryHandle = state.savedLocalDirectoryHandle;
  if (!directoryHandle) return selectLocalFolder();
  dom.openTiffButton.disabled = true;
  try {
    if (await directoryPermission(directoryHandle, true) !== "granted") {
      throw new Error("前回のフォルダへのアクセスが許可されませんでした。");
    }
    const restoreImagePath = readLastLocalImagePath();
    await loadLocalDirectoryHandle(directoryHandle, { restoreImagePath });
    if (restoreImagePath && state.selectedImageId === restoreImagePath) await openSelectedTiff();
    dom.openTiffButton.textContent = "ローカルフォルダを選択";
  } catch (error) {
    toast(`前回のローカルフォルダを再接続できません：${error.message}`, true);
  } finally {
    dom.openTiffButton.disabled = false;
  }
}

async function selectLocalFolder() {
  if (typeof window.showDirectoryPicker !== "function") {
    dom.folderInput.click();
    return;
  }
  dom.openTiffButton.disabled = true;
  try {
    const directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    clearLastLocalImagePath();
    await persistLocalDirectoryHandle(directoryHandle);
    await loadLocalDirectoryHandle(directoryHandle);
    dom.openTiffButton.textContent = "ローカルフォルダを選択";
  } catch (error) {
    if (error?.name !== "AbortError") {
      toast(`ローカルフォルダを読み込めません：${error.message}`, true);
    }
  } finally {
    dom.openTiffButton.disabled = false;
  }
}

async function selectAnotherProject() {
  if ((state.working && state.dirty) || state.isPlacing || state.saving) {
    toast("未保存の粒子編集を保存またはキャンセルしてから別のプロジェクトを開いてください。", true);
    return;
  }
  dom.changeProjectButton.disabled = true;
  try {
    await selectLocalFolder();
  } finally {
    dom.changeProjectButton.disabled = false;
  }
}

function isSupportedLocalImageFile(file) {
  return /\.(tif|tiff|bmp)$/i.test(String(file?.name || ""));
}

function localImageStem(file) {
  return String(file?.name || "").replace(/\.(tif|tiff|bmp)$/i, "");
}

function localAnalysisRun(file) {
  // Size distributions are defined by the directory that directly contains
  // the SEM image, not by an MLZIF token in a parent path or file name.
  // Keep the complete relative directory to avoid merging equal leaf names
  // that occur under different experimental branches.
  return fileDirectory(file) || "(選択フォルダ直下)";
}

function localImageFormat(file) {
  return /\.bmp$/i.test(String(file?.name || "")) ? "BMP" : "TIFF";
}

function localImageFiles() {
  return state.localFiles
    .filter((file) => isSupportedLocalImageFile(file) && !isExcludedLocalPath(normalisedFilePath(file)))
    .sort((left, right) => compareNaturalPaths(normalisedFilePath(left), normalisedFilePath(right)));
}

function localImageInventory() {
  return localImageFiles().map((file) => {
    const imageId = normalisedFilePath(file);
    const inspection = state.localImageInspections?.get(imageId);
    const stored = inspection?.session || state.localSessions?.get(imageId);
    const sidecar = findLocalSidecar(file);
    const summary = inspection?.summary || stored?.summary || {};
    const calibration = inspection?.calibration || stored?.calibration || {};
    const particleCount = Array.isArray(stored?.particles) ? stored.particles.length : 0;
    const includedCount = Number(summary.count || 0);
    const scaleState = inspection?.error
      ? "read_error"
      : calibration.verified_by_user
        ? "verified"
        : calibration.source === "scale_bar"
          ? "automatic"
          : calibration.source === "metadata_fallback"
            ? "metadata"
            : "manual_required";
    return {
      image_id: imageId,
      name: file.name,
      relative_path: imageId,
      directory: fileDirectory(file) || "(選択フォルダ直下)",
      analysis_status: particleCount ? "analyzed" : "not_analyzed",
      is_analyzed: Boolean(particleCount),
      particle_count: particleCount,
      included_count: includedCount,
      excluded_count: Number(summary.excluded_count || 0),
      has_session_json: inspection?.session_source === "json",
      has_work_json: inspection?.session_source === "json",
      has_browser_session: inspection?.session_source === "browser_storage",
      has_legacy_work_json: false,
      has_same_name_json: false,
      has_exported_json: false,
      has_sidecar_txt: Boolean(sidecar),
      has_companion_txt: Boolean(sidecar),
      companion_txt_name: sidecar?.name || "",
      scale_verified: Boolean(calibration.verified_by_user),
      scale_verified_at: calibration.verified_at || "",
      scale_state: scaleState,
      scale_source: calibration.source || "",
      pixel_size_nm_per_px: calibration.pixel_size_nm_per_px ?? null,
      scale_confidence: calibration.confidence ?? null,
      local_read_error: inspection?.error || "",
      mean_diameter_nm: summary.mean_diameter_nm,
      std_diameter_nm: summary.std_diameter_nm,
      cv_percent: summary.cv_percent,
      diameter_sum_nm: summary.mean_diameter_nm == null ? null : Number(summary.mean_diameter_nm) * includedCount,
      diameter_sum_sq_nm2: summary.mean_diameter_nm == null || summary.std_diameter_nm == null
        ? null
        : includedCount * (Number(summary.std_diameter_nm) ** 2 + Number(summary.mean_diameter_nm) ** 2),
    };
  });
}

function setLocalFiles(files, options = {}) {
  state.localDirectoryHandle = options.directoryHandle || null;
  state.pendingRestoredImagePath = options.restoreImagePath || null;
  state.localFilePaths = new WeakMap();
  state.localFiles = files.filter((file) => file && file.name);
  for (const file of state.localFiles) {
    state.localFilePaths.set(file, options.pathMap?.get(file) || file.webkitRelativePath || file.name);
  }
  state.localFileMap = new Map(state.localFiles.map((file) => [normalisedFilePath(file), file]));
  state.localJsonFilesByName = new Map();
  for (const file of state.localFiles) {
    if (!/\.json$/i.test(file.name)) continue;
    const filesWithName = state.localJsonFilesByName.get(file.name) || [];
    filesWithName.push(file);
    state.localJsonFilesByName.set(file.name, filesWithName);
  }
  state.localSessions = new Map();
  state.localImageInspections = new Map();
  state.localSessionIndexReady = false;
  state.availableImages = [];
  state.selectedImageId = null;
  state.currentImageFile = null;
  state.currentImageBuffer = null;
  state.currentImageHash = null;
  state.session = null;
  state.image = null;
  state.working = null;
  state.workingId = null;
  state.dirty = false;
  dom.manualCanvasMessage.hidden = false;
  dom.manualCanvasMessage.classList.remove("is-error");
  dom.manualCanvasMessage.querySelector(".spinner").hidden = false;
  dom.manualCanvasMessage.querySelector("span:last-child").textContent = "ローカルTIFF／BMPと対応JSONを読み込んでいます。";
  return loadTiffInventory(false).catch((error) => {
    dom.manualCanvasMessage.classList.add("is-error");
    dom.manualCanvasMessage.querySelector(".spinner").hidden = true;
    dom.manualCanvasMessage.querySelector("span:last-child").textContent = `画像一覧を作成できません：${error.message}`;
    toast(`画像一覧を作成できません：${error.message}`, true);
    throw error;
  });
}

function findLocalSidecar(imageFile) {
  const directory = fileDirectory(imageFile);
  const stem = localImageStem(imageFile);
  const candidates = [
    `${directory}/${stem}.txt`,
    `${directory}/Archive/${stem}.txt`,
    `${stem}.txt`,
  ].filter(Boolean);
  return candidates.map(localFileByPath).find(Boolean) || null;
}

function findLocalFileBySuffix(suffix) {
  const normalisedSuffix = String(suffix).replaceAll("\\", "/").replace(/^\/+/, "");
  return state.localFiles.find((file) => normalisedFilePath(file).endsWith(normalisedSuffix)) || null;
}

function parseSidecar(text) {
  const values = {};
  for (const line of String(text || "").replaceAll("\u0000", "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || (trimmed.startsWith("[") && trimmed.endsWith("]"))) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) values[key] = value;
  }
  return values;
}

async function decodeLocalTextFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  for (const encoding of ["utf-8", "shift_jis"]) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch (_) {
      // Try the next encoding.  Hitachi sidecars are commonly UTF-8 or CP932.
    }
  }
  return new TextDecoder("iso-8859-1").decode(bytes);
}

function decodeHitachiXpComment(bytes) {
  if (!bytes?.length) return "";
  let raw = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (raw.length % 2) raw = raw.slice(0, -1);
  try {
    return new TextDecoder("utf-16le").decode(raw).replace(/^\uFEFF/, "");
  } catch (_) {
    return "";
  }
}

function parseTiffMetadata(tiffMetadata) {
  return parseSidecar(decodeHitachiXpComment(tiffMetadata?.hitachiXpCommentBytes));
}

function positiveMetadataFloat(metadata, key) {
  const match = String(metadata?.[key] ?? "").match(
    /^[\s]*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/,
  );
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

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

function detectLocalFooter(image) {
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

function detectLocalScaleMarker(image, micronMarkerNm, pixelSizeNmPerPx) {
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

function buildLocalCalibration(image, sidecar, tiffMetadata) {
  const tiffPixelSize = positiveMetadataFloat(tiffMetadata, "PixelSize");
  const sidecarPixelSize = positiveMetadataFloat(sidecar, "PixelSize");
  const metadataPixelSize = tiffPixelSize ?? sidecarPixelSize;
  const markerLength = positiveMetadataFloat(tiffMetadata, "MicronMarker")
    ?? positiveMetadataFloat(sidecar, "MicronMarker");
  const detected = detectLocalScaleMarker(image, markerLength, metadataPixelSize);
  const marker = detected.marker;
  const detectedLength = marker?.detected_length_px ?? null;
  const relativeError = marker?.relative_error ?? null;
  const automaticPixelSize = marker && markerLength > 0 && detectedLength > 0
    ? markerLength / detectedLength
    : null;
  const passesQualityGate = Boolean(
    automaticPixelSize
      && marker.confidence >= SCALE_BAR_AUTO_DETECTION_MIN_CONFIDENCE
      && (relativeError === null || relativeError <= 0.10),
  );
  const metadataSource = tiffPixelSize !== null
    ? "TIFF tag 40092"
    : sidecarPixelSize !== null
      ? "Hitachi sidecar TXT"
      : null;
  const metadataMethod = tiffPixelSize !== null
    ? "tiff_tag_40092"
    : sidecarPixelSize !== null
      ? "sidecar"
      : "manual_scale_required";
  const pixelSize = passesQualityGate ? automaticPixelSize : (metadataPixelSize || 1);
  return {
    footer: detected.footer,
    calibration: {
      source: passesQualityGate ? "scale_bar" : (metadataPixelSize ? "metadata_fallback" : "manual_required"),
      method: passesQualityGate ? "detected_scale_bar_span_with_hitachi_marker_metadata" : (metadataPixelSize ? "hitachi_pixel_size_metadata_fallback" : metadataMethod),
      pixel_size_nm_per_px: pixelSize,
      marker_length_nm: markerLength,
      detected_length_px: detectedLength,
      marker_kind: marker?.marker_kind || null,
      confidence: marker?.confidence ?? null,
      relative_error_vs_metadata: relativeError,
      automatic_scale_bar_pixel_size_nm_per_px: automaticPixelSize,
      automatic_scale_bar_passes_quality_gate: passesQualityGate,
      quality_gate: {
        confidence_min: 0.65,
        metadata_relative_error_max: 0.10,
        passed: passesQualityGate,
      },
      revision: 1,
      verified_by_user: false,
      verified_at: null,
      verification_note: "",
      metadata_pixel_size_nm_per_px: metadataPixelSize,
      metadata_source: metadataSource,
      tiff_pixel_size_nm_per_px: tiffPixelSize,
      sidecar_pixel_size_nm_per_px: sidecarPixelSize,
      scale_bar_bounds_px: marker ? {
        x_start: marker.x_start,
        x_end: marker.x_end,
        y_start: marker.y_start,
        y_end: marker.y_end,
      } : null,
      scale_bar_bounds_definition: "outer_edges_and_occupied_tick_rows",
    },
  };
}

function localSessionCandidates(imageFile) {
  const directory = fileDirectory(imageFile);
  const stem = localImageStem(imageFile);
  const directCandidates = [
    `${directory}/${stem}_manual_count.json`,
    `${directory}/work/${stem}_manual_count.json`,
    `${directory}/${stem}.json`,
    `${directory}/outputs/${stem}_manual_count_session.json`,
    `${directory}/${stem}_manual_count_session.json`,
    `work/${stem}_manual_count.json`,
    `outputs/${stem}_manual_count_session.json`,
  ].filter(Boolean).map(localFileByPath).filter(Boolean);
  const nearbyCandidates = [
    ...(state.localJsonFilesByName.get(`${stem}_manual_count.json`) || []),
    ...(state.localJsonFilesByName.get(`${stem}_manual_count_session.json`) || []),
  ].filter((file) => {
    if (file.name === imageFile.name) return false;
    const path = normalisedFilePath(file).toLowerCase();
    return path.includes("/work/") || path.includes("/outputs/");
  });
  return [...new Set([...directCandidates, ...nearbyCandidates])];
}

async function readJsonFile(file) {
  try {
    const parsed = JSON.parse(await file.text());
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
}

function isManualSessionForImage(candidate, imageFile) {
  if (!candidate || typeof candidate !== "object") return false;
  const candidateImage = String(candidate?.image?.name || "");
  if (candidateImage && candidateImage !== imageFile.name) return false;
  if (candidate.workflow === "manual_3d_projected_area_count") return true;
  return Array.isArray(candidate.particles)
    && candidate.particles.every((particle) => particle && typeof particle === "object"
      && Array.isArray(particle.quaternion_xyzw)
      && Array.isArray(particle.translation_xy_px)
      && Number.isFinite(Number(particle.scale_px)));
}

function cloneLocalSession(session) {
  if (!session || typeof session !== "object") return null;
  try {
    return JSON.parse(JSON.stringify(session));
  } catch (_) {
    return null;
  }
}

function matchingLocalSession(candidate, imageFile, imageHash) {
  if (!isManualSessionForImage(candidate, imageFile)) return false;
  const candidateHash = String(candidate?.dataset?.image_sha256 || "");
  return !candidateHash || candidateHash === imageHash;
}

function indexedSessionForImage(imageFile, imageHash, parsedFiles) {
  const browserSession = readLocalStoredSession(imageHash);
  if (matchingLocalSession(browserSession, imageFile, imageHash)) {
    return { session: cloneLocalSession(browserSession), source: "browser_storage" };
  }
  for (const candidateFile of localSessionCandidates(imageFile)) {
    const candidate = parsedFiles.get(normalisedFilePath(candidateFile));
    if (matchingLocalSession(candidate, imageFile, imageHash)) {
      return { session: cloneLocalSession(candidate), source: "json" };
    }
  }
  return { session: null, source: null };
}

function calibrationForLocalSession(session, automaticCalibration) {
  const imported = session?.calibration;
  const authoritative = Boolean(
    imported && (imported.verified_by_user || imported.source === "manual_override"),
  );
  return authoritative
    ? { ...imported }
    : {
      ...automaticCalibration,
      revision: Math.max(1, Number(imported?.revision || 1)),
    };
}

function isCurrentImageBmp() {
  return Boolean(state.currentImageFile && localImageFormat(state.currentImageFile) === "BMP");
}

function automaticallyDetectBmpScaleBar() {
  const marker = detectLocalScaleMarker(state.image, null, null).marker;
  const pixelLength = Number(marker?.detected_length_px);
  const confidence = Number(marker?.confidence);
  if (!(pixelLength > 0) || !Number.isFinite(confidence) || confidence < SCALE_BAR_AUTO_DETECTION_MIN_CONFIDENCE) {
    throw new Error("BMPのスケールバー長を十分な信頼度で自動検出できませんでした。画像右下のバーが明瞭な画像を使用してください。");
  }
  return marker;
}

function refreshIndexedSessionSummary(session, calibration) {
  if (!session) return { session: null, summary: localSummary([]) };
  const copy = cloneLocalSession(session);
  if (!copy) return { session: null, summary: localSummary([]) };
  copy.calibration = calibration;
  const pixelSize = Number(calibration?.pixel_size_nm_per_px || 0);
  for (const particle of copy.particles || []) {
    const areaPx2 = Number(particle?.projected_area_px2);
    if (!Number.isFinite(areaPx2) || areaPx2 <= 0 || !(pixelSize > 0)) continue;
    const areaNm2 = areaPx2 * pixelSize * pixelSize;
    const radiusNm = Math.sqrt(areaNm2 / Math.PI);
    particle.projected_area_nm2 = areaNm2;
    particle.equivalent_radius_nm = radiusNm;
    particle.equivalent_diameter_nm = 2 * radiusNm;
  }
  const summary = localSummary(copy.particles || []);
  copy.summary = summary;
  return { session: copy, summary };
}

function setLocalIndexProgress(completed, total, phase = "画像情報を確認") {
  const text = `${phase}（${completed}/${total}）：JSON，TIFF／BMP，TXTは端末内だけで読み取ります。`;
  const message = dom.manualCanvasMessage;
  if (message) {
    message.hidden = false;
    message.classList.remove("is-error");
    const spinner = message.querySelector(".spinner");
    if (spinner) spinner.hidden = false;
    const label = message.querySelector("span:last-child");
    if (label) label.textContent = text;
  }
  if (dom.tiffDialogStatus) dom.tiffDialogStatus.textContent = text;
}

async function inspectLocalImage(imageFile, parsedFiles) {
  const arrayBuffer = await imageFile.arrayBuffer();
  const imageHash = await sha256Hex(arrayBuffer);
  const decoded = await decodeLocalRaster(imageFile, arrayBuffer);
  const image = {
    naturalWidth: decoded.width,
    naturalHeight: decoded.height,
    tiffPixels: decoded.rgba,
    tiffMetadata: decoded.metadata,
  };
  const sidecarFile = findLocalSidecar(imageFile);
  const sidecar = sidecarFile ? parseSidecar(await decodeLocalTextFile(sidecarFile)) : {};
  const tiffMetadata = parseTiffMetadata(decoded.metadata);
  const automatic = buildLocalCalibration(image, sidecar, tiffMetadata);
  const indexed = indexedSessionForImage(imageFile, imageHash, parsedFiles);
  const calibration = calibrationForLocalSession(indexed.session, automatic.calibration);
  const prepared = refreshIndexedSessionSummary(indexed.session, calibration);
  const session = prepared.session;
  if (session) {
    session.image = {
      ...(session.image || {}),
      name: imageFile.name,
      width: decoded.width,
      height: decoded.height,
      source_format: decoded.metadata.sourceFormat,
      footer: automatic.footer || session.image?.footer || { y_start: decoded.height },
    };
    session.dataset = {
      ...(session.dataset || {}),
      image_sha256: imageHash,
      image_path: normalisedFilePath(imageFile),
      sidecar_path: sidecarFile ? normalisedFilePath(sidecarFile) : null,
      browser_local_only: true,
    };
  }
  return {
    image_hash: imageHash,
    session,
    session_source: indexed.source,
    calibration,
    summary: prepared.summary,
    footer: automatic.footer,
    error: "",
  };
}

async function mapLocalImagesWithConcurrency(imageFiles, parsedFiles) {
  const results = new Array(imageFiles.length);
  const workerCount = Math.min(2, imageFiles.length);
  let nextIndex = 0;
  let completed = 0;
  async function worker() {
    while (nextIndex < imageFiles.length) {
      const index = nextIndex;
      nextIndex += 1;
      const imageFile = imageFiles[index];
      try {
        results[index] = await inspectLocalImage(imageFile, parsedFiles);
      } catch (error) {
        results[index] = {
          image_hash: "",
          session: null,
          session_source: null,
          calibration: {},
          summary: localSummary([]),
          footer: null,
          error: error?.message || "ローカル画像を読み込めませんでした。",
        };
      }
      completed += 1;
      setLocalIndexProgress(completed, imageFiles.length);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function indexLocalSessions() {
  const imageFiles = localImageFiles();
  const candidateFiles = new Map();
  for (const imageFile of imageFiles) {
    for (const candidateFile of localSessionCandidates(imageFile)) {
      candidateFiles.set(normalisedFilePath(candidateFile), candidateFile);
    }
  }
  const parsedFiles = new Map();
  await Promise.all([...candidateFiles].map(async ([path, file]) => {
    parsedFiles.set(path, await readJsonFile(file));
  }));

  state.localSessions = new Map();
  state.localImageInspections = new Map();
  setLocalIndexProgress(0, imageFiles.length, "対応JSONを読み込み，画像別の校正・統計を確認");
  const inspections = await mapLocalImagesWithConcurrency(imageFiles, parsedFiles);
  for (let index = 0; index < imageFiles.length; index += 1) {
    const imageId = normalisedFilePath(imageFiles[index]);
    const inspection = inspections[index];
    state.localImageInspections.set(imageId, inspection);
    if (inspection?.session) state.localSessions.set(imageId, inspection.session);
  }
  state.localSessionIndexReady = true;
}

async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function localStorageKey(imageHash) {
  return `zif8-manual-session:${imageHash}`;
}

function readLocalStoredSession(imageHash) {
  try {
    const raw = window.localStorage.getItem(localStorageKey(imageHash));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function persistLocalSession() {
  if (!state.session || !state.currentImageHash) return;
  if (state.currentImageFile) {
    const imageId = normalisedFilePath(state.currentImageFile);
    state.localSessions.set(imageId, state.session);
    const previous = state.localImageInspections.get(imageId) || {};
    state.localImageInspections.set(imageId, {
      ...previous,
      image_hash: state.currentImageHash,
      session: state.session,
      session_source: "browser_storage",
      calibration: state.session.calibration || previous.calibration || {},
      summary: state.session.summary || localSummary(state.session.particles || []),
      error: "",
    });
  }
  try {
    window.localStorage.setItem(localStorageKey(state.currentImageHash), JSON.stringify(state.session));
  } catch (_) {
    // Browser storage is a convenience; explicit JSON export remains available.
  }
}

function localSummary(particles = []) {
  const all = Array.isArray(particles) ? particles : [];
  const included = all.filter((particle) => particle && particle.included_in_statistics !== false);
  const values = included.map((particle) => Number(particle.equivalent_diameter_nm)).filter(Number.isFinite);
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const std = values.length ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) : null;
  return {
    count: values.length,
    total_saved_count: all.length,
    excluded_count: all.length - values.length,
    mean_radius_nm: values.length ? included.reduce((sum, particle) => sum + Number(particle.equivalent_radius_nm || 0), 0) / values.length : null,
    mean_diameter_nm: mean,
    std_diameter_nm: std,
    cv_percent: mean > 0 && std !== null ? 100 * std / mean : null,
    number_basis: true,
    shape_counts: Object.fromEntries(Object.keys(SHAPE_LABELS).map((shape) => [shape, included.filter((particle) => particle.shape === shape).length])),
  };
}

function localShapeKey(particle) {
  const raw = String(particle?.shape || particle?.shape_label || "")
    .trim()
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ");
  const aliases = {
    "rhombic dodecahedron": "rhombic_dodecahedron",
    "chamfered cube": "chamfered_cube",
    cube: "cube",
  };
  return aliases[raw] || null;
}

function localAnalysisRunSortKey(value) {
  const digits = String(value).match(/\d+/g)?.join("") || "";
  return [digits ? Number(digits) : -1, String(value).toLowerCase()];
}

function compareNaturalPaths(left, right) {
  const leftPath = String(left ?? "");
  const rightPath = String(right ?? "");
  return NATURAL_ORDER_COLLATOR.compare(leftPath, rightPath)
    || leftPath.localeCompare(rightPath);
}

function compareLocalAnalysisRuns(left, right) {
  const leftKey = localAnalysisRunSortKey(left);
  const rightKey = localAnalysisRunSortKey(right);
  return leftKey[0] - rightKey[0] || leftKey[1].localeCompare(rightKey[1]);
}

function numberStats(values) {
  const data = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!data.length) {
    return {
      count: 0,
      mean: null,
      standardDeviation: null,
      cvPercent: null,
      median: null,
    };
  }
  const mean = data.reduce((sum, value) => sum + value, 0) / data.length;
  const variance = data.reduce((sum, value) => sum + (value - mean) ** 2, 0) / data.length;
  const standardDeviation = Math.sqrt(Math.max(0, variance));
  const sorted = [...data].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    count: data.length,
    mean,
    standardDeviation,
    cvPercent: mean > 0 ? 100 * standardDeviation / mean : null,
    median,
  };
}

function collectLocalSizeDistributionRuns() {
  const runs = new Map();
  for (const imageFile of localImageFiles()) {
    const imageId = normalisedFilePath(imageFile);
    const inspection = state.localImageInspections.get(imageId);
    const session = inspection?.session || state.localSessions.get(imageId);
    const analysisRun = localAnalysisRun(imageFile);
    if (!session || !analysisRun || !Array.isArray(session.particles)) continue;
    if (!runs.has(analysisRun)) {
      runs.set(analysisRun, {
        analysisRun,
        diameters: [],
        byShape: new Map(),
      });
    }
    const run = runs.get(analysisRun);
    for (const particle of session.particles) {
      if (!particle || particle.included_in_statistics === false) continue;
      const diameter = Number(particle.equivalent_diameter_nm);
      if (!Number.isFinite(diameter) || diameter < 0) continue;
      run.diameters.push(diameter);
      const shape = localShapeKey(particle);
      if (!shape) continue;
      if (!run.byShape.has(shape)) run.byShape.set(shape, []);
      run.byShape.get(shape).push(diameter);
    }
  }
  return [...runs.values()].sort((left, right) => compareLocalAnalysisRuns(left.analysisRun, right.analysisRun));
}

function calculateNiceHistogramBins(values) {
  const data = values.map(Number);
  const dataMin = Math.min(...data);
  const dataMax = Math.max(...data);
  const dataRange = dataMax - dataMin;
  if (!(dataRange > 0)) {
    const epsilon = Math.max(1e-9, Math.abs(dataMin) * 0.01);
    return [dataMin - epsilon, dataMax + epsilon];
  }
  const idealWidth = dataRange / SIZE_DISTRIBUTION_TARGET_BIN_COUNT;
  const magnitude = 10 ** Math.floor(Math.log10(idealWidth));
  const normalisedWidth = idealWidth / magnitude;
  const niceNumbers = [1, 2, 2.5, 5, 10];
  const niceWidth = niceNumbers.reduce((best, candidate) => (
    Math.abs(candidate - normalisedWidth) < Math.abs(best - normalisedWidth) ? candidate : best
  ));
  const binWidth = niceWidth * magnitude;
  const binStart = Math.floor(dataMin / binWidth) * binWidth;
  const binEnd = Math.ceil(dataMax / binWidth) * binWidth;
  const bins = [];
  for (let value = binStart; value <= binEnd + binWidth * 0.001; value += binWidth) {
    bins.push(Number(value.toPrecision(14)));
  }
  if (bins.length < 2) bins.push(binStart + binWidth);
  return bins;
}

function calculateNiceTicks(minimum, maximum, targetCount) {
  const range = maximum - minimum;
  if (!(range > 0)) return [minimum];
  const idealStep = range / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(idealStep));
  const normalisedStep = idealStep / magnitude;
  const niceNumbers = [1, 2, 2.5, 5, 10];
  const niceStep = niceNumbers.reduce((best, candidate) => (
    Math.abs(candidate - normalisedStep) < Math.abs(best - normalisedStep) ? candidate : best
  ));
  const step = niceStep * magnitude;
  const start = Math.floor(minimum / step) * step;
  const end = Math.ceil(maximum / step) * step;
  const ticks = [];
  for (let value = start; value <= end + step * 0.001; value += step) {
    ticks.push(Number(value.toPrecision(14)));
  }
  return ticks.length ? ticks : [minimum, maximum];
}

function tickDecimals(step) {
  const number = Math.abs(Number(step));
  if (!(number > 0)) return 0;
  let decimals = 0;
  while (
    decimals < 12
      && Math.abs(Math.round(number * (10 ** decimals)) - number * (10 ** decimals)) > 1e-8
  ) {
    decimals += 1;
  }
  return decimals;
}

function formatTickNumber(value, step) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const decimals = tickDecimals(step);
  if (Math.abs(number) >= 1e6 || (Math.abs(number) > 0 && Math.abs(number) < 1e-6)) {
    return number.toExponential(Math.max(1, decimals));
  }
  return number.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function drawSizeDistributionPng(analysisRun, diameters) {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE_DISTRIBUTION_FIGURE.width;
  canvas.height = SIZE_DISTRIBUTION_FIGURE.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("サイズ分布PNG用Canvasを初期化できませんでした。");

  const data = diameters.map(Number).filter(Number.isFinite);
  const stats = numberStats(data);
  const bins = calculateNiceHistogramBins(data);
  const binWidth = bins[1] - bins[0];
  const counts = Array.from({ length: bins.length - 1 }, () => 0);
  for (const value of data) {
    const rawIndex = Math.floor((value - bins[0]) / binWidth);
    const index = Math.min(counts.length - 1, Math.max(0, rawIndex));
    counts[index] += 1;
  }
  const densities = counts.map((count) => count / (data.length * binWidth));
  const normalStart = Math.max(1e-12, Math.min(...data) * 0.8);
  const normalEnd = Math.max(normalStart + 1e-9, Math.max(...data) * 1.2);
  const normalValues = [];
  const normalSteps = 1000;
  if (stats.standardDeviation > 0) {
    for (let index = 0; index <= normalSteps; index += 1) {
      const x = normalStart + (normalEnd - normalStart) * index / normalSteps;
      const z = (x - stats.mean) / stats.standardDeviation;
      const y = Math.exp(-0.5 * z * z) / (stats.standardDeviation * Math.sqrt(2 * Math.PI));
      normalValues.push([x, y]);
    }
  }

  const width = canvas.width;
  const height = canvas.height;
  // These margins reproduce the 60 x 80 mm Matplotlib figure after
  // tight_layout(pad=0.6) in summarize_shape_statistics.py.
  const margin = { left: 477, right: 52, top: 200, bottom: 297 };
  const plot = {
    left: margin.left,
    top: margin.top,
    right: width - margin.right,
    bottom: height - margin.bottom,
  };
  const rawXMin = Math.min(bins[0], normalStart);
  const rawXMax = Math.max(bins[bins.length - 1], normalEnd);
  const xMargin = (rawXMax - rawXMin) * SIZE_DISTRIBUTION_X_MARGIN;
  const xMin = rawXMin - xMargin;
  const xMax = rawXMax + xMargin;
  const histogramMax = Math.max(...densities, 0);
  const normalMax = Math.max(...normalValues.map(([, y]) => y), 0);
  const yMax = Math.max(histogramMax, normalMax, 1e-12) * SIZE_DISTRIBUTION_HISTOGRAM_Y_MARGIN;
  const xToCanvas = (value) => plot.left + (value - xMin) / (xMax - xMin) * (plot.right - plot.left);
  const yToCanvas = (value) => plot.bottom - value / yMax * (plot.bottom - plot.top);
  const xTicks = calculateNiceTicks(xMin, xMax, 5);
  const yTicks = calculateNiceTicks(0, yMax, 9);
  const xTickStep = xTicks.length > 1 ? xTicks[1] - xTicks[0] : xMax - xMin;
  const yTickStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : yMax;
  const visibleXTicks = xTicks.filter((value) => value >= xMin && value <= xMax);
  const visibleYTicks = yTicks.filter((value) => value >= 0 && value <= yMax);
  const tickFont = `${SIZE_DISTRIBUTION_TICK_LABEL_PX}px Arial, sans-serif`;
  const labelFont = `${SIZE_DISTRIBUTION_FONT_PX}px Arial, sans-serif`;
  const titleFont = `${(SIZE_DISTRIBUTION_FONT_PT + 1) * SIZE_DISTRIBUTION_FIGURE.dpi / 72}px Arial, sans-serif`;
  const statFont = tickFont;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#000000";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = titleFont;
  context.fillText(analysisRun, width / 2, 100);

  // Matplotlib's ax.grid(True, alpha=0.3, linewidth=0.25) draws major grid
  // lines in both directions before the histogram is painted.
  context.strokeStyle = "rgba(0, 0, 0, 0.3)";
  context.lineWidth = SIZE_DISTRIBUTION_GRID_WIDTH_PX;
  for (const value of visibleXTicks) {
    const x = xToCanvas(value);
    context.beginPath();
    context.moveTo(x, plot.top);
    context.lineTo(x, plot.bottom);
    context.stroke();
  }
  for (const value of visibleYTicks) {
    const y = yToCanvas(value);
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();
  }

  context.fillStyle = `rgba(0, 128, 0, ${SIZE_DISTRIBUTION_HISTOGRAM_ALPHA})`;
  context.strokeStyle = `rgba(0, 0, 0, ${SIZE_DISTRIBUTION_HISTOGRAM_ALPHA})`;
  context.lineWidth = SIZE_DISTRIBUTION_FRAME_WIDTH_PX;
  for (let index = 0; index < counts.length; index += 1) {
    const x0 = xToCanvas(bins[index]);
    const x1 = xToCanvas(bins[index + 1]);
    const y = yToCanvas(densities[index]);
    context.fillRect(x0, y, Math.max(1, x1 - x0), plot.bottom - y);
    context.strokeRect(x0, y, Math.max(1, x1 - x0), plot.bottom - y);
  }

  if (normalValues.length) {
    context.beginPath();
    normalValues.forEach(([x, y], index) => {
      const px = xToCanvas(x);
      const py = yToCanvas(y);
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.strokeStyle = "blue";
    context.lineWidth = SIZE_DISTRIBUTION_LINE_WIDTH_PX;
    context.stroke();
  }

  context.strokeStyle = "#000000";
  context.lineWidth = SIZE_DISTRIBUTION_FRAME_WIDTH_PX;
  context.strokeRect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);

  context.font = tickFont;
  context.textBaseline = "middle";
  context.textAlign = "right";
  for (const value of visibleYTicks) {
    const y = yToCanvas(value);
    context.fillStyle = "#000000";
    context.fillText(formatTickNumber(value, yTickStep), plot.left - SIZE_DISTRIBUTION_TICK_LENGTH_PX, y);
  }
  context.textAlign = "center";
  for (const value of visibleXTicks) {
    const x = xToCanvas(value);
    context.fillStyle = "#000000";
    context.fillText(
      formatTickNumber(value, xTickStep),
      x,
      plot.bottom + SIZE_DISTRIBUTION_TICK_LENGTH_PX + 33,
    );
  }

  // ax.tick_params(direction="in", top=True, right=True) with Matplotlib's
  // default 3.5 pt tick length.
  context.strokeStyle = "#000000";
  context.lineWidth = SIZE_DISTRIBUTION_FRAME_WIDTH_PX;
  for (const value of visibleXTicks) {
    const x = xToCanvas(value);
    context.beginPath();
    context.moveTo(x, plot.bottom);
    context.lineTo(x, plot.bottom - SIZE_DISTRIBUTION_TICK_LENGTH_PX);
    context.moveTo(x, plot.top);
    context.lineTo(x, plot.top + SIZE_DISTRIBUTION_TICK_LENGTH_PX);
    context.stroke();
  }
  for (const value of visibleYTicks) {
    const y = yToCanvas(value);
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.left + SIZE_DISTRIBUTION_TICK_LENGTH_PX, y);
    context.moveTo(plot.right, y);
    context.lineTo(plot.right - SIZE_DISTRIBUTION_TICK_LENGTH_PX, y);
    context.stroke();
  }

  context.font = labelFont;
  context.fillStyle = "#000000";
  context.textAlign = "center";
  context.fillText("Area-equivalent diameter [nm]", (plot.left + plot.right) / 2, height - 109);
  context.save();
  context.translate(85, (plot.top + plot.bottom) / 2);
  context.rotate(-Math.PI / 2);
  context.fillText("Number-based density [nm⁻¹]", 0, 0);
  context.restore();

  if (normalValues.length) {
    const legendX = plot.left + 38;
    const legendY = plot.top + 101;
    context.strokeStyle = "blue";
    context.lineWidth = SIZE_DISTRIBUTION_LINE_WIDTH_PX;
    context.beginPath();
    context.moveTo(legendX, legendY);
    context.lineTo(legendX + 150, legendY);
    context.stroke();
    context.fillStyle = "#000000";
    context.font = statFont;
    context.textAlign = "left";
    context.fillText("Normal fit", legendX + 210, legendY);
  }

  const cvText = stats.cvPercent == null ? "n/a" : `${stats.cvPercent.toFixed(1)}%`;
  const statLines = [
    `n = ${stats.count.toLocaleString("en-US")}`,
    `Average = ${stats.mean.toFixed(1)} nm`,
    `1σ = ${stats.standardDeviation.toFixed(1)} nm`,
    `CV = ${cvText}`,
    `D50 = ${stats.median.toFixed(1)} nm`,
  ];
  context.font = statFont;
  const textPadding = 0.3 * SIZE_DISTRIBUTION_TICK_LABEL_PX;
  const textLineHeight = SIZE_DISTRIBUTION_TICK_LABEL_PX * 0.92;
  const textWidth = Math.max(...statLines.map((line) => context.measureText(line).width));
  const boxWidth = textWidth + textPadding * 2;
  const boxHeight = statLines.length * textLineHeight + textPadding * 2;
  const boxRight = plot.left + (plot.right - plot.left) * 0.95;
  const boxTop = plot.top + (plot.bottom - plot.top) * 0.05;
  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  context.strokeStyle = "gray";
  context.lineWidth = SIZE_DISTRIBUTION_FRAME_WIDTH_PX;
  roundedRectPath(context, boxRight - boxWidth, boxTop, boxWidth, boxHeight, textPadding);
  context.fill();
  context.stroke();
  context.fillStyle = "#000000";
  context.textAlign = "right";
  context.textBaseline = "top";
  statLines.forEach((line, index) => context.fillText(
    line,
    boxRight - textPadding,
    boxTop + textPadding + index * textLineHeight,
  ));

  return canvas.toDataURL("image/png");
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvNumber(value) {
  return value == null || !Number.isFinite(Number(value)) ? "" : String(Number(Number(value).toPrecision(10)));
}

function createLocalSizeDistributionCsv(runRows, shapeKeys) {
  const columns = ["SEM subfolder"];
  for (const shape of shapeKeys) {
    const label = SHAPE_LABELS[shape] || shape;
    columns.push(
      `${label} Average diameter (nm)`,
      `${label} standard deviation (nm)`,
      `${label} CV (%)`,
      `${label} Counts`,
    );
  }
  const lines = [columns.map(csvEscape).join(",")];
  for (const run of runRows) {
    const values = [run.analysisRun];
    for (const shape of shapeKeys) {
      const stats = numberStats(run.byShape.get(shape) || []);
      values.push(csvNumber(stats.mean), csvNumber(stats.standardDeviation), csvNumber(stats.cvPercent), stats.count);
    }
    lines.push(values.map(csvEscape).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function createLocalSizeDistributionPayload() {
  const runRows = collectLocalSizeDistributionRuns();
  const shapeKeys = SIZE_DISTRIBUTION_SHAPE_ORDER.filter((shape) => runRows.some((run) => (run.byShape.get(shape) || []).length));
  const csv = createLocalSizeDistributionCsv(runRows, shapeKeys);
  const runs = [];
  const skipped = [];
  for (const run of runRows) {
    if (run.diameters.length) {
      runs.push({
        analysis_run: run.analysisRun,
        count: run.diameters.length,
        image_url: drawSizeDistributionPng(run.analysisRun, run.diameters),
      });
    } else {
      skipped.push({
        analysis_run: run.analysisRun,
        count: 0,
        reason: "統計対象粒子がありません",
      });
    }
  }
  return { runs, skipped, csv };
}

function refreshLocalParticleMeasurement(particle) {
  const metrics = calculateLocalMetrics(particle);
  const projection = projectModel(particle);
  Object.assign(particle, {
    shape_label: SHAPE_LABELS[particle.shape] || particle.shape,
    projected_area_px2: metrics.areaPx2,
    projected_area_nm2: metrics.areaNm2,
    equivalent_radius_nm: metrics.radiusNm,
    equivalent_diameter_nm: metrics.diameterNm,
    valid_sem_fraction: metrics.validSemFraction,
    quality_flags: metrics.qualityFlags,
    projected_model: {
      silhouette: projection.silhouette,
      visible_faces: projection.visibleFaces,
      visible_edges: projection.visibleEdges,
    },
  });
  return particle;
}

function refreshLocalSessionMeasurements() {
  if (!state.session) return;
  for (const particle of state.session.particles || []) refreshLocalParticleMeasurement(particle);
  state.session.summary = localSummary(state.session.particles);
}

async function createLocalSession(imageFile, image, imageHash) {
  const imageId = normalisedFilePath(imageFile);
  const indexed = state.localImageInspections.get(imageId);
  const indexedMatchesImage = indexed?.image_hash === imageHash;
  let imported = indexedMatchesImage ? cloneLocalSession(indexed.session) : null;
  let calibration = indexedMatchesImage ? { ...(indexed.calibration || {}) } : null;
  let footer = indexedMatchesImage ? indexed.footer : null;
  const sidecarFile = findLocalSidecar(imageFile);
  if (!calibration || !Object.keys(calibration).length) {
    const sidecar = sidecarFile ? parseSidecar(await decodeLocalTextFile(sidecarFile)) : {};
    const tiffMetadata = parseTiffMetadata(image.tiffMetadata);
    const automatic = buildLocalCalibration(image, sidecar, tiffMetadata);
    footer = automatic.footer;
    if (!imported) {
      const stored = readLocalStoredSession(imageHash);
      imported = matchingLocalSession(stored, imageFile, imageHash) ? cloneLocalSession(stored) : null;
    }
    calibration = calibrationForLocalSession(imported, automatic.calibration);
  }
  const session = imported || {
    schema_version: "1.1",
    analysis_version: "1.2.0-browser-local",
    workflow: "manual_3d_projected_area_count",
    image: {},
    dataset: {},
    calibration,
    particles: [],
    deleted_particles: [],
    audit_log: [],
    revision: 0,
    next_particle_number: 1,
  };
  session.image = {
    ...(session.image || {}),
    name: imageFile.name,
    width: image.naturalWidth,
    height: image.naturalHeight,
    source_format: image.tiffMetadata?.sourceFormat || localImageFormat(imageFile),
    delivery: localImageFormat(imageFile) === "TIFF" ? "original_tiff_bytes" : "original_bmp_bytes",
    browser_decode: "lossless_full_resolution",
    resampled: false,
    footer: footer || session.image?.footer || { y_start: image.naturalHeight },
  };
  session.dataset = {
    ...(session.dataset || {}),
    image_sha256: imageHash,
    image_path: normalisedFilePath(imageFile),
    sidecar_path: sidecarFile ? normalisedFilePath(sidecarFile) : null,
    browser_local_only: true,
  };
  session.calibration = calibration;
  session.particles = Array.isArray(session.particles) ? session.particles : [];
  session.next_particle_number = Math.max(
    Number(session.next_particle_number || 1),
    ...session.particles.map((particle) => Number(String(particle.id || "").replace(/\D/g, "")) + 1).filter(Number.isFinite),
    1,
  );
  state.session = session;
  refreshLocalSessionMeasurements();
  persistLocalSession();
  return session;
}

async function localManualApi(url, options = {}) {
  if (url === "/api/manual/images" || url === "/api/manual/images/refresh") {
    const images = localImageInventory();
    return { images, current_image_id: state.currentImageFile ? normalisedFilePath(state.currentImageFile) : null, index_path: "browser-local" };
  }
  if (url === "/api/manual/size-distributions/refresh") {
    if (!state.localFiles.length) throw new Error("先にローカルフォルダを選択してください。");
    if (!state.localSessionIndexReady) await indexLocalSessions();
    return createLocalSizeDistributionPayload();
  }
  if (url === "/api/manual/calibration") {
    const payload = JSON.parse(options.body || "{}");
    const marker = Number(payload.marker_length_nm);
    const automaticBmpMarker = isCurrentImageBmp() ? automaticallyDetectBmpScaleBar() : null;
    const pixels = automaticBmpMarker
      ? Number(automaticBmpMarker.detected_length_px)
      : Number(payload.detected_length_px);
    if (!(marker > 0) || !(pixels > 0)) {
      throw new Error("バー表示値と検出長には正の数値を入力してください。");
    }
    state.session.calibration = {
      ...state.session.calibration,
      source: "manual_override",
      method: automaticBmpMarker ? "manual_marker_with_auto_detected_scale_bar" : "manual_scale_bar_override",
      pixel_size_nm_per_px: marker / pixels,
      marker_length_nm: marker,
      detected_length_px: pixels,
      marker_kind: automaticBmpMarker?.marker_kind || state.session.calibration.marker_kind || null,
      confidence: automaticBmpMarker?.confidence ?? state.session.calibration.confidence ?? null,
      scale_bar_bounds_px: automaticBmpMarker ? {
        x_start: automaticBmpMarker.x_start,
        x_end: automaticBmpMarker.x_end,
        y_start: automaticBmpMarker.y_start,
        y_end: automaticBmpMarker.y_end,
      } : state.session.calibration.scale_bar_bounds_px || null,
      revision: Number(state.session.calibration.revision || 1) + 1,
      verified_by_user: true,
      verified_at: new Date().toISOString(),
      verification_note: String(payload.verification_note || ""),
    };
    refreshLocalSessionMeasurements();
    state.session.revision = Number(state.session.revision || 0) + 1;
    persistLocalSession();
    return { calibration: state.session.calibration, particles: state.session.particles, summary: state.session.summary, session_revision: state.session.revision };
  }
  if (url === "/api/manual/particles") {
    const payload = JSON.parse(options.body || "{}");
    const particle = refreshLocalParticleMeasurement({
      id: `m${String(Number(state.session.next_particle_number || 1)).padStart(4, "0")}`,
      revision: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      shape: payload.shape,
      h: Number(payload.h ?? 0.5),
      quaternion_xyzw: [...payload.quaternion_xyzw],
      scale_px: Number(payload.scale_px),
      translation_xy_px: [...payload.translation_xy_px],
      included_in_statistics: payload.included_in_statistics !== false,
      exclusion_reason: String(payload.exclusion_reason || ""),
      notes: String(payload.notes || ""),
    });
    state.session.next_particle_number = Number(state.session.next_particle_number || 1) + 1;
    state.session.particles.push(particle);
    state.session.revision = Number(state.session.revision || 0) + 1;
    state.session.summary = localSummary(state.session.particles);
    persistLocalSession();
    return { particle, summary: state.session.summary, session_revision: state.session.revision };
  }
  const particleMatch = url.match(/^\/api\/manual\/particles\/([^/]+)$/);
  if (particleMatch) {
    const particleId = decodeURIComponent(particleMatch[1]);
    const index = state.session.particles.findIndex((particle) => particle.id === particleId);
    if (index < 0) throw new Error(`Particle not found: ${particleId}`);
    if (options.method === "DELETE") {
      const [removed] = state.session.particles.splice(index, 1);
      state.session.deleted_particles = state.session.deleted_particles || [];
      state.session.deleted_particles.push({ ...removed, deleted_at: new Date().toISOString() });
      state.session.revision = Number(state.session.revision || 0) + 1;
      state.session.summary = localSummary(state.session.particles);
      persistLocalSession();
      return { removed, summary: state.session.summary, session_revision: state.session.revision };
    }
    const payload = JSON.parse(options.body || "{}");
    const current = state.session.particles[index];
    const updated = refreshLocalParticleMeasurement({
      ...current,
      shape: payload.shape,
      h: Number(payload.h ?? current.h),
      quaternion_xyzw: [...payload.quaternion_xyzw],
      scale_px: Number(payload.scale_px),
      translation_xy_px: [...payload.translation_xy_px],
      included_in_statistics: payload.included_in_statistics !== false,
      exclusion_reason: String(payload.exclusion_reason || ""),
      notes: String(payload.notes || ""),
      revision: Number(current.revision || 1) + 1,
      updated_at: new Date().toISOString(),
    });
    state.session.particles[index] = updated;
    state.session.revision = Number(state.session.revision || 0) + 1;
    state.session.summary = localSummary(state.session.particles);
    persistLocalSession();
    return { particle: updated, summary: state.session.summary, session_revision: state.session.revision };
  }
  if (url === "/api/manual/session/import") {
    const imported = JSON.parse(options.body || "{}");
    const importedHash = String(imported?.dataset?.image_sha256 || "");
    if (importedHash && importedHash !== state.currentImageHash) throw new Error("このJSONは現在のTIFFと一致しません。");
    state.session = imported;
    refreshLocalSessionMeasurements();
    persistLocalSession();
    return state.session;
  }
  throw new Error(`未対応のローカル操作です：${url}`);
}

function readBooleanPreference(key, fallback) {
  try {
    const stored = window.localStorage?.getItem(key);
    return stored === null || stored === undefined ? Boolean(fallback) : stored === "true";
  } catch (_error) {
    return Boolean(fallback);
  }
}

function writeBooleanPreference(key, value) {
  try {
    window.localStorage?.setItem(key, String(Boolean(value)));
  } catch (_error) {
    // Display preferences are non-critical when browser storage is unavailable.
  }
}

async function decodeLocalBmp(file) {
  let bitmap = null;
  if (typeof createImageBitmap === "function") {
    bitmap = await createImageBitmap(file);
  } else {
    const objectUrl = URL.createObjectURL(file);
    try {
      bitmap = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("BMPをブラウザーでデコードできませんでした。"));
        image.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width || bitmap.naturalWidth;
  canvas.height = bitmap.height || bitmap.naturalHeight;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) throw new Error("BMP描画用Canvasを初期化できませんでした。");
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return {
    width: canvas.width,
    height: canvas.height,
    rgba: context.getImageData(0, 0, canvas.width, canvas.height).data,
    metadata: {
      sourceFormat: "BMP",
      resampled: false,
      hitachiXpCommentBytes: null,
    },
  };
}

async function decodeLocalRaster(file, arrayBuffer = null) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("ローカルTIFFまたはBMPを選択してください。");
  }
  if (localImageFormat(file) === "BMP") return decodeLocalBmp(file);
  return decodeTiff(arrayBuffer || await file.arrayBuffer());
}

function canvasFromDecodedRaster(decoded) {
  const canvas = document.createElement("canvas");
  canvas.width = decoded.width;
  canvas.height = decoded.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("画像描画用Canvasを初期化できませんでした。");
  context.putImageData(new ImageData(decoded.rgba, decoded.width, decoded.height), 0, 0);
  // Canvas is the full-resolution locally decoded raster.  These aliases keep
  // the drawing code independent of HTMLImageElement without resampling.
  canvas.naturalWidth = decoded.width;
  canvas.naturalHeight = decoded.height;
  canvas.tiffMetadata = decoded.metadata;
  canvas.tiffPixels = decoded.rgba;
  return canvas;
}

async function loadTiff(fileOrUrl, arrayBuffer = null) {
  let file = fileOrUrl;
  if (fileOrUrl === "/api/manual/image" && state.currentImageFile) file = state.currentImageFile;
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("画像は選択したローカルファイルから読み込みます。");
  }
  const bytes = arrayBuffer || await file.arrayBuffer();
  state.currentImageBuffer = bytes;
  return canvasFromDecodedRaster(await decodeLocalRaster(file, bytes));
}

function validateTiffRaster(image, session) {
  const expectedWidth = Number(session?.image?.width);
  const expectedHeight = Number(session?.image?.height);
  if (image.naturalWidth !== expectedWidth || image.naturalHeight !== expectedHeight) {
    throw new Error(
      `画像原本とsessionの画像寸法が一致しません（画像 ${image.naturalWidth}×${image.naturalHeight}，`
      + `session ${expectedWidth}×${expectedHeight}）。`,
    );
  }
}

function setConnection(kind, text) {
  dom.connectionStatus.classList.remove("is-loading", "is-online", "is-error");
  dom.connectionStatus.classList.add(`is-${kind}`);
  dom.connectionStatus.querySelector("span:last-child").textContent = text;
}

async function saveArtifact(kind) {
  const button = {
    json: dom.saveJsonButton,
    png: dom.savePngButton,
    jpeg: dom.saveJpegButton,
    txt: dom.saveTxtButton,
  }[kind];
  if (!button) throw new Error(`Unsupported export type: ${kind}`);
  if (button.disabled) return;
  const isOverlayImage = kind === "png" || kind === "jpeg";
  if (isOverlayImage && (state.isDraft || state.isPlacing || state.dirty || state.saving)) {
    toast("編集中の図形を先にAdd／更新してからPNGを保存してください。", true);
    return;
  }
  button.disabled = true;
  setConnection("loading", "ローカル保存中");
  try {
    if (!state.session || !state.image) throw new Error("先にローカルTIFFを開いてください。");
    const stem = String(state.session.image.name || "sem_image").replace(/\.(tif|tiff|bmp)$/i, "");
    if (kind === "json") {
      await saveBlobToLocalDirectory(
        new Blob([JSON.stringify(state.session, null, 2)], { type: "application/json;charset=utf-8" }),
        `${stem}_manual_count.json`,
        { relativeDirectory: currentImageDirectoryPath() },
      );
    } else if (kind === "txt") {
      await saveBlobToLocalDirectory(
        new Blob([manualSessionToTxt(state.session)], { type: "text/plain;charset=utf-8" }),
        `${stem}_manual_particle_sizes.txt`,
        { relativeDirectory: currentImageDirectoryPath() },
      );
    } else {
      const overlay = renderLocalOverlay(kind === "jpeg");
      const blob = await new Promise((resolve, reject) => overlay.toBlob((value) => value ? resolve(value) : reject(new Error("画像を書き出せませんでした。")), kind === "jpeg" ? "image/jpeg" : "image/png", kind === "jpeg" ? 0.85 : undefined));
      await saveBlobToLocalDirectory(
        blob,
        `${stem}_manual_overlay.${kind === "jpeg" ? "jpg" : "png"}`,
        { relativeDirectory: currentImageDirectoryPath() },
      );
    }
    toast(`${kind.toUpperCase()}を読み込んだローカルフォルダへ保存しました。`);
    setConnection("online", "ローカルのみ");
  } catch (error) {
    setConnection("error", "保存失敗");
    toast(`${kind.toUpperCase()}を保存できません：${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

function currentImageDirectoryPath() {
  return state.currentImageFile ? fileDirectory(state.currentImageFile) : "";
}

async function writableLocalDirectory(relativeDirectory = "", options = {}) {
  let directoryHandle = state.localDirectoryHandle;
  if (!directoryHandle) {
    if (typeof window.showDirectoryPicker !== "function") {
      throw new Error("このブラウザーはローカルフォルダへの直接保存に対応していません。ChromeまたはEdgeをご利用ください。");
    }
    directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    state.localDirectoryHandle = directoryHandle;
    await persistLocalDirectoryHandle(directoryHandle);
  }
  const permissionOptions = { mode: "readwrite" };
  let permission = typeof directoryHandle.queryPermission === "function"
    ? await directoryHandle.queryPermission(permissionOptions)
    : "prompt";
  if (permission !== "granted" && typeof directoryHandle.requestPermission === "function") {
    permission = await directoryHandle.requestPermission(permissionOptions);
  }
  if (permission !== "granted") {
    throw new Error("読み込んだローカルフォルダへの書き込みが許可されませんでした。");
  }
  const pathParts = String(relativeDirectory)
    .split("/")
    .filter(Boolean);
  if (pathParts[0] === directoryHandle.name) pathParts.shift();
  for (const part of pathParts) {
    directoryHandle = await directoryHandle.getDirectoryHandle(part, {
      create: Boolean(options.create),
    });
  }
  return directoryHandle;
}

async function saveBlobToLocalDirectory(blob, filename, options = {}) {
  const directoryHandle = options.directoryHandle
    || await writableLocalDirectory(options.relativeDirectory || "", {
      create: options.createDirectory,
    });
  const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort?.();
    throw error;
  }
}

function dataUrlToBlob(dataUrl) {
  const [header, encoded] = String(dataUrl || "").split(",", 2);
  if (!header || !encoded || !header.startsWith("data:")) {
    throw new Error("PNGデータを読み込めませんでした。");
  }
  const mimeMatch = header.match(/^data:([^;]+);base64$/i);
  if (!mimeMatch) throw new Error("PNGデータ形式が正しくありません。");
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeMatch[1] });
}

function safeExportFilename(value) {
  return String(value || "export").replace(/[\\/:*?"<>|]/g, "_");
}

async function onSizeDistributionListClick(event) {
  const link = event.target.closest("[data-size-distribution-download]");
  if (!link) return;
  event.preventDefault();
  if (link.dataset.saving === "true") return;
  const analysisRun = link.dataset.sizeDistributionDownload;
  const run = state.sizeDistributionPayload?.runs?.find((item) => item.analysis_run === analysisRun);
  if (!run?.image_url) return;
  link.dataset.saving = "true";
  const originalLabel = link.textContent;
  link.textContent = "保存中…";
  try {
    await saveBlobToLocalDirectory(
      dataUrlToBlob(run.image_url),
      `${safeExportFilename(analysisRun)}_size_distribution.png`,
      { relativeDirectory: SIZE_DISTRIBUTION_OUTPUT_DIRECTORY, createDirectory: true },
    );
    toast(`${analysisRun}のPNGをParticle sizeフォルダへ再保存しました。`);
  } catch (error) {
    toast(`PNGを保存できません：${error.message}`, true);
  } finally {
    link.dataset.saving = "false";
    link.textContent = originalLabel;
  }
}

async function saveSizeDistributionOutputs(payload) {
  if (!payload?.csv) throw new Error("保存するサイズ統計CSVがありません。");
  const outputDirectory = await writableLocalDirectory(SIZE_DISTRIBUTION_OUTPUT_DIRECTORY, { create: true });
  await saveBlobToLocalDirectory(
    new Blob([payload.csv], { type: "text/csv;charset=utf-8" }),
    "shape_statistics_by_shape.csv",
    { directoryHandle: outputDirectory },
  );
  const pngRuns = (payload.runs || []).filter((run) => run?.image_url);
  await Promise.all(pngRuns.map((run) => saveBlobToLocalDirectory(
    dataUrlToBlob(run.image_url),
    `${safeExportFilename(run.analysis_run)}_size_distribution.png`,
    { directoryHandle: outputDirectory },
  )));
  return { pngCount: pngRuns.length };
}

function manualSessionToTxt(session) {
  const summary = session.summary || localSummary(session.particles || []);
  const calibration = session.calibration || {};
  const lines = [
    "# Manual SEM particle-size count",
    `# schema_version\t${session.schema_version || "1.1"}`,
    `# analysis_version\t${session.analysis_version || "1.2.0-browser-local"}`,
    `# image\t${session.image?.name || ""}`,
    `# image_sha256\t${session.dataset?.image_sha256 || ""}`,
    "# data_handling\tbrowser_local_only",
    `# scale_source\t${calibration.source || ""}`,
    `# scale_method\t${calibration.method || ""}`,
    `# scale_bar_marker_nm\t${calibration.marker_length_nm ?? ""}`,
    `# scale_bar_length_px\t${calibration.detected_length_px ?? ""}`,
    `# pixel_size_nm_per_px\t${calibration.pixel_size_nm_per_px ?? ""}`,
    `# calibration_verified_by_user\t${Boolean(calibration.verified_by_user)}`,
    `# 1_Avg Dia. (SEM)\t${summary.mean_diameter_nm ?? ""}`,
    `# 1_Std. Dev.\t${summary.std_diameter_nm ?? ""}`,
    `# 1_C.V.\t${summary.cv_percent ?? ""}`,
    `# 1_Counts\t${summary.count ?? 0}`,
    `# total_saved_particles\t${session.particles?.length || 0}`,
    "particle_id\tshape\th\tincluded_in_statistics\texclusion_reason\tvalid_sem_fraction\tquality_flags\tprojected_area_px2\tprojected_area_nm2\tequivalent_radius_nm\tequivalent_diameter_nm\tcenter_x_px\tcenter_y_px\tscale_px\tquaternion_x\tquaternion_y\tquaternion_z\tquaternion_w\tnotes",
  ];
  for (const particle of session.particles || []) {
    lines.push([
      particle.id, particle.shape, particle.h, Boolean(particle.included_in_statistics), particle.exclusion_reason || "",
      particle.valid_sem_fraction ?? "", (particle.quality_flags || []).join("|"), particle.projected_area_px2 ?? "",
      particle.projected_area_nm2 ?? "", particle.equivalent_radius_nm ?? "", particle.equivalent_diameter_nm ?? "",
      particle.translation_xy_px?.[0] ?? "", particle.translation_xy_px?.[1] ?? "", particle.scale_px ?? "",
      ...(particle.quaternion_xyzw || ["", "", "", ""]), particle.notes || "",
    ].join("\t"));
  }
  return `\uFEFF${lines.join("\n")}\n`;
}

function renderLocalOverlay(jpeg = false) {
  const canvas = document.createElement("canvas");
  canvas.width = state.image.naturalWidth;
  canvas.height = state.image.naturalHeight;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(state.image, 0, 0);
  for (const particle of state.session.particles || []) drawNativeParticle(ctx, particle);
  if (state.showParticleNumbers) {
    state.session.particles.forEach((particle, index) => drawNativeParticleNumber(ctx, particle, particleNumberLabel(particle.id, index + 1)));
  }
  return canvas;
}

function nativePath(ctx, points) {
  if (!points?.length) return false;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index][0], points[index][1]);
  ctx.closePath();
  return true;
}

function drawNativeParticle(ctx, particle) {
  const projection = projectModel(particle);
  const color = SHAPE_COLORS[particle.shape] || SHAPE_COLORS.rhombic_dodecahedron;
  const excluded = particle.included_in_statistics === false;
  ctx.save();
  if (excluded) ctx.globalAlpha = 0.48;
  for (const face of [...projection.visibleFaces].sort((a, b) => b.depth - a.depth)) {
    nativePath(ctx, face.points);
    const facing = clamp(face.facing, 0, 1);
    ctx.fillStyle = `rgba(${color.rgb[0]},${color.rgb[1]},${color.rgb[2]},${0.09 + 0.08 * facing})`;
    ctx.fill();
  }
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = `rgba(${color.rgb[0]},${color.rgb[1]},${color.rgb[2]},0.8)`;
  for (const edge of projection.visibleEdges) {
    ctx.beginPath();
    ctx.moveTo(edge.points[0][0], edge.points[0][1]);
    ctx.lineTo(edge.points[1][0], edge.points[1][1]);
    ctx.stroke();
  }
  nativePath(ctx, projection.silhouette);
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = `rgba(${color.rgb[0]},${color.rgb[1]},${color.rgb[2]},0.95)`;
  if (excluded) ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.restore();
}

function drawNativeParticleNumber(ctx, particle, label) {
  const [x, y] = particle.translation_xy_px || [0, 0];
  const color = SHAPE_COLORS[particle.shape] || SHAPE_COLORS.rhombic_dodecahedron;
  ctx.save();
  ctx.font = "700 20px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = Math.max(28, ctx.measureText(String(label)).width + 14);
  roundedRectPath(ctx, x - width / 2, y - 14, width, 28, 6);
  ctx.fillStyle = `rgba(${color.rgb[0]},${color.rgb[1]},${color.rgb[2]},0.94)`;
  ctx.fill();
  ctx.strokeStyle = "rgba(16,24,22,0.8)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = color.labelText;
  ctx.fillText(String(label), x, y + 1);
  ctx.restore();
}

function renderSession() {
  const imageRecord = state.session?.image;
  dom.currentImageName.textContent = imageRecord
      ? `${imageRecord.name} · ${imageRecord.source_format || "SEM画像"}原本 · ${imageRecord.width}×${imageRecord.height} px`
    : "—";
  renderSummary();
  renderScale();
  renderParticleList();
  renderInspector();
  requestDraw();
}

async function openTiffDialog() {
  if ((state.working && state.dirty) || state.isPlacing || state.saving) {
    toast("未保存の粒子編集を保存またはキャンセルしてから画像を切り替えてください。", true);
    return;
  }
  dom.openTiffButton.disabled = true;
  dom.tiffDialogStatus.textContent = "SEM画像一覧を読み込んでいます。";
  try {
    await loadTiffInventory(false);
    if (typeof dom.tiffDialog.showModal === "function") dom.tiffDialog.showModal();
    else dom.tiffDialog.setAttribute("open", "");
  } catch (error) {
    toast(`SEM画像一覧を取得できません：${error.message}`, true);
  } finally {
    dom.openTiffButton.disabled = false;
  }
}

async function openSizeDistributionDialog() {
  if (state.sizeDistributionLoading) return;
  if ((state.working && state.dirty) || state.isPlacing || state.saving) {
    toast("未保存の粒子編集を保存またはキャンセルしてからサイズ分布を集計してください。", true);
    return;
  }
  if (!state.localFiles.length) {
    toast("先にローカルフォルダを選択してください。", true);
    selectLocalFolder();
    return;
  }
  if (typeof dom.sizeDistributionDialog.showModal === "function") dom.sizeDistributionDialog.showModal();
  else dom.sizeDistributionDialog.setAttribute("open", "");
  await refreshSizeDistribution();
}

function closeSizeDistributionDialog() {
  if (typeof dom.sizeDistributionDialog.close === "function") dom.sizeDistributionDialog.close();
  else dom.sizeDistributionDialog.removeAttribute("open");
}

async function refreshSizeDistribution() {
  if (state.sizeDistributionLoading) return;
  state.sizeDistributionLoading = true;
  dom.sizeDistributionButton.disabled = true;
  dom.refreshSizeDistributionButton.disabled = true;
  dom.saveSizeDistributionCsvButton.disabled = true;
  dom.sizeDistributionDialogStatus.textContent = "ローカルJSONをSEM画像のサブフォルダ単位で集計し，PNGを生成しています。";
  dom.sizeDistributionList.setAttribute("aria-busy", "true");
  try {
    const result = await apiJson(
      "/api/manual/size-distributions/refresh",
      { method: "POST" },
    );
    state.sizeDistributionPayload = result;
    renderSizeDistributionList(result);
    const runCount = (result.runs || []).length;
    const skippedCount = (result.skipped || []).length;
    const skippedLabel = skippedCount
      ? ` ${skippedCount} SEMフォルダは統計対象粒子がないためスキップしました。`
      : "";
    let outputLabel;
    try {
      const { pngCount } = await saveSizeDistributionOutputs(result);
      outputLabel = `Particle sizeフォルダへCSV 1件とPNG ${pngCount}件を自動保存しました。`;
      toast(`サイズ分布をParticle sizeフォルダへ自動保存しました（CSV 1件，PNG ${pngCount}件）。`);
    } catch (error) {
      outputLabel = `Particle sizeフォルダへ自動保存できませんでした：${error.message}`;
      toast(outputLabel, true);
    }
    dom.sizeDistributionDialogStatus.textContent = `${runCount} SEMフォルダのPNGを表示しています。${outputLabel}${skippedLabel}`;
    dom.saveSizeDistributionCsvButton.disabled = !result.csv;
  } catch (error) {
    dom.sizeDistributionDialogStatus.textContent = `サイズ分布を更新できません：${error.message}`;
    toast(`サイズ分布を更新できません：${error.message}`, true);
  } finally {
    state.sizeDistributionLoading = false;
    dom.sizeDistributionButton.disabled = false;
    dom.refreshSizeDistributionButton.disabled = false;
    dom.sizeDistributionList.removeAttribute("aria-busy");
  }
}

function renderSizeDistributionList(result) {
  const cards = (result?.runs || []).map((run) => {
    const analysisRun = escapeHtml(run.analysis_run);
    const imageUrl = escapeHtml(run.image_url);
    return `
      <figure class="size-distribution-card">
        <img src="${imageUrl}" alt="${analysisRun}の個数基準サイズ分布" loading="lazy">
        <figcaption>
          <strong>${analysisRun}</strong>
          <span>n = ${integer(run.count)}</span>
          <a class="size-distribution-download" href="${imageUrl}" data-size-distribution-download="${analysisRun}">PNGを再保存</a>
        </figcaption>
      </figure>`;
  }).join("");
  const skipped = (result?.skipped || []).map((run) => `
    <li><strong>${escapeHtml(run.analysis_run)}</strong>：${escapeHtml(run.reason || "表示対象外")}</li>
  `).join("");
  const skippedBlock = skipped
    ? `<div class="size-distribution-skipped">
         <strong>表示対象外</strong>
         <ul>${skipped}</ul>
       </div>`
    : "";
  dom.sizeDistributionList.innerHTML = cards || '<p class="manual-dialog-empty">表示できるサイズ分布PNGがありません。</p>';
  if (skippedBlock) dom.sizeDistributionList.insertAdjacentHTML("beforeend", skippedBlock);
}

async function saveSizeDistributionCsv() {
  if (!state.sizeDistributionPayload?.csv) return;
  dom.saveSizeDistributionCsvButton.disabled = true;
  try {
    await saveBlobToLocalDirectory(
      new Blob([state.sizeDistributionPayload.csv], { type: "text/csv;charset=utf-8" }),
      "shape_statistics_by_shape.csv",
      { relativeDirectory: SIZE_DISTRIBUTION_OUTPUT_DIRECTORY, createDirectory: true },
    );
    toast("サイズ統計CSVをParticle sizeフォルダへ再保存しました。");
  } catch (error) {
    toast(`CSVを保存できません：${error.message}`, true);
  } finally {
    dom.saveSizeDistributionCsvButton.disabled = false;
  }
}

async function loadTiffInventory(refresh) {
  if (state.localFiles.length && (!state.localSessionIndexReady || refresh)) {
    await indexLocalSessions();
  }
  const endpoint = refresh ? "/api/manual/images/refresh" : "/api/manual/images";
  const result = await apiJson(endpoint, refresh ? { method: "POST" } : {});
  state.availableImages = result.images || [];
  const restoredImageId = state.pendingRestoredImagePath;
  state.selectedImageId = result.current_image_id
    || (state.availableImages.some((item) => item.image_id === restoredImageId) ? restoredImageId : null)
    || state.availableImages[0]?.image_id
    || null;
  state.pendingRestoredImagePath = null;
  const groupedImages = groupTiffImagesByDirectory(state.availableImages);
  const availableDirectories = new Set(groupedImages.map((group) => group.directory));
  state.openTiffDirectories = new Set(
    [...state.openTiffDirectories].filter((directory) => availableDirectories.has(directory)),
  );
  const selectedItem = state.availableImages.find((item) => item.image_id === state.selectedImageId);
  if (!state.tiffDirectoryStateInitialized) {
    state.openTiffDirectories.clear();
    state.tiffDirectoryStateInitialized = true;
  }
  if (selectedItem) state.openTiffDirectories.add(tiffDirectoryLabel(selectedItem));
  renderTiffImageList();
  const directoryCount = groupedImages.length;
  const sourceLabel = refresh ? "選択フォルダの校正・解析情報を再読み込みしました" : "選択フォルダの校正・解析情報を読み込みました";
  dom.tiffDialogStatus.textContent = `${directoryCount}ディレクトリ，${state.availableImages.length}画像 · ${sourceLabel}。`;
  if (!state.image) {
    dom.manualCanvasMessage.classList.remove("is-error");
    dom.manualCanvasMessage.querySelector(".spinner").hidden = true;
    dom.manualCanvasMessage.querySelector("span:last-child").textContent = state.availableImages.length
      ? "TIFF／BMP一覧から画像を選択してください。"
      : "選択フォルダにTIFF／BMPが見つかりません。";
    dom.manualCanvasMessage.hidden = false;
  }
}

async function refreshTiffIndex() {
  if (state.switchingImage || dom.refreshTiffIndexButton.disabled) return;
  dom.refreshTiffIndexButton.disabled = true;
  dom.tiffDialogStatus.textContent = "選択したローカルフォルダ内のTIFF／BMP，JSON，TXTを再探索しています。";
  try {
    await loadTiffInventory(true);
  } catch (error) {
    dom.tiffDialogStatus.textContent = `一覧を更新できません：${error.message}`;
    toast(`SEM画像一覧を更新できません：${error.message}`, true);
  } finally {
    dom.refreshTiffIndexButton.disabled = false;
  }
}

function renderTiffImageList() {
  if (!state.availableImages.length) {
    dom.tiffImageList.innerHTML = '<p class="manual-dialog-empty">TIFF／BMPが見つかりません。</p>';
    dom.confirmTiffButton.disabled = true;
    return;
  }
  dom.confirmTiffButton.disabled = !state.selectedImageId;
  dom.tiffImageList.innerHTML = groupTiffImagesByDirectory(state.availableImages).map((group, groupIndex) => {
    const isOpen = state.openTiffDirectories.has(group.directory);
    const itemContainerId = `manual-tiff-directory-${groupIndex}`;
    const directoryStats = aggregateTiffDirectoryStats(group.images);
    const breadcrumb = group.directory.split("/").filter(Boolean).map((part, index) => `
      ${index ? '<span class="manual-tiff-path-separator" aria-hidden="true">/</span>' : ""}
      <span>${escapeHtml(part)}</span>`).join("");
    const rows = group.images.map((item) => renderTiffImageRow(item)).join("");
    return `
      <section class="manual-tiff-directory" aria-label="${escapeHtml(group.directory)}">
        <button class="manual-tiff-directory-header" type="button"
          data-tiff-directory-toggle="${escapeHtml(group.directory)}"
          aria-expanded="${isOpen}" aria-controls="${itemContainerId}">
          <span class="manual-tiff-folder-icon" aria-hidden="true"></span>
          <strong class="manual-tiff-breadcrumb">${breadcrumb}</strong>
          <span class="manual-tiff-directory-count">${group.images.length} 画像</span>
          <span class="manual-tiff-directory-summary" aria-label="${escapeHtml(renderTiffDirectoryStats(directoryStats))}" title="登録粒子数 / 統計対象数，統計対象粒子の平均径，1σ，CV，スケール確認済み画像数">${renderTiffDirectoryStats(directoryStats)}</span>
          <span class="manual-tiff-toggle-label">${isOpen ? "閉じる" : "開く"}</span>
          <span class="manual-tiff-disclosure" aria-hidden="true">›</span>
        </button>
        <div id="${itemContainerId}" class="manual-tiff-directory-items"${isOpen ? "" : " hidden"}>${rows}</div>
      </section>`;
  }).join("");
}

function aggregateTiffDirectoryStats(images) {
  let totalSavedCount = 0;
  let includedCount = 0;
  let diameterSumNm = 0;
  let diameterSumSqNm2 = 0;
  let momentIncludedCount = 0;
  let scaleVerifiedCount = 0;
  for (const item of images || []) {
    totalSavedCount += Math.max(0, Math.round(Number(item?.particle_count) || 0));
    const included = Math.max(0, Math.round(Number(item?.included_count) || 0));
    includedCount += included;
    if (Boolean(item?.scale_verified)) scaleVerifiedCount += 1;
    if (!included) continue;
    let sum = Number(item?.diameter_sum_nm);
    let sumSq = Number(item?.diameter_sum_sq_nm2);
    // Read older CSV rows as well: a single-image row can be reconstructed
    // from its mean and population standard deviation.
    if (!Number.isFinite(sum) || !Number.isFinite(sumSq)) {
      const mean = Number(item?.mean_diameter_nm);
      const std = Number(item?.std_diameter_nm);
      if (Number.isFinite(mean) && Number.isFinite(std)) {
        sum = mean * included;
        sumSq = included * (std * std + mean * mean);
      }
    }
    if (Number.isFinite(sum) && Number.isFinite(sumSq)) {
      diameterSumNm += sum;
      diameterSumSqNm2 += sumSq;
      momentIncludedCount += included;
    }
  }
  if (!includedCount || momentIncludedCount !== includedCount) {
    return {
      imageCount: (images || []).length,
      totalSavedCount,
      includedCount,
      scaleVerifiedCount,
      meanDiameterNm: null,
      stdDiameterNm: null,
      cvPercent: null,
    };
  }
  const meanDiameterNm = diameterSumNm / includedCount;
  const variance = Math.max(0, diameterSumSqNm2 / includedCount - meanDiameterNm * meanDiameterNm);
  const stdDiameterNm = Math.sqrt(variance);
  return {
    imageCount: (images || []).length,
    totalSavedCount,
    includedCount,
    scaleVerifiedCount,
    meanDiameterNm,
    stdDiameterNm,
    cvPercent: meanDiameterNm > 0 ? 100 * stdDiameterNm / meanDiameterNm : null,
  };
}

function renderTiffDirectoryStats(stats) {
  return `登録${integer(stats.totalSavedCount)} / 対象${integer(stats.includedCount)} · μ ${formatted(stats.meanDiameterNm, 1)} nm · 1σ ${formatted(stats.stdDiameterNm, 1)} nm · CV ${formatted(stats.cvPercent, 1)}% · Scale確認 ${integer(stats.scaleVerifiedCount)}/${integer(stats.imageCount)}`;
}

function tiffDirectoryLabel(item) {
  const directory = String(item?.directory || "").trim();
  if (directory) return directory;
  const sample = String(item?.sample || "").trim();
  const folder = String(item?.folder || "").trim();
  if (sample && folder && sample !== folder) return `${sample}/${folder}`;
  return sample || folder || "未分類";
}

function groupTiffImagesByDirectory(images) {
  const groups = new Map();
  for (const item of images || []) {
    const directory = tiffDirectoryLabel(item);
    if (!groups.has(directory)) groups.set(directory, []);
    groups.get(directory).push(item);
  }
  return Array.from(groups, ([directory, groupedImages]) => ({
    directory,
    images: [...groupedImages].sort((left, right) => compareNaturalPaths(
      left?.relative_path || left?.image_id || left?.name,
      right?.relative_path || right?.image_id || right?.name,
    )),
  })).sort((left, right) => compareNaturalPaths(left.directory, right.directory));
}

function renderTiffImageRow(item) {
    const selected = item.image_id === state.selectedImageId;
    const jsonLabel = item.has_work_json
      ? "作業JSON"
      : (item.has_browser_session
        ? "ブラウザー保存"
      : (item.has_legacy_work_json
        ? "旧作業JSON（同じフォルダへ移行）"
        : (item.has_same_name_json ? "同名JSON" : (item.has_exported_json ? "出力JSON" : "新規"))));
    const txtLabel = item.has_companion_txt ? `TXT ${item.companion_txt_name}` : "TXTなし";
    const particleCount = integer(item.particle_count, 0);
    const includedCount = integer(item.included_count, 0);
    const hasStatistics = Number(item.included_count) > 0 && Number.isFinite(Number(item.mean_diameter_nm));
    const statisticsLabel = hasStatistics
      ? `保存 ${particleCount} · 対象 ${includedCount} · μ ${formatted(item.mean_diameter_nm, 1)} nm · 1σ ${formatted(item.std_diameter_nm, 1)} nm · CV ${formatted(item.cv_percent, 1)}%`
      : `保存 ${particleCount} · 統計対象 ${includedCount}`;
    const scaleLabel = item.scale_state === "verified"
      ? `Scale確認済み · ${formatted(item.pixel_size_nm_per_px, 6)} nm/px`
      : (item.scale_state === "automatic"
        ? `Scale自動検出 · ${formatted(item.pixel_size_nm_per_px, 6)} nm/px · 信頼度 ${formatted(100 * Number(item.scale_confidence), 1)}%`
        : (item.scale_state === "metadata"
          ? `Scale要確認（metadata）· ${formatted(item.pixel_size_nm_per_px, 6)} nm/px`
          : (item.scale_state === "read_error"
            ? `読込失敗：${item.local_read_error}`
            : "Scale要手動入力")));
    const analysisBadge = item.is_analyzed
      ? `<span class="manual-tiff-analyzed" title="保存済み${particleCount}粒子，統計対象${includedCount}粒子"><span aria-hidden="true">✓</span>${particleCount}粒子</span>`
      : '<span class="manual-tiff-not-analyzed"><span aria-hidden="true">—</span>未解析</span>';
    const scaleBadge = item.scale_state === "verified"
      ? `<span class="manual-tiff-scale-verified" title="スケールバー確認済み${item.scale_verified_at ? `：${escapeHtml(item.scale_verified_at)}` : ""}"><span aria-hidden="true">✓</span>スケール確認済み</span>`
      : `<span class="manual-tiff-scale-unverified" title="${escapeHtml(scaleLabel)}"><span aria-hidden="true">○</span>${item.scale_state === "automatic" ? "Scale自動" : "Scale未確認"}</span>`;
    return `
      <button class="manual-tiff-row${selected ? " is-selected" : ""}" type="button"
        role="radio" aria-checked="${selected}" data-image-id="${escapeHtml(item.image_id)}">
        <span class="manual-tiff-radio" aria-hidden="true"></span>
        <span class="manual-tiff-main">
          <strong>${escapeHtml(item.name)}</strong>
          <small>${escapeHtml(jsonLabel)} · ${escapeHtml(txtLabel)}</small>
          <small>${escapeHtml(statisticsLabel)}</small>
          <small>${escapeHtml(scaleLabel)}</small>
        </span>
        <span class="manual-tiff-row-status">
          ${item.is_current ? '<span class="manual-tiff-current">表示中</span>' : ""}
          ${analysisBadge}
          ${scaleBadge}
        </span>
      </button>`;
}

function onTiffImageListClick(event) {
  const directoryToggle = event.target.closest("[data-tiff-directory-toggle]");
  if (directoryToggle) {
    const directory = directoryToggle.dataset.tiffDirectoryToggle;
    const isOpen = directoryToggle.getAttribute("aria-expanded") === "true";
    const itemContainer = document.getElementById(directoryToggle.getAttribute("aria-controls"));
    if (isOpen) state.openTiffDirectories.delete(directory);
    else state.openTiffDirectories.add(directory);
    directoryToggle.setAttribute("aria-expanded", String(!isOpen));
    const label = directoryToggle.querySelector(".manual-tiff-toggle-label");
    if (label) label.textContent = isOpen ? "開く" : "閉じる";
    if (itemContainer) itemContainer.hidden = isOpen;
    return;
  }
  const row = event.target.closest("[data-image-id]");
  if (!row) return;
  state.selectedImageId = row.dataset.imageId;
  renderTiffImageList();
}

function closeTiffDialog() {
  if (state.switchingImage) return;
  if (typeof dom.tiffDialog.close === "function") dom.tiffDialog.close();
  else dom.tiffDialog.removeAttribute("open");
}

async function openSelectedTiff() {
  if (!state.selectedImageId || state.switchingImage) return;
  state.switchingImage = true;
  dom.confirmTiffButton.disabled = true;
  dom.cancelTiffButton.disabled = true;
  dom.closeTiffDialogButton.disabled = true;
  dom.tiffDialogStatus.textContent = "選択画像を読み込んでいます。";
  setConnection("loading", "ローカル読込中");
  try {
    const imageFile = localFileByPath(state.selectedImageId);
    if (!imageFile) throw new Error("選択した画像がローカルファイル一覧にありません。");
    const arrayBuffer = await imageFile.arrayBuffer();
    state.currentImageFile = imageFile;
    state.currentImageBuffer = arrayBuffer;
    state.currentImageHash = await sha256Hex(arrayBuffer);
    const image = await loadTiff(imageFile, arrayBuffer);
    const session = await createLocalSession(imageFile, image, state.currentImageHash);
    validateTiffRaster(image, session);
    state.session = session;
    state.image = image;
    persistLastLocalImagePath(imageFile);
    state.working = null;
    state.workingId = null;
    state.workingOriginal = null;
    state.isDraft = false;
    state.isPlacing = false;
    state.dirty = false;
    state.saving = false;
    state.pointer = null;
    dom.manualCanvas.classList.remove("is-placing", "is-dragging");
    dom.manualCanvasMessage.hidden = true;
    renderSession();
    showActualPixels();
    setConnection("online", "ローカルのみ");
    state.switchingImage = false;
    closeTiffDialog();
    const hasSidecar = Boolean(findLocalSidecar(imageFile));
    toast(`${state.session.image.name}：ローカル${localImageFormat(imageFile)}，${hasSidecar ? "TXT" : "TXTなし"}，JSON／ブラウザー保存を使用`);
  } catch (error) {
    setConnection("online", "ローカルのみ");
    dom.tiffDialogStatus.textContent = `開けません：${error.message}`;
    toast(`画像を開けません：${error.message}`, true);
  } finally {
    state.switchingImage = false;
    dom.confirmTiffButton.disabled = false;
    dom.cancelTiffButton.disabled = false;
    dom.closeTiffDialogButton.disabled = false;
  }
}

function renderSummary() {
  const summary = state.session?.summary || {};
  dom.summaryCount.textContent = integer(summary.count, 0);
  dom.summaryCountDetail.textContent = summary.total_saved_count == null
    ? "included"
    : `${integer(summary.count, 0)} / ${integer(summary.total_saved_count, 0)} included`;
  dom.summaryMean.textContent = formatted(summary.mean_diameter_nm, 2);
  dom.summaryStd.textContent = formatted(summary.std_diameter_nm, 2);
  dom.summaryCv.textContent = formatted(summary.cv_percent, 2);
  dom.summaryScale.textContent = formatted(
    state.session?.calibration?.pixel_size_nm_per_px,
    6,
  );
}

function renderScale() {
  const calibration = state.session?.calibration || {};
  const isBar = calibration.source === "scale_bar";
  const isManual = calibration.source === "manual_override";
  const isBmp = isCurrentImageBmp();
  const verified = Boolean(calibration.verified_by_user);
  dom.scaleBadge.textContent = verified
    ? (isManual ? "手動校正・確認済み" : "自動校正・確認済み")
    : (isBar ? "自動校正・未確認" : "要確認");
  dom.scaleBadge.classList.toggle("is-good", verified);
  dom.scaleBadge.classList.toggle("is-warning", !verified);
  dom.scaleMarker.textContent = calibration.marker_length_nm == null
    ? "—"
    : `${formatted(calibration.marker_length_nm, 1)} nm`;
  dom.scalePixels.textContent = calibration.detected_length_px == null
    ? "—"
    : `${formatted(calibration.detected_length_px, 1)} px`;
  dom.scaleConfidence.textContent = calibration.confidence == null
    ? "—"
    : `${formatted(100 * calibration.confidence, 1)}%`;
  dom.scaleMethod.textContent = isManual
    ? "研究者が確認・修正したスケールバー値を使用しています。変更履歴はJSONに保存されます。"
    : (isBar
      ? "右下のバー長を画像から検出し，Hitachi画像内のMicronMarker値を対応付けました。"
      : (calibration.source === "manual_required"
        ? (isBmp
          ? "BMPではバー表示値（nm）のみを入力してください。px長は画像から自動検出します。"
          : "TIFF／TXTから有効な校正値を取得できませんでした。バー表示値とpx長を入力して校正してください。")
        : "自動検出が品質基準を満たさないため，画像メタデータのPixelSizeを暫定使用しています。校正値を確認してください。"));
  if (document.activeElement !== dom.scaleMarkerInput) {
    dom.scaleMarkerInput.value = calibration.marker_length_nm ?? "";
  }
  if (document.activeElement !== dom.scalePixelsInput) {
    dom.scalePixelsInput.value = calibration.detected_length_px ?? "";
  }
  dom.scalePixelsInput.readOnly = isBmp;
  dom.scalePixelsInput.setAttribute("aria-readonly", String(isBmp));
  dom.scalePixelsInput.title = isBmp
    ? "BMPではスケールバー長を画像から自動検出します。"
    : "必要に応じて検出長を修正できます。";
  if (document.activeElement !== dom.scaleVerificationNote) {
    dom.scaleVerificationNote.value = calibration.verification_note || "";
  }
}

async function verifyOrUpdateScale() {
  if ((state.working && state.dirty) || state.isPlacing) {
    toast("粒子の未保存変更を保存またはキャンセルしてから校正を変更してください。", true);
    return;
  }
  const marker = Number(dom.scaleMarkerInput.value);
  const isBmp = isCurrentImageBmp();
  const pixels = isBmp ? null : Number(dom.scalePixelsInput.value);
  if (!Number.isFinite(marker) || marker <= 0 || (!isBmp && (!Number.isFinite(pixels) || pixels <= 0))) {
    toast(isBmp ? "BMPではバー表示値（nm）のみを入力してください。" : "バー表示値と検出長には正の数値を入力してください。", true);
    return;
  }
  dom.verifyScaleButton.disabled = true;
  try {
    const result = await apiJson("/api/manual/calibration", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        marker_length_nm: marker,
        detected_length_px: pixels,
        expected_revision: state.session.calibration.revision,
        expected_image_sha256: state.session.dataset?.image_sha256,
        verified_by_user: true,
        verification_note: dom.scaleVerificationNote.value,
      }),
    });
    state.session.calibration = result.calibration;
    state.session.particles = result.particles;
    state.session.summary = result.summary;
    state.session.revision = result.session_revision;
    if (state.workingId && !state.isDraft) {
      const refreshed = result.particles.find((item) => item.id === state.workingId);
      if (refreshed) {
        state.working = editableCopy(refreshed);
        state.workingOriginal = editableCopy(refreshed);
        state.dirty = false;
      }
    }
    renderSession();
    toast(`校正を保存しました：${formatted(result.calibration.pixel_size_nm_per_px, 9)} nm/px`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    dom.verifyScaleButton.disabled = false;
  }
}

function renderParticleList() {
  const particles = state.session?.particles || [];
  dom.particleCountChip.textContent = String(particles.length);
  if (!particles.length) {
    dom.manualParticleList.innerHTML = '<p class="manual-empty-list">まだ粒子は追加されていません。</p>';
    return;
  }
  dom.manualParticleList.innerHTML = particles.map((particle) => {
    const selected = state.workingId === particle.id && !state.isDraft;
    const excluded = !Boolean(particle.included_in_statistics ?? true);
    const hLabel = particle.shape === "chamfered_cube" ? ` · h=${formatted(particle.h, 2)}` : "";
    return `
      <button class="manual-particle-row${selected ? " is-selected" : ""}${excluded ? " is-excluded" : ""}" data-shape="${escapeHtml(particle.shape)}" type="button"
        role="option" aria-selected="${selected}" data-particle-id="${escapeHtml(particle.id)}">
        <span class="row-shape" data-shape="${escapeHtml(particle.shape)}" aria-hidden="true">${SHAPE_SYMBOLS[particle.shape] || "◇"}</span>
        <span class="row-main">
          <strong>${escapeHtml(particle.id)} · ${escapeHtml(SHAPE_LABELS[particle.shape] || particle.shape)}${hLabel}</strong>
          <small>${excluded ? "統計除外 · " : ""}Area ${formatted(particle.projected_area_nm2, 0)} nm²</small>
        </span>
        <span class="row-value">r ${formatted(particle.equivalent_radius_nm, 1)} nm</span>
      </button>`;
  }).join("");
}

function renderInspector() {
  const working = state.working;
  dom.inspectorEmpty.hidden = Boolean(working);
  dom.inspectorContent.hidden = !working;
  if (!working) {
    dom.inspectorHeading.textContent = "図形を追加";
    dom.editStateBadge.textContent = "未選択";
    dom.editStateBadge.classList.remove("is-good", "is-warning");
    return;
  }
  const metrics = calculateLocalMetrics(working);
  dom.inspectorHeading.textContent = state.isDraft ? "新しい粒子" : working.id;
  dom.editStateBadge.textContent = state.saving
    ? "保存中"
    : (state.isDraft ? "未保存" : (state.dirty ? "編集中" : "保存済み"));
  dom.editStateBadge.classList.toggle("is-warning", state.saving || state.isDraft || state.dirty);
  dom.editStateBadge.classList.toggle("is-good", !state.saving && !state.isDraft && !state.dirty);
  dom.inspectorShape.value = working.shape;
  const isChamfered = working.shape === "chamfered_cube";
  dom.chamferControl.hidden = !isChamfered;
  if (isChamfered) {
    const h = Number(working.h ?? 0.5);
    dom.chamferHInput.value = String(h);
    dom.chamferHValue.textContent = h.toFixed(2);
  }
  dom.includeStatisticsInput.checked = Boolean(working.included_in_statistics ?? true);
  dom.exclusionReasonField.hidden = dom.includeStatisticsInput.checked;
  if (document.activeElement !== dom.exclusionReasonInput) {
    dom.exclusionReasonInput.value = working.exclusion_reason || "";
  }
  if (dom.particleNotes.value !== (working.notes || "") && document.activeElement !== dom.particleNotes) {
    dom.particleNotes.value = working.notes || "";
  }
  dom.metricArea.textContent = formatted(metrics.areaNm2, 1);
  dom.metricRadius.textContent = formatted(metrics.radiusNm, 2);
  dom.metricDiameter.textContent = formatted(metrics.diameterNm, 2);
  dom.metricScale.textContent = formatted(working.scale_px, 1);
  const flags = metrics.qualityFlags || [];
  dom.qualityWarning.hidden = flags.length === 0;
  dom.qualityWarning.textContent = flags.length
    ? `注意：${flags.map(qualityFlagLabel).join("，")}。必要に応じて統計から除外してください。`
    : "";
  dom.commitParticleButtonLabel.textContent = state.isDraft ? "③ Add" : "更新して保存";
  dom.commitParticleButton.disabled = state.saving;
  dom.cancelEditButton.disabled = state.saving;
  dom.deleteParticleButton.disabled = state.saving;
  dom.deleteParticleButton.hidden = state.isDraft;
}

function onShapePaletteClick(event) {
  const button = event.target.closest("[data-shape]");
  if (!button) return;
  state.selectedShape = button.dataset.shape;
  document.querySelectorAll("[data-shape]").forEach((item) => {
    const selected = item === button;
    item.classList.toggle("is-selected", selected);
    item.setAttribute("aria-checked", String(selected));
  });
  if (state.working && state.isDraft) {
    state.working.shape = state.selectedShape;
    state.working.h = state.selectedShape === "rhombic_dodecahedron"
      ? 0
      : (state.selectedShape === "cube" ? 1 : 0.5);
    dom.inspectorShape.value = state.selectedShape;
    markDirtyAndRender();
  }
}

function startDraft() {
  if (state.isPlacing) {
    cancelWorkingParticle();
    return;
  }
  if (!canSwitchSelection()) return;
  state.isPlacing = true;
  dom.manualCanvas.classList.add("is-placing");
  dom.newParticleButtonLabel.textContent = "配置を中止（Esc）";
  dom.newParticleButton.disabled = false;
  dom.interactionHelp.textContent = "SEM画像上で，新しい粒子の中心をクリックしてください。Escで中止できます。";
  dom.manualCanvas.focus({ preventScroll: true });
  toast("SEM画像上の粒子中心をクリックしてください。");
}

function placeDraftAt(imagePoint) {
  const imageWidth = state.session.image.width;
  const imageHeight = state.session.image.height;
  const footerY = Number(state.session.image.footer?.y_start ?? imageHeight);
  if (
    imagePoint.x < 0 || imagePoint.y < 0
    || imagePoint.x > imageWidth || imagePoint.y > footerY
  ) {
    toast("有効なSEM画像領域内をクリックしてください。", true);
    return;
  }
  state.working = {
    shape: state.selectedShape,
    h: state.selectedShape === "rhombic_dodecahedron" ? 0 : (state.selectedShape === "cube" ? 1 : 0.5),
    quaternion_xyzw: [0, 0, 0, 1],
    scale_px: Math.max(18, Math.min(imageWidth, footerY) * 0.035),
    translation_xy_px: [imagePoint.x, imagePoint.y],
    included_in_statistics: true,
    exclusion_reason: "",
    notes: "",
  };
  state.workingId = null;
  state.workingOriginal = null;
  state.isDraft = true;
  state.isPlacing = false;
  state.dirty = true;
  dom.manualCanvas.classList.remove("is-placing");
  dom.newParticleButtonLabel.textContent = "＋ 新しい図形を配置";
  dom.newParticleButton.disabled = false;
  dom.interactionHelp.textContent = INTERACTION_HELP_TEXT;
  renderSession();
  toast("図形を仮置きしました。位置・回転・サイズを調整してください。");
}

function onParticleListClick(event) {
  const row = event.target.closest("[data-particle-id]");
  if (!row) return;
  selectSavedParticle(row.dataset.particleId);
}

function selectSavedParticle(particleId) {
  if (state.workingId === particleId && !state.isDraft) return;
  if (!canSwitchSelection()) return;
  const particle = state.session.particles.find((item) => item.id === particleId);
  if (!particle) return;
  state.working = editableCopy(particle);
  state.workingId = particle.id;
  state.workingOriginal = editableCopy(particle);
  state.isDraft = false;
  state.dirty = false;
  renderSession();
}

function editableCopy(particle) {
  return {
    id: particle.id,
    revision: particle.revision,
    shape: particle.shape,
    h: Number(particle.h ?? (particle.shape === "cube" ? 1 : (particle.shape === "rhombic_dodecahedron" ? 0 : 0.5))),
    quaternion_xyzw: [...particle.quaternion_xyzw],
    scale_px: Number(particle.scale_px),
    translation_xy_px: [...particle.translation_xy_px],
    included_in_statistics: Boolean(particle.included_in_statistics ?? true),
    exclusion_reason: particle.exclusion_reason || "",
    notes: particle.notes || "",
  };
}

function copySelectedParticle() {
  if (!state.working || state.isDraft) {
    toast("コピーする登録済み粒子を選択してください。", true);
    return;
  }
  if (state.dirty) {
    toast("変更を保存またはキャンセルしてから粒子をコピーしてください。", true);
    return;
  }
  state.particleClipboard = {
    sourceId: state.working.id,
    imageSha256: state.session.dataset?.image_sha256,
    pasteCount: 0,
    particle: editableCopy(state.working),
  };
  toast(`${state.working.id} をコピーしました。Command＋Vで新しい粒子として登録できます。`);
}

async function pasteCopiedParticle() {
  const clipboard = state.particleClipboard;
  if (!clipboard) {
    toast("先に登録済み粒子をCommand＋Cでコピーしてください。", true);
    return;
  }
  if (clipboard.imageSha256 !== state.session.dataset?.image_sha256) {
    toast("コピー元とは異なるSEM画像です。この画像内の粒子をコピーしてください。", true);
    return;
  }
  if (state.saving || state.isPlacing || (state.working && state.dirty)) {
    toast("未保存の操作を保存またはキャンセルしてからペーストしてください。", true);
    return;
  }
  const imageWidth = Number(state.session.image.width);
  const validHeight = Number(state.session.image.footer?.y_start ?? state.session.image.height);
  const successiveOffset = 14 * (clipboard.pasteCount + 1);
  const translation = offsetPastedTranslation(
    clipboard.particle.translation_xy_px,
    imageWidth,
    validHeight,
    successiveOffset,
    currentViewScale(),
  );
  const payload = {
    shape: clipboard.particle.shape,
    h: clipboard.particle.h,
    quaternion_xyzw: [...clipboard.particle.quaternion_xyzw],
    scale_px: clipboard.particle.scale_px,
    translation_xy_px: translation,
    included_in_statistics: clipboard.particle.included_in_statistics,
    exclusion_reason: clipboard.particle.exclusion_reason,
    notes: clipboard.particle.notes,
    expected_image_sha256: state.session.dataset?.image_sha256,
  };
  state.saving = true;
  renderInspector();
  try {
    const result = await apiJson("/api/manual/particles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    clipboard.pasteCount += 1;
    applySavedParticleResult(result);
    toast(`${clipboard.sourceId} のコピーを ${result.particle.id} として登録しました。`);
  } catch (error) {
    toast(`粒子をペーストできません：${error.message}`, true);
  } finally {
    state.saving = false;
    renderInspector();
  }
}

function canSwitchSelection() {
  if (state.isPlacing) {
    toast("現在は配置位置を指定中です。Escで中止してから別の粒子を選択してください。", true);
    return false;
  }
  if (state.working && state.dirty) {
    toast("未保存の変更があります。先にAdd／更新，またはキャンセルを実行してください。", true);
    return false;
  }
  return true;
}

async function commitWorkingParticle() {
  if (!state.working || state.saving) return;
  state.saving = true;
  renderInspector();
  const payload = {
    shape: state.working.shape,
    h: state.working.h,
    quaternion_xyzw: state.working.quaternion_xyzw,
    scale_px: state.working.scale_px,
    translation_xy_px: state.working.translation_xy_px,
    included_in_statistics: state.working.included_in_statistics,
    exclusion_reason: dom.exclusionReasonInput.value,
    notes: dom.particleNotes.value,
    expected_image_sha256: state.session.dataset?.image_sha256,
  };
  try {
    const result = state.isDraft
      ? await apiJson("/api/manual/particles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await apiJson(`/api/manual/particles/${encodeURIComponent(state.workingId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, expected_revision: state.working.revision }),
        });
    applySavedParticleResult(result);
    toast(`${result.particle.id} を保存しました。r = ${formatted(result.particle.equivalent_radius_nm, 2)} nm`);
  } catch (error) {
    toast(error.message, true);
    if (/revision/i.test(error.message)) {
      toast("別の更新が保存されています。再読み込みしてから編集してください。", true);
    }
  } finally {
    state.saving = false;
    renderInspector();
  }
}

function applySavedParticleResult(result) {
  const existingIndex = state.session.particles.findIndex((item) => item.id === result.particle.id);
  if (existingIndex >= 0) state.session.particles[existingIndex] = result.particle;
  else state.session.particles.push(result.particle);
  state.session.summary = result.summary;
  state.session.revision = result.session_revision;
  state.working = editableCopy(result.particle);
  state.workingId = result.particle.id;
  state.workingOriginal = editableCopy(result.particle);
  state.isDraft = false;
  state.dirty = false;
  renderSession();
}

function cancelWorkingParticle() {
  if (state.saving) {
    toast("保存処理が完了するまでお待ちください。", true);
    return;
  }
  state.working = null;
  state.workingId = null;
  state.workingOriginal = null;
  state.isDraft = false;
  state.isPlacing = false;
  state.dirty = false;
  dom.manualCanvas.classList.remove("is-placing");
  dom.newParticleButtonLabel.textContent = "＋ 新しい図形を配置";
  dom.newParticleButton.disabled = false;
  dom.interactionHelp.textContent = INTERACTION_HELP_TEXT;
  renderSession();
}

async function deleteWorkingParticle() {
  if (!state.workingId || state.isDraft || state.saving) return;
  const label = state.workingId;
  if (!window.confirm(`${label} を計測一覧から削除しますか？削除記録はJSONの監査履歴に保持されます。`)) return;
  try {
    const result = await apiJson(`/api/manual/particles/${encodeURIComponent(label)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_revision: state.working.revision,
        expected_image_sha256: state.session.dataset?.image_sha256,
      }),
    });
    state.session.particles = state.session.particles.filter((item) => item.id !== label);
    state.session.summary = result.summary;
    state.session.revision = result.session_revision;
    cancelWorkingParticle();
    toast(`${label} を削除しました。`);
  } catch (error) {
    toast(error.message, true);
  }
}

async function importJsonFile() {
  const file = dom.importJsonInput.files?.[0];
  dom.importJsonInput.value = "";
  if (!file) return;
  if ((state.working && state.dirty) || state.isPlacing) {
    toast("未保存の変更をキャンセルしてからJSONを復元してください。", true);
    return;
  }
  try {
    const parsed = JSON.parse(await file.text());
    const restored = await apiJson("/api/manual/session/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    state.session = restored;
    state.working = null;
    state.workingId = null;
    state.workingOriginal = null;
    state.isDraft = false;
    state.isPlacing = false;
    state.dirty = false;
    state.saving = false;
    renderSession();
    toast(`${restored.summary.count} 粒子をJSONから復元しました。`);
  } catch (error) {
    toast(`JSONを復元できません：${error.message}`, true);
  }
}

function applyNudge(action) {
  if (!state.working) return;
  if (action === "smaller") state.working.scale_px = Math.max(1, state.working.scale_px / 1.08);
  if (action === "larger") state.working.scale_px *= 1.08;
  if (action === "roll-negative" || action === "roll-positive") {
    const angle = (action === "roll-positive" ? 1 : -1) * Math.PI / 36;
    state.working.quaternion_xyzw = quaternionMultiply(
      quaternionFromAxisAngle([0, 0, 1], angle),
      state.working.quaternion_xyzw,
    );
  }
  markDirtyAndRender();
}

function markDirty() {
  state.dirty = true;
  renderInspector();
}

function markDirtyAndRender() {
  markDirty();
  requestDraw();
}

function onPointerDown(event) {
  if (!state.image || event.button > 1) return;
  const point = canvasPoint(event);
  if (state.isPlacing && event.button === 0) {
    placeDraftAt(screenToImage(point));
    return;
  }
  const isPan = event.button === 1 || state.spaceDown;
  dom.manualCanvas.setPointerCapture(event.pointerId);
  if (isPan) {
    state.pointer = {
      kind: "pan",
      id: event.pointerId,
      startX: point.x,
      startY: point.y,
      panX: state.view.panX,
      panY: state.view.panY,
    };
    return;
  }

  const imagePoint = screenToImage(point);
  const hit = hitTestParticle(imagePoint);
  if (hit && (!state.working || hit.id !== state.workingId || hit.draft !== state.isDraft)) {
    if (hit.draft) return;
    selectSavedParticle(hit.id);
  }
  if (!state.working) return;
  const workingProjection = projectModel(state.working);
  if (!pointInPolygon(imagePoint, workingProjection.silhouette)) return;
  state.pointer = {
    kind: "model",
    id: event.pointerId,
    tool: dragToolForModifiers(event.shiftKey, event.altKey),
    rotationAxis: state.rotationAxisLock,
    startX: point.x,
    startY: point.y,
    startTranslation: [...state.working.translation_xy_px],
    startQuaternion: [...state.working.quaternion_xyzw],
    centerCanvas: imageToScreen(state.working.translation_xy_px),
    startPointerAngle: Math.atan2(
      point.y - imageToScreen(state.working.translation_xy_px).y,
      point.x - imageToScreen(state.working.translation_xy_px).x,
    ),
  };
  dom.manualCanvas.classList.add("is-dragging");
}

function onPointerMove(event) {
  const point = canvasPoint(event);
  if (state.image) {
    const imagePoint = screenToImage(point);
    dom.cursorCoordinate.textContent = `画像座標：${formatted(imagePoint.x, 1)}, ${formatted(imagePoint.y, 1)} px`;
  }
  const pointer = state.pointer;
  if (!pointer || pointer.id !== event.pointerId) return;
  const dx = point.x - pointer.startX;
  const dy = point.y - pointer.startY;
  if (pointer.kind === "pan") {
    state.view.panX = pointer.panX + dx;
    state.view.panY = pointer.panY + dy;
    requestDraw();
    return;
  }
  if (!state.working) return;
  if (pointer.tool === "move") {
    const viewScale = currentViewScale();
    state.working.translation_xy_px = [
      pointer.startTranslation[0] + dx / viewScale,
      pointer.startTranslation[1] + dy / viewScale,
    ];
  } else if (pointer.tool === "rotate") {
    if (pointer.rotationAxis) {
      const localRotation = axisConstrainedDragQuaternion(
        pointer.rotationAxis,
        dx,
        dy,
        ROTATION_RADIANS_PER_PIXEL,
      );
      state.working.quaternion_xyzw = quaternionMultiply(
        pointer.startQuaternion,
        localRotation,
      );
    } else {
      const dragRotation = dragRotationQuaternion(
        dx,
        dy,
        ROTATION_RADIANS_PER_PIXEL,
      );
      state.working.quaternion_xyzw = quaternionMultiply(
        dragRotation,
        pointer.startQuaternion,
      );
    }
  } else if (pointer.tool === "roll") {
    const currentAngle = Math.atan2(
      point.y - pointer.centerCanvas.y,
      point.x - pointer.centerCanvas.x,
    );
    const roll = quaternionFromAxisAngle(
      [0, 0, 1],
      currentAngle - pointer.startPointerAngle,
    );
    state.working.quaternion_xyzw = quaternionMultiply(
      roll,
      pointer.startQuaternion,
    );
  }
  state.dirty = true;
  renderInspector();
  requestDraw();
}

function onPointerUp(event) {
  if (!state.pointer || state.pointer.id !== event.pointerId) return;
  state.pointer = null;
  dom.manualCanvas.classList.remove("is-dragging");
  try { dom.manualCanvas.releasePointerCapture(event.pointerId); } catch (_error) { /* no-op */ }
}

function onWheel(event) {
  if (!state.image) return;
  event.preventDefault();
  const interaction = wheelInteraction(
    event.deltaX,
    event.deltaY,
    event.shiftKey || event.ctrlKey || event.metaKey,
    Boolean(state.working),
  );
  const factor = wheelScaleFactor(
    interaction.delta,
    event.deltaMode,
    state.canvasMetrics?.height || 800,
  );
  if (interaction.target === "model" && state.working) {
    const maximumScale = 2 * Math.max(
      Number(state.session?.image?.width || 1),
      Number(state.session?.image?.height || 1),
    );
    state.working.scale_px = clamp(
      state.working.scale_px * factor,
      1,
      maximumScale,
    );
    markDirtyAndRender();
    return;
  }
  zoomAtPoint(factor, canvasPoint(event));
}

function onKeyDown(event) {
  const textInput = isTextInput(event.target);
  const shortcutAction = actionForShortcut(event);
  if (shortcutAction === "copy-particle" && !textInput) {
    event.preventDefault();
    copySelectedParticle();
    return;
  }
  if (shortcutAction === "paste-particle" && !textInput) {
    event.preventDefault();
    pasteCopiedParticle();
    return;
  }
  if (shortcutAction === "delete-particle" && !textInput && !dom.tiffDialog.open) {
    event.preventDefault();
    if (state.workingId && !state.isDraft) deleteWorkingParticle();
    else toast("削除する登録済み粒子を選択してください。", true);
    return;
  }
  if (shortcutAction === "commit") {
    event.preventDefault();
    if (state.working) commitWorkingParticle();
    return;
  }
  if (shortcutAction === "new-particle" && !textInput && !dom.tiffDialog.open) {
    event.preventDefault();
    startDraft();
    return;
  }
  const rotationAxis = !textInput ? rotationAxisForShortcut(event) : null;
  if (rotationAxis && state.working && !dom.tiffDialog.open) {
    event.preventDefault();
    setRotationAxisLock(rotationAxis);
    return;
  }
  if (event.key === " " && !isTextInput(event.target)) {
    state.spaceDown = true;
    event.preventDefault();
  }
  if (event.key === "Escape") {
    if (state.shortcutsOpen) {
      event.preventDefault();
      setShortcutPanelOpen(false);
      return;
    }
    cancelWorkingParticle();
  }
  if ((event.key === "Enter" || event.key === "Return") && (event.metaKey || event.ctrlKey)) {
    commitWorkingParticle();
  }
  if (!state.working || textInput) return;
  const step = event.shiftKey ? 10 : 1;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "ArrowLeft") state.working.translation_xy_px[0] -= step;
    if (event.key === "ArrowRight") state.working.translation_xy_px[0] += step;
    if (event.key === "ArrowUp") state.working.translation_xy_px[1] -= step;
    if (event.key === "ArrowDown") state.working.translation_xy_px[1] += step;
    markDirtyAndRender();
  }
}

function onKeyUp(event) {
  if (event.key === " ") state.spaceDown = false;
  const releasedAxis = String(event.key || "").toLowerCase();
  if (releasedAxis === state.rotationAxisLock) clearRotationAxisLock();
}

function setRotationAxisLock(axis) {
  state.rotationAxisLock = axis;
  dom.manualCanvas.dataset.rotationAxis = axis;
  dom.interactionHelp.textContent = `${axis.toUpperCase()}軸回転を固定中です。${axis.toUpperCase()}を押したまま図形をドラッグしてください。`;
  requestDraw();
}

function clearRotationAxisLock() {
  if (!state.rotationAxisLock) return;
  state.rotationAxisLock = null;
  delete dom.manualCanvas.dataset.rotationAxis;
  if (!state.isPlacing) dom.interactionHelp.textContent = INTERACTION_HELP_TEXT;
  requestDraw();
}

function isTextInput(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function canvasPoint(event) {
  const rect = dom.manualCanvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function resizeCanvas() {
  const previousScale = state.canvasMetrics && state.image
    ? currentViewScale()
    : null;
  const rect = dom.manualCanvasShell.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (dom.manualCanvas.width !== width || dom.manualCanvas.height !== height) {
    dom.manualCanvas.width = width;
    dom.manualCanvas.height = height;
    dom.manualCanvas.style.width = `${rect.width}px`;
    dom.manualCanvas.style.height = `${rect.height}px`;
  }
  state.canvasMetrics = { width: rect.width, height: rect.height, dpr };
  if (state.image) {
    const fitScale = baseFitScale();
    if (state.view.mode === "fit") state.view.zoom = 1;
    else if (state.view.mode === "actual") state.view.zoom = relativeZoomForActualPixels(fitScale);
    else if (previousScale !== null) state.view.zoom = previousScale / fitScale;
    updateZoomReadout();
  }
  requestDraw();
}

function fitImageToCanvas() {
  if (!state.canvasMetrics) resizeCanvas();
  state.view.mode = "fit";
  state.view.zoom = 1;
  state.view.panX = 0;
  state.view.panY = 0;
  updateZoomReadout();
  requestDraw();
}

function showActualPixels() {
  if (!state.canvasMetrics) resizeCanvas();
  if (!state.canvasMetrics || !state.image) return;
  state.view.mode = "actual";
  state.view.zoom = relativeZoomForActualPixels(baseFitScale());
  state.view.panX = 0;
  state.view.panY = 0;
  updateZoomReadout();
  requestDraw();
}

function baseFitScale() {
  if (!state.canvasMetrics || !state.image) return 1;
  return Math.min(
    state.canvasMetrics.width / state.image.naturalWidth,
    state.canvasMetrics.height / state.image.naturalHeight,
  );
}

function currentViewScale() {
  return baseFitScale() * state.view.zoom;
}

function imageOrigin() {
  const scale = currentViewScale();
  let x = (state.canvasMetrics.width - state.image.naturalWidth * scale) / 2 + state.view.panX;
  let y = (state.canvasMetrics.height - state.image.naturalHeight * scale) / 2 + state.view.panY;
  if (Math.abs(scale - 1) < 1e-9) {
    const dpr = state.canvasMetrics.dpr || 1;
    x = Math.round(x * dpr) / dpr;
    y = Math.round(y * dpr) / dpr;
  }
  return { x, y };
}

function imageToScreen(point) {
  const origin = imageOrigin();
  const scale = currentViewScale();
  return { x: origin.x + point[0] * scale, y: origin.y + point[1] * scale };
}

function screenToImage(point) {
  const origin = imageOrigin();
  const scale = currentViewScale();
  return { x: (point.x - origin.x) / scale, y: (point.y - origin.y) / scale };
}

function viewportCenterInImage() {
  if (!state.canvasMetrics || !state.image) {
    return [state.session?.image?.width / 2 || 0, state.session?.image?.height / 2 || 0];
  }
  const result = screenToImage({ x: state.canvasMetrics.width / 2, y: state.canvasMetrics.height / 2 });
  return [result.x, result.y];
}

function zoomAtCanvasCenter(factor) {
  if (!state.canvasMetrics) return;
  zoomAtPoint(factor, { x: state.canvasMetrics.width / 2, y: state.canvasMetrics.height / 2 });
}

function zoomAtPoint(factor, point) {
  const before = screenToImage(point);
  state.view.zoom = clamp(state.view.zoom * factor, 0.5, 20);
  state.view.mode = "custom";
  const after = imageToScreen([before.x, before.y]);
  state.view.panX += point.x - after.x;
  state.view.panY += point.y - after.y;
  updateZoomReadout();
  requestDraw();
}

function updateZoomReadout() {
  if (!state.image || !state.canvasMetrics) {
    dom.zoomReadout.textContent = "—";
    return;
  }
  const percent = Math.round(currentViewScale() * 100);
  const suffix = state.view.mode === "actual"
    ? " · 原寸"
    : (state.view.mode === "fit" ? " · 全体" : "");
  dom.zoomReadout.textContent = `${percent}%${suffix}`;
}

function requestDraw() {
  if (state.drawPending) return;
  state.drawPending = true;
  requestAnimationFrame(() => {
    state.drawPending = false;
    drawCanvas();
  });
}

function drawCanvas() {
  if (!state.canvasMetrics) resizeCanvas();
  if (!state.canvasMetrics) return;
  const { width, height, dpr } = state.canvasMetrics;
  const ctx = dom.ctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#111917";
  ctx.fillRect(0, 0, width, height);
  if (!state.image) return;
  const origin = imageOrigin();
  const scale = currentViewScale();
  // Downsampling needs high-quality filtering.  At original size or above,
  // interpolation would blur the exact TIFF pixels, so it is disabled.
  const smoothImage = shouldSmoothImage(scale);
  ctx.imageSmoothingEnabled = smoothImage;
  if (smoothImage) ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    state.image,
    origin.x,
    origin.y,
    state.image.naturalWidth * scale,
    state.image.naturalHeight * scale,
  );
  drawScaleBarDetection(ctx);
  const particles = state.session?.particles || [];
  for (const particle of particles) {
    if (!state.isDraft && state.workingId === particle.id) continue;
    drawParticle(ctx, particle, false);
  }
  if (state.working) drawParticle(ctx, state.working, true);
  if (state.showParticleNumbers) {
    particles.forEach((particle, index) => {
      const selected = !state.isDraft && state.workingId === particle.id;
      const displayedParticle = selected && state.working ? state.working : particle;
      drawParticleNumberLabel(
        ctx,
        displayedParticle,
        particleNumberLabel(particle.id, index + 1),
        selected,
      );
    });
  }
  drawOrientationGizmo(ctx);
}

function drawScaleBarDetection(ctx) {
  const bounds = state.session?.calibration?.scale_bar_bounds_px;
  if (!bounds) return;
  const start = imageToScreen([bounds.x_start, bounds.y_start]);
  const end = imageToScreen([bounds.x_end, bounds.y_end]);
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  ctx.save();
  ctx.strokeStyle = "rgba(255, 210, 94, 0.9)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  // Keep the full 1 px stroke inside the detected outer-edge bounds.  A
  // stroke centred directly on the boundary protrudes by 0.5 px per side and
  // makes the box appear one pixel too large.
  ctx.strokeRect(
    left + 0.5,
    top + 0.5,
    Math.max(0, width - 1),
    Math.max(0, height - 1),
  );
  ctx.restore();
}

function drawParticle(ctx, particle, selected) {
  const projection = projectModel(particle);
  const shapeColor = SHAPE_COLORS[particle.shape] || SHAPE_COLORS.rhombic_dodecahedron;
  const shapeRgb = shapeColor.rgb;
  const viewScale = currentViewScale();
  ctx.save();
  const excluded = !Boolean(particle.included_in_statistics ?? true);
  if (excluded && !selected) ctx.globalAlpha = 0.48;
  const faces = [...projection.visibleFaces].sort((a, b) => b.depth - a.depth);
  for (const face of faces) {
    const facing = clamp(face.facing, 0, 1);
    const alpha = selected ? 0.18 + 0.14 * facing : 0.09 + 0.08 * facing;
    drawPolygonPath(ctx, face.points);
    ctx.fillStyle = `rgba(${shapeRgb[0]}, ${shapeRgb[1]}, ${shapeRgb[2]}, ${alpha})`;
    ctx.fill();
  }
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = selected ? 1.65 : 1.05;
  ctx.strokeStyle = selected
    ? "rgba(255, 210, 94, 0.96)"
    : `rgba(${shapeRgb[0]}, ${shapeRgb[1]}, ${shapeRgb[2]}, 0.72)`;
  for (const edge of projection.visibleEdges) {
    const p0 = imageToScreen(edge.points[0]);
    const p1 = imageToScreen(edge.points[1]);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  drawPolygonPath(ctx, projection.silhouette);
  ctx.lineWidth = selected ? 2.2 : 1.4;
  ctx.strokeStyle = selected
    ? "#ffd25e"
    : `rgba(${shapeRgb[0]}, ${shapeRgb[1]}, ${shapeRgb[2]}, 0.9)`;
  if (excluded) ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (selected) {
    const center = imageToScreen(particle.translation_xy_px);
    ctx.fillStyle = "#ffd25e";
    ctx.beginPath();
    ctx.arc(center.x, center.y, clamp(3.2 * Math.sqrt(viewScale), 3, 6), 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "rgba(16, 24, 22, 0.9)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawParticleNumberLabel(ctx, particle, label, selected) {
  const center = imageToScreen(particle.translation_xy_px);
  const canvasWidth = state.canvasMetrics?.width || 0;
  const canvasHeight = state.canvasMetrics?.height || 0;
  if (center.x < 0 || center.x > canvasWidth || center.y < 0 || center.y > canvasHeight) return;

  ctx.save();
  ctx.font = "700 11px -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const text = String(label);
  const badgeHeight = 18;
  const badgeWidth = Math.max(18, Math.ceil(ctx.measureText(text).width) + 10);
  const left = center.x - badgeWidth / 2;
  const top = center.y - badgeHeight / 2;
  roundedRectPath(ctx, left, top, badgeWidth, badgeHeight, 5);
  const shapeColor = SHAPE_COLORS[particle.shape] || SHAPE_COLORS.rhombic_dodecahedron;
  ctx.fillStyle = selected
    ? "rgba(255, 210, 94, 0.96)"
    : `rgba(${shapeColor.rgb[0]}, ${shapeColor.rgb[1]}, ${shapeColor.rgb[2]}, 0.94)`;
  ctx.fill();
  ctx.strokeStyle = selected ? "rgba(16, 24, 22, 0.9)" : "rgba(16, 24, 22, 0.78)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = selected ? "#101816" : shapeColor.labelText;
  ctx.fillText(text, center.x, center.y + 0.25);
  ctx.restore();
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawOrientationGizmo(ctx) {
  const canvasWidth = state.canvasMetrics?.width || 0;
  const canvasHeight = state.canvasMetrics?.height || 0;
  if (canvasWidth < 96 || canvasHeight < 96) return;
  const size = 82;
  const left = canvasWidth - size - 10;
  const top = state.shortcutsOpen ? 10 : canvasHeight - size - 10;
  const origin = { x: left + size / 2, y: top + size / 2 + 5 };
  const quaternion = state.working?.quaternion_xyzw || [0, 0, 0, 1];
  const axes = [
    { name: "X", vector: rotateVector(quaternion, [1, 0, 0]), color: "#ff6b6b" },
    { name: "Y", vector: rotateVector(quaternion, [0, 1, 0]), color: "#58d68d" },
    { name: "Z", vector: rotateVector(quaternion, [0, 0, 1]), color: "#5dade2" },
  ].sort((a, b) => a.vector[2] - b.vector[2]);

  ctx.save();
  roundedRectPath(ctx, left, top, size, size, 12);
  ctx.fillStyle = "rgba(9, 15, 14, 0.78)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.24)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
  ctx.font = "700 8px -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("MODEL AXES", origin.x, top + 10);

  const axisLength = 25;
  for (const axis of axes) {
    const end = {
      x: origin.x + axis.vector[0] * axisLength,
      y: origin.y + axis.vector[1] * axisLength,
    };
    const projectedLength = Math.hypot(end.x - origin.x, end.y - origin.y);
    const active = state.rotationAxisLock === axis.name.toLowerCase();
    ctx.strokeStyle = axis.color;
    ctx.fillStyle = axis.color;
    ctx.lineWidth = active ? 3.6 : 2.2;
    ctx.globalAlpha = axis.vector[2] > 0 ? 0.72 : 1;
    if (projectedLength < 4) {
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, active ? 7 : 5.5, 0, 2 * Math.PI);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      const angle = Math.atan2(end.y - origin.y, end.x - origin.x);
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - 7 * Math.cos(angle - 0.45), end.y - 7 * Math.sin(angle - 0.45));
      ctx.lineTo(end.x - 7 * Math.cos(angle + 0.45), end.y - 7 * Math.sin(angle + 0.45));
      ctx.closePath();
      ctx.fill();
    }
    const labelDistance = Math.max(projectedLength + 9, 10);
    const labelAngle = projectedLength < 4
      ? ({ X: -2.35, Y: -0.8, Z: 0.15 }[axis.name])
      : Math.atan2(end.y - origin.y, end.x - origin.x);
    ctx.globalAlpha = 1;
    ctx.fillStyle = axis.color;
    ctx.font = `${active ? "800" : "700"} 10px -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif`;
    ctx.fillText(
      axis.name,
      origin.x + Math.cos(labelAngle) * labelDistance,
      origin.y + Math.sin(labelAngle) * labelDistance,
    );
  }
  ctx.restore();
}

function drawPolygonPath(ctx, points) {
  if (!points?.length) return;
  const first = imageToScreen(points[0]);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = imageToScreen(points[index]);
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
}

function projectModel(particle) {
  const hKey = Number(particle.h ?? 0.5).toFixed(2);
  const mesh = particle.shape === "chamfered_cube"
    ? (state.chamferedMeshes[hKey] || state.meshes.chamfered_cube)
    : state.meshes[particle.shape];
  if (!mesh) return { silhouette: [], visibleFaces: [], visibleEdges: [] };
  const rotatedVertices = mesh.vertices.map((vertex) => rotateVector(particle.quaternion_xyzw, vertex));
  const points = rotatedVertices.map((vertex) => [
    vertex[0] * particle.scale_px + particle.translation_xy_px[0],
    vertex[1] * particle.scale_px + particle.translation_xy_px[1],
  ]);
  const faceByIndex = new Map();
  const visibleFaces = [];
  for (const face of mesh.faces) {
    const normal = rotateVector(particle.quaternion_xyzw, face.normal);
    const facing = -normal[2];
    const record = {
      ...face,
      facing,
      visible: facing > 1e-10,
      points: face.vertex_indices.map((index) => points[index]),
      depth: face.vertex_indices.reduce((sum, index) => sum + rotatedVertices[index][2], 0) / face.vertex_indices.length,
    };
    faceByIndex.set(face.face_index, record);
    if (record.visible) visibleFaces.push(record);
  }
  const visibleEdges = mesh.edges.filter((edge) =>
    edge.adjacent_face_indices.some((index) => faceByIndex.get(index)?.visible),
  ).map((edge) => ({
    ...edge,
    points: edge.vertex_indices.map((index) => points[index]),
  }));
  return {
    silhouette: convexHull(points),
    visibleFaces,
    visibleEdges,
  };
}

function calculateLocalMetrics(particle) {
  const projection = projectModel(particle);
  const areaPx2 = polygonArea(projection.silhouette);
  const pixelSize = Number(state.session?.calibration?.pixel_size_nm_per_px || 0);
  const areaNm2 = areaPx2 * pixelSize * pixelSize;
  const radiusNm = areaNm2 > 0 ? Math.sqrt(areaNm2 / Math.PI) : 0;
  const width = Number(state.session?.image?.width || 0);
  const height = Number(state.session?.image?.height || 0);
  const validHeight = Number(state.session?.image?.footer?.y_start ?? height);
  const clipped = clipPolygonToRect(projection.silhouette, 0, 0, width, validHeight);
  const validSemFraction = areaPx2 > 0 ? clamp(polygonArea(clipped) / areaPx2, 0, 1) : 0;
  const xs = projection.silhouette.map((point) => point[0]);
  const ys = projection.silhouette.map((point) => point[1]);
  const qualityFlags = [];
  if (Math.min(...xs) < 0 || Math.min(...ys) < 0 || Math.max(...xs) > width || Math.max(...ys) > height) {
    qualityFlags.push("touches_image_boundary");
  }
  if (Math.max(...ys) > validHeight) qualityFlags.push("overlaps_instrument_footer");
  if (validSemFraction < 0.999) qualityFlags.push("partly_outside_valid_sem_region");
  return {
    areaPx2,
    areaNm2,
    radiusNm,
    diameterNm: 2 * radiusNm,
    validSemFraction,
    qualityFlags,
  };
}

function qualityFlagLabel(flag) {
  const labels = {
    touches_image_boundary: "画像境界に接触",
    overlaps_instrument_footer: "装置情報footerと重複",
    partly_outside_valid_sem_region: "モデルの一部が有効SEM領域外",
  };
  return labels[flag] || flag;
}

function hitTestParticle(imagePoint) {
  if (state.working && pointInPolygon(imagePoint, projectModel(state.working).silhouette)) {
    return { id: state.workingId, draft: state.isDraft };
  }
  const particles = [...(state.session?.particles || [])].reverse();
  for (const particle of particles) {
    if (!state.isDraft && state.workingId === particle.id) continue;
    if (pointInPolygon(imagePoint, projectModel(particle).silhouette)) {
      return { id: particle.id, draft: false };
    }
  }
  return null;
}

function formatted(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number)) : String(fallback);
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message, isError = false) {
  const item = document.createElement("div");
  item.className = `manual-toast${isError ? " is-error" : ""}`;
  item.textContent = message;
  dom.toastRegion.appendChild(item);
  window.setTimeout(() => item.remove(), isError ? 5200 : 3200);
}

window.ManualApp = Object.freeze({ start: startManualApp });

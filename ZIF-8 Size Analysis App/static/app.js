(() => {
  "use strict";

  const state = { csrfToken: "", inspection: null, downloadUrl: "", busy: false };
  const $ = (selector) => document.querySelector(selector);

  function setStatus(selector, message, kind = "") {
    const node = $(selector);
    node.textContent = message;
    node.className = `status ${kind}`.trim();
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
  }

  function showLogin() {
    $("#loginView").hidden = false;
    $("#appView").hidden = true;
    $("#userArea").hidden = true;
  }

  function showApp(session) {
    state.csrfToken = session.csrf_token;
    $("#loginView").hidden = true;
    $("#appView").hidden = false;
    $("#userArea").hidden = false;
    $("#userEmail").textContent = session.email;
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(options.method && options.method !== "GET" && state.csrfToken
          ? { "X-CSRF-Token": state.csrfToken }
          : {}),
      },
    });
    let payload = null;
    try { payload = await response.json(); } catch (_) { payload = {}; }
    if (response.status === 401) {
      showLogin();
      throw new Error(payload.error || "認証が必要です。");
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `サーバーエラー（${response.status}）`);
    }
    return payload;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unit = units[0];
    for (let index = 1; index < units.length && value >= 1024; index += 1) {
      value /= 1024;
      unit = units[index];
    }
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderInventory(inventory) {
    const items = [
      ["file_count", "ファイル"],
      ["tiff_count", "TIFF"],
      ["txt_count", "TXT"],
      ["jpeg_count", "JPEG"],
      ["csv_count", "CSV"],
      ["json_count", "JSON"],
      ["session_count", "解析対象JSON"],
    ];
    $("#inventoryGrid").innerHTML = items.map(([key, label]) => (
      `<div class="inventory-item"><strong>${inventory[key] ?? 0}</strong><span>${label}</span></div>`
    )).join("");
    setStatus(
      "#inventoryStatus",
      `${formatBytes(inventory.total_bytes)}を読み込みました。解析対象JSONは${inventory.session_count}件です。`,
      inventory.session_count ? "success" : "error",
    );
    $("#analyseButton").disabled = !inventory.session_count;
  }

  async function inspectFolder(files) {
    if (!files.length || state.busy) return;
    state.busy = true;
    state.inspection = null;
    $("#inventoryCard").hidden = true;
    $("#resultCard").hidden = true;
    $("#analyseButton").disabled = true;
    setStatus("#selectionStatus", `${files.length}件をブラウザー内で読み込んでいます…`);
    try {
      state.inspection = await window.Zif8LocalAnalysis.inspect(files);
      renderInventory(state.inspection.inventory);
      $("#inventoryCard").hidden = false;
      setStatus("#selectionStatus", "フォルダを読み込みました。ファイルはサーバーへ送信されていません。内容を確認して解析を開始してください。", "success");
      showToast("ローカルフォルダの読み込みが完了しました。");
    } catch (error) {
      setStatus("#selectionStatus", error.message, "error");
    } finally {
      state.busy = false;
    }
  }

  function displayValue(value, suffix = "") {
    return value === "" || value === null || value === undefined ? "—" : `${value}${suffix}`;
  }

  function renderReport(report) {
    $("#resultTableBody").innerHTML = report.rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.Shape)}</td>
        <td>${displayValue(row["Average diameter (nm)"], " nm")}</td>
        <td>${displayValue(row["standard deviation (nm)"], " nm")}</td>
        <td>${displayValue(row["CV (%)"], " %")}</td>
        <td>${row.Counts}</td>
      </tr>
    `).join("");
    $("#resultSummary").textContent = `${report.session_count}件のJSON，${report.particle_count}個の統計対象粒子を集計しました。標準偏差は母標準偏差（ddof=0）です。`;
    $("#usedFiles").innerHTML = report.used_files.map((path) => `<li>${escapeHtml(path)}</li>`).join("");
    const download = $("#downloadButton");
    if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
    state.downloadUrl = URL.createObjectURL(
      new Blob([`\uFEFF${report.csv}`], { type: "text/csv;charset=utf-8" }),
    );
    download.href = state.downloadUrl;
    download.download = "shape_statistics_by_shape.csv";
    download.hidden = false;
    $("#resultCard").hidden = false;
    $("#resultCard").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function analyse() {
    if (!state.inspection || state.busy) return;
    state.busy = true;
    const button = $("#analyseButton");
    button.disabled = true;
    button.textContent = "解析中…";
    setStatus("#inventoryStatus", "JSONセッションをブラウザー内で検証し，形状別に集計しています…");
    try {
      const report = window.Zif8LocalAnalysis.analyse(state.inspection, false);
      renderReport(report);
      setStatus("#inventoryStatus", "解析が完了しました。結果CSVは使用者のローカルへ保存できます。", "success");
      showToast("解析が完了しました。");
    } catch (error) {
      setStatus("#inventoryStatus", error.message, "error");
    } finally {
      state.busy = false;
      button.disabled = false;
      button.textContent = "解析開始";
    }
  }

  async function start() {
    try {
      const session = await requestJson("/api/session");
      showApp(session);
    } catch (_) {
      showLogin();
    }
  }

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("#loginStatus", "認証しています…");
    try {
      const payload = await requestJson("/login", { method: "POST", body: new FormData(event.currentTarget) });
      const session = await requestJson("/api/session");
      showApp(session);
      event.currentTarget.reset();
      showToast(payload.ok ? "ログインしました。" : "ログインしました。");
    } catch (error) {
      setStatus("#loginStatus", error.message, "error");
    }
  });

  $("#folderInput").addEventListener("change", (event) => inspectFolder(Array.from(event.target.files || [])));
  $("#analyseButton").addEventListener("click", analyse);
  $("#logoutButton").addEventListener("click", async () => {
    try { await requestJson("/logout", { method: "POST" }); } catch (_) { /* continue to login */ }
    state.csrfToken = "";
    state.inspection = null;
    if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
    state.downloadUrl = "";
    showLogin();
  });
  start();
})();

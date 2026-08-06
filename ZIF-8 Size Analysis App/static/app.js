(() => {
  "use strict";

  const state = { csrfToken: "" };
  const $ = (selector) => document.querySelector(selector);

  function setLoginStatus(message, kind = "") {
    const node = $("#loginStatus");
    node.textContent = message;
    node.className = `auth-status ${kind}`.trim();
  }

  function showLogin() {
    $("#loginView").hidden = false;
    $("#appView").hidden = true;
  }

  function showApp(session) {
    state.csrfToken = session.csrf_token || "";
    $("#loginView").hidden = true;
    $("#appView").hidden = false;
    $("#userEmail").textContent = session.email || "";
    if (window.ManualApp) window.ManualApp.start(session);
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
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* preserve status */ }
    if (response.status === 401) {
      showLogin();
      throw new Error(payload.error || "認証が必要です。");
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `サーバーエラー（${response.status}）`);
    }
    return payload;
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
    const form = event.currentTarget;
    setLoginStatus("認証しています…");
    try {
      await requestJson("/login", {
        method: "POST",
        body: new FormData(form),
      });
      const session = await requestJson("/api/session");
      form.reset();
      showApp(session);
    } catch (error) {
      setLoginStatus(error.message, "is-error");
    }
  });

  $("#logoutButton").addEventListener("click", async () => {
    try { await requestJson("/logout", { method: "POST" }); } catch (_) { /* continue */ }
    window.location.reload();
  });

  start();
})();

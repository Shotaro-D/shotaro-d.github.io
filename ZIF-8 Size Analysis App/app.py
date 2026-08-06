#!/usr/bin/env python3
"""Authentication-only server for the browser-local ZIF-8 SEM analysis app."""

from __future__ import annotations

from datetime import datetime, timedelta
import json
import logging
import os
from pathlib import Path
import secrets
import time
from typing import Any
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash

JST = ZoneInfo("Asia/Tokyo")
LOGIN_FAILURE_WINDOW_SECONDS = 10 * 60
LOGIN_FAILURE_LIMIT = 5
SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self'; "
        "img-src 'self' data: blob:; "
        "connect-src 'self'; "
        "font-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    ),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}


def today_jst() -> str:
    return datetime.now(JST).date().isoformat()


def _json_env(name: str, default: Any) -> Any:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{name} must contain valid JSON") from exc


def _trusted_proxy_count(app_env: str) -> int:
    """Return the explicitly trusted number of reverse proxies.

    Render forwards the client address to production services.  Keep local
    development unwrapped so an arbitrary X-Forwarded-For header cannot alter
    request.remote_addr there.
    """

    default = "1" if app_env == "production" else "0"
    raw = os.environ.get("APP_TRUSTED_PROXY_COUNT", default).strip()
    try:
        count = int(raw)
    except ValueError as exc:
        raise RuntimeError("APP_TRUSTED_PROXY_COUNT must be a non-negative integer") from exc
    if count < 0:
        raise RuntimeError("APP_TRUSTED_PROXY_COUNT must be a non-negative integer")
    return count


def _login_value(field: str) -> str:
    """Read one login field without relying on conditional-expression precedence."""

    if request.is_json:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return ""
        value = payload.get(field, "")
    else:
        value = request.form.get(field, "")
    return "" if value is None else str(value)


def load_users(instance_root: Path) -> dict[str, str]:
    """Load email -> Werkzeug password hash without storing credentials in Git."""

    raw_users = os.environ.get("APP_USERS_JSON", "").strip()
    if raw_users:
        payload = _json_env("APP_USERS_JSON", {})
    else:
        user_file = Path(os.environ.get("APP_USERS_FILE", instance_root / "users.json"))
        if not user_file.is_file():
            return {}
        try:
            payload = json.loads(user_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"Could not read user file: {user_file}") from exc

    if not isinstance(payload, dict):
        raise RuntimeError("User configuration must be a JSON object")
    users: dict[str, str] = {}
    for email, password_hash in payload.items():
        normalised_email = str(email).strip().casefold()
        if normalised_email and isinstance(password_hash, str) and password_hash:
            users[normalised_email] = password_hash
    return users


def _is_api_request() -> bool:
    return request.path.startswith("/api/") or request.path in {"/login", "/logout"}


def _json_error(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    project_root = Path(__file__).resolve().parent
    instance_root = Path(os.environ.get("APP_INSTANCE_DIR", project_root / "instance")).resolve()
    instance_root.mkdir(parents=True, exist_ok=True)

    secret_key = os.environ.get("APP_SECRET_KEY", "")
    app_env = os.environ.get("APP_ENV", "development")
    if app_env == "production" and not secret_key:
        raise RuntimeError("APP_SECRET_KEY must be set in production")
    app = Flask(__name__, instance_path=str(instance_root), instance_relative_config=True)
    app.config.from_mapping(
        SECRET_KEY=secret_key or "local-development-secret-change-me",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=app_env == "production",
        # Authentication is enforced by auth_day.  This fixed upper bound keeps
        # the signed cookie short-lived without mutating shared app config from
        # a request handler.
        PERMANENT_SESSION_LIFETIME=timedelta(days=1),
        TRUSTED_PROXY_COUNT=_trusted_proxy_count(app_env),
        JSON_SORT_KEYS=False,
        INSTANCE_ROOT=instance_root,
    )
    if test_config:
        app.config.update(test_config)

    trusted_proxy_count = app.config["TRUSTED_PROXY_COUNT"]
    if not isinstance(trusted_proxy_count, int) or trusted_proxy_count < 0:
        raise RuntimeError("TRUSTED_PROXY_COUNT must be a non-negative integer")
    if trusted_proxy_count:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=trusted_proxy_count)

    login_failures: dict[str, list[float]] = {}

    def prune_login_failures(now: float) -> None:
        """Bound in-memory limiter state while retaining only the active window."""

        for client_ip, timestamps in list(login_failures.items()):
            current = [stamp for stamp in timestamps if now - stamp < LOGIN_FAILURE_WINDOW_SECONDS]
            if current:
                login_failures[client_ip] = current
            else:
                del login_failures[client_ip]

    def login_client_ip() -> str:
        return request.remote_addr or "unknown"

    def current_users() -> dict[str, str]:
        return load_users(instance_root)

    def authenticated() -> bool:
        return (
            bool(session.get("user_email"))
            and bool(session.get("csrf_token"))
            and session.get("auth_day") == today_jst()
        )

    def csrf_valid() -> bool:
        expected = session.get("csrf_token")
        supplied = request.headers.get("X-CSRF-Token", "")
        return bool(expected and secrets.compare_digest(str(expected), supplied))

    @app.before_request
    def protect_request():
        if request.endpoint in {"static", "login", "login_post", "health"}:
            return None
        if not authenticated():
            session.clear()
            if _is_api_request():
                return _json_error("認証が必要です。", 401)
            return redirect(url_for("login"))
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and not csrf_valid():
            return _json_error("CSRFトークンが無効です。", 400)
        return None

    @app.after_request
    def add_security_headers(response):
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        return response

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/login")
    def login():
        return render_template("index.html")

    @app.post("/login")
    def login_post():
        email = _login_value("email").strip().casefold()
        password = _login_value("password")
        now = time.time()
        prune_login_failures(now)
        client_ip = login_client_ip()
        attempts = login_failures.setdefault(client_ip, [])
        if len(attempts) >= LOGIN_FAILURE_LIMIT:
            return _json_error("ログイン試行が多すぎます。10分後に再試行してください。", 429)

        password_hash = current_users().get(email)
        if not password_hash or not check_password_hash(password_hash, password):
            attempts.append(now)
            return _json_error("メールアドレスまたはパスワードが正しくありません。", 401)

        login_failures.pop(client_ip, None)
        session.clear()
        session.permanent = True
        session["user_email"] = email
        session["auth_day"] = today_jst()
        session["csrf_token"] = secrets.token_urlsafe(32)
        return jsonify({"ok": True, "redirect": url_for("index")})

    @app.post("/logout")
    def logout():
        session.clear()
        return jsonify({"ok": True})

    @app.get("/health")
    def health():
        return jsonify({"ok": True, "service": "zif8-size-analysis"})

    @app.get("/api/session")
    def session_info():
        return jsonify({
            "ok": True,
            "email": session.get("user_email", ""),
            "auth_day": session.get("auth_day", ""),
            "csrf_token": session.get("csrf_token", ""),
        })

    return app


app = create_app()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8795")))

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
from uuid import uuid4
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash

JST = ZoneInfo("Asia/Tokyo")


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
    if os.environ.get("APP_ENV", "development") == "production" and not secret_key:
        raise RuntimeError("APP_SECRET_KEY must be set in production")
    app = Flask(__name__, instance_path=str(instance_root), instance_relative_config=True)
    app.config.from_mapping(
        SECRET_KEY=secret_key or "local-development-secret-change-me",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("APP_ENV", "development") == "production",
        JSON_SORT_KEYS=False,
        INSTANCE_ROOT=instance_root,
    )
    if test_config:
        app.config.update(test_config)

    login_failures: dict[str, list[float]] = {}

    def current_users() -> dict[str, str]:
        return load_users(instance_root)

    def authenticated() -> bool:
        return bool(session.get("user_email")) and session.get("auth_day") == today_jst()

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

    @app.get("/")
    def index():
        return render_template("index.html", authenticated=authenticated())

    @app.get("/login")
    def login():
        return render_template("index.html", authenticated=False)

    @app.post("/login")
    def login_post():
        email = str(request.form.get("email") or request.json.get("email") if request.is_json else request.form.get("email") or "").strip().casefold()
        password = str(request.form.get("password") or request.json.get("password") if request.is_json else request.form.get("password") or "")
        now = time.time()
        attempts = [stamp for stamp in login_failures.get(request.remote_addr or "unknown", []) if now - stamp < 600]
        login_failures[request.remote_addr or "unknown"] = attempts
        if len(attempts) >= 5:
            return _json_error("ログイン試行が多すぎます。10分後に再試行してください。", 429)

        password_hash = current_users().get(email)
        if not password_hash or not check_password_hash(password_hash, password):
            attempts.append(now)
            return _json_error("メールアドレスまたはパスワードが正しくありません。", 401)

        session.clear()
        session.permanent = True
        session["user_email"] = email
        session["auth_day"] = today_jst()
        session["csrf_token"] = secrets.token_urlsafe(32)
        next_midnight = datetime.now(JST).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        app.permanent_session_lifetime = next_midnight - datetime.now(JST)
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
            "email": session["user_email"],
            "auth_day": session["auth_day"],
            "csrf_token": session["csrf_token"],
        })

    @app.get("/api/manual/meshes")
    def manual_meshes():
        """Return only the public, non-user-specific 3D model geometry."""

        mesh_path = project_root / "static" / "manual_meshes.json"
        try:
            payload = json.loads(mesh_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            app.logger.exception("Could not read static manual mesh geometry")
            return _json_error(f"3Dモデル情報を読み込めません：{exc}", 500)
        return jsonify(payload)

    return app


app = create_app()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8795")))

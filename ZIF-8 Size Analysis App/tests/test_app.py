import json
from datetime import timedelta
from pathlib import Path

import pytest
from werkzeug.security import generate_password_hash

from app import create_app, load_users


def make_client(monkeypatch, tmp_path: Path):
    monkeypatch.setenv(
        "APP_USERS_JSON",
        json.dumps({"boss@example.com": generate_password_hash("secret-password")}),
    )
    monkeypatch.setenv("APP_SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("APP_INSTANCE_DIR", str(tmp_path / "instance"))
    app = create_app({"TESTING": True, "SECRET_KEY": "test-secret-key"})
    return app.test_client()


def login(client):
    response = client.post(
        "/login",
        data={"email": "boss@example.com", "password": "secret-password"},
    )
    assert response.status_code == 200
    session_response = client.get("/api/session")
    assert session_response.status_code == 200
    return session_response.get_json()["csrf_token"]


def test_login_and_static_mesh_data_do_not_accept_user_files(monkeypatch, tmp_path: Path):
    client = make_client(monkeypatch, tmp_path)
    assert client.get("/api/session").status_code == 401

    csrf = login(client)
    mesh_response = client.get("/static/manual_meshes.json")
    assert mesh_response.status_code == 200
    payload = mesh_response.get_json()
    assert set(payload) == {"meshes", "chamfered_meshes"}
    assert {"rhombic_dodecahedron", "chamfered_cube", "cube"} <= set(payload["meshes"])

    upload_attempt = client.post(
        "/api/jobs",
        data={"files": "this endpoint must not exist"},
        headers={"X-CSRF-Token": csrf},
    )
    assert upload_attempt.status_code == 404
    assert not (tmp_path / "instance" / "jobs").exists()
    assert client.get("/api/manual/meshes").status_code == 404


def test_production_session_cookie_is_hardened(monkeypatch, tmp_path: Path):
    monkeypatch.setenv(
        "APP_USERS_JSON",
        json.dumps({"boss@example.com": generate_password_hash("secret-password")}),
    )
    monkeypatch.setenv("APP_SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("APP_INSTANCE_DIR", str(tmp_path / "instance"))
    client = create_app({"TESTING": True, "SECRET_KEY": "test-secret-key"}).test_client()
    response = client.post(
        "/login",
        data={"email": "boss@example.com", "password": "secret-password"},
    )
    cookie = response.headers["Set-Cookie"]
    assert "Secure" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=Lax" in cookie


def test_authentication_expires_when_jst_day_changes(monkeypatch, tmp_path: Path):
    client = make_client(monkeypatch, tmp_path)
    login(client)
    with client.session_transaction() as browser_session:
        browser_session["auth_day"] = "2000-01-01"
    assert client.get("/api/session").status_code == 401


def test_login_parses_form_and_json_without_none_string(monkeypatch, tmp_path: Path):
    form_client = make_client(monkeypatch, tmp_path)
    assert form_client.post(
        "/login",
        data={"email": "boss@example.com", "password": "secret-password"},
    ).status_code == 200

    json_client = make_client(monkeypatch, tmp_path)
    assert json_client.post(
        "/login",
        json={"email": "boss@example.com", "password": "secret-password"},
    ).status_code == 200

    malformed_json_client = make_client(monkeypatch, tmp_path)
    response = malformed_json_client.post("/login", data="null", content_type="application/json")
    assert response.status_code == 401
    assert response.get_json()["ok"] is False


def test_login_rate_limit_is_per_client_and_resets_after_success(monkeypatch, tmp_path: Path):
    client = make_client(monkeypatch, tmp_path)
    first_ip = {"REMOTE_ADDR": "198.51.100.10"}
    for _ in range(4):
        assert client.post(
            "/login",
            data={"email": "boss@example.com", "password": "incorrect"},
            environ_overrides=first_ip,
        ).status_code == 401
    assert client.post(
        "/login",
        data={"email": "boss@example.com", "password": "secret-password"},
        environ_overrides=first_ip,
    ).status_code == 200

    for _ in range(5):
        assert client.post(
            "/login",
            data={"email": "boss@example.com", "password": "incorrect"},
            environ_overrides=first_ip,
        ).status_code == 401
    assert client.post(
        "/login",
        data={"email": "boss@example.com", "password": "incorrect"},
        environ_overrides=first_ip,
    ).status_code == 429


def test_proxy_fix_uses_the_render_forwarded_client_address(monkeypatch, tmp_path: Path):
    monkeypatch.setenv(
        "APP_USERS_JSON",
        json.dumps({"boss@example.com": generate_password_hash("secret-password")}),
    )
    monkeypatch.setenv("APP_SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("APP_INSTANCE_DIR", str(tmp_path / "instance"))
    client = create_app({"TESTING": True, "SECRET_KEY": "test-secret-key"}).test_client()
    proxy_request = {"REMOTE_ADDR": "10.0.0.8", "HTTP_X_FORWARDED_FOR": "198.51.100.10"}
    for _ in range(5):
        assert client.post(
            "/login",
            data={"email": "boss@example.com", "password": "incorrect"},
            environ_overrides=proxy_request,
        ).status_code == 401
    other_client = {"REMOTE_ADDR": "10.0.0.8", "HTTP_X_FORWARDED_FOR": "198.51.100.11"}
    assert client.post(
        "/login",
        data={"email": "boss@example.com", "password": "incorrect"},
        environ_overrides=other_client,
    ).status_code == 401


def test_csrf_failure_and_stale_session_are_rejected(monkeypatch, tmp_path: Path):
    client = make_client(monkeypatch, tmp_path)
    csrf = login(client)
    assert client.post("/logout").status_code == 400
    assert client.post("/logout", headers={"X-CSRF-Token": csrf}).status_code == 200

    login(client)
    with client.session_transaction() as browser_session:
        browser_session.pop("csrf_token")
    assert client.get("/api/session").status_code == 401


def test_production_requires_a_secret_key(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("APP_SECRET_KEY", raising=False)
    monkeypatch.setenv("APP_INSTANCE_DIR", str(tmp_path / "instance"))
    with pytest.raises(RuntimeError, match="APP_SECRET_KEY must be set in production"):
        create_app({"TESTING": True})


def test_load_users_rejects_invalid_json(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("APP_USERS_JSON", raising=False)
    user_file = tmp_path / "users.json"
    user_file.write_text("{not valid json", encoding="utf-8")
    with pytest.raises(RuntimeError, match="Could not read user file"):
        load_users(tmp_path)


def test_security_headers_and_fixed_session_lifetime(monkeypatch, tmp_path: Path):
    monkeypatch.setenv(
        "APP_USERS_JSON",
        json.dumps({"boss@example.com": generate_password_hash("secret-password")}),
    )
    monkeypatch.setenv("APP_SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("APP_INSTANCE_DIR", str(tmp_path / "instance"))
    app = create_app({"TESTING": True, "SECRET_KEY": "test-secret-key"})
    client = app.test_client()
    assert app.permanent_session_lifetime == timedelta(days=1)
    response = client.get("/login")
    assert response.headers["Content-Security-Policy"] == (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; "
        "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    )
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["X-Frame-Options"] == "DENY"
    login(client)
    assert app.permanent_session_lifetime == timedelta(days=1)

import json
from pathlib import Path

from werkzeug.security import generate_password_hash

from app import create_app


def make_client(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("APP_USERS_JSON", json.dumps({"boss@example.com": generate_password_hash("secret-password")}))
    monkeypatch.setenv("APP_SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("APP_INSTANCE_DIR", str(tmp_path / "instance"))
    app = create_app({"TESTING": True, "SECRET_KEY": "test-secret-key"})
    return app.test_client()


def login(client):
    response = client.post("/login", data={"email": "boss@example.com", "password": "secret-password"})
    assert response.status_code == 200
    session_response = client.get("/api/session")
    assert session_response.status_code == 200
    return session_response.get_json()["csrf_token"]


def test_login_has_no_file_upload_or_server_analysis_endpoint(monkeypatch, tmp_path: Path):
    client = make_client(monkeypatch, tmp_path)
    assert client.get("/api/session").status_code == 401
    csrf = login(client)
    upload_attempt = client.post(
        "/api/jobs",
        data={"files": "this endpoint must not exist"},
        headers={"X-CSRF-Token": csrf},
    )
    assert upload_attempt.status_code == 404
    assert not (tmp_path / "instance" / "jobs").exists()


def test_production_session_cookie_is_hardened(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("APP_USERS_JSON", json.dumps({"boss@example.com": generate_password_hash("secret-password")}))
    monkeypatch.setenv("APP_SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("APP_INSTANCE_DIR", str(tmp_path / "instance"))
    client = create_app({"TESTING": True, "SECRET_KEY": "test-secret-key"}).test_client()
    response = client.post("/login", data={"email": "boss@example.com", "password": "secret-password"})
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

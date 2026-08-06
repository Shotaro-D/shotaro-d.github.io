import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_server_has_authentication_and_static_geometry_only():
    app_source = (PROJECT_ROOT / "app.py").read_text(encoding="utf-8")
    assert "request.files" not in app_source
    assert "/api/jobs" not in app_source
    assert "send_file" not in app_source
    assert "/api/manual/meshes" in app_source


def test_browser_reads_and_saves_user_files_without_uploading_them():
    manual_javascript = (PROJECT_ROOT / "static" / "manual.js").read_text(encoding="utf-8")
    app_javascript = (PROJECT_ROOT / "static" / "app.js").read_text(encoding="utf-8")
    html = (PROJECT_ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    assert "webkitdirectory" in html
    assert "arrayBuffer()" in manual_javascript
    assert "file.text()" in manual_javascript
    assert "localStorage" in manual_javascript
    assert "new Blob" in manual_javascript
    assert manual_javascript.count("fetch(") == 1
    assert 'fetch(url, { credentials: "same-origin" })' in manual_javascript
    assert 'dom.manualCanvasMessage.hidden = true;' in manual_javascript
    assert "TIFF一覧から画像を選択してください。" in manual_javascript
    assert "FormData" in app_javascript  # credentials only, never the selected folder
    assert "/api/jobs" not in manual_javascript + app_javascript
    assert "サーバーへ送信されません" in html


def test_static_mesh_payload_is_not_user_data():
    payload = json.loads((PROJECT_ROOT / "static" / "manual_meshes.json").read_text(encoding="utf-8"))
    assert set(payload) == {"meshes", "chamfered_meshes"}
    assert not any(key in json.dumps(payload) for key in ("password", "email", "image_sha256"))

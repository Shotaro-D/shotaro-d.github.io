from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_server_has_authentication_only_and_no_file_upload_route():
    app_source = (PROJECT_ROOT / "app.py").read_text(encoding="utf-8")
    assert "request.files" not in app_source
    assert "/api/jobs" not in app_source
    assert "send_file" not in app_source


def test_browser_analysis_reads_files_and_creates_local_csv():
    javascript = (PROJECT_ROOT / "static" / "analysis.js").read_text(encoding="utf-8")
    app_javascript = (PROJECT_ROOT / "static" / "app.js").read_text(encoding="utf-8")
    html = (PROJECT_ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    assert "await file.text()" in javascript
    assert "global.Zif8LocalAnalysis" in javascript
    assert "new Blob" in app_javascript
    assert "/api/jobs" not in app_javascript
    assert "サーバーへは送信しません" in html

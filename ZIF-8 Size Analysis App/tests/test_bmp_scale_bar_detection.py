import subprocess
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_bmp_footer_scale_bar_is_detected_without_metadata():
    completed = subprocess.run(
        ["node", "tests/test_bmp_scale_bar_detection.js"],
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr

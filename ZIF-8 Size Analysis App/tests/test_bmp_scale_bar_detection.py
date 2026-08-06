import shutil
import subprocess
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_bmp_footer_scale_bar_is_detected_without_metadata():
    if shutil.which("node") is None:
        pytest.skip("Node.js is required for the BMP scale-bar module test")
    completed = subprocess.run(
        ["node", "tests/test_bmp_scale_bar_detection.js"],
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr


def test_pure_manual_modules_define_sample_statistics_and_wheel_semantics():
    if shutil.which("node") is None:
        pytest.skip("Node.js is required for the browser-local module test")
    completed = subprocess.run(
        ["node", "tests/test_manual_pure_functions.js"],
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr

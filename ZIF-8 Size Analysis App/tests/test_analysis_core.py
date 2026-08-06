import json
from pathlib import Path

import pytest

from analysis_core import ShapeStatisticsError, analyse_directory, build_inventory, rows_to_csv


def write_session(path: Path, *, image_hash: str, particles: list[dict], updated_at: str = "2026-08-06T00:00:00Z") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "updated_at": updated_at,
                "sample": "TEST",
                "image": {"name": "image.tif"},
                "dataset": {"image_sha256": image_hash},
                "particles": particles,
            }
        ),
        encoding="utf-8",
    )


def test_inventory_and_pooled_shape_statistics(tmp_path: Path):
    write_session(
        tmp_path / "Sample" / "image_manual_count.json",
        image_hash="same-image",
        particles=[
            {"shape": "rhombic_dodecahedron", "equivalent_diameter_nm": 100.0},
            {"shape": "rhombic dodecahedron", "equivalent_diameter_nm": 110.0},
            {"shape": "cube", "equivalent_diameter_nm": 90.0},
            {"shape": "cube", "equivalent_diameter_nm": 999.0, "included_in_statistics": False},
        ],
    )
    write_session(
        tmp_path / "Sample" / "outputs" / "copy_manual_count_session.json",
        image_hash="same-image",
        updated_at="2026-08-06T01:00:00Z",
        particles=[{"shape": "cube", "equivalent_diameter_nm": 9999.0}],
    )
    (tmp_path / "Sample" / "image.tif").write_bytes(b"TIFF")
    (tmp_path / "Sample" / "image.txt").write_text("MicronMarker=100", encoding="utf-8")

    inventory = build_inventory(tmp_path)
    assert inventory["tiff_count"] == 1
    assert inventory["txt_count"] == 1
    assert inventory["session_count"] == 2

    report = analyse_directory(tmp_path)
    rows = {row["Shape"]: row for row in report["rows"]}
    assert rows["Rhombic dodecahedron"]["Average diameter (nm)"] == pytest.approx(105.0)
    assert rows["Rhombic dodecahedron"]["standard deviation (nm)"] == pytest.approx(5.0)
    assert rows["Rhombic dodecahedron"]["CV (%)"] == pytest.approx(100 * 5 / 105)
    assert rows["Rhombic dodecahedron"]["Counts"] == 2
    assert rows["Cube"]["Counts"] == 1
    assert report["particle_count"] == 3
    assert "Sample/image_manual_count.json" in report["used_files"]
    assert all("outputs/copy" not in path for path in report["used_files"])

    csv_text = rows_to_csv(report["rows"])
    assert "Shape,Average diameter (nm),standard deviation (nm),CV (%),Counts" in csv_text


def test_archive_and_invalid_json_are_not_analysis_inputs(tmp_path: Path):
    write_session(
        tmp_path / "Archive" / "old_manual_count.json",
        image_hash="old",
        particles=[{"shape": "cube", "equivalent_diameter_nm": 1000}],
    )
    (tmp_path / "not-a-session.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ShapeStatisticsError, match="セッションJSON"):
        analyse_directory(tmp_path)

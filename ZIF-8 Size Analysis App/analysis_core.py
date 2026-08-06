#!/usr/bin/env python3
"""Core analysis for uploaded manual-count JSON sessions.

The web application intentionally keeps the numerical definition identical to
the local Analysis script: pooled particle diameters, population standard
deviation (ddof=0), and CV reported as a percentage.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
import io
import json
import math
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


OUTPUT_COLUMNS = (
    "Shape",
    "Average diameter (nm)",
    "standard deviation (nm)",
    "CV (%)",
    "Counts",
)

SHAPE_LABELS = {
    "rhombic_dodecahedron": "Rhombic dodecahedron",
    "chamfered_cube": "Chamfered cube",
    "cube": "Cube",
}
SHAPE_ORDER = tuple(SHAPE_LABELS)
SHAPE_ALIASES = {
    "rhombic dodecahedron": "rhombic_dodecahedron",
    "rhombic_dodecahedron": "rhombic_dodecahedron",
    "rhombic-dodecahedron": "rhombic_dodecahedron",
    "chamfered cube": "chamfered_cube",
    "chamfered_cube": "chamfered_cube",
    "chamfered-cube": "chamfered_cube",
    "cube": "cube",
}
EXCLUDED_DIRECTORY_NAMES = {
    ".git",
    ".pytest_cache",
    "__pycache__",
    "archive",
    "archive code",
}


class ShapeStatisticsError(ValueError):
    """Raised when a session cannot be interpreted safely."""


@dataclass(frozen=True)
class SessionCandidate:
    path: Path
    session: Mapping[str, Any]
    identity: tuple[str, str]


@dataclass
class ShapeAccumulator:
    diameters_nm: list[float] = field(default_factory=list)

    def add(self, value: float) -> None:
        self.diameters_nm.append(value)

    def row(self, label: str) -> dict[str, Any]:
        count = len(self.diameters_nm)
        if count == 0:
            return {
                "Shape": label,
                "Average diameter (nm)": "",
                "standard deviation (nm)": "",
                "CV (%)": "",
                "Counts": 0,
            }
        mean = math.fsum(self.diameters_nm) / count
        variance = math.fsum((value - mean) ** 2 for value in self.diameters_nm) / count
        standard_deviation = math.sqrt(max(0.0, variance))
        cv = 100.0 * standard_deviation / mean if mean > 0.0 else ""
        return {
            "Shape": label,
            "Average diameter (nm)": mean,
            "standard deviation (nm)": standard_deviation,
            "CV (%)": cv,
            "Counts": count,
        }


def is_excluded(path: Path) -> bool:
    return any(part.casefold() in EXCLUDED_DIRECTORY_NAMES for part in path.parts)


def _timestamp_key(value: Any) -> float:
    digits = "".join(character for character in str(value or "") if character.isdigit())
    try:
        return float(digits[:17])
    except (TypeError, ValueError):
        return float("-inf")


def _session_identity(session: Mapping[str, Any], path: Path) -> tuple[str, str]:
    dataset = session.get("dataset")
    if isinstance(dataset, Mapping):
        image_sha256 = str(dataset.get("image_sha256", "")).strip().lower()
        if image_sha256:
            return ("image_sha256", image_sha256)
    image = session.get("image")
    image_name = image.get("name") if isinstance(image, Mapping) else ""
    sample = str(session.get("sample", "")).strip()
    return ("sample_and_image", f"{sample}\x1f{str(image_name or path.stem).strip()}".casefold())


def _load_session(path: Path) -> SessionCandidate:
    try:
        with path.open("r", encoding="utf-8") as handle:
            session = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise ShapeStatisticsError(f"JSONを読み込めません: {path.name}") from exc
    if not isinstance(session, Mapping) or not isinstance(session.get("particles"), list):
        raise ShapeStatisticsError(f"粒子リストを含むJSONではありません: {path.name}")
    return SessionCandidate(path, session, _session_identity(session, path))


def discover_session_paths(root: Path) -> list[Path]:
    """Find JSON files that have the current manual-count session schema."""

    root = Path(root).resolve()
    if not root.is_dir():
        raise ShapeStatisticsError("アップロードフォルダが見つかりません")
    paths: list[Path] = []
    for path in sorted(root.rglob("*.json"), key=lambda item: item.as_posix().casefold()):
        if path.is_file() and not is_excluded(path):
            try:
                candidate = _load_session(path)
            except ShapeStatisticsError:
                continue
            if candidate.session.get("particles") is not None:
                paths.append(path)
    return paths


def _choose_candidate(candidates: Sequence[SessionCandidate]) -> SessionCandidate:
    def key(candidate: SessionCandidate) -> tuple[int, int, float, str]:
        parts = {part.casefold() for part in candidate.path.parts}
        compatibility_copy = int(bool(parts & {"outputs", "work"}))
        session_suffix = int(candidate.path.name.endswith("_manual_count_session.json"))
        return (
            compatibility_copy,
            session_suffix,
            -_timestamp_key(candidate.session.get("updated_at")),
            candidate.path.as_posix().casefold(),
        )

    return min(candidates, key=key)


def _normalise_shape(value: Any, path: Path) -> str:
    raw = str(value or "").strip().casefold().replace("_", " ")
    canonical = SHAPE_ALIASES.get(raw)
    if canonical is None:
        raise ShapeStatisticsError(f"未対応の形状 {value!r}: {path.name}")
    return canonical


def _diameter_nm(particle: Mapping[str, Any], path: Path) -> float:
    for key in ("equivalent_diameter_nm", "d_eq_nm"):
        if key not in particle:
            continue
        try:
            value = float(particle[key])
        except (TypeError, ValueError) as exc:
            raise ShapeStatisticsError(f"径が数値ではありません: {path.name}") from exc
        if not math.isfinite(value) or value < 0.0:
            raise ShapeStatisticsError(f"径が不正です: {path.name}")
        return value
    raise ShapeStatisticsError(f"粒子に径がありません: {path.name}")


def aggregate_sessions(
    candidates: Iterable[SessionCandidate],
    *,
    include_excluded: bool = False,
) -> tuple[list[dict[str, Any]], list[Path]]:
    grouped: dict[tuple[str, str], list[SessionCandidate]] = {}
    for candidate in candidates:
        grouped.setdefault(candidate.identity, []).append(candidate)

    accumulators = {shape: ShapeAccumulator() for shape in SHAPE_ORDER}
    used_paths: list[Path] = []
    for same_image_candidates in grouped.values():
        candidate = _choose_candidate(same_image_candidates)
        used_paths.append(candidate.path)
        particles = candidate.session["particles"]
        assert isinstance(particles, list)
        for particle in particles:
            if not isinstance(particle, Mapping):
                raise ShapeStatisticsError(f"粒子データの形式が不正です: {candidate.path.name}")
            if not include_excluded and not bool(particle.get("included_in_statistics", True)):
                continue
            shape = _normalise_shape(
                particle.get("shape") or particle.get("shape_label"), candidate.path
            )
            accumulators.setdefault(shape, ShapeAccumulator()).add(
                _diameter_nm(particle, candidate.path)
            )

    rows = [accumulators[shape].row(SHAPE_LABELS[shape]) for shape in SHAPE_ORDER]
    extra_shapes = sorted(shape for shape in accumulators if shape not in SHAPE_LABELS)
    rows.extend(accumulators[shape].row(shape) for shape in extra_shapes)
    return rows, sorted(used_paths, key=lambda path: path.as_posix().casefold())


def build_inventory(root: Path) -> dict[str, Any]:
    files = [path for path in root.rglob("*") if path.is_file() and not is_excluded(path)]
    by_extension: dict[str, int] = {}
    for path in files:
        extension = path.suffix.casefold() or "(なし)"
        by_extension[extension] = by_extension.get(extension, 0) + 1
    session_paths = discover_session_paths(root)
    return {
        "file_count": len(files),
        "total_bytes": sum(path.stat().st_size for path in files),
        "tiff_count": sum(path.suffix.casefold() in {".tif", ".tiff"} for path in files),
        "txt_count": sum(path.suffix.casefold() == ".txt" for path in files),
        "json_count": sum(path.suffix.casefold() == ".json" for path in files),
        "session_count": len(session_paths),
        "extensions": dict(sorted(by_extension.items())),
        "session_files": [path.relative_to(root).as_posix() for path in session_paths],
    }


def analyse_directory(root: Path, *, include_excluded: bool = False) -> dict[str, Any]:
    session_paths = discover_session_paths(root)
    if not session_paths:
        raise ShapeStatisticsError(
            "粒子セッションJSONが見つかりません。*_manual_count.json等を含むフォルダを選択してください。"
        )
    candidates = [_load_session(path) for path in session_paths]
    rows, used_paths = aggregate_sessions(candidates, include_excluded=include_excluded)
    return {
        "rows": rows,
        "used_files": [path.relative_to(root).as_posix() for path in used_paths],
        "session_count": len(used_paths),
        "particle_count": sum(int(row["Counts"]) for row in rows),
    }


def _format_number(value: Any) -> Any:
    return f"{value:.10g}" if isinstance(value, float) else value


def rows_to_csv(rows: Sequence[Mapping[str, Any]]) -> str:
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({column: _format_number(row[column]) for column in OUTPUT_COLUMNS})
    return stream.getvalue()

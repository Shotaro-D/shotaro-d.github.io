"use strict";

export function normaliseLocalPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

export function directoryForLocalPath(path) {
  const parts = normaliseLocalPath(path).split("/");
  parts.pop();
  return parts.join("/");
}

export function isExcludedLocalPath(path) {
  return normaliseLocalPath(path).split("/").some((part) => (
    ["archive", "archive code", "gomi", "trash", ".git", "__pycache__"].includes(part.toLowerCase())
  ));
}

export function localAnalysisRun(path) {
  // Size distributions are defined by the directory that directly contains
  // the SEM image. Keep the full relative path to avoid merging equal leaf
  // directory names under different experimental branches.
  return directoryForLocalPath(path) || "(選択フォルダ直下)";
}

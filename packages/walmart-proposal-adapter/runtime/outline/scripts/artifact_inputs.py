"""Load verified analysis inputs from Agent-published Artifact descriptors."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


CONTRACT = "paramont.artifact-input-manifest/v1"


def _result_key(item: dict[str, Any]) -> str:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    return str(item.get("resultKey") or metadata.get("resultKey") or "")


def _operation(item: dict[str, Any]) -> str:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    return str(item.get("operation") or metadata.get("operation") or "")


def load_manifest(path: Path, workspace_root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("contract") != CONTRACT:
        raise ValueError(f"Artifact manifest contract must be {CONTRACT}")
    artifacts = document.get("artifacts")
    if not isinstance(artifacts, list):
        raise ValueError("Artifact manifest artifacts must be an array")
    required = {
        ("fineline-investment-analysis", "finelineInvestmentAnalysis"): "fineline",
        ("white-space-analysis", "whiteSpaceAnalysis"): "white_space",
    }
    selected: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    root = workspace_root.resolve()
    for (producer, result_key), name in required.items():
        matches = [
            item for item in artifacts
            if isinstance(item, dict)
            and str(item.get("producerSkill") or "").lower() == producer
            and _result_key(item) == result_key
        ]
        if len(matches) != 1:
            raise ValueError(
                f"Expected exactly one published Artifact for {producer}/{result_key}; found {len(matches)}"
            )
        item = matches[0]
        if item.get("artifactType") != "data_result":
            raise ValueError(f"{producer}/{result_key} must be a data_result Artifact")
        if not item.get("artifactId") and not item.get("id"):
            raise ValueError(f"{producer}/{result_key} is missing artifactId")
        relative = str(item.get("relativePath") or "")
        target = (root / relative).resolve()
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise ValueError(f"Artifact path escapes workspace: {relative}") from exc
        if not target.is_file():
            raise ValueError(f"Artifact file does not exist: {relative}")
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if digest != str(item.get("sha256") or ""):
            raise ValueError(f"Artifact SHA-256 does not match: {relative}")
        payload = json.loads(target.read_text(encoding="utf-8"))
        descriptor = {
            "artifactId": str(item.get("artifactId") or item.get("id")),
            "artifactType": "data_result",
            "producerSkill": producer,
            "operation": _operation(item),
            "resultKey": result_key,
            "relativePath": relative,
            "sha256": digest,
            "_resolvedPath": str(target),
        }
        selected[name] = (payload, descriptor)
    return selected["fineline"], selected["white_space"]

#!/usr/bin/env python3
"""Fail-closed bridge from frozen PAIMind Python CLIs to Harness Artifact files."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
WORKSPACE = Path.cwd().resolve()
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_runtime_sources() -> None:
    manifest = json.loads((ROOT / "SOURCE-MANIFEST.json").read_text(encoding="utf-8"))
    if manifest.get("schema") != "paimind.python-runtime-source-manifest/v1" or manifest.get("upstreamCommit") != "1f9fd80ea073a4ab4b5665b2300f7930f3f0520f":
        raise ValueError("packaged Python source manifest is invalid")
    for item in manifest.get("files") or []:
        path = (ROOT / str(item.get("path") or "")).resolve()
        path.relative_to(ROOT)
        if not path.is_file() or sha(path) != item.get("sha256"):
            raise ValueError(f"packaged Python source hash mismatch: {item.get('path')}")


def workspace_file(value: str) -> Path:
    path = Path(value)
    candidate = path.resolve() if path.is_absolute() else (WORKSPACE / path).resolve()
    try:
        candidate.relative_to(WORKSPACE)
    except ValueError as exc:
        raise ValueError(f"path is outside the Harness Workspace: {value}") from exc
    if not candidate.is_file():
        raise ValueError(f"Workspace file is unavailable: {value}")
    return candidate


def output_file(value: str) -> Path:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("output must be Workspace-relative")
    candidate = (WORKSPACE / path).resolve()
    candidate.relative_to(WORKSPACE)
    candidate.parent.mkdir(parents=True, exist_ok=True)
    return candidate


def load_manifest(value: str) -> tuple[Path, dict[str, dict[str, Any]]]:
    path = workspace_file(value)
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("schema") != "paimind.analysis-source-manifest/v1" or not isinstance(manifest.get("sources"), list) or not manifest["sources"]:
        raise ValueError("manifest must be paimind.analysis-source-manifest/v1 with sources")
    sources: dict[str, dict[str, Any]] = {}
    for item in manifest["sources"]:
        source_id = str(item.get("sourceId") or "")
        if not ID.fullmatch(source_id) or source_id in sources:
            raise ValueError("manifest has an invalid or duplicate sourceId")
        expected = str(item.get("sha256") or "").lower()
        if not SHA256.fullmatch(expected):
            raise ValueError(f"manifest source {source_id} has an invalid sha256")
        for field in ("period", "format", "purpose", "redaction"):
            if not str(item.get(field) or "").strip():
                raise ValueError(f"manifest source {source_id} lacks {field}")
        source_path = workspace_file(str(item.get("path") or ""))
        actual = sha(source_path)
        if actual != expected:
            raise ValueError(f"manifest source hash mismatch: {source_id}")
        declared_bytes = item.get("bytes")
        if declared_bytes is not None and declared_bytes != source_path.stat().st_size:
            raise ValueError(f"manifest source byte count mismatch: {source_id}")
        sources[source_id] = {**item, "absolutePath": str(source_path), "verifiedSha256": actual}
    return path, sources


def run(parts: list[str]) -> None:
    subprocess.run(parts, check=True, cwd=WORKSPACE, env={"PATH": str(Path(sys.executable).parent) + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"})


def data_result(kind: str, manifest_path: Path, sources: dict[str, dict[str, Any]], upstream_path: Path, output: Path) -> None:
    payload = json.loads(upstream_path.read_text(encoding="utf-8"))
    payload_text = canonical(payload)
    document = {
        "schema": "paimind.data-result/v1",
        "analysisKind": kind,
        "sourceManifest": str(manifest_path.relative_to(WORKSPACE)),
        "sourceManifestSha256": sha(manifest_path),
        "sources": [{key: value for key, value in item.items() if key != "absolutePath"} for item in sources.values()],
        "payloadSha256": hashlib.sha256(payload_text.encode("utf-8")).hexdigest(),
        "payload": payload,
    }
    output.write_text(canonical(document), encoding="utf-8")


def analyze_fineline(args: argparse.Namespace) -> None:
    manifest_path, sources = load_manifest(args.manifest)
    source = sources.get("fineline-source")
    if source is None:
        raise ValueError("Fineline manifest requires sourceId fineline-source")
    output = output_file(args.output)
    with tempfile.TemporaryDirectory(prefix="paimind-fineline-") as temp:
        target = Path(temp)
        run([sys.executable, str(ROOT / "fineline" / "scripts" / "run_fineline_investment_analysis.py"), "--input-path", source["absolutePath"], "--output-dir", str(target), "--path-base", "cwd", "--category", args.category])
        data_result("fineline-investment-analysis", manifest_path, sources, target / "fineline_investment_analysis.json", output)


def analyze_white_space(args: argparse.Namespace) -> None:
    manifest_path, sources = load_manifest(args.manifest)
    required = ["white-space-performance", "white-space-assortment", "white-space-tags", "white-space-portfolio"]
    missing = [source_id for source_id in required if source_id not in sources]
    if missing:
        raise ValueError(f"White-space manifest lacks sourceIds: {missing}")
    output = output_file(args.output)
    with tempfile.TemporaryDirectory(prefix="paimind-white-space-") as temp:
        target = Path(temp)
        run([sys.executable, str(ROOT / "white-space" / "scripts" / "run_white_space_analysis.py"), "--mode", "formal", "--performance-csv", sources[required[0]]["absolutePath"], "--assortment-csv", sources[required[1]]["absolutePath"], "--tags-csv", sources[required[2]]["absolutePath"], "--portfolio-csv", sources[required[3]]["absolutePath"], "--output-dir", str(target)])
        data_result("white-space-analysis", manifest_path, sources, target / "white_space_analysis.json", output)


def safe_id(value: Any, fallback: str) -> str:
    candidate = re.sub(r"[^A-Za-z0-9._:-]+", "-", str(value or "")).strip("-.")
    return candidate if ID.fullmatch(candidate) else fallback


def display(value: Any, unit: Any = None) -> str:
    if isinstance(value, float):
        if unit in {"rate", "percent", "%"}:
            return f"{value * 100:.1f}%"
        return f"{value:,.2f}".rstrip("0").rstrip(".")
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def convert_outline(legacy: dict[str, Any], fineline_path: Path, white_path: Path, fineline_artifact_id: str, white_artifact_id: str) -> dict[str, Any]:
    legacy_sources = {str(row.get("sourceId")): row for row in legacy.get("sources") or []}
    sources = [
        {"sourceId": "fineline-result", "name": fineline_path.name, "path": str(fineline_path.relative_to(WORKSPACE)), "sha256": sha(fineline_path), "format": "json", "role": "Fineline data_result Artifact", "period": "Historical frozen snapshot", "summary": "Deterministic Fineline investment analysis", "artifactId": fineline_artifact_id},
        {"sourceId": "white-space-result", "name": white_path.name, "path": str(white_path.relative_to(WORKSPACE)), "sha256": sha(white_path), "format": "json", "role": "White-space data_result Artifact", "period": "Historical frozen snapshot", "summary": "Deterministic White-space analysis", "artifactId": white_artifact_id},
    ]
    evidence: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(legacy.get("evidence") or []):
        evidence_id = safe_id(row.get("evidenceId"), f"evidence-{index + 1}")
        legacy_source = legacy_sources.get(str(row.get("sourceId"))) or {}
        producer = str(legacy_source.get("producerSkill") or "").lower()
        source_id = "white-space-result" if "white" in producer else "fineline-result"
        raw = row.get("value")
        if not isinstance(raw, (str, int, float)) or isinstance(raw, bool):
            raw = json.dumps(raw, ensure_ascii=False, sort_keys=True)
        evidence[evidence_id] = {
            "factId": evidence_id, "sourceIds": [source_id], "rawValue": raw,
            "displayValue": display(row.get("value"), row.get("unit")), "valueType": "source_value",
            "fieldPath": str(row.get("fieldPath") or "$"), "method": str(row.get("note") or f"Read verified {source_id}"),
            "definition": str(row.get("statementType") or "Registered analysis fact").replace("_", " "),
            "period": str(row.get("period") or "Historical frozen snapshot"), "filters": [], "factValuesChanged": False,
        }
    facts = list(evidence.values())
    slides: list[dict[str, Any]] = []
    for slide_index, old in enumerate(legacy.get("slides") or []):
        slide_id = safe_id(old.get("slideId"), f"slide-{slide_index + 1}")
        elements: list[dict[str, Any]] = []
        for block_index, block in enumerate(old.get("blocks") or []):
            object_id = safe_id(block.get("id"), f"{slide_id}-object-{block_index + 1}")
            fact_ids = [safe_id(value, "") for value in block.get("evidenceIds") or []]
            fact_ids = [value for value in fact_ids if value in evidence]
            block_type = str(block.get("type") or "text")
            if block_type == "kpi_group":
                for item_index, item in enumerate(block.get("items") or []):
                    item_facts = [safe_id(value, "") for value in item.get("evidenceIds") or []]
                    item_facts = [value for value in item_facts if value in evidence]
                    if not item_facts:
                        continue
                    elements.append({"objectId": safe_id(item.get("id"), f"{object_id}-kpi-{item_index + 1}"), "type": "kpi", "title": str(item.get("label") or "KPI"), "displayValue": str(item.get("displayValue") or display(item.get("rawValue"))), "factIds": item_facts, "bindings": [{"factId": value, "selector": {"kind": "object"}} for value in item_facts]})
                continue
            if block_type == "chart" and fact_ids:
                numeric = [value for value in fact_ids if isinstance(evidence[value]["rawValue"], (int, float))]
                if numeric:
                    points = [{"seriesKey": "analysis", "categoryKey": safe_id(value, f"point-{index + 1}"), "label": evidence[value]["definition"], "value": float(evidence[value]["rawValue"]), "displayValue": evidence[value]["displayValue"], "factId": value} for index, value in enumerate(numeric)]
                    chart_type = str((block.get("chart") or {}).get("type") or "horizontal-bar")
                    allowed = {"horizontal-bar", "lollipop", "dot-plot", "bullet", "slope", "line"}
                    chart_type = chart_type if chart_type in allowed else "horizontal-bar"
                    elements.append({"objectId": object_id, "type": "chart", "title": str((block.get("chart") or {}).get("businessQuestion") or "Analysis evidence"), "factIds": numeric, "bindings": [{"factId": point["factId"], "selector": {"kind": "chart-point", "seriesKey": point["seriesKey"], "categoryKey": point["categoryKey"]}} for point in points], "chart": {"kind": chart_type, "points": points}})
                    continue
            if fact_ids:
                text_value = block.get("text") or "; ".join(str(item.get("text") or "") for item in block.get("items") or []) or str(old.get("takeaway") or "Evidence-backed conclusion")
                elements.append({"objectId": object_id, "type": "text", "title": str(old.get("headline") or "Insight"), "text": str(text_value), "factIds": fact_ids, "bindings": [{"factId": value, "selector": {"kind": "object"}} for value in fact_ids]})
        if not elements:
            fact_id = f"{slide_id}:narrative"
            narrative = str(old.get("takeaway") or old.get("headline") or "Buyer proposal narrative")
            facts.append({"factId": fact_id, "sourceIds": ["fineline-result", "white-space-result"], "rawValue": narrative, "displayValue": narrative, "valueType": "narrative", "fieldPath": f"$.slides[{slide_index}].takeaway", "method": "Deterministic proposal synthesis from two verified data_result Artifacts", "definition": "Buyer proposal narrative", "period": "Historical frozen snapshot", "filters": [], "factValuesChanged": False})
            elements.append({"objectId": f"{slide_id}:text", "type": "text", "text": narrative, "factIds": [fact_id], "bindings": [{"factId": fact_id, "selector": {"kind": "object"}}]})
        hint = str(old.get("layoutHint") or old.get("role") or "insight").lower()
        layout = "cover" if "cover" in hint else "section" if "section" in hint else "kpi" if any(item["type"] == "kpi" for item in elements) else "comparison" if "compar" in hint else "recommendation" if "recommend" in hint or "action" in hint else "insight"
        slides.append({"slideId": slide_id, "layout": layout, "eyebrow": str(old.get("section") or "WALMART BUYER PROPOSAL"), "title": str(old.get("headline") or old.get("takeaway") or f"Proposal {slide_index + 1}"), "narrative": str(old.get("takeaway") or old.get("objective") or "Evidence-backed buyer decision"), "elements": elements})
    if not slides:
        raise ValueError("upstream outline contains no slides")
    title = str((legacy.get("document") or {}).get("title") or "Walmart Buyer Proposal")
    return {
        "schema": "paimind.presentation-outline/v1",
        "title": title,
        "subtitle": "Traceable proposal generated from verified analysis Artifacts",
        "design": {
            "schema": "paimind.presentation-design/v1",
            "templateId": "wmt-kids-mod",
            "stylePreset": "wmt-retail",
            "aspectRatio": "16:9",
            "canvas": {"width": 1280, "height": 720},
            "density": "balanced",
        },
        "sources": sources,
        "facts": facts,
        "slides": slides,
    }


def build_outline(args: argparse.Namespace) -> None:
    if not ID.fullmatch(args.fineline_artifact_id) or not ID.fullmatch(args.white_space_artifact_id):
        raise ValueError("analysis Artifact IDs are invalid")
    fineline = workspace_file(args.fineline)
    white = workspace_file(args.white_space)
    fineline_doc = json.loads(fineline.read_text(encoding="utf-8"))
    white_doc = json.loads(white.read_text(encoding="utf-8"))
    if fineline_doc.get("schema") != "paimind.data-result/v1" or fineline_doc.get("analysisKind") != "fineline-investment-analysis":
        raise ValueError("fineline Artifact content is invalid")
    if white_doc.get("schema") != "paimind.data-result/v1" or white_doc.get("analysisKind") != "white-space-analysis":
        raise ValueError("white-space Artifact content is invalid")
    output = output_file(args.output)
    with tempfile.TemporaryDirectory(prefix="paimind-outline-") as temp:
        target = Path(temp)
        fineline_payload = target / "fineline.json"
        white_payload = target / "white-space.json"
        fineline_payload.write_text(canonical(fineline_doc["payload"]), encoding="utf-8")
        white_payload.write_text(canonical(white_doc["payload"]), encoding="utf-8")
        legacy_dir = target / "legacy"
        # Five decision-worthy Finelines produce a focused 25-slide proposal
        # (opening/category/priorities + 3 slides per Fineline + closing).
        # The former default of ten Finelines produced a padded 40-slide deck.
        run([sys.executable, str(ROOT / "outline" / "scripts" / "build_outline.py"), "--fineline-json", str(fineline_payload), "--white-space-json", str(white_payload), "--top-n", "5", "--trend-mode", "pending", "--narrative-mode", "draft", "--path-mode", "relative", "--output-dir", str(legacy_dir)])
        legacy = json.loads((legacy_dir / "proposal_presentation_outline.json").read_text(encoding="utf-8"))
        output.write_text(canonical(convert_outline(legacy, fineline, white, args.fineline_artifact_id, args.white_space_artifact_id)), encoding="utf-8")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    for name in ("fineline", "white-space"):
        command_parser = commands.add_parser(name)
        command_parser.add_argument("--manifest", required=True)
        command_parser.add_argument("--output", required=True)
        command_parser.add_argument("--category", default="KIDS CRAFTS")
    outline = commands.add_parser("outline")
    outline.add_argument("--fineline", required=True)
    outline.add_argument("--white-space", required=True)
    outline.add_argument("--fineline-artifact-id", required=True)
    outline.add_argument("--white-space-artifact-id", required=True)
    outline.add_argument("--output", required=True)
    return root


def main() -> None:
    verify_runtime_sources()
    args = parser().parse_args()
    if args.command == "fineline":
        analyze_fineline(args)
    elif args.command == "white-space":
        analyze_white_space(args)
    else:
        build_outline(args)
    print(canonical({"status": "success", "command": args.command, "output": args.output}), end="")


if __name__ == "__main__":
    main()

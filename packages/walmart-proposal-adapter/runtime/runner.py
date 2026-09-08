#!/usr/bin/env python3
"""Fail-closed bridge from frozen PAIMind Python CLIs to Harness Artifact files."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import date
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


def output_directory(value: str) -> Path:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("output directory must be Workspace-relative")
    candidate = (WORKSPACE / path).resolve()
    candidate.relative_to(WORKSPACE)
    candidate.mkdir(parents=True, exist_ok=True)
    return candidate


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def prepare_demo(args: argparse.Namespace) -> None:
    """Publish a deterministic Walmart fixture for the native demo chain."""
    output = output_directory(args.output_dir)
    finelines = [
        ("KIDS PAINT", 1.18, 2650),
        ("KIDS PAINT ACCESSORIES", 1.15, 2520),
        ("STYROFOAM", 1.12, 2390),
        ("GLITTER", 1.10, 2260),
        ("PONY BEADS", 1.08, 2130),
        ("MODELING CLAY", 1.04, 1040),
        ("CRAFT KITS", 1.03, 980),
        ("FOAM CRAFT", 1.02, 920),
        ("KIDS BRUSHES", 1.01, 860),
        ("CRAFT TOOLS", 1.00, 800),
        ("WOOD CRAFT", 0.99, 740),
        ("KIDS CANVAS", 0.98, 680),
        ("CRAFT STORAGE", 0.97, 620),
    ]
    fineline_rows: list[dict[str, Any]] = []
    performance_rows: list[dict[str, Any]] = []
    assortment_rows: list[dict[str, Any]] = []
    tag_rows: list[dict[str, Any]] = []
    portfolio_rows: list[dict[str, Any]] = []
    for line_index, (fineline, current_factor, sales_base) in enumerate(finelines):
        for sku_index in range(10):
            upc = f"810{line_index + 1:02d}{sku_index + 1:07d}"
            for fiscal_year in (2024, 2025):
                year_factor = current_factor if fiscal_year == 2025 else 1.0
                for fiscal_week in range(31, 53):
                    weekly_factor = 1 + (fiscal_week - 31) * 0.008
                    sales_value = round((sales_base + sku_index * 23) * year_factor * weekly_factor, 2)
                    sales_units = round(sales_value / (3.25 + line_index * 0.35 + sku_index * 0.04), 2)
                    fineline_rows.append({
                        "upc": upc,
                        "sales_value": sales_value,
                        "sales_units": sales_units,
                        "category": "KIDS CRAFTS",
                        "reviewed_fineline": fineline,
                        "source_fineline": fineline,
                        "fiscal_year": fiscal_year,
                        "fiscal_week": fiscal_week,
                        "item_name": f"Synthetic {fineline.title()} Item {sku_index + 1}",
                    })
                    if line_index < 5:
                        performance_rows.append({
                            "upc": upc,
                            "week_date": date.fromisocalendar(fiscal_year, fiscal_week, 1).isoformat(),
                            "fiscal_year": fiscal_year,
                            "fiscal_week": fiscal_week,
                            "sales_value": sales_value,
                            "sales_units": sales_units,
                            "stores_selling": 1250 + line_index * 145 + sku_index * 37,
                        })
            if line_index < 5:
                assortment_rows.append({
                    "upc": upc,
                    "report_start_date": "2025-07-28",
                    "report_end_date": "2025-12-28",
                    "groups": "Total Assortment",
                    "sales_value": round((sales_base + sku_index * 23) * current_factor * 22, 2),
                    "sales_units": round((sales_base + sku_index * 23) * current_factor * 22 / 4.2, 2),
                    "stores_selling": 1250 + line_index * 145 + sku_index * 37,
                })
                for attribute_name, attribute_value in (
                    ("Color Family", "Bright" if sku_index < 5 else "Neutral"),
                    ("Occasion", "Everyday" if sku_index % 2 == 0 else "Seasonal"),
                ):
                    tag_rows.append({
                        "product_code": upc,
                        "final_fineline": fineline,
                        "attribute_name": attribute_name,
                        "attribute_value": attribute_value,
                        "is_primary": 1,
                        "use_for_analysis": 1,
                        "taxonomy_version": "synthetic-demo-v1",
                        "generated_at": "2026-08-27T00:00:00Z",
                    })
                if sku_index < 2:
                    portfolio_rows.append({"vendor_stock_id": f"DEMO-{line_index + 1}-{sku_index + 1}", "upc": upc})
    portfolio_rows.append({"vendor_stock_id": "DEMO-WK31-NEW", "upc": ""})

    definitions = [
        ("fineline-source", "walmart-fineline.json", "json", "Fineline investment analysis input", fineline_rows),
        ("white-space-performance", "walmart-white-space-performance.csv", "csv", "Weekly item performance input", performance_rows),
        ("white-space-assortment", "walmart-white-space-assortment.csv", "csv", "Latest assortment snapshot", assortment_rows),
        ("white-space-tags", "walmart-white-space-tags.csv", "csv", "Approved synthetic product tags", tag_rows),
        ("white-space-portfolio", "walmart-white-space-portfolio.csv", "csv", "Synthetic Paramont portfolio mapping", portfolio_rows),
    ]
    source_fields = {
        "walmart-white-space-performance.csv": ["upc", "week_date", "fiscal_year", "fiscal_week", "sales_value", "sales_units", "stores_selling"],
        "walmart-white-space-assortment.csv": ["upc", "report_start_date", "report_end_date", "groups", "sales_value", "sales_units", "stores_selling"],
        "walmart-white-space-tags.csv": ["product_code", "final_fineline", "attribute_name", "attribute_value", "is_primary", "use_for_analysis", "taxonomy_version", "generated_at"],
        "walmart-white-space-portfolio.csv": ["vendor_stock_id", "upc"],
    }
    sources = []
    for source_id, filename, source_format, purpose, rows in definitions:
        path = output / filename
        if source_format == "json":
            path.write_text(canonical(rows), encoding="utf-8")
        else:
            write_csv(path, source_fields[filename], rows)
        sources.append({
            "sourceId": source_id,
            "path": str(path.relative_to(WORKSPACE)),
            "sha256": sha(path),
            "bytes": path.stat().st_size,
            "period": "Synthetic fiscal WK31-WK52, 2024-2025",
            "format": source_format,
            "purpose": purpose,
            "summary": f"Deterministic synthetic fixture containing {len(rows)} rows.",
            "redaction": "Synthetic demo data; contains no Walmart, consumer, vendor, or live business records.",
        })
    manifest = {
        "schema": "paimind.analysis-source-manifest/v1",
        "scenario": "Walmart D19 Kids Crafts synthetic end-to-end demonstration",
        "synthetic": True,
        "generatedBy": "paimind.walmart-demo.frozen-data/v1",
        "sources": sources,
    }
    manifest_path = output / "source-manifest.json"
    manifest_path.write_text(canonical(manifest), encoding="utf-8")


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
    with Path(sources["white-space-tags"]["absolutePath"]).open("r", encoding="utf-8-sig", newline="") as source:
        tagged_finelines = sorted({str(row.get("final_fineline") or "").strip().upper() for row in csv.DictReader(source) if str(row.get("final_fineline") or "").strip()})
    if not tagged_finelines:
        raise ValueError("White-space tag source contains no Final Finelines")
    with tempfile.TemporaryDirectory(prefix="paimind-white-space-") as temp:
        target = Path(temp)
        run([sys.executable, str(ROOT / "white-space" / "scripts" / "run_white_space_analysis.py"), "--mode", "formal", "--performance-csv", sources[required[0]]["absolutePath"], "--assortment-csv", sources[required[1]]["absolutePath"], "--tags-csv", sources[required[2]]["absolutePath"], "--portfolio-csv", sources[required[3]]["absolutePath"], "--finelines", ",".join(tagged_finelines), "--output-dir", str(target)])
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
    # Keep the source's explicit demo classification visible in the deliverable.
    # The classification comes from the exact frozen manifest, never from a
    # model guess, file name, or business value in the analysis payload.
    demo_sources = []
    for document in (fineline_doc, white_doc):
        manifest = workspace_file(document["sourceManifest"])
        if sha(manifest) != document["sourceManifestSha256"]:
            raise ValueError("analysis source manifest hash mismatch")
        demo_sources.append(json.loads(manifest.read_text(encoding="utf-8")).get("synthetic") is True)
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
        outline = convert_outline(legacy, fineline, white, args.fineline_artifact_id, args.white_space_artifact_id)
        templates = {
            "wmt-retail": "wmt-kids-mod",
            "strategy-consulting": "strategy-grid",
            "paramont-signature": "paramont-mountain",
            "playful-storybook": "storybook-cutpaper",
        }
        outline["design"]["stylePreset"] = args.style_preset
        outline["design"]["templateId"] = templates[args.style_preset]
        if args.title:
            outline["title"] = args.title
            outline["slides"][0]["title"] = args.title
        if any(demo_sources):
            notice = "演示数据 · 非真实经营数据" if all(demo_sources) else "包含演示数据 · 不可作为真实经营结果"
            outline["subtitle"] = notice
            for slide in outline["slides"]:
                slide["eyebrow"] = notice + " · " + slide["eyebrow"]
            outline["slides"][0]["narrative"] = notice + "。" + outline["slides"][0]["narrative"]
        output.write_text(canonical(outline), encoding="utf-8")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--output-dir", required=True)
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
    outline.add_argument("--title")
    outline.add_argument("--style-preset", choices=("wmt-retail", "strategy-consulting", "paramont-signature", "playful-storybook"), default="wmt-retail")
    return root


def main() -> None:
    verify_runtime_sources()
    args = parser().parse_args()
    if args.command == "prepare":
        prepare_demo(args)
        args.output = str((output_directory(args.output_dir) / "source-manifest.json").relative_to(WORKSPACE))
    elif args.command == "fineline":
        analyze_fineline(args)
    elif args.command == "white-space":
        analyze_white_space(args)
    else:
        build_outline(args)
    print(canonical({"status": "success", "command": args.command, "output": args.output}), end="")


if __name__ == "__main__":
    main()

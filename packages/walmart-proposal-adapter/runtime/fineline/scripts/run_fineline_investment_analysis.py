#!/usr/bin/env python3
"""Script-driven entry point for Fineline investment analysis."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
REPO_ROOT = SKILL_DIR.parents[2]
SQL_TEMPLATE_PATH = SKILL_DIR / "references" / "source-sql-template.sql"
CATEGORY_PROFILE_DIR = SKILL_DIR / "references" / "category-profiles"

sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(SCRIPT_DIR))

import analyze_fineline_investment as analysis_core  # noqa: E402
import data_access  # noqa: E402


ALLOWED_FILTER_KEYS = {
    "category",
    "subcategory",
    "brand",
    "final_fineline",
    "upc",
    "fiscal_year_week_sort_start",
    "fiscal_year_week_sort_end",
}


FINELINE_RESULTS_COLUMNS = [
    "final_fineline",
    "primary_current_sales_value",
    "primary_prior_sales_value",
    "category_share",
    "primary_yoy_growth_pct",
    "growth_label",
    "growth_decision_label",
    "rolling_52w_yoy_growth_pct",
    "primary_current_sales_units",
    "primary_unit_growth_pct",
    "primary_current_asp",
    "primary_asp_growth_pct",
    "primary_current_active_sku_count",
    "primary_prior_active_sku_count",
    "primary_current_sales_per_active_sku",
    "matched_sku_yoy_growth_pct",
    "new_sku_sales_share",
    "top3_sku_share",
    "growth_driver_label",
    "sku_productivity_label",
    "sku_mix_growth_label",
    "scale_label",
    "concentration_label",
    "quadrant",
    "opportunity_type",
    "opportunity_rationale",
    "recommendation",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run script-driven Fineline investment analysis."
    )
    parser.add_argument("--input-path", default=None, help="Optional offline CSV, XLSX, or JSON input.")
    parser.add_argument("--database", default=None, help="SQL Server database. Defaults to SQLSERVER_DATABASE or ods.")
    parser.add_argument("--server", default=None, help="SQL Server host. Defaults to SQLSERVER_SERVER or SERVER118.")
    parser.add_argument("--username", default=None, help="SQL Server username. Defaults to SQLSERVER_USERNAME or SERVER118_USERNAME.")
    parser.add_argument("--password", default=None, help="SQL Server password. Defaults to SQLSERVER_PASSWORD or SERVER118_PASSWORD.")
    parser.add_argument("--category", default="KIDS CRAFTS", help="Required category filter. MVP default is KIDS CRAFTS.")
    parser.add_argument("--subcategory", action="append", default=[], help="Optional subcategory filter; repeatable.")
    parser.add_argument("--brand", action="append", default=[], help="Optional brand filter; repeatable.")
    parser.add_argument("--final-fineline", action="append", default=[], help="Optional Final Fineline filter; repeatable.")
    parser.add_argument("--upc", action="append", default=[], help="Optional UPC filter; repeatable.")
    parser.add_argument("--fiscal-year-week-sort-start", type=int, default=None)
    parser.add_argument("--fiscal-year-week-sort-end", type=int, default=None)
    parser.add_argument("--filter-json", default=None, help="Optional JSON file with only whitelisted filter keys.")
    parser.add_argument("--category-profile", default=None, help="Optional category profile YAML path.")
    parser.add_argument("--output-dir", required=True, help="Output directory.")
    parser.add_argument(
        "--path-base",
        choices=["skill-root", "cwd"],
        default="skill-root",
        help="Base for user-provided relative paths. Default skill-root is platform-friendly; cwd is useful for local development.",
    )
    parser.add_argument("--top-scale-share", type=float, default=0.40)
    parser.add_argument("--save-sql", action="store_true", help="Also write generated_source.sql in live mode.")
    parser.add_argument(
        "--result-key",
        help="Also copy the structured JSON to output/<resultKey>.json for Artifact publication.",
    )
    return parser.parse_args()


def resolve_skill_path(path_value: str | Path | None, *, base: Path = SKILL_DIR) -> Path | None:
    if path_value is None:
        return None
    path_text = str(path_value).strip()
    if not path_text:
        return None
    path = Path(path_text)
    if path.is_absolute():
        return path
    return base / path


def user_path_base(args: argparse.Namespace) -> Path:
    return Path.cwd() if args.path_base == "cwd" else SKILL_DIR


def normalize_text(value: object) -> str:
    return analysis_core.normalize_text(value)


def ensure_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [normalize_text(item) for item in value if normalize_text(item)]
    text = normalize_text(value)
    return [text] if text else []


def load_filter_json(path: str | None, *, base: Path = SKILL_DIR) -> dict[str, Any]:
    if not path:
        return {}
    resolved_path = resolve_skill_path(path, base=base)
    payload = json.loads(resolved_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("--filter-json must contain a JSON object.")
    unknown = sorted(set(payload) - ALLOWED_FILTER_KEYS)
    if unknown:
        raise ValueError(
            f"Unsupported filter key(s): {unknown}. Allowed keys: {sorted(ALLOWED_FILTER_KEYS)}"
        )
    return payload


def merge_filters(args: argparse.Namespace) -> dict[str, Any]:
    payload = load_filter_json(args.filter_json, base=user_path_base(args))
    filters = {
        "category": normalize_text(payload.get("category") or args.category),
        "subcategory": ensure_list(payload.get("subcategory")) + ensure_list(args.subcategory),
        "brand": ensure_list(payload.get("brand")) + ensure_list(args.brand),
        "final_fineline": ensure_list(payload.get("final_fineline")) + ensure_list(args.final_fineline),
        "upc": ensure_list(payload.get("upc")) + ensure_list(args.upc),
        "fiscal_year_week_sort_start": payload.get(
            "fiscal_year_week_sort_start",
            args.fiscal_year_week_sort_start,
        ),
        "fiscal_year_week_sort_end": payload.get(
            "fiscal_year_week_sort_end",
            args.fiscal_year_week_sort_end,
        ),
    }
    if not filters["category"]:
        raise ValueError("category is required.")
    start = filters["fiscal_year_week_sort_start"]
    end = filters["fiscal_year_week_sort_end"]
    if start is not None:
        filters["fiscal_year_week_sort_start"] = int(start)
    if end is not None:
        filters["fiscal_year_week_sort_end"] = int(end)
    if start is not None and end is not None and int(start) > int(end):
        raise ValueError("fiscal_year_week_sort_start cannot be greater than fiscal_year_week_sort_end.")
    return filters


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def in_clause(expression: str, values: list[str]) -> str | None:
    clean_values = [value for value in values if value]
    if not clean_values:
        return None
    return f"{expression} IN ({', '.join(sql_literal(value) for value in clean_values)})"


def normalized_equals(expression: str, value: str) -> str:
    return f"UPPER(LTRIM(RTRIM({expression}))) = UPPER({sql_literal(value)})"


def normalized_in_clause(expression: str, values: list[str]) -> str | None:
    clean_values = [value for value in values if value]
    if not clean_values:
        return None
    normalized_values = ", ".join(f"UPPER({sql_literal(value)})" for value in clean_values)
    return f"UPPER(LTRIM(RTRIM({expression}))) IN ({normalized_values})"


def build_where_clause(filters: dict[str, Any]) -> str:
    final_fineline_expr = "COALESCE(NULLIF(t2.reviewed_fineline, ''), NULLIF(t2.source_fineline, ''))"
    clauses = [normalized_equals("t2.category", filters["category"])]
    optional_clauses = [
        normalized_in_clause("t2.subcategory", filters["subcategory"]),
        normalized_in_clause("t2.brand", filters["brand"]),
        normalized_in_clause(final_fineline_expr, filters["final_fineline"]),
        normalized_in_clause("CAST(t1.upc AS NVARCHAR(255))", filters["upc"]),
    ]
    clauses.extend(clause for clause in optional_clauses if clause)
    if filters["fiscal_year_week_sort_start"] is not None:
        clauses.append(
            "(TRY_CONVERT(int, t3.fiscal_year) * 100 + TRY_CONVERT(int, t3.fiscal_week)) "
            f">= {filters['fiscal_year_week_sort_start']}"
        )
    if filters["fiscal_year_week_sort_end"] is not None:
        clauses.append(
            "(TRY_CONVERT(int, t3.fiscal_year) * 100 + TRY_CONVERT(int, t3.fiscal_week)) "
            f"<= {filters['fiscal_year_week_sort_end']}"
        )
    return "".join(f"\n      AND {clause}" for clause in clauses)


def build_source_sql(filters: dict[str, Any]) -> str:
    template = SQL_TEMPLATE_PATH.read_text(encoding="utf-8")
    return template.replace("{{where_clause}}", build_where_clause(filters))


def category_to_profile_slug(category: str) -> str:
    return normalize_text(category).casefold().replace("&", "and").replace(" ", "-")


def load_category_profile(category: str, profile_path: str | None = None, *, base: Path = SKILL_DIR) -> dict[str, Any]:
    path = resolve_skill_path(profile_path, base=base) if profile_path else CATEGORY_PROFILE_DIR / f"{category_to_profile_slug(category)}.yaml"
    if not path.exists():
        return {
            "category": category,
            "yoy_mode": "rolling_52w",
            "yoy_mode_label": "rolling 52w YoY",
            "yoy_mode_explanation": "No category profile was found, so primary YoY falls back to rolling 52 fiscal weeks versus the prior 52 fiscal weeks.",
            "launch_fiscal_week": None,
            "space_expansion_finelines": [],
            "fixed_supplier_finelines": [],
            "category_profile_flags": ["missing_category_profile"],
        }
    with path.open("r", encoding="utf-8") as file:
        profile = yaml.safe_load(file) or {}
    profile.setdefault("category", category)
    profile.setdefault("yoy_mode_label", None)
    profile.setdefault("yoy_mode_explanation", None)
    profile.setdefault("space_expansion_finelines", [])
    profile.setdefault("fixed_supplier_finelines", [])
    profile.setdefault("category_profile_flags", [])
    profile["profile_path"] = str(path)
    return profile


def write_outputs(
    raw_df: pd.DataFrame,
    category: str,
    output_dir: Path,
    top_scale_share: float,
    category_profile: dict[str, Any],
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    source_rows_path = output_dir / "source_rows.csv"
    raw_df.to_csv(source_rows_path, index=False, encoding="utf-8-sig")
    if raw_df.empty:
        raise ValueError(
            "No source rows returned from SQL or input file. "
            f"Check {source_rows_path} and generated_source.sql if --save-sql was used."
        )

    category_df, metadata = analysis_core.prepare_rows(raw_df, category)
    period_df, period_info = analysis_core.assign_periods(category_df, category_profile)
    profile_flags = list(category_profile.get("category_profile_flags") or [])
    if profile_flags:
        period_info["category_profile_flags"] = sorted(set(period_info.get("category_profile_flags", []) + profile_flags))
    records = analysis_core.build_analysis(
        period_df,
        category,
        top_scale_share,
        period_info=period_info,
        category_profile=category_profile,
    )
    analysis_core.add_window_fields(records, period_info)

    summary = analysis_core.build_summary(metadata, period_info, records, category_profile)
    payload = {
        "metadata": metadata,
        "period": period_info,
        "category_profile": category_profile,
        "summary": summary,
        "recommendation_groups": analysis_core.build_recommendation_groups(records),
        "opportunity_groups": analysis_core.build_opportunity_groups(records),
        "standardized_analysis_result": analysis_core.build_standardized_analysis_result(records, summary),
        "quadrant_plot": analysis_core.build_quadrant_plot(records, top_scale_share),
        "visualization_specs": analysis_core.build_visualization_specs(records, top_scale_share),
        "metric_explanations": analysis_core.build_metric_explanations(category_profile),
        "finelines": records,
    }
    json_path = output_dir / "fineline_investment_analysis.json"
    fineline_results_csv_path = output_dir / "fineline_results.csv"
    html_path = output_dir / "fineline_investment_report.html"
    markdown_path = output_dir / "fineline_investment_report.md"
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=analysis_core.to_jsonable),
        encoding="utf-8",
    )
    pd.DataFrame(records).reindex(columns=FINELINE_RESULTS_COLUMNS).to_csv(
        fineline_results_csv_path,
        index=False,
        encoding="utf-8-sig",
    )
    html_path.write_text(analysis_core.build_html(payload), encoding="utf-8")
    markdown_path.write_text(analysis_core.build_markdown(payload), encoding="utf-8")
    return {
        "source_rows_path": str(source_rows_path),
        "fineline_results_csv_path": str(fineline_results_csv_path),
        "json_path": str(json_path),
        "html_path": str(html_path),
        "markdown_path": str(markdown_path),
        "fineline_count": len(records),
    }


def main() -> None:
    args = parse_args()
    path_base = user_path_base(args)
    output_dir = resolve_skill_path(args.output_dir, base=path_base)
    if output_dir is None:
        raise ValueError("--output-dir is required.")
    filters = merge_filters(args)
    category_profile = load_category_profile(filters["category"], args.category_profile, base=path_base)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.input_path:
        input_path = resolve_skill_path(args.input_path, base=path_base)
        raw_df = data_access.read_offline_source_rows(str(input_path))
        sql = None
    else:
        sql = build_source_sql(filters)
        if args.save_sql:
            (output_dir / "generated_source.sql").write_text(sql, encoding="utf-8")
        raw_df = data_access.query_live_sql(
            sql=sql,
            database=args.database,
            server=args.server,
            username=args.username,
            password=args.password,
        )

    result = write_outputs(raw_df, filters["category"], output_dir, args.top_scale_share, category_profile)
    if args.result_key:
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,127}", args.result_key):
            raise ValueError("--result-key must be a valid Artifact result key.")
        result_output = SKILL_DIR / "output" / f"{args.result_key}.json"
        result_output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(Path(result["json_path"]), result_output)
        result["data_result_path"] = str(result_output)
    if sql and args.save_sql:
        result["sql_path"] = str(output_dir / "generated_source.sql")

    print(json.dumps({"status": "success", **result}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

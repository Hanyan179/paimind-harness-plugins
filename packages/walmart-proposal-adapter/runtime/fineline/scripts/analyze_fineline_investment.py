#!/usr/bin/env python3
"""Analyze Final Fineline investment priority from a SQL Server query artifact."""

from __future__ import annotations

import argparse
import html
import json
import math
from pathlib import Path
from typing import Any

import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
ECHARTS_RUNTIME_PATH = SKILL_DIR / "references" / "vendor" / "echarts.min.js"


REQUIRED_COLUMNS = {
    "upc",
    "sales_value",
    "category",
    "reviewed_fineline",
    "source_fineline",
    "fiscal_year",
    "fiscal_week",
}


DEFAULT_PROFILE = {
    "category": None,
    "yoy_mode": "rolling_52w",
    "yoy_mode_label": "rolling 52w YoY",
    "yoy_mode_explanation": "No category profile was supplied, so primary YoY uses rolling 52 fiscal weeks versus the prior 52 fiscal weeks.",
    "meaningful_growth_threshold": 0.05,
    "flat_growth_band": 0.05,
    "launch_fiscal_week": None,
    "space_expansion_finelines": [],
    "fixed_supplier_finelines": [],
}


METRIC_EXPLANATIONS = {
    "primary_current_sales_value": "当前期销售额：当前主分析期内该 Final Fineline 的 sales_value 合计。",
    "category_share": "品类占比：该 Final Fineline 当前期销售额 / 当前期 Category 总销售额。",
    "primary_yoy_growth_pct": "主 YoY：当前主分析期 vs 去年同阶段主分析期。",
    "rolling_52w_yoy_growth_pct": "Rolling 52w YoY：最近 52 个 fiscal weeks vs 前 52 个 fiscal weeks，仅作为长期趋势参考。",
    "top3_sku_share": "Top 3 SKU 占比：该 Fineline 当前期 Top 3 UPC 销售额 / 该 Fineline 当前期销售额。",
    "scale_label": "体量标签：按当前期品类占比排序，Top 40% 为高体量。",
    "growth_label": "增长标签：主 YoY >= 5% 为 meaningful_growth；0%-5% 为 slight_growth；-5%-0% 为 flat_or_slight_decline；低于 -5% 为 declining；对比期为 0 且当前期 > 0 标记为 new_or_reactivated。",
    "concentration_label": "集中度标签：Top 3 SKU 占比 <= 50% 为结构性较强；50%-70% 为中等集中；>70% 为爆款驱动风险高。",
    "primary_unit_growth_pct": "Unit Growth：当前主分析期销售数量 vs 去年同阶段销售数量。",
    "primary_asp_growth_pct": "ASP Growth：当前主分析期平均售价 vs 去年同阶段平均售价。",
    "growth_driver_label": "Growth Driver：判断销售额增长主要来自销量、价格，还是二者共同驱动。",
    "primary_current_sales_per_active_sku": "Sales / Active SKU：当前主分析期销售额 / 有销售或销量的 distinct UPC 数。",
    "sku_productivity_label": "SKU Productivity：判断增长是否来自 SKU productivity 提升，还是 SKU 数扩张。",
    "new_sku_sales_share": "New SKU Sales Share：当前期有销售、对比期无销售的 UPC 销售额 / 当前期 Fineline 销售额。",
    "sku_mix_growth_label": "SKU Mix Growth：判断增长来自 matched SKU、new SKU，还是替换型增长。",
    "opportunity_type": "Opportunity Type：把四象限和增长质量指标转成更接近业务会议动作的分类。",
}


def primary_yoy_label(category_profile: dict[str, Any] | None, period_mode: str | None = None) -> str:
    profile = category_profile or {}
    if profile.get("yoy_mode_label"):
        return str(profile["yoy_mode_label"])
    if (period_mode or profile.get("yoy_mode")) == "launch_week_aligned":
        launch_week = profile.get("launch_fiscal_week")
        return f"WK{int(launch_week):02d} anchored YoY" if launch_week else "launch week anchored YoY"
    return "rolling 52w YoY"


def build_metric_explanations(category_profile: dict[str, Any] | None = None) -> dict[str, str]:
    explanations = dict(METRIC_EXPLANATIONS)
    profile = category_profile or {}
    if profile.get("yoy_mode_label") or profile.get("yoy_mode_explanation"):
        detail_parts = [primary_yoy_label(profile)]
        if profile.get("yoy_mode_explanation"):
            detail_parts.append(str(profile["yoy_mode_explanation"]))
        explanations["primary_yoy_growth_pct"] = (
            METRIC_EXPLANATIONS["primary_yoy_growth_pct"]
            + " 当前 category 使用："
            + " ".join(detail_parts)
        )
    return explanations


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build Fineline investment quadrant analysis outputs."
    )
    parser.add_argument("--input-path", required=True, help="CSV, XLSX, or sqlserver-query JSON artifact.")
    parser.add_argument("--category", default="KIDS CRAFTS", help="Single category to analyze.")
    parser.add_argument("--output-dir", required=True, help="Directory for JSON and Markdown outputs.")
    parser.add_argument("--top-scale-share", type=float, default=0.40, help="Top share by count labeled high scale.")
    return parser.parse_args()


def normalize_text(value: object) -> str:
    if pd.isna(value):
        return ""
    return " ".join(str(value).strip().split())


def normalize_key(value: object) -> str:
    return normalize_text(value).casefold()


def read_input(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict) and "data" in payload:
            return pd.DataFrame(payload["data"])
        if isinstance(payload, list):
            return pd.DataFrame(payload)
        raise ValueError("JSON input must be a list of rows or a sqlserver-query artifact with data.")
    if suffix == ".csv":
        return pd.read_csv(path)
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(path)
    raise ValueError(f"Unsupported input file type: {path.suffix}")


def validate_columns(df: pd.DataFrame) -> None:
    missing = sorted(REQUIRED_COLUMNS - set(df.columns))
    if missing:
        raise ValueError(f"Input is missing required columns: {missing}")


def prepare_rows(df: pd.DataFrame, category: str) -> tuple[pd.DataFrame, dict[str, Any]]:
    validate_columns(df)
    work = df.copy()
    for column in ["upc", "category", "reviewed_fineline", "source_fineline"]:
        work[column] = work[column].map(normalize_text)
    if "item_name" not in work.columns:
        work["item_name"] = ""
    work["item_name"] = work["item_name"].map(normalize_text)
    work["final_fineline"] = work["reviewed_fineline"].where(
        work["reviewed_fineline"] != "",
        work["source_fineline"],
    )
    work["sales_value"] = pd.to_numeric(work["sales_value"], errors="coerce").fillna(0)
    if "sales_units" not in work.columns:
        work["sales_units"] = 0
    work["sales_units"] = pd.to_numeric(work["sales_units"], errors="coerce").fillna(0)
    if "week_date" in work.columns:
        work["week_date"] = pd.to_datetime(work["week_date"], errors="coerce")
    else:
        work["week_date"] = pd.NaT
    work["fiscal_year"] = pd.to_numeric(work["fiscal_year"], errors="coerce")
    work["fiscal_week"] = pd.to_numeric(work["fiscal_week"], errors="coerce")
    if "fiscal_year_week_sort" in work.columns:
        work["fiscal_year_week_sort"] = pd.to_numeric(work["fiscal_year_week_sort"], errors="coerce")
    else:
        work["fiscal_year_week_sort"] = work["fiscal_year"] * 100 + work["fiscal_week"]

    category_mask = work["category"].map(normalize_key) == normalize_key(category)
    category_rows = work[category_mask].copy()
    blank_fineline_rows = int(category_rows["final_fineline"].map(normalize_text).eq("").sum())
    category_rows = category_rows[category_rows["final_fineline"].map(normalize_text).ne("")]
    category_rows = category_rows[category_rows["fiscal_year_week_sort"].notna()]

    metadata = {
        "category": category,
        "source_row_count": int(len(df)),
        "category_row_count": int(category_mask.sum()),
        "blank_final_fineline_row_count": blank_fineline_rows,
    }
    if category_rows.empty:
        raise ValueError(f"No analyzable rows found for category: {category}")
    return category_rows, metadata


def safe_divide(numerator: float, denominator: float) -> float | None:
    if denominator == 0:
        return None
    return numerator / denominator


def none_if_nan(value: Any) -> Any:
    if value is None:
        return None
    if pd.isna(value):
        return None
    return value


def int_or_zero(value: Any) -> int:
    value = none_if_nan(value)
    return 0 if value is None else int(value)


def float_or_zero(value: Any) -> float:
    value = none_if_nan(value)
    return 0.0 if value is None else float(value)


def pct(value: float | None) -> str:
    if value is None or pd.isna(value):
        return "N/A"
    return f"{value * 100:.1f}%"


def money(value: float) -> str:
    return f"${value:,.0f}"


def fyw_sort(year: int, week: int) -> int:
    return int(year) * 100 + int(week)


def split_fyw(value: int | float) -> tuple[int, int]:
    value_int = int(value)
    return value_int // 100, value_int % 100


def assign_periods(
    df: pd.DataFrame,
    category_profile: dict[str, Any] | None = None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    profile = {**DEFAULT_PROFILE, **(category_profile or {})}
    work = df.copy()
    weeks = sorted(int(week) for week in work["fiscal_year_week_sort"].dropna().unique().tolist())
    if not weeks:
        raise ValueError("No fiscal weeks found.")

    rolling_info = assign_rolling_periods(work, weeks)
    if profile.get("yoy_mode") == "launch_week_aligned" and profile.get("launch_fiscal_week"):
        period_df, period_info = assign_launch_week_periods(work, weeks, int(profile["launch_fiscal_week"]))
        period_info["period_mode"] = "launch_week_aligned"
        period_info["launch_fiscal_week"] = int(profile["launch_fiscal_week"])
        period_info["category_profile_flags"] = []
    else:
        period_df = rolling_info["work"]
        period_info = {
            "period_mode": "rolling_52w",
            "launch_fiscal_week": None,
            "category_profile_flags": ["missing_category_profile"],
            **rolling_info["period"],
        }

    period_df = add_rolling_period_column(period_df, rolling_info["current_weeks"], rolling_info["prior_weeks"])
    period_info["rolling_52w"] = rolling_info["period"]
    period_info["available_distinct_weeks"] = int(len(weeks))
    add_period_date_fields(period_df, period_info)
    return period_df, period_info


def assign_rolling_periods(df: pd.DataFrame, weeks: list[int]) -> dict[str, Any]:
    selected_weeks = weeks[-104:]
    prior_weeks = set(selected_weeks[: max(0, len(selected_weeks) - 52)])
    current_weeks = set(selected_weeks[-52:])
    work = df[df["fiscal_year_week_sort"].isin(selected_weeks)].copy()
    work["analysis_period"] = ""
    work.loc[work["fiscal_year_week_sort"].isin(prior_weeks), "analysis_period"] = "prior"
    work.loc[work["fiscal_year_week_sort"].isin(current_weeks), "analysis_period"] = "current"
    work = work[work["analysis_period"].ne("")]
    return {
        "work": work,
        "current_weeks": current_weeks,
        "prior_weeks": prior_weeks,
        "period": {
            "selected_distinct_weeks": int(len(selected_weeks)),
            "current_week_count": int(len(current_weeks)),
            "prior_week_count": int(len(prior_weeks)),
            "analysis_window_current": period_window(current_weeks),
            "analysis_window_prior": period_window(prior_weeks),
            "current_period_start": period_window(current_weeks)["start_fiscal_year_week_sort"],
            "current_period_end": period_window(current_weeks)["end_fiscal_year_week_sort"],
            "prior_period_start": period_window(prior_weeks)["start_fiscal_year_week_sort"],
            "prior_period_end": period_window(prior_weeks)["end_fiscal_year_week_sort"],
        },
    }


def assign_launch_week_periods(
    df: pd.DataFrame,
    weeks: list[int],
    launch_fiscal_week: int,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    latest_week_sort = max(weeks)
    latest_year, latest_week = split_fyw(latest_week_sort)
    if latest_week >= launch_fiscal_week:
        current_start = fyw_sort(latest_year, launch_fiscal_week)
        current_end = latest_week_sort
        prior_start = fyw_sort(latest_year - 1, launch_fiscal_week)
    else:
        current_start = fyw_sort(latest_year - 1, launch_fiscal_week)
        current_end = latest_week_sort
        prior_start = fyw_sort(latest_year - 2, launch_fiscal_week)

    current_weeks_list = [week for week in weeks if current_start <= week <= current_end]
    current_weeks = set(current_weeks_list)
    prior_candidates = [week for week in weeks if prior_start <= week < current_start]
    prior_weeks = set(prior_candidates[: len(current_weeks_list)])

    work = df[df["fiscal_year_week_sort"].isin(current_weeks | prior_weeks)].copy()
    work["analysis_period"] = ""
    work.loc[work["fiscal_year_week_sort"].isin(prior_weeks), "analysis_period"] = "prior"
    work.loc[work["fiscal_year_week_sort"].isin(current_weeks), "analysis_period"] = "current"
    work = work[work["analysis_period"].ne("")]

    flags = []
    if len(prior_weeks) < len(current_weeks):
        flags.append("prior_period_shorter_than_current")
    if not prior_weeks:
        flags.append("missing_prior_period")

    current_window = period_window(current_weeks)
    prior_window = period_window(prior_weeks)
    period_info = {
        "selected_distinct_weeks": int(len(current_weeks) + len(prior_weeks)),
        "current_week_count": int(len(current_weeks)),
        "prior_week_count": int(len(prior_weeks)),
        "analysis_window_current": current_window,
        "analysis_window_prior": prior_window,
        "current_period_start": current_window["start_fiscal_year_week_sort"],
        "current_period_end": current_window["end_fiscal_year_week_sort"],
        "prior_period_start": prior_window["start_fiscal_year_week_sort"],
        "prior_period_end": prior_window["end_fiscal_year_week_sort"],
        "period_alignment_flags": flags,
    }
    return work, period_info


def period_window(weeks: set[int]) -> dict[str, int | None]:
    if not weeks:
        return {
            "start_fiscal_year_week_sort": None,
            "end_fiscal_year_week_sort": None,
        }
    return {
        "start_fiscal_year_week_sort": int(min(weeks)),
        "end_fiscal_year_week_sort": int(max(weeks)),
    }


def format_us_date(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    timestamp = pd.to_datetime(value, errors="coerce")
    if pd.isna(timestamp):
        return None
    return timestamp.strftime("%m-%d-%Y")


def period_date_window(df: pd.DataFrame, period_column: str, period_value: str) -> tuple[str | None, str | None]:
    if "week_date" not in df.columns:
        return None, None
    dates = df.loc[df[period_column] == period_value, "week_date"].dropna()
    if dates.empty:
        return None, None
    return format_us_date(dates.min()), format_us_date(dates.max())


def add_period_date_fields(df: pd.DataFrame, period_info: dict[str, Any]) -> None:
    current_start, current_end = period_date_window(df, "analysis_period", "current")
    prior_start, prior_end = period_date_window(df, "analysis_period", "prior")
    period_info["current_period_start_date"] = current_start
    period_info["current_period_end_date"] = current_end
    period_info["prior_period_start_date"] = prior_start
    period_info["prior_period_end_date"] = prior_end


def add_rolling_period_column(df: pd.DataFrame, current_weeks: set[int], prior_weeks: set[int]) -> pd.DataFrame:
    work = df.copy()
    work["rolling_52w_period"] = ""
    work.loc[work["fiscal_year_week_sort"].isin(prior_weeks), "rolling_52w_period"] = "prior"
    work.loc[work["fiscal_year_week_sort"].isin(current_weeks), "rolling_52w_period"] = "current"
    return work


def classify_growth(
    current_sales: float,
    prior_sales: float,
    meaningful_growth_threshold: float = 0.05,
    flat_growth_band: float = 0.05,
) -> tuple[str, float | None]:
    if prior_sales > 0:
        yoy = current_sales / prior_sales - 1
        if yoy >= meaningful_growth_threshold:
            return "meaningful_growth", yoy
        if yoy > 0:
            return "slight_growth", yoy
        if yoy >= -abs(flat_growth_band):
            return "flat_or_slight_decline", yoy
        return "declining", yoy
    if current_sales > 0:
        return "new_or_reactivated", None
    return "no_activity", None


def classify_concentration(top3_share: float | None) -> str:
    if top3_share is None:
        return "no_current_sales"
    if top3_share <= 0.50:
        return "broad_based"
    if top3_share <= 0.70:
        return "moderate_concentration"
    return "hit_driven"


def quadrant_for(scale_label: str, growth_label: str) -> str:
    growth_for_quadrant = growth_for_decision(growth_label)
    if scale_label == "high_scale" and growth_for_quadrant == "high_growth":
        return "高体量 + 高增长"
    if scale_label == "high_scale":
        return "高体量 + 低增长"
    if growth_for_quadrant == "high_growth":
        return "低体量 + 高增长"
    return "低体量 + 低增长"


def recommendation_for(quadrant: str, growth_label: str, concentration_label: str) -> str:
    if growth_label == "new_or_reactivated":
        base = "先验证是否为真实趋势、铺货变化或新品恢复，再决定是否投入。"
    elif quadrant == "高体量 + 高增长":
        base = "优先进入新品机会讨论。"
    elif quadrant == "高体量 + 低增长":
        base = "以防守、更新、提效为主，谨慎新增开发资源。"
    elif quadrant == "低体量 + 高增长":
        base = "适合小规模测试，验证是否有放大空间。"
    else:
        base = "默认不优先投入，除非有明确战略原因。"

    if concentration_label == "hit_driven":
        return base + " Top 3 SKU 占比过高，投入前必须做 SKU 级验证。"
    if concentration_label == "broad_based":
        return base + " Top 3 SKU 占比较低，需求更可能是 Fineline 结构性的。"
    return base + " Top 3 SKU 集中度中等，需要结合 SKU 明细判断。"


def period_sales(df: pd.DataFrame, period_column: str) -> pd.DataFrame:
    sales = (
        df[df[period_column].isin(["current", "prior"])]
        .groupby(["final_fineline", period_column], dropna=False)["sales_value"]
        .sum()
        .unstack(fill_value=0)
    )
    for column in ["current", "prior"]:
        if column not in sales.columns:
            sales[column] = 0.0
    return sales.reset_index()


def period_value_units(df: pd.DataFrame, period_column: str, prefix: str) -> pd.DataFrame:
    metrics = (
        df[df[period_column].isin(["current", "prior"])]
        .groupby(["final_fineline", period_column], dropna=False)
        .agg(sales_value=("sales_value", "sum"), sales_units=("sales_units", "sum"))
        .unstack(fill_value=0)
    )
    rows = []
    for fineline in metrics.index:
        row: dict[str, Any] = {"final_fineline": fineline}
        for period in ["current", "prior"]:
            for metric in ["sales_value", "sales_units"]:
                value = 0.0
                if (metric, period) in metrics.columns:
                    value = float(metrics.loc[fineline, (metric, period)])
                row[f"{prefix}_{period}_{metric}"] = value
        rows.append(row)
    if not rows:
        return pd.DataFrame(columns=[
            "final_fineline",
            f"{prefix}_current_sales_value",
            f"{prefix}_prior_sales_value",
            f"{prefix}_current_sales_units",
            f"{prefix}_prior_sales_units",
        ])
    return pd.DataFrame(rows)


def asp(sales_value: float, sales_units: float) -> float | None:
    return safe_divide(float(sales_value), float(sales_units))


def classify_growth_driver(
    value_yoy: float | None,
    unit_growth: float | None,
    asp_growth: float | None,
    current_sales: float,
    prior_sales: float,
) -> str:
    if prior_sales == 0 and current_sales > 0:
        return "new_or_reactivated"
    if value_yoy is None or unit_growth is None or asp_growth is None:
        return "insufficient_units_data"
    if value_yoy <= 0:
        return "declining"
    if unit_growth < 0 and asp_growth > 0:
        return "value_growth_units_down"
    if unit_growth <= 0 and asp_growth > 0:
        return "price_led_growth"
    if unit_growth > 0 and asp_growth < 0:
        return "unit_led_growth"
    if unit_growth > 0 and asp_growth >= 0:
        return "value_and_unit_growth"
    return "insufficient_units_data"


def period_active_sku_metrics(df: pd.DataFrame, period_column: str) -> pd.DataFrame:
    work = df[df[period_column].isin(["current", "prior"])].copy()
    work = work[(work["sales_value"] > 0) | (work["sales_units"] > 0)]
    if work.empty:
        return pd.DataFrame(columns=[
            "final_fineline",
            "primary_current_active_sku_count",
            "primary_prior_active_sku_count",
        ])
    metrics = (
        work.groupby(["final_fineline", period_column], dropna=False)["upc"]
        .nunique()
        .unstack(fill_value=0)
    )
    for column in ["current", "prior"]:
        if column not in metrics.columns:
            metrics[column] = 0
    return metrics.rename(
        columns={
            "current": "primary_current_active_sku_count",
            "prior": "primary_prior_active_sku_count",
        }
    ).reset_index()


def classify_sku_productivity(
    sales_per_active_sku_growth: float | None,
    active_sku_count_growth: float | None,
    current_active_sku_count: int,
    prior_active_sku_count: int,
) -> str:
    if prior_active_sku_count == 0 and current_active_sku_count > 0:
        return "new_or_reactivated"
    if current_active_sku_count == 0 or sales_per_active_sku_growth is None:
        return "insufficient_sku_data"
    if sales_per_active_sku_growth > 0.02:
        return "productivity_improving"
    if sales_per_active_sku_growth < -0.02:
        return "sku_expansion_led" if (active_sku_count_growth or 0) > 0 else "productivity_declining"
    if (active_sku_count_growth or 0) > 0:
        return "sku_expansion_led"
    return "stable_productivity"


def build_sku_period_matrix(df: pd.DataFrame) -> pd.DataFrame:
    work = df[df["analysis_period"].isin(["current", "prior"])].copy()
    work = work[(work["sales_value"] > 0) | (work["sales_units"] > 0)]
    if work.empty:
        return pd.DataFrame(columns=["final_fineline", "upc", "current", "prior"])
    matrix = (
        work.groupby(["final_fineline", "upc", "analysis_period"], dropna=False)["sales_value"]
        .sum()
        .unstack(fill_value=0)
    )
    for column in ["current", "prior"]:
        if column not in matrix.columns:
            matrix[column] = 0.0
    return matrix.reset_index()


def classify_sku_mix_growth(
    matched_sku_yoy: float | None,
    new_sku_sales_share: float | None,
    current_sales: float,
    prior_sales: float,
) -> str:
    if prior_sales == 0 and current_sales > 0:
        return "new_or_reactivated"
    if matched_sku_yoy is None or new_sku_sales_share is None:
        return "insufficient_match_data"
    if new_sku_sales_share > 0.50:
        return "new_sku_led_growth"
    if matched_sku_yoy > 0 and new_sku_sales_share <= 0.30:
        return "matched_sku_growth"
    if matched_sku_yoy > 0 and new_sku_sales_share > 0.30:
        return "mixed_growth"
    if matched_sku_yoy <= 0 and new_sku_sales_share > 0.30:
        return "replacement_growth"
    if matched_sku_yoy < 0:
        return "declining_existing_skus"
    return "insufficient_match_data"


def build_sku_mix_metrics(df: pd.DataFrame) -> pd.DataFrame:
    matrix = build_sku_period_matrix(df)
    rows: list[dict[str, Any]] = []
    for fineline, group in matrix.groupby("final_fineline", dropna=False):
        current = group["current"].astype(float)
        prior = group["prior"].astype(float)
        matched_mask = (current > 0) & (prior > 0)
        current_only_mask = (current > 0) & (prior <= 0)
        prior_only_mask = (prior > 0) & (current <= 0)
        current_total = float(current.sum())
        prior_total = float(prior.sum())
        matched_current = float(current[matched_mask].sum())
        matched_prior = float(prior[matched_mask].sum())
        current_only_sales = float(current[current_only_mask].sum())
        prior_only_sales = float(prior[prior_only_mask].sum())
        matched_yoy = None if matched_prior == 0 else matched_current / matched_prior - 1
        new_share = safe_divide(current_only_sales, current_total)
        discontinued_share = safe_divide(prior_only_sales, prior_total)
        rows.append(
            {
                "final_fineline": fineline,
                "matched_sku_count": int(matched_mask.sum()),
                "current_only_sku_count": int(current_only_mask.sum()),
                "prior_only_sku_count": int(prior_only_mask.sum()),
                "matched_sku_current_sales_value": matched_current,
                "matched_sku_prior_sales_value": matched_prior,
                "matched_sku_yoy_growth_pct": matched_yoy,
                "current_only_sku_sales_value": current_only_sales,
                "prior_only_sku_sales_value": prior_only_sales,
                "new_sku_sales_share": new_share,
                "discontinued_sku_prior_sales_share": discontinued_share,
                "sku_mix_growth_label": classify_sku_mix_growth(
                    matched_yoy,
                    new_share,
                    current_total,
                    prior_total,
                ),
            }
        )
    if not rows:
        return pd.DataFrame(columns=["final_fineline"])
    return pd.DataFrame(rows)


def build_top3_items(df: pd.DataFrame) -> dict[str, list[dict[str, Any]]]:
    current_rows = df[df["analysis_period"] == "current"].copy()
    if current_rows.empty:
        return {}

    item_sales = (
        current_rows.groupby(["final_fineline", "upc", "item_name"], dropna=False)
        .agg(sales_value=("sales_value", "sum"), sales_units=("sales_units", "sum"))
        .reset_index()
        .sort_values(["final_fineline", "sales_value", "sales_units"], ascending=[True, False, False])
    )
    item_sales["rank"] = item_sales.groupby("final_fineline", dropna=False).cumcount() + 1
    item_sales = item_sales[item_sales["rank"] <= 3]
    fineline_sales = current_rows.groupby("final_fineline", dropna=False)["sales_value"].sum().to_dict()

    top3_by_fineline: dict[str, list[dict[str, Any]]] = {}
    for _, row in item_sales.iterrows():
        fineline = row["final_fineline"]
        sales_value = float(row["sales_value"])
        fineline_total = float(fineline_sales.get(fineline, 0))
        top3_by_fineline.setdefault(fineline, []).append(
            {
                "rank": int(row["rank"]),
                "upc": normalize_text(row["upc"]),
                "item_name": normalize_text(row["item_name"]),
                "sales_value": sales_value,
                "sales_units": float(row["sales_units"]),
                "fineline_sales_share": safe_divide(sales_value, fineline_total),
            }
        )
    return top3_by_fineline


def build_analysis(
    df: pd.DataFrame,
    category: str,
    top_scale_share: float,
    period_info: dict[str, Any] | None = None,
    category_profile: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    period_info = period_info or {}
    profile = category_profile or {}
    meaningful_growth_threshold = float(profile.get("meaningful_growth_threshold", 0.05) or 0.05)
    flat_growth_band = float(profile.get("flat_growth_band", 0.05) or 0.05)
    primary_sales = period_value_units(df, "analysis_period", "primary")
    rolling_sales = period_sales(df, "rolling_52w_period").rename(
        columns={
            "current": "rolling_52w_current_sales_value",
            "prior": "rolling_52w_prior_sales_value",
        }
    )
    result = primary_sales.merge(rolling_sales, on="final_fineline", how="outer").fillna(0)
    active_sku_metrics = period_active_sku_metrics(df, "analysis_period")
    sku_mix_metrics = build_sku_mix_metrics(df)
    result = result.merge(active_sku_metrics, on="final_fineline", how="left")
    result = result.merge(sku_mix_metrics, on="final_fineline", how="left")

    top3_items_by_fineline = build_top3_items(df)
    top3_sales = pd.DataFrame(
        [
            {
                "final_fineline": fineline,
                "top3_sku_sales_value": sum(float(item["sales_value"]) for item in items),
            }
            for fineline, items in top3_items_by_fineline.items()
        ]
    )
    if top3_sales.empty:
        top3_sales = pd.DataFrame(columns=["final_fineline", "top3_sku_sales_value"])

    result = result.merge(top3_sales, on="final_fineline", how="left")
    result["top3_sku_sales_value"] = result["top3_sku_sales_value"].fillna(0)
    category_sales = float(result["primary_current_sales_value"].sum())
    result["category_share"] = result["primary_current_sales_value"].map(
        lambda value: safe_divide(float(value), category_sales)
    )
    result = result.sort_values(
        ["category_share", "primary_current_sales_value"],
        ascending=[False, False],
    ).reset_index(drop=True)

    high_scale_count = max(1, math.ceil(len(result) * top_scale_share))
    records: list[dict[str, Any]] = []
    for index, row in result.iterrows():
        primary_current = float(row["primary_current_sales_value"])
        primary_prior = float(row["primary_prior_sales_value"])
        primary_current_units = float(row.get("primary_current_sales_units", 0))
        primary_prior_units = float(row.get("primary_prior_sales_units", 0))
        rolling_current = float(row["rolling_52w_current_sales_value"])
        rolling_prior = float(row["rolling_52w_prior_sales_value"])
        growth_label, primary_yoy = classify_growth(
            primary_current,
            primary_prior,
            meaningful_growth_threshold,
            flat_growth_band,
        )
        _, rolling_yoy = classify_growth(
            rolling_current,
            rolling_prior,
            meaningful_growth_threshold,
            flat_growth_band,
        )
        growth_decision_label = growth_for_decision(growth_label)
        primary_unit_growth = None if primary_prior_units == 0 else primary_current_units / primary_prior_units - 1
        primary_current_asp = asp(primary_current, primary_current_units)
        primary_prior_asp = asp(primary_prior, primary_prior_units)
        primary_asp_growth = None if not primary_prior_asp else (primary_current_asp / primary_prior_asp - 1 if primary_current_asp is not None else None)
        growth_driver_label = classify_growth_driver(
            primary_yoy,
            primary_unit_growth,
            primary_asp_growth,
            primary_current,
            primary_prior,
        )
        current_active_sku_count = int_or_zero(row.get("primary_current_active_sku_count"))
        prior_active_sku_count = int_or_zero(row.get("primary_prior_active_sku_count"))
        active_sku_count_growth = None if prior_active_sku_count == 0 else current_active_sku_count / prior_active_sku_count - 1
        current_sales_per_active_sku = safe_divide(primary_current, current_active_sku_count)
        prior_sales_per_active_sku = safe_divide(primary_prior, prior_active_sku_count)
        sales_per_active_sku_growth = (
            None
            if not prior_sales_per_active_sku
            else (current_sales_per_active_sku / prior_sales_per_active_sku - 1 if current_sales_per_active_sku is not None else None)
        )
        sku_productivity_label = classify_sku_productivity(
            sales_per_active_sku_growth,
            active_sku_count_growth,
            current_active_sku_count,
            prior_active_sku_count,
        )
        top3_share = safe_divide(float(row["top3_sku_sales_value"]), primary_current)
        concentration_label = classify_concentration(top3_share)
        scale_label = "high_scale" if index < high_scale_count else "low_scale"
        quadrant = quadrant_for(scale_label, growth_label)
        flags = list(period_info.get("period_alignment_flags") or [])
        if primary_prior == 0 and primary_current > 0:
            flags.append("primary_prior_sales_zero_current_positive")
        if primary_current == 0:
            flags.append("primary_current_sales_zero")
        if concentration_label == "hit_driven":
            flags.append("top3_sku_share_gt_70pct")
        if primary_prior_units == 0 and primary_current_units > 0:
            flags.append("prior_units_zero_current_positive")
        if prior_active_sku_count == 0 and current_active_sku_count > 0:
            flags.append("prior_active_sku_zero_current_positive")

        record = {
                "category": category,
                "final_fineline": row["final_fineline"],
                "primary_yoy_mode": period_info.get("period_mode", "rolling_52w"),
                "primary_current_sales_value": primary_current,
                "primary_prior_sales_value": primary_prior,
                "primary_current_sales_units": primary_current_units,
                "primary_prior_sales_units": primary_prior_units,
                "primary_yoy_growth_pct": primary_yoy,
                "meaningful_growth_threshold": meaningful_growth_threshold,
                "flat_growth_band": flat_growth_band,
                "primary_unit_growth_pct": primary_unit_growth,
                "primary_current_asp": primary_current_asp,
                "primary_prior_asp": primary_prior_asp,
                "primary_asp_growth_pct": primary_asp_growth,
                "growth_driver_label": growth_driver_label,
                "rolling_52w_current_sales_value": rolling_current,
                "rolling_52w_prior_sales_value": rolling_prior,
                "rolling_52w_yoy_growth_pct": rolling_yoy,
                "current_sales_value": primary_current,
                "prior_sales_value": primary_prior,
                "category_sales_value": category_sales,
                "category_share": row["category_share"],
                "yoy_growth_pct": primary_yoy,
                "primary_current_active_sku_count": current_active_sku_count,
                "primary_prior_active_sku_count": prior_active_sku_count,
                "active_sku_count_growth_pct": active_sku_count_growth,
                "primary_current_sales_per_active_sku": current_sales_per_active_sku,
                "primary_prior_sales_per_active_sku": prior_sales_per_active_sku,
                "sales_per_active_sku_growth_pct": sales_per_active_sku_growth,
                "sku_productivity_label": sku_productivity_label,
                "matched_sku_count": int_or_zero(row.get("matched_sku_count")),
                "current_only_sku_count": int_or_zero(row.get("current_only_sku_count")),
                "prior_only_sku_count": int_or_zero(row.get("prior_only_sku_count")),
                "matched_sku_current_sales_value": float_or_zero(row.get("matched_sku_current_sales_value")),
                "matched_sku_prior_sales_value": float_or_zero(row.get("matched_sku_prior_sales_value")),
                "matched_sku_yoy_growth_pct": none_if_nan(row.get("matched_sku_yoy_growth_pct")),
                "current_only_sku_sales_value": float_or_zero(row.get("current_only_sku_sales_value")),
                "prior_only_sku_sales_value": float_or_zero(row.get("prior_only_sku_sales_value")),
                "new_sku_sales_share": none_if_nan(row.get("new_sku_sales_share")),
                "discontinued_sku_prior_sales_share": none_if_nan(row.get("discontinued_sku_prior_sales_share")),
                "sku_mix_growth_label": none_if_nan(row.get("sku_mix_growth_label")) or "insufficient_match_data",
                "top3_sku_sales_value": float(row["top3_sku_sales_value"]),
                "top3_sku_share": top3_share,
                "top3_items": top3_items_by_fineline.get(row["final_fineline"], []),
                "scale_label": scale_label,
                "growth_label": growth_label,
                "growth_decision_label": growth_decision_label,
                "concentration_label": concentration_label,
                "quadrant": quadrant,
                "recommendation": recommendation_for(quadrant, growth_label, concentration_label),
                "period_alignment_flags": flags,
                "data_quality_flags": flags,
                "space_expansion_opportunity": normalize_key(row["final_fineline"]) in {
                    normalize_key(item) for item in profile.get("space_expansion_finelines", [])
                },
                "fixed_supplier": normalize_key(row["final_fineline"]) in {
                    normalize_key(item) for item in profile.get("fixed_supplier_finelines", [])
                },
            }
        record["opportunity_type"] = classify_opportunity_type(record)
        record["opportunity_rationale"] = opportunity_rationale_for(record)
        records.append(record)
    return records


def add_window_fields(records: list[dict[str, Any]], period_info: dict[str, Any]) -> None:
    for record in records:
        record["analysis_window_current"] = period_info["analysis_window_current"]
        record["analysis_window_prior"] = period_info["analysis_window_prior"]


def build_summary(
    metadata: dict[str, Any],
    period_info: dict[str, Any],
    records: list[dict[str, Any]],
    category_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "category": metadata.get("category"),
        "fineline_count": int(len(records)),
        "primary_yoy_mode": period_info.get("period_mode", "rolling_52w"),
        "primary_yoy_label": primary_yoy_label(category_profile, period_info.get("period_mode")),
        "current_period_start": period_info.get("current_period_start"),
        "current_period_end": period_info.get("current_period_end"),
        "prior_period_start": period_info.get("prior_period_start"),
        "prior_period_end": period_info.get("prior_period_end"),
        "current_period_start_date": period_info.get("current_period_start_date"),
        "current_period_end_date": period_info.get("current_period_end_date"),
        "prior_period_start_date": period_info.get("prior_period_start_date"),
        "prior_period_end_date": period_info.get("prior_period_end_date"),
    }


def growth_for_decision(growth_label: str | None) -> str | None:
    if growth_label == "meaningful_growth":
        return "high_growth"
    if growth_label == "new_or_reactivated":
        return "validation_required"
    return "low_growth"


def classify_opportunity_type(record: dict[str, Any]) -> str:
    growth_decision = growth_for_decision(record.get("growth_label"))
    if record.get("concentration_label") == "hit_driven" or (
        record.get("fixed_supplier") and growth_decision == "high_growth"
    ):
        return "supplier_validation_required"
    if record.get("space_expansion_opportunity") and growth_decision == "high_growth":
        return "space_expansion_candidate"
    if (
        record.get("scale_label") == "high_scale"
        and growth_decision == "high_growth"
        and record.get("growth_driver_label") not in {"price_led_growth", "value_growth_units_down"}
        and record.get("sku_mix_growth_label") not in {"new_sku_led_growth", "replacement_growth"}
    ):
        return "new_product_opportunity"
    if (
        record.get("scale_label") == "high_scale"
        and growth_decision != "high_growth"
        and record.get("sales_per_active_sku_growth_pct") is not None
        and record.get("sales_per_active_sku_growth_pct") < 0
        and (
            (record.get("active_sku_count_growth_pct") is not None and record.get("active_sku_count_growth_pct") > 0)
            or record.get("primary_current_active_sku_count", 0) >= 3
        )
    ):
        return "sku_rationalization_candidate"
    if (
        record.get("scale_label") == "high_scale"
        and growth_decision != "high_growth"
        and (
            record.get("sku_productivity_label") == "productivity_declining"
            or ((record.get("primary_unit_growth_pct") is not None) and record.get("primary_unit_growth_pct") < 0)
        )
    ):
        return "refresh_or_repack_opportunity"
    if (
        record.get("scale_label") == "low_scale"
        and growth_decision == "high_growth"
    ) or record.get("growth_label") == "new_or_reactivated" or record.get("growth_driver_label") == "value_growth_units_down":
        return "watchlist"
    return "deprioritize"


def opportunity_rationale_for(record: dict[str, Any]) -> str:
    opportunity_type = record.get("opportunity_type")
    if opportunity_type == "supplier_validation_required":
        return "Top 3 SKU concentration or fixed supplier status requires validation before scaling investment."
    if opportunity_type == "space_expansion_candidate":
        return "Growth signal and profile space-expansion context indicate potential space discussion."
    if opportunity_type == "new_product_opportunity":
        return "High scale and high growth with acceptable concentration and growth quality support new product discussion."
    if opportunity_type == "refresh_or_repack_opportunity":
        return "High-scale Fineline is not growing and units or SKU productivity are weakening, suggesting refresh or repack work."
    if opportunity_type == "sku_rationalization_candidate":
        return "High-scale Fineline shows weak growth with declining sales per active SKU, suggesting SKU productivity review."
    if opportunity_type == "watchlist":
        return "Growth exists but scale, new/reactivated status, or mixed quality signals warrant controlled monitoring or testing."
    return "Low scale and low growth with no strong productivity or strategic signal."


def recommendation_group_entry(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "final_fineline": record.get("final_fineline"),
        "primary_current_sales_value": record.get("primary_current_sales_value"),
        "category_share": record.get("category_share"),
        "primary_yoy_growth_pct": record.get("primary_yoy_growth_pct"),
        "growth_driver_label": record.get("growth_driver_label"),
        "sku_productivity_label": record.get("sku_productivity_label"),
        "sku_mix_growth_label": record.get("sku_mix_growth_label"),
        "top3_sku_share": record.get("top3_sku_share"),
        "scale_label": record.get("scale_label"),
        "growth_label": record.get("growth_label"),
        "growth_decision_label": record.get("growth_decision_label"),
        "concentration_label": record.get("concentration_label"),
        "quadrant": record.get("quadrant"),
        "opportunity_type": record.get("opportunity_type"),
        "opportunity_rationale": record.get("opportunity_rationale"),
        "recommendation": record.get("recommendation"),
    }


def build_recommendation_groups(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = {
        "priority_investment": [],
        "sku_validation_required": [],
        "defend_or_refresh": [],
        "small_scale_test": [],
        "deprioritized": [],
        "new_or_reactivated": [],
    }
    for record in records:
        entry = recommendation_group_entry(record)
        scale_label = record.get("scale_label")
        growth_label = record.get("growth_label")
        concentration_label = record.get("concentration_label")
        growth_for_quadrant = growth_for_decision(growth_label)

        if scale_label == "high_scale" and growth_for_quadrant == "high_growth" and concentration_label != "hit_driven":
            groups["priority_investment"].append(entry)
        if concentration_label == "hit_driven":
            groups["sku_validation_required"].append(entry)
        if scale_label == "high_scale" and growth_for_quadrant != "high_growth":
            groups["defend_or_refresh"].append(entry)
        if scale_label == "low_scale" and growth_for_quadrant == "high_growth":
            groups["small_scale_test"].append(entry)
        if scale_label == "low_scale" and growth_for_quadrant != "high_growth":
            groups["deprioritized"].append(entry)
        if growth_label == "new_or_reactivated":
            groups["new_or_reactivated"].append(entry)
    return groups


def build_opportunity_groups(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = {
        "new_product_opportunity": [],
        "refresh_or_repack_opportunity": [],
        "space_expansion_candidate": [],
        "sku_rationalization_candidate": [],
        "supplier_validation_required": [],
        "watchlist": [],
        "deprioritize": [],
    }
    for record in records:
        opportunity_type = record.get("opportunity_type")
        if opportunity_type in groups:
            groups[opportunity_type].append(recommendation_group_entry(record))
    return groups


STANDARD_FACT_METRICS = [
    "primary_current_sales_value",
    "primary_prior_sales_value",
    "category_sales_value",
    "category_share",
    "primary_yoy_growth_pct",
    "rolling_52w_yoy_growth_pct",
    "primary_current_sales_units",
    "primary_prior_sales_units",
    "primary_unit_growth_pct",
    "primary_current_asp",
    "primary_prior_asp",
    "primary_asp_growth_pct",
    "primary_current_active_sku_count",
    "primary_prior_active_sku_count",
    "active_sku_count_growth_pct",
    "primary_current_sales_per_active_sku",
    "primary_prior_sales_per_active_sku",
    "sales_per_active_sku_growth_pct",
    "matched_sku_count",
    "current_only_sku_count",
    "prior_only_sku_count",
    "matched_sku_current_sales_value",
    "matched_sku_prior_sales_value",
    "matched_sku_yoy_growth_pct",
    "current_only_sku_sales_value",
    "prior_only_sku_sales_value",
    "new_sku_sales_share",
    "discontinued_sku_prior_sales_share",
    "top3_sku_sales_value",
    "top3_sku_share",
]


STANDARD_SIGNAL_LABELS = [
    "scale_label",
    "growth_label",
    "growth_decision_label",
    "concentration_label",
    "quadrant",
    "growth_driver_label",
    "sku_productivity_label",
    "sku_mix_growth_label",
    "opportunity_type",
]


def compact_dict(source: dict[str, Any], keys: list[str]) -> dict[str, Any]:
    return {key: source.get(key) for key in keys if source.get(key) is not None}


def build_standardized_facts(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    for record in records:
        facts.append(
            {
                "entity_type": "final_fineline",
                "entity_key": record.get("final_fineline"),
                "metrics": compact_dict(record, STANDARD_FACT_METRICS),
                "top3_items": record.get("top3_items", []),
                "period": {
                    "primary_yoy_mode": record.get("primary_yoy_mode"),
                    "analysis_window_current": record.get("analysis_window_current"),
                    "analysis_window_prior": record.get("analysis_window_prior"),
                },
            }
        )
    return facts


def build_standardized_signals(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    signals: list[dict[str, Any]] = []
    for record in records:
        signals.append(
            {
                "entity_type": "final_fineline",
                "entity_key": record.get("final_fineline"),
                "labels": compact_dict(record, STANDARD_SIGNAL_LABELS),
                "flags": {
                    "data_quality_flags": record.get("data_quality_flags", []),
                    "period_alignment_flags": record.get("period_alignment_flags", []),
                    "space_expansion_opportunity": bool(record.get("space_expansion_opportunity")),
                    "fixed_supplier": bool(record.get("fixed_supplier")),
                },
            }
        )
    return signals


def candidate_insight_type(record: dict[str, Any]) -> str:
    if record.get("concentration_label") == "hit_driven":
        return "sku_validation_risk"
    if record.get("growth_label") == "new_or_reactivated":
        return "new_or_reactivated_validation"
    if record.get("growth_decision_label") == "high_growth":
        return "growth_opportunity"
    if record.get("scale_label") == "high_scale":
        return "defend_or_refresh"
    return "deprioritization"


def build_candidate_insight_statement(record: dict[str, Any]) -> str:
    fineline = record.get("final_fineline")
    opportunity_type = record.get("opportunity_type")
    growth = record.get("growth_label")
    scale = record.get("scale_label")
    concentration = record.get("concentration_label")
    rationale = record.get("opportunity_rationale")
    return (
        f"{fineline} is classified as {opportunity_type}. "
        f"The key signals are scale={scale}, growth={growth}, and concentration={concentration}. "
        f"{rationale}"
    )


def build_candidate_insights(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    insights: list[dict[str, Any]] = []
    for record in records:
        insights.append(
            {
                "entity_type": "final_fineline",
                "entity_key": record.get("final_fineline"),
                "insight_type": candidate_insight_type(record),
                "statement": build_candidate_insight_statement(record),
                "recommendation": record.get("recommendation"),
                "opportunity_rationale": record.get("opportunity_rationale"),
                "evidence_metrics": [
                    key for key in [
                        "primary_current_sales_value",
                        "category_share",
                        "primary_yoy_growth_pct",
                        "top3_sku_share",
                        "primary_unit_growth_pct",
                        "primary_asp_growth_pct",
                        "primary_current_sales_per_active_sku",
                        "new_sku_sales_share",
                    ] if record.get(key) is not None
                ],
                "evidence_signals": [
                    value for value in [
                        record.get("scale_label"),
                        record.get("growth_label"),
                        record.get("growth_decision_label"),
                        record.get("concentration_label"),
                        record.get("growth_driver_label"),
                        record.get("sku_productivity_label"),
                        record.get("sku_mix_growth_label"),
                        record.get("opportunity_type"),
                    ] if value
                ],
            }
        )
    return insights


def build_standardized_analysis_result(
    records: list[dict[str, Any]],
    summary: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schema_version": "standardized_analysis_result.v1",
        "analysis_type": "fineline_investment_analysis",
        "grain": "final_fineline",
        "summary": summary,
        "facts": build_standardized_facts(records),
        "signals": build_standardized_signals(records),
        "candidate_insights": build_candidate_insights(records),
    }


def table_row(record: dict[str, Any]) -> str:
    return (
        f"| {record['final_fineline']} | {money(record['primary_current_sales_value'])} | "
        f"{pct(record['category_share'])} | {pct(record['primary_yoy_growth_pct'])} | "
        f"{pct(record['rolling_52w_yoy_growth_pct'])} | {pct(record['top3_sku_share'])} | "
        f"{record['quadrant']} | {record['recommendation']} |"
    )


def build_quadrant_plot(records: list[dict[str, Any]], top_scale_share: float | None = None) -> dict[str, Any]:
    high_scale_shares = [
        float(record["category_share"])
        for record in records
        if record.get("scale_label") == "high_scale" and record.get("category_share") is not None
    ]
    scale_cutoff = min(high_scale_shares) if high_scale_shares else 0.0
    points = []
    for record in records:
        points.append(
            {
                "final_fineline": record["final_fineline"],
                "x_primary_yoy_growth_pct": record.get("primary_yoy_growth_pct"),
                "y_category_share": record.get("category_share"),
                "size_current_sales_value": record.get("primary_current_sales_value", 0),
                "concentration_label": record.get("concentration_label"),
                "quadrant": record.get("quadrant"),
            }
        )
    return {
        "x_axis": "primary_yoy_growth_pct",
        "y_axis": "category_share",
        "y_display_scale": "sqrt",
        "x_cutoff": 0.0,
        "y_cutoff": scale_cutoff,
        "top_scale_share": top_scale_share,
        "points": points,
    }


def visualization_point(record: dict[str, Any], *, show_label: bool) -> dict[str, Any]:
    return {
        "final_fineline": record.get("final_fineline"),
        "primary_yoy_growth_pct": record.get("primary_yoy_growth_pct"),
        "category_share": record.get("category_share"),
        "primary_current_sales_value": record.get("primary_current_sales_value"),
        "rolling_52w_yoy_growth_pct": record.get("rolling_52w_yoy_growth_pct"),
        "top3_sku_share": record.get("top3_sku_share"),
        "growth_label": record.get("growth_label"),
        "concentration_label": record.get("concentration_label"),
        "opportunity_type": record.get("opportunity_type"),
        "recommendation": record.get("recommendation"),
        "show_label": show_label,
    }


def build_visualization_specs(records: list[dict[str, Any]], top_scale_share: float | None = None) -> list[dict[str, Any]]:
    sorted_by_share = sorted(records, key=lambda record: float(record.get("category_share") or 0), reverse=True)
    outlier = sorted_by_share[0] if sorted_by_share else None
    outlier_key = outlier.get("final_fineline") if outlier else None
    top_label_keys = {
        record.get("final_fineline")
        for record in sorted_by_share[:5]
    }

    def should_show_label(record: dict[str, Any]) -> bool:
        return (
            record.get("final_fineline") in top_label_keys
            or record.get("growth_label") == "meaningful_growth"
            or record.get("concentration_label") == "hit_driven"
        )

    full_points = [visualization_point(record, show_label=should_show_label(record)) for record in records]
    zoomed_records = [
        record for record in records
        if record.get("final_fineline") != outlier_key
    ] if len(records) > 1 else records
    zoomed_points = [
        visualization_point(record, show_label=should_show_label(record)) for record in zoomed_records
    ]

    base = {
        "chart_type": "scatter_quadrant",
        "x": "primary_yoy_growth_pct",
        "y": "category_share",
        "size": "primary_current_sales_value",
        "color": "concentration_label",
        "x_cutoff": 0.0,
        "y_cutoff": (build_quadrant_plot(records, top_scale_share).get("y_cutoff") or 0.0),
        "top_scale_share": top_scale_share,
    }
    return [
        {
            **base,
            "chart_id": "full_market_quadrant",
            "title": "Full Market View",
            "description": "Includes all Final Finelines and shows absolute scale, including outliers.",
            "outlier_policy": "include_all",
            "excluded_outlier": None,
            "points": full_points,
        },
        {
            **base,
            "chart_id": "zoomed_opportunity_quadrant",
            "title": "Zoomed Opportunity View",
            "description": "Excludes the largest category-share outlier to make other Final Finelines easier to compare.",
            "outlier_policy": "exclude_largest_category_share",
            "excluded_outlier": outlier_key,
            "points": zoomed_points,
        },
    ]


def html_escape(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def html_money(value: float | None) -> str:
    if value is None or pd.isna(value):
        return "N/A"
    return money(float(value))


def html_money_2(value: float | None) -> str:
    if value is None or pd.isna(value):
        return "N/A"
    return f"${float(value):,.2f}"


def html_number(value: float | None) -> str:
    if value is None or pd.isna(value):
        return "N/A"
    return f"{float(value):,.0f}"


def concentration_color(label: str | None) -> str:
    return {
        "broad_based": "#15803d",
        "moderate_concentration": "#d97706",
        "hit_driven": "#dc2626",
        "no_current_sales": "#6b7280",
    }.get(label or "", "#2563eb")


def build_quadrant_svg(payload: dict[str, Any]) -> str:
    records = payload.get("finelines", [])
    plot = payload.get("quadrant_plot") or build_quadrant_plot(records)
    width, height = 980, 560
    left, right, top, bottom = 88, 36, 36, 82
    plot_width = width - left - right
    plot_height = height - top - bottom
    values_x = [
        float(point["x_primary_yoy_growth_pct"])
        for point in plot.get("points", [])
        if point.get("x_primary_yoy_growth_pct") is not None
    ] + [0.0]
    values_y = [
        float(point["y_category_share"])
        for point in plot.get("points", [])
        if point.get("y_category_share") is not None
    ] + [float(plot.get("y_cutoff") or 0), 0.0]
    x_min, x_max = min(values_x), max(values_x)
    if x_min == x_max:
        x_min -= 0.10
        x_max += 0.10
    else:
        pad = (x_max - x_min) * 0.15
        x_min -= pad
        x_max += pad
    y_min, y_max = 0.0, max(values_y)
    y_max = y_max * 1.18 if y_max > 0 else 0.10
    y_display_scale = plot.get("y_display_scale", "sqrt")

    def y_display(value: float | None) -> float:
        numeric = 0.0 if value is None or pd.isna(value) else max(0.0, float(value))
        if y_display_scale == "sqrt":
            return math.sqrt(numeric)
        return numeric

    y_min_display = y_display(y_min)
    y_max_display = y_display(y_max)

    max_sales = max([float(point.get("size_current_sales_value") or 0) for point in plot.get("points", [])] + [1.0])

    def sx(value: float | None) -> float:
        numeric = 0.0 if value is None or pd.isna(value) else float(value)
        return left + ((numeric - x_min) / (x_max - x_min)) * plot_width

    def sy(value: float | None) -> float:
        numeric = y_display(value)
        return top + (1 - ((numeric - y_min_display) / (y_max_display - y_min_display))) * plot_height

    def radius(value: float | None) -> float:
        numeric = max(0.0, float(value or 0))
        return 6 + math.sqrt(numeric / max_sales) * 14

    x_cut = sx(float(plot.get("x_cutoff") or 0))
    y_cut = sy(float(plot.get("y_cutoff") or 0))
    grid = [
        f'<line x1="{left}" y1="{top + plot_height}" x2="{left + plot_width}" y2="{top + plot_height}" class="axis"/>',
        f'<line x1="{left}" y1="{top}" x2="{left}" y2="{top + plot_height}" class="axis"/>',
        f'<line x1="{x_cut:.1f}" y1="{top}" x2="{x_cut:.1f}" y2="{top + plot_height}" class="cut-line"/>',
        f'<line x1="{left}" y1="{y_cut:.1f}" x2="{left + plot_width}" y2="{y_cut:.1f}" class="cut-line"/>',
        f'<text x="{x_cut + 6:.1f}" y="{top + 18}" class="axis-note">YoY = 0%</text>',
        f'<text x="{left + 8}" y="{y_cut - 8:.1f}" class="axis-note">高体量 cutoff {pct(plot.get("y_cutoff"))}</text>',
        f'<text x="{left + plot_width - 220}" y="{top + 18}" class="axis-note">Y轴使用 sqrt 视觉缩放，数值仍为真实品类占比</text>',
        f'<text x="{left + plot_width / 2:.1f}" y="{height - 24}" class="axis-label">主 YoY</text>',
        f'<text x="22" y="{top + plot_height / 2:.1f}" class="axis-label vertical">品类占比</text>',
        f'<text x="{left + 12}" y="{top + 22}" class="quad-label">高体量 + 低增长</text>',
        f'<text x="{x_cut + 12:.1f}" y="{top + 22}" class="quad-label">高体量 + 高增长</text>',
        f'<text x="{left + 12}" y="{y_cut + 24:.1f}" class="quad-label">低体量 + 低增长</text>',
        f'<text x="{x_cut + 12:.1f}" y="{y_cut + 24:.1f}" class="quad-label">低体量 + 高增长</text>',
    ]
    points = []
    for point in plot.get("points", []):
        x = sx(point.get("x_primary_yoy_growth_pct"))
        y = sy(point.get("y_category_share"))
        r = radius(point.get("size_current_sales_value"))
        color = concentration_color(point.get("concentration_label"))
        label = html_escape(point.get("final_fineline"))
        title = (
            f"{point.get('final_fineline')} | 主YoY {pct(point.get('x_primary_yoy_growth_pct'))} | "
            f"品类占比 {pct(point.get('y_category_share'))} | "
            f"销售额 {money(float(point.get('size_current_sales_value') or 0))}"
        )
        points.append(
            f'<g><circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{color}" fill-opacity="0.82">'
            f"<title>{html_escape(title)}</title></circle>"
            f'<text x="{x + r + 4:.1f}" y="{y + 4:.1f}" class="point-label">{label}</text></g>'
        )
    return (
        f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="Fineline 四象限图">'
        + "".join(grid + points)
        + "</svg>"
    )


def read_echarts_runtime() -> str | None:
    if not ECHARTS_RUNTIME_PATH.is_file():
        return None
    return ECHARTS_RUNTIME_PATH.read_text(encoding="utf-8")


def echarts_symbol_size(value: float | None, max_sales: float) -> float:
    numeric = max(0.0, float(value or 0))
    if max_sales <= 0:
        return 12.0
    return 10.0 + math.sqrt(numeric / max_sales) * 26.0


def echarts_series_for_points(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    labels = ["broad_based", "moderate_concentration", "hit_driven", "no_current_sales"]
    max_sales = max([float(point.get("primary_current_sales_value") or 0) for point in points] + [1.0])
    series: list[dict[str, Any]] = []
    for label in labels:
        label_points = [point for point in points if (point.get("concentration_label") or "no_current_sales") == label]
        if not label_points:
            continue
        series.append(
            {
                "name": label,
                "type": "scatter",
                "data": [
                    {
                        "name": point.get("final_fineline"),
                        "value": [
                            point.get("primary_yoy_growth_pct"),
                            point.get("category_share"),
                            point.get("primary_current_sales_value"),
                        ],
                        "symbolSize": echarts_symbol_size(point.get("primary_current_sales_value"), max_sales),
                        "itemStyle": {"color": concentration_color(point.get("concentration_label"))},
                        "label": {
                            "show": bool(point.get("show_label")),
                            "formatter": "{b}",
                            "position": "right",
                            "fontSize": 11,
                        },
                        "detail": point,
                    }
                    for point in label_points
                ],
                "emphasis": {"focus": "series"},
            }
        )
    return series


def echarts_option_for_spec(spec: dict[str, Any]) -> dict[str, Any]:
    points = spec.get("points", [])
    y_values = [float(point.get("category_share") or 0) for point in points] + [0.0]
    x_values = [float(point.get("primary_yoy_growth_pct") or 0) for point in points] + [0.0]
    y_max = max(y_values) * 1.2 if max(y_values) > 0 else 0.1
    x_min, x_max = min(x_values), max(x_values)
    if x_min == x_max:
        x_min -= 0.1
        x_max += 0.1
    else:
        pad = (x_max - x_min) * 0.18
        x_min -= pad
        x_max += pad
    series = echarts_series_for_points(points)
    if series:
        series[0]["markLine"] = {
            "silent": True,
            "symbol": "none",
            "lineStyle": {"type": "dashed", "color": "#9ca3af"},
            "label": {"color": "#4b5563", "fontSize": 11},
            "data": [
                {"xAxis": float(spec.get("x_cutoff") or 0), "name": "YoY = 0%"},
                {"yAxis": float(spec.get("y_cutoff") or 0), "name": "High-scale cutoff"},
            ],
        }
    return {
        "title": {
            "text": spec.get("title"),
            "subtext": spec.get("description"),
            "left": 4,
            "top": 0,
            "textStyle": {"fontSize": 16},
            "subtextStyle": {"fontSize": 12},
        },
        "legend": {"top": 56, "left": 4, "type": "scroll"},
        "grid": {"left": 72, "right": 32, "top": 104, "bottom": 76},
        "tooltip": {
            "trigger": "item",
            "confine": True,
            "formatter": "__FINELINE_TOOLTIP__",
        },
        "xAxis": {
            "type": "value",
            "name": "Primary YoY",
            "min": x_min,
            "max": x_max,
            "axisLabel": {"formatter": "__PCT_AXIS__"},
            "splitLine": {"lineStyle": {"type": "dashed"}},
        },
        "yAxis": {
            "type": "value",
            "name": "Category Share",
            "min": 0,
            "max": y_max,
            "axisLabel": {"formatter": "__PCT_AXIS__"},
            "splitLine": {"lineStyle": {"type": "dashed"}},
        },
        "dataZoom": [
            {"type": "inside", "xAxisIndex": 0},
            {"type": "inside", "yAxisIndex": 0},
            {"type": "slider", "xAxisIndex": 0, "bottom": 26, "height": 18},
        ],
        "series": series,
    }


def echarts_option_json(option: dict[str, Any]) -> str:
    text = json.dumps(option, ensure_ascii=False, default=to_jsonable)
    text = text.replace('"__FINELINE_TOOLTIP__"', "finelineTooltip")
    text = text.replace('"__PCT_AXIS__"', "pctAxis")
    return text


def build_echarts_quadrant_html(payload: dict[str, Any]) -> str:
    runtime = read_echarts_runtime()
    if runtime is None:
        return (
            "<p class=\"chart-note\">ECharts runtime was not found locally. "
            "Showing static SVG fallback.</p>"
            + build_quadrant_svg(payload)
        )

    specs = payload.get("visualization_specs") or build_visualization_specs(payload.get("finelines", []))
    chart_blocks = []
    init_scripts = []
    for spec in specs:
        chart_id = html_escape(spec["chart_id"])
        excluded = spec.get("excluded_outlier")
        note = (
            f"<p class=\"chart-note\">Excluded outlier in this view: <strong>{html_escape(excluded)}</strong>. "
            "The full market view above still includes it.</p>"
            if excluded else ""
        )
        chart_blocks.append(
            f"<section class=\"chart-panel\"><div id=\"{chart_id}\" class=\"echart\"></div>{note}</section>"
        )
        init_scripts.append(
            f"""
const chart_{chart_id} = echarts.init(document.getElementById('{chart_id}'));
chart_{chart_id}.setOption({echarts_option_json(echarts_option_for_spec(spec))});
window.addEventListener('resize', () => chart_{chart_id}.resize());
"""
        )

    return f"""
<div class="chart-note">Point color shows concentration risk. Point size shows current-period sales. Use hover tooltip and zoom controls to inspect crowded areas.</div>
{''.join(chart_blocks)}
<script>{runtime}</script>
<script>
function pctAxis(value) {{
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return (value * 100).toFixed(0) + '%';
}}
function moneyText(value) {{
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return '$' + Number(value).toLocaleString(undefined, {{maximumFractionDigits: 0}});
}}
function pctText(value) {{
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return (value * 100).toFixed(1) + '%';
}}
function finelineTooltip(params) {{
  const d = params.data.detail || {{}};
  return [
    '<strong>' + (d.final_fineline || params.name) + '</strong>',
    'Current Sales: ' + moneyText(d.primary_current_sales_value),
    'Category Share: ' + pctText(d.category_share),
    'Primary YoY: ' + pctText(d.primary_yoy_growth_pct),
    'Rolling 52w YoY: ' + pctText(d.rolling_52w_yoy_growth_pct),
    'Top 3 SKU Share: ' + pctText(d.top3_sku_share),
    'Growth Label: ' + (d.growth_label || 'N/A'),
    'Concentration: ' + (d.concentration_label || 'N/A'),
    'Opportunity Type: ' + (d.opportunity_type || 'N/A'),
    'Recommendation: ' + (d.recommendation || 'N/A')
  ].join('<br>');
}}
{''.join(init_scripts)}
</script>
"""


def build_html(payload: dict[str, Any]) -> str:
    records = payload["finelines"]
    metadata = payload["metadata"]
    period = payload["period"]
    profile = payload.get("category_profile") or {}
    summary = payload.get("summary") or {}
    yoy_label = summary.get("primary_yoy_label") or primary_yoy_label(profile, period.get("period_mode"))

    explanation_items = "\n".join(
        f"<li><strong>{html_escape(key)}</strong>：{html_escape(value)}</li>"
        for key, value in (payload.get("metric_explanations") or METRIC_EXPLANATIONS).items()
    )
    fineline_rows = "\n".join(
        "<tr>"
        f"<td>{html_escape(record['final_fineline'])}</td>"
        f"<td class=\"num\">{html_money(record.get('primary_current_sales_value'))}</td>"
        f"<td class=\"num\">{html_money(record.get('primary_prior_sales_value'))}</td>"
        f"<td class=\"num\">{pct(record.get('category_share'))}</td>"
        f"<td class=\"num\">{pct(record.get('primary_yoy_growth_pct'))}</td>"
        f"<td class=\"num\">{pct(record.get('rolling_52w_yoy_growth_pct'))}</td>"
        f"<td class=\"num\">{html_number(record.get('primary_current_sales_units'))}</td>"
        f"<td class=\"num\">{pct(record.get('primary_unit_growth_pct'))}</td>"
        f"<td class=\"num\">{html_money_2(record.get('primary_current_asp'))}</td>"
        f"<td class=\"num\">{pct(record.get('primary_asp_growth_pct'))}</td>"
        f"<td class=\"num\">{record.get('primary_current_active_sku_count')}</td>"
        f"<td class=\"num\">{record.get('primary_prior_active_sku_count')}</td>"
        f"<td class=\"num\">{html_money(record.get('primary_current_sales_per_active_sku'))}</td>"
        f"<td class=\"num\">{pct(record.get('matched_sku_yoy_growth_pct'))}</td>"
        f"<td class=\"num\">{pct(record.get('new_sku_sales_share'))}</td>"
        f"<td class=\"num\">{pct(record.get('top3_sku_share'))}</td>"
        f"<td>{html_escape(record.get('scale_label'))}</td>"
        f"<td>{html_escape(record.get('growth_label'))}</td>"
        f"<td>{html_escape(record.get('growth_decision_label'))}</td>"
        f"<td>{html_escape(record.get('growth_driver_label'))}</td>"
        f"<td>{html_escape(record.get('sku_productivity_label'))}</td>"
        f"<td>{html_escape(record.get('sku_mix_growth_label'))}</td>"
        f"<td>{html_escape(record.get('concentration_label'))}</td>"
        f"<td>{html_escape(record.get('quadrant'))}</td>"
        f"<td>{html_escape(record.get('opportunity_type'))}</td>"
        f"<td>{html_escape(record.get('opportunity_rationale'))}</td>"
        f"<td>{html_escape(record.get('recommendation'))}</td>"
        "</tr>"
        for record in records
    )
    top3_rows = []
    for record in records:
        for item in record.get("top3_items", []):
            top3_rows.append(
                "<tr>"
                f"<td>{html_escape(record['final_fineline'])}</td>"
                f"<td class=\"num\">{item['rank']}</td>"
                f"<td>{html_escape(item.get('upc'))}</td>"
                f"<td>{html_escape(item.get('item_name'))}</td>"
                f"<td class=\"num\">{html_money(item.get('sales_value'))}</td>"
                f"<td class=\"num\">{html_number(item.get('sales_units'))}</td>"
                f"<td class=\"num\">{pct(item.get('fineline_sales_share'))}</td>"
                "</tr>"
            )
    quality_notes = []
    if metadata.get("blank_final_fineline_row_count", 0):
        quality_notes.append(f"有 {metadata['blank_final_fineline_row_count']} 行缺少 Final Fineline，未纳入分析。")
    if period.get("category_profile_flags"):
        quality_notes.append(f"Category profile flags: {', '.join(period['category_profile_flags'])}")
    if period.get("period_alignment_flags"):
        quality_notes.append(f"Period alignment flags: {', '.join(period['period_alignment_flags'])}")
    quality_html = "\n".join(f"<li>{html_escape(note)}</li>" for note in quality_notes) or "<li>未发现主要数据质量或 period alignment flags。</li>"

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Fineline 投资讨论价值分析</title>
  <style>
    body {{ font-family: Arial, "Microsoft YaHei", sans-serif; color: #111827; margin: 28px; line-height: 1.45; }}
    h1 {{ font-size: 26px; margin: 0 0 12px; }}
    h2 {{ font-size: 18px; margin: 28px 0 10px; }}
    .summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin: 12px 0 18px; }}
    .summary div {{ background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; }}
    .metric-explanations {{ background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 16px; }}
    .metric-explanations li {{ margin: 6px 0; }}
    svg {{ width: 100%; max-width: 1120px; height: auto; border: 1px solid #e5e7eb; border-radius: 6px; background: #ffffff; }}
    .chart-panel {{ border: 1px solid #e5e7eb; border-radius: 6px; background: #ffffff; padding: 10px; margin: 12px 0 18px; }}
    .echart {{ width: 100%; height: 560px; }}
    .chart-note {{ color: #4b5563; font-size: 13px; margin: 8px 0 10px; }}
    .axis {{ stroke: #374151; stroke-width: 1.2; }}
    .cut-line {{ stroke: #9ca3af; stroke-width: 1.1; stroke-dasharray: 5 5; }}
    .axis-label {{ fill: #111827; font-size: 15px; font-weight: 700; }}
    .axis-note, .quad-label {{ fill: #4b5563; font-size: 12px; }}
    .vertical {{ transform: rotate(-90deg); transform-origin: 22px center; }}
    .point-label {{ fill: #111827; font-size: 11px; }}
    table {{ border-collapse: collapse; width: 100%; font-size: 13px; margin-top: 8px; }}
    th, td {{ border: 1px solid #e5e7eb; padding: 7px 8px; vertical-align: top; }}
    th {{ background: #f3f4f6; text-align: left; position: sticky; top: 0; }}
    .num {{ text-align: right; white-space: nowrap; }}
    .table-wrap {{ overflow-x: auto; }}
    .legend {{ display: flex; flex-wrap: wrap; gap: 12px; margin: 8px 0 12px; font-size: 13px; }}
    .swatch {{ display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; }}
  </style>
</head>
<body>
  <h1>Fineline 投资讨论价值分析</h1>
  <section class="summary">
    <div><strong>Category</strong><br>{html_escape(metadata.get('category'))}</div>
    <div><strong>主 YoY 口径</strong><br>{html_escape(yoy_label)}</div>
    <div><strong>当前期</strong><br>{html_escape(period.get('current_period_start'))} - {html_escape(period.get('current_period_end'))}<br>{html_escape(period.get('current_period_start_date'))} - {html_escape(period.get('current_period_end_date'))}</div>
    <div><strong>对比期</strong><br>{html_escape(period.get('prior_period_start'))} - {html_escape(period.get('prior_period_end'))}<br>{html_escape(period.get('prior_period_start_date'))} - {html_escape(period.get('prior_period_end_date'))}</div>
    <div><strong>可分析 Final Fineline 数量</strong><br>{len(records)}</div>
  </section>

  <h2>指标说明</h2>
  <ul id="metric-explanations" class="metric-explanations">
    {explanation_items}
  </ul>

  <h2>四象限图</h2>
  <div class="legend">
    <span><span class="swatch" style="background:#15803d"></span>结构性较强</span>
    <span><span class="swatch" style="background:#d97706"></span>中等集中</span>
    <span><span class="swatch" style="background:#dc2626"></span>爆款驱动风险高</span>
    <span><span class="swatch" style="background:#6b7280"></span>无当前期销售</span>
  </div>
  {build_echarts_quadrant_html(payload)}

  <h2>Fineline 维度结果表</h2>
  <div id="fineline-results" class="table-wrap">
    <table>
      <thead><tr><th>Final Fineline</th><th>当前期销售额</th><th>对比期销售额</th><th>品类占比</th><th>主 YoY</th><th>Rolling 52w YoY</th><th>当前期 Units</th><th>Unit Growth</th><th>当前期 ASP</th><th>ASP Growth</th><th>当前 Active SKU</th><th>对比 Active SKU</th><th>Sales / Active SKU</th><th>Matched SKU YoY</th><th>New SKU Sales Share</th><th>Top 3 SKU 占比</th><th>Scale Label</th><th>Growth Label</th><th>Growth Decision</th><th>Growth Driver</th><th>SKU Productivity</th><th>SKU Mix Label</th><th>Concentration Label</th><th>Quadrant</th><th>Opportunity Type</th><th>Opportunity Rationale</th><th>Recommendation</th></tr></thead>
      <tbody>{fineline_rows}</tbody>
    </table>
  </div>

  <h2>Top 3 SKU 明细表</h2>
  <div id="top3-items" class="table-wrap">
    <table>
      <thead><tr><th>Final Fineline</th><th>Rank</th><th>UPC</th><th>Item Name</th><th>当前期销售额</th><th>当前期销售数量</th><th>占该 Fineline 当前期销售额比例</th></tr></thead>
      <tbody>{''.join(top3_rows)}</tbody>
    </table>
  </div>

  <h2>数据质量 / Period Alignment Flags</h2>
  <ul>{quality_html}</ul>
</body>
</html>
"""


def build_markdown(payload: dict[str, Any]) -> str:
    records = payload["finelines"]
    metadata = payload["metadata"]
    period = payload["period"]
    high_priority = [
        item for item in records
        if item["quadrant"] == "高体量 + 高增长" and item["concentration_label"] != "hit_driven"
    ]
    high_risk = [
        item for item in records
        if item["concentration_label"] == "hit_driven" or item["growth_label"] == "new_or_reactivated"
    ]
    top_record = records[0] if records else None
    profile = payload.get("category_profile") or {}
    summary = payload.get("summary") or {}
    yoy_label = summary.get("primary_yoy_label") or primary_yoy_label(profile, period.get("period_mode"))

    lines = [
        "# Fineline 投资讨论价值分析",
        "",
        f"- 分析 Category：{metadata['category']}",
        f"- 主 YoY 口径：{yoy_label}",
        f"- 当前期：{period.get('current_period_start')} - {period.get('current_period_end')}",
        f"- 对比期：{period.get('prior_period_start')} - {period.get('prior_period_end')}",
        f"- 可分析 Final Fineline 数：{len(records)}",
        "",
    ]
    if top_record:
        lines.extend(
            [
                "## 核心结论",
                "",
                (
                    f"{top_record['final_fineline']} 是当前主分析期销售占比最高的 Final Fineline，"
                    f"当前期销售额 {money(top_record['primary_current_sales_value'])}，"
                    f"品类占比 {pct(top_record['category_share'])}，"
                    f"主 YoY {pct(top_record['primary_yoy_growth_pct'])}。"
                ),
                "",
            ]
        )

    lines.extend(
        [
            "## 四象限结果",
            "",
            "| Final Fineline | 主分析期销售额 | 品类占比 | 主 YoY | Rolling 52w YoY | Top 3 SKU 占比 | 象限 | 建议动作 |",
            "|---|---:|---:|---:|---:|---:|---|---|",
        ]
    )
    lines.extend(table_row(record) for record in records)

    lines.extend(["", "## 高优先级 Fineline", ""])
    if high_priority:
        lines.extend(f"- {item['final_fineline']}：{item['recommendation']}" for item in high_priority[:5])
    else:
        lines.append("- 暂无同时满足高体量、高增长且非高度爆款驱动的 Fineline。")

    lines.extend(["", "## 高风险 Fineline", ""])
    if high_risk:
        lines.extend(
            f"- {item['final_fineline']}：{item['recommendation']}"
            for item in high_risk[:8]
        )
    else:
        lines.append("- 未发现 Top 3 SKU 占比超过 70% 或对比期为 0 的明显风险项。")

    quality_notes = []
    if metadata.get("blank_final_fineline_row_count", 0):
        quality_notes.append(f"有 {metadata['blank_final_fineline_row_count']} 行缺少 Final Fineline，未纳入象限计算。")
    if period.get("category_profile_flags"):
        quality_notes.append(f"Category profile flags: {', '.join(period['category_profile_flags'])}")
    if period.get("period_alignment_flags"):
        quality_notes.append(f"Period alignment flags: {', '.join(period['period_alignment_flags'])}")
    if quality_notes:
        lines.extend(["", "## 数据质量提示", ""])
        lines.extend(f"- {note}" for note in quality_notes)
    return "\n".join(lines) + "\n"


def to_jsonable(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    raw_df = read_input(Path(args.input_path))
    category_df, metadata = prepare_rows(raw_df, args.category)
    period_df, period_info = assign_periods(category_df)
    records = build_analysis(period_df, args.category, args.top_scale_share, period_info=period_info)
    add_window_fields(records, period_info)

    summary = build_summary(metadata, period_info, records, DEFAULT_PROFILE)
    payload = {
        "metadata": metadata,
        "period": period_info,
        "category_profile": DEFAULT_PROFILE,
        "summary": summary,
        "recommendation_groups": build_recommendation_groups(records),
        "opportunity_groups": build_opportunity_groups(records),
        "standardized_analysis_result": build_standardized_analysis_result(records, summary),
        "quadrant_plot": build_quadrant_plot(records, args.top_scale_share),
        "visualization_specs": build_visualization_specs(records, args.top_scale_share),
        "metric_explanations": build_metric_explanations(DEFAULT_PROFILE),
        "finelines": records,
    }
    json_path = output_dir / "fineline_investment_analysis.json"
    html_path = output_dir / "fineline_investment_report.html"
    markdown_path = output_dir / "fineline_investment_report.md"
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=to_jsonable),
        encoding="utf-8",
    )
    html_path.write_text(build_html(payload), encoding="utf-8")
    markdown_path.write_text(build_markdown(payload), encoding="utf-8")

    print(json.dumps({
        "status": "success",
        "json_path": str(json_path),
        "html_path": str(html_path),
        "markdown_path": str(markdown_path),
        "fineline_count": len(records),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

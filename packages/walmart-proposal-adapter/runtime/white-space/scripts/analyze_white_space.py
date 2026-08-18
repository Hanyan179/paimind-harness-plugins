"""Deterministic analytical core for Kids Crafts white-space analysis."""

from __future__ import annotations

import html
import json
import math
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree as ET

import numpy as np
import pandas as pd


DEFAULT_FINELINES = ("KIDS PAINT", "KIDS PAINT ACCESSORIES", "STYROFOAM", "GLITTER")
# Backward-compatible alias for callers that imported the original constant.
FINELINES = DEFAULT_FINELINES
INVALID_ATTRIBUTE_VALUES = {"", "unknown", "insufficient_data", "not_applicable", "none", "nan"}
SENSITIVITY_PERCENTILES = (0.50, 0.60, 0.75)

METRIC_DEFINITIONS = [
    ("current_sales_value", "UPC / attribute combination", "Sum of Sales Value from fiscal WK31 through the latest complete week.", "Missing sales are treated as 0 after the UPC join."),
    ("prior_sales_value", "UPC / attribute combination", "Sum of Sales Value from prior fiscal WK31 for the same number of weeks.", "Missing prior sales are 0; YoY remains null when this value is 0."),
    ("current_sales_units", "UPC / attribute combination", "Sum of Sales Units in the current WK31-aligned period.", "Missing units are treated as 0."),
    ("prior_sales_units", "UPC / attribute combination", "Sum of Sales Units in the aligned prior period.", "Missing units are treated as 0."),
    ("sales_yoy_growth", "UPC / attribute combination", "current_sales_value / prior_sales_value - 1.", "Null when prior_sales_value is 0."),
    ("units_yoy_growth", "UPC", "current_sales_units / prior_sales_units - 1.", "Null when prior_sales_units is 0."),
    ("current_stores_selling", "UPC", "Mean weekly Stores Selling from WK31 through latest week.", "Weeks with source NA remain excluded from the mean."),
    ("recent_8w_stores_selling", "UPC", "Mean weekly Stores Selling over the latest eight available current-period weeks.", "Uses fewer weeks only when fewer than eight are available."),
    ("current_sales_per_store_week", "UPC", "current_sales_value / current_stores_selling / current period week count.", "Null when mean stores is 0."),
    ("current_units_per_store_week", "UPC", "current_sales_units / current_stores_selling / current period week count.", "Null when mean stores is 0."),
    ("recent_8w_sales_per_store_week", "UPC", "Latest-eight Sales Value / latest-eight mean Stores Selling / latest-eight week count.", "Primary current item-productivity measure; null when stores is 0."),
    ("recent_8w_units_per_store_week", "UPC", "Latest-eight Sales Units / latest-eight mean Stores Selling / latest-eight week count.", "Used as the unit-demand guardrail for price/pack diagnosis."),
    ("current_asp", "UPC", "current_sales_value / current_sales_units.", "Null when current units are 0."),
    ("recent_8w_asp", "UPC", "Latest-eight Sales Value / latest-eight Sales Units.", "Compared with matched-peer P25-P75."),
    ("current_observed_weeks", "UPC", "Distinct current-period weeks with a source row.", "Used for completeness checks."),
    ("recent_8w_observed_weeks", "UPC", "Distinct source weeks in the latest-eight window.", "At least 6 required for expand_distribution."),
    ("recent_8w_max_week_share", "UPC", "Largest single-week Sales Value / total latest-eight Sales Value.", "Must be <=50% for expand_distribution."),
    ("recent_momentum_pct", "UPC", "(recent_8w_sales_per_store_week / previous_8w_sales_per_store_week) - 1. Both windows use their own Sales Value, mean Stores Selling, and observed-week count.", "Null when previous_8w_sales_per_store_week is missing or <=0; expand_distribution requires >=-5%, controlled_recovery_test requires >=+10%."),
    ("recent_momentum_pct", "Attribute combination", "(sum of member-UPC recent_8w_sales_value / sum of member-UPC previous_8w_sales_value) - 1. This is sales momentum, not store-normalized productivity momentum.", "Null when the combination's previous_8w_sales_value is 0; entry requires >=-5%."),
    ("sku_count", "Attribute combination", "Distinct market UPC count carrying the attribute value or pair.", "Minimum 5 for an entry recommendation or retained pair."),
    ("peer_upc_count", "UPC / attribute combination", "Distinct comparable non-Paramont UPC count in the same retained combination.", "Minimum 3 for positive or negative Buyer action."),
    ("our_sku_count", "Attribute combination", "Count of UPCs from scintilla.ParamontItemList within the combination.", "A value of 0 is required for entry-space analysis."),
    ("sales_share", "Attribute combination", "Combination current_sales_value / Final Fineline current Sales Value.", "At least 1% is required to create/retain a pair."),
    ("sku_share", "Attribute combination", "Combination sku_count / Final Fineline distinct UPC count.", "Descriptive market-structure metric."),
    ("our_sales_value", "Attribute combination", "Current Sales Value from mapped Paramont UPCs in the combination.", "Paramont rows without UPC never contribute."),
    ("our_sales_share_within_attribute", "Attribute combination", "our_sales_value / combination current_sales_value.", "Null when combination sales are 0."),
    ("fineline_our_sales_share", "Attribute combination", "Mapped Paramont Sales Value / total Final Fineline Sales Value.", "Used as the baseline for deepen_assortment."),
    ("tag_coverage_rate", "Attribute / combination", "Valid analysis-tag rows / all use_for_analysis tag rows for the attribute.", "At least 80% is required for parent eligibility and entry recommendations."),
    ("top3_sku_share", "Attribute combination", "Sales of the top three market UPCs / combination Sales Value.", "Above 80% is hit-driven and blocks normal entry logic."),
    ("portfolio_concentration", "Our UPCs in combination", "Sales of our top three UPCs / total mapped Paramont sales in the combination.", "Above 80% adds portfolio_concentration_risk."),
    ("median_sales_per_store_week", "Attribute combination", "Median current_sales_per_store_week across UPCs in the combination.", "WK31-aligned productivity reference."),
    ("recent_8w_productivity", "Attribute combination", "Median recent_8w_sales_per_store_week across UPCs in the combination.", "Primary entry productivity signal."),
    ("current_sales_value_percentile", "Attribute combination", "Percent rank of current_sales_value within the same Fineline and analysis level.", "P60/P75 drive entry classification."),
    ("sales_yoy_growth_percentile", "Attribute combination", "Percent rank of sales_yoy_growth within the same Fineline and analysis level.", "Null growth ranks at the bottom through rank fill behavior."),
    ("recent_8w_productivity_percentile", "UPC / attribute combination", "For combinations: percent rank within Fineline and level; for UPCs: share of matched peers with productivity <= our UPC.", "P60 is the leading threshold."),
    ("sku_count_percentile", "Attribute combination", "Percent rank of sku_count within the same Fineline and analysis level.", "P75 plus productivity below P50 indicates crowding."),
    ("wk31_productivity_percentile", "UPC", "Share of matched peers with current_sales_per_store_week <= our UPC.", "Reported for audit; rule uses peer median/P60 values directly."),
    ("distribution_percentile", "UPC", "Share of matched peers with recent_8w_stores_selling <= our UPC.", "Lower values indicate distribution headroom."),
    ("peer_recent_p25", "UPC benchmark", "25th percentile of recent_8w_sales_per_store_week among non-Paramont UPCs in the same retained attribute combination.", "Supports rationalize_or_replace diagnosis."),
    ("peer_recent_p40", "UPC benchmark", "40th percentile of recent_8w_sales_per_store_week among non-Paramont UPCs in the same retained attribute combination.", "Our UPC below this value is recently lagging."),
    ("peer_recent_p60", "UPC benchmark", "60th percentile of recent_8w_sales_per_store_week among non-Paramont UPCs in the same retained attribute combination.", "Our UPC must meet or exceed this value to be leading."),
    ("peer_wk31_median", "UPC benchmark", "Median current_sales_per_store_week among non-Paramont UPCs in the same retained attribute combination.", "Our UPC must meet this value for leading/stable productivity."),
    ("peer_wk31_p60", "UPC benchmark", "60th percentile of current_sales_per_store_week among non-Paramont UPCs in the same retained attribute combination.", "Published for benchmark audit; current item rules use the median."),
    ("peer_distribution_median", "UPC benchmark", "Median latest-eight Stores Selling among matched non-Paramont peers.", "Target distribution and expansion headroom reference."),
    ("peer_asp_p25", "UPC benchmark", "25th percentile of recent_8w_asp among matched non-Paramont peers.", "ASP below this lower bound plus unit lag supports price_pack_review."),
    ("peer_asp_p75", "UPC benchmark", "75th percentile of recent_8w_asp among matched non-Paramont peers.", "ASP above this upper bound plus unit lag supports price_pack_review."),
    ("our_combo_sales_share", "UPC strategy context", "Alias of our_sales_share_within_attribute for the retained context selected for the UPC: mapped Paramont combination sales / total combination sales.", "Compared with 75% of fineline_our_sales_share for deepen_assortment."),
    ("fineline_recent_p60", "UPC guardrail", "P60 recent productivity across all non-Paramont UPCs in the Fineline.", "An item must beat both matched and Fineline P60 to be leading."),
    ("suggested_incremental_stores", "UPC", "max(0, peer_distribution_median - recent_8w_stores_selling).", "Populated as positive headroom only for expand_distribution; otherwise 0."),
    ("directional_13w_upside", "UPC", "suggested_incremental_stores × recent_8w_sales_per_store_week × 13.", "Directional Buyer discussion value, not a demand or supply forecast."),
]

RECOMMENDED_ACTION_RULES = [
    ("expand_distribution", "Request distribution expansion toward the matched-peer median store count.", "Peers >=3; active weeks >=6; recent productivity >= matched-peer P60 and Fineline-peer P60; WK31 productivity >= peer median; momentum >=-5%; recent stores < peer median; max-week share <=50%.", "Highest item-level assignment; selected first across competing attribute contexts."),
    ("controlled_recovery_test", "Keep a controlled test while recent productivity recovery is validated.", "Matched-peer sample is sufficient; recent productivity < peer P40; WK31 productivity < peer median; momentum >=+10%.", "Overrides other lagging diagnoses within the same context."),
    ("price_pack_review", "Review price, pack architecture, and value communication before expansion.", "Lagging productivity; recent units/store/week < peer median; recent ASP outside peer P25-P75.", "Applied after rationalize diagnosis but before recovery; recovery overrides it."),
    ("rationalize_or_replace", "Consider rationalizing or replacing the item before requesting more space.", "Lagging; recent productivity < peer P25; momentum <+10%; distribution >= peer median.", "More severe form of optimize_before_expansion."),
    ("optimize_before_expansion", "Do not expand stores; improve product, placement, price, or communication first.", "Recent productivity < peer P40; WK31 productivity < peer median; distribution >= peer median.", "Base lagging/broad-distribution action."),
    ("deepen_assortment", "Add a differentiated adjacent variant while protecting current productivity.", "Leading on matched and Fineline benchmarks; distribution >= peer median; combination share <75% of our Fineline share.", "Used only when expand_distribution is not triggered."),
    ("defend_leadership", "Protect distribution, availability, and the proven core assortment.", "Leading on matched and Fineline benchmarks; distribution >= peer median; no share-underrepresentation condition.", "Used only when expand_distribution is not triggered."),
    ("monitor_current_item", "Maintain and monitor; no material action threshold is met.", "Sufficient evidence exists, but no leading or lagging action rule is satisfied.", "Neutral default for mapped Paramont UPCs."),
    ("insufficient_peer_sample", "Collect at least three non-Paramont comparable UPCs before recommending action.", "Fewer than 3 matched non-Paramont UPCs in the retained attribute context.", "Blocks positive and negative item recommendations."),
    ("priority_entry", "Prioritize product development and Buyer validation for this attribute space.", "No mapped Paramont UPC; evidence sufficient; momentum >=-5%; all scale/growth/productivity >=P60 OR at least two >=P75; not hit-driven or crowded.", "Highest entry-space action."),
    ("test_entry", "Run a limited SKU and store test before broader entry.", "No mapped Paramont UPC; evidence sufficient; momentum >=-5%; at least two of scale/growth/productivity >=P60.", "Overridden by priority_entry."),
    ("niche_entry", "Test a narrow proposition because productivity is strong but scale is limited.", "No mapped Paramont UPC; evidence sufficient; productivity >=P60; scale <P60; momentum >=-5%.", "Overridden by test_entry or priority_entry."),
    ("avoid_crowded_space", "Do not enter without clear differentiation; SKU density is high relative to productivity.", "No mapped Paramont UPC; sku_count_percentile >=P75 and productivity percentile <P50.", "Blocks positive entry actions."),
    ("avoid_hit_driven_space", "Do not infer broad demand; performance is concentrated in a few leading UPCs.", "No mapped Paramont UPC and top3_sku_share >80%.", "Blocks normal positive entry logic."),
    ("insufficient_evidence", "Collect more comparable product or tag evidence before making an entry decision.", "No mapped Paramont UPC and any of: market UPCs <5, peers <3, tag coverage <80%.", "Blocks positive entry actions."),
    ("market_context", "Use as market context; no material entry signal is present.", "Attribute space does not satisfy another deterministic entry strategy.", "Neutral attribute-space default."),
]


ALIASES = {
    "upc": ("upc", "product_code", "wm_upc_nbr"),
    "item_name": ("item_name", "product_description", "description"),
    "final_fineline": ("final_fineline", "fineline", "reviewed_fineline"),
    "week_date": ("week_date", "week", "date"),
    "fiscal_year": ("fiscal_year",),
    "fiscal_week": ("fiscal_week",),
    "sales_value": ("sales_value", "sales"),
    "sales_units": ("sales_units", "units"),
    "stores_selling": ("stores_selling", "stores_selling_8w"),
    "sales_per_store": ("sales_per_store", "weekly_sales_per_store_value"),
    "units_per_store": ("units_per_store", "weekly_units_per_store"),
    "average_price": ("average_price_per_unit", "average_price", "asp"),
    "report_start_date": ("report_start_date",),
    "report_end_date": ("report_end_date",),
    "groups": ("groups", "group"),
    "attribute_name": ("attribute_name",),
    "attribute_value": ("attribute_value", "final_value"),
    "use_for_analysis": ("use_for_analysis",),
    "generated_at": ("generated_at",),
}


def normalize_column(value: object) -> str:
    text = str(value).strip().lower().replace("%", " percent ")
    return re.sub(r"_+", "_", re.sub(r"[^0-9a-z]+", "_", text)).strip("_")


def normalize_upc(value: object) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return ""
    if re.fullmatch(r"\d+\.0", text):
        text = text[:-2]
    text = re.sub(r"\s+", "", text)
    return text


def truthy(value: object) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def safe_mask(mask: pd.Series) -> pd.Series:
    """Return a strict boolean mask; SQL nullable dtypes can otherwise retain pd.NA."""
    return mask.fillna(False).astype(bool)


def _rename_aliases(df: pd.DataFrame) -> pd.DataFrame:
    clean = df.copy()
    clean.columns = [normalize_column(c) for c in clean.columns]
    for canonical, candidates in ALIASES.items():
        if canonical in clean.columns:
            continue
        found = next((c for c in candidates if c in clean.columns), None)
        if found:
            clean = clean.rename(columns={found: canonical})
    return clean


def _numeric(df: pd.DataFrame, columns: Iterable[str]) -> pd.DataFrame:
    for column in columns:
        if column not in df:
            df[column] = np.nan
        df[column] = pd.to_numeric(df[column], errors="coerce")
    return df


def _xlsx_first_sheet_rows(path: str | Path) -> list[list[str]]:
    """Read scalar values from the first XLSX worksheet without openpyxl."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rel_ns = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
    with zipfile.ZipFile(path) as archive:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", ns):
                shared.append("".join(t.text or "" for t in si.iterfind(".//m:t", ns)))
        wb = ET.fromstring(archive.read("xl/workbook.xml"))
        first = wb.find("m:sheets/m:sheet", ns)
        if first is None:
            return []
        rid = first.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        target = next(r.attrib["Target"] for r in rels.findall("r:Relationship", rel_ns) if r.attrib["Id"] == rid)
        sheet_path = "xl/" + target.lstrip("/") if not target.startswith("xl/") else target
        root = ET.fromstring(archive.read(sheet_path))
        rows: list[list[str]] = []
        for row in root.findall(".//m:sheetData/m:row", ns):
            values: dict[int, str] = {}
            for cell in row.findall("m:c", ns):
                ref = cell.attrib.get("r", "A1")
                letters = re.match(r"[A-Z]+", ref).group(0)
                col = 0
                for char in letters:
                    col = col * 26 + ord(char) - 64
                node = cell.find("m:v", ns)
                value = "" if node is None else (node.text or "")
                if cell.attrib.get("t") == "s" and value:
                    value = shared[int(value)]
                elif cell.attrib.get("t") == "inlineStr":
                    value = "".join(t.text or "" for t in cell.iterfind(".//m:t", ns))
                values[col - 1] = value
            width = max(values, default=-1) + 1
            rows.append([values.get(i, "") for i in range(width)])
        return rows


def read_portfolio_xlsx(path: str | Path) -> pd.DataFrame:
    rows = _xlsx_first_sheet_rows(path)
    if not rows:
        raise ValueError(f"Portfolio workbook is empty: {path}")
    headers = [normalize_column(v) for v in rows[0]]
    width = len(headers)
    data = [(row + [""] * width)[:width] for row in rows[1:]]
    result = pd.DataFrame(data, columns=headers)
    required = {"vendor_stock_id", "wm_upc_nbr"}
    if not required.issubset(result.columns):
        raise ValueError(f"Portfolio workbook must contain {sorted(required)}")
    result["vendor_stock_id"] = result["vendor_stock_id"].astype(str).str.strip()
    result["upc"] = result["wm_upc_nbr"].map(normalize_upc)
    result["portfolio_status"] = np.where(result["upc"].ne(""), "mapped_existing_item", "unmapped_wk31_new_item")
    return result[["vendor_stock_id", "upc", "portfolio_status"]]


@dataclass(frozen=True)
class Periods:
    current_start: pd.Timestamp
    current_end: pd.Timestamp
    prior_start: pd.Timestamp
    prior_end: pd.Timestamp
    week_count: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "current_start": self.current_start.date().isoformat(),
            "current_end": self.current_end.date().isoformat(),
            "prior_start": self.prior_start.date().isoformat(),
            "prior_end": self.prior_end.date().isoformat(),
            "week_count": self.week_count,
        }


def choose_periods(performance: pd.DataFrame) -> Periods:
    valid = performance.dropna(subset=["week_date", "fiscal_year", "fiscal_week"]).copy()
    if valid.empty:
        raise ValueError("Performance data has no valid fiscal dates.")
    valid["fiscal_year"] = valid["fiscal_year"].astype(int)
    valid["fiscal_week"] = valid["fiscal_week"].astype(int)
    end_row = valid.sort_values(["fiscal_year", "fiscal_week", "week_date"]).iloc[-1]
    end_year, end_week = int(end_row["fiscal_year"]), int(end_row["fiscal_week"])
    current_year = end_year if end_week >= 31 else end_year - 1
    calendar_weeks = valid[["fiscal_year", "fiscal_week", "week_date"]].drop_duplicates().sort_values("week_date")
    current_starts = calendar_weeks[
        safe_mask((calendar_weeks["fiscal_year"] == current_year) & (calendar_weeks["fiscal_week"] >= 31))
    ]
    if current_starts.empty:
        raise ValueError("No current WK31-aligned performance period is available.")
    current_start = current_starts.iloc[0]["week_date"]
    current_end = end_row["week_date"]
    current_weeks = calendar_weeks[
        safe_mask(calendar_weeks["week_date"].between(current_start, current_end))
    ].copy()
    week_count = len(current_weeks)
    prior_starts = calendar_weeks[
        safe_mask((calendar_weeks["fiscal_year"] == current_year - 1) & (calendar_weeks["fiscal_week"] >= 31))
    ]
    if prior_starts.empty:
        raise ValueError("No prior WK31-aligned performance period is available.")
    prior_start = prior_starts.iloc[0]["week_date"]
    prior_weeks = calendar_weeks[
        safe_mask((calendar_weeks["week_date"] >= prior_start) & (calendar_weeks["week_date"] < current_start))
    ].head(week_count)
    if len(prior_weeks) < week_count:
        raise ValueError(f"Prior WK31 period has only {len(prior_weeks)} weeks; {week_count} required.")
    return Periods(current_weeks["week_date"].min(), current_weeks["week_date"].max(), prior_weeks["week_date"].min(), prior_weeks["week_date"].max(), week_count)


def prepare_tags(
    df: pd.DataFrame,
    finelines: tuple[str, ...] = DEFAULT_FINELINES,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    tags = _rename_aliases(df)
    required = {"upc", "final_fineline", "attribute_name", "attribute_value", "use_for_analysis"}
    missing = required - set(tags.columns)
    if missing:
        raise ValueError(f"Tag data missing columns: {sorted(missing)}")
    input_rows = len(tags)
    tags["upc"] = tags["upc"].map(normalize_upc)
    tags["final_fineline"] = tags["final_fineline"].astype(str).str.strip().str.upper()
    tags["attribute_name"] = tags["attribute_name"].astype(str).str.strip()
    tags["attribute_value"] = tags["attribute_value"].astype(str).str.strip()
    selected_finelines = tuple(dict.fromkeys(str(value).strip().upper() for value in finelines if str(value).strip()))
    if not selected_finelines:
        raise ValueError("At least one Final Fineline is required.")
    tag_mask = tags["use_for_analysis"].map(truthy) & tags["final_fineline"].isin(selected_finelines) & tags["upc"].ne("")
    tags = tags[safe_mask(tag_mask)].copy()
    if "generated_at" in tags:
        tags["generated_at"] = pd.to_datetime(tags["generated_at"], errors="coerce")
        tags = tags.sort_values("generated_at").drop_duplicates(["upc", "final_fineline", "attribute_name", "attribute_value"], keep="last")
    duplicate_count = int(tags.duplicated(["upc", "final_fineline", "attribute_name", "attribute_value"], keep=False).sum())
    tags = tags.drop_duplicates(["upc", "final_fineline", "attribute_name", "attribute_value"])
    tags["is_valid_attribute_value"] = ~tags["attribute_value"].str.lower().isin(INVALID_ATTRIBUTE_VALUES)
    cross = tags.groupby("upc")["final_fineline"].nunique()
    return tags, {"tag_input_rows": input_rows, "tag_analysis_rows": len(tags), "duplicate_tag_rows": duplicate_count, "cross_fineline_upcs": int((cross > 1).sum())}


def prepare_performance(df: pd.DataFrame) -> pd.DataFrame:
    perf = _rename_aliases(df)
    required = {"upc", "week_date", "fiscal_year", "fiscal_week", "sales_value", "sales_units"}
    missing = required - set(perf.columns)
    if missing:
        raise ValueError(f"Performance data missing columns: {sorted(missing)}")
    perf["upc"] = perf["upc"].map(normalize_upc)
    perf["week_date"] = pd.to_datetime(perf["week_date"], errors="coerce")
    perf = _numeric(perf, ["fiscal_year", "fiscal_week", "sales_value", "sales_units", "stores_selling", "sales_per_store", "units_per_store", "average_price"])
    return perf[safe_mask(perf["upc"].ne("") & perf["week_date"].notna())].copy()


def prepare_assortment(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
    assortment = _rename_aliases(df)
    if "upc" not in assortment:
        raise ValueError("Assortment data missing UPC/product_code.")
    assortment["upc"] = assortment["upc"].map(normalize_upc)
    for column in ("report_start_date", "report_end_date"):
        if column in assortment:
            assortment[column] = pd.to_datetime(assortment[column], errors="coerce")
    latest = assortment["report_end_date"].max() if "report_end_date" in assortment else pd.NaT
    if pd.notna(latest):
        assortment = assortment[safe_mask(assortment["report_end_date"] == latest)].copy()
    duplicate_upcs = int(assortment.duplicated("upc", keep=False).sum())
    group_values = sorted(assortment["groups"].dropna().astype(str).unique().tolist()) if "groups" in assortment else []
    # Never sum duplicate reporting layers. Prefer Total assortment, otherwise retain first row and flag it.
    if "groups" in assortment and assortment["groups"].astype(str).str.lower().eq("total assortment").any():
        assortment = assortment[safe_mask(assortment["groups"].astype(str).str.lower().eq("total assortment"))].copy()
    assortment = assortment.sort_values("upc").drop_duplicates("upc", keep="first")
    assortment = _numeric(assortment, ["sales_value", "sales_units", "stores_selling", "sales_per_store", "units_per_store", "average_price"])
    return assortment, {"latest_report_end_date": None if pd.isna(latest) else latest.date().isoformat(), "assortment_duplicate_rows_before_layer_filter": duplicate_upcs, "assortment_group_values": group_values}


def _period_item_metrics(perf: pd.DataFrame, periods: Periods) -> pd.DataFrame:
    current_dates = sorted(perf.loc[safe_mask(perf["week_date"].between(periods.current_start, periods.current_end)), "week_date"].dropna().unique())
    recent_dates = current_dates[-8:]
    previous_dates = current_dates[-16:-8]

    def aggregate(start: pd.Timestamp, end: pd.Timestamp, prefix: str, expected_weeks: int) -> pd.DataFrame:
        frame = perf[safe_mask(perf["week_date"].between(start, end))].copy()
        grouped = frame.groupby("upc", as_index=False).agg(
            sales_value=("sales_value", "sum"), sales_units=("sales_units", "sum"),
            stores_selling=("stores_selling", "mean"), observed_weeks=("week_date", "nunique"),
        )
        grouped[f"{prefix}_asp"] = grouped["sales_value"] / grouped["sales_units"].replace(0, np.nan)
        grouped[f"{prefix}_sales_per_store_week"] = grouped["sales_value"] / grouped["stores_selling"].replace(0, np.nan) / max(expected_weeks, 1)
        grouped[f"{prefix}_units_per_store_week"] = grouped["sales_units"] / grouped["stores_selling"].replace(0, np.nan) / max(expected_weeks, 1)
        if prefix == "recent_8w":
            weekly = frame.groupby(["upc", "week_date"], as_index=False)["sales_value"].sum()
            peak = weekly.groupby("upc")["sales_value"].max()
            total = weekly.groupby("upc")["sales_value"].sum().replace(0, np.nan)
            grouped["recent_8w_max_week_share"] = grouped["upc"].map(peak / total)
        return grouped.rename(columns={c: f"{prefix}_{c}" for c in ["sales_value", "sales_units", "stores_selling", "observed_weeks"]})
    current = aggregate(periods.current_start, periods.current_end, "current", periods.week_count)
    prior = aggregate(periods.prior_start, periods.prior_end, "prior", periods.week_count)
    result = current.merge(prior, on="upc", how="outer")
    if recent_dates:
        recent = aggregate(pd.Timestamp(recent_dates[0]), pd.Timestamp(recent_dates[-1]), "recent_8w", len(recent_dates))
        result = result.merge(recent, on="upc", how="outer")
    if previous_dates:
        previous = aggregate(pd.Timestamp(previous_dates[0]), pd.Timestamp(previous_dates[-1]), "previous_8w", len(previous_dates))
        result = result.merge(previous, on="upc", how="outer")
    result = result.fillna({"current_sales_value": 0, "current_sales_units": 0, "prior_sales_value": 0, "prior_sales_units": 0, "recent_8w_sales_value": 0, "recent_8w_sales_units": 0, "previous_8w_sales_value": 0, "previous_8w_sales_units": 0})
    result["sales_yoy_growth"] = np.where(result["prior_sales_value"] > 0, result["current_sales_value"] / result["prior_sales_value"] - 1, np.nan)
    result["units_yoy_growth"] = np.where(result["prior_sales_units"] > 0, result["current_sales_units"] / result["prior_sales_units"] - 1, np.nan)
    result["recent_momentum_pct"] = np.where(result.get("previous_8w_sales_per_store_week", pd.Series(np.nan, index=result.index)) > 0, result.get("recent_8w_sales_per_store_week", pd.Series(np.nan, index=result.index)) / result.get("previous_8w_sales_per_store_week", pd.Series(np.nan, index=result.index)) - 1, np.nan)
    result.attrs["recent_week_count"] = len(recent_dates)
    result.attrs["previous_week_count"] = len(previous_dates)
    return result


def _pct_rank(series: pd.Series) -> pd.Series:
    return series.rank(method="average", pct=True).fillna(0)


def _safe_div(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    return numerator / denominator.replace(0, np.nan)


def _build_memberships(tags: pd.DataFrame, item: pd.DataFrame) -> pd.DataFrame:
    valid = tags[safe_mask(tags["is_valid_attribute_value"])].copy()
    singles = valid[["upc", "final_fineline", "attribute_name", "attribute_value"]].drop_duplicates()
    singles["analysis_level"] = "single_attribute"
    singles["attribute_combination"] = singles["attribute_name"] + "=" + singles["attribute_value"]

    tag_coverage = tags.groupby(["final_fineline", "attribute_name"], as_index=False).agg(total_tag_rows=("upc", "size"), total_tag_upcs=("upc", "nunique"))
    valid_coverage = valid.groupby(["final_fineline", "attribute_name"], as_index=False).agg(valid_tag_rows=("upc", "size"), valid_tag_upcs=("upc", "nunique"))
    coverage = tag_coverage.merge(valid_coverage, on=["final_fineline", "attribute_name"], how="left").fillna(0)
    coverage["tag_coverage_rate"] = coverage["valid_tag_rows"] / coverage["total_tag_rows"].replace(0, np.nan)
    singles = singles.merge(coverage[["final_fineline", "attribute_name", "tag_coverage_rate"]], on=["final_fineline", "attribute_name"], how="left")
    single_perf = singles.merge(item[["upc", "final_fineline", "current_sales_value"]], on=["upc", "final_fineline"], how="left")
    single_groups = single_perf.groupby(["final_fineline", "attribute_name", "attribute_value"], as_index=False).agg(sku_count=("upc", "nunique"), sales=("current_sales_value", "sum"), tag_coverage_rate=("tag_coverage_rate", "first"))
    fineline_sales = item.groupby("final_fineline")["current_sales_value"].sum()
    single_groups["sales_share"] = single_groups["sales"] / single_groups["final_fineline"].map(fineline_sales).replace(0, np.nan)
    top = single_perf.groupby(["final_fineline", "attribute_name", "attribute_value", "upc"], as_index=False)["current_sales_value"].first().sort_values("current_sales_value", ascending=False)
    top3 = top.groupby(["final_fineline", "attribute_name", "attribute_value"]).head(3).groupby(["final_fineline", "attribute_name", "attribute_value"])["current_sales_value"].sum()
    keys = list(zip(single_groups["final_fineline"], single_groups["attribute_name"], single_groups["attribute_value"]))
    single_groups["top3_sku_share"] = [top3.get(key, 0) / sales if sales else np.nan for key, sales in zip(keys, single_groups["sales"])]
    eligible = single_groups[safe_mask((single_groups["sku_count"] >= 5) & (single_groups["sales_share"] >= 0.01) & (single_groups["tag_coverage_rate"] >= 0.80) & (single_groups["top3_sku_share"] <= 0.80))]
    eligible_keys = set(zip(eligible["final_fineline"], eligible["attribute_name"], eligible["attribute_value"]))

    left = singles[["upc", "final_fineline", "attribute_name", "attribute_value"]].rename(columns={"attribute_name": "attribute_name_1", "attribute_value": "attribute_value_1"})
    right = left.rename(columns={"attribute_name_1": "attribute_name_2", "attribute_value_1": "attribute_value_2"})
    pairs = left.merge(right, on=["upc", "final_fineline"], how="inner")
    pairs = pairs[safe_mask(pairs["attribute_name_1"] < pairs["attribute_name_2"])].copy()
    parent_ok = [
        (f, a1, v1) in eligible_keys and (f, a2, v2) in eligible_keys
        for f, a1, v1, a2, v2 in pairs[["final_fineline", "attribute_name_1", "attribute_value_1", "attribute_name_2", "attribute_value_2"]].itertuples(index=False, name=None)
    ]
    pairs = pairs[pd.Series(parent_ok, index=pairs.index, dtype=bool)].copy()
    if not pairs.empty:
        pairs["attribute_name"] = pairs["attribute_name_1"] + " × " + pairs["attribute_name_2"]
        pairs["attribute_value"] = pairs["attribute_value_1"] + " × " + pairs["attribute_value_2"]
        pairs["analysis_level"] = "attribute_pair"
        pairs["attribute_combination"] = pairs["attribute_name_1"] + "=" + pairs["attribute_value_1"] + " | " + pairs["attribute_name_2"] + "=" + pairs["attribute_value_2"]
        pair_coverage = pairs[["upc", "final_fineline", "attribute_name", "attribute_value", "analysis_level", "attribute_combination"]].drop_duplicates()
    else:
        pair_coverage = singles.iloc[0:0][["upc", "final_fineline", "attribute_name", "attribute_value", "analysis_level", "attribute_combination"]]
    singles = singles[["upc", "final_fineline", "attribute_name", "attribute_value", "analysis_level", "attribute_combination", "tag_coverage_rate"]]
    pair_coverage["tag_coverage_rate"] = 1.0
    return pd.concat([singles, pair_coverage], ignore_index=True, sort=False)


def _summarize_combinations(memberships: pd.DataFrame, item: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    joined = memberships.merge(item, on=["upc", "final_fineline"], how="left")
    joined["is_our_item"] = joined["is_our_item"].fillna(False).astype(bool)
    metric_zeros = ["current_sales_value", "prior_sales_value", "current_sales_units", "prior_sales_units", "recent_8w_sales_value", "previous_8w_sales_value"]
    for column in metric_zeros:
        if column not in joined:
            joined[column] = 0.0
        joined[column] = pd.to_numeric(joined[column], errors="coerce").fillna(0)
    group_keys = ["final_fineline", "analysis_level", "attribute_name", "attribute_value", "attribute_combination"]
    summary = joined.groupby(group_keys, as_index=False).agg(
        sku_count=("upc", "nunique"), peer_upc_count=("is_our_item", lambda x: int((~x).sum())), our_sku_count=("is_our_item", "sum"),
        current_sales_value=("current_sales_value", "sum"), prior_sales_value=("prior_sales_value", "sum"),
        current_sales_units=("current_sales_units", "sum"), prior_sales_units=("prior_sales_units", "sum"),
        recent_8w_sales_value=("recent_8w_sales_value", "sum"), previous_8w_sales_value=("previous_8w_sales_value", "sum"),
        mean_stores_selling=("recent_8w_stores_selling", "mean"), median_sales_per_store_week=("current_sales_per_store_week", "median"),
        recent_8w_productivity=("recent_8w_sales_per_store_week", "median"), tag_coverage_rate=("tag_coverage_rate", "first"),
    )
    our_sales = joined[safe_mask(joined["is_our_item"])].groupby(group_keys, as_index=False)["current_sales_value"].sum().rename(columns={"current_sales_value": "our_sales_value"})
    summary = summary.merge(our_sales, on=group_keys, how="left").fillna({"our_sales_value": 0})
    fineline = item.groupby("final_fineline", as_index=False).agg(fineline_sales=("current_sales_value", "sum"), fineline_skus=("upc", "nunique"), fineline_our_sales=("current_sales_value", lambda x: x[item.loc[x.index, "is_our_item"]].sum()))
    summary = summary.merge(fineline, on="final_fineline", how="left")
    summary["sales_share"] = _safe_div(summary["current_sales_value"], summary["fineline_sales"])
    summary["sku_share"] = _safe_div(summary["sku_count"], summary["fineline_skus"])
    summary["sales_yoy_growth"] = np.where(summary["prior_sales_value"] > 0, summary["current_sales_value"] / summary["prior_sales_value"] - 1, np.nan)
    summary["recent_momentum_pct"] = np.where(summary["previous_8w_sales_value"] > 0, summary["recent_8w_sales_value"] / summary["previous_8w_sales_value"] - 1, np.nan)
    summary["our_sales_share_within_attribute"] = _safe_div(summary["our_sales_value"], summary["current_sales_value"])
    summary["fineline_our_sales_share"] = _safe_div(summary["fineline_our_sales"], summary["fineline_sales"])
    per_upc = joined.groupby(group_keys + ["upc", "is_our_item"], as_index=False)["current_sales_value"].first().sort_values(group_keys + ["current_sales_value"], ascending=[True, True, True, True, True, False])
    top3 = per_upc.groupby(group_keys).head(3).groupby(group_keys, as_index=False)["current_sales_value"].sum().rename(columns={"current_sales_value": "top3_sales_value"})
    summary = summary.merge(top3, on=group_keys, how="left")
    summary["top3_sku_share"] = _safe_div(summary["top3_sales_value"], summary["current_sales_value"])
    for metric in ["current_sales_value", "sales_yoy_growth", "recent_8w_productivity", "sku_count"]:
        summary[f"{metric}_percentile"] = summary.groupby(["final_fineline", "analysis_level"])[metric].transform(_pct_rank)
    pairs = summary[safe_mask((summary["analysis_level"] == "attribute_pair") & (summary["sku_count"] >= 5) & (summary["peer_upc_count"] >= 3) & (summary["sales_share"] >= 0.01) & (summary["top3_sku_share"] <= 0.80))]
    keep_pair_rows = pairs.sort_values(["final_fineline", "current_sales_value"], ascending=[True, False]).groupby("final_fineline").head(30)
    keep_pairs = set(zip(keep_pair_rows["final_fineline"], keep_pair_rows["attribute_combination"]))
    pair_keep_mask = [
        level == "single_attribute" or (fineline, combination) in keep_pairs
        for fineline, level, combination in summary[["final_fineline", "analysis_level", "attribute_combination"]].itertuples(index=False, name=None)
    ]
    summary = summary[pd.Series(pair_keep_mask, index=summary.index, dtype=bool)].copy()
    joined = joined.merge(summary[group_keys].drop_duplicates(), on=group_keys, how="inner")
    return summary, joined


def _classify_entry_strategies(summary: pd.DataFrame) -> pd.DataFrame:
    result = summary.copy()
    scale60 = result["current_sales_value_percentile"] >= 0.60
    growth60 = result["sales_yoy_growth_percentile"] >= 0.60
    prod60 = result["recent_8w_productivity_percentile"] >= 0.60
    strong60 = scale60.astype(int) + growth60.astype(int) + prod60.astype(int)
    strong75 = (result["current_sales_value_percentile"] >= 0.75).astype(int) + (result["sales_yoy_growth_percentile"] >= 0.75).astype(int) + (result["recent_8w_productivity_percentile"] >= 0.75).astype(int)
    no_ours = result["our_sku_count"] == 0
    insufficient = (result["sku_count"] < 5) | (result["peer_upc_count"] < 3) | (result["tag_coverage_rate"] < 0.80)
    hit_driven = result["top3_sku_share"] > 0.80
    crowded = (result["sku_count_percentile"] >= 0.75) & (result["recent_8w_productivity_percentile"] < 0.50)
    momentum_ok = result["recent_momentum_pct"].fillna(0) >= -0.05
    result["strategy_code"] = "market_context"
    result.loc[safe_mask(no_ours & insufficient), "strategy_code"] = "insufficient_evidence"
    result.loc[safe_mask(no_ours & ~insufficient & hit_driven), "strategy_code"] = "avoid_hit_driven_space"
    result.loc[safe_mask(no_ours & ~insufficient & ~hit_driven & crowded), "strategy_code"] = "avoid_crowded_space"
    result.loc[safe_mask(no_ours & ~insufficient & ~hit_driven & ~crowded & prod60 & ~scale60 & momentum_ok), "strategy_code"] = "niche_entry"
    result.loc[safe_mask(no_ours & ~insufficient & ~hit_driven & ~crowded & momentum_ok & (strong60 >= 2)), "strategy_code"] = "test_entry"
    result.loc[safe_mask(no_ours & ~insufficient & ~hit_driven & ~crowded & momentum_ok & ((strong60 == 3) | (strong75 >= 2))), "strategy_code"] = "priority_entry"
    actions = {
        "priority_entry": "Prioritize product development and Buyer validation for this attribute space.",
        "test_entry": "Run a limited SKU and store test before broader entry.",
        "niche_entry": "Test a narrow proposition because productivity is strong but scale is limited.",
        "avoid_crowded_space": "Do not enter without clear differentiation; SKU density is high relative to productivity.",
        "avoid_hit_driven_space": "Do not infer broad demand; performance is concentrated in a few leading UPCs.",
        "insufficient_evidence": "Collect more comparable product or tag evidence before making an entry decision.",
        "market_context": "Use as market context; no material entry signal is present.",
    }
    result["recommended_action"] = result["strategy_code"].map(actions)
    result["risk_flags"] = np.select([insufficient, hit_driven, crowded], ["insufficient_sample_or_tag_coverage", "hit_driven", "crowded_low_productivity"], default="")
    result["opportunity_id"] = "WS-" + result[["final_fineline", "analysis_level", "attribute_combination"]].astype(str).agg("|".join, axis=1).map(lambda x: re.sub(r"[^A-Z0-9]+", "-", x.upper()).strip("-"))
    result["suggested_incremental_stores"] = np.nan
    result["directional_13w_upside"] = np.nan
    explanations = result.apply(_explain_entry_row, axis=1, result_type="expand")
    result[["why_this_action", "rule_checks"]] = explanations
    return result


def _display_number(value: Any, *, percent: bool = False) -> str:
    if value is None or pd.isna(value):
        return "NA"
    return f"{float(value):.1%}" if percent else f"{float(value):,.2f}"


def _rule_check(label: str, actual: Any, requirement: str, passed: bool) -> str:
    return f"{'PASS' if bool(passed) else 'FAIL'}: {label}={_display_number(actual)}; requires {requirement}"


def _explain_entry_row(row: pd.Series) -> pd.Series:
    scale = row.get("current_sales_value_percentile")
    growth = row.get("sales_yoy_growth_percentile")
    productivity = row.get("recent_8w_productivity_percentile")
    momentum = row.get("recent_momentum_pct")
    checks = [
        _rule_check("our_sku_count", row.get("our_sku_count"), "0", row.get("our_sku_count") == 0),
        _rule_check("market_upc_count", row.get("sku_count"), ">=5", row.get("sku_count", 0) >= 5),
        _rule_check("peer_upc_count", row.get("peer_upc_count"), ">=3", row.get("peer_upc_count", 0) >= 3),
        _rule_check("tag_coverage_rate", row.get("tag_coverage_rate"), ">=0.80", row.get("tag_coverage_rate", 0) >= .80),
        _rule_check("top3_sku_share", row.get("top3_sku_share"), "<=0.80", row.get("top3_sku_share", 1) <= .80),
        _rule_check("scale_percentile", scale, ">=0.60", pd.notna(scale) and scale >= .60),
        _rule_check("growth_percentile", growth, ">=0.60", pd.notna(growth) and growth >= .60),
        _rule_check("productivity_percentile", productivity, ">=0.60", pd.notna(productivity) and productivity >= .60),
        _rule_check("recent_momentum_pct", momentum, ">=-0.05", pd.notna(momentum) and momentum >= -.05),
    ]
    why = (
        f"{row.get('strategy_code')}: no Paramont UPC is present; market scale is P{_display_number(scale * 100 if pd.notna(scale) else np.nan)}, "
        f"growth is P{_display_number(growth * 100 if pd.notna(growth) else np.nan)}, productivity is P{_display_number(productivity * 100 if pd.notna(productivity) else np.nan)}, "
        f"with {int(row.get('sku_count', 0) or 0)} market UPCs and {_display_number(row.get('top3_sku_share'), percent=True)} Top-3 concentration."
    )
    return pd.Series([why, " | ".join(checks)])


def _classify_our_items(item: pd.DataFrame, joined: pd.DataFrame, combinations: pd.DataFrame, recent_week_count: int) -> pd.DataFrame:
    ours = item[safe_mask(item["is_our_item"])].copy()
    peers = item[~safe_mask(item["is_our_item"])].copy()
    fineline_stats = peers.groupby("final_fineline").agg(fineline_recent_p60=("recent_8w_sales_per_store_week", lambda s: s.quantile(.60)), fineline_distribution_median=("recent_8w_stores_selling", "median")).reset_index()
    group_keys = ["final_fineline", "analysis_level", "attribute_combination"]
    rows: list[dict[str, Any]] = []
    for key, group in joined.groupby(group_keys, dropna=False):
        peer = group[~safe_mask(group["is_our_item"])]
        own = group[safe_mask(group["is_our_item"])]
        if own.empty:
            continue
        stats = {
            "peer_upc_count": int(peer["upc"].nunique()),
            "peer_recent_p25": peer["recent_8w_sales_per_store_week"].quantile(.25),
            "peer_recent_p40": peer["recent_8w_sales_per_store_week"].quantile(.40),
            "peer_recent_p60": peer["recent_8w_sales_per_store_week"].quantile(.60),
            "peer_wk31_median": peer["current_sales_per_store_week"].median(),
            "peer_wk31_p60": peer["current_sales_per_store_week"].quantile(.60),
            "peer_distribution_median": peer["recent_8w_stores_selling"].median(),
            "peer_asp_p25": peer["recent_8w_asp"].quantile(.25),
            "peer_asp_p75": peer["recent_8w_asp"].quantile(.75),
            "peer_units_median": peer["recent_8w_units_per_store_week"].median(),
        }
        combo = combinations[(combinations["final_fineline"] == key[0]) & (combinations["analysis_level"] == key[1]) & (combinations["attribute_combination"] == key[2])].iloc[0]
        own_sales = own.groupby("upc")["current_sales_value"].first().sort_values(ascending=False)
        own_concentration = own_sales.head(3).sum() / own_sales.sum() if own_sales.sum() else np.nan
        for _, record in own.drop_duplicates("upc").iterrows():
            row = record.to_dict()
            row.update(stats)
            row["our_combo_sales_share"] = combo["our_sales_share_within_attribute"]
            row["fineline_our_sales_share"] = combo["fineline_our_sales_share"]
            row["portfolio_concentration"] = own_concentration
            peer_recent = peer["recent_8w_sales_per_store_week"].dropna()
            peer_wk31 = peer["current_sales_per_store_week"].dropna()
            peer_dist = peer["recent_8w_stores_selling"].dropna()
            row["recent_8w_productivity_percentile"] = float((peer_recent <= record.get("recent_8w_sales_per_store_week", np.nan)).mean()) if len(peer_recent) else np.nan
            row["wk31_productivity_percentile"] = float((peer_wk31 <= record.get("current_sales_per_store_week", np.nan)).mean()) if len(peer_wk31) else np.nan
            row["distribution_percentile"] = float((peer_dist <= record.get("recent_8w_stores_selling", np.nan)).mean()) if len(peer_dist) else np.nan
            rows.append(row)
    candidates = pd.DataFrame(rows)
    if candidates.empty:
        ours["strategy_code"] = "insufficient_peer_sample"
        ours["recommended_action"] = "Collect at least three non-Paramont comparable UPCs before recommending action."
        ours["portfolio_owner"] = "PARAMONT"
        ours["why_this_action"] = "No eligible matched-peer attribute context is available."
        ours["rule_checks"] = "FAIL: eligible matched-peer context; requires at least 3 non-Paramont UPCs"
        return ours
    candidates = candidates.merge(fineline_stats, on="final_fineline", how="left")
    candidates["strategy_code"] = "monitor_current_item"
    candidates["recommended_action"] = "Maintain and monitor; no material action threshold is met."
    sufficient = candidates["peer_upc_count"] >= 3
    active = candidates["recent_8w_observed_weeks"].fillna(0) >= 6
    stable = candidates["recent_momentum_pct"].fillna(-999) >= -0.05
    no_spike = candidates["recent_8w_max_week_share"].fillna(1) <= 0.50
    lead = (candidates["recent_8w_sales_per_store_week"] >= candidates["peer_recent_p60"]) & (candidates["recent_8w_sales_per_store_week"] >= candidates["fineline_recent_p60"]) & (candidates["current_sales_per_store_week"] >= candidates["peer_wk31_median"])
    low_distribution = candidates["recent_8w_stores_selling"] < candidates["peer_distribution_median"]
    lag = (candidates["recent_8w_sales_per_store_week"] < candidates["peer_recent_p40"]) & (candidates["current_sales_per_store_week"] < candidates["peer_wk31_median"])
    recovery = candidates["recent_momentum_pct"].fillna(-999) >= 0.10
    asp_outside = (candidates["recent_8w_asp"] < candidates["peer_asp_p25"]) | (candidates["recent_8w_asp"] > candidates["peer_asp_p75"])
    units_lag = candidates["recent_8w_units_per_store_week"] < candidates["peer_units_median"]
    broad_distribution = ~low_distribution
    candidates.loc[safe_mask(~sufficient), ["strategy_code", "recommended_action"]] = ["insufficient_peer_sample", "Collect at least three non-Paramont comparable UPCs before recommending action."]
    candidates.loc[safe_mask(sufficient & lag & broad_distribution), ["strategy_code", "recommended_action"]] = ["optimize_before_expansion", "Do not expand stores; improve product, placement, price, or communication first."]
    candidates.loc[safe_mask(sufficient & lag & broad_distribution & (candidates["recent_8w_sales_per_store_week"] < candidates["peer_recent_p25"]) & ~recovery), ["strategy_code", "recommended_action"]] = ["rationalize_or_replace", "Consider rationalizing or replacing the item before requesting more space."]
    candidates.loc[safe_mask(sufficient & lag & asp_outside & units_lag), ["strategy_code", "recommended_action"]] = ["price_pack_review", "Review price, pack architecture, and value communication before expansion."]
    candidates.loc[safe_mask(sufficient & lag & recovery), ["strategy_code", "recommended_action"]] = ["controlled_recovery_test", "Keep a controlled test while recent productivity recovery is validated."]
    candidates.loc[safe_mask(sufficient & lead & ~low_distribution & (candidates["our_combo_sales_share"] < candidates["fineline_our_sales_share"] * .75)), ["strategy_code", "recommended_action"]] = ["deepen_assortment", "Add a differentiated adjacent variant while protecting current productivity."]
    candidates.loc[safe_mask(sufficient & lead & ~low_distribution & ~(candidates["our_combo_sales_share"] < candidates["fineline_our_sales_share"] * .75)), ["strategy_code", "recommended_action"]] = ["defend_leadership", "Protect distribution, availability, and the proven core assortment."]
    expand = sufficient & active & stable & no_spike & lead & low_distribution
    candidates.loc[safe_mask(expand), ["strategy_code", "recommended_action"]] = ["expand_distribution", "Request distribution expansion toward the matched-peer median store count."]
    candidates["suggested_incremental_stores"] = np.where(candidates["strategy_code"] == "expand_distribution", (candidates["peer_distribution_median"] - candidates["recent_8w_stores_selling"]).clip(lower=0), 0)
    candidates["directional_13w_upside"] = candidates["suggested_incremental_stores"] * candidates["recent_8w_sales_per_store_week"] * 13
    candidates["risk_flags"] = np.select([~sufficient, ~no_spike, candidates["portfolio_concentration"] > .80], ["insufficient_peer_sample", "single_week_concentration", "portfolio_concentration_risk"], default="")
    candidates["analysis_level"] = "upc"
    candidates["portfolio_owner"] = "PARAMONT"
    candidates["opportunity_id"] = "SKU-" + candidates["upc"]
    # Prefer a qualifying pair over a single; within level prefer action priority and larger peer set.
    priority = {"expand_distribution": 1, "rationalize_or_replace": 2, "price_pack_review": 3, "controlled_recovery_test": 4, "optimize_before_expansion": 5, "deepen_assortment": 6, "defend_leadership": 7, "monitor_current_item": 8, "insufficient_peer_sample": 9}
    candidates["_priority"] = candidates["strategy_code"].map(priority).fillna(99)
    candidates["_pair"] = candidates["attribute_combination"].str.contains(" \| ", regex=False).astype(int)
    candidates = candidates.sort_values(["upc", "_priority", "_pair", "peer_upc_count"], ascending=[True, True, False, False]).drop_duplicates("upc")
    candidates = candidates.drop(columns=["_priority", "_pair"], errors="ignore")
    explanations = candidates.apply(_explain_item_row, axis=1, result_type="expand")
    candidates[["why_this_action", "rule_checks"]] = explanations
    return candidates


def _explain_item_row(row: pd.Series) -> pd.Series:
    recent = row.get("recent_8w_sales_per_store_week")
    peer_p60 = row.get("peer_recent_p60")
    peer_p40 = row.get("peer_recent_p40")
    fineline_p60 = row.get("fineline_recent_p60")
    wk31 = row.get("current_sales_per_store_week")
    wk31_median = row.get("peer_wk31_median")
    stores = row.get("recent_8w_stores_selling")
    store_median = row.get("peer_distribution_median")
    momentum = row.get("recent_momentum_pct")
    observed = row.get("recent_8w_observed_weeks")
    max_week = row.get("recent_8w_max_week_share")
    checks = [
        _rule_check("peer_upc_count", row.get("peer_upc_count"), ">=3", row.get("peer_upc_count", 0) >= 3),
        _rule_check("recent_productivity_vs_peer_P60", recent, f">={_display_number(peer_p60)}", pd.notna(recent) and pd.notna(peer_p60) and recent >= peer_p60),
        _rule_check("recent_productivity_vs_fineline_P60", recent, f">={_display_number(fineline_p60)}", pd.notna(recent) and pd.notna(fineline_p60) and recent >= fineline_p60),
        _rule_check("WK31_productivity_vs_peer_median", wk31, f">={_display_number(wk31_median)}", pd.notna(wk31) and pd.notna(wk31_median) and wk31 >= wk31_median),
        _rule_check("recent_productivity_vs_peer_P40", recent, f">={_display_number(peer_p40)}", pd.notna(recent) and pd.notna(peer_p40) and recent >= peer_p40),
        _rule_check("stores_vs_peer_median", stores, f"<{_display_number(store_median)} for expansion", pd.notna(stores) and pd.notna(store_median) and stores < store_median),
        _rule_check("recent_momentum_pct", momentum, ">=-0.05", pd.notna(momentum) and momentum >= -.05),
        _rule_check("active_recent_weeks", observed, ">=6", pd.notna(observed) and observed >= 6),
        _rule_check("largest_recent_week_share", max_week, "<=0.50", pd.notna(max_week) and max_week <= .50),
    ]
    why = (
        f"{row.get('strategy_code')}: Paramont UPC {row.get('upc')} delivers {_display_number(recent)} sales/store/week versus matched-peer P60 {_display_number(peer_p60)} "
        f"and WK31 productivity {_display_number(wk31)} versus peer median {_display_number(wk31_median)}; current stores {_display_number(stores)} versus peer median {_display_number(store_median)}; momentum {_display_number(momentum, percent=True)}."
    )
    return pd.Series([why, " | ".join(checks)])


def build_analysis(
    performance_raw: pd.DataFrame,
    assortment_raw: pd.DataFrame,
    tags_raw: pd.DataFrame,
    portfolio: pd.DataFrame,
    finelines: tuple[str, ...] = DEFAULT_FINELINES,
    portfolio_source: str = "provided_dataframe",
) -> dict[str, Any]:
    selected_finelines = tuple(dict.fromkeys(str(value).strip().upper() for value in finelines if str(value).strip()))
    tags, tag_quality = prepare_tags(tags_raw, selected_finelines)
    perf = prepare_performance(performance_raw)
    assortment, assortment_quality = prepare_assortment(assortment_raw)
    periods = choose_periods(perf)

    tagged_upcs = set(tags["upc"])
    perf = perf[safe_mask(perf["upc"].isin(tagged_upcs))].copy()
    item = _period_item_metrics(perf, periods)
    item_fineline = tags[["upc", "final_fineline"]].drop_duplicates()
    item = item.merge(item_fineline, on="upc", how="left").merge(assortment.drop(columns=["final_fineline"], errors="ignore"), on="upc", how="left", suffixes=("", "_assortment"))
    mapped_ours = set(portfolio.loc[portfolio["portfolio_status"] == "mapped_existing_item", "upc"])
    item["is_our_item"] = item["upc"].isin(mapped_ours)

    memberships = _build_memberships(tags, item)
    attributes, joined = _summarize_combinations(memberships, item)
    attributes = _classify_entry_strategies(attributes)
    recent_week_count = int(item.attrs.get("recent_week_count", min(periods.week_count, 8)))
    our_items = _classify_our_items(item, joined, attributes, recent_week_count)

    sensitivity_rows: list[dict[str, Any]] = []
    ranked_sets: dict[str, set[str]] = {}
    for p in SENSITIVITY_PERCENTILES:
        qualifying_mask = (attributes["our_sku_count"] == 0) & (attributes["sku_count"] >= 5) & (attributes["peer_upc_count"] >= 3) & (attributes["tag_coverage_rate"] >= .80) & (attributes["top3_sku_share"] <= .80) & (((attributes["current_sales_value_percentile"] >= p).fillna(False).astype(int) + (attributes["sales_yoy_growth_percentile"] >= p).fillna(False).astype(int) + (attributes["recent_8w_productivity_percentile"] >= p).fillna(False).astype(int)) >= 2)
        qualifying = attributes[safe_mask(qualifying_mask)].copy()
        ids = set(qualifying[["final_fineline", "analysis_level", "attribute_combination"]].astype(str).agg("|".join, axis=1))
        ranked_sets[f"P{int(p*100)}"] = ids
        sensitivity_rows.append({"scenario": f"P{int(p*100)}", "threshold": p, "validated_white_space_count": len(ids), "opportunity_ids": ";".join(sorted(ids))})
    base = ranked_sets.get("P60", set())
    for row in sensitivity_rows:
        other = ranked_sets[row["scenario"]]
        row["jaccard_vs_p60"] = 1.0 if not base and not other else len(base & other) / len(base | other)
    sensitivity = pd.DataFrame(sensitivity_rows)

    perf_upcs, assortment_upcs, tag_upcs = set(perf["upc"]), set(assortment["upc"]), set(tags["upc"])
    mapped_count = len(mapped_ours)
    quality_rows = [
        {"check": "paramont_mapped_upc_count", "value": mapped_count, "status": "info"},
        {"check": "paramont_unmapped_wk31_new_item_count", "value": int((portfolio["portfolio_status"] == "unmapped_wk31_new_item").sum()), "status": "info"},
        {"check": "paramont_match_rate_performance", "value": len(mapped_ours & perf_upcs) / mapped_count if mapped_count else 0, "status": "pass"},
        {"check": "paramont_match_rate_assortment", "value": len(mapped_ours & assortment_upcs) / mapped_count if mapped_count else 0, "status": "pass"},
        {"check": "paramont_match_rate_tags", "value": len(mapped_ours & tag_upcs) / mapped_count if mapped_count else 0, "status": "pass"},
        {"check": "negative_performance_rows", "value": int(((perf["sales_value"] < 0) | (perf["sales_units"] < 0)).sum()), "status": "warning"},
        {"check": "missing_current_item_weeks", "value": int((item["current_observed_weeks"].fillna(0) < periods.week_count).sum()), "status": "warning"},
        {"check": "duplicate_tag_rows", "value": tag_quality["duplicate_tag_rows"], "status": "warning"},
        {"check": "cross_fineline_upcs", "value": tag_quality["cross_fineline_upcs"], "status": "warning"},
        {"check": "assortment_duplicate_rows_before_layer_filter", "value": assortment_quality["assortment_duplicate_rows_before_layer_filter"], "status": "warning"},
    ]
    current_sales_total = item["current_sales_value"].sum()
    tagged_sales_coverage = item[item["upc"].isin(set(tags["upc"]))]["current_sales_value"].sum() / current_sales_total if current_sales_total else 0
    quality_rows.append({"check": "tagged_sales_coverage", "value": tagged_sales_coverage, "status": "pass" if tagged_sales_coverage >= 0.8 else "warning"})
    quality = pd.DataFrame(quality_rows)

    return {
        "periods": periods,
        "attributes": attributes.sort_values(["strategy_code", "current_sales_value"], ascending=[True, False]).reset_index(drop=True),
        "our_items": our_items.sort_values(["strategy_code", "current_sales_value"], ascending=[True, False]).reset_index(drop=True),
        "quality": quality,
        "sensitivity": sensitivity,
        "portfolio": portfolio,
        "metadata": {**tag_quality, **assortment_quality, "generated_at": datetime.now(timezone.utc).isoformat(), "finelines": list(selected_finelines), "portfolio_source": portfolio_source},
    }


def _json_value(value: Any) -> Any:
    if value is None or value is pd.NA or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    return value


def records(df: pd.DataFrame) -> list[dict[str, Any]]:
    return [{k: _json_value(v) for k, v in row.items()} for row in df.to_dict(orient="records")]


def _html_table(df: pd.DataFrame, limit: int = 30) -> str:
    view = df.head(limit).copy()
    for column in view.columns:
        if pd.api.types.is_float_dtype(view[column]):
            view[column] = view[column].map(lambda x: "" if pd.isna(x) else f"{x:,.3f}")
    return view.to_html(index=False, escape=True, classes="data")


def _methodology_html() -> str:
    metric_rows = pd.DataFrame(
        METRIC_DEFINITIONS,
        columns=["metric", "grain", "definition_or_formula", "null_and_rule_handling"],
    )
    action_rows = pd.DataFrame(
        RECOMMENDED_ACTION_RULES,
        columns=["strategy_code", "recommended_action", "deterministic_trigger", "precedence"],
    )
    return f"""
<h2 id="methodology">Metric definitions and calculation logic</h2>
<p class="note">Percentiles are calculated only inside the stated comparison population. <code>scintilla.ParamontItemList</code> identifies our portfolio; all other UPCs are comparable market products, not verified supplier identities. A blank metric means that its denominator or comparison base was unavailable.</p>
<div class="scroll methodology">{_html_table(metric_rows, len(metric_rows))}</div>
<h2 id="recommended-action-rules">Recommended_action rules</h2>
<p>Rules are deterministic. Item-level recommendations first classify each UPC inside every eligible attribute context, then retain one context by action priority, preferring an attribute pair and a larger peer sample when the action priority ties. Entry rules apply only where <code>our_sku_count = 0</code>.</p>
<div class="scroll methodology">{_html_table(action_rows, len(action_rows))}</div>
"""


def _buyer_view(frame: pd.DataFrame, section: str) -> pd.DataFrame:
    common = [
        "final_fineline", "upc", "portfolio_owner", "item_name", "attribute_combination",
        "strategy_code", "recommended_action", "why_this_action", "rule_checks", "risk_flags",
    ]
    if section == "entry":
        columns = [
            "final_fineline", "analysis_level", "attribute_combination", "sku_count", "peer_upc_count",
            "our_sku_count", "current_sales_value", "current_sales_value_percentile",
            "sales_yoy_growth", "sales_yoy_growth_percentile", "recent_8w_productivity",
            "recent_8w_productivity_percentile", "recent_momentum_pct", "tag_coverage_rate",
            "top3_sku_share", "strategy_code", "recommended_action", "why_this_action", "rule_checks", "risk_flags",
        ]
    elif section == "expand":
        columns = common + [
            "recent_8w_sales_per_store_week", "peer_recent_p60", "fineline_recent_p60",
            "current_sales_per_store_week", "peer_wk31_median", "recent_8w_stores_selling",
            "peer_distribution_median", "recent_momentum_pct", "suggested_incremental_stores",
            "directional_13w_upside",
        ]
    else:
        columns = common + [
            "recent_8w_sales_per_store_week", "peer_recent_p25", "peer_recent_p40", "peer_recent_p60",
            "current_sales_per_store_week", "peer_wk31_median", "recent_8w_stores_selling",
            "peer_distribution_median", "recent_8w_asp", "peer_asp_p25", "peer_asp_p75",
            "recent_momentum_pct", "our_combo_sales_share", "fineline_our_sales_share",
        ]
    return frame[[column for column in columns if column in frame.columns]].copy()


def render_html(result: dict[str, Any], eda: bool) -> str:
    attributes, items, quality, sensitivity = result["attributes"], result["our_items"], result["quality"], result["sensitivity"]
    expansion = items[safe_mask(items["strategy_code"] == "expand_distribution")]
    improve_codes = ["optimize_before_expansion", "controlled_recovery_test", "price_pack_review", "rationalize_or_replace", "insufficient_peer_sample"]
    improve = items[safe_mask(items["strategy_code"].isin(improve_codes))]
    defend = items[safe_mask(items["strategy_code"].isin(["deepen_assortment", "defend_leadership"]))]
    positive_entry_codes = ["priority_entry", "test_entry", "niche_entry"]
    non_entry_codes = ["avoid_crowded_space", "avoid_hit_driven_space", "insufficient_evidence"]
    entry = attributes[safe_mask((attributes["our_sku_count"] == 0) & attributes["strategy_code"].isin(positive_entry_codes))]
    non_entry = attributes[safe_mask((attributes["our_sku_count"] == 0) & attributes["strategy_code"].isin(non_entry_codes))]
    title = "Kids Crafts White-Space EDA" if eda else "Kids Crafts White-Space Analysis"
    periods = result["periods"].as_dict()
    cards = {
        "Expand distribution": len(expansion),
        "Improve or rationalize": len(improve),
        "Defend or deepen": len(defend),
        "Qualified entry spaces": len(entry),
        "Not recommended / insufficient": len(non_entry),
        "Mapped Paramont UPCs": int((result["portfolio"]["portfolio_status"] == "mapped_existing_item").sum()),
        "Unmapped WK31 items": int((result["portfolio"]["portfolio_status"] == "unmapped_wk31_new_item").sum()),
    }
    card_html = "".join(f'<div class="card"><b>{html.escape(k)}</b><span>{v}</span></div>' for k, v in cards.items())
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{title}</title><style>
body{{font:14px Arial,sans-serif;margin:28px;color:#172033}} h1,h2{{color:#153a5b}} .note{{background:#eef6fb;padding:12px;border-left:4px solid #2474a6}} .cards{{display:flex;gap:12px;flex-wrap:wrap}} .card{{background:#f5f7fa;border:1px solid #d9e1e8;padding:14px;min-width:180px}} .card span{{display:block;font-size:26px;margin-top:8px;color:#2474a6}} table.data{{border-collapse:collapse;width:100%;font-size:12px}} table.data th,table.data td{{border:1px solid #d9e1e8;padding:5px;text-align:left;vertical-align:top}} table.data th{{background:#153a5b;color:white;position:sticky;top:0}} .scroll{{overflow:auto;max-height:540px;margin-bottom:28px}} .methodology{{max-height:720px}} code{{background:#f1f4f7;padding:1px 4px}}</style></head><body>
<h1>{title}</h1><p class="note">Exploratory evidence only. Tags are restricted to <code>use_for_analysis = 1</code>; products join by exact normalized UPC only. Portfolio source: <code>{html.escape(str(result['metadata']['portfolio_source']))}</code>. Unmapped WK31 items receive no tag or opportunity assignment.</p>
<p>Current period: {periods['current_start']} to {periods['current_end']} ({periods['week_count']} weeks). Prior aligned period: {periods['prior_start']} to {periods['prior_end']}.</p><div class="cards">{card_html}</div>
<h2>Data quality</h2><div class="scroll">{_html_table(quality, 100)}</div>
<h2>1. Which current items should expand distribution?</h2><p class="note">Every row is a <code>scintilla.ParamontItemList</code>-matched UPC. Read <code>why_this_action</code> for the decision summary and <code>rule_checks</code> for each threshold test.</p><div class="scroll">{_html_table(_buyer_view(expansion, "expand"), 50)}</div>
<h2>2. Which current items need improvement or replacement?</h2><div class="scroll">{_html_table(_buyer_view(improve, "improve"), 50)}</div>
<h2>3. Which leading positions should be defended or deepened?</h2><div class="scroll">{_html_table(_buyer_view(defend, "defend"), 50)}</div>
<h2>4. Which spaces without our products merit entry?</h2><p class="note">This table contains only positive entry recommendations: <code>priority_entry</code>, <code>test_entry</code>, and <code>niche_entry</code>. Every row has <code>our_sku_count = 0</code>.</p><div class="scroll">{_html_table(_buyer_view(entry, "entry"), 80)}</div>
<h3>Spaces not recommended or lacking evidence</h3><p class="note">These rows are excluded from the qualified-entry count because they are crowded, hit-driven, or lack sufficient sample/tag evidence.</p><div class="scroll">{_html_table(_buyer_view(non_entry, "entry"), 80)}</div>
<h2>Threshold sensitivity</h2><div class="scroll">{_html_table(sensitivity, 20)}</div>
{_methodology_html()}
</body></html>"""


def build_standardized_output(result: dict[str, Any]) -> dict[str, Any]:
    attrs = result["attributes"]
    items = result["our_items"]
    attribute_strategies = attrs[safe_mask(attrs["strategy_code"].ne("market_context"))]
    item_strategies = items[safe_mask(items["strategy_code"].ne("monitor_current_item"))]
    facts = records(attribute_strategies)
    facts.extend(records(item_strategies))
    signals = [{"opportunity_id": row.get("opportunity_id"), "signal": row.get("strategy_code"), "evidence_fields": [k for k in row if k.endswith("share") or k.endswith("growth") or "percentile" in k or k in {"peer_upc_count", "suggested_incremental_stores", "directional_13w_upside"}]} for row in facts]
    insights = []
    for row in facts:
        signal = row.get("strategy_code")
        entity = row.get("attribute_value") or row.get("upc")
        insights.append({"opportunity_id": row.get("opportunity_id"), "candidate_insight": f"{row.get('final_fineline')}: {entity} is classified as {signal}. {row.get('recommended_action', '')}".strip(), "signal": signal})
    return {
        "schema_version": "1.0",
        "analysis_type": "kids_crafts_white_space",
        "grain": "single_attribute_or_attribute_pair_or_upc_strategy",
        "analysis_context": {"category": "KIDS CRAFTS", "finelines": list(result["metadata"]["finelines"]), "periods": result["periods"].as_dict(), "portfolio_source": result["metadata"]["portfolio_source"], "join_policy": "exact_normalized_upc_only", "tag_policy": "use_for_analysis_equals_1_only", "peer_definition": "UPCs_outside_ParamontItemList_in_matched_attribute_combination_with_fineline_guardrail"},
        "summary": {"attribute_strategy_count": int(len(attribute_strategies)), "item_strategy_count": int(len(item_strategies)), "expand_distribution_count": int((items["strategy_code"] == "expand_distribution").sum()), "entry_opportunity_count": int(attrs["strategy_code"].isin(["priority_entry", "test_entry", "niche_entry"]).sum()), "unmapped_wk31_new_item_count": int((result["portfolio"]["portfolio_status"] == "unmapped_wk31_new_item").sum()), "warnings": records(result["quality"][result["quality"]["status"] == "warning"])},
        "facts": facts,
        "tables": [
            {"artifact": "white_space_opportunities.csv", "grain": "attribute value or UPC", "purpose": "Auditable opportunity table"},
        ],
        "visualization_specs": [
            {"chart_id": "entry_opportunity_matrix", "type": "scatter", "x": "sales_yoy_growth", "y": "recent_8w_productivity", "size": "current_sales_value", "color": "strategy_code"},
            {"chart_id": "distribution_strategy", "type": "scatter", "x": "recent_8w_stores_selling", "y": "recent_8w_sales_per_store_week", "label": "upc", "color": "strategy_code"},
        ],
        "signals": signals,
        "candidate_insights": insights,
        "data_quality": records(result["quality"]),
        "artifacts": {},
    }


def write_outputs(result: dict[str, Any], output_dir: str | Path, mode: str) -> dict[str, str]:
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    eda = mode == "eda"
    if eda:
        names = {
            "report": "eda_white_space_report.html", "quality": "eda_data_quality.csv",
            "attributes": "eda_attribute_performance.csv", "items": "eda_our_item_performance.csv",
            "sensitivity": "eda_threshold_sensitivity.csv", "json": "eda_summary.json",
        }
        result["quality"].to_csv(output / names["quality"], index=False)
        result["attributes"].to_csv(output / names["attributes"], index=False)
        result["our_items"].to_csv(output / names["items"], index=False)
        result["sensitivity"].to_csv(output / names["sensitivity"], index=False)
        payload = build_standardized_output(result)
        payload["eda"] = {"threshold_sensitivity": records(result["sensitivity"]), "metadata": result["metadata"]}
    else:
        names = {"report": "white_space_report.html", "opportunities": "white_space_opportunities.csv", "json": "white_space_analysis.json"}
        attrs = result["attributes"][safe_mask(result["attributes"]["strategy_code"].ne("market_context"))].copy()
        items = result["our_items"][safe_mask(result["our_items"]["strategy_code"].ne("monitor_current_item"))].copy()
        attrs["entity_grain"] = attrs["analysis_level"]
        items["entity_grain"] = "upc"
        pd.concat([attrs, items], ignore_index=True, sort=False).to_csv(output / names["opportunities"], index=False)
        payload = build_standardized_output(result)
    (output / names["report"]).write_text(render_html(result, eda=eda), encoding="utf-8")
    payload["artifacts"] = {key: {"path": str((output / value).resolve()), "user_facing": True} for key, value in names.items()}
    (output / names["json"]).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {key: str((output / value).resolve()) for key, value in names.items()}

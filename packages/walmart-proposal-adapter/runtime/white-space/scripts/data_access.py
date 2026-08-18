"""Read-only data access for the white-space analysis."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pandas as pd


PERFORMANCE_SQL_TEMPLATE = """
WITH analysis_products AS (
    SELECT DISTINCT product_code, final_fineline
    FROM scintilla.ProductAttributeTagDetail
    WHERE use_for_analysis = 1
      AND final_fineline IN ({fineline_placeholders})
)
SELECT p.*, a.final_fineline, c.fiscal_year, c.fiscal_week
FROM scintilla.PerformanceInDetailTrends p
JOIN analysis_products a ON CAST(p.upc AS NVARCHAR(64)) = a.product_code
LEFT JOIN scintilla.fiscalcalendar c ON TRY_CONVERT(date, p.[week]) = c.[date]
"""

ASSORTMENT_SQL = """
SELECT *
FROM scintilla.AssortmentPerformance
WHERE TRY_CONVERT(date, report_end_date) = (
    SELECT MAX(TRY_CONVERT(date, report_end_date)) FROM scintilla.AssortmentPerformance
)
"""

TAGS_SQL_TEMPLATE = """
SELECT product_code, final_fineline, attribute_name, attribute_value,
       is_primary, use_for_analysis, taxonomy_version, generated_at
FROM scintilla.ProductAttributeTagDetail
WHERE use_for_analysis = 1
  AND final_fineline IN ({fineline_placeholders})
"""

PORTFOLIO_SQL = """
SELECT
    LTRIM(RTRIM(vendor_stock_id)) AS vendor_stock_id,
    COALESCE(LTRIM(RTRIM(upc)), '') AS upc,
    CASE
        WHEN NULLIF(LTRIM(RTRIM(upc)), '') IS NULL THEN 'unmapped_wk31_new_item'
        ELSE 'mapped_existing_item'
    END AS portfolio_status
FROM scintilla.ParamontItemList
"""


def build_fineline_queries(finelines: tuple[str, ...]) -> tuple[str, str, dict[str, str]]:
    selected = tuple(dict.fromkeys(str(value).strip().upper() for value in finelines if str(value).strip()))
    if not selected:
        raise ValueError("At least one Final Fineline is required.")
    params = {f"fineline_{index}": value for index, value in enumerate(selected)}
    placeholders = ", ".join(f":{name}" for name in params)
    return (
        PERFORMANCE_SQL_TEMPLATE.format(fineline_placeholders=placeholders),
        TAGS_SQL_TEMPLATE.format(fineline_placeholders=placeholders),
        params,
    )


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def load_runtime_env(skill_root: Path, fallback_root: Path | None = None) -> None:
    _load_dotenv(skill_root / ".env")
    if fallback_root is not None and fallback_root != skill_root:
        _load_dotenv(fallback_root / ".env")


def _engine(server: str | None, username: str | None, password: str | None, database: str):
    from sqlalchemy import create_engine
    from urllib.parse import quote_plus

    server = server or os.environ.get("SQLSERVER_SERVER") or os.environ.get("SERVER118")
    username = username or os.environ.get("SQLSERVER_USERNAME") or os.environ.get("SERVER118_USERNAME")
    password = password or os.environ.get("SQLSERVER_PASSWORD") or os.environ.get("SERVER118_PASSWORD")
    if not all([server, username, password]):
        raise ValueError("Missing SQL Server connection configuration.")
    url = f"mssql+pyodbc://{quote_plus(username)}:{quote_plus(password)}@{server}/{database}?driver=ODBC+Driver+17+for+SQL+Server&Encrypt=no&TrustServerCertificate=yes"
    return create_engine(url)


def read_live_data(*, server: str | None, username: str | None, password: str | None, database: str, finelines: tuple[str, ...]) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    from sqlalchemy import text

    performance_sql, tags_sql, params = build_fineline_queries(finelines)
    engine = _engine(server, username, password, database)
    try:
        with engine.connect() as connection:
            performance = pd.read_sql(text(performance_sql), connection, params=params)
            assortment = pd.read_sql(ASSORTMENT_SQL, connection)
            tags = pd.read_sql(text(tags_sql), connection, params=params)
            portfolio = pd.read_sql(text(PORTFOLIO_SQL), connection)
        return performance, assortment, tags, portfolio
    finally:
        engine.dispose()


def read_offline_data(performance_path: str | Path, assortment_path: str | Path, tags_path: str | Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    return pd.read_csv(performance_path), pd.read_csv(assortment_path), pd.read_csv(tags_path)


def read_offline_portfolio(path: str | Path) -> pd.DataFrame:
    from analyze_white_space import normalize_upc

    portfolio = pd.read_csv(path, dtype=str, keep_default_na=False)
    required = {"vendor_stock_id", "upc"}
    missing = required - set(portfolio.columns)
    if missing:
        raise ValueError(f"Portfolio CSV missing columns: {sorted(missing)}")
    portfolio["vendor_stock_id"] = portfolio["vendor_stock_id"].astype(str).str.strip()
    portfolio["upc"] = portfolio["upc"].map(normalize_upc)
    portfolio["portfolio_status"] = portfolio["upc"].map(
        lambda value: "mapped_existing_item" if value else "unmapped_wk31_new_item"
    )
    return portfolio[["vendor_stock_id", "upc", "portfolio_status"]]

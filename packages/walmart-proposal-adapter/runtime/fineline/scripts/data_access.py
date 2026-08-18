"""Data access helpers for Fineline investment analysis.

This module owns runtime data access only. It does not implement business
metrics or recommendations.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pandas as pd

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent


def first_env(names: list[str]) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def load_runtime_dotenv() -> None:
    if load_dotenv is None:
        return
    skill_env = SKILL_DIR / ".env"
    if skill_env.is_file():
        load_dotenv(skill_env, override=False)
    load_dotenv(override=False)


def resolve_sqlserver_connection(
    database: str | None,
    server: str | None = None,
    username: str | None = None,
    password: str | None = None,
) -> dict[str, str]:
    load_runtime_dotenv()
    resolved = {
        "server": server or first_env(["SQLSERVER_SERVER", "SERVER118"]),
        "username": username or first_env(["SQLSERVER_USERNAME", "SERVER118_USERNAME"]),
        "password": password or first_env(["SQLSERVER_PASSWORD", "SERVER118_PASSWORD"]),
        "database": database or first_env(["SQLSERVER_DATABASE"]) or "ods",
    }
    missing = [key for key, value in resolved.items() if not value]
    if missing:
        raise ValueError(
            "Missing SQL Server connection value(s): "
            f"{missing}. Provide CLI args or environment variables."
        )
    return {key: str(value) for key, value in resolved.items()}


def query_live_sql(
    sql: str,
    database: str | None,
    server: str | None = None,
    username: str | None = None,
    password: str | None = None,
) -> pd.DataFrame:
    try:
        import aidatafunctions as ad
    except ImportError as exc:
        raise ImportError(
            "Live SQL mode requires aidatafunctions. "
            "Install it in the Python environment, provide scripts/aidatafunctions, "
            "or use --input-path for offline analysis."
        ) from exc
    config = ad.SQLServerConfig(
        **resolve_sqlserver_connection(
            database=database,
            server=server,
            username=username,
            password=password,
        )
    )
    return ad.query_to_dataframe(sql, config=config, row_limit=None)


def read_offline_source_rows(input_path: str) -> pd.DataFrame:
    path = Path(input_path)
    suffix = path.suffix.lower()
    if suffix == ".json":
        payload: Any = json.loads(path.read_text(encoding="utf-8"))
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

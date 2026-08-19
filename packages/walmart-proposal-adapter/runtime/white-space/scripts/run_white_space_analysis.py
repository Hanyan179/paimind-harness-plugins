"""Supported CLI entry point for EDA and formal white-space analysis."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from analyze_white_space import DEFAULT_FINELINES, build_analysis, write_outputs
from data_access import load_runtime_env, read_live_data, read_offline_data, read_offline_portfolio


def parse_args(default_mode: str) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze Kids Crafts attribute white space and distribution opportunities.")
    parser.add_argument("--mode", choices=["eda", "formal"], default=default_mode)
    parser.add_argument("--performance-csv")
    parser.add_argument("--assortment-csv")
    parser.add_argument("--tags-csv")
    parser.add_argument("--portfolio-csv", help="Offline-test fixture only; live mode reads scintilla.ParamontItemList.")
    parser.add_argument("--output-dir", default="output/white-space-analysis")
    parser.add_argument("--database", default="ods")
    parser.add_argument(
        "--finelines",
        default=",".join(DEFAULT_FINELINES),
        help="Comma-separated Final Finelines to analyze (case-insensitive).",
    )
    parser.add_argument("--server")
    parser.add_argument("--username")
    parser.add_argument("--password")
    parser.add_argument(
        "--result-key",
        help="Also copy the structured JSON to output/<resultKey>.json for Artifact publication.",
    )
    parser.add_argument("--ppt-result-key", dest="result_key", help=argparse.SUPPRESS)
    return parser.parse_args()


def _resolve(value: str, base: Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else base / path


def _parse_finelines(value: str) -> tuple[str, ...]:
    finelines = tuple(dict.fromkeys(part.strip().upper() for part in value.split(",") if part.strip()))
    if not finelines:
        raise ValueError("--finelines must contain at least one Final Fineline.")
    return finelines


def main(default_mode: str = "formal") -> None:
    args = parse_args(default_mode)
    skill_root = SCRIPT_DIR.parent
    base = skill_root
    load_runtime_env(skill_root, None)
    finelines = _parse_finelines(args.finelines)
    offline = [args.performance_csv, args.assortment_csv, args.tags_csv]
    if any(offline) and not all(offline):
        raise ValueError("Offline mode requires --performance-csv, --assortment-csv, and --tags-csv together.")
    if all(offline):
        if not args.portfolio_csv:
            raise ValueError("Offline mode requires --portfolio-csv. Live mode reads scintilla.ParamontItemList.")
        performance, assortment, tags = read_offline_data(*[_resolve(v, base) for v in offline])
        portfolio = read_offline_portfolio(_resolve(args.portfolio_csv, base))
        portfolio_source = "offline_portfolio_csv_fixture"
    else:
        if args.portfolio_csv:
            raise ValueError("--portfolio-csv is only supported with offline CSV inputs; live mode always reads scintilla.ParamontItemList.")
        performance, assortment, tags, portfolio = read_live_data(server=args.server, username=args.username, password=args.password, database=args.database, finelines=finelines)
        portfolio_source = "scintilla.ParamontItemList"
    result = build_analysis(performance, assortment, tags, portfolio, finelines=finelines, portfolio_source=portfolio_source)
    artifacts = write_outputs(result, _resolve(args.output_dir, base), mode=args.mode)
    if args.result_key:
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,127}", args.result_key):
            raise ValueError("--result-key must be a valid Artifact result key.")
        result_output = skill_root / "output" / f"{args.result_key}.json"
        result_output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(Path(artifacts["json"]), result_output)
        artifacts["data_result"] = str(result_output)
    print(json.dumps({"execution_status": "success", "mode": args.mode, "artifacts": artifacts}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

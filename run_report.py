#!/usr/bin/env python3
"""Regenerate charts and the HTML report from an existing results directory.

Example:
    python run_report.py --input results/
"""

from __future__ import annotations

import argparse
from pathlib import Path

from src.data_loader import load_config
from src.reports import generate_reports_from_files


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="results", help="Directory with equity_curve.csv and trade_log.csv")
    parser.add_argument("--output", default=None, help="Output directory (default: input)")
    parser.add_argument("--config", default="config.yaml", help="Config for cost/capital assumptions")
    parser.add_argument("--title", default=None, help="Report title")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = {}
    config_path = Path(args.config)
    if config_path.exists():
        config = load_config(config_path)
    paths = generate_reports_from_files(
        args.input,
        args.output,
        config=config,
        title=args.title,
    )
    print(f"Report regenerated: {paths['performance_report'].resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

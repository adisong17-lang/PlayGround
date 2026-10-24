#!/usr/bin/env python3
"""Run the event-driven backtest and write all reports.

Example:
    python run_backtest.py --config config.yaml
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from src.backtest import run_backtest
from src.data_loader import configure_cli_data, load_config, load_data
from src.reports import generate_reports


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="config.yaml", help="YAML configuration file")
    parser.add_argument("--output", default=None, help="Report output directory")
    parser.add_argument("--provider", default=None, help="Override data.provider")
    parser.add_argument("--data-path", default=None, help="Override data.path")
    parser.add_argument("--scenario", default=None, help="Synthetic scenario name")
    parser.add_argument("--start", default=None, help="Override start date (YYYY-MM-DD)")
    parser.add_argument("--end", default=None, help="Override end date (YYYY-MM-DD)")
    parser.add_argument("--capital", type=float, default=None, help="Override initial capital")
    parser.add_argument("--title", default=None, help="Report title")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = load_config(args.config)
    if args.start:
        config.setdefault("data", {})["start"] = args.start
    if args.end:
        config.setdefault("data", {})["end"] = args.end
    if args.capital is not None:
        config.setdefault("backtest", {})["initial_capital"] = args.capital

    configure_cli_data(
        config,
        provider=args.provider,
        data_path=args.data_path,
        scenario=args.scenario,
    )
    bundle = load_data(config)
    print(
        f"Loaded {len(bundle.data)} symbols, {len(bundle.benchmark)} benchmark sessions "
        f"from {bundle.source}"
    )
    result = run_backtest(bundle, config)
    output = Path(args.output or config.get("report", {}).get("output_dir", "results"))
    title = args.title or config.get("report", {}).get(
        "title", "Liquid Volatility-Adjusted Momentum Swing System"
    )
    paths = generate_reports(result, output, title=title)
    (output / "run_metadata.json").write_text(
        json.dumps(
            {
                "source": bundle.source,
                "symbols": len(bundle.data),
                "benchmark_sessions": len(bundle.benchmark),
                "summary": result.summary(),
            },
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )

    summary = result.summary()
    print("\nBacktest summary")
    print("-" * 56)
    for key in (
        "start",
        "end",
        "initial_capital",
        "final_equity",
        "total_return",
        "cagr",
        "max_drawdown",
        "sharpe",
        "sortino",
        "calmar",
        "trades",
        "win_rate",
        "profit_factor",
        "expectancy_r",
        "exposure",
        "total_costs",
    ):
        value = summary.get(key)
        if isinstance(value, float):
            if key in {"total_return", "cagr", "max_drawdown", "win_rate", "exposure"}:
                value = f"{value:.2%}"
            else:
                value = f"{value:,.3f}"
        print(f"{key:>18}: {value}")
    print(f"\nReports written to {output.resolve()}")
    print(f"HTML report: {paths['performance_report'].resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

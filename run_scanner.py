#!/usr/bin/env python3
"""Scan the latest session for eligible swing entries.

Example:
    python run_scanner.py --capital 200000 --config config.yaml
"""

from __future__ import annotations

import argparse
from pathlib import Path

from src.data_loader import configure_cli_data, load_config
from src.scanner import format_scanner_output, scan


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="config.yaml", help="YAML configuration file")
    parser.add_argument("--capital", type=float, default=None, help="Current equity/capital")
    parser.add_argument("--as-of", default=None, help="Scan as of YYYY-MM-DD (default: latest)")
    parser.add_argument("--output-dir", default="results", help="Directory for the scanner CSV")
    parser.add_argument("--provider", default=None, help="Override data.provider")
    parser.add_argument("--data-path", default=None, help="Override data.path")
    parser.add_argument("--scenario", default=None, help="Synthetic scenario name")
    parser.add_argument("--limit", type=int, default=20, help="Rows to print")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = load_config(args.config)
    configure_cli_data(
        config,
        provider=args.provider,
        data_path=args.data_path,
        scenario=args.scenario,
    )

    from src.data_loader import load_data

    bundle = load_data(config)
    frame, summary = scan(
        config,
        capital=args.capital,
        as_of=args.as_of,
        bundle=bundle,
        output_dir=Path(args.output_dir),
    )
    print(format_scanner_output(frame, summary, limit=args.limit))
    output = Path(args.output_dir) / f"scanner_{summary['as_of'].replace('-', '')}.csv"
    print(f"\nScanner CSV: {output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

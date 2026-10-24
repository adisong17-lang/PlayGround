from __future__ import annotations

import json
import numpy as np
import pandas as pd
from conftest import make_signal_bundle
from src.backtest import run_backtest
from src.metrics import compute_metrics
from src.reports import generate_reports, generate_reports_from_files
from src.scanner import SCANNER_COLUMNS, scan


def test_scanner_outputs_required_columns_and_sizing(tmp_path):
    bundle, config, dates = make_signal_bundle()
    frame, summary = scan(
        config,
        capital=200_000,
        as_of=dates[300],
        bundle=bundle,
        output_dir=tmp_path,
    )
    assert list(frame.columns) == SCANNER_COLUMNS
    assert summary["regime_ok"] is True
    assert summary["eligible"] == 1
    row = frame.loc[frame["symbol"] == "A1"].iloc[0]
    assert bool(row["eligible"])
    assert row["quantity"] > 0
    assert row["position_value"] <= 200_000 * 0.20 + 1e-6
    assert (tmp_path / f"scanner_{dates[300].strftime('%Y%m%d')}.csv").exists()
    assert set(frame["rejection_reason"].astype(str)).issuperset(
        {"not_top_momentum_20pct|sector_not_eligible|weak_relative_strength"}
    ) or frame["rejection_reason"].astype(str).str.len().gt(0).all()


def test_metrics_handle_empty_trades_and_monthly_returns():
    dates = pd.bdate_range("2020-01-01", "2021-12-31")
    equity = 100_000 * np.exp(np.arange(len(dates)) * 0.0003)
    equity[300:340] *= 0.94
    frame = pd.DataFrame({"date": dates, "equity": equity})
    metrics = compute_metrics(frame, pd.DataFrame(), {"backtest": {"initial_capital": 100_000}})
    assert metrics["trades"] == 0
    assert metrics["total_return"] > 0
    assert metrics["max_drawdown"] < 0
    assert metrics["monthly_returns"]
    assert metrics["annual_returns"]
    assert metrics["sector_results"] == []


def test_reports_generate_all_required_files_and_regenerate(tmp_path):
    bundle, config, _ = make_signal_bundle()
    result = run_backtest(bundle, config)
    output = tmp_path / "results"
    paths = generate_reports(result, output, title="Test Report")
    required = {
        "trade_log.csv",
        "equity_curve.csv",
        "monthly_returns.csv",
        "performance_report.html",
        "equity_curve.png",
        "drawdown_curve.png",
        "sector_performance.csv",
    }
    assert required.issubset({path.name for path in output.iterdir()})
    html_text = paths["performance_report"].read_text(encoding="utf-8")
    assert "Test Report" in html_text
    assert "data:image/png;base64" in html_text
    assert "Research output only" in html_text

    regenerated = tmp_path / "regenerated"
    generate_reports_from_files(output, regenerated, config=config, title="Regenerated")
    assert (regenerated / "performance_report.html").exists()
    assert (regenerated / "equity_curve.png").exists()
    metrics = json.loads((output / "metrics.json").read_text(encoding="utf-8"))
    assert "cagr" in metrics

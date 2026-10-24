"""CSV, chart and self-contained HTML report generation."""

from __future__ import annotations

import base64
import html
import json
from pathlib import Path
from typing import Any, Mapping

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import seaborn as sns  # noqa: E402

from .metrics import compute_metrics  # noqa: E402


def _pct(value: Any) -> str:
    if value is None or (isinstance(value, float) and not np.isfinite(value)):
        return "n/a"
    return f"{float(value) * 100:.2f}%"


def _num(value: Any, digits: int = 2) -> str:
    if value is None or (isinstance(value, float) and not np.isfinite(value)):
        return "n/a"
    return f"{float(value):,.{digits}f}"


def _html_table(frame: pd.DataFrame, formatters: Mapping[str, Any] | None = None) -> str:
    if frame is None or frame.empty:
        return '<p class="muted">No data.</p>'
    display = frame.copy()
    for column, formatter in (formatters or {}).items():
        if column in display.columns:
            display[column] = display[column].map(formatter)
    return display.to_html(index=False, classes="data", escape=True, na_rep="")


def _base64_image(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def _plot_equity(equity: pd.DataFrame, path: Path) -> None:
    sns.set_theme(style="whitegrid", context="talk")
    fig, ax = plt.subplots(figsize=(12, 6))
    dates = pd.to_datetime(equity["date"])
    ax.plot(dates, equity["equity"], label="Strategy", linewidth=2, color="#126e82")
    if "benchmark_equity" in equity.columns:
        ax.plot(
            dates,
            equity["benchmark_equity"],
            label="Benchmark",
            linewidth=1.4,
            color="#9b9b9b",
            linestyle="--",
        )
    ax.set_title("Equity Curve")
    ax.set_ylabel("Equity")
    ax.legend(loc="upper left")
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def _plot_drawdown(equity: pd.DataFrame, path: Path) -> None:
    sns.set_theme(style="whitegrid", context="talk")
    fig, ax = plt.subplots(figsize=(12, 4.5))
    dates = pd.to_datetime(equity["date"])
    drawdown = equity["drawdown"] if "drawdown" in equity.columns else (
        equity["equity"] / equity["equity"].cummax() - 1.0
    )
    ax.fill_between(dates, drawdown * 100, 0, color="#b23a48", alpha=0.55)
    ax.plot(dates, drawdown * 100, color="#7d1f2c", linewidth=1.2)
    ax.set_title("Drawdown")
    ax.set_ylabel("Drawdown (%)")
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def _monthly_table(monthly: list[dict[str, Any]]) -> pd.DataFrame:
    if not monthly:
        return pd.DataFrame()
    frame = pd.DataFrame(monthly)
    frame["year"] = frame["month"].str[:4]
    frame["month_num"] = frame["month"].str[5:7]
    pivot = frame.pivot(index="year", columns="month_num", values="return")
    pivot.columns = [
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
            int(c) - 1
        ]
        for c in pivot.columns
    ]
    return pivot.reset_index()


def _write_csvs(result: Any, out: Path) -> None:
    result.trades.to_csv(out / "trade_log.csv", index=False)
    result.equity_curve.to_csv(out / "equity_curve.csv", index=False)
    pd.DataFrame(result.metrics.get("monthly_returns", [])).to_csv(
        out / "monthly_returns.csv", index=False
    )
    pd.DataFrame(result.metrics.get("sector_results", [])).to_csv(
        out / "sector_performance.csv", index=False
    )
    pd.DataFrame(result.metrics.get("symbol_results", [])).to_csv(
        out / "symbol_performance.csv", index=False
    )
    pd.DataFrame(result.metrics.get("regime_results", [])).to_csv(
        out / "regime_performance.csv", index=False
    )
    (out / "metrics.json").write_text(json.dumps(result.metrics, indent=2, default=str), encoding="utf-8")


def _html_report(result: Any, out: Path, title: str) -> Path:
    metrics = result.metrics
    summary_rows = [
        ("Initial capital", _num(metrics.get("initial_capital"))),
        ("Final equity", _num(metrics.get("final_equity"))),
        ("Total return", _pct(metrics.get("total_return"))),
        ("CAGR", _pct(metrics.get("cagr"))),
        ("Max drawdown", _pct(metrics.get("max_drawdown"))),
        ("Max DD duration (calendar days)", str(metrics.get("max_drawdown_duration_days", "n/a"))),
        ("Sharpe", _num(metrics.get("sharpe"), 3)),
        ("Sortino", _num(metrics.get("sortino"), 3)),
        ("Calmar", _num(metrics.get("calmar"), 3)),
        ("Trades", str(metrics.get("trades", 0))),
        ("Win rate", _pct(metrics.get("win_rate"))),
        ("Profit factor", _num(metrics.get("profit_factor"), 3)),
        ("Payoff ratio", _num(metrics.get("payoff_ratio"), 3)),
        ("Expectancy (R)", _num(metrics.get("expectancy_r"), 3)),
        ("Avg holding (sessions)", _num(metrics.get("avg_holding_sessions"), 1)),
        ("Exposure", _pct(metrics.get("exposure"))),
        ("Annual turnover", _num(metrics.get("annual_turnover"), 2)),
        ("Total costs", _num(metrics.get("total_costs"))),
        ("Costs / initial capital", _pct(metrics.get("total_costs_pct_initial"))),
        ("Benchmark total return", _pct(metrics.get("benchmark_total_return"))),
        ("Benchmark CAGR", _pct(metrics.get("benchmark_cagr"))),
    ]
    summary = pd.DataFrame(summary_rows, columns=["Metric", "Value"])

    monthly = _monthly_table(metrics.get("monthly_returns", []))
    if not monthly.empty:
        monthly = monthly.rename(columns={"year": "Year"})
        for column in monthly.columns:
            if column != "Year":
                monthly[column] = monthly[column].map(_pct)
    annual = pd.DataFrame(metrics.get("annual_returns", []))
    if not annual.empty:
        annual["return"] = annual["return"].map(_pct)
        annual = annual.rename(columns={"year": "Year", "return": "Return"})
    sectors = pd.DataFrame(metrics.get("sector_results", []))
    if not sectors.empty:
        sectors = sectors.rename(
            columns={
                "sector": "Sector",
                "trades": "Trades",
                "win_rate": "Win rate",
                "total_pnl": "Net P&L",
                "avg_return_pct": "Avg return",
                "profit_factor": "Profit factor",
                "expectancy_r": "Expectancy R",
            }
        )
        for column in ("Win rate", "Avg return"):
            if column in sectors.columns:
                sectors[column] = sectors[column].map(_pct)
        for column in ("Net P&L",):
            if column in sectors.columns:
                sectors[column] = sectors[column].map(_num)
        for column in ("Profit factor", "Expectancy R"):
            if column in sectors.columns:
                sectors[column] = sectors[column].map(lambda v: _num(v, 3))
        sectors = sectors[
            [c for c in ("Sector", "Trades", "Win rate", "Net P&L", "Avg return", "Profit factor", "Expectancy R") if c in sectors.columns]
        ]
    symbols = pd.DataFrame(metrics.get("symbol_results", []))
    if not symbols.empty:
        symbols = symbols.rename(
            columns={
                "symbol": "Symbol",
                "trades": "Trades",
                "win_rate": "Win rate",
                "total_pnl": "Net P&L",
                "profit_factor": "Profit factor",
                "expectancy_r": "Expectancy R",
            }
        )
        symbols["Win rate"] = symbols["Win rate"].map(_pct)
        symbols["Net P&L"] = symbols["Net P&L"].map(_num)
        symbols["Profit factor"] = symbols["Profit factor"].map(lambda v: _num(v, 3))
        symbols["Expectancy R"] = symbols["Expectancy R"].map(lambda v: _num(v, 3))
        symbols = symbols[["Symbol", "Trades", "Win rate", "Net P&L", "Profit factor", "Expectancy R"]]

    recent = result.trades.tail(25).copy() if not result.trades.empty else result.trades
    if not recent.empty:
        for column in ("entry_price", "exit_price", "pnl", "total_costs"):
            if column in recent.columns:
                recent[column] = recent[column].map(_num)
        for column in ("return_pct", "r_multiple"):
            if column in recent.columns:
                recent[column] = recent[column].map(lambda v: _num(v, 3))
        recent = recent[
            [
                c
                for c in (
                    "symbol",
                    "sector",
                    "entry_date",
                    "exit_date",
                    "entry_price",
                    "exit_price",
                    "quantity",
                    "pnl",
                    "return_pct",
                    "r_multiple",
                    "holding_sessions",
                    "exit_reason",
                )
                if c in recent.columns
            ]
        ]

    equity_b64 = _base64_image(out / "equity_curve.png")
    dd_b64 = _base64_image(out / "drawdown_curve.png")
    css = """
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           margin: 0; background: #f5f7fa; color: #1d2733; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 24px 64px; }
    h1 { margin-bottom: 4px; }
    h2 { margin-top: 38px; border-bottom: 2px solid #d9e2ec; padding-bottom: 8px; }
    .muted { color: #64748b; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; }
    .card { background: white; border-radius: 12px; padding: 18px; box-shadow: 0 2px 8px rgba(15,23,42,.07); }
    table.data { border-collapse: collapse; width: 100%; font-size: 13px; background: white; }
    table.data th { background: #126e82; color: white; text-align: left; padding: 8px; }
    table.data td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; }
    table.data tr:nth-child(even) td { background: #f8fafc; }
    img { max-width: 100%; border-radius: 10px; background: white; }
    .note { background: #fff7e6; border-left: 4px solid #d69e2e; padding: 12px 16px; border-radius: 6px; }
    """
    body = f"""
    <h1>{html.escape(title)}</h1>
    <p class="muted">Backtest {html.escape(str(metrics.get('start')))} to {html.escape(str(metrics.get('end')))}.
    Research output only; no live trading or broker integration.</p>
    <div class="note">Past performance and synthetic backtests do not guarantee future profitability.
    Results are sensitive to costs, slippage, survivorship, regime definitions and parameter choices.</div>
    <h2>Summary</h2>
    <div class="grid"><div class="card">{_html_table(summary)}</div></div>
    <h2>Equity and drawdown</h2>
    <img src="data:image/png;base64,{equity_b64}" alt="Equity curve">
    <img src="data:image/png;base64,{dd_b64}" alt="Drawdown curve">
    <h2>Monthly returns</h2>
    {_html_table(monthly)}
    <h2>Annual returns</h2>
    {_html_table(annual)}
    <h2>Sector performance</h2>
    {_html_table(sectors)}
    <h2>Symbol performance</h2>
    {_html_table(symbols)}
    <h2>Recent trades</h2>
    {_html_table(recent)}
    """
    document = f"<!doctype html><html lang='en'><head><meta charset='utf-8'><title>{html.escape(title)}</title><style>{css}</style></head><body><main>{body}</main></body></html>"
    path = out / "performance_report.html"
    path.write_text(document, encoding="utf-8")
    return path


def generate_reports(
    result: Any,
    output_dir: str | Path,
    *,
    title: str | None = None,
) -> dict[str, Path]:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    _write_csvs(result, out)
    _plot_equity(result.equity_curve, out / "equity_curve.png")
    _plot_drawdown(result.equity_curve, out / "drawdown_curve.png")
    report = _html_report(result, out, title or "Momentum Swing Backtest")
    return {
        "trade_log": out / "trade_log.csv",
        "equity_curve": out / "equity_curve.csv",
        "monthly_returns": out / "monthly_returns.csv",
        "sector_performance": out / "sector_performance.csv",
        "symbol_performance": out / "symbol_performance.csv",
        "regime_performance": out / "regime_performance.csv",
        "metrics": out / "metrics.json",
        "equity_curve_png": out / "equity_curve.png",
        "drawdown_curve_png": out / "drawdown_curve.png",
        "performance_report": report,
    }


class _LoadedResult:
    def __init__(self, equity_curve: pd.DataFrame, trades: pd.DataFrame, metrics: dict[str, Any]):
        self.equity_curve = equity_curve
        self.trades = trades
        self.metrics = metrics


def generate_reports_from_files(
    input_dir: str | Path,
    output_dir: str | Path | None = None,
    *,
    config: Mapping[str, Any] | None = None,
    title: str | None = None,
) -> dict[str, Path]:
    input_dir = Path(input_dir)
    output_dir = Path(output_dir) if output_dir else input_dir
    equity_path = input_dir / "equity_curve.csv"
    trades_path = input_dir / "trade_log.csv"
    if not equity_path.exists():
        raise FileNotFoundError(f"{equity_path} not found")
    equity = pd.read_csv(equity_path)
    equity["date"] = pd.to_datetime(equity["date"])
    trades = pd.read_csv(trades_path) if trades_path.exists() else pd.DataFrame()
    cfg = dict(config or {})
    cfg.setdefault("backtest", {})
    cfg["backtest"].setdefault("initial_capital", float(equity["equity"].iloc[0]))
    metrics = compute_metrics(equity, trades, cfg)
    result = _LoadedResult(equity, trades, metrics)
    return generate_reports(result, output_dir, title=title)

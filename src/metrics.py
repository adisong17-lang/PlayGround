"""Performance, risk, trade, exposure and attribution metrics."""

from __future__ import annotations

import math
from typing import Any, Mapping

import numpy as np
import pandas as pd


def _finite(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None


def _safe_divide(numerator: float, denominator: float) -> float | None:
    if denominator is None or not np.isfinite(denominator) or denominator == 0:
        return None
    value = numerator / denominator
    return float(value) if np.isfinite(value) else None


def _drawdown_duration(equity: pd.Series, dates: pd.Series) -> tuple[int, int]:
    """Return (max calendar days, max trading sessions) spent underwater."""
    peak_date = pd.Timestamp(dates.iloc[0])
    underwater_start: pd.Timestamp | None = None
    max_days = 0
    max_sessions = 0
    sessions = 0
    for date, value in zip(pd.to_datetime(dates), equity.to_numpy()):
        date = pd.Timestamp(date)
        if value < 0:
            if underwater_start is None:
                underwater_start = peak_date
            sessions += 1
            max_days = max(max_days, (date - underwater_start).days)
            max_sessions = max(max_sessions, sessions)
        else:
            underwater_start = None
            sessions = 0
            peak_date = date
    return int(max_days), int(max_sessions)


def _max_streak(values: list[bool]) -> int:
    best = current = 0
    for value in values:
        if value:
            current += 1
            best = max(best, current)
        else:
            current = 0
    return best


def _group_stats(trades: pd.DataFrame, column: str) -> list[dict[str, Any]]:
    if trades.empty or column not in trades.columns:
        return []
    rows = []
    for name, group in trades.groupby(column, dropna=False):
        pnl = group["pnl"].astype(float)
        wins = pnl[pnl > 0]
        losses = pnl[pnl < 0]
        gross_profit = float(wins.sum())
        gross_loss = float(losses.sum())
        rows.append(
            {
                column: str(name),
                "trades": int(len(group)),
                "win_rate": _finite(len(wins) / len(group)) if len(group) else None,
                "total_pnl": float(pnl.sum()),
                "avg_pnl": float(pnl.mean()),
                "avg_return_pct": _finite(group["return_pct"].mean()),
                "profit_factor": _safe_divide(gross_profit, abs(gross_loss)),
                "expectancy_r": _finite(group["r_multiple"].mean()),
                "avg_holding_sessions": _finite(group["holding_sessions"].mean()),
                "total_costs": float(group["total_costs"].sum()),
            }
        )
    return sorted(rows, key=lambda item: item["total_pnl"], reverse=True)


def _period_returns(equity: pd.Series, frequency: str, label: str) -> list[dict[str, Any]]:
    if equity.empty:
        return []
    grouped = equity.resample(frequency).last().dropna()
    if grouped.empty:
        return []
    returns = grouped.pct_change()
    if len(grouped) > 0 and equity.iloc[0] != 0:
        returns.iloc[0] = grouped.iloc[0] / equity.iloc[0] - 1.0
    rows = []
    for period, value in returns.items():
        if pd.isna(value):
            continue
        if frequency == "ME":
            key = pd.Timestamp(period).strftime("%Y-%m")
        else:
            key = str(pd.Timestamp(period).year)
        rows.append({label: key, "return": float(value)})
    return rows


def compute_metrics(
    equity_curve: pd.DataFrame,
    trades: pd.DataFrame,
    config: Mapping[str, Any],
) -> dict[str, Any]:
    if equity_curve is None or equity_curve.empty:
        raise ValueError("equity_curve is empty")
    equity = equity_curve.copy()
    equity["date"] = pd.to_datetime(equity["date"])
    equity = equity.sort_values("date").reset_index(drop=True)
    equity_series = equity.set_index("date")["equity"].astype(float)
    initial = float(config.get("backtest", {}).get("initial_capital", equity_series.iloc[0]))
    final = float(equity_series.iloc[-1])
    start = pd.Timestamp(equity["date"].iloc[0])
    end = pd.Timestamp(equity["date"].iloc[-1])
    years = max((end - start).days / 365.25, 0.0)
    ppy = int(config.get("backtest", {}).get("periods_per_year", 252))
    risk_free = float(config.get("backtest", {}).get("risk_free_rate", 0.0))

    total_return = final / initial - 1.0 if initial > 0 else None
    cagr = None
    if initial > 0 and final > 0 and years > 0:
        cagr = (final / initial) ** (1.0 / years) - 1.0

    daily_returns = equity_series.pct_change(fill_method=None).dropna()
    if len(daily_returns) > 1:
        excess = daily_returns - risk_free / ppy
        std = float(daily_returns.std(ddof=1))
        sharpe = _safe_divide(float(excess.mean()) * ppy, std * math.sqrt(ppy))
        downside = np.minimum(daily_returns.to_numpy(), 0.0)
        downside_dev = float(np.sqrt(np.mean(downside**2)))
        sortino = _safe_divide(float(excess.mean()) * ppy, downside_dev * math.sqrt(ppy))
        annual_vol = std * math.sqrt(ppy)
    else:
        sharpe = sortino = annual_vol = None

    if "drawdown" in equity.columns:
        drawdown = equity.set_index("date")["drawdown"].astype(float)
    else:
        drawdown = equity_series / equity_series.cummax() - 1.0
    max_drawdown = float(drawdown.min()) if len(drawdown) else None
    max_dd_days, max_dd_sessions = _drawdown_duration(drawdown, equity["date"])
    calmar = _safe_divide(cagr, abs(max_drawdown)) if cagr is not None and max_drawdown else None

    monthly_returns = _period_returns(equity_series, "ME", "month")
    annual_returns = _period_returns(equity_series, "YE", "year")

    result: dict[str, Any] = {
        "start": start.date().isoformat(),
        "end": end.date().isoformat(),
        "initial_capital": initial,
        "final_equity": final,
        "total_return": _finite(total_return),
        "cagr": _finite(cagr),
        "annual_volatility": _finite(annual_vol),
        "max_drawdown": _finite(max_drawdown),
        "max_drawdown_duration_days": max_dd_days,
        "max_drawdown_duration_sessions": max_dd_sessions,
        "sharpe": _finite(sharpe),
        "sortino": _finite(sortino),
        "calmar": _finite(calmar),
        "trading_days": int(len(equity)),
        "years": years,
    }

    if "exposure" in equity.columns:
        result["exposure"] = _finite(equity["exposure"].mean())
        result["max_exposure"] = _finite(equity["exposure"].max())
        result["time_in_market"] = _finite((equity["exposure"] > 0).mean())
    if "open_positions" in equity.columns:
        result["avg_open_positions"] = _finite(equity["open_positions"].mean())
        result["max_open_positions"] = int(equity["open_positions"].max())

    # Benchmark comparison -------------------------------------------------
    if "benchmark_equity" in equity.columns:
        bench = equity.set_index("date")["benchmark_equity"].astype(float).dropna()
        if len(bench) > 1 and bench.iloc[0] > 0:
            result["benchmark_total_return"] = float(bench.iloc[-1] / bench.iloc[0] - 1.0)
            if years > 0 and bench.iloc[-1] > 0:
                result["benchmark_cagr"] = float((bench.iloc[-1] / bench.iloc[0]) ** (1 / years) - 1)
            bdd = bench / bench.cummax() - 1.0
            result["benchmark_max_drawdown"] = float(bdd.min())

    # Trade statistics -----------------------------------------------------
    trade_count = 0 if trades is None else int(len(trades))
    result["trades"] = trade_count
    if trade_count:
        frame = trades.copy()
        pnl = frame["pnl"].astype(float)
        wins = pnl[pnl > 0]
        losses = pnl[pnl < 0]
        gross_profit = float(wins.sum())
        gross_loss = float(losses.sum())
        avg_winner = float(wins.mean()) if len(wins) else 0.0
        avg_loser = float(losses.mean()) if len(losses) else 0.0
        result.update(
            {
                "win_rate": _finite(len(wins) / trade_count),
                "winners": int(len(wins)),
                "losers": int(len(losses)),
                "breakeven": int((pnl == 0).sum()),
                "avg_winner": avg_winner,
                "avg_loser": avg_loser,
                "avg_winner_pct": _finite(frame.loc[pnl > 0, "return_pct"].mean()),
                "avg_loser_pct": _finite(frame.loc[pnl < 0, "return_pct"].mean()),
                "payoff_ratio": _safe_divide(avg_winner, abs(avg_loser)),
                "profit_factor": _safe_divide(gross_profit, abs(gross_loss)),
                "expectancy": float(pnl.mean()),
                "expectancy_r": _finite(frame["r_multiple"].mean()),
                "avg_holding_sessions": _finite(frame["holding_sessions"].mean()),
                "median_holding_sessions": _finite(frame["holding_sessions"].median()),
                "gross_profit": gross_profit,
                "gross_loss": gross_loss,
                "best_trade": float(pnl.max()),
                "worst_trade": float(pnl.min()),
                "total_costs": float(frame["total_costs"].sum()),
                "explicit_charges": float(frame["charges"].sum()),
                "impact_costs": float(frame["impact_costs"].sum()),
                "total_costs_pct_initial": _safe_divide(float(frame["total_costs"].sum()), initial),
                "avg_r_multiple": _finite(frame["r_multiple"].mean()),
            }
        )
        ordered = frame.sort_values("exit_date")
        result["max_consecutive_wins"] = _max_streak(list(ordered["pnl"] > 0))
        result["max_consecutive_losses"] = _max_streak(list(ordered["pnl"] < 0))
        if "entry_date" in frame.columns and "exit_date" in frame.columns:
            holding_days = (
                pd.to_datetime(frame["exit_date"]) - pd.to_datetime(frame["entry_date"])
            ).dt.days
            result["avg_holding_calendar_days"] = _finite(holding_days.mean())
        result["sector_results"] = _group_stats(frame, "sector")
        result["symbol_results"] = _group_stats(frame, "symbol")
        result["regime_results"] = _group_stats(frame, "entry_regime")

        traded_notional = float(
            (frame["position_value"] + frame["exit_price"] * frame["quantity"]).sum()
        )
        avg_equity = float(equity_series.mean())
        result["total_turnover"] = _safe_divide(traded_notional, avg_equity)
        result["annual_turnover"] = (
            _safe_divide(traded_notional, avg_equity * years) if years > 0 else None
        )
    else:
        result.update(
            {
                "win_rate": None,
                "winners": 0,
                "losers": 0,
                "avg_winner": None,
                "avg_loser": None,
                "payoff_ratio": None,
                "profit_factor": None,
                "expectancy": None,
                "expectancy_r": None,
                "avg_holding_sessions": None,
                "total_costs": 0.0,
                "explicit_charges": 0.0,
                "impact_costs": 0.0,
                "total_costs_pct_initial": 0.0,
                "max_consecutive_wins": 0,
                "max_consecutive_losses": 0,
                "total_turnover": 0.0,
                "annual_turnover": 0.0,
                "sector_results": [],
                "symbol_results": [],
                "regime_results": [],
            }
        )

    # Daily regime attribution --------------------------------------------
    if "regime" in equity.columns and len(daily_returns):
        regime_series = equity.set_index("date")["regime"].reindex(daily_returns.index)
        rows = []
        for label, values in daily_returns.groupby(regime_series.fillna(False)):
            rows.append(
                {
                    "regime": "bull" if bool(label) else "bear",
                    "days": int(len(values)),
                    "avg_daily_return": float(values.mean()),
                    "cumulative_return": float((1.0 + values).prod() - 1.0),
                    "annualized_volatility": float(values.std(ddof=1) * math.sqrt(ppy))
                    if len(values) > 1
                    else None,
                }
            )
        result["regime_daily_results"] = rows
    else:
        result["regime_daily_results"] = []

    result["monthly_returns"] = monthly_returns
    result["annual_returns"] = annual_returns
    return result

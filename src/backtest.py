"""Event-driven, long-only daily backtester with strict next-open execution."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

import numpy as np
import pandas as pd

from .costs import CostModel
from .data_loader import DataBundle
from .metrics import compute_metrics
from .portfolio import Portfolio
from .regime import regime_at, regime_frame
from .risk import compute_stop, size_position
from .strategy import build_candidates, evaluate_exit, prepare_data
from .universe import Universe


@dataclass
class BacktestResult:
    equity_curve: pd.DataFrame
    trades: pd.DataFrame
    metrics: dict[str, Any]
    signal_log: pd.DataFrame = field(default_factory=pd.DataFrame)
    rejections: pd.DataFrame = field(default_factory=pd.DataFrame)
    config: dict[str, Any] = field(default_factory=dict)
    initial_capital: float = 0.0
    start: pd.Timestamp | None = None
    end: pd.Timestamp | None = None

    def summary(self) -> dict[str, Any]:
        keys = [
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
            "total_costs",
            "exposure",
        ]
        return {key: self.metrics.get(key) for key in keys if key in self.metrics}


def _panel(
    prepared: Mapping[str, pd.DataFrame], column: str, dates: pd.DatetimeIndex
) -> pd.DataFrame:
    series = {}
    for symbol, df in prepared.items():
        if column in df.columns:
            series[symbol] = df[column].reindex(dates)
    if not series:
        return pd.DataFrame(index=dates)
    return pd.DataFrame(series, index=dates)


class Backtester:
    def __init__(self, bundle: DataBundle, config: Mapping[str, Any]):
        self.bundle = bundle
        self.config = dict(config)
        self.costs = CostModel.from_config(config)
        self.universe = Universe(bundle, config)
        self.prepared = prepare_data(bundle.data, config)
        self.benchmark = bundle.benchmark.copy()
        self.regime = regime_frame(self.benchmark, config)
        self.dates = pd.DatetimeIndex(self.benchmark.index).sort_values()
        self.close_panel = _panel(self.prepared, "close", self.dates)
        self.open_panel = _panel(self.prepared, "open", self.dates)
        self.high_panel = _panel(self.prepared, "high", self.dates)
        self.low_panel = _panel(self.prepared, "low", self.dates)
        self.atr_panel = _panel(
            self.prepared, f"atr{int(config.get('strategy', {}).get('atr_window', 14))}", self.dates
        )
        self.ema_panel = _panel(
            self.prepared, f"ema{int(config.get('strategy', {}).get('ema_fast', 20))}", self.dates
        )
        self.portfolio = Portfolio(float(config.get("backtest", {}).get("initial_capital", 1_000_000)))
        self.pending_entries: dict[str, dict[str, Any]] = {}
        self.pending_exits: dict[str, str] = {}
        self.signal_log: list[dict[str, Any]] = []
        self.rejections: list[dict[str, Any]] = []

    # ------------------------------------------------------------------
    def _row_map(self, panel: pd.DataFrame, date: pd.Timestamp) -> dict[str, float]:
        if date not in panel.index:
            return {}
        return {k: float(v) for k, v in panel.loc[date].dropna().items()}

    def _affordable_quantity(self, quantity: int, price: float, cash: float) -> int:
        if quantity <= 0:
            return 0
        quantity = min(quantity, int(cash / price)) if price > 0 else 0
        while quantity > 0:
            charges = self.costs.charges("buy", price, quantity).total
            if price * quantity + charges <= cash + 1e-9:
                return quantity
            quantity -= 1
        return 0

    def _reject(self, date: pd.Timestamp, symbol: str, reason: str, detail: str = "") -> None:
        self.rejections.append(
            {"date": pd.Timestamp(date), "symbol": symbol, "reason": reason, "detail": detail}
        )

    # ------------------------------------------------------------------
    def _execute_exits(self, date: pd.Timestamp) -> None:
        open_prices = self._row_map(self.open_panel, date)
        for symbol in list(self.pending_exits):
            if symbol not in self.portfolio.positions:
                self.pending_exits.pop(symbol, None)
                continue
            if symbol not in open_prices or not np.isfinite(open_prices[symbol]):
                continue
            reference = open_prices[symbol]
            fill = self.costs.fill_price("sell", reference)
            charges = self.costs.charges("sell", fill, self.portfolio.positions[symbol].quantity)
            impact = self.costs.impact_cost(fill, self.portfolio.positions[symbol].quantity)
            reason = self.pending_exits.pop(symbol)
            self.portfolio.close_position(
                symbol,
                exit_date=date,
                exit_price=fill,
                exit_reason=reason,
                exit_charges=charges.total,
                exit_impact=impact,
            )

    def _execute_entries(self, date: pd.Timestamp, regime_label: str) -> None:
        open_prices = self._row_map(self.open_panel, date)
        low_prices = self._row_map(self.low_panel, date)
        cfg = self.config
        strategy_cfg = cfg.get("strategy", {})
        pending = sorted(
            self.pending_entries.values(), key=lambda item: float(item.get("score", 0.0)), reverse=True
        )
        self.pending_entries.clear()

        for candidate in pending:
            symbol = candidate["symbol"]
            if symbol in self.portfolio.positions:
                self._reject(date, symbol, "already_holding")
                continue
            if symbol not in open_prices or not np.isfinite(open_prices[symbol]):
                self._reject(date, symbol, "missing_execution_data")
                continue

            reference_open = float(open_prices[symbol])
            signal_close = float(candidate["entry_reference"])
            gap_up = reference_open / signal_close - 1.0
            if gap_up > float(strategy_cfg.get("max_gap_up_pct", 0.03)):
                self._reject(date, symbol, "gap_up_above_limit", f"{gap_up:.2%}")
                continue

            entry_price = self.costs.fill_price("buy", reference_open)
            stop_plan = compute_stop(
                entry_price,
                float(candidate["swing_low"]),
                float(candidate["atr"]),
                float(strategy_cfg.get("atr_stop_mult", 2.0)),
                float(strategy_cfg.get("max_stop_distance_pct", 0.08)),
            )
            if not stop_plan.valid:
                self._reject(date, symbol, stop_plan.reason)
                continue

            equity_at_open = self.portfolio.equity(open_prices)
            sizing = size_position(
                equity=equity_at_open,
                entry_price=entry_price,
                stop_price=stop_plan.stop_price,
                config=cfg,
                cash=self.portfolio.cash,
                open_positions=len(self.portfolio.positions),
                sector_positions=self.portfolio.sector_count(candidate["sector"]),
                portfolio_risk_amount=self.portfolio.open_risk(),
            )
            if not sizing.valid:
                self._reject(date, symbol, sizing.reason)
                continue

            quantity = self._affordable_quantity(sizing.quantity, entry_price, self.portfolio.cash)
            if quantity < int(cfg.get("risk", {}).get("min_quantity", 1)):
                self._reject(date, symbol, "insufficient_cash")
                continue

            charges = self.costs.charges("buy", entry_price, quantity)
            impact = self.costs.impact_cost(entry_price, quantity)
            self.portfolio.open_position(
                symbol=symbol,
                sector=candidate["sector"],
                signal_date=candidate["signal_date"],
                entry_date=date,
                entry_price=entry_price,
                signal_close=signal_close,
                quantity=quantity,
                initial_stop=stop_plan.stop_price,
                atr_at_entry=float(candidate["atr"]),
                entry_charges=charges.total,
                entry_impact=impact,
                entry_regime=candidate.get("regime", regime_label),
            )

            low = low_prices.get(symbol, np.nan)
            if np.isfinite(low) and low <= stop_plan.stop_price:
                if reference_open <= stop_plan.stop_price:
                    exit_reference = reference_open
                    reason = "gap_through_stop"
                else:
                    exit_reference = stop_plan.stop_price
                    reason = "initial_stop"
                sell_fill = self.costs.fill_price("sell", exit_reference)
                sell_charges = self.costs.charges("sell", sell_fill, quantity)
                sell_impact = self.costs.impact_cost(sell_fill, quantity)
                position = self.portfolio.positions[symbol]
                position.holding_sessions = max(1, position.holding_sessions)
                self.portfolio.close_position(
                    symbol,
                    exit_date=date,
                    exit_price=sell_fill,
                    exit_reason=reason,
                    exit_charges=sell_charges.total,
                    exit_impact=sell_impact,
                )

    def _intraday_hard_stops(self, date: pd.Timestamp) -> None:
        open_prices = self._row_map(self.open_panel, date)
        low_prices = self._row_map(self.low_panel, date)
        for symbol in list(self.portfolio.positions):
            if symbol in self.pending_exits:
                continue
            position = self.portfolio.positions[symbol]
            if symbol not in low_prices or not np.isfinite(low_prices[symbol]):
                continue
            stop = position.initial_stop
            if low_prices[symbol] > stop:
                continue
            opened = open_prices.get(symbol, np.nan)
            if np.isfinite(opened) and opened < stop:
                reference = opened
                reason = "gap_through_stop"
            else:
                reference = stop
                reason = "initial_stop"
            fill = self.costs.fill_price("sell", reference)
            charges = self.costs.charges("sell", fill, position.quantity)
            impact = self.costs.impact_cost(fill, position.quantity)
            self.portfolio.close_position(
                symbol,
                exit_date=date,
                exit_price=fill,
                exit_reason=reason,
                exit_charges=charges.total,
                exit_impact=impact,
            )

    def _mark_and_schedule_exits(self, date: pd.Timestamp) -> None:
        closes = self._row_map(self.close_panel, date)
        atrs = self._row_map(self.atr_panel, date)
        emas = self._row_map(self.ema_panel, date)
        self.portfolio.mark(
            date,
            closes,
            atrs,
            trailing_atr_mult=float(self.config.get("strategy", {}).get("trailing_atr_mult", 2.5)),
        )
        for symbol, position in list(self.portfolio.positions.items()):
            if symbol in emas:
                if closes.get(symbol, np.nan) < emas[symbol]:
                    position.below_ema_days += 1
                else:
                    position.below_ema_days = 0
            if symbol in self.pending_exits:
                continue
            df = self.prepared.get(symbol)
            if df is None or date not in df.index:
                continue
            row = df.loc[date]
            reason, detail = evaluate_exit(position, row, self.config)
            if reason:
                self.pending_exits[symbol] = reason
                self.signal_log.append(
                    {
                        "date": date,
                        "symbol": symbol,
                        "event": "exit_signal",
                        "reason": reason,
                        "detail": detail,
                    }
                )

    def _schedule_entries(self, date: pd.Timestamp, next_exists: bool) -> None:
        if not next_exists:
            return
        if not regime_at(self.regime, date):
            return
        candidates, _ = build_candidates(
            self.prepared,
            self.universe,
            self.benchmark,
            date,
            self.config,
            require_confirmation=True,
        )
        if candidates.empty:
            return
        eligible = candidates.loc[candidates["eligible"]].sort_values("score", ascending=False)
        for row in eligible.to_dict("records"):
            symbol = row["symbol"]
            if symbol in self.portfolio.positions:
                continue
            row["signal_date"] = date
            row["regime"] = "bull"
            self.pending_entries[symbol] = row
            self.signal_log.append(
                {
                    "date": date,
                    "symbol": symbol,
                    "event": "entry_signal",
                    "reason": "eligible",
                    "detail": f"score={row['score']:.4f}",
                }
            )

    # ------------------------------------------------------------------
    def run(self) -> BacktestResult:
        dates = list(self.dates)
        if not dates:
            raise ValueError("No benchmark trading dates to backtest")
        close_cfg = bool(self.config.get("backtest", {}).get("close_positions_at_end", True))

        for index, date in enumerate(dates):
            is_last = index == len(dates) - 1
            self._execute_exits(date)
            self._execute_entries(date, regime_label="bull")
            self._intraday_hard_stops(date)
            self._mark_and_schedule_exits(date)
            self._schedule_entries(date, next_exists=not is_last)

            if is_last and close_cfg and self.portfolio.positions:
                closes = self._row_map(self.close_panel, date)
                for symbol in list(self.portfolio.positions):
                    position = self.portfolio.positions[symbol]
                    reference = closes.get(symbol, position.last_close)
                    fill = self.costs.fill_price("sell", reference)
                    charges = self.costs.charges("sell", fill, position.quantity)
                    impact = self.costs.impact_cost(fill, position.quantity)
                    self.portfolio.close_position(
                        symbol,
                        exit_date=date,
                        exit_price=fill,
                        exit_reason="end_of_backtest",
                        exit_charges=charges.total,
                        exit_impact=impact,
                    )

            closes = self._row_map(self.close_panel, date)
            self.portfolio.record_day(date, closes)

        equity = self.portfolio.equity_frame()
        equity = equity.set_index("date").sort_index()
        benchmark_close = self.benchmark["close"].reindex(equity.index).ffill()
        first_valid = benchmark_close.dropna()
        if len(first_valid):
            equity["benchmark_close"] = benchmark_close
            equity["benchmark_equity"] = (
                equity["benchmark_close"] / first_valid.iloc[0] * self.portfolio.initial_capital
            )
        equity["drawdown"] = equity["equity"] / equity["equity"].cummax() - 1.0
        equity["regime"] = (
            self.regime["long_enabled"].reindex(equity.index).fillna(False).astype(bool)
        )
        equity = equity.reset_index()

        trades = self.portfolio.trades_frame()
        metrics = compute_metrics(equity, trades, self.config)
        signal_log = pd.DataFrame(self.signal_log)
        rejections = pd.DataFrame(self.rejections)
        return BacktestResult(
            equity_curve=equity,
            trades=trades,
            metrics=metrics,
            signal_log=signal_log,
            rejections=rejections,
            config=self.config,
            initial_capital=self.portfolio.initial_capital,
            start=pd.Timestamp(equity["date"].iloc[0]),
            end=pd.Timestamp(equity["date"].iloc[-1]),
        )


def run_backtest(bundle: DataBundle, config: Mapping[str, Any]) -> BacktestResult:
    return Backtester(bundle, config).run()

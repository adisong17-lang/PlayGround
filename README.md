# Liquid Volatility-Adjusted Momentum Swing System

A research-only, event-driven daily backtester for a long-only Indian equity
momentum swing strategy. It uses Nifty 200/500-style universes, a Nifty 50
regime filter, volatility-adjusted momentum, sector relative strength, pullback
breakouts, ATR stops and portfolio risk limits.

**There is no live trading, broker integration, F&O, options, leverage or
automatic order execution anywhere in this project.** Backtests, especially on
synthetic data, are not evidence that a strategy will be profitable.

---

## Strategy rules

All percentage settings live in `config.yaml`. Defaults are shown in brackets.

### 1. Universe

* Daily OHLCV for Nifty 200/500 constituents (or any supplied universe).
* Exclude penny stocks (`min_price: 20`), illiquid names (`min_avg_volume:
  100000`, `min_avg_turnover: 10000000` over 20 sessions), names with too little
  history (`min_history: 260`) and circuit-prone names (too many >=9.5% moves).
* Optional historical membership snapshots reduce survivorship bias. Only the
  latest snapshot at or before the signal date is used.
* Providers: CSV, Parquet, SQLite and yfinance. A deterministic synthetic
  provider is included for examples and tests.

### 2. Market regime

Long entries are allowed only when **both** conditions hold on the benchmark:

```text
Nifty 50 close > 200-day SMA
Nifty 50 50-day SMA > 200-day SMA
```

Positions already open are still managed when the regime turns bearish; no new
entries are scheduled.

### 3. Momentum ranking

For each eligible stock at date `t`:

```text
six_month_return      = close[t] / close[t-126] - 1
twelve_month_return   = close[t] / close[t-252] - 1
six_month_volatility  = annualised daily volatility over 126 sessions
twelve_month_vol      = annualised daily volatility over 252 sessions

momentum_6m  = six_month_return / six_month_volatility
momentum_12m = twelve_month_return / twelve_month_volatility

final_score = 0.5 * cross_sectional_rank(momentum_6m)
            + 0.5 * cross_sectional_rank(momentum_12m)
```

Only the top 20% (`top_momentum_pct: 0.20`) by `final_score` are eligible.
Negative 6M/12M returns are excluded by default (`require_positive_momentum`).

### 4. Sector filter

* Build an equal-weight sector index from current point-in-time members.
* Rank sectors by 63-day return relative to Nifty 50.
* Keep only the top 30% of sectors.
* The sector index must be above its own 50-day SMA.
* At most two open positions per sector (`max_positions_per_sector: 2`).

### 5. Stock trend

All must be true:

```text
close > 20-day EMA
20-day EMA > 50-day EMA
50-day EMA > 200-day SMA
20-day EMA slope > 0
50-day EMA slope > 0
stock 63-day return > Nifty 50 63-day return
```

### 6. Entry

A pullback is a session in the recent `pullback_lookback` window (default 5)
where the close or low came within `1.0 × ATR(14)` of the 20-EMA or 50-EMA. This is
deliberately a short window rather than the breakout candle itself, because a
breakout candle is usually already extended.

Entry confirmation on the signal close:

```text
(close > previous day high) OR (close > highest high of previous 10 sessions)
AND volume >= 1.3 × prior 20-day average volume
AND close is in the upper 40% of the candle range
AND close > open
```

Orders execute at the **next trading day's open**. A next-day gap-up greater
than 3% is rejected. If the next session has no data, the order is cancelled.

### 7. Stop-loss

```text
initial stop = min(10-day swing low, entry price - 2 × ATR(14))
```

The stop is rejected if it is more than 8% below the actual entry price.
The initial stop is checked intraday. If the next open is already below it, the
exit fills at the gapped open (gap-through-stop), not at the stop price.

### 8. Position sizing

```text
risk_per_trade = 0.5% of current equity
quantity = floor((equity × 0.005) / (entry_price - stop_price))
```

Hard limits:

* Maximum five simultaneous positions.
* Maximum 20% of equity in one position.
* Maximum 3% aggregate open risk.
* No averaging down.
* No leverage: quantity is capped by available cash, including charges.

### 9. Exit

Close-based exit signals are evaluated after the close and execute at the next
open:

* Close below the prior 10-day lowest low.
* Close below the 20-EMA for two consecutive sessions.
* Close at or below the ATR trailing stop:
  `highest_close_since_entry - 2.5 × ATR(14)`.
* Maximum 30 holding sessions.

The initial hard stop is separate and is handled intraday, including realistic
gap-through fills. A trailing stop is intentionally treated as a close-based
signal followed by a next-open exit, matching the specification wording.

### 10. Costs

Configurable per side: brokerage (bps + flat), STT, exchange charges, SEBI
turnover fees, GST, stamp duty, slippage and bid-ask spread. Slippage and half
the spread are embedded in fills; statutory charges are cash debits. Reports
show explicit charges, estimated impact costs and total costs.

---

## Project structure

```text
src/
  __init__.py
  data_loader.py      CSV/Parquet/SQLite/yfinance/synthetic providers
  indicators.py       causal SMA/EMA/ATR/volatility/breakout/pullback helpers
  universe.py         point-in-time membership and eligibility filters
  momentum.py         volatility-adjusted momentum, ranking, sector strength
  regime.py           Nifty 50 regime filter
  strategy.py         trend, pullback, confirmation, candidates, exit rules
  portfolio.py        cash, positions, trades, daily equity accounting
  risk.py             stop placement, position sizing, risk caps
  costs.py            statutory costs, slippage and spread
  backtest.py         event-driven daily engine (next-open execution)
  scanner.py          latest-session scanner
  metrics.py          performance, risk, trade and attribution metrics
  reports.py          CSV, PNG and self-contained HTML reports
  synthetic.py        deterministic scenario generator
tests/                pytest suite
data/synthetic/       seven bundled synthetic datasets
results/              generated reports and scanner output
config.yaml
requirements.txt
run_backtest.py
run_scanner.py
run_report.py
```

---

## Installation

Python 3.11+ is required.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`pyarrow` is only needed for Parquet and `yfinance` only for the live download
provider. Core CSV/Parquet-free workflows need pandas, numpy, scipy, matplotlib,
seaborn, PyYAML and pytest.

---

## Data format

### CSV / Parquet directory (recommended)

One file per symbol, named `<SYMBOL>.csv` (or `.parquet`):

```text
date,open,high,low,close,volume
2020-01-01,100.0,101.5,99.5,101.0,250000
```

The benchmark file must be named after `data.benchmark_symbol`, e.g.
`NIFTY50.csv`. If an `adj_close` column is present, OHLC prices are scaled by
`adj_close / close` so splits and dividends do not create artificial gaps.
yfinance is downloaded with `auto_adjust=True`.

Optional metadata files in the same directory:

```text
sectors.csv             symbol,sector
universe_history.csv    date,symbol   # point-in-time membership snapshots
```

### Long CSV / Parquet / SQLite

A single table with `date, symbol, open, high, low, close, volume` works too.
For SQLite, set `data.provider: sqlite` and the table name via
`data.sqlite_table` (default `ohlcv`).

### yfinance

```yaml
data:
  provider: yfinance
  benchmark_symbol: NIFTY50
  yfinance_symbols: [RELIANCE.NS, TCS.NS, INFY.NS]
  start: 2018-01-01
  end: 2024-12-31
```

Network access and the optional `yfinance` package are required. The benchmark
ticker defaults to `^NSEI` and can be overridden with `data.yfinance_benchmark`.

### Historical membership and survivorship

`universe_history.csv` is a series of snapshots, not an event log. For each
date the backtest uses the most recent snapshot at or before that date. Before
the first snapshot there are no members, so no trades occur. This prevents
using today's constituents in the past, but only if the snapshot file itself is
historically accurate.

---

## Commands

```bash
# Run the default synthetic backtest and generate all reports
python run_backtest.py --config config.yaml

# Scan the latest session with a 200,000 capital base
python run_scanner.py --capital 200000 --config config.yaml

# Regenerate charts/HTML from an existing results directory
python run_report.py --input results/

# Run the test suite
python -m pytest
```

Useful overrides:

```bash
python run_backtest.py --config config.yaml --scenario false_breakout
python run_backtest.py --config config.yaml --provider csv --data-path data/synthetic/gap_down_stop
python run_scanner.py --capital 200000 --config config.yaml --as-of 2022-11-29
python run_scanner.py --capital 200000 --config config.yaml --scenario multiple_signals
```

Regenerate the bundled synthetic datasets:

```bash
python -m src.synthetic --output data/synthetic --sessions 760
```

Available scenarios: `clean_uptrend`, `sideways_market`, `false_breakout`,
`gap_down_stop`, `multiple_signals`, `losing_streak`, `sector_concentration`.

---

## Reports

`run_backtest.py` writes to `results/`:

* `trade_log.csv` — every closed trade with entry/exit, P&L, R multiple, costs
  and exit reason.
* `equity_curve.csv` — daily equity, cash, exposure, open risk, drawdown,
  benchmark equity and regime.
* `monthly_returns.csv` — calendar-month returns.
* `performance_report.html` — self-contained summary with embedded charts.
* `equity_curve.png` — strategy versus benchmark.
* `drawdown_curve.png` — underwater curve.
* `sector_performance.csv` — sector-wise trade attribution.
* `symbol_performance.csv`, `regime_performance.csv`, `metrics.json`.
* `scanner_YYYYMMDD.csv` — latest scanner output.
* `run_metadata.json` — data source and run summary.

The scanner CSV contains: symbol, sector, eligibility, rejection reason,
momentum score, 6M/12M returns and volatility, relative strength, trend status,
pullback status, volume ratio, entry reference, stop, stop distance, quantity,
position value, risk amount, regime and sector eligibility.

---

## Backtest assumptions

* Signals use only information available at the signal-day close.
* Execution is no earlier than the next trading day's open. There are no
  same-day signal-and-fill trades.
* Entry fills use the next open plus slippage and half-spread. Exits triggered
  by close-based rules also use the next open.
* Gap-ups above 3% are rejected. Gap-through initial stops fill at the gapped
  open, which is worse than the stop price.
* Missing sessions are treated as non-tradable. If a position's symbol has no
  bar, it is marked at its last known close and exit checks wait for data.
* Open positions are marked to market daily. Unless disabled, they are closed
  at the final close with costs.
* The portfolio is long-only cash equity, with no leverage, shorting, averaging
  down or derivatives.
* Positions are sized from equity at the execution open and are capped by cash.
* The sector index uses an equal-weight basket of the sector's members available
  on the signal date. Sector classification is treated as static unless you
  supply a historically accurate mapping.
* Adjusted prices are expected. Split/dividend handling is only as good as the
  vendor data (`adj_close` or yfinance auto-adjust).

### Look-ahead bias

The engine is deliberately structured to avoid it:

1. Indicators are rolling/backward-looking only.
2. Candidate generation happens after the signal-day close.
3. Orders are queued and filled on the following session.
4. Sector strength is rebuilt from prices up to the signal date.
5. Historical universe membership is read as-of the signal date.
6. Tests truncate and mutate future prices to prove that past equity and trades
   are unchanged.

Residual look-ahead can still enter through bad data: restated fundamentals,
survivor-only membership files, or a sector mapping created after the fact.

### Survivorship bias

Without `universe_history.csv`, the current symbol list is applied to the entire
history. Delisted or removed stocks are then missing, which flatters results.
The project supports point-in-time snapshots but cannot manufacture accurate
historical constituents for you.

### Overfitting

Every parameter in `config.yaml` is a researcher degree of freedom. The synthetic
scenarios are not independent evidence. In particular, the strategy has many
filters (regime, momentum, sector, trend, pullback, breakout, volume, candle
shape), so the effective number of trials is high. Use walk-forward tests,
out-of-sample periods, parameter stability checks and realistic costs before
drawing conclusions.

---

## Costs

Costs are applied on both sides. Defaults are illustrative Indian cash-equity
delivery assumptions:

```yaml
brokerage_bps: 3.0
brokerage_flat: 0.0
stt_buy_bps: 0.0
stt_sell_bps: 10.0
exchange_bps: 0.297
sebi_bps: 0.01
gst_pct: 0.18
stamp_duty_buy_bps: 1.5
slippage_bps: 5.0
spread_bps: 2.0
```

GST is charged on brokerage + exchange + SEBI. STT is sell-side only in the
default delivery model. Stamp duty is buy-side only. Slippage and half-spread
are included in the fill price and also reported as estimated impact costs.
Brokerage slabs, statutory rates and taxes can change; verify current rates
before using the model.

---

## Metrics

The report includes CAGR, total return, annual and monthly returns, maximum
drawdown and drawdown duration, Sharpe, Sortino, Calmar, win rate, average
winner/loser, payoff ratio, profit factor, expectancy in R, holding period,
maximum consecutive wins/losses, exposure, turnover, total costs, and
sector/symbol/regime attribution.

---

## Tests

The pytest suite covers indicators, ATR, momentum metrics, cross-sectional
ranking, regime, sector filtering, position sizing, portfolio risk limits,
next-day execution, gap-up rejection, gap-through stops, costs, exit rules,
holding-period limits, missing data, look-ahead prevention, data providers,
scanner output, metrics, reports and synthetic data validity.

```text
50 passed, 1 skipped
```

The skipped test is Parquet support when `pyarrow` is not installed.

---

## Limitations and why profitability is not guaranteed

* Daily bars cannot model intraday path, order-book depth or true stop slippage.
* The pullback window and close-based trailing-stop execution are explicit
  interpretations of the rules; other interpretations produce different results.
* Sector classification and historical membership are only as good as the data.
* Liquidity, impact and borrow/cash constraints are approximations.
* Regime and momentum filters can whipsaw, and long-only strategies suffer in
  prolonged bear markets.
* Parameter choices, transaction costs and taxes can erase an apparent edge.
* Synthetic scenarios are constructed to exercise code paths, not to represent
  real markets. The sample backtest is a software demonstration.

Nothing in this repository is investment advice. Do not deploy it with real
money without independent validation, paper trading, and a proper risk review.

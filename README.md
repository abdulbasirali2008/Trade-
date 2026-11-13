# Trade Academy

A paper-trading simulator for learning crypto and forex trading. Prices come from real markets, the money is virtual. Orders are filled the way a real broker would fill them, so the experience matches live trading without the risk.

> Educational use only. Nothing here is financial advice. Simulated fills are close to real trading but are not identical to it.

## Features

**Trading**
- Demo account with a virtual balance (1,000 to 100,000 USD) saved in your browser
- Crypto: BTC, ETH, SOL, BNB, XRP, DOGE, ADA against USDT, with a live order book
- Forex and gold: EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, USD/CHF, XAU/USD
- Market, limit and stop orders, plus stop-loss and take-profit
- Leverage up to 100x (crypto) or 200x (forex), margin level, margin-call warning and automatic stop-out
- Positions, pending orders, history and an activity log, with sound and notifications

**Realism**
- Buys fill at the ask and sells at the bid, with the real spread
- Market orders have a short execution delay and slippage; large crypto orders walk the order book
- Crypto taker and maker fees, 8-hour funding; forex overnight swap at 22:00 UTC (triple on Wednesday)
- Pending orders, stop-loss and take-profit trigger on live quotes
- Profit and loss is converted to USD for every pair, including USD/JPY and gold

**Tools**
- Candlestick chart with 1m to 1d timeframes, SMA, EMA, Bollinger Bands, volume, RSI and MACD
- Horizontal level drawing, click-to-pick prices for orders, lines for entry, stop, target and liquidation
- Backtester with five strategies, fees, slippage, stop-loss and take-profit, equity curve and drawdown
- Risk calculator: position size from risk percentage and stop distance, reward to risk, losing-streak table
- Trading journal: notes, setup and emotion tags, execution rating, performance by instrument and setup
- Ten lessons with quizzes, each with a short Bengali summary (সারকথা)

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine, indicator and backtest tests
npm run build    # production build in dist/
```

## Deploy to GitHub Pages

The repository includes `.github/workflows/deploy.yml`.

1. In the repository go to Settings > Pages and set Source to **GitHub Actions**.
2. Push to `main`. The workflow runs the tests, builds and publishes the site.

## Data sources

| Market | Source | Key needed |
| --- | --- | --- |
| Crypto prices, candles and order book | Binance public market data (WebSocket and REST) | No |
| Forex and gold reference rates | open.er-api.com | No |
| Live forex and gold ticks and history | Twelve Data | Optional, add it in Settings |

When a source is unreachable (offline, blocked network, no forex key) the app switches to a built-in price simulator with realistic volatility. The header shows whether each market is **Live** or **Simulated**, and the chart warns when its history is simulated.

Binance market data is not available from some countries and networks. If crypto shows Simulated, try a different network or a VPN-free connection.

## Project structure

```
src/
  lib/
    symbols.js     instruments, pip and lot maths, USD conversion
    feed.js        Binance and Twelve Data connections with simulated fallback
    sim.js         price simulator, candle builder, synthetic history and order book
    broker.js      paper broker: orders, margin, fees, funding, stop-out
    indicators.js  SMA, EMA, RSI, MACD, Bollinger, ATR
    backtest.js    strategy signals and backtest engine
  components/      chart, order ticket, order book, positions, watchlist, header
  views/           Trade, Learn, Backtest, Risk, Journal, Settings
  lessons.js       lesson content and quizzes
tests/             node:test unit tests for the engine, indicators and backtester
```

## Limits to know about

- Stop-loss, take-profit and pending orders only run while the page is open.
- Simulated fills cannot reproduce real liquidity, outages or exchange-specific rules.
- One position per instrument (netting). Hedged long and short positions on the same instrument are not supported.
- Account data lives in your browser's local storage. Clearing site data removes it.

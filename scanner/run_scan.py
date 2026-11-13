
import os
import time
import requests
import pandas as pd
from datetime import datetime, timezone

BASE = "https://fapi.binance.com"
WORKER = os.environ["WORKER_URL"].rstrip("/")
SECRET = os.environ["SCANNER_SECRET"]
BOT = os.environ["BOT_TOKEN"]
CHAT = os.environ["ALLOWED_CHAT_ID"]
MODE = os.getenv("SCAN_MODE", "all")
ONE = os.getenv("SCAN_SYMBOL", "").upper()

S = requests.Session()
S.headers.update({"User-Agent": "yusufFU-signal-scanner/1.0"})


def api(path, params=None):
    r = S.get(BASE + path, params=params, timeout=20)
    if r.status_code in (418, 429):
        raise RuntimeError(f"Binance rate limited request ({r.status_code}); stop scan")
    r.raise_for_status()
    return r.json()


def get_watchlist():
    r = requests.get(
        WORKER + "/internal/watchlist",
        headers={"X-Scanner-Secret": SECRET},
        timeout=20
    )
    r.raise_for_status()
    return r.json().get("symbols", [])


def get_symbols():
    info = api("/fapi/v1/exchangeInfo")
    valid = {
        x["symbol"] for x in info["symbols"]
        if x.get("contractType") == "PERPETUAL"
        and x.get("quoteAsset") == "USDT"
        and x.get("status") == "TRADING"
    }
    tickers = api("/fapi/v1/ticker/24hr")
    ranked = sorted(
        [x for x in tickers if x["symbol"] in valid],
        key=lambda x: float(x.get("quoteVolume", 0)),
        reverse=True
    )
    return [x["symbol"] for x in ranked[:80]]


def analyze(symbol):
    rows = api("/fapi/v1/klines", {
        "symbol": symbol, "interval": "15m", "limit": 120
    })
    df = pd.DataFrame(rows, columns=[
        "t", "o", "h", "l", "c", "v",
        "ct", "q", "n", "tb", "tq", "ig"
    ])

    for c in ("c", "h", "l", "v"):
        df[c] = pd.to_numeric(df[c])

    close = df.c
    ema20 = close.ewm(span=20, adjust=False).mean()
    ema50 = close.ewm(span=50, adjust=False).mean()

    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1/14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1/14, adjust=False).mean()
    rs = gain / loss.replace(0, 1e-12)
    rsi = 100 - 100 / (1 + rs)

    macd = (
        close.ewm(span=12, adjust=False).mean()
        - close.ewm(span=26, adjust=False).mean()
    )
    signal = macd.ewm(span=9, adjust=False).mean()
    vol_avg = df.v.rolling(20).mean()
    last = len(df) - 1

    score_long = 0
    score_short = 0

    score_long += 25 if ema20.iloc[last] > ema50.iloc[last] else 0
    score_short += 25 if ema20.iloc[last] < ema50.iloc[last] else 0

    score_long += 20 if close.iloc[last] > ema20.iloc[last] else 0
    score_short += 20 if close.iloc[last] < ema20.iloc[last] else 0

    score_long += 20 if macd.iloc[last] > signal.iloc[last] else 0
    score_short += 20 if macd.iloc[last] < signal.iloc[last] else 0

    score_long += 15 if 50 <= rsi.iloc[last] <= 68 else 0
    score_short += 15 if 32 <= rsi.iloc[last] <= 50 else 0

    score_long += 20 if df.v.iloc[last] > vol_avg.iloc[last] else 0
    score_short += 20 if df.v.iloc[last] > vol_avg.iloc[last] else 0

    direction, score = (
        ("LONG", score_long)
        if score_long >= score_short
        else ("SHORT", score_short)
    )

    return {
        "symbol": symbol,
        "direction": direction,
        "score": int(score),
        "price": float(close.iloc[last]),
        "rsi": round(float(rsi.iloc[last]), 1)
    }


def telegram(message):
    r = requests.post(
        f"https://api.telegram.org/bot{BOT}/sendMessage",
        json={
            "chat_id": CHAT,
            "text": message,
            "disable_web_page_preview": True
        },
        timeout=20
    )
    r.raise_for_status()


def main():
    if MODE == "single":
        symbols = [ONE]
    elif MODE == "watchlist":
        symbols = get_watchlist()
    else:
        symbols = get_symbols()

    results = []
    errors = []

    for symbol in symbols:
        try:
            results.append(analyze(symbol))
            time.sleep(0.12)
        except Exception as e:
            errors.append(f"{symbol}: {str(e)[:90]}")
            if "rate limited" in str(e).lower():
                break

    results.sort(key=lambda x: x["score"], reverse=True)

    response = requests.post(
        WORKER + "/internal/results",
        headers={"X-Scanner-Secret": SECRET},
        json={"results": results},
        timeout=20
    )
    response.raise_for_status()

    qualified = [x for x in results if x["score"] >= 65]

    title = (
        f"📊 نتائج الفحص ({MODE}) — "
        f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"
    )
    lines = [
        title,
        f"تم فحص: {len(results)} | إشارات ≥65: {len(qualified)}"
    ]

    for x in qualified[:12]:
        lines.append(
            f"{x['symbol']} | {x['direction']} | "
            f"{x['score']}/100 | السعر {x['price']} | RSI {x['rsi']}"
        )

    if not qualified:
        lines.append("لا توجد إشارات تجاوزت 65/100 حالياً.")

    if errors:
        lines.append(f"تعذر تحليل {len(errors)} عملة.")

    telegram("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
  

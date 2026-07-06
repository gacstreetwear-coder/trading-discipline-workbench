#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import mimetypes
import os
import re
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from html import unescape
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(os.environ.get("APP_STATIC_ROOT") or Path(__file__).resolve().parent).resolve()
PORT = int(os.environ.get("PORT", "5173"))
APP_VERSION = os.environ.get("APP_VERSION", "dev")
APP_USER_DATA = Path(os.environ["APP_USER_DATA"]).resolve() if os.environ.get("APP_USER_DATA") else None
EASTMONEY_QUOTE = "https://push2.eastmoney.com/api/qt/stock/get"
EASTMONEY_KLINE = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
SINA_KLINE = "https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketData.getKLineData"
SINA_QUOTE = "https://hq.sinajs.cn/list="
YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/"
FED_FOMC_CALENDAR = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
BEA_RELEASE_SCHEDULE = "https://www.bea.gov/news/schedule"
BLS_CURRENT_YEAR_SCHEDULE = "https://www.bls.gov/schedule/news_release/current_year.asp"
BLS_EMPLOYMENT_SITUATION = "https://www.bls.gov/schedule/news_release/empsit.htm"
BLS_CPI_SCHEDULE = "https://www.bls.gov/schedule/news_release/cpi.htm"
ADP_EMPLOYMENT_REPORT = "https://adpemploymentreport.com/"
NBS_RELEASE_SCHEDULE = "https://www.stats.gov.cn/sj/fbrc/bnxxfb/"
FISCALDATA_RELEASE_CALENDAR = "https://api.fiscaldata.treasury.gov/services/calendar/release"
FISCALDATA_RELEASE_PAGE = "https://fiscaldata.treasury.gov/release-calendar/"
TREASURY_TIC_RELEASE_DATES = "https://home.treasury.gov/data/treasury-international-capital-tic-system/release-dates-of-tic-data"
CACHE_TTL = 45
EVENT_CACHE_TTL = 60 * 60 * 6
EN_MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}
BLS_EMPLOYMENT_RELEASE_DATES = {
    2026: [
        "2026-01-09",
        "2026-02-13",
        "2026-03-06",
        "2026-04-03",
        "2026-05-08",
        "2026-06-05",
        "2026-07-02",
        "2026-08-07",
        "2026-09-04",
        "2026-10-02",
        "2026-11-06",
        "2026-12-04",
    ],
}
BLS_CPI_RELEASE_DATES = {
    2026: [
        "2026-01-13",
        "2026-02-13",
        "2026-03-11",
        "2026-04-10",
        "2026-05-12",
        "2026-06-10",
        "2026-07-14",
        "2026-08-12",
        "2026-09-11",
        "2026-10-14",
        "2026-11-10",
        "2026-12-10",
    ],
}
TIC_MONTHLY_RELEASE_DATES = {
    2026: [
        "2026-01-15",
        "2026-02-18",
        "2026-03-18",
        "2026-04-15",
        "2026-05-18",
        "2026-06-18",
        "2026-07-14",
        "2026-08-17",
        "2026-09-16",
        "2026-10-16",
        "2026-11-18",
        "2026-12-15",
    ],
}
FISCALDATA_PRIORITY_DATASETS = {
    "015-BFS-2014Q1-13": {
        "title": "美国财政部月度财政收支",
        "impact": "高",
        "note": "Monthly Treasury Statement，观察财政收入、支出与赤字，对美债供给和美元流动性有参考意义。",
    },
    "015-BFS-2014Q3-056": {
        "title": "美国国债平均利率",
        "impact": "中",
        "note": "Average Interest Rates on U.S. Treasury Securities，观察美国财政融资成本和利率环境。",
    },
}

_cache: dict[str, tuple[float, object]] = {}


def tail_file(path: Path | None, max_chars: int = 6000) -> str:
    if not path or not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8", errors="ignore")[-max_chars:]
    except OSError:
        return ""


def cache_get(key: str, ttl: int = CACHE_TTL):
    item = _cache.get(key)
    if not item:
        return None
    created_at, payload = item
    if time.time() - created_at > ttl:
        _cache.pop(key, None)
        return None
    return payload


def cache_set(key: str, payload):
    _cache[key] = (time.time(), payload)
    return payload


def api_get(url: str, params: dict[str, str]):
    query = urllib.parse.urlencode(params)
    last_error: Exception | None = None
    for _ in range(3):
        req = urllib.request.Request(
            f"{url}?{query}",
            headers={
                "Accept": "application/json,text/plain,*/*",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Connection": "close",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36",
                "Referer": "https://quote.eastmoney.com/",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, ConnectionError, TimeoutError) as exc:
            last_error = exc
            time.sleep(0.35)
    raise RuntimeError(f"行情服务暂时不可用：{last_error}")


def fetch_html(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Connection": "close",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", "ignore")


def fetch_json(url: str):
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json,text/plain,*/*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Connection": "close",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36",
        },
    )
    with urllib.request.urlopen(req, timeout=18) as resp:
        return json.loads(resp.read().decode("utf-8", "ignore"))


def html_text(fragment: str) -> str:
    cleaned = re.sub(r"<script.*?</script>|<style.*?</style>", " ", fragment, flags=re.S | re.I)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    return re.sub(r"\s+", " ", unescape(cleaned)).strip()


def iso_date(year: int, month: int, day: int) -> str | None:
    try:
        return datetime(year, month, day).date().isoformat()
    except ValueError:
        return None


def iso_add_days(value: str, days: int) -> str | None:
    try:
        base = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None
    return datetime.fromordinal(base.toordinal() + days).date().isoformat()


def first_weekday(year: int, month: int, weekday: int) -> str | None:
    try:
        date = datetime(year, month, 1).date()
    except ValueError:
        return None
    offset = (weekday - date.weekday()) % 7
    return datetime.fromordinal(date.toordinal() + offset).date().isoformat()


def nth_weekday_date(year: int, month: int, weekday: int, nth: int):
    try:
        date = datetime(year, month, 1).date()
    except ValueError:
        return None
    offset = (weekday - date.weekday()) % 7
    return datetime.fromordinal(date.toordinal() + offset + 7 * (nth - 1)).date()


def tenth_business_day(year: int, month: int) -> str | None:
    try:
        date = datetime(year, month, 1).date()
    except ValueError:
        return None
    count = 0
    while date.month == month:
        if date.weekday() < 5:
            count += 1
            if count == 10:
                return date.isoformat()
        date = datetime.fromordinal(date.toordinal() + 1).date()
    return None


def generic_employment_release_dates(year: int) -> list[str]:
    dates = []
    for month in range(1, 13):
        release = first_weekday(year, month, 4)
        if not release:
            continue
        # January is often the second Friday because the first Friday can be too close to New Year.
        if month == 1 and safe_int(release[-2:]) <= 3:
            release = iso_add_days(release, 7)
        if release:
            dates.append(release)
    return dates


def employment_release_dates(year: int) -> list[str]:
    return BLS_EMPLOYMENT_RELEASE_DATES.get(year) or generic_employment_release_dates(year)


def cpi_release_dates(year: int) -> list[str]:
    if year in BLS_CPI_RELEASE_DATES:
        return BLS_CPI_RELEASE_DATES[year]
    return [date for month in range(1, 13) if (date := tenth_business_day(year, month))]


def tic_monthly_release_dates(year: int) -> list[str]:
    if year in TIC_MONTHLY_RELEASE_DATES:
        return TIC_MONTHLY_RELEASE_DATES[year]
    dates: list[str] = []
    for month in range(1, 13):
        release = nth_weekday_date(year, month, 2, 3)
        if release:
            dates.append(release.isoformat())
    return dates


def year_month_cn(year: int, month: int) -> str:
    return f"{year}年{month}月"


def add_months(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def period_for_monthly_release(release_date: str) -> str:
    year, month, _ = map(int, release_date.split("-"))
    month -= 1
    if month == 0:
        year -= 1
        month = 12
    return f"{year}年{month}月"


def period_months_before(release_date: str, months_back: int) -> str:
    year, month, _ = map(int, release_date.split("-"))
    period_year, period_month = add_months(year, month, -months_back)
    return year_month_cn(period_year, period_month)


def english_period_to_cn(value: str, fallback_date: str) -> str:
    text = html_text(value)
    match = re.search(
        r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+((?:19|20)\d{2})",
        text,
        flags=re.I,
    )
    if match:
        return year_month_cn(safe_int(match.group(2)), EN_MONTHS[match.group(1).lower()])
    return period_for_monthly_release(fallback_date)


def parse_clock(value: str) -> tuple[int, int] | None:
    text = StringValue(value).lower()
    match = re.search(r"(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?", text)
    if match:
        hour = safe_int(match.group(1))
        minute = safe_int(match.group(2))
        if match.group(3) == "p" and hour != 12:
            hour += 12
        if match.group(3) == "a" and hour == 12:
            hour = 0
        return hour, minute
    match = re.search(r"\b(\d{1,2}):(\d{2})\b", text)
    if match:
        return safe_int(match.group(1)), safe_int(match.group(2))
    return None


def StringValue(value) -> str:
    return str(value or "").strip()


def is_us_dst(date_iso: str) -> bool:
    year, month, day = map(int, date_iso.split("-"))
    current = datetime(year, month, day).date()
    start = nth_weekday_date(year, 3, 6, 2)
    end = nth_weekday_date(year, 11, 6, 1)
    return bool(start and end and start <= current < end)


def eastern_to_beijing_label(date_iso: str, time_text: str) -> str:
    parsed = parse_clock(time_text)
    if not parsed:
        return ""
    hour, minute = parsed
    offset = 12 if is_us_dst(date_iso) else 13
    base = datetime.strptime(date_iso, "%Y-%m-%d")
    beijing = base + timedelta(hours=hour + offset, minutes=minute)
    if beijing.date().isoformat() == date_iso:
        return f"北京时间 {beijing.hour:02d}:{beijing.minute:02d}"
    return f"北京时间 {beijing.month}月{beijing.day}日 {beijing.hour:02d}:{beijing.minute:02d}"


def utc_to_beijing_label(date_iso: str, time_text: str) -> str:
    parsed = parse_clock(time_text)
    if not parsed:
        return ""
    hour, minute = parsed
    base = datetime.strptime(date_iso, "%Y-%m-%d")
    beijing = base + timedelta(hours=hour + 8, minutes=minute)
    if beijing.date().isoformat() == date_iso:
        return f"北京时间 {beijing.hour:02d}:{beijing.minute:02d}"
    return f"北京时间 {beijing.month}月{beijing.day}日 {beijing.hour:02d}:{beijing.minute:02d}"


def slugify(value: str) -> str:
    slug = re.sub(r"[^\w\u4e00-\u9fff]+", "-", value, flags=re.U).strip("-").lower()
    return slug[:90] or "event"


def event_payload(date: str, category: str, market: str, title: str, impact: str, note: str, source: str, url: str) -> dict:
    return {
        "id": f"online-{source}-{date}-{slugify(title)}",
        "sourceId": f"{source}:{date}:{slugify(title)}",
        "source": source,
        "sourceUrl": url,
        "date": date,
        "category": category,
        "market": market,
        "title": title,
        "impact": impact,
        "note": note,
    }


def normalize_symbol(symbol: str) -> str:
    raw = str(symbol or "").strip().lower()
    cleaned = re.sub(r"[^0-9]", "", raw)
    if len(cleaned) != 6:
        raise ValueError("A股行情同步需要 6 位数字代码，例如 600519、000001、300750")
    return cleaned


def secid(symbol: str) -> str:
    code = normalize_symbol(symbol)
    if code.startswith(("6", "5", "9")):
        return f"1.{code}"
    return f"0.{code}"


def sina_symbol(symbol: str) -> str:
    code = normalize_symbol(symbol)
    prefix = "sh" if code.startswith(("6", "5", "9")) else "sz"
    return f"{prefix}{code}"


def yahoo_symbol(symbol: str) -> str:
    code = normalize_symbol(symbol)
    suffix = "SS" if code.startswith(("6", "5", "9")) else "SZ"
    return f"{code}.{suffix}"


def safe_float(value, default=0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(number) or math.isinf(number):
        return default
    return number


def safe_int(value, default=0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def moving_average(values: list[float], window: int) -> list[float | None]:
    result: list[float | None] = []
    rolling = 0.0
    for index, value in enumerate(values):
        rolling += value
        if index >= window:
            rolling -= values[index - window]
        if index >= window - 1:
            result.append(round(rolling / window, 3))
        else:
            result.append(None)
    return result


def ema(values: list[float], span: int) -> list[float]:
    if not values:
        return []
    alpha = 2 / (span + 1)
    result = [values[0]]
    for value in values[1:]:
        result.append(alpha * value + (1 - alpha) * result[-1])
    return result


def add_indicators(candles: list[dict]) -> list[dict]:
    closes = [safe_float(item["close"]) for item in candles]
    highs = [safe_float(item["high"]) for item in candles]
    lows = [safe_float(item["low"]) for item in candles]

    ma5 = moving_average(closes, 5)
    ma10 = moving_average(closes, 10)
    ma20 = moving_average(closes, 20)
    ma60 = moving_average(closes, 60)
    ema12 = ema(closes, 12)
    ema26 = ema(closes, 26)
    dif = [a - b for a, b in zip(ema12, ema26)]
    dea = ema(dif, 9)
    macd = [(d - e) * 2 for d, e in zip(dif, dea)]

    k_values: list[float] = []
    d_values: list[float] = []
    k = 50.0
    d = 50.0
    for index, close in enumerate(closes):
        start = max(0, index - 8)
        highest = max(highs[start : index + 1])
        lowest = min(lows[start : index + 1])
        rsv = 50.0 if highest == lowest else (close - lowest) / (highest - lowest) * 100
        k = (2 / 3) * k + (1 / 3) * rsv
        d = (2 / 3) * d + (1 / 3) * k
        k_values.append(k)
        d_values.append(d)

    for index, item in enumerate(candles):
        item["ma5"] = ma5[index]
        item["ma10"] = ma10[index]
        item["ma20"] = ma20[index]
        item["ma60"] = ma60[index]
        item["dif"] = round(dif[index], 3)
        item["dea"] = round(dea[index], 3)
        item["macd"] = round(macd[index], 3)
        item["k"] = round(k_values[index], 2)
        item["d"] = round(d_values[index], 2)
        item["j"] = round(3 * k_values[index] - 2 * d_values[index], 2)

    return candles


def technical_summary(candles: list[dict]) -> dict:
    if len(candles) < 2:
        return {}
    latest = candles[-1]
    prev = candles[-2]
    close = safe_float(latest["close"])
    volume = safe_float(latest["volume"])
    ma20 = safe_float(latest.get("ma20"))
    ma60 = safe_float(latest.get("ma60"))
    macd = safe_float(latest.get("macd"))
    prev_macd = safe_float(prev.get("macd"))
    k = safe_float(latest.get("k"))
    d = safe_float(latest.get("d"))
    prev_k = safe_float(prev.get("k"))
    prev_d = safe_float(prev.get("d"))
    recent_volumes = [safe_float(item["volume"]) for item in candles[-21:-1]]
    avg_volume = sum(recent_volumes) / len(recent_volumes) if recent_volumes else volume

    if ma20 and ma60 and close > ma20 > ma60:
        trend = "多头趋势"
    elif ma20 and close < ma20:
        trend = "跌破20日线"
    else:
        trend = "震荡观察"

    if macd > 0 and macd > prev_macd:
        macd_state = "MACD红柱放大"
    elif macd < 0 and macd < prev_macd:
        macd_state = "MACD绿柱放大"
    else:
        macd_state = "MACD动能收敛"

    if prev_k <= prev_d and k > d:
        kdj_state = "KDJ金叉"
    elif prev_k >= prev_d and k < d:
        kdj_state = "KDJ死叉"
    elif k > 80:
        kdj_state = "KDJ高位"
    elif k < 20:
        kdj_state = "KDJ低位"
    else:
        kdj_state = "KDJ中性"

    if avg_volume and volume > avg_volume * 1.5:
        volume_state = "明显放量"
    elif avg_volume and volume < avg_volume * 0.7:
        volume_state = "缩量"
    else:
        volume_state = "量能正常"

    return {
        "trend": trend,
        "macd": macd_state,
        "kdj": kdj_state,
        "volume": volume_state,
        "closeVsMa20Pct": round(((close - ma20) / ma20) * 100, 2) if ma20 else 0,
    }


def get_quote(symbol: str) -> dict:
    code = normalize_symbol(symbol)
    cache_key = f"quote:{code}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    try:
        result = get_eastmoney_quote(code)
    except Exception:
        result = get_sina_quote(code)
    return cache_set(cache_key, result)


def get_eastmoney_quote(code: str) -> dict:
    payload = api_get(
        EASTMONEY_QUOTE,
        {
            "secid": secid(code),
            "fields": "f43,f44,f45,f46,f47,f48,f57,f58,f59,f60,f86,f169,f170",
        },
    )
    data = payload.get("data") or {}
    if not data:
        raise ValueError(f"未获取到 {code} 的行情")

    price_scale = 100
    latest = safe_float(data.get("f43")) / price_scale
    return {
        "symbol": code,
        "name": data.get("f58") or code,
        "currentPrice": round(latest, 3),
        "preClose": round(safe_float(data.get("f60")) / price_scale, 3),
        "open": round(safe_float(data.get("f46")) / price_scale, 3),
        "high": round(safe_float(data.get("f44")) / price_scale, 3),
        "low": round(safe_float(data.get("f45")) / price_scale, 3),
        "change": round(safe_float(data.get("f169")) / price_scale, 3),
        "changePct": round(safe_float(data.get("f170")) / 100, 3),
        "volume": safe_int(data.get("f47")),
        "amount": safe_float(data.get("f48")),
        "time": datetime.fromtimestamp(safe_int(data.get("f86"), int(time.time()))).isoformat(timespec="seconds"),
        "source": "eastmoney",
    }


def get_sina_quote(code: str) -> dict:
    req = urllib.request.Request(
        f"{SINA_QUOTE}{sina_symbol(code)}",
        headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://finance.sina.com.cn/",
        },
    )
    with urllib.request.urlopen(req, timeout=12) as resp:
        body = resp.read().decode("gbk", "ignore")
    match = re.search(r'="(.*)"', body)
    if not match:
        raise ValueError(f"未获取到 {code} 的新浪行情")
    fields = match.group(1).split(",")
    if len(fields) < 32 or not fields[0]:
        raise ValueError(f"未获取到 {code} 的新浪行情")

    name = fields[0]
    open_ = safe_float(fields[1])
    pre_close = safe_float(fields[2])
    current = safe_float(fields[3]) or pre_close
    high = safe_float(fields[4])
    low = safe_float(fields[5])
    volume = safe_int(fields[8])
    amount = safe_float(fields[9])
    change = current - pre_close
    quote_time = f"{fields[30]}T{fields[31]}" if len(fields) > 31 else datetime.now().isoformat(timespec="seconds")
    return {
        "symbol": code,
        "name": name,
        "currentPrice": round(current, 3),
        "preClose": round(pre_close, 3),
        "open": round(open_, 3),
        "high": round(high, 3),
        "low": round(low, 3),
        "change": round(change, 3),
        "changePct": round((change / pre_close) * 100, 3) if pre_close else 0,
        "volume": volume,
        "amount": amount,
        "time": quote_time,
        "source": "sina",
    }


def get_candles(symbol: str, days: int = 180) -> dict:
    code = normalize_symbol(symbol)
    days = max(30, min(int(days or 180), 10000))
    cache_key = f"candles:{code}:{days}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    try:
        result = get_eastmoney_candles(code, days)
    except Exception:
        try:
            result = get_yahoo_candles(code, days)
        except Exception:
            result = get_sina_candles(code, min(days, 1000))

    return cache_set(cache_key, result)


def get_eastmoney_candles(code: str, days: int) -> dict:
    payload = api_get(
        EASTMONEY_KLINE,
        {
            "secid": secid(code),
            "fields1": "f1,f2,f3,f4,f5,f6",
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
            "klt": "101",
            "fqt": "1",
            "beg": "19900101",
            "end": "20500101",
            "lmt": str(days),
        },
    )
    data = payload.get("data") or {}
    klines = data.get("klines") or []
    candles: list[dict] = []
    for line in klines:
        fields = line.split(",")
        if len(fields) < 11:
            continue
        candles.append(
            {
                "date": fields[0],
                "open": safe_float(fields[1]),
                "close": safe_float(fields[2]),
                "high": safe_float(fields[3]),
                "low": safe_float(fields[4]),
                "volume": safe_int(fields[5]),
                "amount": safe_float(fields[6]),
                "amplitude": safe_float(fields[7]),
                "changePct": safe_float(fields[8]),
                "change": safe_float(fields[9]),
                "turnover": safe_float(fields[10]),
            }
        )
    if not candles:
        raise ValueError(f"未获取到 {code} 的东方财富K线")

    result = {
        "symbol": code,
        "name": data.get("name") or code,
        "candles": add_indicators(candles),
        "source": "eastmoney",
    }
    result["summary"] = technical_summary(result["candles"])
    return result


def get_sina_candles(code: str, days: int) -> dict:
    payload = api_get(
        SINA_KLINE,
        {
            "symbol": sina_symbol(code),
            "scale": "240",
            "ma": "no",
            "datalen": str(days),
        },
    )
    if not isinstance(payload, list):
        payload = (((payload or {}).get("result") or {}).get("data") or [])

    candles: list[dict] = []
    previous_close = None
    for item in payload:
        close = safe_float(item.get("close"))
        open_ = safe_float(item.get("open"))
        high = safe_float(item.get("high"))
        low = safe_float(item.get("low"))
        change = 0.0 if previous_close is None else close - previous_close
        change_pct = 0.0 if not previous_close else (change / previous_close) * 100
        amplitude = 0.0 if not previous_close else ((high - low) / previous_close) * 100
        candles.append(
            {
                "date": item.get("day"),
                "open": open_,
                "close": close,
                "high": high,
                "low": low,
                "volume": safe_int(item.get("volume")),
                "amount": 0,
                "amplitude": round(amplitude, 3),
                "changePct": round(change_pct, 3),
                "change": round(change, 3),
                "turnover": 0,
            }
        )
        previous_close = close
    if not candles:
        raise ValueError(f"未获取到 {code} 的新浪K线")

    result = {
        "symbol": code,
        "name": code,
        "candles": add_indicators(candles),
        "source": "sina",
    }
    result["summary"] = technical_summary(result["candles"])
    return result


def get_yahoo_candles(code: str, days: int) -> dict:
    period2 = int(time.time()) + 86400 * 3
    params = urllib.parse.urlencode(
        {
            "period1": "0",
            "period2": str(period2),
            "interval": "1d",
            "events": "history",
            "includeAdjustedClose": "true",
        }
    )
    req = urllib.request.Request(
        f"{YAHOO_CHART}{urllib.parse.quote(yahoo_symbol(code))}?{params}",
        headers={
            "Accept": "application/json,text/plain,*/*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Connection": "close",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36",
            "Referer": "https://finance.yahoo.com/",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        payload = json.loads(resp.read().decode("utf-8", "ignore"))

    result = ((payload.get("chart") or {}).get("result") or [None])[0]
    if not result:
        raise ValueError(f"未获取到 {code} 的 Yahoo 历史行情")
    quote = ((result.get("indicators") or {}).get("quote") or [None])[0] or {}
    timestamps = result.get("timestamp") or []
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []
    candles: list[dict] = []
    for index, ts in enumerate(timestamps):
        if index >= len(closes):
            continue
        open_ = safe_float(opens[index] if index < len(opens) else None, None)
        high = safe_float(highs[index] if index < len(highs) else None, None)
        low = safe_float(lows[index] if index < len(lows) else None, None)
        close = safe_float(closes[index] if index < len(closes) else None, None)
        if open_ is None or high is None or low is None or close is None:
            continue
        prev_close = candles[-1]["close"] if candles else open_
        volume = safe_int(volumes[index] if index < len(volumes) else 0)
        amount = volume * close
        candles.append(
            {
                "date": datetime.fromtimestamp(safe_int(ts)).date().isoformat(),
                "open": round(open_, 3),
                "close": round(close, 3),
                "high": round(high, 3),
                "low": round(low, 3),
                "volume": volume,
                "amount": round(amount, 2),
                "amplitude": round(((high - low) / prev_close) * 100, 3) if prev_close else 0,
                "changePct": round(((close - prev_close) / prev_close) * 100, 3) if prev_close else 0,
                "change": round(close - prev_close, 3),
                "turnover": 0,
            }
        )

    candles = candles[-days:]
    if not candles:
        raise ValueError(f"未获取到 {code} 的 Yahoo 历史行情")
    meta = result.get("meta") or {}
    output = {
        "symbol": code,
        "name": meta.get("shortName") or meta.get("symbol") or code,
        "candles": add_indicators(candles),
        "source": "yahoo",
    }
    output["summary"] = technical_summary(output["candles"])
    return output


def scan_positions(positions: list[dict]) -> dict:
    results = []
    errors = []
    warnings = []
    for item in positions:
        symbol = item.get("symbol")
        try:
            quote = get_quote(symbol)
        except Exception as exc:  # noqa: BLE001
            errors.append({"symbol": symbol, "message": str(exc)})
            continue

        candles = {"candles": [], "summary": {}}
        try:
            candles = get_candles(symbol, 180)
        except Exception as exc:  # noqa: BLE001
            warnings.append({"symbol": symbol, "message": f"K线未同步：{exc}"})

        latest = candles["candles"][-1] if candles.get("candles") else {}
        results.append(
            {
                "id": item.get("id"),
                "symbol": quote["symbol"],
                "name": quote["name"],
                "currentPrice": quote["currentPrice"],
                "quote": quote,
                "summary": candles.get("summary", {}),
                "latestIndicator": {
                    "date": latest.get("date"),
                    "ma5": latest.get("ma5"),
                    "ma10": latest.get("ma10"),
                    "ma20": latest.get("ma20"),
                    "ma60": latest.get("ma60"),
                    "macd": latest.get("macd"),
                    "dif": latest.get("dif"),
                    "dea": latest.get("dea"),
                    "k": latest.get("k"),
                    "d": latest.get("d"),
                    "j": latest.get("j"),
                },
            }
        )

    return {
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
        "results": results,
        "errors": errors,
        "warnings": warnings,
    }


def fetch_fomc_events() -> list[dict]:
    html = fetch_html(FED_FOMC_CALENDAR)
    current_year = datetime.now().year
    events: list[dict] = []
    sections = re.findall(
        r"(\d{4}) FOMC Meetings</a></h4></div>(.*?)(?=<div class=\"panel panel-default\"><div class=\"panel-heading\"><h4><a id=|$)",
        html,
        flags=re.S,
    )
    for year_text, section in sections:
        year = safe_int(year_text)
        if year < current_year:
            continue
        rows = re.findall(
            r"fomc-meeting__month[^>]*>\s*<strong>([^<]+)</strong>.*?fomc-meeting__date[^>]*>([^<]+)</div>",
            section,
            flags=re.S,
        )
        for month_text, day_text in rows:
            month = EN_MONTHS.get(month_text.strip().lower())
            day_numbers = re.findall(r"\d{1,2}", day_text)
            if not month or not day_numbers:
                continue
            date = iso_date(year, month, safe_int(day_numbers[-1]))
            if not date:
                continue
            projection = "*" in day_text
            title = "美联储FOMC利率决议"
            if projection:
                title += "（含经济预测）"
            note = f"官方会议日程；会议日期 {month_text.strip()} {day_text.strip()}。"
            events.append(
                event_payload(
                    date,
                    "重大会议",
                    "美国",
                    title,
                    "高",
                    note,
                    "fed",
                    FED_FOMC_CALENDAR,
                )
            )
    return events


def fetch_bea_events() -> list[dict]:
    html = fetch_html(BEA_RELEASE_SCHEDULE)
    text = html_text(html)
    year_match = re.search(r"Year\s+(\d{4})", text)
    year = safe_int(year_match.group(1), datetime.now().year) if year_match else datetime.now().year
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, flags=re.S | re.I)
    events: list[dict] = []
    for row in rows:
        date_match = re.search(r'<div class="release-date">([^<]+)</div>', row, flags=re.S | re.I)
        title_match = re.search(r'class="release-title[^"]*"[^>]*>(.*?)</td>', row, flags=re.S | re.I)
        if not date_match or not title_match:
            continue
        date_text = html_text(date_match.group(1))
        title = html_text(title_match.group(1))
        parts = date_text.split()
        if len(parts) < 2:
            continue
        month = EN_MONTHS.get(parts[0].lower())
        day = safe_int(re.sub(r"\D", "", parts[1]))
        date = iso_date(year, month or 0, day)
        if not date or not title:
            continue
        time_match = re.search(r"<small[^>]*>([^<]+)</small>", row, flags=re.S | re.I)
        release_time = html_text(time_match.group(1)) if time_match else ""
        beijing_time = eastern_to_beijing_label(date, release_time)
        lowered = title.lower()
        high_keywords = ("gdp", "personal income", "outlays", "pce", "profits")
        impact = "高" if any(keyword in lowered for keyword in high_keywords) else "中"
        events.append(
            event_payload(
                date,
                "宏观经济数据",
                "美国",
                f"美国BEA：{title}",
                impact,
                f"官方发布日程{f' · {release_time}' if release_time else ''}{f'（{beijing_time}）' if beijing_time else ''}",
                "bea",
                BEA_RELEASE_SCHEDULE,
            )
        )
        if "personal income and outlays" in lowered:
            period = english_period_to_cn(title.split(",", 1)[1].strip() if "," in title else "", date)
            events.append(
                event_payload(
                    date,
                    "宏观经济数据",
                    "美国",
                    f"美国核心PCE与PCE物价指数：{period}",
                    "高",
                    f"BEA Personal Income and Outlays 同时发布PCE、核心PCE、个人收入和个人支出{f' · {release_time}' if release_time else ''}{f'（{beijing_time}）' if beijing_time else ''}",
                    "bea-pce",
                    BEA_RELEASE_SCHEDULE,
                )
            )
    return events


def fetch_bls_employment_events() -> list[dict]:
    current_year = datetime.now().year
    events: list[dict] = []
    for year in range(current_year, current_year + 2):
        for release_date in employment_release_dates(year):
            period = period_for_monthly_release(release_date)
            beijing_time = eastern_to_beijing_label(release_date, "8:30 AM")
            events.append(
                event_payload(
                    release_date,
                    "宏观经济数据",
                    "美国",
                    f"美国非农就业报告：{period}",
                    "高",
                    f"美国劳工统计局 Employment Situation，含非农就业人数、失业率、平均时薪；官方发布时间通常为 8:30 AM ET（{beijing_time}）。",
                    "bls",
                    BLS_EMPLOYMENT_SITUATION,
                )
            )
    return events


def fetch_bls_cpi_events() -> list[dict]:
    current_year = datetime.now().year
    events: list[dict] = []
    for year in range(current_year, current_year + 2):
        for release_date in cpi_release_dates(year):
            period = period_for_monthly_release(release_date)
            beijing_time = eastern_to_beijing_label(release_date, "8:30 AM")
            events.append(
                event_payload(
                    release_date,
                    "宏观经济数据",
                    "美国",
                    f"美国CPI与核心CPI：{period}",
                    "高",
                    f"美国劳工统计局 Consumer Price Index，同时关注总体CPI与核心CPI；官方发布时间通常为 8:30 AM ET（{beijing_time}）。",
                    "bls-cpi",
                    BLS_CPI_SCHEDULE,
                )
            )
    return events


def fetch_adp_employment_events() -> list[dict]:
    current_year = datetime.now().year
    events: list[dict] = []
    for year in range(current_year, current_year + 2):
        for bls_date in employment_release_dates(year):
            try:
                bls_day = datetime.strptime(bls_date, "%Y-%m-%d").date()
            except ValueError:
                continue
            # ADP National Employment Report normally lands shortly before the BLS Employment Situation.
            days_since_wednesday = (bls_day.weekday() - 2) % 7
            if days_since_wednesday == 0:
                days_since_wednesday = 7
            adp_date = datetime.fromordinal(bls_day.toordinal() - days_since_wednesday).date().isoformat()
            period = period_for_monthly_release(bls_date)
            beijing_time = eastern_to_beijing_label(adp_date, "8:15 AM")
            events.append(
                event_payload(
                    adp_date,
                    "宏观经济数据",
                    "美国",
                    f"美国ADP小非农就业报告：{period}",
                    "高",
                    f"ADP National Employment Report，通常在非农前发布；用于观察美国私营部门就业，发布时间通常为 8:15 AM ET（{beijing_time}），最终以ADP官网为准。",
                    "adp",
                    ADP_EMPLOYMENT_REPORT,
                )
            )
    return events


def fetch_fiscaldata_events() -> list[dict]:
    current_year = datetime.now().year
    payload = fetch_json(FISCALDATA_RELEASE_CALENDAR)
    if not isinstance(payload, list):
        return []
    events: list[dict] = []
    seen: set[str] = set()
    for item in payload:
        dataset_id = StringValue(item.get("datasetId"))
        meta = FISCALDATA_PRIORITY_DATASETS.get(dataset_id)
        date = StringValue(item.get("date"))
        if not meta or not re.match(r"^20\d{2}-\d{2}-\d{2}$", date):
            continue
        year = safe_int(date[:4])
        if year < current_year or year > current_year + 1:
            continue
        key = f"{dataset_id}:{date}"
        if key in seen:
            continue
        seen.add(key)
        time_text = StringValue(item.get("time"))
        beijing_time = utc_to_beijing_label(date, time_text)
        events.append(
            event_payload(
                date,
                "宏观经济数据",
                "美国",
                meta["title"],
                meta["impact"],
                f"{meta['note']}{f' 官方日历时间 {time_text} UTC' if time_text else ''}{f'（{beijing_time}）' if beijing_time else ''}。",
                "fiscaldata",
                FISCALDATA_RELEASE_PAGE,
            )
        )
    return events


def fetch_tic_events() -> list[dict]:
    current_year = datetime.now().year
    events: list[dict] = []
    for year in range(current_year, current_year + 2):
        for release_date in tic_monthly_release_dates(year):
            period = period_months_before(release_date, 2)
            beijing_time = eastern_to_beijing_label(release_date, "4:00 PM")
            events.append(
                event_payload(
                    release_date,
                    "宏观经济数据",
                    "美国",
                    f"美国财政部TIC资本流动数据：{period}",
                    "高",
                    f"美国财政部 TIC 月度数据，关注外资持有美债、跨境证券交易和资本流动；通常 4:00 PM ET 发布（{beijing_time}）。",
                    "treasury-tic",
                    TREASURY_TIC_RELEASE_DATES,
                )
            )
    return events


def fetch_nbs_events() -> list[dict]:
    html = fetch_html(NBS_RELEASE_SCHEDULE)
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, flags=re.S | re.I)
    year = datetime.now().year
    events: list[dict] = []
    high_keywords = ("国民经济", "居民消费价格", "工业生产者价格", "采购经理", "固定资产投资", "规模以上工业", "社会消费品", "房地产")
    for row in rows:
        cells = re.findall(r"<td\b[^>]*>(.*?)</td>", row, flags=re.S | re.I)
        texts = [html_text(cell) for cell in cells]
        if len(texts) < 14 or not texts[0].isdigit():
            continue
        title = texts[1]
        for month_index, cell_text in enumerate(texts[2:14], start=1):
            if "……" in cell_text:
                continue
            day_match = re.search(r"(\d{1,2})\s*/", cell_text)
            if not day_match:
                continue
            date = iso_date(year, month_index, safe_int(day_match.group(1)))
            if not date:
                continue
            impact = "高" if any(keyword in title for keyword in high_keywords) else "中"
            events.append(
                event_payload(
                    date,
                    "宏观经济数据",
                    "中国大中华",
                    f"国家统计局：{title}",
                    impact,
                    "国家统计局最新统计信息发布日程",
                    "nbs",
                    NBS_RELEASE_SCHEDULE,
                )
            )
    return events


def get_official_events() -> dict:
    cached = cache_get("official-events", EVENT_CACHE_TTL)
    if cached:
        return cached

    sources = [
        ("国家统计局", fetch_nbs_events),
        ("美国BEA", fetch_bea_events),
        ("美国BLS CPI", fetch_bls_cpi_events),
        ("美国BLS非农", fetch_bls_employment_events),
        ("美国ADP小非农", fetch_adp_employment_events),
        ("美国财政部Fiscal Data", fetch_fiscaldata_events),
        ("美国财政部TIC", fetch_tic_events),
        ("美联储FOMC", fetch_fomc_events),
    ]
    events: list[dict] = []
    statuses = []
    for name, fetcher in sources:
        try:
            items = fetcher()
            events.extend(items)
            statuses.append({"name": name, "ok": True, "count": len(items)})
        except Exception as exc:  # noqa: BLE001
            statuses.append({"name": name, "ok": False, "count": 0, "message": str(exc)})

    unique: dict[str, dict] = {}
    for item in events:
        unique[item["sourceId"]] = item

    payload = {
        "ok": True,
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
        "sources": statuses,
        "events": sorted(unique.values(), key=lambda item: (item["date"], item["title"])),
    }
    return cache_set("official-events", payload)


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        parsed = urllib.parse.urlparse(path)
        clean = parsed.path.lstrip("/") or "index.html"
        return str((ROOT / clean).resolve())

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        try:
            if parsed.path == "/api/health":
                return self.json_response(
                    {
                        "ok": True,
                        "time": datetime.now().isoformat(timespec="seconds"),
                        "version": APP_VERSION,
                        "port": PORT,
                    }
                )
            if parsed.path == "/api/diagnostics":
                return self.json_response(
                    {
                        "ok": True,
                        "time": datetime.now().isoformat(timespec="seconds"),
                        "version": APP_VERSION,
                        "port": PORT,
                        "root": str(ROOT),
                        "userData": str(APP_USER_DATA) if APP_USER_DATA else "",
                        "platform": sys.platform,
                        "python": sys.version.split()[0],
                        "logs": {
                            "update": tail_file(APP_USER_DATA / "update.log" if APP_USER_DATA else None),
                        },
                    }
                )
            if parsed.path == "/api/quote":
                return self.json_response(get_quote(query.get("symbol", [""])[0]))
            if parsed.path == "/api/candles":
                return self.json_response(
                    get_candles(query.get("symbol", [""])[0], safe_int(query.get("days", ["180"])[0], 180))
                )
            if parsed.path == "/api/events/official":
                return self.json_response(get_official_events())
        except Exception as exc:  # noqa: BLE001
            return self.json_response({"ok": False, "message": str(exc)}, status=400)

        file_path = Path(self.translate_path(self.path))
        if file_path.is_dir():
            file_path = file_path / "index.html"
        if not file_path.exists() or ROOT not in file_path.parents and file_path != ROOT:
            self.send_error(404)
            return

        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith("text/") else content_type)
        self.send_header("Content-Length", str(file_path.stat().st_size))
        self.end_headers()
        with file_path.open("rb") as fh:
            self.wfile.write(fh.read())

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        length = safe_int(self.headers.get("Content-Length"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
            if parsed.path == "/api/scan":
                return self.json_response(scan_positions(payload.get("positions") or []))
        except Exception as exc:  # noqa: BLE001
            return self.json_response({"ok": False, "message": str(exc)}, status=400)
        self.send_error(404)

    def json_response(self, payload, status: int = 200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


def main():
    os.chdir(ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"交易纪律工作台已启动：http://127.0.0.1:{PORT}/")
    server.serve_forever()


if __name__ == "__main__":
    main()

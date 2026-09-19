import json
import os
import urllib.error
import urllib.request


def send_events(events: list[dict]) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        print("알림: Telegram Secret이 없어 전송을 건너뜀")
        return
    if not events:
        return

    for event in events:
        text = _format(event)
        _send(token, chat_id, text)


def _format(event: dict) -> str:
    kind = event.get("type")
    product = event.get("productName", "")
    seller = event.get("sellerName", "")
    if kind == "NEW":
        price = _won(event.get("price"))
        region = event.get("region") or ""
        return "\n".join(
            [
                "신규 매물",
                "",
                product,
                price,
                f"당근 · {region}".strip(" ·"),
                event.get("url") or "",
            ]
        )
    if kind == "PRICE_DROP":
        return "\n".join(
            [
                "가격 인하",
                "",
                product,
                f"{_won(event.get('previousPrice'))} → {_won(event.get('price'))}",
                f"▼{_won(event.get('dropAmount'))}",
                seller,
                event.get("url") or "",
            ]
        )
    rate = event.get("discountRate")
    rate_text = f"할인율 {rate}%" if rate is not None else ""
    return "\n".join(
        [
            "신품 할인",
            "",
            product,
            f"{_won(event.get('officialPrice'))} → {_won(event.get('price'))}",
            rate_text,
            seller,
            event.get("url") or "",
        ]
    )


def _won(value) -> str:
    try:
        return f"{int(value):,}원"
    except (TypeError, ValueError):
        return "-"


def _send(token: str, chat_id: str, text: str) -> None:
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps(
        {
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": True,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            response.read()
    except urllib.error.HTTPError as error:
        print(f"알림: Telegram 전송 실패 HTTP {error.code}")
    except urllib.error.URLError as error:
        print(f"알림: Telegram 전송 실패 {error.reason}")

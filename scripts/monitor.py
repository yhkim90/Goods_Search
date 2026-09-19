import json
import sys
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from collectors import daangn, ellscoffee, official, okcoffeemall
from config import CHECK_INTERVAL_MINUTES, DATA_DIR, PRODUCTS
from bizcheck import lookup_status
from consumercheck import inspect_seller
from notify import send_events
from trust import PROFILES, build_sellers

KST = timezone(timedelta(hours=9))
COLLECTORS = (
    official.collect,
    ellscoffee.collect,
    okcoffeemall.collect,
    daangn.collect,
)


def main() -> int:
    print("검색 시작")
    now = datetime.now(KST)
    now_iso = now.isoformat(timespec="seconds")
    today = now.strftime("%Y-%m-%d")

    previous_prices = _load("prices.json")
    previous_items = {
        item["id"]: item for item in previous_prices.get("items", []) if item.get("id")
    }
    history = _load("history.json")
    events_doc = _load("events.json")
    alerts_doc = _load("alerts.json")
    listings_doc = _load("listings.json")
    sent_keys = {item.get("key") for item in alerts_doc.get("sent", []) if item.get("key")}

    collector_states = []
    live_items = []
    listings = list(listings_doc.get("items", []))
    new_events = []

    counts = {"sp-800": 0, "sp-800a": 0, "new": 0, "drop": 0, "sale": 0}

    for collect in COLLECTORS:
        name = collect.__module__.split(".")[-1]
        try:
            result = collect()
            status = result.get("status", "ok")
            message = result.get("message", "")
            items = result.get("items") or []
            for item in items:
                item["collectedAt"] = now_iso
                live_items.append(item)
                product_id = item.get("productId")
                if product_id in counts:
                    counts[product_id] += 1
            if result.get("listings"):
                listings = result["listings"]
            collector_states.append(
                {
                    "id": result.get("id", name),
                    "name": result.get("name", name),
                    "status": status,
                    "message": message,
                    "count": len(items) + len(result.get("listings") or []),
                }
            )
            print(f"{name}: {status.upper()} ({len(items)}) {message}".strip())
        except Exception as error:
            collector_states.append(
                {
                    "id": name,
                    "name": name,
                    "status": "error",
                    "message": str(error),
                    "count": 0,
                }
            )
            print(f"{name}: FAILED {error}")
            traceback.print_exc()

    merged = _merge_prices(previous_items, live_items, collector_states)
    history_items = list(history.get("items", []))

    for item in live_items:
        previous = previous_items.get(item["id"])
        product = PRODUCTS.get(item["productId"], {})
        official_price = product.get("official_price")
        product_name = product.get("name", item["productId"])

        if previous and item["price"] < previous["price"]:
            drop = previous["price"] - item["price"]
            key = f"drop:{item['id']}:{previous['price']}:{item['price']}"
            event = {
                "id": key,
                "type": "PRICE_DROP",
                "productId": item["productId"],
                "productName": product_name,
                "sellerName": item["sellerName"],
                "previousPrice": previous["price"],
                "price": item["price"],
                "dropAmount": drop,
                "url": item["url"],
                "createdAt": now_iso,
            }
            if _remember(event, key, sent_keys, alerts_doc, now_iso):
                new_events.append(event)
                counts["drop"] += 1

        if official_price and item["price"] < official_price:
            rate = round((official_price - item["price"]) / official_price * 100, 1)
            key = f"sale:{item['id']}:{item['price']}"
            event = {
                "id": key,
                "type": "SALE",
                "productId": item["productId"],
                "productName": product_name,
                "sellerName": item["sellerName"],
                "officialPrice": official_price,
                "price": item["price"],
                "discountRate": rate,
                "url": item["url"],
                "createdAt": now_iso,
            }
            if _remember(event, key, sent_keys, alerts_doc, now_iso):
                new_events.append(event)
                counts["sale"] += 1

        last_history = _last_history(history_items, item["sellerId"], item["productId"])
        if last_history is None or last_history != item["price"]:
            history_items.append(
                {
                    "date": today,
                    "sellerId": item["sellerId"],
                    "sellerName": item["sellerName"],
                    "productId": item["productId"],
                    "price": item["price"],
                }
            )

    events = (new_events + events_doc.get("items", []))[:80]
    any_ok = any(state["status"] in {"ok", "partial", "skipped"} for state in collector_states)
    previous_status = _load("status.json")

    _save("prices.json", {"updatedAt": now_iso, "items": merged})
    nts_map = lookup_status(
        [profile["bizNo"] for profile in PROFILES.values() if profile.get("bizNo")]
    )
    consumer_map = {}
    for seller_id, profile in PROFILES.items():
        try:
            consumer_map[seller_id] = inspect_seller(profile)
            print(f"소비자조회: {seller_id} 주의보 {consumer_map[seller_id].get('warningCount', 0)}")
        except Exception as error:
            print(f"소비자조회: {seller_id} FAILED {error}")
            consumer_map[seller_id] = {}
    _save("sellers.json", build_sellers(merged, nts_map, consumer_map))
    _save("history.json", {"items": history_items[-200:]})
    _save("events.json", {"items": events})
    _save("alerts.json", alerts_doc)
    _save("listings.json", {"updatedAt": now_iso, "items": listings})
    _save(
        "status.json",
        {
            "lastRunAt": now_iso,
            "lastSuccessAt": now_iso if any_ok else previous_status.get("lastSuccessAt"),
            "intervalMinutes": CHECK_INTERVAL_MINUTES,
            "collectors": collector_states,
        },
    )

    send_events(new_events)
    print(
        "검색 종료 | "
        f"SP-800 {counts['sp-800']} | SP-800A {counts['sp-800a']} | "
        f"신규 {counts['new']} | 가격변경 {counts['drop']} | 할인 {counts['sale']}"
    )
    return 0


def _merge_prices(previous: dict, live_items: list, states: list) -> list:
    failed = {state["id"] for state in states if state["status"] == "error"}
    merged = {item["id"]: item for item in live_items}
    for item_id, item in previous.items():
        seller_id = item.get("sellerId")
        if seller_id in failed and item_id not in merged:
            merged[item_id] = item
    return list(merged.values())


def _last_history(items: list, seller_id: str, product_id: str):
    for row in reversed(items):
        if row.get("sellerId") == seller_id and row.get("productId") == product_id:
            return row.get("price")
    return None


def _remember(event, key, sent_keys, alerts_doc, now_iso) -> bool:
    if key in sent_keys:
        return False
    sent_keys.add(key)
    alerts_doc.setdefault("sent", []).append({"key": key, "sentAt": now_iso})
    alerts_doc["sent"] = alerts_doc["sent"][-400:]
    return True


def _load(name: str) -> dict:
    path = DATA_DIR / name
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _save(name: str, payload: dict) -> None:
    path = DATA_DIR / name
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    raise SystemExit(main())

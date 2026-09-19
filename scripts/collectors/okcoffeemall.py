import re

from config import SELLERS
from http_util import fetch_text, parse_krw

SELLER_ID = "okcoffeemall"


def collect() -> dict:
    items = []
    errors = []
    for product_id, url in SELLERS[SELLER_ID]["products"].items():
        try:
            items.append(_collect_one(product_id, url))
        except Exception as error:
            errors.append(f"{product_id}: {error}")

    if not items:
        raise RuntimeError("; ".join(errors) or "상품 가격 없음")

    return {
        "id": SELLER_ID,
        "name": SELLERS[SELLER_ID]["name"],
        "status": "ok" if not errors else "partial",
        "message": "; ".join(errors),
        "items": items,
    }


def _collect_one(product_id: str, url: str) -> dict:
    html = fetch_text(url)
    price = _hidden_price(html, "set_goods_price") or _hidden_price(html, "set_total_price")
    if price is None:
        raise RuntimeError("판매가를 찾지 못함")
    title_match = re.search(
        r'<meta property="og:title" content="([^"]+)"',
        html,
        re.IGNORECASE,
    )
    if not title_match:
        title_match = re.search(r"<h[12][^>]*>([^<]*SP-800[^<]*)", html, re.IGNORECASE)
    title = title_match.group(1).strip() if title_match else product_id
    return {
        "id": f"{SELLER_ID}:{product_id}",
        "productId": product_id,
        "sellerId": SELLER_ID,
        "sellerName": SELLERS[SELLER_ID]["name"],
        "title": title,
        "price": price,
        "listPrice": price,
        "shippingFee": 0,
        "url": url,
    }


def _hidden_price(html: str, name: str) -> int | None:
    match = re.search(
        rf'name="{name}"[^>]*value="([\d.]+)"',
        html,
        re.IGNORECASE,
    )
    if not match:
        match = re.search(
            rf'value="([\d.]+)"[^>]*name="{name}"',
            html,
            re.IGNORECASE,
        )
    return parse_krw(match.group(1) if match else None)

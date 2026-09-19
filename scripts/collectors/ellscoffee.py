import re

from config import SELLERS
from http_util import fetch_text, parse_krw

SELLER_ID = "ellscoffee"


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
    sale = _span_price(html, "span_product_price_text")
    custom = _span_price(html, "span_product_price_custom")
    if sale is None:
        raise RuntimeError("판매가를 찾지 못함")
    title_match = re.search(r"<title>([^<]+)</title>", html, re.IGNORECASE)
    title = (title_match.group(1).split("/")[0].strip() if title_match else product_id)
    review_match = re.search(r'class="review_count">(\d+)', html)
    rating_match = re.search(r'"ratingValue"\s*:\s*(\d+(?:\.\d+)?)', html)
    return {
        "id": f"{SELLER_ID}:{product_id}",
        "productId": product_id,
        "sellerId": SELLER_ID,
        "sellerName": SELLERS[SELLER_ID]["name"],
        "title": title,
        "price": sale,
        "listPrice": custom or sale,
        "shippingFee": 0,
        "url": url,
        "reviewCount": int(review_match.group(1)) if review_match else 0,
        "rating": float(rating_match.group(1)) if rating_match else None,
    }


def _span_price(html: str, element_id: str) -> int | None:
    match = re.search(
        rf'id="{element_id}"[^>]*>([^<]+)',
        html,
        re.IGNORECASE,
    )
    return parse_krw(match.group(1) if match else None)

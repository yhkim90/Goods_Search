import re
from urllib.parse import urljoin

from config import SELLERS
from http_util import fetch_text, parse_krw
from product import classify_title

SOURCE = "https://sparkorea.com"
SELLER_ID = "official"


def collect() -> dict:
    url = SELLERS[SELLER_ID]["category_url"]
    html = fetch_text(url)
    blocks = re.split(r'<li[^>]*id="anchorBoxId_', html)
    found = []

    for block in blocks[1:]:
        price_match = re.search(r'ec-data-price="(\d+)"', block)
        custom_match = re.search(r'ec-data-custom="(\d+)"', block)
        price = parse_krw(price_match.group(1) if price_match else None)
        list_price = parse_krw(custom_match.group(1) if custom_match else None)
        href_match = re.search(r'href="(/product/[^"]+)"', block)
        name_match = re.search(r">(SP-800A?[^<]*)<", block, re.IGNORECASE)
        if not name_match:
            name_match = re.search(r'alt="([^"]*SP-800[^"]*)"', block, re.IGNORECASE)
        title = (name_match.group(1) if name_match else "").strip()
        product_id = classify_title(title)
        if not product_id or price is None:
            continue

        href = href_match.group(1) if href_match else ""
        found.append(
            {
                "productId": product_id,
                "sellerId": SELLER_ID,
                "sellerName": SELLERS[SELLER_ID]["name"],
                "title": title,
                "price": price,
                "listPrice": list_price or price,
                "shippingFee": 0,
                "url": urljoin(SOURCE, href) if href else url,
            }
        )

    items = _pick_lowest(found)
    if not items:
        raise RuntimeError("카테고리에서 SP-800/SP-800A 가격을 찾지 못함")

    return {
        "id": SELLER_ID,
        "name": SELLERS[SELLER_ID]["name"],
        "status": "ok",
        "message": "",
        "items": items,
    }


def _pick_lowest(rows: list[dict]) -> list[dict]:
    chosen = {}
    for row in rows:
        current = chosen.get(row["productId"])
        if current is None or row["price"] < current["price"]:
            chosen[row["productId"]] = row
    result = []
    for product_id, row in chosen.items():
        row = dict(row)
        row["id"] = f"{SELLER_ID}:{product_id}"
        if product_id == "sp-800":
            row["title"] = "SP-800"
        elif product_id == "sp-800a":
            row["title"] = "SP-800A"
        result.append(row)
    return result

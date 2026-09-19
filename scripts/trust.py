from bizcheck import HOMETAX_LOOKUP_URL, checksum_valid, digits, format_biz_no
from config import PRODUCTS

PROFILES = {
    "official": {
        "id": "official",
        "name": "스파코리아 공식몰",
        "company": "주식회사 스파코리아",
        "role": "official",
        "https": True,
        "since": 2022,
        "baseScore": 4.6,
        "bizNo": "541-87-00841",
    },
    "ellscoffee": {
        "id": "ellscoffee",
        "name": "엘스커피",
        "company": "주식회사 이알코퍼레이션",
        "role": "reseller",
        "https": True,
        "since": 2017,
        "baseScore": 3.6,
        "bizNo": "718-81-00100",
    },
    "okcoffeemall": {
        "id": "okcoffeemall",
        "name": "오케이커피몰",
        "company": "오케이커피몰",
        "role": "reseller",
        "https": False,
        "since": 2022,
        "baseScore": 2.8,
        "bizNo": "131-36-65010",
        "aliases": ["오케이커피몰"],
        "reviewBoardUrl": "http://okcoffeemall.com/board/list.php?bdId=goodsreview",
    },
}


def build_sellers(
    price_items: list[dict],
    nts_map: dict | None = None,
    consumer_map: dict | None = None,
) -> dict:
    sellers = {}
    nts_map = nts_map or {}
    consumer_map = consumer_map or {}
    for seller_id, profile in PROFILES.items():
        rows = [item for item in price_items if item.get("sellerId") == seller_id]
        signals = _signals(profile, rows, nts_map, consumer_map.get(seller_id, {}))
        score = _score(profile, signals)
        sellers[seller_id] = {
            "id": seller_id,
            "name": profile["name"],
            "role": profile["role"],
            "score": score,
            "stars": _stars(score),
            "reviewCount": signals["reviewCount"],
            "rating": signals["rating"],
            "maxDiscountRate": signals["maxDiscountRate"],
            "https": profile["https"],
            "biz": signals["biz"],
            "consumer": signals["consumer"],
            "reasons": _reasons(profile, signals, score),
        }
    return {"items": list(sellers.values())}


def _signals(profile: dict, rows: list[dict], nts_map: dict, consumer: dict) -> dict:
    review_counts = [item.get("reviewCount") for item in rows if item.get("reviewCount") is not None]
    ratings = [item.get("rating") for item in rows if item.get("rating") is not None]
    discounts = []
    for item in rows:
        official = PRODUCTS.get(item.get("productId"), {}).get("official_price")
        price = item.get("price")
        if official and price and price < official:
            discounts.append(round((official - price) / official * 100, 1))
    return {
        "reviewCount": max(review_counts) if review_counts else 0,
        "rating": max(ratings) if ratings else None,
        "maxDiscountRate": max(discounts) if discounts else 0,
        "biz": _biz(profile, nts_map),
        "consumer": _consumer(profile, consumer),
    }


def _biz(profile: dict, nts_map: dict) -> dict:
    number = format_biz_no(profile.get("bizNo", ""))
    valid = checksum_valid(number)
    nts = nts_map.get(digits(number), {}) if valid else {}
    if not valid:
        label = "번호 형식 오류"
    elif nts.get("label"):
        label = f"국세청 {nts['label']}"
    else:
        label = "번호 형식 정상"
    return {
        "number": number,
        "company": profile.get("company") or profile["name"],
        "checksumValid": valid,
        "ntsCode": nts.get("code") or "",
        "ntsLabel": label,
        "lookupUrl": HOMETAX_LOOKUP_URL,
    }


def _consumer(profile: dict, raw: dict) -> dict:
    warning_count = int(raw.get("warningCount") or 0)
    store_reviews = int(raw.get("storeReviewCount") or 0)
    store_complaints = int(raw.get("storeComplaintCount") or 0)
    ftc_found = bool(raw.get("ftcFound"))
    ftc_checked = bool(raw.get("ftcChecked"))
    if warning_count:
        label = f"소비자24 피해주의보 {warning_count}건"
    else:
        label = "소비자24 피해주의보 없음"
    return {
        "warningCount": warning_count,
        "warningUrl": raw.get("warningUrl") or "",
        "ftcFound": ftc_found,
        "ftcChecked": ftc_checked,
        "ftcUrl": raw.get("ftcUrl") or "",
        "storeReviewCount": store_reviews,
        "storeComplaintCount": store_complaints,
        "label": label,
    }


def _score(profile: dict, signals: dict) -> float:
    biz = signals.get("biz") or {}
    consumer = signals.get("consumer") or {}
    if consumer.get("warningCount"):
        return 1.0
    if biz.get("ntsCode") == "03":
        return 1.0
    if profile["role"] == "official":
        return 5.0

    score = profile["baseScore"]
    if not biz.get("checksumValid"):
        score -= 1.5
    elif biz.get("ntsCode") == "01":
        score += 0.4
    elif biz.get("ntsCode") == "02":
        score -= 1.2

    reviews = signals["reviewCount"]
    if reviews >= 20:
        score += 1.0
    elif reviews >= 5:
        score += 0.6
    elif reviews >= 1:
        score += 0.3

    if signals["rating"] and signals["rating"] >= 4.5:
        score += 0.2

    discount = signals["maxDiscountRate"]
    if discount >= 35:
        score -= 0.7
    elif discount >= 25:
        score -= 0.4
    elif discount >= 15:
        score -= 0.2

    if consumer.get("storeComplaintCount"):
        score -= 0.3
    if profile["role"] != "official" and consumer.get("ftcChecked") and not consumer.get("ftcFound"):
        score -= 0.3

    return max(1.0, min(5.0, round(score, 1)))


def _stars(score: float) -> float:
    return round(score * 2) / 2


def _reasons(profile: dict, signals: dict, score: float) -> list[str]:
    reasons = []
    biz = signals.get("biz") or {}
    if biz.get("ntsLabel"):
        reasons.append(biz["ntsLabel"])
    if profile["role"] == "official":
        reasons.append("공식 수입사")
    consumer = signals.get("consumer") or {}
    if consumer.get("warningCount"):
        reasons.append(consumer["label"])
    elif consumer.get("label"):
        reasons.append(consumer["label"])
    if signals["reviewCount"]:
        text = f"이 상품 후기 {signals['reviewCount']}건"
        if signals["rating"]:
            text += f" · 평점 {signals['rating']}"
        reasons.append(text)
    elif profile["role"] != "official":
        store = consumer.get("storeReviewCount") or 0
        if store:
            reasons.append(f"이 상품 후기 0건 · 몰 전체 {store}건")
        else:
            reasons.append("이 상품 후기 0건")
    if consumer.get("storeComplaintCount"):
        reasons.append(f"몰 후기 불만 {consumer['storeComplaintCount']}건")
    if profile["role"] != "official" and consumer.get("ftcChecked") and not consumer.get("ftcFound"):
        reasons.append("공정위 상호 조회 안 됨")
    if not profile["https"]:
        reasons.append("보안연결 없음")
    if signals["maxDiscountRate"] >= 25:
        reasons.append(f"공식가보다 {signals['maxDiscountRate']}% 낮음")
    if score <= 3:
        reasons.append("구매 전 판매처 확인")
    return reasons[:4]

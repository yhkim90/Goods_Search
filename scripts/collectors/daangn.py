from config import SELLERS

SELLER_ID = "daangn"


def collect() -> dict:
    return {
        "id": SELLER_ID,
        "name": SELLERS[SELLER_ID]["name"],
        "status": "skipped",
        "message": "공식 API 없음. 자동 수집하지 않음",
        "items": [],
        "listings": [],
    }

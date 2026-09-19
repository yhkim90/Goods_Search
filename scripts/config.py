"""SP WATCH 설정. 검색 주기는 여기만 바꾼다."""

from pathlib import Path

CHECK_INTERVAL_MINUTES = 60

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

SITE_URL = "https://yhkim90.github.io/Goods_Search"

USER_AGENT = (
    "SPWatch/1.0 (+https://yhkim90.github.io/Goods_Search; "
    "personal price monitor)"
)
REQUEST_TIMEOUT = 20
REQUEST_GAP_SECONDS = 1

PRODUCTS = {
    "sp-800": {
        "name": "SP-800",
        "official_price": 1_500_000,
    },
    "sp-800a": {
        "name": "SP-800A",
        "official_price": 1_650_000,
    },
}

EXCLUDE_KEYWORDS = (
    "success",
    "석세스",
    "썩쌔스",
    "훅",
    "휘퍼",
    "스크래퍼",
    "가이드망",
    "부품",
    "sp-502",
    "sp-100a",
    "sp-200a",
)

SELLERS = {
    "official": {
        "name": "스파코리아 공식몰",
        "category_url": "https://sparkorea.com/category/%ED%85%8C%EC%9D%B4%EB%B8%94%EB%AF%B9%EC%84%9C/24/",
    },
    "ellscoffee": {
        "name": "엘스커피",
        "products": {
            "sp-800": "https://ellscoffee.co.kr/product/%EC%8A%A4%ED%8C%8C%EB%AF%B9%EC%84%9C-sp-800-%EB%B2%84%ED%8B%B0%EC%BB%AC-%EB%AF%B9%EC%84%9C%EA%B8%B0/495/",
            "sp-800a": "https://ellscoffee.co.kr/product/%EC%8A%A4%ED%8C%8C%EB%AF%B9%EC%84%9C-sp-800a-%EB%B2%84%ED%8B%B0%EC%BB%AC-%EB%AF%B9%EC%84%9C%EA%B8%B0/307/",
        },
    },
    "okcoffeemall": {
        "name": "오케이커피몰",
        "products": {
            "sp-800": "http://okcoffeemall.com/goods/goods_view.php?goodsNo=2119",
            "sp-800a": "http://okcoffeemall.com/goods/goods_view.php?goodsNo=2118",
        },
    },
    "daangn": {
        "name": "당근",
    },
}

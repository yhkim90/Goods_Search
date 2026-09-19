import re
from urllib.parse import quote

from http_util import fetch_text

CONSUMER24_WARNING = (
    "https://www.consumer.go.kr/user/ftc/consumer/cnsmrBBS/740/"
    "selectInfoCDMGCSLCList.do?page=1&row=20&searchGbn=REGIST_DT"
    "&searchRange=searchRangeAll&searchKeyword={query}"
)
FTC_MAIL_ORDER = (
    "https://www.ftc.go.kr/www/selectBizCommList.do?key=254"
    "&pageIndex=1&pageUnit=10&searchCnd=BZMNNM&searchKrwd={query}"
)
NEGATIVE_REVIEW = ("환불", "사기", "먹튀", "미배송", "불량", "연락", "피해")


def inspect_seller(profile: dict) -> dict:
    names = _search_names(profile)
    warning = _search_consumer24(names)
    ftc = _search_ftc(names)
    store = _store_reviews(profile)
    return {
        "warningCount": warning["count"],
        "warningUrl": warning["url"],
        "ftcFound": ftc["found"],
        "ftcChecked": ftc["checked"],
        "ftcUrl": ftc["url"],
        "storeReviewCount": store["count"],
        "storeComplaintCount": store["complaints"],
    }


def _search_names(profile: dict) -> list[str]:
    names = [profile.get("name", ""), profile.get("company", "")]
    names.extend(profile.get("aliases") or [])
    unique = []
    for name in names:
        text = (name or "").strip()
        if text and text not in unique:
            unique.append(text)
    return unique


def _search_consumer24(names: list[str]) -> dict:
    url = CONSUMER24_WARNING.format(query=quote(names[0]))
    count = 0
    try:
        for name in names:
            page = CONSUMER24_WARNING.format(query=quote(name))
            html = fetch_text(page)
            if "검색된 자료가 없습니다" in html:
                continue
            count += len(re.findall(r"피해주의보|주의보", html))
            url = page
    except Exception:
        return {"count": 0, "url": url}
    return {"count": count, "url": url}


def _search_ftc(names: list[str]) -> dict:
    url = FTC_MAIL_ORDER.format(query=quote(names[0]))
    found = False
    checked = False
    try:
        for name in names:
            page = FTC_MAIL_ORDER.format(query=quote(name))
            html = fetch_text(page)
            checked = True
            if "등록된 정보가 없습니다" in html:
                continue
            if "통신판매" in html:
                found = True
                url = page
                break
    except Exception:
        return {"found": False, "checked": False, "url": url}
    return {"found": found, "checked": checked, "url": url}


def _store_reviews(profile: dict) -> dict:
    url = (profile.get("reviewBoardUrl") or "").strip()
    if not url:
        return {"count": 0, "complaints": 0}
    try:
        html = fetch_text(url)
    except Exception:
        return {"count": 0, "complaints": 0}

    titles = re.findall(r"<li[\s\S]{0,400}?별 다섯개중[\s\S]{0,200}?([가-힣A-Za-z0-9 ].{2,40})", html)
    if not titles:
        titles = re.findall(r"(빠른배송|환불|사이즈|만족|상품)[^\n<]{0,30}", html)
    complaints = sum(1 for title in titles if any(word in title for word in NEGATIVE_REVIEW))
    count = html.count("별 다섯개중") or html.count("네이버페이 구매자")
    return {"count": count, "complaints": complaints}

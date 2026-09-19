import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

NTS_STATUS_URL = "https://api.odcloud.kr/api/nts-businessman/v1/status"
HOMETAX_LOOKUP_URL = (
    "https://teht.hometax.go.kr/websquare/websquare.html"
    "?w2xPath=/ui/ab/a/a/UTEABAAA13.xml"
)

STATUS_LABEL = {
    "01": "계속사업자",
    "02": "휴업자",
    "03": "폐업자",
}


def digits(biz_no: str) -> str:
    return "".join(ch for ch in (biz_no or "") if ch.isdigit())


def format_biz_no(biz_no: str) -> str:
    value = digits(biz_no)
    if len(value) != 10:
        return biz_no or ""
    return f"{value[:3]}-{value[3:5]}-{value[5:]}"


def checksum_valid(biz_no: str) -> bool:
    value = digits(biz_no)
    if len(value) != 10:
        return False
    numbers = [int(ch) for ch in value]
    weights = [1, 3, 7, 1, 3, 7, 1, 3, 5]
    total = sum(number * weight for number, weight in zip(numbers, weights))
    total += (numbers[8] * 5) // 10
    check = (10 - (total % 10)) % 10
    return check == numbers[9]


def lookup_status(biz_nos: list[str]) -> dict:
    key = os.environ.get("NTS_SERVICE_KEY", "").strip()
    numbers = [digits(item) for item in biz_nos if checksum_valid(item)]
    if not key:
        print("사업자조회: NTS_SERVICE_KEY가 없어 국세청 상태조회를 건너뜀")
        return {}
    if not numbers:
        return {}

    query = urlencode({"serviceKey": key, "returnType": "JSON"})
    payload = json.dumps({"b_no": numbers}).encode("utf-8")
    request = Request(
        f"{NTS_STATUS_URL}?{query}",
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        print(f"사업자조회: 국세청 HTTP {error.code}")
        return {}
    except URLError as error:
        print(f"사업자조회: 국세청 연결 실패")
        return {}
    except json.JSONDecodeError:
        print("사업자조회: 국세청 응답 파싱 실패")
        return {}

    result = {}
    for row in body.get("data") or []:
        number = digits(row.get("b_no", ""))
        code = str(row.get("b_stt_cd") or "").zfill(2) if row.get("b_stt_cd") else ""
        if not code and row.get("b_stt"):
            label = str(row.get("b_stt"))
            if "계속" in label:
                code = "01"
            elif "휴업" in label:
                code = "02"
            elif "폐업" in label:
                code = "03"
        result[number] = {
            "code": code,
            "label": STATUS_LABEL.get(code) or row.get("b_stt") or "확인불가",
            "taxType": row.get("tax_type") or "",
            "endDate": row.get("end_dt") or "",
        }
    print(f"사업자조회: 국세청 {len(result)}건")
    return result

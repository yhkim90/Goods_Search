import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from config import REQUEST_GAP_SECONDS, REQUEST_TIMEOUT, USER_AGENT

_last_request_at = 0.0


def fetch_text(url: str) -> str:
    global _last_request_at
    elapsed = time.time() - _last_request_at
    if _last_request_at and elapsed < REQUEST_GAP_SECONDS:
        time.sleep(REQUEST_GAP_SECONDS - elapsed)

    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.6",
        },
    )
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            raw = response.read()
            charset = response.headers.get_content_charset() or "utf-8"
    except HTTPError as error:
        _last_request_at = time.time()
        raise RuntimeError(f"HTTP {error.code}") from error
    except URLError as error:
        _last_request_at = time.time()
        raise RuntimeError(f"연결 실패: {error.reason}") from error

    _last_request_at = time.time()
    try:
        return raw.decode(charset, "replace")
    except LookupError:
        return raw.decode("utf-8", "replace")


def parse_krw(value) -> int | None:
    if value is None:
        return None
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    if not digits:
        return None
    return int(digits)

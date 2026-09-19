import re
import unicodedata

from config import EXCLUDE_KEYWORDS

_SP800A = re.compile(r"sp[\s\-]*800\s*a\b", re.IGNORECASE)
_SP800 = re.compile(r"sp[\s\-]*800\b", re.IGNORECASE)


def _norm(text: str) -> str:
    return unicodedata.normalize("NFKC", text or "").strip().lower()


def classify_title(title: str) -> str | None:
    text = _norm(title)
    if not text:
        return None

    compact = re.sub(r"[\s\-]", "", text)
    if any(keyword in text or keyword.replace("-", "") in compact for keyword in EXCLUDE_KEYWORDS):
        if "훅" in text or "휘퍼" in text or "스크래퍼" in text or "가이드망" in text or "부품" in text:
            return None
        if "success" in text or "석세스" in text or "썩쌔스" in text:
            return None
        if "sp-502" in text or "sp502" in compact:
            return None
        if "sp-100a" in text or "sp-200a" in text:
            return None

    if _SP800A.search(text) or "800a" in compact:
        if "훅" in text or "볼" in text or "휘퍼" in text or "스크래퍼" in text:
            return None
        return "sp-800a"

    if _SP800.search(text):
        if "훅" in text or "볼" in text or "휘퍼" in text or "스크래퍼" in text:
            return None
        return "sp-800"

    return None

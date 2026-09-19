const RANK_LIMIT = 5;
const SIMILAR_PRICE_RATIO = 1.08;
const VISIT_LIMIT = 6;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value) {
  return String(value || "").toLowerCase().replace(/[\s\-_.]/g, "");
}

const QUERY_STOP = /^(판매|가격|최저가|중고|구매|추천|사이트|쇼핑몰|상품|판매처|신품)$/;

function queryNeedles(query) {
  const raw = String(query || "").trim();
  const models = [...raw.matchAll(/[A-Za-z]{1,8}-?\d{2,}[A-Za-z0-9]*/g)].map((match) => compact(match[0]));
  const words = raw
    .split(/[\s/,|+]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !QUERY_STOP.test(word) && !/^[A-Za-z]{1,8}-?\d{2,}/i.test(word))
    .map(compact);
  return { models: [...new Set(models)], words: [...new Set(words)] };
}

function tokenAliases(token) {
  const aliases = {
    nike: ["nike", "나이키"],
    나이키: ["nike", "나이키"],
    adidas: ["adidas", "아디다스"],
    아디다스: ["adidas", "아디다스"],
  };
  return aliases[token] || [token];
}

function isRelevant(text, query) {
  const hay = compact(`${text || ""}`);
  if (!hay) {
    return false;
  }
  const { models, words } = queryNeedles(query);
  if (models.length) {
    return models.some((model) => hay.includes(model));
  }
  if (!words.length) {
    return hay.includes(compact(query));
  }
  const hits = words.filter((word) => tokenAliases(word).some((alias) => hay.includes(compact(alias))));
  return words.length === 1 ? hits.length === 1 : hits.length >= Math.ceil(words.length * 0.7);
}

function primarySearchTerm(query) {
  const match = String(query || "").match(/[A-Za-z]{1,8}-?\d{2,}[A-Za-z0-9]*/);
  return match ? match[0] : String(query || "").trim();
}

function parseWon(value) {
  const text = String(value || "").replace(/\s+/g, "");
  const man = text.match(/(\d+(?:\.\d+)?)만/);
  if (man) {
    const price = Math.round(Number(man[1]) * 10000);
    return price >= 10000 && price <= 200000000 ? price : 0;
  }
  const digits = text.replace(/[^\d]/g, "");
  if (!digits) {
    return 0;
  }
  const price = Number(digits);
  return price >= 10000 && price <= 200000000 ? price : 0;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (error) {
    return "";
  }
}

function cleanUrl(value) {
  try {
    const href = decodeURIComponent(String(value || "").replace(/&amp;/g, "&").replace(/[),.\]]+$/, ""));
    const url = new URL(href);
    const nested = url.searchParams.get("uddg") || url.searchParams.get("url") || url.searchParams.get("u") || url.searchParams.get("targetUrl");
    if (nested && /^https?:/i.test(nested)) {
      return cleanUrl(nested);
    }
    if (url.hostname.includes("google.") && url.searchParams.get("q") && /^https?:/i.test(url.searchParams.get("q"))) {
      return cleanUrl(url.searchParams.get("q"));
    }
    url.hash = "";
    return url.toString();
  } catch (error) {
    return "";
  }
}

function isNoiseHost(host) {
  return /google|youtube|facebook|instagram|namu\.wiki|wikipedia|daangn|karrot|blog\.naver|cafe\.naver|post\.naver|tistory|medium\.com|search\.|bing\.com|duckduckgo|yahoo\.|baidu/i.test(host);
}

function isAggregator(host) {
  return /danawa|enuri|coupa+ng\.com$|shopping\.naver|shopping\.daum|esmplus|gmarket\.co\.kr$|auction\.co\.kr$|11st\.co\.kr$/i.test(host);
}

function isBannedSeller(name) {
  return /다나와|에누리|네이버쇼핑|네이버|쿠팡|지마켓|옥션|11번가|구글|빙|다음|검색|광고|이미지|블로그|카페|판매가|할인가|최저가|평균|배송/i.test(name);
}

function hostLabel(url) {
  const host = hostnameOf(url);
  const known = {
    "nike.com": "Nike",
    "sparkorea.com": "스파코리아 공식몰",
    "ellscoffee.co.kr": "엘스커피",
    "okcoffeemall.com": "오케이커피몰",
    "musinsa.com": "무신사",
    "29cm.co.kr": "29CM",
    "wconcept.co.kr": "W컨셉",
    "ssfshop.com": "SSF샵",
    "abcmart.co.kr": "ABC마트",
    "e-himart.co.kr": "하이마트",
  };
  if (known[host]) {
    return known[host];
  }
  const store = url.match(/(?:smartstore|brand)\.naver\.com\/([^/?#]+)/i);
  if (store) {
    return store[1];
  }
  return host.replace(/\.(co\.kr|com|net|kr)$/i, "") || "판매처";
}

function visibleLabel(value, fallback) {
  const text = decodeHtml(value)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length < 2 || text.length > 40 || isBannedSeller(text)) {
    return fallback;
  }
  if (/^image|img$/i.test(text)) {
    return fallback;
  }
  return text;
}

function pickProductPrice(text) {
  const source = String(text || "");
  const labeled = [
    /ec-data-price="(\d+)"/i,
    /set_goods_price["'\s:=]+(\d+)/i,
    /set_total_price["'\s:=]+(\d+)/i,
    /itemprop="price"\s+content="(\d+(?:\.\d+)?)"/i,
    /property="product:price:amount"[^>]+content="(\d+)/i,
    /"price"\s*:\s*"?(\d{5,})"?/,
    /(?:판매가|할인가|즉시할인가|구매가|판매 가격|상품금액|price)[^\d]{0,24}([0-9]{1,3}(?:,[0-9]{3})+|\d{5,})/i,
    /(?:판매가|할인가|구매가)[^\n]{0,40}?([0-9]{1,3}(?:,[0-9]{3})+)\s*원/,
  ];
  for (const pattern of labeled) {
    const match = source.match(pattern);
    const price = parseWon(match && match[1]);
    if (price) {
      return price;
    }
  }
  const amounts = [];
  const regex = /([0-9]{1,3}(?:,[0-9]{3})+)\s*원/g;
  let match;
  while ((match = regex.exec(source))) {
    const ctx = source.slice(Math.max(0, match.index - 20), match.index);
    if (/배송|미만|이상|택배|쿠폰/.test(ctx)) {
      continue;
    }
    const price = parseWon(match[1]);
    if (price) {
      amounts.push(price);
    }
  }
  if (!amounts.length) {
    return 0;
  }
  const counts = new Map();
  amounts.forEach((price) => counts.set(price, (counts.get(price) || 0) + 1));
  let best = 0;
  let bestCount = 0;
  counts.forEach((count, price) => {
    if (count > bestCount || (count === bestCount && price > best)) {
      best = price;
      bestCount = count;
    }
  });
  return bestCount >= 2 ? best : amounts[0];
}

function sellerFromHit(title, url, query) {
  const hostName = hostLabel(url);
  const cleaned = visibleLabel(title, "");
  if (!cleaned) {
    return hostName;
  }
  const q = compact(query);
  const t = compact(cleaned);
  if (q && (t.includes(q) || (q.includes(t) && t.length >= 4))) {
    return hostName;
  }
  const parts = cleaned.split(/\s*[|\-–:\/]\s*/);
  const last = parts[parts.length - 1];
  if (last && last.length <= 18 && visibleLabel(last, "") && !compact(last).includes(q)) {
    return last;
  }
  return hostName;
}

function trustFor(url, seller) {
  const host = hostnameOf(url);
  let stars = 3;
  let note = "인터넷에서 찾은 판매처";
  if (/(smartstore|brand)\.naver\.com/i.test(host)) {
    stars = 3.5;
    note = "네이버 스마트스토어";
  }
  if (/공식|official|nike\.com|sparkorea/i.test(`${seller} ${host}`)) {
    stars = 4.5;
    note = "브랜드·공식 가능성이 큼";
  }
  if (host === "sparkorea.com") {
    stars = 5;
    note = "공식 수입사";
  }
  if (host === "ellscoffee.co.kr") {
    stars = 4;
    note = "사업자·후기 확인된 판매처";
  }
  if (host === "okcoffeemall.com") {
    stars = 2;
    note = "후기 적고 보안 연결이 약함";
  }
  if (url.startsWith("http://")) {
    stars = Math.min(stars, 2);
    note = "보안 연결(HTTPS)이 아님";
  }
  return { stars, note, https: url.startsWith("https://") };
}

function toOffer(seller, price, url, title) {
  return {
    title: seller,
    seller,
    price,
    url,
    source: hostnameOf(url),
    trust: trustFor(url, seller),
    product: title || seller,
  };
}

function uniqueBySeller(offers) {
  const unique = new Map();
  offers.forEach((item) => {
    const key = `${compact(item.seller)}|${hostnameOf(item.url)}`;
    const current = unique.get(key);
    if (!current || item.price < current.price) {
      unique.set(key, item);
    }
  });
  return [...unique.values()];
}

function saneShopOffers(offers) {
  const valid = offers.filter((item) => item && item.price >= 10000 && item.seller && !isBannedSeller(item.seller));
  if (!valid.length) {
    return [];
  }
  const max = Math.max(...valid.map((item) => item.price));
  const floor = max >= 200000 ? Math.max(20000, Math.round(max * 0.12)) : 10000;
  return valid.filter((item) => item.price >= floor);
}

function rankOffers(offers) {
  return uniqueBySeller(saneShopOffers(offers))
    .sort((a, b) => {
      if (a.price !== b.price) {
        return a.price - b.price;
      }
      return (b.trust?.stars || 0) - (a.trust?.stars || 0);
    })
    .slice(0, RANK_LIMIT);
}

function suggestedOffer(ranked) {
  if (!ranked.length) {
    return null;
  }
  const cheapest = ranked[0];
  const similar = ranked.filter((item) => item.price <= cheapest.price * SIMILAR_PRICE_RATIO);
  const pick = similar.slice().sort((a, b) => (b.trust?.stars || 0) - (a.trust?.stars || 0) || a.price - b.price)[0];
  return pick && pick.url !== cheapest.url ? pick : null;
}

function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { cache: "no-store", signal: controller.signal }).finally(() => clearTimeout(timer));
}

function isBlockedText(text) {
  return /security verification|just a moment|attention required|i'm a teapot|접속이 일시적으로 제한/i.test(text) && text.length < 4000;
}

async function fetchText(url, ms) {
  const encoded = encodeURIComponent(url);
  const candidates = [
    `https://r.jina.ai/${url}`,
    `https://api.allorigins.win/raw?url=${encoded}`,
    `https://corsproxy.io/?${encoded}`,
  ];
  return Promise.any(
    candidates.map(async (target) => {
      const response = await fetchWithTimeout(target, ms || 6500);
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      const text = await response.text();
      if (!text || text.length < 80 || isBlockedText(text)) {
        throw new Error("empty");
      }
      return text;
    })
  );
}

function shopScore(url) {
  if (/\/(product|products|goods|goods_view|item|shop|catalog)\b|\/t\//i.test(url)) {
    return 2;
  }
  if (/(smartstore|brand)\.naver\.com\/[^/?#]+/i.test(url)) {
    return 2;
  }
  try {
    const path = new URL(url).pathname;
    return path && path !== "/" ? 1 : 0;
  } catch (error) {
    return 0;
  }
}

function addHit(hits, title, rawUrl, snippet, query) {
  const url = cleanUrl(rawUrl);
  const host = hostnameOf(url);
  if (!url || !host || isNoiseHost(host) || isAggregator(host)) {
    return;
  }
  const around = `${title || ""} ${snippet || ""}`;
  hits.push({
    title: decodeHtml(title),
    url,
    snippet: decodeHtml(snippet),
    price: pickProductPrice(around),
    seller: sellerFromHit(title, url, query),
  });
}

function parseSearchHits(text, query) {
  const hits = [];

  const md = /\[([^\]]{2,80})\]\((https?:\/\/[^)\s]+)\)/g;
  let match;
  while ((match = md.exec(text))) {
    if (match.index > 0 && text[match.index - 1] === "!") {
      continue;
    }
    addHit(hits, match[1], match[2], text.slice(match.index, match.index + 360), query);
  }

  const ddg = /(?:uddg=|href=")(https?:\/\/[^"&\s]+)/gi;
  while ((match = ddg.exec(text))) {
    const url = cleanUrl(match[1]);
    const chunk = text.slice(Math.max(0, match.index - 80), match.index + 280);
    addHit(hits, chunk, url, chunk, query);
  }

  const hrefs = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{2,80}?)<\/a>/gi;
  while ((match = hrefs.exec(text))) {
    addHit(hits, match[2], match[1], text.slice(match.index, match.index + 320), query);
  }

  const raw = /https?:\/\/[^\s)\]"'<>]+/gi;
  while ((match = raw.exec(text))) {
    addHit(hits, query, match[0], text.slice(match.index, match.index + 220), query);
  }

  const unique = [];
  const seen = new Set();
  hits.forEach((hit) => {
    if (seen.has(hit.url)) {
      const current = unique.find((item) => item.url === hit.url);
      if (current && !current.price && hit.price) {
        current.price = hit.price;
        current.seller = hit.seller || current.seller;
      }
      return;
    }
    seen.add(hit.url);
    unique.push(hit);
  });
  return unique;
}

async function searchWeb(query) {
  const q = encodeURIComponent(query);
  const qPrice = encodeURIComponent(`${query} 가격`);
  const pages = [
    `https://html.duckduckgo.com/html/?q=${qPrice}`,
    `https://lite.duckduckgo.com/lite/?q=${qPrice}`,
    `https://www.bing.com/search?q=${qPrice}`,
    `https://search.naver.com/search.naver?query=${qPrice}`,
    `https://search.danawa.com/dsearch.php?query=${q}`,
  ];
  const texts = await Promise.all(
    pages.map(async (url) => {
      try {
        return await Promise.race([
          fetchText(url, 6500),
          new Promise((_, reject) => setTimeout(() => reject(new Error("시간 초과")), 7000)),
        ]);
      } catch (error) {
        return "";
      }
    })
  );
  return parseSearchHits(texts.join("\n"), query);
}

async function visitShop(url, query) {
  try {
    const html = await Promise.race([
      fetchText(url, 5500),
      new Promise((_, reject) => setTimeout(() => reject(new Error("시간 초과")), 6000)),
    ]);
    const price = pickProductPrice(html);
    const heading = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || html.match(/^#\s+(.+)$/m) || [])[1];
    const seller = sellerFromHit(heading || hostLabel(url), url, query);
    if (!price || !seller || isBannedSeller(seller)) {
      return null;
    }
    if (!isRelevant(`${heading || ""} ${url} ${html.slice(0, 4000)}`, query)) {
      return null;
    }
    return toOffer(seller, price, url, heading);
  } catch (error) {
    return null;
  }
}

function parseDaangn(text, fallbackUrl, query) {
  const offers = [];

  const add = (title, price, url, region) => {
    const name = visibleLabel(title, "");
    if (!name || !price || /거래완료/.test(title)) {
      return;
    }
    if (!isRelevant(`${name} ${title}`, query)) {
      return;
    }
    offers.push({
      title: name,
      seller: visibleLabel(region, "당근"),
      price,
      url: url || fallbackUrl,
      source: "당근",
      trust: { stars: 3, note: "중고 개인거래", https: true },
    });
  };

  const md = /\[([^\]]{2,80})\]\((https?:\/\/(?:www\.)?daangn\.com\/[^)]+)\)/g;
  let match;
  while ((match = md.exec(text))) {
    if (match.index > 0 && text[match.index - 1] === "!") {
      continue;
    }
    const around = text.slice(match.index, match.index + 280);
    add(match[1], pickProductPrice(around), match[2], around);
  }

  const regex = /([0-9]{1,3}(?:,[0-9]{3})+)\s*원/g;
  while ((match = regex.exec(text))) {
    const price = parseWon(match[1]);
    const chunk = text.slice(Math.max(0, match.index - 220), match.index + 160);
    const title = visibleLabel(chunk, "");
    const region = (chunk.match(/([가-힣]{1,8}동|[가-힣]{2,8}구)/) || [])[1];
    const link = chunk.match(/https?:\/\/(?:www\.)?daangn\.com\/[^\s)\]"']+/);
    add(title, price, link && link[0], region);
  }

  return uniqueBySeller(offers).sort((a, b) => a.price - b.price).slice(0, RANK_LIMIT);
}

async function searchDaangn(query) {
  const term = primarySearchTerm(query);
  const url = `https://www.daangn.com/kr/buy-sell/?search=${encodeURIComponent(term)}`;
  try {
    const text = await Promise.race([
      fetchText(url, 5500),
      new Promise((_, reject) => setTimeout(() => reject(new Error("시간 초과")), 6000)),
    ]);
    return { name: "당근", status: "ok", offers: parseDaangn(text, url, query), official: url };
  } catch (error) {
    return { name: "당근", status: "error", offers: [], official: url, error: error.message || "실패" };
  }
}

async function searchProduct(query) {
  const q = String(query || "").trim();
  if (!q) {
    throw new Error("상품명을 입력하세요");
  }

  const [hits, daangn] = await Promise.all([searchWeb(q), searchDaangn(q)]);
  const fromSearch = hits
    .filter((hit) => hit.price && hit.seller && isRelevant(`${hit.title} ${hit.snippet} ${hit.url}`, q))
    .map((hit) => toOffer(hit.seller, hit.price, hit.url, hit.title));

  let visited = [];
  if (fromSearch.length < RANK_LIMIT) {
    const have = new Set(fromSearch.map((item) => item.url));
    const extra = hits
      .filter((hit) => isRelevant(`${hit.title} ${hit.snippet} ${hit.url}`, q))
      .map((hit) => hit.url)
      .filter((url, index, list) => list.indexOf(url) === index && !have.has(url) && shopScore(url) > 0)
      .sort((a, b) => shopScore(b) - shopScore(a))
      .slice(0, VISIT_LIMIT);
    visited = (await Promise.all(extra.map((url) => visitShop(url, q)))).filter(Boolean);
  }

  const shopOffers = rankOffers(fromSearch.concat(visited));

  return {
    query: q,
    searchedAt: new Date().toISOString(),
    shops: shopOffers,
    used: daangn.offers,
    suggested: suggestedOffer(shopOffers),
    sources: [
      { name: "인터넷 검색", status: hits.length ? "ok" : "partial", error: hits.length ? "" : "판매 페이지를 찾지 못함" },
      { name: "판매 페이지", status: shopOffers.length ? "ok" : "partial", error: shopOffers.length ? "" : "가격을 읽지 못함" },
      { name: "당근", status: daangn.status, error: daangn.error || "" },
    ],
    official: { daangn: daangn.official },
  };
}

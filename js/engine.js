const RANK_LIMIT = 5;
const SIMILAR_PRICE_RATIO = 1.08;
const DISCOVER_LIMIT = 12;

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

function parseWon(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
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
    const href = String(value || "")
      .replace(/&amp;/g, "&")
      .replace(/[),.\]]+$/, "");
    const url = new URL(href);
    if (url.hostname.includes("search.naver.com")) {
      const nested = url.searchParams.get("url") || url.searchParams.get("u");
      if (nested) {
        return cleanUrl(nested);
      }
    }
    url.hash = "";
    return url.toString();
  } catch (error) {
    return "";
  }
}

function isIgnoredHost(host) {
  return /google|youtube|facebook|instagram|namu\.wiki|wikipedia|daangn|karrot|danawa|enuri|coupang\.com$|blog\.naver|cafe\.naver|shopping\.naver\.com$|search\.|bing\.com|duckduckgo/i.test(host);
}

function looksLikeShop(url) {
  const host = hostnameOf(url);
  if (!host || isIgnoredHost(host)) {
    return false;
  }
  if (/(smartstore|brand)\.naver\.com/i.test(host)) {
    return true;
  }
  return /\/(product|products|goods|goods_view|item|shop|catalog)\b/i.test(url);
}

function extractUrls(text) {
  const found = [];
  const regex = /https?:\/\/[^\s)\]"'<>]+/gi;
  let match;
  while ((match = regex.exec(text))) {
    const url = cleanUrl(match[0]);
    if (url && looksLikeShop(url)) {
      found.push(url);
    }
  }
  return [...new Set(found)];
}

function visibleLabel(value, fallback) {
  const text = decodeHtml(value)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length < 2 || text.length > 40) {
    return fallback;
  }
  if (/image|img|다나와|에누리|검색/i.test(text)) {
    return fallback;
  }
  return text;
}

function sellerFromPage(html, url) {
  const site = html.match(/property="og:site_name"[^>]+content="([^"]+)"/i) ||
    html.match(/content="([^"]+)"[^>]+property="og:site_name"/i);
  if (site && visibleLabel(site[1], "")) {
    return visibleLabel(site[1], "");
  }
  const host = hostnameOf(url).replace(/\.co\.kr$|\.com$|\.net$/, "");
  if (host.includes("smartstore") || host.includes("brand.naver")) {
    const store = url.match(/smartstore\.naver\.com\/([^/?#]+)/i) || url.match(/brand\.naver\.com\/([^/?#]+)/i);
    return store ? store[1] : "네이버스토어";
  }
  return host || "판매처";
}

function parseShopPrice(html) {
  const patterns = [
    /ec-data-price="(\d+)"/i,
    /set_goods_price["'\s:=]+(\d+)/i,
    /set_total_price["'\s:=]+(\d+)/i,
    /id="span_product_price_text"[^>]*>([0-9,]+)/i,
    /itemprop="price"\s+content="(\d+)"/i,
    /property="product:price:amount"[^>]+content="(\d+)/i,
    /"price"\s*:\s*"?(\d{5,})"?/,
    /class="[^"]*price[^"]*"[^>]*>([0-9,]{5,})/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const price = parseWon(match && match[1]);
    if (price) {
      return price;
    }
  }
  return 0;
}

function trustFor(url, seller) {
  const host = hostnameOf(url);
  let stars = 3;
  let note = "인터넷에서 찾은 판매처";
  if (/(smartstore|brand)\.naver\.com/i.test(host)) {
    stars = 3.5;
    note = "네이버 스마트스토어";
  }
  if (/공식|official|nike\.com|나이키/i.test(`${seller} ${host}`)) {
    stars = 4.5;
    note = "브랜드·공식 가능성이 큼";
  }
  if (url.startsWith("http://")) {
    stars = Math.min(stars, 2);
    note = "보안 연결(HTTPS)이 아님";
  }
  return { stars, note, https: url.startsWith("https://") };
}

function uniqueBySeller(offers) {
  const unique = new Map();
  offers.forEach((item) => {
    const key = `${String(item.seller || "").toLowerCase().replace(/\s+/g, "")}|${hostnameOf(item.url)}`;
    const current = unique.get(key);
    if (!current || item.price < current.price) {
      unique.set(key, item);
    }
  });
  return [...unique.values()];
}

function saneShopOffers(offers) {
  const valid = offers.filter((item) => item && item.price >= 10000 && item.seller);
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

async function fetchText(url) {
  const encoded = encodeURIComponent(url);
  const candidates = [`https://r.jina.ai/${url}`, `https://api.allorigins.win/raw?url=${encoded}`];
  return Promise.any(
    candidates.map(async (target) => {
      const response = await fetchWithTimeout(target, 4500);
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      const text = await response.text();
      if (!text || text.length < 80) {
        throw new Error("empty");
      }
      return text;
    })
  );
}

async function searchWeb(query) {
  const q1 = encodeURIComponent(`${query} 판매`);
  const q2 = encodeURIComponent(`${query} 가격`);
  const pages = [
    `https://search.naver.com/search.naver?query=${q1}`,
    `https://html.duckduckgo.com/html/?q=${q1}`,
    `https://www.bing.com/search?q=${q2}`,
  ];
  const texts = await Promise.all(
    pages.map(async (url) => {
      try {
        return await Promise.race([
          fetchText(url),
          new Promise((_, reject) => setTimeout(() => reject(new Error("시간 초과")), 5500)),
        ]);
      } catch (error) {
        return "";
      }
    })
  );
  return extractUrls(texts.join("\n")).slice(0, DISCOVER_LIMIT);
}

async function visitShop(url) {
  try {
    const html = await Promise.race([
      fetchText(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("시간 초과")), 5000)),
    ]);
    const price = parseShopPrice(html);
    const seller = sellerFromPage(html, url);
    if (!price || !seller) {
      return null;
    }
    return {
      title: seller,
      seller,
      price,
      url,
      source: hostnameOf(url),
      trust: trustFor(url, seller),
    };
  } catch (error) {
    return null;
  }
}

function parseDaangn(text, fallbackUrl) {
  const offers = [];
  const regex = /([0-9]{1,3}(?:,[0-9]{3})+)\s*원/g;
  let match;
  while ((match = regex.exec(text))) {
    const price = parseWon(match[1]);
    if (!price) {
      continue;
    }
    const chunk = text.slice(Math.max(0, match.index - 220), match.index);
    if (/거래완료/.test(chunk)) {
      continue;
    }
    const title = visibleLabel(chunk, "");
    if (!title) {
      continue;
    }
    const after = text.slice(match.index, match.index + 160);
    const region = visibleLabel((after.match(/([가-힣]{1,8}동|[가-힣]{2,8}구)/) || [])[1], "당근");
    const link = (chunk + after).match(/https?:\/\/(?:www\.)?daangn\.com\/[^\s)\]"']+/);
    offers.push({
      title,
      seller: region,
      price,
      url: (link && link[0]) || fallbackUrl,
      source: "당근",
      trust: { stars: 3, note: "중고 개인거래", https: true },
    });
  }
  return uniqueBySeller(offers).sort((a, b) => a.price - b.price).slice(0, RANK_LIMIT);
}

async function searchDaangn(query) {
  const url = `https://www.daangn.com/kr/buy-sell/?search=${encodeURIComponent(query)}`;
  try {
    const text = await Promise.race([
      fetchText(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("시간 초과")), 5500)),
    ]);
    return { name: "인터넷·당근", status: "ok", offers: parseDaangn(text, url), official: url };
  } catch (error) {
    return { name: "당근", status: "error", offers: [], official: url, error: error.message || "실패" };
  }
}

async function searchProduct(query) {
  const q = String(query || "").trim();
  if (!q) {
    throw new Error("상품명을 입력하세요");
  }

  const [foundUrls, daangn] = await Promise.all([searchWeb(q), searchDaangn(q)]);
  const visited = await Promise.all(foundUrls.map((url) => visitShop(url)));
  const shopOffers = rankOffers(visited.filter(Boolean));

  return {
    query: q,
    searchedAt: new Date().toISOString(),
    shops: shopOffers,
    used: daangn.offers,
    suggested: suggestedOffer(shopOffers),
    sources: [
      { name: "인터넷 검색", status: foundUrls.length ? "ok" : "partial", error: foundUrls.length ? "" : "판매 페이지를 찾지 못함" },
      { name: "판매 페이지", status: shopOffers.length ? "ok" : "partial", error: shopOffers.length ? "" : "가격을 읽지 못함" },
      { name: "당근", status: daangn.status, error: daangn.error || "" },
    ],
    official: { daangn: daangn.official },
  };
}

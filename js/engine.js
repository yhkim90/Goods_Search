const RANK_LIMIT = 5;
const SIMILAR_PRICE_RATIO = 1.08;

const ENGINE_BASE = (() => {
  const path = location.pathname;
  if (path === "/Goods_Search" || path.startsWith("/Goods_Search/")) {
    return "/Goods_Search/";
  }
  return "./";
})();

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

function normalizeKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\s\-_\/]/g, "");
}

function parseWon(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) {
    return 0;
  }
  const price = Number(digits);
  return price >= 10000 && price <= 200000000 ? price : 0;
}

function visibleLabel(value, fallback) {
  const text = decodeHtml(value);
  if (!text || text.length < 2 || text.length > 48) {
    return fallback;
  }
  if (/https?:\/\//i.test(text) || /image|img|다나와|에누리/i.test(text)) {
    return fallback;
  }
  return text;
}

function matchProduct(products, query) {
  const needle = normalizeKey(query);
  let best = null;
  let bestScore = 0;
  (products || []).forEach((product) => {
    const names = [product.id, product.name, ...(product.aliases || [])].map(normalizeKey);
    names.forEach((name) => {
      let score = 0;
      if (name === needle) {
        score = 100 + name.length;
      } else if (name.length >= 6 && needle.includes(name)) {
        score = name.length;
      }
      if (score > bestScore) {
        bestScore = score;
        best = product;
      }
    });
  });
  return best;
}

function shopTrust(shop, seller) {
  if (seller && seller.stars != null) {
    return {
      stars: seller.stars,
      note: (seller.reasons || []).slice(0, 2).join(" · ") || "등록된 판매처",
      https: Boolean(seller.https),
    };
  }
  let stars = shop.https === false || String(shop.searchUrl || Object.values(shop.products || {})[0] || "").startsWith("http://") ? 2 : 3.5;
  const blob = `${shop.name} ${shop.id}`;
  if (/공식|스파코리아/.test(blob)) {
    stars = 5;
  }
  return {
    stars,
    note: stars >= 5 ? "공식·수입사" : "개별 쇼핑몰",
    https: stars >= 3,
  };
}

function uniqueBySeller(offers) {
  const unique = new Map();
  offers.forEach((item) => {
    const key = String(item.seller || "")
      .toLowerCase()
      .replace(/\s+/g, "");
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
  const floor = max >= 500000 ? Math.max(100000, Math.round(max * 0.15)) : 10000;
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
  const pick = similar.slice().sort((a, b) => {
    const gap = (b.trust?.stars || 0) - (a.trust?.stars || 0);
    return gap !== 0 ? gap : a.price - b.price;
  })[0];
  if (!pick || pick.url === cheapest.url) {
    return null;
  }
  return pick;
}

function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { cache: "no-store", signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchText(url) {
  const encoded = encodeURIComponent(url);
  const candidates = [
    `https://r.jina.ai/${url}`,
    `https://api.allorigins.win/raw?url=${encoded}`,
  ];
  const attempts = candidates.map(async (target) => {
    const response = await fetchWithTimeout(target, 4500);
    if (!response.ok) {
      throw new Error(String(response.status));
    }
    const text = await response.text();
    if (!text || text.length < 80) {
      throw new Error("empty");
    }
    return text;
  });
  return Promise.any(attempts);
}

async function loadEngineJson(name) {
  const response = await fetch(`${ENGINE_BASE}data/${name}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${name} ${response.status}`);
  }
  return response.json();
}

function parseShopPrice(html) {
  const patterns = [
    /ec-data-price="(\d+)"/i,
    /set_goods_price["'\s:=]+(\d+)/i,
    /set_total_price["'\s:=]+(\d+)/i,
    /id="span_product_price_text"[^>]*>([0-9,]+)/i,
    /class="[^"]*product_price[^"]*"[^>]*>([0-9,]+)/i,
    /itemprop="price"\s+content="(\d+)"/i,
    /"price"\s*:\s*"?(\d{5,})"?/,
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

function parseShopTitle(html, fallback) {
  const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
  if (og) {
    return decodeHtml(og[1].split(/[|\-–]/)[0]);
  }
  const title = html.match(/<title>([^<]+)<\/title>/i);
  if (title) {
    return decodeHtml(title[1].split(/[|\-–]/)[0]);
  }
  return fallback;
}

function storedOffer(shop, product, priceItems, sellerMap) {
  const rows = (priceItems || []).filter((item) => {
    if (item.sellerId !== shop.id) {
      return false;
    }
    return !product || item.productId === product.id;
  });
  if (!rows.length) {
    return null;
  }
  const best = rows.slice().sort((a, b) => a.price - b.price)[0];
  return {
    title: best.title,
    seller: shop.name,
    price: best.price,
    url: best.url,
    source: shop.name,
    trust: shopTrust(shop, sellerMap[shop.id]),
  };
}

async function visitShop(shop, query, product, priceItems, sellerMap) {
  const url = (product && shop.products && shop.products[product.id]) ||
    (shop.searchUrl ? shop.searchUrl.replace("{q}", encodeURIComponent(query)) : "");
  const fallback = storedOffer(shop, product, priceItems, sellerMap);
  if (!url) {
    return { name: shop.name, status: fallback ? "ok" : "skipped", offers: fallback ? [fallback] : [] };
  }
  try {
    const html = await Promise.race([
      fetchText(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("시간 초과")), 5500)),
    ]);
    const price = parseShopPrice(html);
    const title = parseShopTitle(html, product ? product.name : query);
    if (price) {
      const offer = {
        title,
        seller: shop.name,
        price,
        url,
        source: shop.name,
        trust: shopTrust(shop, sellerMap[shop.id]),
      };
      return { name: shop.name, status: "ok", offers: [offer] };
    }
    if (fallback) {
      return { name: shop.name, status: "partial", offers: [fallback], error: "페이지 가격 없음, 저장분 사용" };
    }
    return { name: shop.name, status: "partial", offers: [], error: "가격 없음" };
  } catch (error) {
    if (fallback) {
      return { name: shop.name, status: "partial", offers: [fallback], error: "현장 조회 실패, 저장분 사용" };
    }
    return { name: shop.name, status: "error", offers: [], error: error.message || "실패" };
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
    const start = Math.max(0, match.index - 220);
    const chunk = text.slice(start, match.index);
    if (/거래완료/.test(chunk)) {
      continue;
    }
    const title = visibleLabel(
      chunk
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/[-*#|]+/g, " "),
      ""
    );
    if (!title) {
      continue;
    }
    const after = text.slice(match.index, match.index + 180);
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
    const offers = parseDaangn(text, url);
    return { name: "당근", status: offers.length ? "ok" : "partial", offers, official: url };
  } catch (error) {
    return { name: "당근", status: "error", offers: [], official: url, error: error.message || "실패" };
  }
}

async function searchProduct(query) {
  const q = String(query || "").trim();
  if (!q) {
    throw new Error("상품명을 입력하세요");
  }

  const [shopsDoc, productsDoc, sellersDoc, pricesDoc] = await Promise.all([
    loadEngineJson("shops.json"),
    loadEngineJson("products.json").catch(() => ({ products: [] })),
    loadEngineJson("sellers.json").catch(() => ({ items: [] })),
    loadEngineJson("prices.json").catch(() => ({ items: [] })),
  ]);

  const product = matchProduct(productsDoc.products, q);
  const shops = shopsDoc.items || [];
  const sellerMap = Object.fromEntries((sellersDoc.items || []).map((item) => [item.id, item]));

  const [shopResults, daangn] = await Promise.all([
    Promise.all(shops.map((shop) => visitShop(shop, q, product, pricesDoc.items || [], sellerMap))),
    searchDaangn(q),
  ]);

  const shopOffers = rankOffers(shopResults.flatMap((item) => item.offers));
  return {
    query: q,
    searchedAt: new Date().toISOString(),
    shops: shopOffers,
    used: daangn.offers,
    suggested: suggestedOffer(shopOffers),
    sources: [...shopResults, daangn].map((item) => ({
      name: item.name,
      status: item.status,
      error: item.error || "",
    })),
    official: {
      daangn: daangn.official,
    },
  };
}

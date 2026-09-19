const RANK_LIMIT = 5;
const SIMILAR_PRICE_RATIO = 1.08;

const KNOWN_MALLS = [
  { test: /smartstore|brand\.naver|shopping\.naver|네이버/, name: "네이버", score: 4.0, note: "대형 오픈마켓" },
  { test: /coupang|쿠팡/, name: "쿠팡", score: 3.8, note: "대형 오픈마켓" },
  { test: /11st|11번가/, name: "11번가", score: 3.7, note: "대형 오픈마켓" },
  { test: /gmarket|g마켓/, name: "G마켓", score: 3.6, note: "대형 오픈마켓" },
  { test: /auction|옥션/, name: "옥션", score: 3.6, note: "대형 오픈마켓" },
  { test: /ssg\.com|신세계/, name: "SSG", score: 3.7, note: "대형 유통" },
  { test: /lotteon|롯데온/, name: "롯데온", score: 3.6, note: "대형 유통" },
  { test: /wemakeprice|위메프/, name: "위메프", score: 3.3, note: "오픈마켓" },
  { test: /tmon|티몬/, name: "티몬", score: 3.2, note: "오픈마켓" },
  { test: /danawa|다나와/, name: "다나와", score: 3.5, note: "가격비교" },
  { test: /enuri|에누리/, name: "에누리", score: 3.5, note: "가격비교" },
  { test: /daangn|당근/, name: "당근", score: 3.2, note: "중고 개인거래" },
];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function parseWon(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) {
    return 0;
  }
  const price = Number(digits);
  return price >= 1000 && price <= 200000000 ? price : 0;
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

function hostnameOf(url) {
  try {
    return new URL(url, "https://example.com").hostname.replace(/^www\./, "");
  } catch (error) {
    return "";
  }
}

function matchesQuery(title, query) {
  const hay = String(title || "")
    .toLowerCase()
    .replace(/[\s\-_\/]/g, "");
  const tokens = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[\s\-_\/]/g, ""))
    .filter((token) => token.length >= 2);
  if (!tokens.length) {
    return hay.includes(String(query || "").toLowerCase().replace(/[\s\-_\/]/g, ""));
  }
  return tokens.every((token) => hay.includes(token));
}

function trustFor(offer) {
  const url = offer.url || "";
  const host = hostnameOf(url);
  const blob = `${offer.seller || ""} ${host} ${url}`;
  let score = 2.4;
  let note = "일반 판매처";
  const known = KNOWN_MALLS.find((item) => item.test.test(blob));
  if (known) {
    score = known.score;
    note = known.note;
  }
  if (/공식|official|imported|수입사/.test(blob)) {
    score += 0.7;
    note = "공식·수입사 가능성이 큼";
  }
  if (url.startsWith("https://")) {
    score += 0.2;
  }
  if (url.startsWith("http://")) {
    score -= 1.1;
    note = "보안 연결(HTTPS)이 아님";
  }
  if (!url) {
    score -= 0.4;
    note = "판매처 주소가 불명확함";
  }
  score = Math.max(1, Math.min(5, Math.round(score * 2) / 2));
  return {
    stars: score,
    note,
    https: url.startsWith("https://"),
  };
}

function withTrust(offer) {
  const trust = trustFor(offer);
  return { ...offer, trust };
}

function uniqueBySeller(offers) {
  const unique = new Map();
  offers.forEach((item) => {
    const key = String(item.seller || hostnameOf(item.url) || item.title)
      .toLowerCase()
      .replace(/\s+/g, "");
    const current = unique.get(key);
    if (!current || item.price < current.price) {
      unique.set(key, item);
    }
  });
  return [...unique.values()];
}

function rankOffers(offers, query) {
  return uniqueBySeller(
    offers.filter((item) => item.price > 0 && matchesQuery(item.title || item.seller, query))
  )
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

async function fetchText(url) {
  const encoded = encodeURIComponent(url);
  const candidates = [
    url,
    `https://r.jina.ai/${url}`,
    `https://api.allorigins.win/raw?url=${encoded}`,
    `https://corsproxy.io/?${encoded}`,
  ];
  let lastError = "연결 실패";
  for (const target of candidates) {
    try {
      const response = await fetch(target, { cache: "no-store" });
      if (!response.ok) {
        lastError = `${response.status}`;
        continue;
      }
      const text = await response.text();
      if (text && text.length > 80) {
        return text;
      }
    } catch (error) {
      lastError = error.message || lastError;
    }
  }
  throw new Error(lastError);
}

function pushOffer(list, offer) {
  if (!offer || !offer.price) {
    return;
  }
  list.push({
    title: decodeHtml(offer.title || offer.seller || ""),
    seller: decodeHtml(offer.seller || offer.title || "판매처"),
    price: offer.price,
    url: offer.url || "",
    source: offer.source,
  });
}

function offersFromPriceContext(text, source, defaultUrl) {
  const offers = [];
  const regex = /([0-9]{1,3}(?:,[0-9]{3})+)\s*원/g;
  let match;
  while ((match = regex.exec(text))) {
    const start = Math.max(0, match.index - 220);
    const chunk = text.slice(start, match.index + match[0].length);
    if (/거래완료|sold/i.test(chunk)) {
      continue;
    }
    const href = (chunk.match(/href="(https?:\/\/[^"]+)"/i) || chunk.match(/\((https?:\/\/[^)]+)\)/))?.[1];
    const title = decodeHtml(
      (chunk.match(/title="([^"]+)"/i) || [])[1] ||
        (chunk.match(/>([가-힣A-Za-z0-9][^<]{4,80})</) || [])[1] ||
        (chunk.match(/[-*]\s+(.+?)\s+[0-9]/) || [])[1] ||
        ""
    );
    const seller = decodeHtml(
      (chunk.match(/mall[^>]*>([^<]+)/i) || chunk.match(/판매처[^<]*>([^<]+)/) || [])[1] || title
    );
    pushOffer(offers, {
      title: title || seller,
      seller: seller || title || source,
      price: parseWon(match[1]),
      url: href || defaultUrl,
      source,
    });
  }
  return offers;
}

function parseDanawa(html, fallbackUrl) {
  const offers = [];
  const blocks = html.split(/prod_item|prod_main_info|product-item/i);
  blocks.forEach((block) => {
    const href = (block.match(/href="(https?:\/\/prod\.danawa\.com\/info\/[^"]+)"/i) ||
      block.match(/href="(\/\/prod\.danawa\.com\/info\/[^"]+)"/i) ||
      [])[1];
    const title = decodeHtml((block.match(/prod_name[\s\S]{0,300}?<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || "");
    const price = parseWon((block.match(/<strong>\s*([0-9,]+)\s*<\/strong>/i) || [])[1] || "");
    const seller = decodeHtml((block.match(/mall_name[^>]*>([^<]+)/i) || block.match(/over_link[^>]*>([^<]+)/i) || [])[1] || "다나와");
    if (href || price) {
      pushOffer(offers, {
        title,
        seller,
        price,
        url: href ? (href.startsWith("//") ? `https:${href}` : href) : fallbackUrl,
        source: "다나와",
      });
    }
  });
  return offers.length ? offers : offersFromPriceContext(html, "다나와", fallbackUrl);
}

function parseEnuri(html, fallbackUrl) {
  const offers = [];
  const blocks = html.split(/class="[^"]*goods[^"]*"/i);
  blocks.forEach((block) => {
    const href = (block.match(/href="(https?:\/\/[^"]*enuri[^"]+)"/i) || [])[1];
    const title = decodeHtml((block.match(/class="name"[^>]*>([\s\S]*?)<\/[ap]/i) || [])[1] || "");
    const price = parseWon((block.match(/([0-9]{1,3}(?:,[0-9]{3})+)\s*원/) || [])[1] || "");
    const seller = decodeHtml((block.match(/mall[^>]*>([^<]+)/i) || [])[1] || "에누리");
    pushOffer(offers, {
      title,
      seller,
      price,
      url: href || fallbackUrl,
      source: "에누리",
    });
  });
  return offers.length ? offers : offersFromPriceContext(html, "에누리", fallbackUrl);
}

function parseNaver(html, fallbackUrl) {
  const offers = [];
  const jsonBlocks = html.match(/mallName"\s*:\s*"([^"]+)"[\s\S]{0,240}?"price"\s*:\s*"?([0-9]+)"?/g) || [];
  jsonBlocks.forEach((block) => {
    const seller = decodeHtml((block.match(/mallName"\s*:\s*"([^"]+)"/) || [])[1] || "네이버");
    const price = parseWon((block.match(/price"\s*:\s*"?([0-9]+)/) || [])[1] || "");
    const title = decodeHtml((block.match(/productTitle"\s*:\s*"([^"]+)"/) || [])[1] || seller);
    const url = (block.match(/mallPcUrl"\s*:\s*"([^"]+)"/) || block.match(/crUrl"\s*:\s*"([^"]+)"/) || [])[1] || fallbackUrl;
    pushOffer(offers, { title, seller, price, url, source: "네이버쇼핑" });
  });
  return offers.length ? offers : offersFromPriceContext(html, "네이버쇼핑", fallbackUrl);
}

function parseDaangn(text, fallbackUrl) {
  const offers = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/거래완료/.test(line)) {
      continue;
    }
    const markdown = line.match(/[-*]\s+(.+?)\s+([0-9]{1,3}(?:,[0-9]{3})+)\s*원/);
    if (markdown) {
      const region = decodeHtml((lines[index + 1] || "").replace(/[·\s]+$/, ""));
      pushOffer(offers, {
        title: markdown[1],
        seller: region && !/거래/.test(region) ? `당근 · ${region}` : "당근",
        price: parseWon(markdown[2]),
        url: fallbackUrl,
        source: "당근",
      });
    }
  }
  const htmlCards = text.matchAll(/href="([^"]*(?:articles|buy-sell)[^"]*)"[\s\S]{0,400}?([0-9]{1,3}(?:,[0-9]{3})+)\s*원/gi);
  for (const card of htmlCards) {
    const chunk = card[0];
    if (/거래완료/.test(chunk)) {
      continue;
    }
    pushOffer(offers, {
      title: decodeHtml((chunk.match(/>([가-힣A-Za-z0-9][^<]{4,80})</) || [])[1] || "당근 매물"),
      seller: "당근",
      price: parseWon(card[2]),
      url: card[1].startsWith("http") ? card[1] : `https://www.daangn.com${card[1]}`,
      source: "당근",
    });
  }
  return uniqueBySeller(offers).sort((a, b) => a.price - b.price).slice(0, RANK_LIMIT);
}

async function searchSource(name, url, parser) {
  try {
    const text = await fetchText(url);
    const offers = parser(text, url).map(withTrust);
    return { name, status: offers.length ? "ok" : "partial", offers, error: offers.length ? "" : "가격을 읽지 못함" };
  } catch (error) {
    return { name, status: "error", offers: [], error: error.message || "실패" };
  }
}

async function searchProduct(query) {
  const q = String(query || "").trim();
  if (!q) {
    throw new Error("상품명을 입력하세요");
  }
  const encoded = encodeURIComponent(q);
  const danawaUrl = `https://search.danawa.com/dsearch.php?query=${encoded}`;
  const enuriUrl = `https://www.enuri.com/search.jsp?keyword=${encoded}`;
  const naverUrl = `https://search.shopping.naver.com/search/all?query=${encoded}&sort=price_asc`;
  const daangnUrl = `https://www.daangn.com/kr/buy-sell/?search=${encoded}`;

  const [danawa, enuri, naver, daangn] = await Promise.all([
    searchSource("다나와", danawaUrl, parseDanawa),
    searchSource("에누리", enuriUrl, parseEnuri),
    searchSource("네이버쇼핑", naverUrl, parseNaver),
    searchSource("당근", daangnUrl, parseDaangn),
  ]);

  const shopOffers = rankOffers(
    [...danawa.offers, ...enuri.offers, ...naver.offers].filter((item) => item.source !== "당근"),
    q
  );
  const usedOffers = daangn.offers.filter((item) => matchesQuery(item.title, q) || item.source === "당근").slice(0, RANK_LIMIT);

  return {
    query: q,
    searchedAt: new Date().toISOString(),
    shops: shopOffers,
    used: usedOffers,
    suggested: suggestedOffer(shopOffers),
    sources: [danawa, enuri, naver, daangn].map((item) => ({
      name: item.name,
      status: item.status,
      error: item.error,
    })),
    official: {
      naver: naverUrl,
      danawa: danawaUrl,
      daangn: daangnUrl,
    },
  };
}

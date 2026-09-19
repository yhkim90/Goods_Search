const BASE = (() => {
  const path = location.pathname;
  if (path === "/Goods_Search" || path.startsWith("/Goods_Search/")) {
    return "/Goods_Search/";
  }
  return "./";
})();

const PRODUCT_ORDER = ["sp-800a", "sp-800"];
const PRICE_RANK_LIMIT = 5;
const SIMILAR_PRICE_RATIO = 1.08;
const QUERY_KEY = "sp-watch-query";

let lastData = null;

function productRank(productId) {
  const index = PRODUCT_ORDER.indexOf(productId);
  return index === -1 ? PRODUCT_ORDER.length : index;
}

const STATUS_LABEL = {
  ok: "정상",
  partial: "일부",
  skipped: "제외",
  error: "오류",
};

async function loadJson(name) {
  const stamp = Date.now();
  const response = await fetch(`${BASE}data/${name}?t=${stamp}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${name} ${response.status}`);
  }
  return response.json();
}

async function clearDataCache() {
  if (!("caches" in window)) {
    return;
  }
  const keys = await caches.keys();
  await Promise.all(
    keys.map(async (key) => {
      const cache = await caches.open(key);
      const requests = await cache.keys();
      await Promise.all(
        requests
          .filter((request) => request.url.includes("/data/"))
          .map((request) => cache.delete(request))
      );
    })
  );
}

function setRefreshState(busy, note) {
  const button = document.getElementById("refresh-btn");
  const noteEl = document.getElementById("refresh-note");
  if (button) {
    button.disabled = busy;
    button.textContent = busy ? "갱신 중" : "새로고침";
  }
  if (noteEl) {
    noteEl.textContent = note || "";
  }
}

function won(value) {
  return `${Number(value).toLocaleString("ko-KR")}원`;
}

function parseTime(value) {
  if (!value) return null;
  return new Date(value);
}

function formatCheck(value) {
  const date = parseTime(value);
  if (!date || Number.isNaN(date.getTime())) return "-";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatStatusTime(value) {
  const date = parseTime(value);
  if (!date || Number.isNaN(date.getTime())) return "-";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}.${m}.${d}\n${hh}:${mm}`;
}

function relativeTime(value) {
  const date = parseTime(value);
  if (!date || Number.isNaN(date.getTime())) return "";
  const diff = Math.max(0, Date.now() - date.getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  return `${Math.floor(hour / 24)}일 전`;
}

function readQuery() {
  const input = document.getElementById("product-query");
  return ((input && input.value) || "").trim();
}

function normalizeKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\s\-_\/]/g, "");
}

function productMatches(product, query) {
  if (!query) {
    return true;
  }
  const needle = normalizeKey(query);
  return [product.id, product.name, ...(product.aliases || [])].some((part) => {
    const hay = normalizeKey(part);
    return hay.includes(needle) || needle.includes(hay);
  });
}

function visibleProducts(productMap, query) {
  return Object.values(productMap)
    .sort((a, b) => productRank(a.id) - productRank(b.id))
    .filter((item) => productMatches(item, query));
}

function daangnUrl(keyword) {
  return `https://www.daangn.com/kr/buy-sell/?search=${encodeURIComponent(keyword)}`;
}

function daangnHtml(keywords) {
  const unique = [...new Set(keywords.filter(Boolean))];
  if (!unique.length) {
    return "";
  }
  const buttons = unique
    .map((word) => `<a class="btn" href="${daangnUrl(word)}" target="_blank" rel="noopener">${word} 검색</a>`)
    .join("");
  return `
    <section class="card daangn-card">
      <div class="card-kicker">당근</div>
      <h2>중고 매물은 당근 알림으로</h2>
      <p class="muted">자동 수집은 하지 않습니다. 당근 키워드 알림에 상품명을 등록하세요.</p>
      <div class="actions">${buttons}</div>
    </section>
  `;
}

function rankedByProduct(prices, productId, sellerMap) {
  const unique = new Map();
  prices
    .filter((item) => item.productId === productId)
    .forEach((item) => {
      const current = unique.get(item.sellerId);
      if (!current || item.price < current.price) {
        unique.set(item.sellerId, item);
      }
    });
  return [...unique.values()]
    .sort((a, b) => {
      if (a.price !== b.price) {
        return a.price - b.price;
      }
      return (sellerMap[b.sellerId]?.stars || 0) - (sellerMap[a.sellerId]?.stars || 0);
    })
    .slice(0, PRICE_RANK_LIMIT);
}

function suggestedOffer(ranked, sellerMap) {
  if (!ranked.length) {
    return null;
  }
  const cheapest = ranked[0];
  const similar = ranked.filter((item) => item.price <= cheapest.price * SIMILAR_PRICE_RATIO);
  const pick = similar.slice().sort((a, b) => {
    const starGap = (sellerMap[b.sellerId]?.stars || 0) - (sellerMap[a.sellerId]?.stars || 0);
    if (starGap !== 0) {
      return starGap;
    }
    return a.price - b.price;
  })[0];
  if (!pick || pick.id === cheapest.id) {
    return null;
  }
  return pick;
}

function discountRate(officialPrice, price) {
  if (!officialPrice || price >= officialPrice) return 0;
  return Math.round(((officialPrice - price) / officialPrice) * 1000) / 10;
}

function starsHtml(stars) {
  if (stars == null) return "";
  const pct = Math.max(0, Math.min(100, (Number(stars) / 5) * 100));
  return `
    <div class="trust" aria-label="신뢰도 ${stars} / 5">
      <span class="stars" style="--pct:${pct}%">★★★★★</span>
      <span class="trust-score">${stars}</span>
    </div>
  `;
}

function bizHtml(trust) {
  const biz = trust && trust.biz;
  if (!biz || !biz.number) {
    return "";
  }
  const tone = biz.ntsCode === "03" || biz.checksumValid === false ? "biz-bad" : biz.ntsCode === "01" ? "biz-ok" : "";
  return `<a class="biz ${tone}" href="${biz.lookupUrl}" target="_blank" rel="noopener">${biz.number} · ${biz.ntsLabel}</a>`;
}

function consumerHtml(trust) {
  const info = trust && trust.consumer;
  if (!info || !info.label) {
    return "";
  }
  const tone = info.warningCount ? "biz-bad" : "";
  const href = info.warningUrl || info.ftcUrl;
  if (!href) {
    return `<p class="trust-why">${info.label}</p>`;
  }
  return `<a class="biz ${tone}" href="${href}" target="_blank" rel="noopener">${info.label}</a>`;
}

function compactStars(stars) {
  if (stars == null) {
    return '<span class="rank-score">신뢰도 -</span>';
  }
  const pct = Math.max(0, Math.min(100, (Number(stars) / 5) * 100));
  return `<span class="stars stars-sm" style="--pct:${pct}%">★★★★★</span><span class="rank-score">${stars} / 5</span>`;
}

function compactTrustNote(trust) {
  if (!trust || !trust.id) {
    return { text: "신뢰도 정보 없음", bad: false };
  }
  if (trust.consumer && trust.consumer.warningCount) {
    return { text: `소비자24 피해주의보 ${trust.consumer.warningCount}건`, bad: true };
  }
  const reasons = trust.reasons || [];
  if (reasons.length) {
    return { text: reasons.slice(0, 2).join(" · "), bad: false };
  }
  if (trust.consumer && trust.consumer.label) {
    return { text: trust.consumer.label, bad: false };
  }
  return { text: "", bad: false };
}

function rankListHtml(ranked, sellerMap, suggestedId) {
  if (!ranked.length) {
    return "";
  }
  const rows = ranked
    .map((item, index) => {
      const trust = sellerMap[item.sellerId] || {};
      const note = compactTrustNote(trust);
      const suggested = item.id === suggestedId ? '<span class="rank-tag">신뢰 우선</span>' : "";
      const noteHtml = note.text
        ? `<span class="rank-note${note.bad ? " bad" : ""}">${note.text}</span>`
        : "";
      return `
        <a class="rank-row" href="${item.url}" target="_blank" rel="noopener">
          <span class="rank-no">${index + 1}</span>
          <span class="rank-body">
            <span class="rank-name">${item.sellerName}${suggested}</span>
            <span class="rank-trust">${compactStars(trust.stars)}</span>
            ${noteHtml}
          </span>
          <span class="rank-price">${won(item.price)}</span>
        </a>
      `;
    })
    .join("");
  return `<div class="rank-list rank-list-main">${rows}</div>`;
}

function cardHtml({ kicker, kickerClass, title, price, meta, delta, href, linkLabel, trust, safer, extra }) {
  const deltaHtml = delta ? `<p class="delta">${delta}</p>` : "";
  const priceHtml = price ? `<p class="price">${price}</p>` : "";
  const metaHtml = meta ? `<p class="meta">${meta}</p>` : "";
  const trustHtml = trust
    ? `${starsHtml(trust.stars)}${bizHtml(trust)}${consumerHtml(trust)}<p class="trust-why">${(trust.reasons || []).join(" · ")}</p>`
    : "";
  const saferHtml = safer
    ? `<a class="safer" href="${safer.url}" target="_blank" rel="noopener">더 안전한 판매처 ${safer.name} ${safer.stars} · ${won(safer.price)}</a>`
    : "";
  const action = href
    ? `<div class="actions"><a class="btn" href="${href}" target="_blank" rel="noopener">${linkLabel}</a></div>`
    : "";
  return `
    <article class="card">
      <div class="card-kicker ${kickerClass || ""}">${kicker}</div>
      <h2>${title}</h2>
      ${priceHtml}
      ${deltaHtml}
      ${metaHtml}
      ${trustHtml}
      ${saferHtml}
      ${extra || ""}
      ${action}
    </article>
  `;
}

function render(data) {
  lastData = data;
  const { products, prices, listings, events, status, sellers } = data;
  const productMap = Object.fromEntries((products.products || []).map((item) => [item.id, item]));
  const sellerMap = Object.fromEntries((sellers.items || []).map((item) => [item.id, item]));
  const priceItems = prices.items || [];
  const listingItems = listings.items || [];
  const eventItems = events.items || [];
  const query = readQuery();
  const shown = visibleProducts(productMap, query);
  const shownIds = new Set(shown.map((item) => item.id));

  document.getElementById("last-check").textContent = formatCheck(status.lastRunAt);
  document.getElementById("status-time").textContent = formatStatusTime(status.lastRunAt);

  const alertStack = document.getElementById("alert-stack");
  const alerts = [];

  listingItems
    .filter((item) => item.isNew && (!query || shownIds.has(item.productId)))
    .sort((a, b) => productRank(a.productId) - productRank(b.productId))
    .slice(0, 2)
    .forEach((item) => {
      alerts.push(
        cardHtml({
          kicker: "NEW",
          kickerClass: "kicker-new",
          title: productMap[item.productId]?.name || item.productId,
          price: won(item.price),
          meta: `당근 · ${item.region || ""} · ${relativeTime(item.listedAt || item.collectedAt)}`,
          href: item.url,
          linkLabel: "매물 보기",
        })
      );
    });

  eventItems
    .filter((item) => item.type === "PRICE_DROP" && (!query || shownIds.has(item.productId)))
    .sort((a, b) => productRank(a.productId) - productRank(b.productId))
    .slice(0, 2)
    .forEach((item) => {
      alerts.push(
        cardHtml({
          kicker: "DROP",
          kickerClass: "kicker-drop",
          title: item.productName,
          price: `${won(item.previousPrice)} → ${won(item.price)}`,
          delta: `▼${won(item.dropAmount)}`,
          meta: item.sellerName,
          href: item.url,
          linkLabel: "판매처에서 보기",
        })
      );
    });

  alertStack.innerHTML = alerts.join("");

  const daangnStack = document.getElementById("daangn-stack");
  if (daangnStack) {
    daangnStack.innerHTML = daangnHtml(query ? [query] : shown.map((item) => item.name));
  }

  const priceStack = document.getElementById("price-stack");
  if (!shown.length) {
    priceStack.innerHTML = cardHtml({
      kicker: "검색",
      title: query || "상품명",
      meta: "아직 이 상품은 가격을 모으고 있지 않습니다. 당근에서 먼저 찾아보세요.",
    });
  } else {
    priceStack.innerHTML = shown
      .map((product) => {
        const ranked = rankedByProduct(priceItems, product.id, sellerMap);
        const best = ranked[0];
        if (!best) {
          return cardHtml({
            kicker: "추천 판매처",
            title: product.name,
            meta: "아직 수집된 가격이 없습니다",
          });
        }
        const suggested = suggestedOffer(ranked, sellerMap);
        const rate = discountRate(product.officialPrice, best.price);
        return cardHtml({
          kicker: rate > 0 ? `공식가 대비 ▼ ${rate}%` : "추천 판매처",
          kickerClass: rate > 0 ? "kicker-sale" : "",
          title: product.name,
          meta: `가격순 1~${ranked.length}위 · 별점은 업체 신뢰도`,
          extra: rankListHtml(ranked, sellerMap, suggested && suggested.id),
        });
      })
      .join("");
  }

  const saleCount = priceItems.filter((item) => {
    const officialPrice = productMap[item.productId]?.officialPrice;
    return officialPrice && item.price < officialPrice;
  }).length;

  document.getElementById("count-new").textContent = listingItems.filter((item) => item.isNew).length;
  document.getElementById("count-drop").textContent = eventItems.filter((item) => item.type === "PRICE_DROP").length;
  document.getElementById("count-sale").textContent = saleCount;

  const list = document.getElementById("collector-list");
  list.innerHTML = (status.collectors || [])
    .map((collector) => {
      const state = STATUS_LABEL[collector.status] || collector.status;
      return `<li><span><span class="dot ${collector.status}"></span>${collector.name}</span><span class="state-label">${state}</span></li>`;
    })
    .join("");
}

async function loadAll() {
  const [products, prices, listings, events, status, sellers] = await Promise.all([
    loadJson("products.json"),
    loadJson("prices.json"),
    loadJson("listings.json"),
    loadJson("events.json"),
    loadJson("status.json"),
    loadJson("sellers.json").catch(() => ({ items: [] })),
  ]);
  return { products, prices, listings, events, status, sellers };
}

async function refresh(manual) {
  setRefreshState(true, manual ? "최신 데이터를 불러오는 중" : "");
  try {
    await clearDataCache();
    const data = await loadAll();
    render(data);
    if (manual) {
      setRefreshState(false, `화면을 갱신했습니다 · ${formatCheck(data.status.lastRunAt)} 수집분`);
    } else {
      setRefreshState(false, "");
    }
  } catch (error) {
    document.getElementById("last-check").textContent = "불러오기 실패";
    document.getElementById("alert-stack").innerHTML = `
      <article class="card">
        <div class="card-kicker">상태</div>
        <h2>데이터를 읽지 못했습니다</h2>
        <p class="muted">${error.message}</p>
      </article>
    `;
    setRefreshState(false, error.message);
  }
}

function bindRefresh() {
  const button = document.getElementById("refresh-btn");
  if (!button) {
    return;
  }
  button.addEventListener("click", () => refresh(true));
}

function bindSearch() {
  const form = document.getElementById("search-form");
  const input = document.getElementById("product-query");
  if (!form || !input) {
    return;
  }
  try {
    input.value = localStorage.getItem(QUERY_KEY) || "";
  } catch (error) {
    input.value = "";
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    input.blur();
    if (lastData) {
      render(lastData);
    }
  });
  input.addEventListener("input", () => {
    try {
      localStorage.setItem(QUERY_KEY, input.value);
    } catch (error) {
      /* ignore quota */
    }
    if (lastData) {
      render(lastData);
    }
  });
}

async function boot() {
  bindSearch();
  bindRefresh();
  await refresh(false);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(`${BASE}service-worker.js`).catch(() => {});
  }
}

boot();

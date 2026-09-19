const BASE = (() => {
  const path = location.pathname;
  if (path === "/Goods_Search" || path.startsWith("/Goods_Search/")) {
    return "/Goods_Search/";
  }
  return "./";
})();

const PRODUCT_ORDER = ["sp-800a", "sp-800"];

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
  const response = await fetch(`${BASE}data/${name}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${name} ${response.status}`);
  }
  return response.json();
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

function lowestByProduct(prices, productId) {
  return prices
    .filter((item) => item.productId === productId)
    .sort((a, b) => a.price - b.price)[0];
}

function discountRate(officialPrice, price) {
  if (!officialPrice || price >= officialPrice) return 0;
  return Math.round(((officialPrice - price) / officialPrice) * 1000) / 10;
}

function cardHtml({ kicker, kickerClass, title, price, meta, delta, href, linkLabel }) {
  const deltaHtml = delta ? `<p class="delta">${delta}</p>` : "";
  const action = href
    ? `<div class="actions"><a class="btn" href="${href}" target="_blank" rel="noopener">${linkLabel}</a></div>`
    : "";
  return `
    <article class="card">
      <div class="card-kicker ${kickerClass}">${kicker}</div>
      <h2>${title}</h2>
      <p class="price">${price}</p>
      ${deltaHtml}
      <p class="meta">${meta}</p>
      ${action}
    </article>
  `;
}

function render(data) {
  const { products, prices, listings, events, status } = data;
  const productMap = Object.fromEntries((products.products || []).map((item) => [item.id, item]));
  const priceItems = prices.items || [];
  const listingItems = listings.items || [];
  const eventItems = events.items || [];

  document.getElementById("last-check").textContent = formatCheck(status.lastRunAt);
  document.getElementById("status-time").textContent = formatStatusTime(status.lastRunAt);

  const alertStack = document.getElementById("alert-stack");
  const alerts = [];

  listingItems
    .filter((item) => item.isNew)
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
    .filter((item) => item.type === "PRICE_DROP")
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

  const priceStack = document.getElementById("price-stack");
  priceStack.innerHTML = PRODUCT_ORDER
    .map((productId) => {
      const product = productMap[productId];
      const best = lowestByProduct(priceItems, productId);
      if (!product || !best) {
        return cardHtml({
          kicker: product?.name || productId,
          kickerClass: "",
          title: "신품 최저가",
          price: "-",
          meta: "아직 수집된 가격이 없습니다",
        });
      }
      const rate = discountRate(product.officialPrice, best.price);
      return cardHtml({
        kicker: product.name,
        kickerClass: rate > 0 ? "kicker-sale" : "",
        title: "신품 최저가",
        price: won(best.price),
        delta: rate > 0 ? `▼ ${rate}%` : "",
        meta: best.sellerName,
        href: best.url,
        linkLabel: "판매처에서 보기",
      });
    })
    .join("");

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

async function boot() {
  try {
    const [products, prices, listings, events, status] = await Promise.all([
      loadJson("products.json"),
      loadJson("prices.json"),
      loadJson("listings.json"),
      loadJson("events.json"),
      loadJson("status.json"),
    ]);
    render({ products, prices, listings, events, status });
  } catch (error) {
    document.getElementById("last-check").textContent = "불러오기 실패";
    document.getElementById("alert-stack").innerHTML = `
      <article class="card">
        <div class="card-kicker">상태</div>
        <h2>데이터를 읽지 못했습니다</h2>
        <p class="muted">${error.message}</p>
      </article>
    `;
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(`${BASE}service-worker.js`).catch(() => {});
  }
}

boot();

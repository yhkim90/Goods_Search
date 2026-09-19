const BASE = (() => {
  const path = location.pathname;
  if (path === "/Goods_Search" || path.startsWith("/Goods_Search/")) {
    return "/Goods_Search/";
  }
  return "./";
})();

const QUERY_KEY = "goods-search-query";
let activeTab = "shop";

function won(value) {
  return `${Number(value).toLocaleString("ko-KR")}원`;
}

function formatClock(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function setBusy(isSearch, busy, note) {
  const searchBtn = document.getElementById("search-btn");
  const refreshBtn = document.getElementById("refresh-btn");
  const noteEl = document.getElementById("refresh-note");
  if (searchBtn) {
    searchBtn.disabled = busy;
    searchBtn.textContent = isSearch && busy ? "검색 중" : "검색";
  }
  if (refreshBtn) {
    refreshBtn.disabled = busy;
    refreshBtn.textContent = !isSearch && busy ? "확인 중" : "새로고침";
  }
  if (noteEl) {
    noteEl.textContent = note || "";
  }
}

function starsHtml(stars) {
  const pct = Math.max(0, Math.min(100, (Number(stars) / 5) * 100));
  return `<span class="stars stars-sm" style="--pct:${pct}%">★★★★★</span><span class="rank-score">${stars} / 5</span>`;
}

function rankRows(items, suggestedUrl) {
  return items
    .map((item, index) => {
      const tag = suggestedUrl && item.url === suggestedUrl ? '<span class="rank-tag">신뢰 우선</span>' : "";
      const href = item.url || "#";
      const name = visibleLabel(item.seller, visibleLabel(item.title, item.source || "판매처"));
      const note = visibleLabel(item.trust?.note, visibleLabel(item.title, ""));
      return `
        <a class="rank-row" href="${href}" target="_blank" rel="noopener">
          <span class="rank-no">${index + 1}</span>
          <span class="rank-body">
            <span class="rank-name">${escapeHtml(name)}${tag}</span>
            <span class="rank-trust">${starsHtml(item.trust?.stars || 2)}</span>
            ${note ? `<span class="rank-note">${escapeHtml(note)}</span>` : ""}
          </span>
          <span class="rank-price">${won(item.price)}</span>
        </a>
      `;
    })
    .join("");
}

function emptyState() {
  return `
    <article class="card">
      <div class="card-kicker">GOODS SEARCH</div>
      <h2>상품을 검색하세요</h2>
      <p class="muted">상품명을 입력한 뒤 검색을 누르면 신품 최저가 업체와 당근 매물을 탭으로 나눠 보여줍니다.</p>
    </article>
  `;
}

function setTab(name) {
  activeTab = name;
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("is-on", button.dataset.tab === name);
  });
  const shopPanel = document.getElementById("shop-panel");
  const usedPanel = document.getElementById("used-panel");
  if (shopPanel && usedPanel) {
    shopPanel.hidden = name !== "shop";
    usedPanel.hidden = name !== "used";
  }
}

function setLastSearch(query, time) {
  const line = document.getElementById("last-search");
  if (!line) {
    return;
  }
  line.textContent = `마지막 검색 : ${query || "-"} / ${time || "-"}`;
}

function renderResult(result) {
  const shopPanel = document.getElementById("shop-panel");
  const usedPanel = document.getElementById("used-panel");
  const tabs = document.getElementById("result-tabs");
  const sourceList = document.getElementById("source-list");

  tabs.hidden = false;
  setLastSearch(result.query, formatClock(result.searchedAt));
  document.querySelector('[data-tab="shop"]').textContent = `신품 ${result.shops.length}`;
  document.querySelector('[data-tab="used"]').textContent = `당근 ${result.used.length}`;

  if (!result.shops.length) {
    shopPanel.innerHTML = `
      <article class="card">
        <div class="card-kicker">신품</div>
        <h2>${escapeHtml(result.query)}</h2>
        <p class="muted">비교사이트에서 판매처를 읽지 못했습니다. 공식 검색으로 확인할 수 있습니다.</p>
        <div class="actions">
          <a class="btn" href="${result.official.naver}" target="_blank" rel="noopener">네이버쇼핑</a>
          <a class="btn" href="${result.official.danawa}" target="_blank" rel="noopener">다나와</a>
        </div>
      </article>
    `;
  } else {
    shopPanel.innerHTML = `
      <article class="card">
        <div class="card-kicker">신품 최저가 1~${result.shops.length}위</div>
        <h2>${escapeHtml(result.query)}</h2>
        <p class="meta">검색된 업체를 가격순으로 보여줍니다</p>
        <div class="rank-list rank-list-main">${rankRows(result.shops, result.suggested && result.suggested.url)}</div>
      </article>
    `;
  }

  if (!result.used.length) {
    usedPanel.innerHTML = `
      <article class="card daangn-card">
        <div class="card-kicker">당근</div>
        <h2>중고 매물</h2>
        <p class="muted">매물 목록을 읽지 못했습니다. 당근 공식 검색에서 확인할 수 있습니다.</p>
        <div class="actions">
          <a class="btn" href="${result.official.daangn}" target="_blank" rel="noopener">당근에서 검색</a>
        </div>
      </article>
    `;
  } else {
    usedPanel.innerHTML = `
      <article class="card daangn-card">
        <div class="card-kicker">당근 중고 1~${result.used.length}위</div>
        <h2>${escapeHtml(result.query)}</h2>
        <p class="meta">개인 거래라 별점은 참고용입니다</p>
        <div class="rank-list rank-list-main">${rankRows(result.used)}</div>
        <div class="actions">
          <a class="btn" href="${result.official.daangn}" target="_blank" rel="noopener">당근에서 더 보기</a>
        </div>
      </article>
    `;
  }

  sourceList.innerHTML = result.sources
    .map((source) => {
      const label = source.status === "ok" ? "정상" : source.status === "partial" ? "일부" : "오류";
      return `<li><span><span class="dot ${source.status}"></span>${escapeHtml(source.name)}</span><span class="state-label">${label}</span></li>`;
    })
    .join("");

  setTab(activeTab);
}

async function runSearch() {
  const input = document.getElementById("product-query");
  const query = (input.value || "").trim();
  if (!query) {
    setBusy(true, false, "상품명을 입력하세요");
    return;
  }
  try {
    localStorage.setItem(QUERY_KEY, query);
  } catch (error) {
    /* ignore */
  }
  setLastSearch(query, "검색 중");
  setBusy(true, true, "잠시만 기다려 주세요");
  try {
    const result = await searchProduct(query);
    renderResult(result);
    setBusy(true, false, "");
  } catch (error) {
    const shopPanel = document.getElementById("shop-panel");
    if (shopPanel) {
      shopPanel.innerHTML = `
        <article class="card">
          <div class="card-kicker">검색</div>
          <h2>${escapeHtml(query)}</h2>
          <p class="muted">${escapeHtml(error.message)}</p>
        </article>
      `;
    }
    setBusy(true, false, error.message);
  }
}

async function refreshProgram() {
  setBusy(false, true, "GitHub의 최신 프로그램 파일을 확인하는 중");
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.update()));
    }
    await fetch(`${BASE}data/version.json?t=${Date.now()}`, { cache: "no-store" });
    setBusy(false, false, "최신 파일을 반영합니다");
    location.reload();
  } catch (error) {
    setBusy(false, false, "최신 파일을 확인하지 못했습니다");
  }
}

function bind() {
  const form = document.getElementById("search-form");
  const input = document.getElementById("product-query");
  const refreshBtn = document.getElementById("refresh-btn");
  try {
    input.value = localStorage.getItem(QUERY_KEY) || "";
  } catch (error) {
    input.value = "";
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    input.blur();
    runSearch();
  });
  refreshBtn.addEventListener("click", () => refreshProgram());
  document.getElementById("result-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (button) {
      setTab(button.dataset.tab);
    }
  });
}

function boot() {
  bind();
  document.getElementById("shop-panel").innerHTML = emptyState();
  setLastSearch("-", "-");
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(`${BASE}service-worker.js`).catch(() => {});
  }
}

boot();

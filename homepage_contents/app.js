const DATA_URL = "data/content.json";
const CONTACT_ENDPOINT = "";
const API_BASE_URL = "https://11yf40fgme.execute-api.ap-northeast-1.amazonaws.com/prd";
const COUNTER_CACHE_KEY = "arcanade-counter-cache-v1";
const COUNTER_CACHE_TTL_MS = 5 * 60 * 1000;
const COUNTER_API = {
  blog: { path: "blog", responseKey: "blogs" },
  works: { path: "work", responseKey: "works" },
  games: { path: "game", responseKey: "games" }
};

const ALLOWED_HTML_TAGS = new Set([
  "a", "abbr", "audio", "b", "br", "caption", "cite", "code", "del", "details", "div", "em", "figcaption",
  "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "iframe", "img", "kbd", "li", "mark",
  "ol", "p", "picture", "pre", "s", "small", "source", "span", "strong", "sub", "summary", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr", "track", "u", "ul", "video"
]);

const VOID_HTML_TAGS = new Set(["br", "hr", "img", "source", "track"]);
const BOOLEAN_HTML_ATTRIBUTES = new Set(["allowfullscreen", "autoplay", "controls", "loop", "muted", "open", "playsinline"]);
const ALLOWED_HTML_ATTRIBUTES = new Set(["align", "class", "height", "id", "style", "title", "width"]);

const fallbackData = {
  site: {
    name: "ARCANADE",
    email: "contact@example.com",
    x: "https://x.com/"
  },
  blogs: [
    {
      id: "first-note",
      title: "ARCANADEを作り直す",
      updatedAt: "2026-04-29T10:00:00+09:00",
      summary: "ブログ、制作物、ミニゲームをひとつの導線で見せるための設計メモです。",
      pv: 1280,
      likes: 84,
      body: "新しいARCANADEでは、読み物と作品と遊べるコンテンツを同じ温度で扱います。\n\n制作の背景、実装の記録、公開後の改善までを残し、トップページから人気の内容へすぐ移動できる構成にしました。\n\n静的配信を前提に、コンテンツ生成はtools配下のスクリプトでまとめます。"
    }
  ],
  works: [
    {
      id: "showcase",
      title: "Digital Showcase Reel",
      updatedAt: "2026-04-29T11:00:00+09:00",
      summary: "映像、画像、Web向けインタラクションを横断して見せるショーケースです。",
      description: "作品の説明と視聴エリアを左右に分け、画像と動画を切り替えながら確認できます。動画URLは生成ツール側で埋め込みURLへ変換されます。",
      thumbnail: "assets/hero-arcanade.png",
      pv: 940,
      likes: 63,
      media: [
        {
          type: "image",
          src: "assets/hero-arcanade.png",
          thumbnail: "assets/hero-arcanade.png",
          title: "Main visual"
        }
      ]
    }
  ],
  games: [
    {
      id: "mini-lab",
      title: "Mini Lab",
      updatedAt: "2026-04-29T12:00:00+09:00",
      summary: "Unity WebGLの配置を想定したミニゲーム枠です。",
      pv: 720,
      likes: 41,
      buildUrl: ""
    }
  ]
};

const state = {
  data: fallbackData,
  counters: {
    blog: { returnedAt: 0, items: {} },
    works: { returnedAt: 0, items: {} },
    games: { returnedAt: 0, items: {} }
  },
  currentView: "home",
  blogPage: 1,
  workPage: 1,
  blogSort: "updated",
  workSort: "updated",
  blogSearch: "",
  workSearch: "",
  selectedGameId: null
};

const formatDate = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const pageConfig = window.ARCANADE_PAGE || inferPageConfig();
const views = [...document.querySelectorAll("[data-view]")];
const navButtons = [...document.querySelectorAll("[data-nav]")];

init();

async function init() {
  state.data = await loadData();
  annotateCounterKinds(state.data);
  initializeCounters(state.data);
  await hydrateRemoteCounters();
  hydrateContact();
  bindNavigation();
  bindControls();
  renderAll();
  routeFromPage();
  updateCounterElements();
}

async function loadData() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Failed to load ${DATA_URL}`);
    const data = await response.json();
    return {
      site: { ...fallbackData.site, ...(data.site || {}) },
      blogs: normalizeCollection(data.blogs, fallbackData.blogs),
      works: normalizeCollection(data.works, fallbackData.works),
      games: normalizeCollection(data.games, fallbackData.games)
    };
  } catch (error) {
    console.info("Using fallback content:", error.message);
    return fallbackData;
  }
}

function normalizeCollection(items, fallback) {
  return Array.isArray(items) && items.length ? items : fallback;
}

function annotateCounterKinds(data) {
  data.blogs.forEach((item) => item.counterKind = "blog");
  data.works.forEach((item) => item.counterKind = "works");
  data.games.forEach((item) => item.counterKind = "games");
}

function initializeCounters(data) {
  seedCounters("blog", data.blogs);
  seedCounters("works", data.works);
  seedCounters("games", data.games);
}

function seedCounters(kind, items) {
  state.counters[kind] = state.counters[kind] || { returnedAt: 0, items: {} };
  for (const item of items) {
    state.counters[kind].items[item.id] = {
      pv: numberOrZero(item.pv),
      likes: numberOrZero(item.likes)
    };
  }
}

async function hydrateRemoteCounters() {
  await Promise.all([
    fetchCounterGroup("blog", state.data.blogs),
    fetchCounterGroup("works", state.data.works),
    fetchCounterGroup("games", state.data.games)
  ]);
}

async function fetchCounterGroup(kind, items) {
  const config = COUNTER_API[kind];
  if (!config || !items.length) return;
  const cached = readCounterCache(kind);
  if (isCounterCacheFresh(cached)) {
    applyCounterCache(kind, cached);
    return;
  }
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/${config.path}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Counter API failed: ${response.status}`);
    const payload = await response.json();
    applyCounterPayload(kind, payload);
    writeCounterCache(kind);
  } catch (error) {
    console.info(`Counter GET failed for ${kind}/${config.path}:`, error.message);
    console.info(`Using local counters for ${kind}.`);
  }
}

function applyCounterPayload(kind, payload) {
  const config = COUNTER_API[kind];
  const returnedAt = Date.parse(payload.returnedAt || "");
  if (Number.isFinite(returnedAt)) {
    state.counters[kind].returnedAt = Math.max(state.counters[kind].returnedAt || 0, returnedAt);
  }
  const counters = payload[config.responseKey] || payload.ids || {};
  for (const [id, values] of Object.entries(counters)) {
    state.counters[kind].items[id] = {
      pv: numberOrZero(values.pv),
      likes: numberOrZero(values.likes)
    };
  }
}

function hydrateContact() {
  const xLink = document.querySelector(".contact-info a[href='https://x.com/']");
  const mailLink = document.querySelector(".contact-info a[href='mailto:contact@example.com']");
  if (xLink) {
    xLink.href = state.data.site.x;
    xLink.textContent = state.data.site.x;
  }
  if (mailLink) {
    mailLink.href = `mailto:${state.data.site.email}`;
    mailLink.textContent = state.data.site.email;
  }
}

function bindNavigation() {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.nav;
      if (target) navigate(target);
    });
  });
}

function bindControls() {
  document.getElementById("blog-search").addEventListener("input", (event) => {
    state.blogSearch = event.target.value.trim();
    state.blogPage = 1;
    renderBlogList();
  });

  document.getElementById("work-search").addEventListener("input", (event) => {
    state.workSearch = event.target.value.trim();
    state.workPage = 1;
    renderWorkList();
  });

  document.querySelectorAll("[data-blog-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      state.blogSort = button.dataset.blogSort;
      setActiveSegment("[data-blog-sort]", button);
      renderBlogList();
    });
  });

  document.querySelectorAll("[data-work-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      state.workSort = button.dataset.workSort;
      setActiveSegment("[data-work-sort]", button);
      renderWorkList();
    });
  });

  document.getElementById("contact-form").addEventListener("submit", handleContactSubmit);
}

function setActiveSegment(selector, activeButton) {
  document.querySelectorAll(selector).forEach((button) => {
    button.classList.toggle("is-active", button === activeButton);
  });
}

function routeFromPage() {
  showView(pageConfig.view || "home", { resetDetail: !pageConfig.detailType });
  if (pageConfig.detailType === "blog" && pageConfig.detailId) openBlog(pageConfig.detailId, { replaceUrl: false });
  if (pageConfig.detailType === "work" && pageConfig.detailId) openWork(pageConfig.detailId, { replaceUrl: false });
  if (pageConfig.detailType === "game" && pageConfig.detailId) selectGame(pageConfig.detailId, { followPath: false });
}

function navigate(view) {
  goToPath(pathForView(view));
}

function showView(view, options = {}) {
  const { resetDetail = true } = options;
  state.currentView = view;
  views.forEach((element) => element.classList.toggle("is-current", element.dataset.view === view));
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.nav === view);
  });
  if (resetDetail && view === "blog") showBlogList();
  if (resetDetail && view === "works") showWorkList();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAll() {
  renderHome();
  renderBlogList();
  renderWorkList();
  renderGames();
  updateCounterElements();
}

function renderHome() {
  const latestBlogs = sortItems(state.data.blogs, "updated").slice(0, 1);
  const popularBlogs = sortItems(state.data.blogs, "popular").slice(0, 1);
  renderCards(document.getElementById("home-blog-list"), uniqueById([...popularBlogs, ...latestBlogs]), "blog");

  const popularWorks = sortItems(state.data.works, "popular").slice(0, 3);
  document.getElementById("home-work-list").innerHTML = popularWorks.map(workItemTemplate).join("");
  bindWorkItems(document.getElementById("home-work-list"));

  const popularGames = sortItems(state.data.games, "popular").slice(0, 3);
  renderCards(document.getElementById("home-game-list"), popularGames, "game");
}

function renderBlogList() {
  const items = filterItems(state.data.blogs, state.blogSearch);
  const sorted = sortItems(items, state.blogSort);
  const page = paginate(sorted, state.blogPage, 30);
  renderCards(document.getElementById("blog-list"), page.items, "blog");
  renderPager(document.getElementById("blog-pager"), page.totalPages, state.blogPage, (nextPage) => {
    state.blogPage = nextPage;
    renderBlogList();
  });
}

function renderWorkList() {
  const items = filterItems(state.data.works, state.workSearch);
  const sorted = sortItems(items, state.workSort);
  const page = paginate(sorted, state.workPage, 10);
  const container = document.getElementById("work-list");
  container.innerHTML = page.items.length ? page.items.map(workItemTemplate).join("") : emptyTemplate();
  bindWorkItems(container);
  renderPager(document.getElementById("work-pager"), page.totalPages, state.workPage, (nextPage) => {
    state.workPage = nextPage;
    renderWorkList();
  });
}

function renderCards(container, items, type) {
  container.innerHTML = items.length ? items.map((item) => cardTemplate(item, type)).join("") : emptyTemplate();
  container.querySelectorAll("[data-card-id]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const id = card.dataset.cardId;
      if (type === "blog") goToPath(pathForBlog(id));
      if (type === "game") goToPath(pathForGame(id));
    });
  });
  container.querySelectorAll("[data-share]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      shareItem(button.dataset.share, button.dataset.title);
    });
  });
}

function cardTemplate(item, type) {
  const href = type === "blog" ? pathForBlog(item.id) : pathForGame(item.id);
  return `
    <article class="card clickable" tabindex="0" data-card-id="${escapeHtml(item.id)}">
      <div class="meta-row">
        <span>${formatDateText(item.updatedAt)}</span>
        <span>${metricText(getPvCount(item), "PV")}</span>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="summary">${escapeHtml(item.summary || item.description || "")}</p>
      <div class="stat-row">
        <span>${metricText(getLikeCount(item), "いいね")}</span>
        ${type === "blog" ? `<a href="${href}" aria-label="${escapeHtml(item.title)}を開く">読む</a>` : `<button class="share-button" type="button" data-share="${href}" data-title="${escapeHtml(item.title)}">共有</button>`}
        ${type === "blog" ? `<button class="share-button" type="button" data-share="${href}" data-title="${escapeHtml(item.title)}">共有</button>` : ""}
      </div>
    </article>
  `;
}

function workItemTemplate(item) {
  return `
    <button class="work-item" type="button" data-work-id="${escapeHtml(item.id)}">
      <img class="thumb" src="${escapeAttribute(item.thumbnail || "assets/hero-arcanade.png")}" alt="">
      <span>
        <span class="meta-row">
          <span>${formatDateText(item.updatedAt)}</span>
          <span>${metricText(getPvCount(item), "PV")}</span>
          <span>${metricText(getLikeCount(item), "いいね")}</span>
        </span>
        <h3>${escapeHtml(item.title)}</h3>
        <span class="summary">${escapeHtml(item.summary || "")}</span>
      </span>
      <span class="share-button" data-share="${pathForWork(item.id)}" data-title="${escapeHtml(item.title)}">共有</span>
    </button>
  `;
}

function bindWorkItems(container) {
  container.querySelectorAll("[data-work-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (event.target.closest("[data-share]")) {
        event.stopPropagation();
        shareItem(event.target.dataset.share, event.target.dataset.title);
        return;
      }
      goToPath(pathForWork(button.dataset.workId));
    });
  });
}

function openBlog(id, options = {}) {
  const { replaceUrl = true } = options;
  const item = state.data.blogs.find((blog) => blog.id === id);
  if (!item) return;
  recordPv(item);
  const list = document.getElementById("blog-list-view");
  const detail = document.getElementById("blog-detail-view");
  list.hidden = true;
  detail.hidden = false;
  const staticDetail = getStaticDetail("blog", id);
  if (!replaceUrl && staticDetail) {
    hydrateStaticDetail(detail, item);
    showView("blog", { resetDetail: false });
    return;
  }
  detail.innerHTML = `
    <div class="detail-shell">
      <a class="button back-button" href="${pathForView("blog")}" data-back-blog>一覧に戻る</a>
      <div class="meta-row">
        <span>${formatDateText(item.updatedAt)}</span>
        <span>${metricText(getPvCount(item), "PV")}</span>
        <span>${metricText(getLikeCount(item), "いいね")}</span>
      </div>
      <h1>${escapeHtml(item.title)}</h1>
      <div class="article-body">${markdownLite(item.body || item.summary || "")}</div>
      <div class="detail-actions">
        <button class="like-button" type="button" data-like="${escapeHtml(item.id)}">いいね ${getLikeCount(item)}</button>
        <button class="share-button" type="button" data-share="${pathForBlog(item.id)}" data-title="${escapeHtml(item.title)}">共有</button>
      </div>
    </div>
  `;
  bindDetailActions(detail, item);
  showView("blog", { resetDetail: false });
  if (replaceUrl) goToPath(pathForBlog(item.id));
}

function showBlogList() {
  document.getElementById("blog-list-view").hidden = false;
  document.getElementById("blog-detail-view").hidden = true;
}

function openWork(id, options = {}) {
  const { replaceUrl = true } = options;
  const item = state.data.works.find((work) => work.id === id);
  if (!item) return;
  recordPv(item);
  const list = document.getElementById("work-list-view");
  const detail = document.getElementById("work-detail-view");
  const media = item.media?.length ? item.media : [{ type: "image", src: item.thumbnail || "assets/hero-arcanade.png", thumbnail: item.thumbnail || "assets/hero-arcanade.png", title: item.title }];
  list.hidden = true;
  detail.hidden = false;
  const staticDetail = getStaticDetail("work", id);
  if (!replaceUrl && staticDetail) {
    hydrateStaticDetail(detail, item);
    bindStaticMediaRail(detail);
    showView("works", { resetDetail: false });
    return;
  }
  detail.innerHTML = `
    <a class="button back-button" href="${pathForView("works")}" data-back-work>一覧に戻る</a>
    <div class="work-detail-grid">
      <section>
        <div class="meta-row">
          <span>${formatDateText(item.updatedAt)}</span>
          <span>${metricText(getPvCount(item), "PV")}</span>
        </div>
        <h1>${escapeHtml(item.title)}</h1>
        <p class="article-body">${escapeHtml(item.description || item.summary || "")}</p>
        <div class="detail-actions">
          <button class="like-button" type="button" data-like="${escapeHtml(item.id)}">いいね ${getLikeCount(item)}</button>
          <button class="share-button" type="button" data-share="${pathForWork(item.id)}" data-title="${escapeHtml(item.title)}">共有</button>
        </div>
      </section>
      <section>
        <div class="media-frame" id="active-media"></div>
        <div class="media-rail">
          ${media.map((entry, index) => `
            <button type="button" class="${index === 0 ? "is-active" : ""} ${entry.type === "video" ? "is-video" : ""}" data-media-index="${index}">
              <img class="thumb" src="${escapeAttribute(entry.thumbnail || entry.src)}" alt="${escapeAttribute(entry.title || item.title)}">
            </button>
          `).join("")}
        </div>
      </section>
    </div>
  `;
  const mediaFrame = detail.querySelector("#active-media");
  const renderMedia = (index) => {
    const entry = media[index];
    mediaFrame.innerHTML = entry.type === "video"
      ? `<iframe src="${escapeAttribute(entry.embedUrl || entry.src)}" title="${escapeAttribute(entry.title || item.title)}" allowfullscreen loading="lazy"></iframe>`
      : `<img src="${escapeAttribute(entry.src)}" alt="${escapeAttribute(entry.title || item.title)}">`;
    detail.querySelectorAll("[data-media-index]").forEach((button) => button.classList.toggle("is-active", Number(button.dataset.mediaIndex) === index));
  };
  renderMedia(0);
  detail.querySelectorAll("[data-media-index]").forEach((button) => {
    button.addEventListener("click", () => renderMedia(Number(button.dataset.mediaIndex)));
  });
  bindDetailActions(detail, item);
  showView("works", { resetDetail: false });
  if (replaceUrl) goToPath(pathForWork(item.id));
}

function showWorkList() {
  document.getElementById("work-list-view").hidden = false;
  document.getElementById("work-detail-view").hidden = true;
}

function renderGames() {
  if (!state.selectedGameId && state.data.games[0]) state.selectedGameId = state.data.games[0].id;
  const list = document.getElementById("game-list");
  list.innerHTML = state.data.games.map((game) => `
    <button class="game-list-item ${game.id === state.selectedGameId ? "is-active" : ""}" type="button" data-game-id="${escapeHtml(game.id)}">
      <span class="meta-row">
        <span>${formatDateText(game.updatedAt)}</span>
        <span>${metricText(getPvCount(game), "PV")}</span>
        <span>${metricText(getLikeCount(game), "いいね")}</span>
      </span>
      <h3>${escapeHtml(game.title)}</h3>
      <p class="summary">${escapeHtml(game.summary || "")}</p>
    </button>
  `).join("");
  list.querySelectorAll("[data-game-id]").forEach((button) => {
    button.addEventListener("click", () => goToPath(pathForGame(button.dataset.gameId)));
  });
  if (pageConfig.detailType === "game" && getStaticDetail("game", pageConfig.detailId)) {
    return;
  }
  renderGameStage();
}

function selectGame(id, options = {}) {
  const { followPath = true } = options;
  state.selectedGameId = id;
  const game = state.data.games.find((item) => item.id === id);
  if (game) recordPv(game);
  renderGames();
  const staticDetail = getStaticDetail("game", id);
  if (!followPath && staticDetail && game) {
    hydrateStaticDetail(document.getElementById("game-stage"), game);
    return;
  }
  if (followPath) goToPath(pathForGame(id));
}

function renderGameStage() {
  const stage = document.getElementById("game-stage");
  const game = state.data.games.find((item) => item.id === state.selectedGameId);
  if (!game) {
    stage.innerHTML = emptyTemplate();
    return;
  }
  stage.innerHTML = `
    <div class="meta-row">
      <span>${formatDateText(game.updatedAt)}</span>
      <span>${metricText(getPvCount(game), "PV")}</span>
      <span>${metricText(getLikeCount(game), "いいね")}</span>
    </div>
    <h2>${escapeHtml(game.title)}</h2>
    <p class="summary">${escapeHtml(game.summary || "")}</p>
    <div class="unity-frame" id="unity-frame">
      ${game.buildUrl ? `<iframe src="${escapeAttribute(game.buildUrl)}" title="${escapeAttribute(game.title)}" allowfullscreen></iframe>` : `<span>Unity WebGL build</span>`}
    </div>
    <div class="detail-actions">
      <button class="button" type="button" data-fullscreen>全画面</button>
      <button class="like-button" type="button" data-like="${escapeHtml(game.id)}">いいね ${getLikeCount(game)}</button>
      <button class="share-button" type="button" data-share="${pathForGame(game.id)}" data-title="${escapeHtml(game.title)}">共有</button>
    </div>
    ${game.body ? `<div class="article-body game-description">${markdownLite(game.body)}</div>` : ""}
  `;
  stage.querySelector("[data-fullscreen]").addEventListener("click", () => {
    const frame = document.getElementById("unity-frame");
    if (frame.requestFullscreen) frame.requestFullscreen();
  });
  bindDetailActions(stage, game);
}

function bindDetailActions(scope, item) {
  scope.querySelectorAll("[data-like]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = recordLike(item);
      button.textContent = `いいね ${next}`;
      renderHome();
    });
  });
  scope.querySelectorAll("[data-share]").forEach((button) => {
    button.addEventListener("click", () => shareItem(button.dataset.share, button.dataset.title));
  });
}

function getStaticDetail(type, id) {
  return [...document.querySelectorAll("[data-static-detail]")].find((element) => (
    element.dataset.staticDetail === type && element.dataset.staticId === id
  ));
}

function hydrateStaticDetail(scope, item) {
  bindDetailActions(scope, item);
  const fullscreenButton = scope.querySelector("[data-fullscreen]");
  if (fullscreenButton) {
    fullscreenButton.addEventListener("click", () => {
      const frame = document.getElementById("unity-frame");
      if (frame?.requestFullscreen) frame.requestFullscreen();
    });
  }
  updateCounterElements();
}

function bindStaticMediaRail(scope) {
  const mediaFrame = scope.querySelector("#active-media");
  if (!mediaFrame) return;
  scope.querySelectorAll("[data-media-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const isVideo = button.dataset.mediaType === "video";
      const src = button.dataset.mediaEmbed || button.dataset.mediaSrc || "";
      const title = button.dataset.mediaTitle || "";
      mediaFrame.innerHTML = isVideo
        ? `<iframe src="${escapeAttribute(src)}" title="${escapeAttribute(title)}" allowfullscreen loading="lazy"></iframe>`
        : `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(title)}">`;
      scope.querySelectorAll("[data-media-index]").forEach((entry) => entry.classList.toggle("is-active", entry === button));
    });
  });
}

function updateCounterElements() {
  document.querySelectorAll("[data-counter-kind][data-counter-id][data-counter-metric]").forEach((element) => {
    const item = findCounterItem(element.dataset.counterKind, element.dataset.counterId);
    if (!item) return;
    const metric = element.dataset.counterMetric;
    const suffix = metric === "likes" ? "いいね" : "PV";
    element.textContent = metricText(getCounterCount(item, metric), suffix);
  });
  document.querySelectorAll("[data-like]").forEach((button) => {
    const item = findCounterItemFromLikeButton(button);
    if (item) button.textContent = `いいね ${getLikeCount(item)}`;
  });
}

function findCounterItem(kind, id) {
  if (kind === "blog") return state.data.blogs.find((item) => item.id === id);
  if (kind === "works") return state.data.works.find((item) => item.id === id);
  if (kind === "games") return state.data.games.find((item) => item.id === id);
  return null;
}

function findCounterItemFromLikeButton(button) {
  const id = button.dataset.like;
  const container = button.closest("[data-static-detail]");
  if (container?.dataset.staticDetail === "blog") return findCounterItem("blog", id);
  if (container?.dataset.staticDetail === "work") return findCounterItem("works", id);
  if (container?.dataset.staticDetail === "game") return findCounterItem("games", id);
  return state.data.blogs.find((item) => item.id === id)
    || state.data.works.find((item) => item.id === id)
    || state.data.games.find((item) => item.id === id)
    || null;
}

async function handleContactSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById("form-status");
  const formData = new FormData(form);
  const payload = {
    subject: String(formData.get("subject") || "").trim(),
    message: String(formData.get("message") || "").trim()
  };
  const confirmed = window.confirm(`以下の内容で送信します。\n\n件名:\n${payload.subject}\n\n連絡内容:\n${payload.message}`);
  if (!confirmed) {
    status.textContent = "送信をキャンセルしました。";
    return;
  }
  if (!CONTACT_ENDPOINT) {
    status.textContent = "送信設定が未接続のため、内容を確認しました。";
    form.reset();
    return;
  }
  try {
    status.textContent = "送信中です。";
    const response = await fetch(CONTACT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("Contact request failed");
    status.textContent = "送信しました。";
    form.reset();
  } catch (error) {
    status.textContent = "送信に失敗しました。時間をおいて再度お試しください。";
  }
}

function sortItems(items, mode) {
  return [...items].sort((a, b) => {
    if (mode === "popular") return (getPvCount(b) + getLikeCount(b)) - (getPvCount(a) + getLikeCount(a));
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function filterItems(items, keyword) {
  if (!keyword) return items;
  const needle = keyword.toLowerCase();
  return items.filter((item) => `${item.title} ${item.summary} ${item.description || ""}`.toLowerCase().includes(needle));
}

function paginate(items, currentPage, pageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const start = (page - 1) * pageSize;
  return {
    totalPages,
    currentPage: page,
    items: items.slice(start, start + pageSize)
  };
}

function renderPager(container, totalPages, currentPage, onSelect) {
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = Array.from({ length: totalPages }, (_, index) => {
    const page = index + 1;
    return `<button type="button" class="${page === currentPage ? "is-active" : ""}" data-page="${page}">${page}</button>`;
  }).join("");
  container.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => onSelect(Number(button.dataset.page)));
  });
}

function uniqueById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function getPvCount(item) {
  return getCounterCount(item, "pv");
}

function getLikeCount(item) {
  return getCounterCount(item, "likes");
}

function getCounterCount(item, metric) {
  const kind = item.counterKind;
  const group = state.counters[kind];
  return group?.items[item.id]?.[metric] ?? numberOrZero(item[metric]);
}

function recordPv(item) {
  postCounterEvent(item, "pv");
}

function recordLike(item) {
  postCounterEvent(item, "likes");
  return getLikeCount(item);
}

async function postCounterEvent(item, metric) {
  const config = COUNTER_API[item.counterKind];
  if (!config) return;
  const endpointMetric = metric === "likes" ? "likes" : "pv";
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/${config.path}/${endpointMetric}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ id: item.id }),
      keepalive: true
    }, 4000);
    if (!response.ok) throw new Error(`Counter update failed: ${response.status}`);
    const payload = await response.json();
    applyCounterUpdate(item.counterKind, payload);
    writeCounterCache(item.counterKind);
    renderAll();
    return;
  } catch (error) {
    console.info(`Counter POST failed for ${item.counterKind}/${config.path}/${endpointMetric}:`, error.message);
  }
  console.info(`Queued local ${metric} for ${item.id}.`);
}

function applyCounterUpdate(kind, payload) {
  if (!payload || !payload.id) return;
  const returnedAt = Date.parse(payload.returnedAt || "");
  state.counters[kind].returnedAt = Math.max(
    state.counters[kind].returnedAt || 0,
    Number.isFinite(returnedAt) ? returnedAt : Date.now()
  );
  state.counters[kind].items[payload.id] = {
    pv: numberOrZero(payload.pv),
    likes: numberOrZero(payload.likes)
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function readCounterCache(kind) {
  try {
    const parsed = JSON.parse(localStorage.getItem(COUNTER_CACHE_KEY) || "{}");
    const cache = parsed[kind];
    if (!cache || typeof cache !== "object") return null;
    return {
      fetchedAt: Number(cache.fetchedAt || 0),
      returnedAt: Number(cache.returnedAt || 0),
      items: cache.items && typeof cache.items === "object" ? cache.items : {}
    };
  } catch {
    return null;
  }
}

function writeCounterCache(kind) {
  try {
    const parsed = JSON.parse(localStorage.getItem(COUNTER_CACHE_KEY) || "{}");
    const group = state.counters[kind] || { returnedAt: 0, items: {} };
    parsed[kind] = {
      fetchedAt: Date.now(),
      returnedAt: group.returnedAt || 0,
      items: group.items || {}
    };
    localStorage.setItem(COUNTER_CACHE_KEY, JSON.stringify(parsed));
  } catch {
    // Local storage can be unavailable in private modes; the backend remains the source of truth.
  }
}

function isCounterCacheFresh(cache) {
  return Boolean(cache && cache.fetchedAt && Date.now() - cache.fetchedAt < COUNTER_CACHE_TTL_MS);
}

function applyCounterCache(kind, cache) {
  state.counters[kind].returnedAt = Number(cache.returnedAt || 0);
  state.counters[kind].items = { ...state.counters[kind].items, ...(cache.items || {}) };
}

function metricText(value, suffix) {
  return `${Number(value || 0).toLocaleString("ja-JP")} ${suffix}`;
}

function numberOrZero(value) {
  return Number(value || 0);
}

function formatDateText(value) {
  return value ? formatDate.format(new Date(value)) : "";
}

async function shareItem(path, title) {
  const url = new URL(path, document.baseURI).href;
  if (navigator.share) {
    await navigator.share({ title, url });
    return;
  }
  await navigator.clipboard.writeText(url);
}

function markdownLite(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```([a-zA-Z0-9_-]*)\s*$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const language = fence[1] ? ` class="language-${escapeAttribute(fence[1])}"` : "";
      html.push(`<pre><code${language}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${parseInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      html.push("<hr>");
      index += 1;
      continue;
    }

    if (isMarkdownHtmlBlockStart(line)) {
      const block = [];
      while (index < lines.length && lines[index].trim()) {
        block.push(lines[index]);
        index += 1;
      }
      html.push(renderMarkdownHtmlBlock(block));
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      const tableLines = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      html.push(renderMarkdownTable(tableLines));
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
        index += 1;
      }
      html.push(`<blockquote>${markdownLite(quote.join("\n"))}</blockquote>`);
      continue;
    }

    if (isMarkdownListLine(line)) {
      const listLines = [];
      while (index < lines.length && isMarkdownListLine(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
      }
      html.push(renderMarkdownList(listLines));
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    const video = paragraph.length === 1 ? renderMarkdownVideo(paragraph[0]) : "";
    html.push(video || `<p>${renderMarkdownParagraph(paragraph)}</p>`);
  }

  return html.join("");
}

function isMarkdownBlockStart(line) {
  return /^\s{0,3}(#{1,6}\s+|>\s?|```|([-*_])(?:\s*\2){2,}\s*$)/.test(line) || isMarkdownListLine(line) || isMarkdownHtmlBlockStart(line);
}

function isMarkdownListLine(line) {
  return /^\s{0,6}(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
}

function renderMarkdownList(lines) {
  const root = { children: [] };
  const stack = [{ indent: -1, node: root }];
  for (const line of lines) {
    const match = line.match(/^(\s{0,6})([-*+]|\d+[.)])\s+(.+)$/);
    if (!match) continue;
    const entry = {
      indent: match[1].replace(/\t/g, "  ").length,
      ordered: /^\d/.test(match[2]),
      content: match[3],
      children: []
    };
    while (stack.length > 1 && entry.indent <= stack[stack.length - 1].indent) stack.pop();
    stack[stack.length - 1].node.children.push(entry);
    stack.push({ indent: entry.indent, node: entry });
  }
  return renderMarkdownListChildren(root.children);
}

function renderMarkdownListChildren(children) {
  let html = "";
  let index = 0;
  while (index < children.length) {
    const ordered = children[index].ordered;
    const tag = ordered ? "ol" : "ul";
    html += `<${tag}>`;
    while (index < children.length && children[index].ordered === ordered) {
      const child = children[index];
      html += `<li>${parseInlineMarkdown(child.content)}${renderMarkdownListChildren(child.children)}</li>`;
      index += 1;
    }
    html += `</${tag}>`;
  }
  return html;
}

function isMarkdownTableStart(lines, index) {
  return isMarkdownTableRow(lines[index]) && isMarkdownTableSeparator(lines[index + 1] || "");
}

function isMarkdownTableRow(line) {
  return typeof line === "string" && line.includes("|") && line.trim().length > 0;
}

function isMarkdownTableSeparator(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitMarkdownTableRow(line) {
  let source = String(line ?? "").trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|")) source = source.slice(0, -1);
  const cells = [];
  let current = "";
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current.trim());
  return cells;
}

function renderMarkdownTable(lines) {
  const header = splitMarkdownTableRow(lines[0]);
  const alignments = splitMarkdownTableRow(lines[1]).map((cell) => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
    if (trimmed.endsWith(":")) return "right";
    if (trimmed.startsWith(":")) return "left";
    return "";
  });
  const bodyRows = lines.slice(2).map(splitMarkdownTableRow);
  const alignAttribute = (index) => alignments[index] ? ` style="text-align: ${alignments[index]}"` : "";
  return `
    <div class="table-scroll">
      <table>
        <thead><tr>${header.map((cell, index) => `<th${alignAttribute(index)}>${parseInlineMarkdown(cell)}</th>`).join("")}</tr></thead>
        <tbody>
          ${bodyRows.map((row) => `<tr>${header.map((_, index) => `<td${alignAttribute(index)}>${parseInlineMarkdown(row[index] || "")}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderMarkdownParagraph(lines) {
  return lines.map((line, index) => {
    const text = line.replace(/\s{2,}$/, "");
    const separator = line.endsWith("  ") ? "<br>" : index < lines.length - 1 ? " " : "";
    return `${parseInlineMarkdown(text)}${separator}`;
  }).join("");
}

function renderMarkdownVideo(line) {
  const url = String(line ?? "").trim();
  const embedUrl = toEmbedUrl(url);
  if (embedUrl) {
    return `<div class="markdown-video"><iframe src="${escapeAttribute(embedUrl)}" title="Embedded video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`;
  }
  if (/^https?:\/\/\S+\.(?:mp4|webm|ogv|ogg)(?:[?#]\S*)?$/i.test(url)) {
    return `<div class="markdown-video"><video src="${escapeAttribute(url)}" controls preload="metadata"></video></div>`;
  }
  return "";
}

function isMarkdownHtmlBlockStart(line) {
  return /^\s{0,3}<\/?(?:address|article|aside|audio|blockquote|details|dialog|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|iframe|li|main|nav|ol|p|picture|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul|video)\b/i.test(line.trim());
}

function renderMarkdownHtmlBlock(lines) {
  return lines.map((line) => parseInlineMarkdown(line)).join("\n");
}

function parseInlineMarkdown(value) {
  const tokens = [];
  const store = (html) => {
    tokens.push(html);
    return `\u0000${tokens.length - 1}\u0000`;
  };
  let source = String(value ?? "");

  source = protectAllowedHtml(source, store);
  source = source.replace(/`([^`\n]+)`/g, (_, code) => store(`<code>${escapeHtml(code)}</code>`));
  source = source.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_, alt, url, title = "") => {
    const safeUrl = sanitizeMarkdownUrl(url, true);
    if (!safeUrl) return escapeHtml(_);
    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
    return store(`<img src="${escapeAttribute(safeUrl)}" alt="${escapeAttribute(alt)}"${titleAttribute}>`);
  });
  source = source.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_, label, url, title = "") => {
    const safeUrl = sanitizeMarkdownUrl(url, false);
    if (!safeUrl) return escapeHtml(label);
    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
    return store(`<a href="${escapeAttribute(safeUrl)}"${titleAttribute}>${parseInlineMarkdown(label)}</a>`);
  });
  source = source.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (match, prefix, url) => {
    const safeUrl = sanitizeMarkdownUrl(url, false);
    if (!safeUrl) return match;
    return `${prefix}${store(`<a href="${escapeAttribute(safeUrl)}">${escapeHtml(url)}</a>`)}`;
  });

  source = escapeHtml(source)
    .replace(/^\[x\]\s+(.+)$/i, '<span class="task-checkbox is-checked" aria-hidden="true"></span>$1')
    .replace(/^\[ \]\s+(.+)$/, '<span class="task-checkbox" aria-hidden="true"></span>$1')
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  return source.replace(/\u0000(\d+)\u0000/g, (_, tokenIndex) => tokens[Number(tokenIndex)] || "");
}

function protectAllowedHtml(source, store) {
  return source.replace(/<\/?[a-z][a-z0-9-]*(?:\s+[^<>]*?)?\s*\/?>/gi, (tag) => {
    const sanitized = sanitizeAllowedHtmlTag(tag);
    return sanitized ? store(sanitized) : tag;
  });
}

function sanitizeAllowedHtmlTag(tag) {
  const match = tag.match(/^<\s*(\/)?\s*([a-z][a-z0-9-]*)([\s\S]*?)\s*(\/?)>$/i);
  if (!match) return "";
  const closing = Boolean(match[1]);
  const tagName = match[2].toLowerCase();
  if (!ALLOWED_HTML_TAGS.has(tagName)) return "";
  if (closing) return `</${tagName}>`;
  const selfClosing = Boolean(match[4]) || VOID_HTML_TAGS.has(tagName);
  const attributes = sanitizeHtmlAttributes(match[3] || "", tagName);
  return `<${tagName}${attributes}${selfClosing && !VOID_HTML_TAGS.has(tagName) ? " /" : ""}>`;
}

function sanitizeHtmlAttributes(source, tagName) {
  const attributes = [];
  const pattern = /([^\s"'=<>`]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!isAllowedHtmlAttribute(name, tagName)) continue;
    const rawValue = match[3] ?? match[4] ?? match[5] ?? "";
    if (!rawValue && BOOLEAN_HTML_ATTRIBUTES.has(name)) {
      attributes.push(` ${name}`);
      continue;
    }
    if (!rawValue) continue;
    const value = sanitizeHtmlAttributeValue(name, rawValue);
    if (value === "") continue;
    attributes.push(` ${name}="${escapeAttribute(value)}"`);
  }
  return attributes.join("");
}

function isAllowedHtmlAttribute(name, tagName) {
  return ALLOWED_HTML_ATTRIBUTES.has(name)
    || BOOLEAN_HTML_ATTRIBUTES.has(name)
    || name.startsWith("data-")
    || name.startsWith("aria-")
    || (tagName === "a" && ["href", "target", "rel"].includes(name))
    || (["audio", "source", "track", "video"].includes(tagName) && ["src", "kind", "label", "poster", "preload", "srclang", "type"].includes(name))
    || (tagName === "iframe" && ["allow", "frameborder", "loading", "referrerpolicy", "src"].includes(name))
    || (tagName === "img" && ["src", "alt", "width", "height", "loading"].includes(name))
    || (["td", "th"].includes(tagName) && ["colspan", "rowspan"].includes(name));
}

function sanitizeHtmlAttributeValue(name, value) {
  const normalized = String(value ?? "").trim();
  if (["href", "src"].includes(name)) return sanitizeMarkdownUrl(normalized, name === "src");
  if (name === "style") {
    if (/expression\s*\(|javascript\s*:|url\s*\(/i.test(normalized)) return "";
    return normalized;
  }
  if (name === "target" && !["_blank", "_self", "_parent", "_top"].includes(normalized)) return "";
  return normalized;
}

function sanitizeMarkdownUrl(value, allowImageData) {
  const url = String(value ?? "").trim();
  if (!url) return "";
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(url)) return url;
  if (allowImageData && /^data:image\//i.test(url)) return url;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return "";
}

function toEmbedUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com")) {
      const id = parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).pop();
      return id ? `https://www.youtube.com/embed/${id}` : "";
    }
    if (parsed.hostname === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id ? `https://www.youtube.com/embed/${id}` : "";
    }
    if (parsed.hostname.includes("nicovideo.jp")) {
      const id = parsed.pathname.split("/").filter(Boolean).pop();
      return id ? `https://embed.nicovideo.jp/watch/${id}` : "";
    }
    if (parsed.hostname.includes("vimeo.com")) {
      const id = parsed.pathname.split("/").filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${id}` : "";
    }
  } catch {
    return "";
  }
  return "";
}

function emptyTemplate() {
  return `<div class="empty">表示できるコンテンツがありません。</div>`;
}

function pathForView(view) {
  const paths = {
    home: "./",
    blog: "blog/",
    works: "works/",
    games: "games/",
    contact: "contact/"
  };
  return paths[view] || "./";
}

function pathForBlog(id) {
  return `blog/${encodeURIComponent(id)}/`;
}

function pathForWork(id) {
  return `works/${encodeURIComponent(id)}/`;
}

function pathForGame(id) {
  return `games/${encodeURIComponent(id)}/`;
}

function goToPath(path) {
  location.href = new URL(path, document.baseURI).href;
}

function inferPageConfig() {
  const path = decodeURIComponent(location.pathname).replace(/\/index\.html$/, "/");
  const parts = path.split("/").filter(Boolean);
  const blogIndex = parts.lastIndexOf("blog");
  const workIndex = parts.lastIndexOf("works");
  const gameIndex = parts.lastIndexOf("games");
  if (blogIndex !== -1) {
    return {
      view: "blog",
      detailType: parts[blogIndex + 1] ? "blog" : "",
      detailId: parts[blogIndex + 1] || ""
    };
  }
  if (workIndex !== -1) {
    return {
      view: "works",
      detailType: parts[workIndex + 1] ? "work" : "",
      detailId: parts[workIndex + 1] || ""
    };
  }
  if (gameIndex !== -1) {
    return {
      view: "games",
      detailType: parts[gameIndex + 1] ? "game" : "",
      detailId: parts[gameIndex + 1] || ""
    };
  }
  if (parts.includes("contact")) return { view: "contact", detailType: "", detailId: "" };
  return { view: "home", detailType: "", detailId: "" };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

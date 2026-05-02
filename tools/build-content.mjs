import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const userRoot = path.join(root, "user_contents");
const outFile = path.join(root, "homepage_contents", "data", "content.json");

const ALLOWED_HTML_TAGS = new Set([
  "a", "abbr", "audio", "b", "br", "caption", "cite", "code", "del", "details", "div", "em", "figcaption",
  "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "iframe", "img", "kbd", "li", "mark",
  "ol", "p", "picture", "pre", "s", "small", "source", "span", "strong", "sub", "summary", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr", "track", "u", "ul", "video"
]);

const VOID_HTML_TAGS = new Set(["br", "hr", "img", "source", "track"]);
const BOOLEAN_HTML_ATTRIBUTES = new Set(["allowfullscreen", "autoplay", "controls", "loop", "muted", "open", "playsinline"]);
const ALLOWED_HTML_ATTRIBUTES = new Set(["align", "class", "height", "id", "style", "title", "width"]);

const site = {
  name: "ARCANADE",
  email: "contact@example.com",
  x: "https://x.com/",
  popularBlogId: ""
};

const data = {
  site: await readSite(),
  blogs: await readBlogs(),
  works: await readMarkdownCollection("work", normalizeWork),
  games: await readMarkdownCollection("game", normalizeGame)
};

await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(outFile, `${JSON.stringify(toPublicData(data), null, 2)}\n`, "utf8");
console.log(`Wrote ${path.relative(root, outFile)}`);

await writePages(data);

async function readSite() {
  const file = path.join(userRoot, "site.json");
  if (!(await exists(file))) return site;
  const source = JSON.parse(await fs.readFile(file, "utf8"));
  return { ...site, ...source };
}

async function readBlogs() {
  const directories = await listDirectories(path.join(userRoot, "blog"));
  const blogs = [];
  for (const directory of directories) {
    const file = path.join(directory, "index.md");
    if (!(await exists(file))) continue;
    const source = await fs.readFile(file, "utf8");
    const { frontMatter, body } = parseFrontMatter(source);
    const slug = path.basename(directory);
    blogs.push({
      id: slug,
      title: frontMatter.title || slug,
      updatedAt: frontMatter.updatedAt || inferDate(slug),
      summary: frontMatter.summary || firstSentence(body),
      pv: numberOrZero(frontMatter.pv),
      likes: numberOrZero(frontMatter.likes),
      body: body.trim()
    });
  }
  return sortByUpdated(blogs);
}

async function readMarkdownCollection(kind, normalize) {
  const directories = await listDirectories(path.join(userRoot, kind));
  const items = [];
  for (const directory of directories) {
    const markdownFile = path.join(directory, "index.md");
    const id = path.basename(directory);
    if (!(await exists(markdownFile))) continue;
    const source = await fs.readFile(markdownFile, "utf8");
    const { frontMatter, body } = parseFrontMatter(source);
    items.push(await normalize(frontMatter, id, directory, body.trim()));
  }
  return sortByUpdated(items);
}

async function normalizeWork(source, id, directory, body = "") {
  const media = Array.isArray(source.media)
    ? await Promise.all(source.media.map((entry) => normalizeMedia(entry, id, directory)))
    : [];
  const thumbnail = await normalizeAssetPath(source.thumbnail || media[0]?.thumbnail || media[0]?.src || "", id, directory);
  const description = body || source.description || source.summary || "";
  return {
    id,
    title: source.title || id,
    updatedAt: source.updatedAt || inferDate(id),
    summary: source.summary || firstSentence(description),
    description,
    thumbnail,
    pv: numberOrZero(source.pv),
    likes: numberOrZero(source.likes),
    media
  };
}

async function normalizeGame(source, id, directory, body = "") {
  const generatedBuildUrl = await copyGameBuild(id, directory);
  return {
    id,
    title: source.title || id,
    updatedAt: source.updatedAt || inferDate(id),
    summary: source.summary || firstSentence(body),
    pv: numberOrZero(source.pv),
    likes: numberOrZero(source.likes),
    buildUrl: source.buildUrl || generatedBuildUrl,
    body: body.trim()
  };
}

async function copyGameBuild(id, directory) {
  const source = path.join(directory, "build");
  const entry = path.join(source, "index.html");
  if (!(await exists(entry))) return "";
  const destination = path.join(root, "homepage_contents", "games", id, "build");
  await fs.mkdir(destination, { recursive: true });
  await copyDirectory(source, destination);
  return `games/${id}/build/index.html`;
}

async function copyDirectory(source, destination) {
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      await copyDirectory(from, to);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

async function normalizeMedia(entry, workId, directory) {
  const source = entry.src || "";
  const embedUrl = toEmbedUrl(entry.embedUrl || source);
  const normalizedSource = await normalizeAssetPath(source, workId, directory);
  const normalizedThumbnail = await normalizeAssetPath(entry.thumbnail || toVideoThumbnail(source) || source || "", workId, directory);
  return {
    type: embedUrl ? "video" : entry.type || "image",
    src: normalizedSource || embedUrl,
    embedUrl,
    thumbnail: normalizedThumbnail,
    title: entry.title || ""
  };
}

async function normalizeAssetPath(value, workId, directory) {
  if (!value || isExternalPath(value) || value.startsWith("assets/") || value.startsWith("works/") || value.startsWith("games/")) {
    return value || "";
  }
  const source = path.join(directory, value);
  if (!(await exists(source))) return value;
  const normalized = value.split(/[\\/]+/).filter(Boolean).join("/");
  const destination = path.join(root, "homepage_contents", "works", workId, normalized);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (await exists(destination)) {
    await fs.chmod(destination, 0o666).catch(() => {});
  }
  await fs.copyFile(source, destination);
  await fs.chmod(destination, 0o666).catch(() => {});
  return `works/${workId}/${normalized}`;
}

function isExternalPath(value) {
  return /^(https?:|data:|mailto:|tel:|#|\/)/.test(value);
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

function toVideoThumbnail(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com")) {
      const id = parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).pop();
      return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : "";
    }
    if (parsed.hostname === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : "";
    }
    if (parsed.hostname.includes("nicovideo.jp")) {
      const id = parsed.pathname.split("/").filter(Boolean).pop();
      return id ? `https://nicovideo.cdn.nimg.jp/thumbnails/${id.replace(/\D/g, "")}/${id.replace(/\D/g, "")}.L` : "";
    }
  } catch {
    return "";
  }
  return "";
}

async function listDirectories(directory) {
  if (!(await exists(directory))) return [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name));
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function parseFrontMatter(source) {
  const normalized = String(source ?? "").replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) return { frontMatter: {}, body: normalized };
  const endMatch = normalized.slice(4).match(/\n---\s*(?:\n|$)/);
  if (!endMatch) return { frontMatter: {}, body: normalized };
  const end = 4 + endMatch.index;
  const yaml = normalized.slice(4, end).trim();
  const body = normalized.slice(end + endMatch[0].length).trim();
  return { frontMatter: parseFrontMatterBlock(yaml), body };
}

function parseFrontMatterBlock(yaml) {
  const lines = String(yaml ?? "").split(/\n/);
  const frontMatter = {};
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith("#")) {
      index += 1;
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) {
      index += 1;
      continue;
    }
    const key = match[1];
    const inlineValue = match[2] ?? "";
    index += 1;
    if (inlineValue.trim()) {
      frontMatter[key] = parseFrontMatterValue(inlineValue);
      continue;
    }
    const block = [];
    while (index < lines.length && (/^\s/.test(lines[index]) || !lines[index].trim())) {
      block.push(lines[index]);
      index += 1;
    }
    frontMatter[key] = parseFrontMatterNestedValue(block);
  }
  return frontMatter;
}

function parseFrontMatterNestedValue(lines) {
  const text = lines.map((line) => line.replace(/^\s{2}/, "")).join("\n").trim();
  if (!text) return "";
  if (/^[\[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      // Fall through to the small YAML subset below.
    }
  }
  const nonEmpty = lines.filter((line) => line.trim());
  if (nonEmpty[0]?.trim().startsWith("-")) return parseFrontMatterArray(nonEmpty);
  return text;
}

function parseFrontMatterArray(lines) {
  const items = [];
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      if (current !== null) items.push(current);
      const value = trimmed.slice(2).trim();
      const pair = splitFrontMatterPair(value);
      current = pair ? { [pair.key]: parseFrontMatterValue(pair.value) } : parseFrontMatterValue(value);
      continue;
    }
    const pair = splitFrontMatterPair(trimmed);
    if (pair && current && typeof current === "object" && !Array.isArray(current)) {
      current[pair.key] = parseFrontMatterValue(pair.value);
    }
  }
  if (current !== null) items.push(current);
  return items;
}

function splitFrontMatterPair(value) {
  const index = String(value ?? "").indexOf(":");
  if (index === -1) return null;
  return {
    key: value.slice(0, index).trim(),
    value: value.slice(index + 1).trim()
  };
}

function parseFrontMatterValue(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (/^[\[{]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  if (/^null$/i.test(trimmed)) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function firstSentence(value) {
  const text = String(value ?? "").replace(/[#*_`~>\-[\]]/g, "").trim();
  return text.split(/\n|。/)[0].trim() || "";
}

function inferDate(slug) {
  const match = slug.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00+09:00` : new Date().toISOString();
}

function numberOrZero(value) {
  return Number(value || 0);
}

function sortByUpdated(items) {
  return items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

async function writePages(content) {
  const templatePath = path.join(root, "tools", "page-template.html");
  const template = await fs.readFile(templatePath, "utf8");
  const pages = [
    { file: path.join(root, "homepage_contents", "index.html"), base: "./", config: { view: "home", detailType: "", detailId: "" } },
    { file: path.join(root, "homepage_contents", "blog", "index.html"), base: "../", config: { view: "blog", detailType: "", detailId: "" } },
    { file: path.join(root, "homepage_contents", "works", "index.html"), base: "../", config: { view: "works", detailType: "", detailId: "" } },
    { file: path.join(root, "homepage_contents", "games", "index.html"), base: "../", config: { view: "games", detailType: "", detailId: "" } },
    { file: path.join(root, "homepage_contents", "contact", "index.html"), base: "../", config: { view: "contact", detailType: "", detailId: "" } }
  ];

  for (const blog of content.blogs) {
    pages.push({
      file: path.join(root, "homepage_contents", "blog", blog.id, "index.html"),
      base: "../../",
      config: { view: "blog", detailType: "blog", detailId: blog.id }
    });
  }

  for (const work of content.works) {
    pages.push({
      file: path.join(root, "homepage_contents", "works", work.id, "index.html"),
      base: "../../",
      config: { view: "works", detailType: "work", detailId: work.id }
    });
  }

  for (const game of content.games) {
    pages.push({
      file: path.join(root, "homepage_contents", "games", game.id, "index.html"),
      base: "../../",
      config: { view: "games", detailType: "game", detailId: game.id }
    });
  }

  await cleanupStaleGeneratedPages(root, content);

  for (const page of pages) {
    await fs.mkdir(path.dirname(page.file), { recursive: true });
    await fs.writeFile(page.file, renderPage(template, page.base, page.config, content), "utf8");
  }
  console.log(`Wrote ${pages.length} html pages`);
}

async function cleanupStaleGeneratedPages(root, content) {
  const groups = [
    ["blog", new Set(content.blogs.map((item) => item.id))],
    ["works", new Set(content.works.map((item) => item.id))],
    ["games", new Set(content.games.map((item) => item.id))]
  ];
  for (const [section, validIds] of groups) {
    const sectionDir = path.join(root, "homepage_contents", section);
    let entries = [];
    try {
      entries = await fs.readdir(sectionDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || validIds.has(entry.name)) continue;
      const detailDir = path.join(sectionDir, entry.name);
      const indexFile = path.join(detailDir, "index.html");
      await fs.rm(indexFile, { force: true });
      try {
        await fs.rmdir(detailDir);
      } catch {
        // Keep non-empty folders, such as media/build folders, but remove their stale shell index.
      }
    }
  }
}

function renderPage(template, base, config, content) {
  let html = template
    .replace(/<base href="[^"]*">/, `<base href="${base}">`)
    .replace(
      /window\.ARCANADE_PAGE = \{[\s\S]*?\};/,
      `window.ARCANADE_PAGE = ${JSON.stringify(config)};`
    );
  html = applyInitialView(html, config);
  html = applyInitialDetailState(html, config);
  html = injectStaticDetail(html, config, content);
  html = prunePageHtml(html, config);
  return html;
}

function prunePageHtml(html, config) {
  for (const view of ["home", "blog", "works", "games", "contact"]) {
    if (view !== config.view) html = removeViewSection(html, `${view}-view`);
  }
  if (config.view === "blog") {
    html = config.detailType === "blog"
      ? removeElementById(html, "div", "blog-list-view")
      : removeElementById(html, "article", "blog-detail-view");
  }
  if (config.view === "works") {
    html = config.detailType === "work"
      ? removeElementById(html, "div", "work-list-view")
      : removeElementById(html, "article", "work-detail-view");
  }
  return html;
}

function removeViewSection(html, id) {
  const startMatch = new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>`, "u").exec(html);
  if (!startMatch) return html;
  const start = startMatch.index;
  const searchFrom = start + startMatch[0].length;
  const nextViewMatch = /^\s*<section\b[^>]*\bclass="[^"]*\bview\b[^"]*"[^>]*>/mu.exec(html.slice(searchFrom));
  const mainClose = html.indexOf("</main>", searchFrom);
  const end = nextViewMatch ? searchFrom + nextViewMatch.index : mainClose;
  if (end === -1) return html;
  return html.slice(0, start) + html.slice(end);
}

function removeElementById(html, tag, id) {
  const startPattern = new RegExp(`<${tag}\\b[^>]*\\bid="${id}"[^>]*>`, "u");
  const startMatch = startPattern.exec(html);
  if (!startMatch) return html;
  const start = startMatch.index;
  const tokenPattern = new RegExp(`</?${tag}\\b[^>]*>`, "gu");
  tokenPattern.lastIndex = start + startMatch[0].length;
  let depth = 1;
  let match;
  while ((match = tokenPattern.exec(html))) {
    if (match[0].startsWith("</")) {
      depth -= 1;
    } else if (!match[0].endsWith("/>")) {
      depth += 1;
    }
    if (depth === 0) return html.slice(0, start) + html.slice(tokenPattern.lastIndex);
  }
  return html;
}

function toPublicData(content) {
  return {
    site: content.site,
    blogs: content.blogs.map(({ body, ...blog }) => blog),
    works: content.works,
    games: content.games.map(({ body, ...game }) => game)
  };
}

function applyInitialView(html, config) {
  const views = ["home", "blog", "works", "games", "contact"];
  for (const view of views) {
    html = setClassTokenOnElement(html, "section", `${view}-view`, "is-current", view === config.view);
    html = setClassTokenOnDataNav(html, view, "is-active", view === config.view);
  }
  return html;
}

function applyInitialDetailState(html, config) {
  html = setHiddenAttribute(html, "blog-list-view", config.detailType === "blog");
  html = setHiddenAttribute(html, "blog-detail-view", config.detailType !== "blog");
  html = setHiddenAttribute(html, "work-list-view", config.detailType === "work");
  html = setHiddenAttribute(html, "work-detail-view", config.detailType !== "work");
  return html;
}

function setClassTokenOnElement(html, tag, id, token, enabled) {
  return html.replace(new RegExp(`<${tag}([^>]*\\bid="${id}"[^>]*)>`, "u"), (match, attrs) => {
    const updated = updateClassAttribute(attrs, token, enabled);
    return `<${tag}${updated}>`;
  });
}

function setClassTokenOnDataNav(html, nav, token, enabled) {
  return html.replace(new RegExp(`<button([^>]*\\bdata-nav="${nav}"[^>]*)>`, "u"), (match, attrs) => {
    const updated = updateClassAttribute(attrs, token, enabled);
    return `<button${updated}>`;
  });
}

function updateClassAttribute(attrs, token, enabled) {
  if (/\bclass="/u.test(attrs)) {
    return attrs.replace(/\bclass="([^"]*)"/u, (classMatch, value) => {
      const tokens = new Set(value.split(/\s+/u).filter(Boolean));
      if (enabled) {
        tokens.add(token);
      } else {
        tokens.delete(token);
      }
      return `class="${[...tokens].join(" ")}"`;
    });
  }
  return enabled ? ` class="${token}"${attrs}` : attrs;
}

function setHiddenAttribute(html, id, hidden) {
  return html.replace(new RegExp(`<([a-z]+)([^>]*\\bid="${id}"[^>]*)>`, "u"), (match, tag, attrs) => {
    let nextAttrs = attrs.replace(/\s+hidden(?:="[^"]*")?/gu, "");
    if (hidden) nextAttrs += " hidden";
    return `<${tag}${nextAttrs}>`;
  });
}

function injectStaticDetail(html, config, content) {
  if (config.detailType === "blog") {
    const blog = content.blogs.find((item) => item.id === config.detailId);
    if (blog) return replaceElementInner(html, "article", "blog-detail-view", renderStaticBlog(blog));
  }
  if (config.detailType === "work") {
    const work = content.works.find((item) => item.id === config.detailId);
    if (work) return replaceElementInner(html, "article", "work-detail-view", renderStaticWork(work));
  }
  if (config.detailType === "game") {
    const game = content.games.find((item) => item.id === config.detailId);
    if (game) return replaceElementInner(html, "article", "game-stage", renderStaticGame(game));
  }
  return html;
}

function replaceElementInner(html, tag, id, innerHtml) {
  const pattern = new RegExp(`(<${tag}[^>]*\\bid="${id}"[^>]*>)[\\s\\S]*?(</${tag}>)`, "u");
  return html.replace(pattern, `$1${innerHtml}$2`);
}

function renderStaticBlog(blog) {
  const article = renderMarkdownArticle(blog.body || blog.summary || "");
  return `
            <div class="blog-detail-layout" data-static-detail="blog" data-static-id="${escapeAttribute(blog.id)}">
              ${renderBlogToc(article.toc, `blog/${blog.id}/`)}
              <div class="detail-shell blog-article">
                <div class="blog-title-row">
                  <a class="button back-button" href="blog/">一覧に戻る</a>
                  <h1>${escapeHtml(blog.title)}</h1>
                </div>
                <div class="meta-row">
                  <span>${formatDateText(blog.updatedAt)}</span>
                  <span data-counter-kind="blog" data-counter-id="${escapeAttribute(blog.id)}" data-counter-metric="pv">${metricText(blog.pv, "PV")}</span>
                  <span data-counter-kind="blog" data-counter-id="${escapeAttribute(blog.id)}" data-counter-metric="likes">${metricText(blog.likes, "いいね")}</span>
                </div>
                <div class="article-body">${article.html}</div>
                <div class="detail-actions">
                  <button class="like-button" type="button" data-like="${escapeAttribute(blog.id)}">いいね ${numberOrZero(blog.likes)}</button>
                  <button class="share-button" type="button" data-share="blog/${escapeAttribute(blog.id)}/" data-title="${escapeAttribute(blog.title)}">共有</button>
                </div>
              </div>
            </div>
          `;
}

function renderStaticWork(work) {
  const media = work.media?.length ? work.media : [{ type: "image", src: work.thumbnail || "assets/hero-arcanade.png", thumbnail: work.thumbnail || "assets/hero-arcanade.png", title: work.title }];
  const first = media[0];
  return `
            <div data-static-detail="work" data-static-id="${escapeAttribute(work.id)}">
              <a class="button back-button" href="works/">一覧に戻る</a>
              <div class="work-detail-grid">
                <section>
                  <div class="meta-row">
                    <span>${formatDateText(work.updatedAt)}</span>
                    <span data-counter-kind="works" data-counter-id="${escapeAttribute(work.id)}" data-counter-metric="pv">${metricText(work.pv, "PV")}</span>
                  </div>
                  <h1>${escapeHtml(work.title)}</h1>
                  <div class="article-body">${markdownLite(work.description || work.summary || "")}</div>
                  <div class="detail-actions">
                    <button class="like-button" type="button" data-like="${escapeAttribute(work.id)}">いいね ${numberOrZero(work.likes)}</button>
                    <button class="share-button" type="button" data-share="works/${escapeAttribute(work.id)}/" data-title="${escapeAttribute(work.title)}">共有</button>
                  </div>
                </section>
                <section>
                  <div class="media-frame" id="active-media">${renderMediaFrame(first, work.title)}</div>
                  <div class="media-rail">
                    ${media.map((entry, index) => `
                      <button type="button" class="${index === 0 ? "is-active" : ""} ${entry.type === "video" ? "is-video" : ""}" data-media-index="${index}" data-media-type="${escapeAttribute(entry.type || "image")}" data-media-src="${escapeAttribute(entry.src || "")}" data-media-embed="${escapeAttribute(entry.embedUrl || "")}" data-media-title="${escapeAttribute(entry.title || work.title)}">
                        <img class="thumb" src="${escapeAttribute(entry.thumbnail || entry.src)}" alt="${escapeAttribute(entry.title || work.title)}">
                      </button>
                    `).join("")}
                  </div>
                </section>
              </div>
            </div>
          `;
}

function renderStaticGame(game) {
  const bodyHtml = game.body ? `<div class="article-body game-description">${markdownLite(game.body)}</div>` : "";
  return `
            <div data-static-detail="game" data-static-id="${escapeAttribute(game.id)}">
              <div class="meta-row">
                <span>${formatDateText(game.updatedAt)}</span>
                <span data-counter-kind="games" data-counter-id="${escapeAttribute(game.id)}" data-counter-metric="pv">${metricText(game.pv, "PV")}</span>
                <span data-counter-kind="games" data-counter-id="${escapeAttribute(game.id)}" data-counter-metric="likes">${metricText(game.likes, "いいね")}</span>
              </div>
              <h2>${escapeHtml(game.title)}</h2>
              <p class="summary">${escapeHtml(game.summary || "")}</p>
              <div class="unity-frame" id="unity-frame">
                ${game.buildUrl ? `<iframe src="${escapeAttribute(game.buildUrl)}" title="${escapeAttribute(game.title)}" allowfullscreen></iframe>` : "<span>Unity WebGL build</span>"}
              </div>
              <div class="detail-actions">
                <button class="button" type="button" data-fullscreen>全画面</button>
                <button class="like-button" type="button" data-like="${escapeAttribute(game.id)}">いいね ${numberOrZero(game.likes)}</button>
                <button class="share-button" type="button" data-share="games/${escapeAttribute(game.id)}/" data-title="${escapeAttribute(game.title)}">共有</button>
              </div>
              ${bodyHtml}
            </div>
          `;
}

function renderMediaFrame(entry, fallbackTitle) {
  if (!entry) return "";
  if (entry.type === "video") {
    return `<iframe src="${escapeAttribute(entry.embedUrl || entry.src)}" title="${escapeAttribute(entry.title || fallbackTitle)}" allowfullscreen loading="lazy"></iframe>`;
  }
  return `<img src="${escapeAttribute(entry.src)}" alt="${escapeAttribute(entry.title || fallbackTitle)}">`;
}

function renderMarkdownArticle(text) {
  const toc = [];
  return {
    html: markdownLite(text, { toc, headingIds: new Map() }),
    toc
  };
}

function renderBlogToc(toc, basePath = "") {
  const entries = toc.map((item) => `
                  <a class="blog-toc-link level-${item.level}" href="${escapeAttribute(basePath)}#${escapeAttribute(item.id)}">${escapeHtml(item.title)}</a>
                `).join("");
  return `
              <aside class="blog-toc" aria-labelledby="blog-toc-title">
                <div class="blog-toc-head">
                  <h2 id="blog-toc-title">目次</h2>
                  <button class="blog-toc-toggle" type="button" data-toc-toggle aria-label="目次を折りたたむ" aria-expanded="true">☰</button>
                </div>
                <nav class="blog-toc-list" aria-label="記事内目次">
                  ${entries || '<span class="blog-toc-empty">見出しがありません</span>'}
                </nav>
              </aside>
            `;
}

function markdownLite(text, options = {}) {
  const lines = String(text ?? "").replace(/\r\n?/gu, "\n").split("\n");
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```([a-zA-Z0-9_-]*)\s*$/u);
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

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (heading) {
      const level = heading[1].length;
      const title = plainTextForHeading(heading[2]);
      const id = options.toc ? uniqueHeadingId(title, options.headingIds) : "";
      if (options.toc) options.toc.push({ id, title, level });
      const idAttribute = id ? ` id="${escapeAttribute(id)}"` : "";
      html.push(`<h${level}${idAttribute}>${parseInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/u.test(line)) {
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

    if (/^\s{0,3}>\s?/u.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s{0,3}>\s?/u.test(lines[index])) {
        quote.push(lines[index].replace(/^\s{0,3}>\s?/u, ""));
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
  return /^\s{0,3}(#{1,6}\s+|>\s?|```|([-*_])(?:\s*\2){2,}\s*$)/u.test(line) || isMarkdownListLine(line) || isMarkdownHtmlBlockStart(line);
}

function isMarkdownListLine(line) {
  return /^\s{0,6}(?:[-*+]\s+|\d+[.)]\s+)/u.test(line);
}

function renderMarkdownList(lines) {
  const root = { children: [] };
  const stack = [{ indent: -1, node: root }];
  for (const line of lines) {
    const match = line.match(/^(\s{0,6})([-*+]|\d+[.)])\s+(.+)$/u);
    if (!match) continue;
    const entry = {
      indent: match[1].replace(/\t/gu, "  ").length,
      ordered: /^\d/u.test(match[2]),
      content: match[3],
      children: []
    };
    while (stack.length > 1 && entry.indent <= stack[stack.length - 1].indent) stack.pop();
    stack[stack.length - 1].node.children.push(entry);
    stack.push({ indent: entry.indent, node: entry });
  }
  return renderMarkdownListChildren(root.children);
}

function isMarkdownTableStart(lines, index) {
  return isMarkdownTableRow(lines[index]) && isMarkdownTableSeparator(lines[index + 1] || "");
}

function isMarkdownTableRow(line) {
  return typeof line === "string" && line.includes("|") && line.trim().length > 0;
}

function isMarkdownTableSeparator(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()));
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

function renderMarkdownParagraph(lines) {
  return lines.map((line, index) => {
    const text = line.replace(/\s{2,}$/u, "");
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
  if (/^https?:\/\/\S+\.(?:mp4|webm|ogv|ogg)(?:[?#]\S*)?$/iu.test(url)) {
    return `<div class="markdown-video"><video src="${escapeAttribute(url)}" controls preload="metadata"></video></div>`;
  }
  return "";
}

function isMarkdownHtmlBlockStart(line) {
  return /^\s{0,3}<\/?(?:address|article|aside|audio|blockquote|details|dialog|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|iframe|li|main|nav|ol|p|picture|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul|video)\b/iu.test(line.trim());
}

function renderMarkdownHtmlBlock(lines) {
  return lines.map((line) => parseInlineMarkdown(line)).join("\n");
}

function uniqueHeadingId(title, headingIds = new Map()) {
  const base = slugifyHeadingId(title);
  const count = headingIds.get(base) || 0;
  headingIds.set(base, count + 1);
  return count ? `${base}-${count + 1}` : base;
}

function slugifyHeadingId(value) {
  const slug = String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug || "section";
}

function plainTextForHeading(value) {
  return String(value ?? "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s+[^<>]*?)?\s*\/?>/giu, "")
    .replace(/[#*_~]+/gu, "")
    .trim() || "セクション";
}

function parseInlineMarkdown(value) {
  const tokens = [];
  const store = (html) => {
    tokens.push(html);
    return `\u0000${tokens.length - 1}\u0000`;
  };
  let source = String(value ?? "");

  source = protectAllowedHtml(source, store);
  source = source.replace(/`([^`\n]+)`/gu, (_, code) => store(`<code>${escapeHtml(code)}</code>`));
  source = source.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/gu, (_, alt, url, title = "") => {
    const safeUrl = sanitizeMarkdownUrl(url, true);
    if (!safeUrl) return escapeHtml(_);
    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
    return store(`<img src="${escapeAttribute(safeUrl)}" alt="${escapeAttribute(alt)}"${titleAttribute}>`);
  });
  source = source.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/gu, (_, label, url, title = "") => {
    const safeUrl = sanitizeMarkdownUrl(url, false);
    if (!safeUrl) return escapeHtml(label);
    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
    return store(`<a href="${escapeAttribute(safeUrl)}"${titleAttribute}>${parseInlineMarkdown(label)}</a>`);
  });
  source = source.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/gu, (match, prefix, url) => {
    const safeUrl = sanitizeMarkdownUrl(url, false);
    if (!safeUrl) return match;
    return `${prefix}${store(`<a href="${escapeAttribute(safeUrl)}">${escapeHtml(url)}</a>`)}`;
  });

  source = escapeHtml(source)
    .replace(/^\[x\]\s+(.+)$/iu, '<span class="task-checkbox is-checked" aria-hidden="true"></span>$1')
    .replace(/^\[ \]\s+(.+)$/u, '<span class="task-checkbox" aria-hidden="true"></span>$1')
    .replace(/~~(.+?)~~/gu, "<del>$1</del>")
    .replace(/\*\*(.+?)\*\*/gu, "<strong>$1</strong>")
    .replace(/(^|[^\*])\*([^*\n]+)\*/gu, "$1<em>$2</em>");

  return source.replace(/\u0000(\d+)\u0000/gu, (_, tokenIndex) => tokens[Number(tokenIndex)] || "");
}

function protectAllowedHtml(source, store) {
  return source.replace(/<\/?[a-z][a-z0-9-]*(?:\s+[^<>]*?)?\s*\/?>/giu, (tag) => {
    const sanitized = sanitizeAllowedHtmlTag(tag);
    return sanitized ? store(sanitized) : tag;
  });
}

function sanitizeAllowedHtmlTag(tag) {
  const match = tag.match(/^<\s*(\/)?\s*([a-z][a-z0-9-]*)([\s\S]*?)\s*(\/?)>$/iu);
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
  const pattern = /([^\s"'=<>`]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
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
    if (/expression\s*\(|javascript\s*:|url\s*\(/iu.test(normalized)) return "";
    return normalized;
  }
  if (name === "target" && !["_blank", "_self", "_parent", "_top"].includes(normalized)) return "";
  return normalized;
}

function sanitizeMarkdownUrl(value, allowImageData) {
  const url = String(value ?? "").trim();
  if (!url) return "";
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/iu.test(url)) return url;
  if (allowImageData && /^data:image\//iu.test(url)) return url;
  if (!/^[a-z][a-z0-9+.-]*:/iu.test(url)) return url;
  return "";
}

function metricText(value, suffix) {
  return `${numberOrZero(value).toLocaleString("ja-JP")} ${suffix}`;
}

function formatDateText(value) {
  return value ? new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

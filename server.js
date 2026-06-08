import express from "express";
import path from "path";
import fs from "fs/promises";
import { createReadStream, existsSync, watch } from "fs";
import crypto from "crypto";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

const ROOT_DIR = path.resolve(process.cwd());
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DEBUG_DIR = path.join(ROOT_DIR, ".dbg");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
const MODS_DIR = path.join(UPLOADS_DIR, "mods");
const GALLERY_DIR = path.join(UPLOADS_DIR, "gallery");
const DEVELOPER_COVERS_DIR = path.join(UPLOADS_DIR, "developers");
const USER_AVATARS_DIR = path.join(UPLOADS_DIR, "users");
const FEEDBACK_UPLOADS_DIR = path.join(UPLOADS_DIR, "feedback");
const DEVELOPER_SHELL_HTML = path.join(PUBLIC_DIR, "developer-shell.html");
const CONFIG_DIR = path.join(PUBLIC_DIR, "config");
const ANNOUNCEMENTS_TXT = path.join(CONFIG_DIR, "announcements.txt");
const EXTERNAL_MODS_JSON = path.join(CONFIG_DIR, "external_mods.json");
const DEVELOPERS_JSON = path.join(CONFIG_DIR, "developers.json");
const CHANGELOG_JSON = path.join(CONFIG_DIR, "changelog.json");
const ASSETS_DIR = path.join(PUBLIC_DIR, "assets");
const DEFAULT_AVATAR_URL = "/assets/logo.png";
const USER_INTRO_MAX_LENGTH = 80;
const PREVIEW_BRANCH_PATTERN = /(beta|preview|alpha|test|internal|sponsor|内测|尝鲜)/i;
const FIXED_BRANCHES = ["main", "neoforge", "sponsor"];
const SPONSOR_BRANCHES = new Set(["sponsor", "beta", "preview", "internal"]);
const BRANCH_DIRECTORY_ALIASES = {
  main: ["forge", "", "main"],
  neoforge: ["neoforge"],
  sponsor: ["内测版(赞助)", "内测版", "sponsor", "preview", "beta", "internal"],
};
const ROLE_PRESETS = {
  admin: {
    key: "admin",
    label: "管理员",
    permissionLevel: 3,
  },
  service: {
    key: "service",
    label: "客服",
    permissionLevel: 3,
  },
  sponsor: {
    key: "sponsor",
    label: "赞助者",
    permissionLevel: 2,
  },
  guest: {
    key: "guest",
    label: "游客",
    permissionLevel: 1,
  },
};
const ROLE_BADGE_META = {
  admin: { label: "管理员", className: "is-admin", accentA: "#22c55e", accentB: "#16a34a" },
  service: { label: "客服", className: "is-service", accentA: "#facc15", accentB: "#eab308" },
  sponsor: { label: "赞助者", className: "is-sponsor", accentA: "#fb923c", accentB: "#ea580c" },
  guest: { label: "游客", className: "is-guest", accentA: "#9ca3af", accentB: "#6b7280" },
};

const ONE_MINUTE_MS = 60_000;
const APP_NAME = "nsimu-like-site";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD ?? "";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "";
const COOKIE_SECURE =
  process.env.COOKIE_SECURE === "1" ||
  process.env.COOKIE_SECURE === "true" ||
  process.env.COOKIE_SECURE === "yes";
const FORCE_PORT =
  process.env.FORCE_PORT === "1" ||
  process.env.FORCE_PORT === "true" ||
  process.env.FORCE_PORT === "yes";

function getDebugLogFilePath(sessionId) {
  const safeSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!/^[a-z0-9-]{2,80}$/.test(safeSessionId)) return null;
  return path.join(DEBUG_DIR, `trae-debug-log-${safeSessionId}.ndjson`);
}

async function appendDebugEvent(event) {
  const sessionId = typeof event?.sessionId === "string" ? event.sessionId : "";
  const filePath = getDebugLogFilePath(sessionId);
  if (!filePath) return false;
  const payload = {
    sessionId,
    runId: typeof event?.runId === "string" ? event.runId : "pre-fix",
    hypothesisId: typeof event?.hypothesisId === "string" ? event.hypothesisId : "",
    ts: Number.isFinite(Number(event?.ts)) ? Number(event.ts) : Date.now(),
    location: typeof event?.location === "string" ? event.location : "",
    msg: typeof event?.msg === "string" ? event.msg : "[DEBUG] event",
    href: typeof event?.href === "string" ? event.href : "",
    name: typeof event?.name === "string" ? event.name : "",
    data: event?.data ?? null,
  };
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
  return true;
}

function isLoopbackRequest(req) {
  const ip = req.socket?.remoteAddress ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function safeJoin(baseDir, ...parts) {
  const fullPath = path.resolve(baseDir, ...parts);
  const rel = path.relative(baseDir, fullPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return fullPath;
}

function formatVersionGuess(fileName) {
  const base = fileName.replace(/\.(zip|jar)$/i, "");
  const match = base.match(/(\d+\.\d+\.\d+[^-_ ]*)/);
  return match?.[1] ?? base;
}

function randomId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function randomTokenBase64Url(byteCount) {
  return crypto
    .randomBytes(byteCount)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function parseCookies(req) {
  const header = req.headers.cookie ?? "";
  const out = {};
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function getCookie(req, name) {
  const cookies = parseCookies(req);
  return cookies[name] ?? "";
}

function setCookie(res, name, value, options) {
  const attrs = [];
  attrs.push(`${name}=${encodeURIComponent(value)}`);
  if (options?.maxAgeSec != null) attrs.push(`Max-Age=${options.maxAgeSec}`);
  if (options?.path) attrs.push(`Path=${options.path}`);
  if (options?.httpOnly) attrs.push("HttpOnly");
  if (options?.sameSite) attrs.push(`SameSite=${options.sameSite}`);
  if (options?.secure) attrs.push("Secure");
  res.append("Set-Cookie", attrs.join("; "));
}

function hashSessionToken(token) {
  const secret = SESSION_SECRET || "dev_secret";
  return crypto.createHmac("sha256", secret).update(token).digest("base64url");
}

async function scryptHash(password, saltBase64) {
  const salt = Buffer.from(saltBase64, "base64");
  const key = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
  return Buffer.from(key).toString("base64");
}

async function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("base64");
  const hash = await scryptHash(password, salt);
  return { salt, hash };
}

async function verifyPassword(password, record) {
  if (!record || typeof record.salt !== "string" || typeof record.hash !== "string") {
    return false;
  }
  const calc = await scryptHash(password, record.salt);
  const a = Buffer.from(record.hash, "base64");
  const b = Buffer.from(calc, "base64");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

class ExpiringCache {
  #store = new Map();

  get(key) {
    const entry = this.#store.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs <= Date.now()) {
      this.#store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    this.#store.set(key, { value, expiresAtMs: Date.now() + ttlMs });
  }

  delete(key) {
    this.#store.delete(key);
  }

  deleteByPrefix(prefix) {
    for (const key of this.#store.keys()) {
      if (key.startsWith(prefix)) this.#store.delete(key);
    }
  }
}

const cache = new ExpiringCache();

function setupDirWatch(dirPath, cacheKeysToInvalidate) {
  try {
    if (!existsSync(dirPath)) return;
    watch(
      dirPath,
      { recursive: true },
      () => {
        for (const key of cacheKeysToInvalidate) {
          if (key.endsWith("*")) {
            cache.deleteByPrefix(key.slice(0, -1));
          } else {
            cache.delete(key);
          }
        }
      },
    );
  } catch {
  }
}

setupDirWatch(MODS_DIR, ["branches", "mods:*"]);
setupDirWatch(GALLERY_DIR, ["gallery:categories"]);
setupDirWatch(CONFIG_DIR, ["announcements", "external_mods", "developers", "changelog"]);

async function fileExists(filePath) {
  try {
    const st = await fs.stat(filePath);
    return st.isFile();
  } catch {
    return false;
  }
}

async function bootstrapAssets() {
  const logoSource =
    process.env.LOGO_SOURCE ??
    "C:\\Users\\nqwer\\Desktop\\千恋万花穗织还原\\素材\\MC_XiaoLiangdd_vzge face.png";

  const devSources = [
    {
      src:
        process.env.DEV_XIAOLIANG_SOURCE ??
        "C:\\Users\\nqwer\\Desktop\\千恋万花穗织还原\\素材\\MC_XiaoLiangdd_vzge face.png",
      dest: path.join(ASSETS_DIR, "devs", "xiaoliang.png"),
    },
    {
      src:
        process.env.DEV_KAFEI_SOURCE ??
        "C:\\Users\\nqwer\\Desktop\\千恋万花穗织还原\\素材\\mckafei_CN_vzge face.png",
      dest: path.join(ASSETS_DIR, "devs", "kafei.png"),
    },
    {
      src:
        process.env.DEV_MENGLAN_SOURCE ??
        "C:\\Users\\nqwer\\Desktop\\千恋万花穗织还原\\素材\\menglannnn_vzge face.png",
      dest: path.join(ASSETS_DIR, "devs", "menglannnn.png"),
    },
  ];

  try {
    await fs.mkdir(path.join(ASSETS_DIR, "devs"), { recursive: true });
    await fs.mkdir(ASSETS_DIR, { recursive: true });

    const logoDest = path.join(ASSETS_DIR, "logo.png");
    if (!(await fileExists(logoDest)) && (await fileExists(logoSource))) {
      await fs.copyFile(logoSource, logoDest);
    }

    for (const item of devSources) {
      if (!(await fileExists(item.dest)) && (await fileExists(item.src))) {
        await fs.copyFile(item.src, item.dest);
      }
    }
  } catch {
  }
}

async function listBranches() {
  const cached = cache.get("branches");
  if (cached) return cached;
  const branches = [...FIXED_BRANCHES];
  cache.set("branches", branches, ONE_MINUTE_MS);
  return branches;
}

function parseFileNameFromUrl(url) {
  try {
    const u = new URL(url);
    const fileName = u.searchParams.get("fileName") || "";
    if (fileName) return fileName;
    const pathPart = u.pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(pathPart);
  } catch {
    return "";
  }
}

function normalizeExternalLink(link, index) {
  if (!link || typeof link !== "object") return null;
  const url = typeof link.url === "string" ? link.url.trim() : "";
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }

  const rawLabel = typeof link.label === "string" ? link.label.trim() : "";
  const label = rawLabel || `站外下载 ${index + 1}`;
  return { label: label.slice(0, 40), url };
}

function parseExternalConfigEntry(entry) {
  const branch = normalizeBranchInput(
    typeof entry?.branch === "string" && entry.branch.trim() ? entry.branch.trim() : "main",
  );
  const linksRaw = Array.isArray(entry?.links)
    ? entry.links
    : [
        {
          label: typeof entry?.label === "string" ? entry.label : "",
          url:
            (typeof entry?.externalUrl === "string" ? entry.externalUrl : "") ||
            (typeof entry?.url === "string" ? entry.url : ""),
        },
      ];
  const links = linksRaw
    .map((link, index) => normalizeExternalLink(link, index))
    .filter(Boolean);
  const fileName =
    (typeof entry?.fileName === "string" ? entry.fileName.trim() : "") ||
    (links[0]?.url ? parseFileNameFromUrl(links[0].url) : "") ||
    "";
  if (!fileName) return null;

  const description = typeof entry?.description === "string" ? entry.description.trim() : "";

  if (links.length === 0 && !description) return null;
  return { branch, fileName, description, links };
}

async function readExternalModsConfig() {
  const cached = cache.get("external_mods");
  if (cached) return cached;

  const list = await readExternalModsConfigUncached();
  cache.set("external_mods", list, 10_000);
  return list;
}

async function readExternalModsConfigUncached() {
  let data = null;
  try {
    const raw = await fs.readFile(EXTERNAL_MODS_JSON, "utf-8");
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  const items = Array.isArray(data?.mods) ? data.mods : [];
  return items.map(parseExternalConfigEntry).filter(Boolean);
}

let externalModsWriteChain = Promise.resolve();

function enqueueExternalModsWrite(task) {
  externalModsWriteChain = externalModsWriteChain.then(() => task()).catch(() => {});
  return externalModsWriteChain;
}

async function writeExternalModsConfig(items) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(
    EXTERNAL_MODS_JSON,
    JSON.stringify({ version: 2, mods: items }, null, 2),
    "utf-8",
  );
  cache.delete("external_mods");
  cache.delete("branches");
  cache.deleteByPrefix("mods:");
}

function normalizeBranchInput(branch) {
  const raw = typeof branch === "string" ? branch.trim().toLowerCase() : "";
  if (!raw || raw === "main" || raw === "forge") return "main";
  if (raw === "neoforge") return "neoforge";
  if (SPONSOR_BRANCHES.has(raw) || PREVIEW_BRANCH_PATTERN.test(raw)) return "sponsor";
  return raw;
}

function getBranchDirectoryCandidates(branch) {
  const normalizedBranch = normalizeBranchInput(branch);
  const aliases = BRANCH_DIRECTORY_ALIASES[normalizedBranch] ?? [normalizedBranch];
  const seen = new Set();
  const dirs = [];
  for (const alias of aliases) {
    const dirPath = alias ? safeJoin(MODS_DIR, alias) : MODS_DIR;
    if (!dirPath || seen.has(dirPath)) continue;
    seen.add(dirPath);
    dirs.push(dirPath);
  }
  return dirs;
}

function getPrimaryBranchDirectory(branch) {
  return getBranchDirectoryCandidates(branch)[0] ?? null;
}

async function resolveBranchFilePath(branch, fileName) {
  for (const dirPath of getBranchDirectoryCandidates(branch)) {
    const filePath = safeJoin(dirPath, fileName);
    if (!filePath) continue;
    try {
      const st = await fs.stat(filePath);
      if (st.isFile()) return filePath;
    } catch {
    }
  }
  return null;
}

function isValidBranchName(branch) {
  return /^[a-zA-Z0-9._-]+$/.test(branch);
}

function isManagedBranch(branch) {
  return FIXED_BRANCHES.includes(normalizeBranchInput(branch));
}

function isValidModFileName(fileName) {
  return (
    typeof fileName === "string" &&
    fileName.length > 0 &&
    fileName.length <= 200 &&
    !fileName.includes("/") &&
    !fileName.includes("\\") &&
    /\.(zip|jar)$/i.test(fileName)
  );
}

function isValidImageFileName(fileName) {
  return (
    typeof fileName === "string" &&
    fileName.length > 0 &&
    fileName.length <= 120 &&
    !fileName.includes("/") &&
    !fileName.includes("\\") &&
    /\.(png|jpe?g|webp|gif)$/i.test(fileName)
  );
}

function isValidFeedbackDraftId(draftId) {
  return typeof draftId === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(draftId);
}

function isValidFeedbackFileName(fileName) {
  return (
    typeof fileName === "string" &&
    fileName.length > 0 &&
    fileName.length <= 180 &&
    !/[<>:"/\\|?*\x00-\x1f]/.test(fileName)
  );
}

function normalizeFeedbackType(type) {
  return type === "bug" ? "bug" : "suggestion";
}

function sanitizeFeedbackAttachments(items, kind, draftId) {
  if (!Array.isArray(items) || !isValidFeedbackDraftId(draftId)) return [];
  const subDir = kind === "image" ? "images" : "files";
  const expectedPrefix = `/uploads/feedback/${encodeURIComponent(draftId)}/${subDir}/`;
  const maxCount = kind === "image" ? 8 : 8;
  return items
    .map((item) => {
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      const url = typeof item?.url === "string" ? item.url.trim() : "";
      const size = Number(item?.size ?? 0);
      const validName = kind === "image" ? isValidImageFileName(name) : isValidFeedbackFileName(name);
      if (!validName || !url.startsWith(expectedPrefix)) return null;
      return {
        kind,
        name,
        url,
        size: Number.isFinite(size) && size > 0 ? size : 0,
      };
    })
    .filter(Boolean)
    .slice(0, maxCount);
}

async function listMods(branch) {
  const normalizedBranch = normalizeBranchInput(branch);
  const key = `mods:${normalizedBranch}`;
  const cached = cache.get(key);
  if (cached) return cached;

  if (!isManagedBranch(normalizedBranch)) return [];
  const branchDirs = getBranchDirectoryCandidates(normalizedBranch);
  if (branchDirs.length === 0) return [];

  let mods = [];
  const seenFiles = new Set();
  for (const branchDir of branchDirs) {
    try {
      const entries = await fs.readdir(branchDir, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .filter((name) => /\.(zip|jar)$/i.test(name))
        .filter((name) => !seenFiles.has(name));

      const stats = await Promise.all(
        files.map(async (fileName) => {
          const fullPath = path.join(branchDir, fileName);
          const st = await fs.stat(fullPath);
          seenFiles.add(fileName);
          return {
            fileName,
            sizeBytes: st.size,
            mtimeMs: st.mtimeMs,
          };
        }),
      );

      mods.push(
        ...stats.map((item) => ({
          ...item,
          branch: normalizedBranch,
          versionGuess: formatVersionGuess(item.fileName),
          url: `/download/${encodeURIComponent(normalizedBranch)}/${encodeURIComponent(
            item.fileName,
          )}`,
        })),
      );
    } catch {
    }
  }

  try {
    const ext = await readExternalModsConfig();
    const extForBranch = ext.filter((m) => m.branch === normalizedBranch);
    const used = new Set();

    mods = mods.map((m) => {
      const hit = extForBranch.find((x) => x.fileName === m.fileName);
      if (!hit) return m;
      used.add(`${hit.branch}::${hit.fileName}`);
      return {
        ...m,
        externalLinks: hit.links,
        description: hit.description || "",
      };
    });

    const leftovers = extForBranch.filter((x) => !used.has(`${x.branch}::${x.fileName}`));
    const externalOnly = leftovers.map((x) => ({
      branch: normalizedBranch,
      fileName: x.fileName,
      sizeBytes: null,
      mtimeMs: 0,
      versionGuess: formatVersionGuess(x.fileName),
      externalOnly: true,
      externalLinks: x.links,
      description: x.description || "",
    }));
    mods = [...mods, ...externalOnly];
  } catch {
  }

  mods.sort((a, b) => {
    const am = Number.isFinite(a?.mtimeMs) ? a.mtimeMs : 0;
    const bm = Number.isFinite(b?.mtimeMs) ? b.mtimeMs : 0;
    return bm - am;
  });

  cache.set(key, mods, ONE_MINUTE_MS);
  return mods;
}

async function readAnnouncements() {
  const cached = cache.get("announcements");
  if (cached) return cached;

  let announcements = [];
  try {
    const raw = await fs.readFile(ANNOUNCEMENTS_TXT, "utf-8");
    announcements = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    announcements = [];
  }

  cache.set("announcements", announcements, 10_000);
  return announcements;
}

function sanitizeChangelogDate(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = raw ? new Date(raw) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const y = safe.getFullYear();
  const m = String(safe.getMonth() + 1).padStart(2, "0");
  const d = String(safe.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function sanitizeChangelogEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const title = typeof entry.title === "string" ? entry.title.trim().slice(0, 60) : "";
  const summary = typeof entry.summary === "string" ? entry.summary.trim().slice(0, 240) : "";
  if (!title || !summary) return null;
  const version = typeof entry.version === "string" ? entry.version.trim().slice(0, 40) : "";
  const createdAtRaw = typeof entry.createdAt === "string" ? entry.createdAt.trim() : "";
  const createdAt = !createdAtRaw || Number.isNaN(new Date(createdAtRaw).getTime())
    ? new Date().toISOString()
    : new Date(createdAtRaw).toISOString();
  return {
    id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : randomId(),
    version,
    title,
    summary,
    date: sanitizeChangelogDate(entry.date ?? entry.createdAt ?? createdAt),
    createdAt,
  };
}

async function readChangelog() {
  const cached = cache.get("changelog");
  if (cached) return cached;

  let data = null;
  try {
    const raw = await fs.readFile(CHANGELOG_JSON, "utf-8");
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  const items = Array.isArray(data?.items)
    ? data.items
        .map((item) => sanitizeChangelogEntry(item))
        .filter(Boolean)
        .sort((left, right) => {
          return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
        })
    : [];
  cache.set("changelog", items, 10_000);
  return items;
}

async function writeChangelog(items) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(
    CHANGELOG_JSON,
    JSON.stringify({ version: 1, items }, null, 2),
    "utf-8",
  );
  cache.set("changelog", items, 10_000);
}

async function listGalleryCategories() {
  const cached = cache.get("gallery:categories");
  if (cached) return cached;

  let categories = [];
  try {
    const entries = await fs.readdir(GALLERY_DIR, { withFileTypes: true });
    categories = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    categories = [];
  }

  cache.set("gallery:categories", categories, ONE_MINUTE_MS);
  return categories;
}

async function listGalleryImages(category) {
  const normalized = (category ?? "").trim();
  const dir =
    normalized.length > 0 ? safeJoin(GALLERY_DIR, normalized) : GALLERY_DIR;
  if (!dir) return [];

  let images = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(name));

    const stats = await Promise.all(
      files.map(async (fileName) => {
        const fullPath = path.join(dir, fileName);
        const st = await fs.stat(fullPath);
        return { fileName, mtimeMs: st.mtimeMs };
      }),
    );

    stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    images = stats.map(({ fileName }) => ({
      fileName,
      url: normalized
        ? `/uploads/gallery/${encodeURIComponent(
            normalized,
          )}/${encodeURIComponent(fileName)}`
        : `/uploads/gallery/${encodeURIComponent(fileName)}`,
      category: normalized || null,
    }));
  } catch {
    images = [];
  }

  return images;
}

const DATA_DIR = path.join(ROOT_DIR, "data");
const FEEDBACK_JSON = path.join(DATA_DIR, "feedback.json");
const USERS_JSON = path.join(DATA_DIR, "users.json");
let feedbackWriteChain = Promise.resolve();
let changelogWriteChain = Promise.resolve();

const SESSION_COOKIE_NAME = "sid";
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const sessions = new Map();

function cleanupSessions() {
  const now = Date.now();
  for (const [key, val] of sessions.entries()) {
    if (!val || val.expiresAtMs <= now) sessions.delete(key);
  }
}

function createSession(res, username) {
  cleanupSessions();
  const token = randomTokenBase64Url(32);
  const tokenHash = hashSessionToken(token);
  sessions.set(tokenHash, {
    username,
    expiresAtMs: Date.now() + SESSION_TTL_MS,
  });

  setCookie(res, SESSION_COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: COOKIE_SECURE,
    maxAgeSec: Math.floor(SESSION_TTL_MS / 1000),
  });
}

function destroySession(req, res) {
  const token = getCookie(req, SESSION_COOKIE_NAME);
  if (token) sessions.delete(hashSessionToken(token));
  setCookie(res, SESSION_COOKIE_NAME, "", {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: COOKIE_SECURE,
    maxAgeSec: 0,
  });
}

function getSessionUsername(req) {
  cleanupSessions();
  const token = getCookie(req, SESSION_COOKIE_NAME);
  if (!token) return "";
  const entry = sessions.get(hashSessionToken(token));
  if (!entry) return "";
  if (entry.expiresAtMs <= Date.now()) return "";
  return entry.username;
}

let usersWriteChain = Promise.resolve();

const ADMIN_ACCOUNT_MAPPINGS = [
  {
    qq: "2375505742",
    alias: "xiaoliang",
    slug: "xiaoliang",
    displayName: "小亮",
  },
  {
    qq: "1780412693",
    alias: "kafei",
    slug: "kafei",
    displayName: "咖啡",
  },
  {
    qq: "3630797734",
    alias: "menglannnn",
    slug: "menglannnn",
    displayName: "梦蓝",
  },
];

const RADAR_KEYS = ["ideas", "innovation", "logic", "tech", "service", "engagement"];
let developersWriteChain = Promise.resolve();

function enqueueUsersWrite(task) {
  usersWriteChain = usersWriteChain.then(() => task()).catch(() => {});
  return usersWriteChain;
}

async function readUsers() {
  const cached = cache.get("users");
  if (cached) return cached;

  let data = null;
  try {
    const raw = await fs.readFile(USERS_JSON, "utf-8");
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  const users = Array.isArray(data?.users)
    ? data.users.map((item) => sanitizeStoredUser(item)).filter(Boolean)
    : [];
  cache.set("users", users, 10_000);
  return users;
}

async function writeUsers(users) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(USERS_JSON, JSON.stringify({ version: 1, users }, null, 2), "utf-8");
  cache.set("users", users, 10_000);
}

function sanitizeUserAvatar(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw && isValidRelativeOrHttpUrl(raw) ? raw : DEFAULT_AVATAR_URL;
}

function sanitizeUserIntro(value) {
  return typeof value === "string" ? value.trim().slice(0, USER_INTRO_MAX_LENGTH) : "";
}

function normalizeRoleKey(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "admin" || raw === "service" || raw === "sponsor" || raw === "guest") {
    return raw;
  }
  return "guest";
}

function normalizeWallType(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "developer" || raw === "sponsor") return raw;
  return "none";
}

function normalizeDeveloperSourceType(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw === "account" ? "account" : "core";
}

function getRolePreset(value) {
  return ROLE_PRESETS[normalizeRoleKey(value)] ?? ROLE_PRESETS.guest;
}

function getRoleBadge(value) {
  const roleKey = normalizeRoleKey(value);
  const badge = ROLE_BADGE_META[roleKey] ?? ROLE_BADGE_META.guest;
  return {
    key: roleKey,
    label: badge.label,
    className: badge.className,
    accentA: badge.accentA,
    accentB: badge.accentB,
  };
}

function getUserPermissionLevel(user) {
  if (!user) return 0;
  const explicit = Number(user.permissionLevel);
  if (Number.isFinite(explicit) && explicit >= 1 && explicit <= 3) {
    return Math.max(1, Math.min(3, Math.round(explicit)));
  }
  return getRolePreset(user.roleKey ?? user.role).permissionLevel;
}

function hasPermissionLevel(user, minLevel) {
  return getUserPermissionLevel(user) >= minLevel;
}

function isPreviewBranch(branch) {
  const normalized = normalizeBranchInput(branch);
  return normalized === "sponsor";
}

function canAccessPreview(user) {
  return hasPermissionLevel(user, 2);
}

function canAccessBranch(user, branch) {
  const normalized = normalizeBranchInput(branch);
  if (!isManagedBranch(normalized)) return false;
  return !isPreviewBranch(normalized) || canAccessPreview(user);
}

function filterBranchesForUser(branches, user) {
  return branches
    .map((branch) => normalizeBranchInput(branch))
    .filter((branch, index, list) => list.indexOf(branch) === index)
    .filter((branch) => canAccessBranch(user, branch));
}

function sanitizeStoredUser(user) {
  if (!user || typeof user !== "object") return null;
  const roleKey = normalizeRoleKey(user.roleKey ?? user.role ?? "guest");
  const wallType = normalizeWallType(
    user.wallType ?? (user.developerSlug ? "developer" : roleKey === "sponsor" ? "sponsor" : "none"),
  );
  return {
    ...user,
    roleKey,
    wallType,
    permissionLevel: getRolePreset(roleKey).permissionLevel,
    avatar: sanitizeUserAvatar(user.avatar),
    intro: sanitizeUserIntro(user.intro),
  };
}

async function getRequestUser(req) {
  const username = getSessionUsername(req);
  if (!username) return null;
  return getUserByUsername(username);
}

function publicUser(user) {
  const rolePreset = getRolePreset(user.roleKey ?? user.role);
  const roleBadge = getRoleBadge(rolePreset.key);
  return {
    username: user.username,
    displayName: user.displayName,
    qq: user.qq ?? "",
    roleKey: rolePreset.key,
    roleName: rolePreset.label,
    roleBadge,
    permissionLevel: getUserPermissionLevel(user),
    mustChangePassword: Boolean(user.mustChangePassword),
    developerSlug: getDeveloperSlugForUser(user),
    wallType: normalizeWallType(user.wallType),
    intro: sanitizeUserIntro(user.intro),
  };
}

async function buildPublicAuthUser(user) {
  const base = publicUser(user);
  const slug = base.developerSlug;
  if (!slug) {
    return {
      ...base,
      avatar: sanitizeUserAvatar(user.avatar),
      profileUrl: `/profile.html?user=${encodeURIComponent(user.username)}`,
    };
  }

  const developers = await readDevelopersConfig();
  const profile = developers.find((item) => item.slug === slug);
  return {
    ...base,
    avatar: profile?.avatar || DEFAULT_AVATAR_URL,
    profileUrl: `/developers/${encodeURIComponent(slug)}.html`,
  };
}

function getUserProfileProjects(user) {
  const links = [
    { title: "返回官网", subtitle: "查看首页、下载和公告内容", url: "/", cta: "返回官网" },
    { title: "提交反馈", subtitle: "遇到问题或建议时可前往反馈页提交", url: "/feedback.html", cta: "去反馈" },
  ];
  if (hasPermissionLevel(user, 3)) {
    links.push({
      title: "反馈后台",
      subtitle: "3 级账户可查看并处理站点反馈",
      url: "/admin.html",
      cta: "进入后台",
    });
  }
  if (canAccessPreview(user)) {
    links.push({
      title: "内测尝鲜版",
      subtitle: "2 级及以上账户可查看内测/尝鲜分支",
      url: "/index.html#download",
      cta: "查看分支",
    });
  }
  return links;
}

function buildUserHomepageProfile(user) {
  const safeUser = sanitizeStoredUser(user);
  const badge = getRoleBadge(safeUser.roleKey);
  const intro = sanitizeUserIntro(safeUser.intro);
  const displayName = safeUser.displayName || safeUser.username;
  const profile = publicDeveloperProfile({
    slug: safeUser.username,
    name: displayName,
    role: `${badge.label}账户主页`,
    qq: safeUser.qq ?? "",
    avatar: sanitizeUserAvatar(safeUser.avatar),
    cover: DEFAULT_AVATAR_URL,
    headline: intro || `${badge.label}账户主页`,
    quote: `${displayName} 的个人主页`,
    bio: intro || `${displayName} 当前身份为 ${badge.label}。`,
    tags: [badge.label, `${getUserPermissionLevel(safeUser)}级权限`, "站点账户"],
    links: hasPermissionLevel(safeUser, 3)
      ? [
          { label: "返回官网", url: "/" },
          { label: "反馈后台", url: "/admin.html" },
        ]
      : [{ label: "返回官网", url: "/" }],
    projects: getUserProfileProjects(safeUser),
    radar: {
      ideas: badge.key === "admin" ? 88 : badge.key === "service" ? 72 : badge.key === "sponsor" ? 66 : 52,
      innovation: badge.key === "admin" ? 82 : badge.key === "service" ? 64 : badge.key === "sponsor" ? 58 : 46,
      logic: badge.key === "admin" ? 85 : badge.key === "service" ? 70 : badge.key === "sponsor" ? 60 : 48,
      tech: badge.key === "admin" ? 80 : badge.key === "service" ? 52 : badge.key === "sponsor" ? 50 : 42,
      service: badge.key === "service" ? 95 : badge.key === "admin" ? 82 : badge.key === "sponsor" ? 62 : 55,
      engagement: badge.key === "sponsor" ? 92 : badge.key === "admin" ? 86 : badge.key === "service" ? 78 : 58,
    },
    background: {
      accentA: badge.accentA,
      accentB: badge.accentB,
      starColor: "#ffffff",
      particleDensity: badge.key === "admin" ? 84 : badge.key === "service" ? 72 : badge.key === "sponsor" ? 64 : 52,
      cover: DEFAULT_AVATAR_URL,
    },
  });
  return {
    ...profile,
    permissionBadge: badge,
    permissionLevel: getUserPermissionLevel(safeUser),
    profileType: "user",
    username: safeUser.username,
    editable: false,
  };
}

async function buildDeveloperHomepageProfile(profile) {
  const safeProfile = publicDeveloperProfile(profile);
  const mappedUser = (await readUsers()).find((item) => getDeveloperSlugForUser(item) === safeProfile.slug) ?? null;
  const badge = getRoleBadge(mappedUser?.roleKey ?? "admin");
  return {
    ...safeProfile,
    permissionBadge: badge,
    permissionLevel: mappedUser ? getUserPermissionLevel(mappedUser) : 3,
    profileType: "developer",
    username: mappedUser?.username || "",
    editable: true,
  };
}

function buildProfileUrlForUser(user) {
  const slug = getDeveloperSlugForUser(user);
  if (slug) {
    return `/developers/${encodeURIComponent(slug)}.html`;
  }
  return `/profile.html?user=${encodeURIComponent(user.username)}`;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function getAdminAccountByKey(key) {
  const normalized = (key ?? "").trim();
  if (!normalized) return null;
  return (
    ADMIN_ACCOUNT_MAPPINGS.find(
      (item) =>
        normalized === item.qq ||
        normalized === item.alias ||
        normalized === item.displayName,
    ) ?? null
  );
}

function getAdminAccountForUser(user) {
  if (!user) return null;
  const developerSlug =
    typeof user.developerSlug === "string" ? user.developerSlug.trim() : "";
  if (developerSlug) {
    const matchedBySlug =
      ADMIN_ACCOUNT_MAPPINGS.find((item) => item.slug === developerSlug) ?? null;
    if (matchedBySlug) return matchedBySlug;
  }
  const aliasSet = Array.isArray(user.aliases) ? user.aliases : [];
  return (
    getAdminAccountByKey(user.username) ??
    getAdminAccountByKey(user.qq) ??
    getAdminAccountByKey(user.displayName) ??
    aliasSet.map((alias) => getAdminAccountByKey(alias)).find(Boolean) ??
    null
  );
}

function getDeveloperSlugForUser(user) {
  if (!user) return "";
  const explicitSlug =
    typeof user.developerSlug === "string" ? user.developerSlug.trim() : "";
  return explicitSlug || getAdminAccountForUser(user)?.slug || "";
}

function enqueueDevelopersWrite(task) {
  developersWriteChain = developersWriteChain.then(() => task()).catch(() => {});
  return developersWriteChain;
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function isValidRelativeOrHttpUrl(value) {
  if (!value) return true;
  if (value.startsWith("/")) return true;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizeColor(value, fallback) {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(raw) ? raw : fallback;
}

function normalizeProfileThemePreset(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  return ["custom", "starry", "gothic", "cream", "bluewhite"].includes(raw) ? raw : "custom";
}

function normalizeProfileFontPreset(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  return ["default", "shoujin", "heiti", "songti", "kaiti", "yuanti"].includes(raw) ? raw : "default";
}

function sanitizeDeveloperProfile(profile) {
  const tags = uniqueStrings(Array.isArray(profile?.tags) ? profile.tags.map((x) => String(x).trim().slice(0, 20)) : []).slice(0, 12);
  const links = Array.isArray(profile?.links)
    ? profile.links
        .map((item) => {
          const label = typeof item?.label === "string" ? item.label.trim().slice(0, 30) : "";
          const url = typeof item?.url === "string" ? item.url.trim() : "";
          if (!label || !url || !isValidRelativeOrHttpUrl(url)) return null;
          return { label, url };
        })
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const projects = Array.isArray(profile?.projects)
    ? profile.projects
        .map((item) => {
          const title = typeof item?.title === "string" ? item.title.trim().slice(0, 40) : "";
          const subtitle = typeof item?.subtitle === "string" ? item.subtitle.trim().slice(0, 140) : "";
          const url = typeof item?.url === "string" ? item.url.trim() : "";
          const cta = typeof item?.cta === "string" ? item.cta.trim().slice(0, 20) : "";
          if (!title || !url || !isValidRelativeOrHttpUrl(url)) return null;
          return { title, subtitle, url, cta: cta || "前往" };
        })
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const radarInput = typeof profile?.radar === "object" && profile.radar ? profile.radar : {};
  const radar = Object.fromEntries(
    RADAR_KEYS.map((key) => [key, clampNumber(radarInput[key], 0, 100, 60)]),
  );
  const backgroundInput = typeof profile?.background === "object" && profile.background ? profile.background : {};
  const cover = typeof profile?.cover === "string" && isValidRelativeOrHttpUrl(profile.cover.trim())
    ? profile.cover.trim()
    : "/assets/logo.png";

  return {
    slug: typeof profile?.slug === "string" ? profile.slug.trim() : "",
    sourceType: normalizeDeveloperSourceType(profile?.sourceType),
    themePreset: normalizeProfileThemePreset(profile?.themePreset),
    fontPreset: normalizeProfileFontPreset(profile?.fontPreset),
    name: typeof profile?.name === "string" ? profile.name.trim().slice(0, 20) : "",
    role: typeof profile?.role === "string" ? profile.role.trim().slice(0, 40) : "",
    qq: typeof profile?.qq === "string" ? profile.qq.trim().slice(0, 20) : "",
    avatar:
      typeof profile?.avatar === "string" && isValidRelativeOrHttpUrl(profile.avatar.trim())
        ? profile.avatar.trim()
        : "/assets/logo.png",
    cover,
    headline: typeof profile?.headline === "string" ? profile.headline.trim().slice(0, 80) : "",
    quote: typeof profile?.quote === "string" ? profile.quote.trim().slice(0, 120) : "",
    bio: typeof profile?.bio === "string" ? profile.bio.trim().slice(0, 400) : "",
    tags,
    links,
    projects,
    radar,
    background: {
      accentA: sanitizeColor(backgroundInput.accentA, "#7dd3fc"),
      accentB: sanitizeColor(backgroundInput.accentB, "#a78bfa"),
      starColor: sanitizeColor(backgroundInput.starColor, "#ffffff"),
      particleDensity: clampNumber(backgroundInput.particleDensity, 20, 140, 72),
      cover,
    },
  };
}

async function readDevelopersConfig() {
  const cached = cache.get("developers");
  if (cached) return cached;

  let data = null;
  try {
    const raw = await fs.readFile(DEVELOPERS_JSON, "utf-8");
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  const developers = Array.isArray(data?.developers)
    ? data.developers.map((item) => sanitizeDeveloperProfile(item)).filter((item) => item.slug)
    : [];
  cache.set("developers", developers, 10_000);
  return developers;
}

async function writeDevelopersConfig(developers) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(
    DEVELOPERS_JSON,
    JSON.stringify({ version: 2, developers }, null, 2),
    "utf-8",
  );
  cache.set("developers", developers, 10_000);
}

function publicDeveloperProfile(profile) {
  return sanitizeDeveloperProfile(profile);
}

function buildEditableDeveloperProfile(existingProfile, body) {
  const current = sanitizeDeveloperProfile(existingProfile);
  const payload = body && typeof body === "object" ? body : {};
  const tags = Array.isArray(payload.tags)
    ? payload.tags
    : typeof payload.tagsText === "string"
      ? payload.tagsText.split(/[\n,，]/)
      : current.tags;
  const next = sanitizeDeveloperProfile({
    ...current,
    themePreset:
      typeof payload.themePreset === "string" ? payload.themePreset : current.themePreset,
    fontPreset:
      typeof payload.fontPreset === "string" ? payload.fontPreset : current.fontPreset,
    headline: typeof payload.headline === "string" ? payload.headline : current.headline,
    quote: typeof payload.quote === "string" ? payload.quote : current.quote,
    bio: typeof payload.bio === "string" ? payload.bio : current.bio,
    cover: typeof payload.cover === "string" ? payload.cover : current.cover,
    tags,
    radar: typeof payload.radar === "object" && payload.radar ? payload.radar : current.radar,
    background:
      typeof payload.background === "object" && payload.background
        ? { ...current.background, ...payload.background }
        : current.background,
  });
  return {
    ...current,
    sourceType: current.sourceType,
    themePreset: next.themePreset,
    fontPreset: next.fontPreset,
    headline: next.headline,
    quote: next.quote,
    bio: next.bio,
    cover: next.cover,
    tags: next.tags,
    radar: next.radar,
    background: {
      ...current.background,
      ...next.background,
      cover: next.cover,
    },
  };
}

async function normalizeAdminUser(user) {
  const admin = getAdminAccountForUser(user);
  if (!admin) return { user, changed: false };

  const aliases = uniqueStrings([...(Array.isArray(user.aliases) ? user.aliases : []), admin.alias]);
  const nextUser = {
    ...user,
    roleKey: "admin",
    permissionLevel: ROLE_PRESETS.admin.permissionLevel,
    username:
      typeof user.username === "string" && user.username.trim()
        ? user.username.trim()
        : admin.qq,
    displayName: user.displayName || admin.displayName,
    qq: typeof user.qq === "string" && user.qq ? user.qq : admin.qq,
    developerSlug: getDeveloperSlugForUser(user) || admin.slug,
    aliases,
  };

  let changed =
    nextUser.roleKey !== user.roleKey ||
    nextUser.permissionLevel !== user.permissionLevel ||
    nextUser.username !== user.username ||
    nextUser.displayName !== user.displayName ||
    nextUser.qq !== user.qq ||
    JSON.stringify(nextUser.aliases ?? []) !== JSON.stringify(user.aliases ?? []);

  const needsPasswordReset =
    Boolean(nextUser.mustChangePassword) &&
    (nextUser.username !== user.username ||
      nextUser.qq !== user.qq ||
      JSON.stringify(nextUser.aliases ?? []) !== JSON.stringify(user.aliases ?? []));

  if (needsPasswordReset) {
    nextUser.password = await makePasswordRecord(ADMIN_DEFAULT_PASSWORD || admin.qq);
    nextUser.updatedAt = new Date().toISOString();
    changed = true;
  }

  return { user: nextUser, changed };
}

async function repairLegacyAdminLogin(inputUsername, inputPassword, user) {
  if (!user || normalizeRoleKey(user.roleKey ?? user.role) !== "admin" || !user.mustChangePassword) {
    return null;
  }

  const admin = getAdminAccountByKey(inputUsername) ?? getAdminAccountForUser(user);
  if (!admin) return null;

  const expectedPassword = ADMIN_DEFAULT_PASSWORD || admin.qq;
  if (inputPassword !== expectedPassword) return null;

  const aliases = uniqueStrings([...(Array.isArray(user.aliases) ? user.aliases : []), admin.alias]);
  const repairedUser = {
    ...user,
    roleKey: "admin",
    permissionLevel: ROLE_PRESETS.admin.permissionLevel,
    username:
      typeof user.username === "string" && user.username.trim()
        ? user.username.trim()
        : admin.qq,
    displayName: user.displayName || admin.displayName,
    qq: typeof user.qq === "string" && user.qq ? user.qq : admin.qq,
    aliases,
    developerSlug: getDeveloperSlugForUser(user) || admin.slug,
    password: await makePasswordRecord(expectedPassword),
    updatedAt: new Date().toISOString(),
  };

  await enqueueUsersWrite(async () => {
    const users = await readUsers();
    const next = users.map((entry) =>
      entry.username === user.username ||
      (user.qq && entry.qq === user.qq) ||
      entry.displayName === user.displayName
        ? repairedUser
        : entry,
    );
    await writeUsers(next);
  });

  return repairedUser;
}

async function getUserByUsername(username) {
  const key = (username ?? "").trim();
  if (!key) return null;
  const users = await readUsers();
  const admin = getAdminAccountByKey(key);
  const extraKeys = uniqueStrings([key, admin?.qq, admin?.alias, admin?.displayName]);
  return (
    users.find(
      (u) =>
        extraKeys.includes(u.username) ||
        extraKeys.includes(u.qq) ||
        (Array.isArray(u.aliases) && u.aliases.some((a) => extraKeys.includes(a))),
    ) ?? null
  );
}

function isPasswordValid(newPassword) {
  if (typeof newPassword !== "string") return false;
  const p = newPassword.trim();
  return p.length >= 8 && p.length <= 72;
}

function normalizeUsername(username) {
  return typeof username === "string" ? username.trim() : "";
}

function isUsernameValid(username) {
  return /^[\p{L}\p{N}_-]{2,24}$/u.test(username);
}

function isSameUser(left, right) {
  if (!left || !right) return false;
  const leftSlug = getDeveloperSlugForUser(left);
  const rightSlug = getDeveloperSlugForUser(right);
  if (leftSlug && rightSlug) return leftSlug === rightSlug;
  return left.username === right.username;
}

async function bootstrapUsers() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const exists = await fileExists(USERS_JSON);
  if (exists) return;

  const nowIso = new Date().toISOString();
  const baseUsers = ADMIN_ACCOUNT_MAPPINGS.map((item) => ({
    username: item.qq,
    displayName: item.displayName,
    roleKey: "admin",
    permissionLevel: ROLE_PRESETS.admin.permissionLevel,
    qq: item.qq,
    developerSlug: item.slug,
    aliases: [item.alias],
    avatar: DEFAULT_AVATAR_URL,
    intro: "",
  }));

  const users = [];
  for (const u of baseUsers) {
    const initialPassword =
      ADMIN_DEFAULT_PASSWORD ||
      (typeof u.qq === "string" && u.qq ? u.qq : `${randomTokenBase64Url(9)}A!`);
    users.push({
      ...u,
      password: await makePasswordRecord(initialPassword),
      mustChangePassword: true,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastLoginAt: null,
    });
  }

  await writeUsers(users);

  if (!ADMIN_DEFAULT_PASSWORD) {
    console.warn("Admin default password uses each admin QQ number; change it after first login.");
  } else {
    console.warn("Admin default password is set by ADMIN_DEFAULT_PASSWORD.");
  }

  if (!SESSION_SECRET) {
    console.warn(
      "SESSION_SECRET is not set; session cookies will be invalid after restart. Set SESSION_SECRET to persist sessions.",
    );
  }
}

async function migrateUsersIfNeeded() {
  const exists = await fileExists(USERS_JSON);
  if (!exists) return;

  await enqueueUsersWrite(async () => {
    const users = await readUsers();
    let changed = false;
    const next = [];
    for (const u of users) {
      const normalized = await normalizeAdminUser(u);
      if (normalized.changed) changed = true;
      next.push(normalized.user);
    }

    if (changed) await writeUsers(next);
  });
}

const loginFailures = new Map();

function getClientKey(req) {
  return req.socket?.remoteAddress ?? "unknown";
}

function canAttemptLogin(req) {
  const key = getClientKey(req);
  const info = loginFailures.get(key);
  if (!info) return { ok: true, waitMs: 0 };
  const now = Date.now();
  if (info.lockedUntilMs && info.lockedUntilMs > now) {
    return { ok: false, waitMs: info.lockedUntilMs - now };
  }
  return { ok: true, waitMs: 0 };
}

function recordLoginFailure(req) {
  const key = getClientKey(req);
  const prev = loginFailures.get(key) ?? { fails: 0, lockedUntilMs: 0 };
  const fails = Math.min(prev.fails + 1, 20);
  const lockSeconds = Math.min(fails * fails, 60);
  const lockedUntilMs = Date.now() + lockSeconds * 1000;
  loginFailures.set(key, { fails, lockedUntilMs });
}

function clearLoginFailures(req) {
  const key = getClientKey(req);
  loginFailures.delete(key);
}

function renameSessionUsername(oldUsername, newUsername) {
  if (!oldUsername || !newUsername || oldUsername === newUsername) return;
  for (const entry of sessions.values()) {
    if (!entry || entry.username !== oldUsername) continue;
    entry.username = newUsername;
  }
}

async function requireAdmin(req, res) {
  return requirePermissionLevel(req, res, 3);
}

function publicAdminUser(user) {
  return {
    ...publicUser(user),
    avatar: sanitizeUserAvatar(user.avatar),
    wallType: normalizeWallType(user.wallType),
    createdAt: user.createdAt ?? null,
    updatedAt: user.updatedAt ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

function buildWallProfileFromDeveloper(profile, linkedUser) {
  const safeProfile = publicDeveloperProfile(profile);
  return {
    id: `developer:${safeProfile.slug}`,
    name: safeProfile.name,
    role: safeProfile.role || "开发者",
    intro: safeProfile.headline || safeProfile.bio || "",
    qq: safeProfile.qq || linkedUser?.qq || "",
    avatar: safeProfile.avatar || DEFAULT_AVATAR_URL,
    profileUrl: linkedUser ? buildProfileUrlForUser(linkedUser) : `/developers/${encodeURIComponent(safeProfile.slug)}.html`,
    wallType: "developer",
    permissionLevel: linkedUser ? getUserPermissionLevel(linkedUser) : 3,
  };
}

function buildWallProfileFromUser(user, wallType) {
  const badge = getRoleBadge(user.roleKey);
  const safeWallType = normalizeWallType(wallType);
  const displayName = user.displayName || user.username;
  const role =
    safeWallType === "sponsor"
      ? `${badge.label}成员`
      : `${badge.label}开发者`;
  return {
    id: `user:${user.username}`,
    name: displayName,
    role,
    intro: sanitizeUserIntro(user.intro) || `${displayName} 的${safeWallType === "sponsor" ? "赞助者" : "开发者"}主页`,
    qq: user.qq ?? "",
    avatar: sanitizeUserAvatar(user.avatar),
    profileUrl: buildProfileUrlForUser(user),
    wallType: safeWallType,
    permissionLevel: getUserPermissionLevel(user),
  };
}

async function listWallProfiles() {
  const [developers, users] = await Promise.all([readDevelopersConfig(), readUsers()]);
  const developerSlugs = new Set(developers.map((item) => item.slug));
  const developerProfiles = developers.map((profile) => {
    const linkedUser = users.find((user) => getDeveloperSlugForUser(user) === profile.slug) ?? null;
    return buildWallProfileFromDeveloper(profile, linkedUser);
  });
  const developerAccounts = users
    .filter((user) => normalizeWallType(user.wallType) === "developer" && !developerSlugs.has(getDeveloperSlugForUser(user)))
    .map((user) => buildWallProfileFromUser(user, "developer"));
  const sponsorProfiles = users
    .filter((user) => normalizeWallType(user.wallType) === "sponsor")
    .map((user) => buildWallProfileFromUser(user, "sponsor"));

  const sortProfiles = (list) =>
    list.sort((left, right) => {
      const levelDiff = Number(right.permissionLevel ?? 0) - Number(left.permissionLevel ?? 0);
      if (levelDiff !== 0) return levelDiff;
      return String(left.name || "").localeCompare(String(right.name || ""));
    });

  return {
    developers: sortProfiles([...developerProfiles, ...developerAccounts]),
    sponsors: sortProfiles(sponsorProfiles),
  };
}

async function requirePermissionLevel(req, res, minLevel) {
  const username = getSessionUsername(req);
  if (!username) {
    res.status(401).json({ ok: false });
    return null;
  }
  const user = await getUserByUsername(username);
  if (!user || !hasPermissionLevel(user, minLevel)) {
    res.status(403).json({ ok: false, permissionLevel: getUserPermissionLevel(user) });
    return null;
  }
  if (user.mustChangePassword) {
    res.status(428).json({ ok: false, mustChangePassword: true });
    return null;
  }
  return user;
}

async function requireSignedInDeveloper(req, res) {
  const user = await requirePermissionLevel(req, res, 3);
  if (!user) return null;
  const developerSlug = getDeveloperSlugForUser(user);
  if (!developerSlug) {
    res.status(403).json({ ok: false });
    return null;
  }
  return { user, developerSlug };
}

async function readFeedbackList() {
  const cached = cache.get("feedback:list");
  if (cached) return cached;

  let list = [];
  try {
    const raw = await fs.readFile(FEEDBACK_JSON, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) list = parsed;
  } catch {
    list = [];
  }

  cache.set("feedback:list", list, 10_000);
  return list;
}

async function writeFeedbackList(list) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FEEDBACK_JSON, JSON.stringify(list, null, 2), "utf-8");
  cache.set("feedback:list", list, 10_000);
}

function enqueueFeedbackWrite(task) {
  feedbackWriteChain = feedbackWriteChain
    .then(() => task())
    .catch(() => {});
  return feedbackWriteChain;
}

function enqueueChangelogWrite(task) {
  changelogWriteChain = changelogWriteChain
    .then(() => task())
    .catch(() => {});
  return changelogWriteChain;
}

app.get("/api/announcements", async (_req, res) => {
  res.json({ announcements: await readAnnouncements() });
});

app.get("/api/branches", async (req, res) => {
  const user = await getRequestUser(req);
  const branches = await listBranches();
  res.json({ branches: filterBranchesForUser(branches, user) });
});

app.get("/api/mods", async (req, res) => {
  const branch = normalizeBranchInput(typeof req.query.branch === "string" ? req.query.branch : "main");
  const user = await getRequestUser(req);
  if (!canAccessBranch(user, branch)) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }
  res.json({ branch, mods: await listMods(branch) });
});

app.get("/download/:branch/:file", async (req, res) => {
  const branch = normalizeBranchInput(String(req.params.branch ?? "main"));
  const fileName = String(req.params.file ?? "");
  if (!fileName) return res.status(400).send("Missing file");
  const user = await getRequestUser(req);
  if (!canAccessBranch(user, branch)) {
    return res.status(403).send("Forbidden");
  }

  const filePath = await resolveBranchFilePath(branch, fileName);
  if (!filePath) return res.status(404).send("Not found");

  try {
    const st = await fs.stat(filePath);
    if (!st.isFile()) return res.status(404).send("Not found");
    res.setHeader("Content-Length", String(st.size));
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    createReadStream(filePath).pipe(res);
  } catch {
    res.status(404).send("Not found");
  }
});

app.get("/api/gallery/categories", async (_req, res) => {
  res.json({ categories: await listGalleryCategories() });
});

app.get("/api/gallery", async (req, res) => {
  const category = typeof req.query.category === "string" ? req.query.category : "";
  res.json({ category: category || null, images: await listGalleryImages(category) });
});

app.get("/api/walls", async (_req, res) => {
  res.json({ ok: true, ...(await listWallProfiles()) });
});

app.get("/api/changelog", async (_req, res) => {
  res.json({ ok: true, items: await readChangelog() });
});

app.get("/api/developers/:slug", async (req, res) => {
  const slug = String(req.params.slug ?? "").trim();
  const developers = await readDevelopersConfig();
  const profile = developers.find((item) => item.slug === slug);
  if (!profile) return res.status(404).json({ ok: false, error: "Not found" });
  res.json({ ok: true, profile: await buildDeveloperHomepageProfile(profile) });
});

app.get("/api/users/:username/profile", async (req, res) => {
  const username = normalizeUsername(String(req.params.username ?? ""));
  if (!username) return res.status(404).json({ ok: false, error: "Not found" });
  const user = await getUserByUsername(username);
  if (!user) return res.status(404).json({ ok: false, error: "Not found" });
  res.json({ ok: true, profile: buildUserHomepageProfile(user) });
});

app.get("/api/auth/me", async (req, res) => {
  const username = getSessionUsername(req);
  if (!username) return res.json({ ok: true, user: null });
  const user = await getUserByUsername(username);
  if (!user) return res.json({ ok: true, user: null });
  res.json({ ok: true, user: await buildPublicAuthUser(user) });
});

app.post("/api/debug/event", async (req, res) => {
  try {
    const ok = await appendDebugEvent(req.body ?? {});
    if (!ok) {
      return res.status(400).json({ ok: false, error: "Invalid debug session" });
    }
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ ok: false, error: "Debug event write failed" });
  }
});

app.patch("/api/developers/:slug", async (req, res) => {
  const current = await requireSignedInDeveloper(req, res);
  if (!current) return;

  const slug = String(req.params.slug ?? "").trim();
  if (!slug || slug !== current.developerSlug) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  let updatedProfile = null;
  await enqueueDevelopersWrite(async () => {
    const developers = await readDevelopersConfig();
    const next = developers.map((item) => {
      if (item.slug !== slug) return item;
      updatedProfile = buildEditableDeveloperProfile(item, req.body ?? {});
      return updatedProfile;
    });
    if (!updatedProfile) return;
    await writeDevelopersConfig(next);
  });

  if (!updatedProfile) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }
  res.json({ ok: true, profile: await buildDeveloperHomepageProfile(updatedProfile) });
});

app.post(
  "/api/developers/:slug/cover",
  express.raw({ type: "application/octet-stream", limit: "20mb" }),
  async (req, res) => {
    const current = await requireSignedInDeveloper(req, res);
    if (!current) return;

    const slug = String(req.params.slug ?? "").trim();
    if (!slug || slug !== current.developerSlug) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const headerName = req.get("x-file-name") ?? "";
    const fileName = decodeURIComponent(String(headerName)).trim();
    if (!isValidImageFileName(fileName)) {
      return res.status(400).json({ ok: false, error: "Invalid image file" });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ ok: false, error: "Empty image" });
    }

    const coverDir = safeJoin(DEVELOPER_COVERS_DIR, slug);
    if (!coverDir) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    const publicCoverPath = `/uploads/developers/${encodeURIComponent(slug)}/${encodeURIComponent(fileName)}`;
    let updatedProfile = null;
    await enqueueDevelopersWrite(async () => {
      const developers = await readDevelopersConfig();
      const next = [];
      for (const item of developers) {
        if (item.slug !== slug) {
          next.push(item);
          continue;
        }
        await fs.rm(coverDir, { recursive: true, force: true });
        await fs.mkdir(coverDir, { recursive: true });
        const destPath = safeJoin(coverDir, fileName);
        if (!destPath) continue;
        await fs.writeFile(destPath, req.body);
        updatedProfile = buildEditableDeveloperProfile(item, { cover: publicCoverPath });
        next.push(updatedProfile);
      }
      if (!updatedProfile) return;
      await writeDevelopersConfig(next);
    });

    if (!updatedProfile) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }
    res.json({ ok: true, profile: await buildDeveloperHomepageProfile(updatedProfile) });
  },
);

app.delete("/api/developers/:slug/cover", async (req, res) => {
  const current = await requireSignedInDeveloper(req, res);
  if (!current) return;

  const slug = String(req.params.slug ?? "").trim();
  if (!slug || slug !== current.developerSlug) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  const coverDir = safeJoin(DEVELOPER_COVERS_DIR, slug);
  if (!coverDir) {
    return res.status(400).json({ ok: false, error: "Invalid slug" });
  }

  let updatedProfile = null;
  await enqueueDevelopersWrite(async () => {
    const developers = await readDevelopersConfig();
    const next = developers.map((item) => {
      if (item.slug !== slug) return item;
      updatedProfile = buildEditableDeveloperProfile(item, { cover: "/assets/logo.png" });
      return updatedProfile;
    });
    if (!updatedProfile) return;
    await fs.rm(coverDir, { recursive: true, force: true });
    await writeDevelopersConfig(next);
  });

  if (!updatedProfile) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }
  res.json({ ok: true, profile: await buildDeveloperHomepageProfile(updatedProfile) });
});

app.post("/api/auth/login", async (req, res) => {
  const gate = canAttemptLogin(req);
  if (!gate.ok) {
    return res.status(429).json({ ok: false, retryAfterMs: gate.waitMs });
  }

  const body = req.body ?? {};
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) return res.status(400).json({ ok: false });

  const user = await getUserByUsername(username);
  if (!user) {
    recordLoginFailure(req);
    return res.status(401).json({ ok: false });
  }

  let loginUser = user;
  let ok = await verifyPassword(password, loginUser.password);
  if (!ok) {
    const repairedUser = await repairLegacyAdminLogin(username, password, loginUser);
    if (repairedUser) {
      loginUser = repairedUser;
      ok = true;
    }
  }
  if (!ok) {
    recordLoginFailure(req);
    return res.status(401).json({ ok: false });
  }

  clearLoginFailures(req);
  createSession(res, loginUser.username);

  await enqueueUsersWrite(async () => {
    const users = await readUsers();
    const next = users.map((u) =>
      u.username === loginUser.username
        ? { ...u, lastLoginAt: new Date().toISOString() }
        : u,
    );
    await writeUsers(next);
  });

  res.json({ ok: true, user: await buildPublicAuthUser(loginUser) });
});

app.post("/api/auth/logout", async (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

app.post("/api/auth/change-password", async (req, res) => {
  const username = getSessionUsername(req);
  if (!username) return res.status(401).json({ ok: false });

  const body = req.body ?? {};
  const oldPassword = typeof body.oldPassword === "string" ? body.oldPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!oldPassword || !isPasswordValid(newPassword)) {
    return res.status(400).json({ ok: false });
  }

  const user = await getUserByUsername(username);
  if (!user) return res.status(401).json({ ok: false });

  const ok = await verifyPassword(oldPassword, user.password);
  if (!ok) return res.status(401).json({ ok: false });

  const nextRecord = await makePasswordRecord(newPassword.trim());
  await enqueueUsersWrite(async () => {
    const users = await readUsers();
    const next = users.map((u) =>
      u.username === username
        ? {
            ...u,
            password: nextRecord,
            mustChangePassword: false,
            updatedAt: new Date().toISOString(),
          }
        : u,
    );
    await writeUsers(next);
  });

  res.json({ ok: true });
});

app.patch("/api/auth/account", async (req, res) => {
  const sessionUsername = getSessionUsername(req);
  if (!sessionUsername) {
    return res.status(401).json({ ok: false, error: "请先登录" });
  }

  const user = await getUserByUsername(sessionUsername);
  if (!user) {
    return res.status(401).json({ ok: false, error: "登录状态已失效" });
  }

  const body = req.body ?? {};
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const requestedUsername = normalizeUsername(body.newUsername);
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";
  const wantsUsername =
    Boolean(requestedUsername) && requestedUsername !== user.username;
  const wantsPassword = Boolean(newPassword.trim());

  if (!wantsUsername && !wantsPassword) {
    return res.status(400).json({ ok: false, error: "请至少填写一个要修改的项目" });
  }
  if (!currentPassword) {
    return res.status(400).json({ ok: false, error: "请输入当前密码以确认修改" });
  }

  const ok = await verifyPassword(currentPassword, user.password);
  if (!ok) {
    return res.status(401).json({ ok: false, error: "当前密码不正确" });
  }

  let nextUsername = user.username;
  if (wantsUsername) {
    if (!isUsernameValid(requestedUsername)) {
      return res.status(400).json({
        ok: false,
        error: "账户名仅支持 2-24 位中文、字母、数字、下划线或短横线",
      });
    }
    const conflict = await getUserByUsername(requestedUsername);
    if (conflict && !isSameUser(conflict, user)) {
      return res.status(409).json({ ok: false, error: "该账户名已被使用" });
    }
    nextUsername = requestedUsername;
  }

  let nextPasswordRecord = user.password;
  if (wantsPassword) {
    if (!isPasswordValid(newPassword)) {
      return res.status(400).json({ ok: false, error: "新密码长度需为 8-72 位" });
    }
    nextPasswordRecord = await makePasswordRecord(newPassword.trim());
  }

  let updatedUser = null;
  await enqueueUsersWrite(async () => {
    const users = await readUsers();
    const next = users.map((entry) => {
      if (!isSameUser(entry, user)) return entry;
      updatedUser = {
        ...entry,
        username: nextUsername,
        password: nextPasswordRecord,
        mustChangePassword: wantsPassword ? false : Boolean(entry.mustChangePassword),
        updatedAt: new Date().toISOString(),
      };
      return updatedUser;
    });
    if (!updatedUser) return;
    await writeUsers(next);
  });

  if (!updatedUser) {
    return res.status(404).json({ ok: false, error: "账户不存在" });
  }

  renameSessionUsername(sessionUsername, nextUsername);
  renameSessionUsername(user.username, nextUsername);
  res.json({ ok: true, user: await buildPublicAuthUser(updatedUser) });
});

app.get("/api/admin/users", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const users = await readUsers();
  res.json({
    ok: true,
    items: users
      .map((user) => publicAdminUser(user))
      .sort((left, right) => {
        const level = (right.permissionLevel ?? 0) - (left.permissionLevel ?? 0);
        if (level !== 0) return level;
        return String(left.displayName || left.username).localeCompare(
          String(right.displayName || right.username),
        );
      }),
  });
});

app.post("/api/admin/users", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const body = req.body ?? {};
  const username = normalizeUsername(body.username);
  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim().slice(0, 20) : "";
  const roleKey = normalizeRoleKey(body.roleKey);
  const wallType = normalizeWallType(body.wallType);
  const intro = sanitizeUserIntro(body.intro);

  if (!isUsernameValid(username)) {
    return res.status(400).json({
      ok: false,
      error: "账户名仅支持 2-24 位中文、字母、数字、下划线或短横线",
    });
  }
  if (!displayName) {
    return res.status(400).json({ ok: false, error: "请填写名称" });
  }

  const existed = await getUserByUsername(username);
  if (existed) {
    return res.status(409).json({ ok: false, error: "该账户名已存在" });
  }

  const nowIso = new Date().toISOString();
  const nextUser = sanitizeStoredUser({
    username,
    displayName,
    roleKey,
    permissionLevel: getRolePreset(roleKey).permissionLevel,
    wallType,
    intro,
    avatar: DEFAULT_AVATAR_URL,
    qq: "",
    aliases: [],
    developerSlug: "",
    password: await makePasswordRecord(username),
    mustChangePassword: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastLoginAt: null,
  });

  await enqueueUsersWrite(async () => {
    const users = await readUsers();
    await writeUsers([...users, nextUser]);
  });

  res.json({ ok: true, user: publicAdminUser(nextUser) });
});

app.delete("/api/admin/users/:username", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const username = normalizeUsername(String(req.params.username ?? ""));
  if (!username) {
    return res.status(400).json({ ok: false, error: "无效账户名" });
  }

  const targetUser = await getUserByUsername(username);
  if (!targetUser) {
    return res.status(404).json({ ok: false, error: "账户不存在" });
  }
  if (isSameUser(targetUser, admin)) {
    return res.status(400).json({ ok: false, error: "不能删除当前登录账户" });
  }
  if (getAdminAccountForUser(targetUser)) {
    return res.status(403).json({ ok: false, error: "内置管理员账户不能删除" });
  }

  await enqueueUsersWrite(async () => {
    const users = await readUsers();
    const next = users.filter((entry) => !isSameUser(entry, targetUser));
    await writeUsers(next);
  });

  const avatarDir = safeJoin(USER_AVATARS_DIR, targetUser.username);
  if (avatarDir) {
    await fs.rm(avatarDir, { recursive: true, force: true }).catch(() => {});
  }
  for (const [key, value] of sessions.entries()) {
    if (value?.username === targetUser.username) {
      sessions.delete(key);
    }
  }

  res.json({ ok: true });
});

app.post(
  "/api/admin/users/:username/avatar",
  express.raw({ type: "application/octet-stream", limit: "10mb" }),
  async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const username = normalizeUsername(String(req.params.username ?? ""));
    if (!isUsernameValid(username)) {
      return res.status(400).json({ ok: false, error: "无效账户名" });
    }
    const headerName = req.get("x-file-name") ?? "";
    const fileName = decodeURIComponent(String(headerName)).trim();
    if (!isValidImageFileName(fileName)) {
      return res.status(400).json({ ok: false, error: "无效头像文件" });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ ok: false, error: "头像文件为空" });
    }

    const avatarDir = safeJoin(USER_AVATARS_DIR, username);
    if (!avatarDir) {
      return res.status(400).json({ ok: false, error: "无效账户目录" });
    }

    const publicAvatarPath = `/uploads/users/${encodeURIComponent(username)}/${encodeURIComponent(fileName)}`;
    let updatedUser = null;
    await enqueueUsersWrite(async () => {
      const users = await readUsers();
      const next = [];
      for (const entry of users) {
        if (entry.username !== username) {
          next.push(entry);
          continue;
        }
        await fs.rm(avatarDir, { recursive: true, force: true });
        await fs.mkdir(avatarDir, { recursive: true });
        const destPath = safeJoin(avatarDir, fileName);
        if (!destPath) continue;
        await fs.writeFile(destPath, req.body);
        updatedUser = sanitizeStoredUser({
          ...entry,
          avatar: publicAvatarPath,
          updatedAt: new Date().toISOString(),
        });
        next.push(updatedUser);
      }
      if (!updatedUser) return;
      await writeUsers(next);
    });

    if (!updatedUser) {
      return res.status(404).json({ ok: false, error: "账户不存在" });
    }
    res.json({ ok: true, user: publicAdminUser(updatedUser) });
  },
);

app.post("/api/feedback", async (req, res) => {
  const body = req.body ?? {};
  const draftId = typeof body.draftId === "string" ? body.draftId.trim() : "";
  const type = normalizeFeedbackType(body.type);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const contact = typeof body.contact === "string" ? body.contact.trim() : "";
  const gameVersion = typeof body.gameVersion === "string" ? body.gameVersion.trim() : "";
  const modVersion = typeof body.modVersion === "string" ? body.modVersion.trim() : "";
  const images = type === "bug" ? sanitizeFeedbackAttachments(body.images, "image", draftId) : [];
  const files = type === "bug" ? sanitizeFeedbackAttachments(body.files, "file", draftId) : [];

  if (!title || !content) {
    return res.status(400).json({ ok: false, error: "请填写标题和详细描述" });
  }

  const entry = {
    id: isValidFeedbackDraftId(draftId) ? draftId : randomId(),
    createdAt: new Date().toISOString(),
    type,
    title: title.slice(0, 80),
    content: content.slice(0, 4000),
    contact: contact.slice(0, 80),
    gameVersion: gameVersion.slice(0, 40),
    modVersion: modVersion.slice(0, 60),
    images,
    files,
    resolved: false,
    meta: {
      ip: req.socket?.remoteAddress ?? "",
      ua: req.get("user-agent") ?? "",
    },
  };

  await enqueueFeedbackWrite(async () => {
    const current = await readFeedbackList();
    const next = [entry, ...current].slice(0, 1000);
    await writeFeedbackList(next);
  });

  res.json({ ok: true, id: entry.id });
});

app.post(
  "/api/feedback/upload",
  express.raw({ type: "application/octet-stream", limit: "20mb" }),
  async (req, res) => {
    const kind = req.query.kind === "image" ? "image" : req.query.kind === "file" ? "file" : "";
    const draftId = String(req.query.draftId ?? "").trim();
    if (!kind || !isValidFeedbackDraftId(draftId)) {
      return res.status(400).json({ ok: false, error: "无效上传参数" });
    }

    const headerName = req.get("x-file-name") ?? "";
    const fileName = decodeURIComponent(String(headerName)).trim();
    const validName = kind === "image" ? isValidImageFileName(fileName) : isValidFeedbackFileName(fileName);
    if (!validName) {
      return res.status(400).json({ ok: false, error: "文件名或格式无效" });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ ok: false, error: "上传文件为空" });
    }

    const sizeLimit = kind === "image" ? 10 * 1024 * 1024 : 20 * 1024 * 1024;
    if (req.body.length > sizeLimit) {
      return res.status(400).json({ ok: false, error: kind === "image" ? "图片不能超过 10MB" : "文件不能超过 20MB" });
    }

    const subDir = kind === "image" ? "images" : "files";
    const destDir = safeJoin(FEEDBACK_UPLOADS_DIR, draftId, subDir);
    if (!destDir) {
      return res.status(400).json({ ok: false, error: "上传目录无效" });
    }
    await fs.mkdir(destDir, { recursive: true });

    const destPath = safeJoin(destDir, fileName);
    if (!destPath) {
      return res.status(400).json({ ok: false, error: "文件路径无效" });
    }

    await fs.writeFile(destPath, req.body);
    res.json({
      ok: true,
      attachment: {
        kind,
        name: fileName,
        size: req.body.length,
        url: `/uploads/feedback/${encodeURIComponent(draftId)}/${subDir}/${encodeURIComponent(fileName)}`,
      },
    });
  },
);

app.get("/api/admin/feedback", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.json({ ok: true, items: await readFeedbackList() });
});

app.get("/api/admin/changelog", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.json({ ok: true, items: await readChangelog() });
});

app.post("/api/admin/changelog", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const nextEntry = sanitizeChangelogEntry(req.body ?? {});
  if (!nextEntry) {
    return res.status(400).json({ ok: false, error: "请填写版本、标题和内容" });
  }

  await enqueueChangelogWrite(async () => {
    const items = await readChangelog();
    await writeChangelog([nextEntry, ...items].slice(0, 100));
  });

  res.json({ ok: true, item: nextEntry });
});

app.delete("/api/admin/changelog/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id = String(req.params.id ?? "").trim();
  if (!id) {
    return res.status(400).json({ ok: false, error: "日志编号无效" });
  }

  let removed = false;
  await enqueueChangelogWrite(async () => {
    const items = await readChangelog();
    const next = items.filter((item) => {
      if (item.id !== id) return true;
      removed = true;
      return false;
    });
    if (!removed) return;
    await writeChangelog(next);
  });

  if (!removed) {
    return res.status(404).json({ ok: false, error: "日志不存在" });
  }
  res.json({ ok: true });
});

app.patch("/api/admin/feedback/:id", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = String(req.params.id ?? "");
  const body = req.body ?? {};
  const resolved = typeof body.resolved === "boolean" ? body.resolved : null;
  if (!id || resolved === null) return res.status(400).json({ ok: false });

  await enqueueFeedbackWrite(async () => {
    const current = await readFeedbackList();
    const next = current.map((it) => (it.id === id ? { ...it, resolved } : it));
    await writeFeedbackList(next);
  });

  res.json({ ok: true });
});

app.get("/api/admin/mods/external", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const branch =
    typeof req.query.branch === "string" && req.query.branch.trim()
      ? normalizeBranchInput(req.query.branch)
      : "";
  const list = await readExternalModsConfig();
  const items = branch ? list.filter((x) => x.branch === branch) : list;
  res.json({ ok: true, items });
});

app.post("/api/admin/mods/external", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const body = req.body ?? {};
  const branch = normalizeBranchInput(body.branch);
  if (!isManagedBranch(branch)) {
    return res.status(400).json({ ok: false, error: "Invalid branch" });
  }

  const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
  if (!isValidModFileName(fileName)) {
    return res.status(400).json({ ok: false, error: "Invalid fileName" });
  }

  const description = typeof body.description === "string" ? body.description.trim() : "";
  const rawLinks = Array.isArray(body.links)
    ? body.links
    : [
        {
          label: "",
          url: typeof body.externalUrl === "string" ? body.externalUrl.trim() : "",
        },
      ];
  const links = rawLinks.map((link, index) => normalizeExternalLink(link, index)).filter(Boolean);
  if (Array.isArray(body.links) && rawLinks.length > 0 && links.length !== rawLinks.filter(Boolean).length) {
    return res.status(400).json({ ok: false, error: "Invalid external links" });
  }

  await enqueueExternalModsWrite(async () => {
    const current = await readExternalModsConfigUncached();
    const kept = current.filter((x) => !(x.branch === branch && x.fileName === fileName));
    const shouldKeep = Boolean(links.length > 0 || description);
    const next = shouldKeep
      ? [...kept, { branch, fileName, description, links }]
      : kept;
    await writeExternalModsConfig(next);
  });

  res.json({ ok: true });
});

app.post(
  "/api/admin/mods/upload",
  express.raw({ type: "application/octet-stream", limit: "400mb" }),
  async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const branch = normalizeBranchInput(String(req.query.branch ?? ""));
    if (!isManagedBranch(branch)) {
      return res.status(400).json({ ok: false, error: "Invalid branch" });
    }

    const headerName = req.get("x-file-name") ?? "";
    const fileName = decodeURIComponent(String(headerName)).trim();
    if (!isValidModFileName(fileName)) {
      return res.status(400).json({ ok: false, error: "Invalid fileName" });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ ok: false, error: "Empty file" });
    }

    const branchDir = getPrimaryBranchDirectory(branch);
    if (!branchDir) return res.status(400).json({ ok: false, error: "Invalid branch" });
    await fs.mkdir(branchDir, { recursive: true });

    const destPath = safeJoin(branchDir, fileName);
    if (!destPath) return res.status(400).json({ ok: false, error: "Invalid fileName" });

    await fs.writeFile(destPath, req.body);

    cache.delete("branches");
    cache.delete(`mods:${branch}`);

    res.json({ ok: true });
  },
);

app.delete("/api/admin/mods", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const branch = normalizeBranchInput(
    typeof req.query.branch === "string" ? req.query.branch : "",
  );
  if (!isManagedBranch(branch)) {
    return res.status(400).json({ ok: false, error: "Invalid branch" });
  }

  const fileName =
    typeof req.query.fileName === "string" ? req.query.fileName.trim() : "";
  if (!isValidModFileName(fileName)) {
    return res.status(400).json({ ok: false, error: "Invalid fileName" });
  }

  const filePath = await resolveBranchFilePath(branch, fileName);
  if (!filePath) return res.status(404).json({ ok: false, error: "Not found" });

  try {
    const st = await fs.stat(filePath);
    if (!st.isFile()) return res.status(404).json({ ok: false, error: "Not found" });
  } catch {
    return res.status(404).json({ ok: false, error: "Not found" });
  }

  await fs.unlink(filePath);

  await enqueueExternalModsWrite(async () => {
    const current = await readExternalModsConfigUncached();
    const next = current.filter((x) => !(x.branch === branch && x.fileName === fileName));
    await writeExternalModsConfig(next);
  });

  cache.delete("branches");
  cache.delete(`mods:${branch}`);

  res.json({ ok: true });
});

app.get("/admin.html", async (req, res) => {
  const user = await getRequestUser(req);
  if (user && !hasPermissionLevel(user, 3)) {
    return res.redirect(buildProfileUrlForUser(user));
  }
  return res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, app: APP_NAME });
});

const BASE_PORT = Number(process.env.PORT ?? 3000);
const MAX_PORT_TRIES = 20;

let activeServer = null;

app.post("/__admin/shutdown", (req, res) => {
  if (!isLoopbackRequest(req)) return res.status(403).json({ ok: false });
  if (ADMIN_TOKEN) {
    const token = req.get("x-admin-token") ?? "";
    if (token !== ADMIN_TOKEN) return res.status(401).json({ ok: false });
  }
  res.json({ ok: true });
  setTimeout(() => {
    if (!activeServer) process.exit(0);
    activeServer.close(() => process.exit(0));
  }, 50);
});

async function tryShutdownExistingSameApp(port) {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 800);

  try {
    const res = await fetch(`http://localhost:${port}/healthz`, {
      signal: abort.signal,
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    if (!data || data.app !== APP_NAME) return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }

  try {
    const headers = ADMIN_TOKEN ? { "x-admin-token": ADMIN_TOKEN } : {};
    const res = await fetch(`http://localhost:${port}/__admin/shutdown`, {
      method: "POST",
      headers,
    });
    return res.ok;
  } catch {
    return false;
  }
}

function startListening(port, triesLeft) {
  const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
  activeServer = server;

  server.on("error", (err) => {
    void (async () => {
      if (!err || err.code !== "EADDRINUSE") {
        console.error("Failed to start server:", err);
        process.exitCode = 1;
        return;
      }

      const takeoverOk = await tryShutdownExistingSameApp(port);
      if (takeoverOk) {
        console.warn(`Port ${port} is in use by an old instance, taking over...`);
        setTimeout(() => startListening(port, triesLeft), 250);
        return;
      }

      if (FORCE_PORT) {
        console.error(
          `Port ${port} is in use by another program. Close it, or change PORT (current FORCE_PORT=1).`,
        );
        process.exitCode = 1;
        return;
      }

      if (triesLeft > 0) {
        const nextPort = port + 1;
        console.warn(`Port ${port} is in use, trying ${nextPort}...`);
        setTimeout(() => startListening(nextPort, triesLeft - 1), 200);
        return;
      }

      console.error("Failed to start server: no available port");
      process.exitCode = 1;
    })();
  });
}

await bootstrapAssets();
await bootstrapUsers();
await migrateUsersIfNeeded();
startListening(BASE_PORT, MAX_PORT_TRIES);

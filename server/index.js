import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { clearSession, isAdminConfigured, isAuthenticated, issueSession, requireAdmin, verifyPassword } from "./auth.js";
import { getState, updateState, videosDir, ensureStore } from "./store.js";
import { orderedActiveVideos, resolveLivePosition } from "./schedule.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const app = express();
const port = Number(process.env.PORT || 3000);
const maxUploadBytes = Math.max(1024 * 1024, Number(process.env.MAX_UPLOAD_BYTES || 8 * 1024 * 1024 * 1024));

ensureStore();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
  next();
});

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function restartRotation(state) {
  state.channel.scheduleEpoch = Date.now();
}

function publicVideo(video) {
  return {
    id: video.id,
    title: video.title,
    duration: Number(video.duration),
    url: "/media/" + encodeURIComponent(video.id),
    order: Number(video.order || 0)
  };
}

function channelPayload(state) {
  const now = Date.now();
  const live = resolveLivePosition(state.videos, state.channel.scheduleEpoch, now);
  return {
    serverTime: now,
    playlistVersion: state.channel.updatedAt,
    channel: {
      name: state.channel.name,
      tagline: state.channel.tagline,
      scheduleEpoch: state.channel.scheduleEpoch
    },
    cycleDuration: live.cycleDuration,
    videos: live.active.map(publicVideo),
    nowPlaying: live.video ? { ...publicVideo(live.video), offset: live.offset } : null,
    nextUp: live.nextVideo ? publicVideo(live.nextVideo) : null
  };
}

function sameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (!origin) return next();
  const expected = req.protocol + "://" + req.get("host");
  if (origin !== expected) return res.status(403).json({ error: "Cross-origin admin request blocked" });
  next();
}

app.use("/api/admin", (req, res, next) => {
  if (["POST", "PATCH", "DELETE", "PUT"].includes(req.method)) return sameOrigin(req, res, next);
  next();
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "24-7-videos" });
});

app.get("/api/channel/state", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(channelPayload(getState()));
});

app.get("/media/:id", (req, res) => {
  const state = getState();
  const video = orderedActiveVideos(state.videos).find((item) => item.id === req.params.id);
  if (!video) return res.status(404).json({ error: "Video not found" });

  const filePath = path.join(videosDir, video.fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Video file missing" });

  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.setHeader("Accept-Ranges", "bytes");
  res.type(video.mimeType || path.extname(video.fileName));
  res.sendFile(filePath);
});

app.get("/api/admin/session", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ configured: isAdminConfigured(), authenticated: isAuthenticated(req) });
});

const failedLogins = new Map();

function loginAllowed(ip) {
  const now = Date.now();
  const current = failedLogins.get(ip);
  if (!current || now - current.first > 15 * 60 * 1000) {
    failedLogins.set(ip, { first: now, count: 0 });
    return true;
  }
  return current.count < 8;
}

app.post("/api/admin/login", (req, res) => {
  if (!isAdminConfigured()) {
    return res.status(503).json({ error: "Set ADMIN_PASSWORD to at least 8 characters before using the admin." });
  }

  const ip = req.ip || "unknown";
  if (!loginAllowed(ip)) return res.status(429).json({ error: "Too many attempts. Try again later." });

  if (!verifyPassword(req.body?.password)) {
    const record = failedLogins.get(ip) || { first: Date.now(), count: 0 };
    record.count += 1;
    failedLogins.set(ip, record);
    return res.status(401).json({ error: "Incorrect password" });
  }

  failedLogins.delete(ip);
  issueSession(res);
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get("/api/admin/dashboard", requireAdmin, (req, res) => {
  const state = getState();
  const now = Date.now();
  const live = resolveLivePosition(state.videos, state.channel.scheduleEpoch, now);
  const totalBytes = state.videos.reduce((sum, video) => sum + Number(video.size || 0), 0);

  res.setHeader("Cache-Control", "no-store");
  res.json({
    channel: state.channel,
    serverTime: now,
    videos: [...state.videos]
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map((video) => ({
        id: video.id,
        title: video.title,
        duration: Number(video.duration),
        size: Number(video.size || 0),
        mimeType: video.mimeType,
        enabled: video.enabled !== false,
        order: Number(video.order || 0),
        createdAt: video.createdAt,
        url: "/media/" + encodeURIComponent(video.id)
      })),
    stats: {
      activeVideos: live.active.length,
      totalVideos: state.videos.length,
      cycleDuration: live.cycleDuration,
      storageBytes: totalBytes
    },
    nowPlaying: live.video ? {
      id: live.video.id,
      title: live.video.title,
      offset: live.offset,
      duration: Number(live.video.duration),
      url: "/media/" + encodeURIComponent(live.video.id)
    } : null,
    nextUp: live.nextVideo ? { id: live.nextVideo.id, title: live.nextVideo.title } : null
  });
});

const allowedExtensions = new Set([".mp4", ".m4v", ".webm", ".mov", ".ogg", ".ogv", ".mkv"]);
const storage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, videosDir),
  filename: (req, file, callback) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    callback(null, crypto.randomUUID() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: maxUploadBytes, files: 1 },
  fileFilter: (req, file, callback) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const looksLikeVideo = String(file.mimetype || "").startsWith("video/") || allowedExtensions.has(ext);
    if (!looksLikeVideo || !allowedExtensions.has(ext)) return callback(new Error("Unsupported video file type"));
    callback(null, true);
  }
});

function deleteUploadedFile(file) {
  if (!file?.path) return;
  try { fs.unlinkSync(file.path); } catch {}
}

app.post("/api/admin/videos", requireAdmin, upload.single("video"), (req, res) => {
  const duration = Number(req.body?.duration);
  if (!req.file) return res.status(400).json({ error: "Choose a video file" });

  if (!Number.isFinite(duration) || duration <= 0 || duration > 7 * 24 * 60 * 60) {
    deleteUploadedFile(req.file);
    return res.status(400).json({ error: "Could not read a valid video duration" });
  }

  const fallbackTitle = path.basename(req.file.originalname, path.extname(req.file.originalname));
  const title = cleanText(req.body?.title || fallbackTitle, 120) || "Untitled video";
  const id = crypto.randomUUID();

  const state = updateState((draft) => {
    const maxOrder = draft.videos.reduce((max, video) => Math.max(max, Number(video.order || 0)), -1);
    draft.videos.push({
      id,
      title,
      duration,
      fileName: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype || "video/mp4",
      size: req.file.size,
      enabled: true,
      order: maxOrder + 1,
      createdAt: new Date().toISOString()
    });
    restartRotation(draft);
  });

  res.status(201).json({ ok: true, id, channel: channelPayload(state) });
});

app.patch("/api/admin/videos/:id", requireAdmin, (req, res) => {
  let found = false;
  let playlistChanged = false;

  const state = updateState((draft) => {
    const video = draft.videos.find((item) => item.id === req.params.id);
    if (!video) return draft;
    found = true;

    if (Object.hasOwn(req.body || {}, "title")) {
      const title = cleanText(req.body.title, 120);
      if (title) video.title = title;
    }

    if (Object.hasOwn(req.body || {}, "enabled")) {
      const enabled = Boolean(req.body.enabled);
      if (video.enabled !== enabled) {
        video.enabled = enabled;
        playlistChanged = true;
      }
    }

    if (playlistChanged) restartRotation(draft);
    return draft;
  });

  if (!found) return res.status(404).json({ error: "Video not found" });
  res.json({ ok: true, channel: channelPayload(state) });
});

app.post("/api/admin/reorder", requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  const current = getState();
  const currentIds = current.videos.map((video) => video.id);

  if (ids.length !== currentIds.length || new Set(ids).size !== ids.length || currentIds.some((id) => !ids.includes(id))) {
    return res.status(400).json({ error: "Reorder list must include every video exactly once" });
  }

  const state = updateState((draft) => {
    const orderMap = new Map(ids.map((id, index) => [id, index]));
    draft.videos.forEach((video) => { video.order = orderMap.get(video.id); });
    restartRotation(draft);
  });

  res.json({ ok: true, channel: channelPayload(state) });
});

app.delete("/api/admin/videos/:id", requireAdmin, (req, res) => {
  const current = getState();
  const video = current.videos.find((item) => item.id === req.params.id);
  if (!video) return res.status(404).json({ error: "Video not found" });

  const state = updateState((draft) => {
    draft.videos = draft.videos
      .filter((item) => item.id !== req.params.id)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map((item, index) => ({ ...item, order: index }));
    restartRotation(draft);
  });

  try { fs.unlinkSync(path.join(videosDir, video.fileName)); } catch {}
  res.json({ ok: true, channel: channelPayload(state) });
});

app.post("/api/admin/restart", requireAdmin, (req, res) => {
  const state = updateState((draft) => restartRotation(draft));
  res.json({ ok: true, channel: channelPayload(state) });
});

app.patch("/api/admin/settings", requireAdmin, (req, res) => {
  const state = updateState((draft) => {
    if (Object.hasOwn(req.body || {}, "name")) {
      const name = cleanText(req.body.name, 50);
      if (name) draft.channel.name = name;
    }
    if (Object.hasOwn(req.body || {}, "tagline")) draft.channel.tagline = cleanText(req.body.tagline, 100);
  });
  res.json({ ok: true, channel: state.channel });
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

app.use(express.static(publicDir, {
  etag: true,
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0
}));

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.use((error, req, res, next) => {
  if (req.file) deleteUploadedFile(req.file);

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Video is larger than this server allows" });
    return res.status(400).json({ error: error.message });
  }

  console.error(error);
  res.status(500).json({ error: error.message || "Unexpected server error" });
});

app.listen(port, "0.0.0.0", () => {
  console.log("24/7 channel listening on port " + port);
});

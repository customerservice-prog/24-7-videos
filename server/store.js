import fs from "node:fs";
import path from "node:path";

export const dataDir = path.resolve(process.env.DATA_DIR || "data");
export const videosDir = path.join(dataDir, "videos");
const statePath = path.join(dataDir, "channel.json");

function freshState() {
  const now = new Date().toISOString();
  return {
    version: 1,
    channel: {
      name: "24/7 LIVE",
      tagline: "Always on. Always live.",
      scheduleEpoch: Date.now(),
      createdAt: now,
      updatedAt: now
    },
    videos: []
  };
}

function ensureDirectories() {
  fs.mkdirSync(videosDir, { recursive: true });
}

function writeState(state) {
  ensureDirectories();
  const tempPath = statePath + ".tmp";
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2));
  fs.renameSync(tempPath, statePath);
}

function seedTestVideosIfRequested(state) {
  if (process.env.SEED_TEST_VIDEOS !== "true" || state.videos.length) return state;

  const seeds = [1, 2, 3]
    .map((number) => ({
      number,
      base64: process.env["SEED_VIDEO_" + number + "_B64"]
    }))
    .filter((seed) => seed.base64);

  if (!seeds.length) return state;

  const now = new Date().toISOString();
  seeds.forEach((seed, index) => {
    const fileName = "test-program-" + seed.number + ".mp4";
    fs.writeFileSync(path.join(videosDir, fileName), Buffer.from(seed.base64, "base64"));
    state.videos.push({
      id: "test-program-" + seed.number,
      title: "Test Program " + seed.number,
      duration: 2,
      fileName,
      originalName: fileName,
      mimeType: "video/mp4",
      size: fs.statSync(path.join(videosDir, fileName)).size,
      enabled: true,
      order: index,
      createdAt: now
    });
  });

  state.channel.scheduleEpoch = Date.now();
  state.channel.updatedAt = now;
  writeState(state);
  return state;
}

export function ensureStore() {
  ensureDirectories();
  if (!fs.existsSync(statePath)) {
    const state = freshState();
    writeState(state);
    seedTestVideosIfRequested(state);
  }
}

export function getState() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (!parsed.channel || !Array.isArray(parsed.videos)) throw new Error("Invalid channel state");
    return seedTestVideosIfRequested(parsed);
  } catch {
    const corruptPath = statePath + ".corrupt-" + Date.now();
    try { fs.renameSync(statePath, corruptPath); } catch {}
    const state = freshState();
    writeState(state);
    return state;
  }
}

export function updateState(mutator) {
  const next = structuredClone(getState());
  const returned = mutator(next);
  const state = returned || next;
  state.version = 1;
  state.channel.updatedAt = new Date().toISOString();
  writeState(state);
  return state;
}

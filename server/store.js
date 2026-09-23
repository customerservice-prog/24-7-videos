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

export function ensureStore() {
  ensureDirectories();
  if (!fs.existsSync(statePath)) writeState(freshState());
}

export function getState() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (!parsed.channel || !Array.isArray(parsed.videos)) throw new Error("Invalid channel state");
    return parsed;
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

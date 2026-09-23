import crypto from "node:crypto";

const COOKIE_NAME = "channel_admin";
const SESSION_HOURS = Math.max(1, Number(process.env.SESSION_HOURS || 12));

function adminPassword() {
  return String(process.env.ADMIN_PASSWORD || "");
}

function sessionSecret() {
  return String(process.env.SESSION_SECRET || ("24-7-videos:" + adminPassword()));
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

function safeEqual(a, b) {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

function signature(payload) {
  return crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function parseCookies(header = "") {
  return header.split(";").reduce((cookies, piece) => {
    const index = piece.indexOf("=");
    if (index === -1) return cookies;
    const key = piece.slice(0, index).trim();
    const value = piece.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

export function isAdminConfigured() {
  return adminPassword().length >= 8;
}

export function verifyPassword(candidate) {
  if (!isAdminConfigured()) return false;
  return safeEqual(String(candidate || ""), adminPassword());
}

export function issueSession(res) {
  const exp = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const payload = String(exp);
  const token = payload + "." + signature(payload);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", COOKIE_NAME + "=" + encodeURIComponent(token) + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + (SESSION_HOURS * 3600) + secure);
}

export function clearSession(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", COOKIE_NAME + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + secure);
}

export function isAuthenticated(req) {
  if (!isAdminConfigured()) return false;
  const token = parseCookies(req.headers.cookie || "")[COOKIE_NAME];
  if (!token) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  if (!safeEqual(suppliedSignature, signature(payload))) return false;

  const exp = Number(payload);
  return Number.isFinite(exp) && exp > Date.now();
}

export function requireAdmin(req, res, next) {
  if (!isAuthenticated(req)) return res.status(401).json({ error: "Authentication required" });
  next();
}

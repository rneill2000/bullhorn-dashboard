"use strict";

const crypto = require("crypto");

/** Generated Railway hostname for this service. Not the host people use. */
const RAILWAY_HOST = "bullhorn-dashboard-production.up.railway.app";
/** User-facing dashboard. Session cookies belong here. */
const CUSTOM_ORIGIN = "https://dashboard.anuraconnect.com";

const handoffs = new Map();
const HANDOFF_TTL_MS = 60 * 1000;

function hostOf(value) {
  const raw = String(value || "").split(",")[0].trim();
  if (!raw) return "";
  try {
    const withProto = raw.indexOf("://") === -1 ? "http://" + raw : raw;
    return new URL(withProto).hostname.toLowerCase();
  } catch (e) {
    return raw.replace(/:\d+$/, "").toLowerCase();
  }
}

/**
 * Origin that should own the bh_session cookie.
 * PUBLIC_BASE_URL wins. On this production service, the custom domain wins over
 * RAILWAY_PUBLIC_DOMAIN — that variable is the *.up.railway.app host, and a
 * cookie set there is invisible to dashboard.anuraconnect.com.
 * Returns "" off production so local login stays on localhost.
 */
function canonicalPublicOrigin(env) {
  env = env || process.env;
  const explicit = String(env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (explicit) {
    try {
      const u = new URL(explicit);
      if (u.protocol === "https:" || u.protocol === "http:") return u.origin;
    } catch (e) {}
    return "";
  }
  if (String(env.RAILWAY_PUBLIC_DOMAIN || "").toLowerCase() === RAILWAY_HOST) return CUSTOM_ORIGIN;
  return "";
}

function requestHost(req) {
  const headers = req && req.headers ? req.headers : {};
  return hostOf(headers.host || "");
}

/** True when this response would set a cookie on a different host than the dashboard. */
function sessionNeedsHandoff(req, env) {
  const origin = canonicalPublicOrigin(env);
  if (!origin) return false;
  const host = requestHost(req);
  if (!host) return true;
  return host !== hostOf(origin);
}

function safeNextPath(value) {
  const d = String(value || "");
  if (d.startsWith("/") && !d.startsWith("//") && d.indexOf("\\") === -1 && d.indexOf("\n") === -1 && d.indexOf("\r") === -1) return d;
  return "/";
}

/** Cookie value is already decoded by parseCookies; decode once more to match the old login path. */
function readNextCookie(raw) {
  if (raw == null || raw === "") return "";
  try {
    const d = decodeURIComponent(String(raw));
    return safeNextPath(d) === d ? d : "";
  } catch (e) {
    return "";
  }
}

/**
 * Host-only session cookie. No Domain attribute: Domain=.anuraconnect.com would
 * also send this token to other subdomains (ResumeKiln and the rest).
 */
function sessionCookie(token, secure) {
  const maxAge = token ? 86400 : 0;
  return "bh_session=" + (token || "") + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + (secure ? "; Secure" : "");
}

function issueSessionHandoff(sessionToken, nextPath) {
  sweepSessionHandoffs();
  const code = crypto.randomBytes(24).toString("hex");
  handoffs.set(code, { sessionToken: sessionToken, next: safeNextPath(nextPath), exp: Date.now() + HANDOFF_TTL_MS });
  return code;
}

function takeSessionHandoff(code, now) {
  const key = String(code || "");
  const row = handoffs.get(key);
  if (row) handoffs.delete(key);
  const t = now == null ? Date.now() : now;
  if (!row || row.exp < t) return null;
  return { sessionToken: row.sessionToken, next: row.next };
}

function sweepSessionHandoffs(now) {
  const t = now == null ? Date.now() : now;
  for (const [key, row] of handoffs) {
    if (row.exp < t) handoffs.delete(key);
  }
}

module.exports = {
  RAILWAY_HOST,
  CUSTOM_ORIGIN,
  canonicalPublicOrigin,
  requestHost,
  sessionNeedsHandoff,
  safeNextPath,
  readNextCookie,
  sessionCookie,
  issueSessionHandoff,
  takeSessionHandoff,
  sweepSessionHandoffs,
};

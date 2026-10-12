/** Minimal Bullhorn REST client for scripts: service-account login, GET with retry/backoff. */
"use strict";

const BH = {
  clientId: process.env.BULLHORN_CLIENT_ID, clientSecret: process.env.BULLHORN_CLIENT_SECRET,
  username: process.env.BULLHORN_API_USERNAME, password: process.env.BULLHORN_API_PASSWORD,
  authUrl: "https://auth.bullhornstaffing.com/oauth", restLoginUrl: "https://rest.bullhornstaffing.com/rest-services/login",
};
let session = null;

async function login() {
  const p = new URLSearchParams({ client_id: BH.clientId, response_type: "code", username: BH.username, password: BH.password, action: "Login" });
  const a = await fetch(`${BH.authUrl}/authorize?${p}`, { redirect: "manual" });
  const loc = a.headers.get("location") || "";
  const code = decodeURIComponent((loc.match(/code=([^&]+)/) || [])[1] || "");
  if (!code) throw new Error("Bullhorn auth: no code (status " + a.status + ")");
  const t = await fetch(`${BH.authUrl}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: BH.clientId, client_secret: BH.clientSecret }).toString() });
  if (!t.ok) throw new Error("token " + t.status);
  const { access_token } = await t.json();
  const l = await fetch(`${BH.restLoginUrl}?${new URLSearchParams({ version: "*", access_token, ttl: "60" })}`, { method: "POST" });
  if (!l.ok) throw new Error("rest login " + l.status);
  const j = await l.json();
  session = { token: j.BhRestToken, restUrl: j.restUrl, at: Date.now() };
  return session;
}

async function auth() {
  if (session && Date.now() - session.at < 50 * 60 * 1000) return session;
  return login();
}

class BhError extends Error { constructor(status, body, endpoint) { super(endpoint + " " + status + " " + body.slice(0, 300)); this.status = status; this.body = body; } }

/** GET an endpoint. Retries 429/5xx/network with backoff; re-logs in on 401. Throws BhError on 4xx. */
async function get(endpoint, params, attempt) {
  attempt = attempt || 0;
  const s = await auth();
  const qs = new URLSearchParams(Object.assign({}, params, { BhRestToken: s.token })).toString();
  let r;
  try { r = await fetch(`${s.restUrl}${endpoint}?${qs}`, { signal: AbortSignal.timeout(60000) }); }
  catch (e) { if (attempt < 5) { await sleep(1000 * Math.pow(2, attempt)); return get(endpoint, params, attempt + 1); } throw e; }
  if (r.status === 401 && attempt < 2) { session = null; return get(endpoint, params, attempt + 1); }
  if ((r.status === 429 || r.status >= 500) && attempt < 6) { await sleep(1500 * Math.pow(2, attempt)); return get(endpoint, params, attempt + 1); }
  if (!r.ok) throw new BhError(r.status, await r.text(), endpoint);
  return r.json();
}

function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

module.exports = { get, BhError, sleep };

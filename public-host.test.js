"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const host = require("./public-host");

const prod = { RAILWAY_PUBLIC_DOMAIN: "bullhorn-dashboard-production.up.railway.app" };

test("production callback host hands the session to the custom domain", function () {
  assert.equal(host.canonicalPublicOrigin(prod), "https://dashboard.anuraconnect.com");
  assert.equal(host.canonicalPublicOrigin({}), "");
  assert.equal(host.canonicalPublicOrigin({ PUBLIC_BASE_URL: "https://dashboard.anuraconnect.com/ignored" }), "https://dashboard.anuraconnect.com");
  assert.equal(host.canonicalPublicOrigin({ PUBLIC_BASE_URL: "javascript:alert(1)" }), "");

  const railway = { headers: { host: "bullhorn-dashboard-production.up.railway.app" } };
  const custom = { headers: { host: "dashboard.anuraconnect.com" } };
  assert.equal(host.sessionNeedsHandoff(railway, prod), true);
  assert.equal(host.sessionNeedsHandoff(custom, prod), false);
  assert.equal(host.sessionNeedsHandoff(railway, {}), false);

  const code = host.issueSessionHandoff("sess-1", "/#forge/42");
  const again = host.takeSessionHandoff(code);
  assert.equal(again.sessionToken, "sess-1");
  assert.equal(again.next, "/#forge/42");
  assert.equal(host.takeSessionHandoff(code), null);

  const expired = host.issueSessionHandoff("sess-2", "/");
  assert.equal(host.takeSessionHandoff(expired, Date.now() + 120000), null);

  assert.equal(host.safeNextPath("//evil.example"), "/");
  assert.equal(host.readNextCookie("%2F%2Fevil.example"), "");
  assert.equal(host.readNextCookie("%2F%23forge"), "/#forge");

  const cookie = host.sessionCookie("abc", true);
  assert.match(cookie, /^bh_session=abc;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.doesNotMatch(cookie, /Domain=/i);
  const cleared = host.sessionCookie("", true);
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /Secure/);
});

test("oauth redirect uris stay on the registered railway host", function () {
  const src = fs.readFileSync(__dirname + "/server.js", "utf8");
  assert.match(src, /redirect_uri: BH\.redirectUri/);
  assert.match(src, /redirectUri: \(process\.env\.RAILWAY_PUBLIC_DOMAIN \? "https:\/\/" \+ process\.env\.RAILWAY_PUBLIC_DOMAIN : process\.env\.BASE_URL \|\| "https:\/\/bullhorn-dashboard-production\.up\.railway\.app"\) \+ "\/auth\/outlook\/callback"/);
  assert.match(src, /app\.get\("\/auth\/finish"/);
  assert.match(src, /canonicalPublicOrigin\(\)/);
  assert.match(src, /issueSessionHandoff/);
});

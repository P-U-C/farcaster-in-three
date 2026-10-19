import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword } from "../src/auth.js";
import { createApp } from "../src/server.js";

test("login is cookie based and rate limited", async () => {
  const passwordHash = await hashPassword("a sufficiently long password");
  const app = createApp({
    PORT: 3333,
    FID: 37,
    SIGNER_PRIVATE_KEY: "11".repeat(32),
    SIGNER_PUBLIC_KEY: `0x${"22".repeat(32)}`,
    PASSWORD_HASH: passwordHash,
    SESSION_SECRET: "session-secret-that-is-at-least-32-characters",
    READ_NODE_URL: "http://127.0.0.1:9",
    WRITE_NODE_URL: "http://127.0.0.1:9",
    COOKIE_SECURE: "false",
    cookieSecure: false,
  });

  const good = await app.request("/api/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "192.0.2.1",
    },
    body: JSON.stringify({ password: "a sufficiently long password" }),
  });
  assert.equal(good.status, 200);
  assert.match(good.headers.get("set-cookie") ?? "", /HttpOnly/);
  assert.match(good.headers.get("set-cookie") ?? "", /SameSite=Strict/);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await app.request("/api/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "192.0.2.2",
      },
      body: JSON.stringify({ password: "wrong password" }),
    });
    assert.equal(response.status, 401);
  }

  const blocked = await app.request("/api/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "192.0.2.2",
    },
    body: JSON.stringify({ password: "a sufficiently long password" }),
  });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});

test("profile writes require an authenticated browser session", async () => {
  const app = createApp({
    PORT: 3333,
    FID: 37,
    SIGNER_PRIVATE_KEY: "11".repeat(32),
    SIGNER_PUBLIC_KEY: `0x${"22".repeat(32)}`,
    PASSWORD_HASH: "x".repeat(32),
    SESSION_SECRET: "session-secret-that-is-at-least-32-characters",
    READ_NODE_URL: "http://127.0.0.1:9",
    WRITE_NODE_URL: "http://127.0.0.1:9",
    COOKIE_SECURE: "false",
    cookieSecure: false,
  });

  const response = await app.request("/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "In Three" }),
  });
  assert.equal(response.status, 401);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  createSession,
  hashPassword,
  verifyPassword,
  verifySession,
} from "../src/auth.js";

test("passwords are salted and verified with scrypt", async () => {
  const first = await hashPassword("a sufficiently long password");
  const second = await hashPassword("a sufficiently long password");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("a sufficiently long password", first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
});

test("sessions are signed and expire", () => {
  const now = Date.UTC(2026, 9, 17);
  const token = createSession("a".repeat(32), now);
  assert.equal(verifySession(token, "a".repeat(32), now + 1_000), true);
  assert.equal(verifySession(token, "b".repeat(32), now + 1_000), false);
  assert.equal(
    verifySession(token, "a".repeat(32), now + 31 * 24 * 60 * 60 * 1_000),
    false,
  );
});

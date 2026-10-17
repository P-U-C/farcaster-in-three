import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function encode(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) {
    throw new Error("Password must be at least 12 characters");
  }
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 32)) as Buffer;
  return `scrypt$${encode(salt)}$${encode(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltText, expectedText] = stored.split("$");
  if (algorithm !== "scrypt" || !saltText || !expectedText) return false;

  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(expectedText, "base64url");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSession(secret: string, now = Date.now()): string {
  const payload = encode(
    JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS }),
  );
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySession(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    return typeof data.exp === "number" && data.exp > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

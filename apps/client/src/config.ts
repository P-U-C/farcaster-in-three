import { z } from "zod";
import { DEFAULT_VALIDATORS } from "./constants.js";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  FID: z.coerce.number().int().positive(),
  SIGNER_PRIVATE_KEY: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/),
  SIGNER_PUBLIC_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  PASSWORD_HASH: z.string().min(32),
  SESSION_SECRET: z.string().min(32),
  READ_NODE_URL: z.string().url().default("http://snapchain:3381"),
  VALIDATOR_URLS: z.string().default(DEFAULT_VALIDATORS.join(",")),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  const validatorUrls = parsed.VALIDATOR_URLS.split(",")
    .map((url) => url.trim().replace(/\/$/, ""))
    .filter(Boolean);

  if (validatorUrls.length === 0) {
    throw new Error("VALIDATOR_URLS must contain at least one endpoint");
  }

  return {
    ...parsed,
    SIGNER_PRIVATE_KEY: parsed.SIGNER_PRIVATE_KEY.replace(/^0x/, ""),
    READ_NODE_URL: parsed.READ_NODE_URL.replace(/\/$/, ""),
    validatorUrls,
    cookieSecure: parsed.COOKIE_SECURE === "true",
  };
}

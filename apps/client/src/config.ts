import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  FID: z.coerce.number().int().positive(),
  SIGNER_PRIVATE_KEY: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/),
  SIGNER_PUBLIC_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  PASSWORD_HASH: z.string().min(32),
  SESSION_SECRET: z.string().min(32),
  READ_NODE_URL: z.string().url().default("http://snapchain:3381"),
  WRITE_NODE_URL: z.string().url().optional(),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  const readNodeUrl = parsed.READ_NODE_URL.replace(/\/$/, "");

  return {
    ...parsed,
    SIGNER_PRIVATE_KEY: parsed.SIGNER_PRIVATE_KEY.replace(/^0x/, ""),
    READ_NODE_URL: readNodeUrl,
    WRITE_NODE_URL: (parsed.WRITE_NODE_URL ?? readNodeUrl).replace(/\/$/, ""),
    cookieSecure: parsed.COOKIE_SECURE === "true",
  };
}

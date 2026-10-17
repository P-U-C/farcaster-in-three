import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { createSession, verifyPassword, verifySession } from "./auth.js";
import { loadConfig, type AppConfig } from "./config.js";
import { FarcasterWriter } from "./protocol.js";
import { SnapchainReader } from "./snapchain.js";
import type { FeedCast, Source } from "./types.js";

const loginSchema = z.object({ password: z.string().min(1).max(256) });
const castSchema = z.object({
  text: z.string().trim().min(1).max(1024),
  embedUrl: z.string().url().max(2048).optional(),
  parentCastId: z
    .object({
      fid: z.number().int().positive(),
      hash: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    })
    .optional(),
});
const followSchema = z.object({
  targetFid: z.number().int().positive(),
  remove: z.boolean().default(false),
});
const reactionSchema = z.object({
  type: z.enum(["like", "recast"]),
  targetFid: z.number().int().positive(),
  targetHash: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  remove: z.boolean().default(false),
});

export function createApp(config: AppConfig = loadConfig()) {
  const app = new Hono();
  const reader = new SnapchainReader(config.READ_NODE_URL);
  const writer = new FarcasterWriter(config);
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();
  let latestFeed: FeedCast[] = [];

  app.use("*", async (context, next) => {
    context.header("X-Content-Type-Options", "nosniff");
    context.header("X-Frame-Options", "DENY");
    context.header("Referrer-Policy", "no-referrer");
    context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    context.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' https: data:; font-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'",
    );
    await next();
  });

  app.get("/api/health", async (context) => {
    try {
      const info = await reader.info();
      return context.json({ ok: true, node: info });
    } catch (error) {
      return context.json(
        { ok: false, error: error instanceof Error ? error.message : String(error) },
        503,
      );
    }
  });

  app.post("/api/login", async (context) => {
    const input = loginSchema.parse(await context.req.json());
    const clientIp = context.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "direct";
    const now = Date.now();
    const attempt = loginAttempts.get(clientIp);
    if (attempt && attempt.resetAt > now && attempt.count >= 8) {
      context.header("Retry-After", String(Math.ceil((attempt.resetAt - now) / 1000)));
      return context.json({ error: "Too many login attempts" }, 429);
    }
    if (!(await verifyPassword(input.password, config.PASSWORD_HASH))) {
      loginAttempts.set(clientIp, {
        count: attempt && attempt.resetAt > now ? attempt.count + 1 : 1,
        resetAt: attempt && attempt.resetAt > now ? attempt.resetAt : now + 15 * 60_000,
      });
      return context.json({ error: "Invalid password" }, 401);
    }
    loginAttempts.delete(clientIp);
    setCookie(context, "in_three_session", createSession(config.SESSION_SECRET), {
      httpOnly: true,
      sameSite: "Strict",
      secure: config.cookieSecure,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return context.json({ ok: true });
  });

  app.post("/api/logout", (context) => {
    deleteCookie(context, "in_three_session", { path: "/" });
    return context.json({ ok: true });
  });

  app.use("/api/*", async (context, next) => {
    const token = getCookie(context, "in_three_session");
    if (!verifySession(token, config.SESSION_SECRET)) {
      return context.json({ error: "Authentication required" }, 401);
    }
    await next();
  });

  app.get("/api/me", async (context) => {
    const [profile, storage, node] = await Promise.all([
      reader.profile(config.FID),
      reader.storage(config.FID),
      reader.info(),
    ]);
    return context.json({
      profile,
      storage,
      node,
      fid: config.FID,
      signer: config.SIGNER_PUBLIC_KEY,
      readNode: config.READ_NODE_URL,
    });
  });

  app.get("/api/feed", async (context) => {
    latestFeed = await reader.feed(config.FID);
    return context.json({ casts: latestFeed });
  });

  app.get("/api/sources", async (context) => {
    if (latestFeed.length === 0) latestFeed = await reader.feed(config.FID);
    const pairs = [
      ...new Map(
        latestFeed.map((cast) => [`${cast.fid}:${cast.signer}`, cast] as const),
      ).values(),
    ].slice(0, 32);

    const sources: Source[] = await Promise.all(
      pairs.map(async (cast) => {
        const requestFid = await reader.requestFidForSigner(cast.fid, cast.signer);
        let label = `Signer ${shortKey(cast.signer)}`;
        if (cast.signer === config.SIGNER_PUBLIC_KEY.toLowerCase()) {
          label = "In Three";
        } else if (requestFid) {
          try {
            const profile = await reader.profile(requestFid);
            label = profile.displayName || profile.username;
          } catch {
            label = `Client FID ${requestFid}`;
          }
        }
        return {
          signer: cast.signer,
          requestFid,
          label,
          isThisClient: cast.signer === config.SIGNER_PUBLIC_KEY.toLowerCase(),
        };
      }),
    );

    return context.json({ sources });
  });

  app.post("/api/casts", async (context) => {
    const input = castSchema.parse(await context.req.json());
    const result = await writer.cast(input);
    return context.json({ ok: true, ...result }, 201);
  });

  app.post("/api/follows", async (context) => {
    const input = followSchema.parse(await context.req.json());
    const result = await writer.follow(input.targetFid, input.remove);
    return context.json({ ok: true, ...result }, 201);
  });

  app.post("/api/reactions", async (context) => {
    const input = reactionSchema.parse(await context.req.json());
    const result = await writer.react(input);
    return context.json({ ok: true, ...result }, 201);
  });

  app.onError((error, context) => {
    console.error(error instanceof Error ? error.message : error);
    if (error instanceof z.ZodError) {
      return context.json({ error: "Invalid request", issues: error.issues }, 400);
    }
    return context.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500,
    );
  });

  app.all("/api/*", (context) => context.json({ error: "Not found" }, 404));

  app.use("/assets/*", serveStatic({ root: "./dist/web" }));
  app.get("/favicon.svg", serveStatic({ path: "./dist/web/favicon.svg" }));
  app.get("*", serveStatic({ path: "./dist/web/index.html" }));

  return app;
}

function shortKey(key: string): string {
  return key ? `${key.slice(0, 7)}…${key.slice(-4)}` : "unknown";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  serve(
    {
      fetch: createApp(config).fetch,
      port: config.PORT,
      hostname: "0.0.0.0",
    },
    ({ port }) => {
      console.log(`In Three client listening on http://0.0.0.0:${port}`);
    },
  );
}

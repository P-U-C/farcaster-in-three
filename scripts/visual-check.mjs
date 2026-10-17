import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { scryptSync } from "node:crypto";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url).pathname;
const password = "correct horse battery staple";
const signer = `0x${"7a".repeat(32)}`;
const profiles = new Map([
  [37, { username: "balajis.eth", display: "Balaji", bio: "Network state builder" }],
  [2, { username: "v", display: "Varun", bio: "Farcaster" }],
  [5650, { username: "protocol", display: "Protocol Research", bio: "Open social systems" }],
]);

function json(response, value) {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
}

const mock = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const fid = Number(url.searchParams.get("fid") ?? 37);

  if (url.pathname === "/v1/info") {
    return json(response, {
      version: "0.14.3",
      shardInfos: [
        { shardId: 1, blockDelay: 3 },
        { shardId: 2, blockDelay: 4 },
      ],
    });
  }
  if (url.pathname === "/v1/storageLimitsByFid") {
    return json(response, {
      units: 2,
      limits: [{ name: "CASTS", limit: 10000, used: 784 }],
    });
  }
  if (url.pathname === "/v1/linksByFid") {
    return json(response, {
      messages: [
        { data: { linkBody: { type: "follow", targetFid: 2 } } },
        { data: { linkBody: { type: "follow", targetFid: 5650 } } },
      ],
    });
  }
  if (url.pathname === "/v1/userDataByFid") {
    const profile = profiles.get(fid) ?? { username: `fid${fid}`, display: `FID ${fid}`, bio: "" };
    return json(response, {
      messages: [
        { data: { userDataBody: { type: "USER_DATA_TYPE_USERNAME", value: profile.username } } },
        { data: { userDataBody: { type: "USER_DATA_TYPE_DISPLAY", value: profile.display } } },
        { data: { userDataBody: { type: "USER_DATA_TYPE_BIO", value: profile.bio } } },
      ],
    });
  }
  if (url.pathname === "/v1/castsByFid") {
    const base = 182_000_000 - fid;
    const texts = {
      37: [
        "The network is the new institution. The practical question is whether you can operate your own edge.",
        "A credible tutorial ends with a working artifact, not a screenshot.",
      ],
      2: [
        "Protocol clients should be able to read state without renting access from an intermediary.",
        "Shipping smaller, inspectable components makes the trust model legible.",
      ],
      5650: [
        "Read locally, sign locally, submit directly. The architecture is the product.",
        "Open protocols become real when the operational path is ordinary.",
      ],
    };
    return json(response, {
      messages: (texts[fid] ?? ["A cast from Snapchain."]).map((text, index) => ({
        data: {
          type: "MESSAGE_TYPE_CAST_ADD",
          fid,
          timestamp: base - index * 3000,
          castAddBody: {
            text,
            embeds: index === 0 && fid === 37 ? [{ url: "https://snapchain.farcaster.xyz" }] : [],
          },
        },
        hash: `0x${(fid * 100 + index).toString(16).padStart(40, "0")}`,
        signer: fid === 37 ? signer : `0x${fid.toString(16).padStart(64, "0")}`,
      })),
    });
  }
  if (url.pathname === "/v1/onChainSignersByFid") {
    return json(response, { events: [] });
  }
  response.statusCode = 404;
  return json(response, { error: "not found" });
});

await new Promise((resolve) => mock.listen(4381, "127.0.0.1", resolve));

const salt = Buffer.from("visual-check-salt");
const hash = scryptSync(password, salt, 32);
const passwordHash = `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;

const client = spawn("node", ["dist/server/server.js"], {
  cwd: `${root}apps/client`,
  stdio: "ignore",
  env: {
    ...process.env,
    PORT: "3333",
    FID: "37",
    SIGNER_PRIVATE_KEY: "11".repeat(32),
    SIGNER_PUBLIC_KEY: signer,
    PASSWORD_HASH: passwordHash,
    SESSION_SECRET: "visual-session-secret-that-is-long-enough",
    READ_NODE_URL: "http://127.0.0.1:4381",
    VALIDATOR_URLS: "http://127.0.0.1:4381",
    COOKIE_SECURE: "false",
  },
});

const site = spawn("npm", ["run", "dev", "--workspace", "@in-three/site", "--", "--port", "4173"], {
  cwd: root,
  stdio: "ignore",
});

const children = [client, site];
const cleanup = async () => {
  for (const child of children) child.kill("SIGTERM");
  await new Promise((resolve) => mock.close(resolve));
};

try {
  await waitFor("http://127.0.0.1:3333/");
  await waitFor("http://127.0.0.1:4173/farcaster-in-three/");

  const browser = await chromium.launch({
    executablePath: "/home/ubuntu/.local/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });

  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("401 (Unauthorized)") &&
      !message.text().includes("404 (Not Found)")
    ) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && response.status() !== 401) {
      errors.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });

  await page.goto("http://127.0.0.1:3333/", { waitUntil: "networkidle" });
  await page.getByLabel("Client password").fill(password);
  await page.getByRole("button", { name: "Open client" }).click();
  await page.getByText("recent casts").waitFor();
  await page.screenshot({ path: "/tmp/in-three-client-desktop.png", fullPage: true });
  await assertNoOverflow(page, "client desktop");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.screenshot({ path: "/tmp/in-three-client-mobile.png", fullPage: true });
  await assertNoOverflow(page, "client mobile");

  const sitePage = await context.newPage();
  sitePage.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("404 (Not Found)")) {
      errors.push(message.text());
    }
  });
  sitePage.on("pageerror", (error) => errors.push(error.message));
  sitePage.on("response", (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  await sitePage.setViewportSize({ width: 1440, height: 1000 });
  await sitePage.goto("http://127.0.0.1:4173/farcaster-in-three/", { waitUntil: "networkidle" });
  await sitePage.screenshot({ path: "/tmp/in-three-site-desktop.png", fullPage: true });
  await assertNoOverflow(sitePage, "site desktop");

  await sitePage.setViewportSize({ width: 390, height: 844 });
  await sitePage.reload({ waitUntil: "networkidle" });
  await sitePage.screenshot({ path: "/tmp/in-three-site-mobile.png", fullPage: true });
  await assertNoOverflow(sitePage, "site mobile");

  await browser.close();
  if (errors.length) {
    throw new Error(`browser errors:\n${errors.join("\n")}`);
  }

  console.log("visual checks passed");
  console.log("/tmp/in-three-client-desktop.png");
  console.log("/tmp/in-three-client-mobile.png");
  console.log("/tmp/in-three-site-desktop.png");
  console.log("/tmp/in-three-site-mobile.png");
} finally {
  await cleanup();
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not start: ${url}`);
}

async function assertNoOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (metrics.scrollWidth > metrics.clientWidth + 1) {
    throw new Error(`${label} overflows horizontally: ${metrics.scrollWidth} > ${metrics.clientWidth}`);
  }
}

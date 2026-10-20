import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { scryptSync } from "node:crypto";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url).pathname;
const password = "correct horse battery staple";
const ownerFid = 910_001;
const followedFids = Array.from({ length: 9 }, (_, index) => ownerFid + index + 1);
const signer = `0x${"7a".repeat(32)}`;
const profiles = new Map([
  [ownerFid, { username: "alex-node", display: "Alex Rivera", bio: "Runs a small protocol node" }],
  [followedFids[0], { username: "mira-builds", display: "Mira Chen", bio: "Client developer" }],
  [followedFids[1], { username: "devon-ops", display: "Devon Brooks", bio: "Infrastructure notes" }],
  [followedFids[2], { username: "samira-data", display: "Samira Okafor", bio: "Open data systems" }],
]);

function json(response, value) {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
}

const mock = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const fid = Number(url.searchParams.get("fid") ?? ownerFid);

  if (url.pathname === "/v1/info") {
    return json(response, {
      version: "0.14.3",
      shardInfos: [
        { shardId: 0, blockDelay: 2 },
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
      messages: followedFids.map((targetFid) => ({
        data: { linkBody: { type: "follow", targetFid } },
      })),
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
    const texts = new Map([
      [ownerFid, ["Node sync finished at 14:32 UTC. All three shard delays are under five seconds.", "Testing the first cast from the delegated app key."]],
      [followedFids[0], ["The setup log now reports snapshot size while the HTTP API is unavailable."]],
      [followedFids[1], ["Documented exact recovery after an uncertain gasless signer submission."]],
      [followedFids[2], ["The mobile client can follow an FID without opening a desktop sidebar."]],
    ]);
    return json(response, {
      messages: (texts.get(fid) ?? [`Synthetic test cast for FID ${fid}.`]).map((text, index) => ({
        data: {
          type: "MESSAGE_TYPE_CAST_ADD",
          fid,
          timestamp: base - index * 3000,
          castAddBody: {
            text,
            embeds: index === 0 && fid === ownerFid ? [{ url: "https://snapchain.farcaster.xyz" }] : [],
          },
        },
        hash: `0x${(fid * 100 + index).toString(16).padStart(40, "0")}`,
        signer: fid === ownerFid ? signer : `0x${fid.toString(16).padStart(64, "0")}`,
      })),
    });
  }
  if (url.pathname === "/v1/submitMessage" && request.method === "POST") {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => json(response, { accepted: true, bytes: Buffer.concat(chunks).length }));
    return;
  }
  if (url.pathname === "/v1/signersByFid") {
    return json(response, {
      signers: [
        {
          source: "SIGNER_SOURCE_OFFCHAIN",
          key: fid === ownerFid ? signer : `0x${fid.toString(16).padStart(64, "0")}`,
          requestFid: fid,
        },
      ],
      currentUserNonce: 1,
      gaslessSignerCount: 1,
      gaslessSignerLimit: 10,
    });
  }
  response.statusCode = 404;
  return json(response, { error: "not found" });
});

await new Promise((resolve) => mock.listen(4381, "127.0.0.1", resolve));

const salt = Buffer.from("visual-check-salt");
const hash = scryptSync(password, salt, 32);
const passwordHash = `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;

const clientLogs = [];
const client = spawn("node", ["dist/server/server.js"], {
  cwd: `${root}apps/client`,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: "3333",
    FID: String(ownerFid),
    SIGNER_PRIVATE_KEY: "11".repeat(32),
    SIGNER_PUBLIC_KEY: signer,
    PASSWORD_HASH: passwordHash,
    SESSION_SECRET: "visual-session-secret-that-is-long-enough",
    READ_NODE_URL: "http://127.0.0.1:4381",
    WRITE_NODE_URL: "http://127.0.0.1:4381",
    COOKIE_SECURE: "false",
  },
});
client.stdout.on("data", (chunk) => clientLogs.push(chunk.toString()));
client.stderr.on("data", (chunk) => clientLogs.push(chunk.toString()));

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
  await waitFor("http://127.0.0.1:4173/");

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
  const sourceCount = await page.locator(".context-rail .source-list button").count();
  if (sourceCount !== followedFids.length + 1) {
    throw new Error(`source controls: expected ${followedFids.length + 1}, received ${sourceCount}`);
  }

  const firstCast = page.locator(".cast-row").first();
  await firstCast.getByTitle("Like").click();
  await firstCast.getByTitle("Remove like").waitFor();
  await firstCast.getByTitle("Remove like").click();
  await firstCast.getByTitle("Like").waitFor();
  await firstCast.getByTitle("Recast").click();
  await firstCast.getByTitle("Remove recast").waitFor();
  await firstCast.getByTitle("Remove recast").click();
  await firstCast.getByTitle("Recast").waitFor();

  await page.screenshot({ path: "/tmp/in-three-client-desktop.png", fullPage: true });
  await assertNoOverflow(page, "client desktop");

  await page.setViewportSize({ width: 900, height: 900 });
  await page.reload({ waitUntil: "networkidle" });
  if (!(await page.locator(".follow-button").isVisible())) {
    throw new Error("follow control is not visible on a narrow desktop");
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('.mobile-nav button[title="Follow an FID"]').click();
  const followDialog = page.getByRole("dialog", { name: "Follow an FID" });
  await followDialog.waitFor();
  await followDialog.getByLabel("FID").fill(String(followedFids[0]));
  await followDialog.getByTitle("Follow FID").click();
  await followDialog.waitFor({ state: "hidden" });
  await page.locator('.mobile-nav button[title="Follow an FID"]').click();
  await followDialog.waitFor();
  await followDialog.getByRole("button", { name: "Unfollow" }).click();
  await followDialog.getByLabel("FID").fill(String(followedFids[0]));
  await followDialog.getByTitle("Unfollow FID").click();
  await followDialog.waitFor({ state: "hidden" });
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
  await sitePage.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  const heroText = await sitePage.locator(".hero-copy > p").innerText();
  if (
    !heroText.includes("Reads and signed writes go through your node") ||
    !heroText.includes("No hosted Farcaster data API")
  ) {
    throw new Error("website hero does not state the owned read/write path");
  }
  const packagePills = sitePage.locator(".package-pill");
  if (await packagePills.count() !== 4) {
    throw new Error("site must expose npm, container, release, and source links at the top");
  }
  const packageHrefs = await packagePills.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")),
  );
  const expectedPackageHrefs = [
    "https://www.npmjs.com/package/farcaster-in-three",
    "https://github.com/orgs/P-U-C/packages/container/package/farcaster-in-three",
    "https://github.com/P-U-C/farcaster-in-three/releases/tag/v0.1.20",
    "https://github.com/P-U-C/farcaster-in-three",
  ];
  if (expectedPackageHrefs.some((href) => !packageHrefs.includes(href))) {
    throw new Error("one or more top package links has the wrong destination");
  }

  const npmMethod = sitePage.getByRole("button", { name: /npm CLI/ });
  const dockerMethod = sitePage.getByRole("button", { name: /Docker/ });
  if (await npmMethod.getAttribute("aria-pressed") !== "true") {
    throw new Error("npm must be the default website install method");
  }
  if (!(await sitePage.locator(".install-block").innerText()).includes("npm install --global farcaster-in-three")) {
    throw new Error("website npm quickstart is missing");
  }
  const stepNumbers = await sitePage.locator(".three-steps article header b").allTextContents();
  if (JSON.stringify(stepNumbers) !== JSON.stringify(["1", "2", "3"])) {
    throw new Error(`website setup steps are not numbered 1-3: ${stepNumbers.join(",")}`);
  }
  if (!(await sitePage.getByRole("heading", { name: "Your Farcaster account is handled in step 3." }).isVisible())) {
    throw new Error("website does not place account creation in step 3");
  }
  if (!(await sitePage.getByRole("heading", { name: "FAQ" }).isVisible())) {
    throw new Error("website FAQ heading is missing");
  }
  const hetznerHelp = sitePage.locator("#hetzner-help");
  if (await hetznerHelp.getAttribute("open") !== null) {
    throw new Error("Hetzner help must be folded by default");
  }
  const hetznerJump = sitePage.locator(".hetzner-jump");
  const hetznerJumpColor = await hetznerJump.evaluate(
    (element) => getComputedStyle(element).color,
  );
  if (hetznerJumpColor !== "rgb(121, 80, 190)") {
    throw new Error(`Hetzner help link is not purple: ${hetznerJumpColor}`);
  }
  const hetznerFlagWeight = await hetznerJump.locator("strong").evaluate(
    (element) => Number.parseInt(getComputedStyle(element).fontWeight, 10),
  );
  if (hetznerFlagWeight < 700) {
    throw new Error(`--hetzner is not bold: ${hetznerFlagWeight}`);
  }
  await hetznerJump.click();
  if (await hetznerHelp.getAttribute("open") === null) {
    throw new Error("Hetzner help link did not open the accordion");
  }
  if (new URL(sitePage.url()).hash !== "#hetzner-help") {
    throw new Error(`Hetzner help link has the wrong target: ${sitePage.url()}`);
  }
  if (!(await hetznerHelp.innerText()).includes("2,048 GiB")) {
    throw new Error("Hetzner help omits the required Volume quota");
  }
  const finalCtaColor = await sitePage.locator(".final-cta").evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  if (finalCtaColor !== "rgb(121, 80, 190)") {
    throw new Error(`final call-to-action is not purple: ${finalCtaColor}`);
  }
  await dockerMethod.click();
  if (!(await sitePage.locator(".install-block").innerText()).includes("./in-three-container doctor")) {
    throw new Error("website Docker quickstart does not switch in");
  }
  if (!(await sitePage.locator(".three-steps").innerText()).includes("./in-three-container provision")) {
    throw new Error("website Docker commands do not switch with the installer");
  }
  await npmMethod.click();
  await sitePage.evaluate(() => window.scrollTo(0, 0));

  await sitePage.screenshot({ path: "/tmp/in-three-site-desktop.png", fullPage: true });
  await assertNoOverflow(sitePage, "site desktop");

  await sitePage.setViewportSize({ width: 390, height: 844 });
  await sitePage.reload({ waitUntil: "networkidle" });
  for (let index = 0; index < 4; index += 1) {
    if (!(await packagePills.nth(index).isVisible())) {
      throw new Error(`top package link ${index + 1} is hidden on mobile`);
    }
  }
  if (!(await npmMethod.isVisible()) || !(await dockerMethod.isVisible())) {
    throw new Error("installation method selector is hidden on mobile");
  }
  await hetznerJump.click();
  if (await hetznerHelp.getAttribute("open") === null || new URL(sitePage.url()).hash !== "#hetzner-help") {
    throw new Error("Hetzner help link did not open the accordion on mobile");
  }
  await sitePage.evaluate(() => {
    const details = document.getElementById("hetzner-help");
    if (details instanceof HTMLDetailsElement) {
      details.open = false;
    }
    window.history.replaceState(null, "", window.location.pathname);
  });
  await dockerMethod.click();
  await assertNoOverflow(sitePage, "site mobile Docker method");
  await npmMethod.click();
  await sitePage.evaluate(() => window.scrollTo(0, 0));
  await sitePage.screenshot({ path: "/tmp/in-three-site-mobile.png", fullPage: true });
  await assertNoOverflow(sitePage, "site mobile");

  await new Promise((resolve) => setTimeout(resolve, 100));
  const receiptLog = clientLogs.join("");
  for (const action of ["like", "like_remove", "recast", "recast_remove", "follow", "unfollow"]) {
    if (!receiptLog.includes(`\"action\":\"${action}\"`)) {
      throw new Error(`missing redacted client receipt for ${action}`);
    }
  }

  await browser.close();
  if (errors.length) {
    throw new Error(`browser errors:\n${errors.join("\n")}`);
  }

  console.log("visual checks passed");
  console.log("/tmp/in-three-client-desktop.png");
  console.log("/tmp/in-three-client-mobile.png");
  console.log("/tmp/in-three-site-desktop.png");
  console.log("/tmp/in-three-site-mobile.png");
} catch (error) {
  console.error(clientLogs.join(""));
  throw error;
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

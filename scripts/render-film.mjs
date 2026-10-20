import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outputDir = resolve(root, "site/public");
const tempDir = resolve(root, ".video-output");
const require = createRequire(resolve(root, "package.json"));
const { chromium } = require("playwright");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}

async function record(browser, name, viewport, portrait = false) {
  const captureDir = resolve(tempDir, `capture-${name}`);
  await mkdir(captureDir, { recursive: true });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    recordVideo: { dir: captureDir, size: viewport },
  });
  const page = await context.newPage();
  const source = new URL(pathToFileURL(resolve(here, "video/in-three-film.html")));
  if (portrait) source.searchParams.set("vertical", "1");
  await page.goto(source.href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const video = page.video();
  await page.evaluate(() => document.body.classList.add("play"));
  await page.waitForTimeout(60_000);
  await page.close();
  await context.close();
  const capturedPath = await video.path();
  const rawPath = resolve(tempDir, `${name}-raw.webm`);
  await rename(capturedPath, rawPath);
  return rawPath;
}

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });
const executablePath = [
  process.env.CHROME,
  chromium.executablePath(),
  "/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
].find((candidate) => candidate && existsSync(candidate));
if (!executablePath) {
  throw new Error("No Playwright-compatible Chromium executable found");
}
const browser = await chromium.launch({ headless: true, executablePath });

try {
  console.log("Recording 59-second landscape film...");
  const landscape = await record(
    browser,
    "landscape",
    { width: 1280, height: 720 },
    false,
  );
  console.log("Recording 59-second vertical film...");
  const vertical = await record(
    browser,
    "vertical",
    { width: 720, height: 1280 },
    true,
  );

  run("ffmpeg", [
    "-y",
    "-sseof",
    "-59",
    "-i",
    landscape,
    "-t",
    "59",
    "-an",
    "-vf",
    "fps=30,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "24",
    "-movflags",
    "+faststart",
    resolve(outputDir, "in-three-film.mp4"),
  ]);
  run("ffmpeg", [
    "-y",
    "-sseof",
    "-59",
    "-i",
    vertical,
    "-t",
    "59",
    "-an",
    "-vf",
    "fps=30,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "25",
    "-movflags",
    "+faststart",
    resolve(outputDir, "in-three-vertical.mp4"),
  ]);
  run("ffmpeg", [
    "-y",
    "-ss",
    "2",
    "-i",
    resolve(outputDir, "in-three-film.mp4"),
    "-frames:v",
    "1",
    "-quality",
    "82",
    resolve(outputDir, "in-three-film-poster.webp"),
  ]);
} finally {
  await browser.close();
  await rm(tempDir, { recursive: true, force: true });
}

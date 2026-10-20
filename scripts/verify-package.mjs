import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const required = [
  "bin/in-three.mjs",
  "farcaster",
  "Dockerfile.operator",
  "container-entrypoint",
  "in-three-container",
  "in-three.compose.yml",
  "npm-shrinkwrap.json",
  "README.md",
  "apps/client/Dockerfile",
  "apps/client/dist/server/setup.js",
  "apps/client/dist/server/server.js",
  "apps/client/dist/server/agent-gateway.js",
  "apps/client/dist/server/deployment-service.js",
  "apps/client/dist/web/index.html",
  "deploy/docker-compose.yml",
  "deploy/snapchain-healthcheck.sh",
  "deploy/snapshot-manager.sh",
  "scripts/provision.sh",
  "scripts/node.sh",
  "scripts/client.sh",
  "scripts/proof.sh",
  "scripts/destroy.sh",
  "docs/PROOF.md",
];

await Promise.all(
  required.map(async (path) => {
    try {
      await access(resolve(root, path), constants.R_OK);
    } catch {
      throw new Error(`package artifact is missing ${path}`);
    }
  }),
);

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (packageJson.private === true) throw new Error("package must not be private");
if (packageJson.bin?.["in-three"] !== "bin/in-three.mjs") {
  throw new Error("package must expose the in-three executable");
}
if (packageJson.dependencies?.["@celo/buy"] !== "0.8.3") {
  throw new Error("package must pin the reviewed usebuy.ai CLI release");
}

const readme = await readFile(resolve(root, "README.md"), "utf8");
const npmInstall = readme.indexOf("npm install --global farcaster-in-three");
const containerInstall = readme.indexOf("curl -fsSLO");
if (npmInstall < 0 || containerInstall < 0 || npmInstall > containerInstall) {
  throw new Error("package README must lead with the npm quickstart");
}
if (!readme.includes("in-three provision\nin-three node up\nin-three client create")) {
  throw new Error("package README must show the three npm commands");
}
if (!readme.includes(`/v${packageJson.version}/in-three-container`)) {
  throw new Error("package README container link must match the package version");
}

const dockerfile = await readFile(resolve(root, "apps/client/Dockerfile"), "utf8");
if (/npm run build/.test(dockerfile)) {
  throw new Error("runtime Dockerfile must consume prebuilt assets");
}
if (!/apps\/client\/dist/.test(dockerfile)) {
  throw new Error("runtime Dockerfile does not copy prebuilt client assets");
}

process.stdout.write("package artifacts are complete and prebuilt\n");

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", "dist", "node_modules"]);
const markdownFiles = findMarkdown(root);
const failures = [];

for (const file of markdownFiles) {
  const text = readFileSync(file, "utf8");
  const relativeFile = file.slice(root.length + 1);

  const backticks = [...text].filter((character) => character === "`").length;
  if (backticks % 2 !== 0) {
    failures.push(`${relativeFile}: unbalanced Markdown backticks`);
  }

  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim();
    const target = rawTarget.startsWith("<")
      ? rawTarget.slice(1, rawTarget.indexOf(">"))
      : rawTarget.split(/\s+/)[0];
    const pathWithoutAnchor = target.split("#")[0];

    if (
      !pathWithoutAnchor ||
      /^(?:data:|https?:|mailto:|tel:)/i.test(pathWithoutAnchor)
    ) {
      continue;
    }

    const destination = resolve(dirname(file), decodeURIComponent(pathWithoutAnchor));
    if (!existsSync(destination)) {
      failures.push(`${relativeFile}: missing local link ${target}`);
    }
  }
}

const siteSource = [
  readFileSync(join(root, "site/src/App.tsx"), "utf8"),
  readFileSync(join(root, "site/src/styles.css"), "utf8"),
].join("\n");

if (/\b(?:bounty|voucher|deadline)\b/i.test(siteSource)) {
  failures.push("site: bounty, voucher, or deadline copy must stay out of the product page");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`documentation checks passed (${markdownFiles.length} Markdown files)`);

function findMarkdown(directory) {
  const files = [];

  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) continue;
    const path = join(directory, entry);
    const metadata = statSync(path);

    if (metadata.isDirectory()) {
      files.push(...findMarkdown(path));
    } else if (entry.endsWith(".md")) {
      files.push(path);
    }
  }

  return files;
}

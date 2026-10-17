#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import {
  decodePaymentResponseHeader,
  wrapFetchWithPaymentFromConfig,
} from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const BASE_NETWORK = "eip155:8453";

function fail(message) {
  console.error(`Base payment failed: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const result = { max: "0.005", method: "GET", yes: false, quoteOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--url") result.url = argv[++index];
    else if (value === "--max") result.max = argv[++index];
    else if (value === "--method") result.method = argv[++index]?.toUpperCase();
    else if (value === "--data-file") result.dataFile = argv[++index];
    else if (value === "--output") result.output = argv[++index];
    else if (value === "--receipt-output") result.receiptOutput = argv[++index];
    else if (value === "--yes") result.yes = true;
    else if (value === "--quote-only") result.quoteOnly = true;
    else if (value === "--help" || value === "-h") result.help = true;
    else fail(`unknown argument ${value}`);
  }
  return result;
}

function atomicUsdc(value) {
  const match = value?.match(/^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/);
  if (!match) fail("--max must be a decimal USDC amount with at most 6 decimals");
  return BigInt(`${match[1]}${(match[2] ?? "").padEnd(6, "0")}`);
}

function decodeRequired(header) {
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    fail("the server returned an invalid PAYMENT-REQUIRED header");
  }
}

function readHidden(prompt) {
  if (!process.stdin.isTTY) {
    fail("a private key requires an interactive terminal or X402_BASE_PRIVATE_KEY");
  }
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const wasRaw = input.isRaw;
    let value = "";

    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const byte of chunk) {
        if (byte === 3) {
          cleanup();
          reject(new Error("Cancelled"));
          return;
        }
        if (byte === 10 || byte === 13) {
          cleanup();
          resolve(value);
          return;
        }
        if (byte === 8 || byte === 127) {
          value = value.slice(0, -1);
          continue;
        }
        value += String.fromCharCode(byte);
      }
    };

    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(
    "Usage: node scripts/pay-base.mjs --url HTTPS_URL [--max USDC] [--method GET|POST] [--data-file PATH] [--output PATH] [--receipt-output PATH] [--quote-only|--yes]",
  );
  process.exit(0);
}
if (!options.url) fail("--url is required");

let url;
try {
  url = new URL(options.url);
} catch {
  fail("--url must be a valid URL");
}
if (url.protocol !== "https:") fail("--url must use HTTPS");
if (!["GET", "POST"].includes(options.method)) {
  fail("--method must be GET or POST");
}
if (options.method === "GET" && options.dataFile) {
  fail("--data-file is valid only with --method POST");
}
if (options.method === "POST" && !options.dataFile) {
  fail("--method POST requires --data-file");
}

const requestBody = options.dataFile
  ? await readFile(options.dataFile)
  : undefined;
const requestInit = {
  method: options.method,
  redirect: "error",
  ...(requestBody
    ? {
        headers: { "content-type": "application/json" },
        body: requestBody,
      }
    : {}),
};

const configuredPrivateKey = process.env.X402_BASE_PRIVATE_KEY;
delete process.env.X402_BASE_PRIVATE_KEY;

const quote = await fetch(url, requestInit);
if (quote.status !== 402) {
  fail(`expected an unpaid 402 quote, received ${quote.status}`);
}
const paymentRequired = quote.headers.get("payment-required");
if (!paymentRequired) fail("the 402 response has no PAYMENT-REQUIRED header");

const decoded = decodeRequired(paymentRequired);
if (decoded.x402Version !== 2) fail("the endpoint did not return x402 v2");
const requirement = decoded.accepts?.find(
  (candidate) => candidate.network === BASE_NETWORK && candidate.scheme === "exact",
);
if (!requirement) fail("the endpoint did not offer exact USDC payment on Base");
if (
  !String(requirement.amount).match(/^[1-9]\d*$/) ||
  !String(requirement.payTo).match(/^0x[0-9a-fA-F]{40}$/) ||
  !String(requirement.asset).match(/^0x[0-9a-fA-F]{40}$/)
) {
  fail("the Base offer contains an invalid amount, recipient, or asset");
}

const maximum = atomicUsdc(options.max);
if (maximum === 0n) fail("--max must be greater than zero");
const amount = BigInt(requirement.amount);
if (amount > maximum) {
  fail(
    `the Base quote is ${requirement.amount} atomic USDC, above the ${options.max} USDC ceiling`,
  );
}

console.log("\nIN THREE / BASE PAYMENT");
console.log(`  resource   ${options.method} ${url.href}`);
console.log(`  network    ${requirement.network}`);
console.log(`  asset      ${requirement.asset}`);
console.log(`  pay to     ${requirement.payTo}`);
console.log(`  amount     ${requirement.amount} atomic USDC`);
console.log(`  ceiling    ${options.max} USDC`);
console.log("  wallet     dedicated Base buyer; never use a custody key");

if (options.quoteOnly) process.exit(0);

if (!options.yes) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const confirmation = await terminal.question("\nType PAY BASE to continue: ");
  terminal.close();
  if (confirmation !== "PAY BASE") fail("payment cancelled");
}

const privateKey =
  configuredPrivateKey ??
  (await readHidden("Dedicated Base buyer private key (never custody): "));
if (!privateKey.match(/^0x[0-9a-fA-F]{64}$/)) {
  fail("the Base buyer key must be a 32-byte 0x-prefixed private key");
}

const account = privateKeyToAccount(privateKey);
const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [
    {
      network: BASE_NETWORK,
      client: new ExactEvmScheme(account),
    },
  ],
  spendControls: {
    maxAmountPerPayment: `$${options.max}`,
  },
  policies: [
    (_version, requirements) =>
      requirements.filter(
        (candidate) =>
          candidate.network === BASE_NETWORK &&
          candidate.payTo.toLowerCase() === requirement.payTo.toLowerCase() &&
          candidate.asset.toLowerCase() === requirement.asset.toLowerCase(),
      ),
  ],
  paymentRequirementsSelector: (_version, requirements) => {
    const selected = requirements.find(
      (candidate) => candidate.network === BASE_NETWORK,
    );
    if (!selected) throw new Error("The approved Base offer changed");
    return selected;
  },
});

const response = await paidFetch(url, requestInit);
const body = await response.text();
if (options.output) await writeFile(options.output, body, { mode: 0o600 });
if (!response.ok) {
  if (!options.output) console.error(body);
  fail(`paid request returned ${response.status}; inspect the receipt before retrying`);
}

const paymentResponse = response.headers.get("payment-response");
if (!paymentResponse) {
  fail("the successful response omitted PAYMENT-RESPONSE; inspect the Base wallet before retrying");
}
if (options.receiptOutput) {
  await writeFile(options.receiptOutput, `${paymentResponse}\n`, { mode: 0o600 });
}

console.log("\nPayment confirmed");
console.log(JSON.stringify(decodePaymentResponseHeader(paymentResponse), null, 2));
if (!options.output) console.log(body);

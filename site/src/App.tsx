import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Bot,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Clock3,
  Cloud,
  Container,
  Download,
  ExternalLink,
  FileCheck2,
  Github,
  KeyRound,
  Menu,
  Network,
  Package,
  Server,
  ShieldCheck,
  Terminal,
  UserRound,
  X,
} from "lucide-react";
import { useState } from "react";

const REPO = "https://github.com/P-U-C/farcaster-in-three";
const DOCS = `${REPO}/blob/main`;
const NPM_PACKAGE = "https://www.npmjs.com/package/farcaster-in-three";
const CONTAINER_PACKAGE = "https://github.com/orgs/P-U-C/packages/container/package/farcaster-in-three";
const RELEASE = `${REPO}/releases/tag/v0.1.4`;

const commands = [
  { number: "0", label: "COMPUTE", command: "./in-three-container provision" },
  { number: "1", label: "SNAPCHAIN", command: "./in-three-container node up" },
  { number: "2", label: "CLIENT", command: "./in-three-container client create" },
];

const navigation = [
  { id: "quickstart", label: "Start" },
  { id: "first-cast", label: "First cast" },
  { id: "learn", label: "Understand" },
  { id: "help", label: "Help" },
];

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="In Three home">
          <span>III</span>
          <strong>IN THREE</strong>
        </a>
        <nav aria-label="Main navigation">
          {navigation.map((item) => <a key={item.id} href={`#${item.id}`}>{item.label}</a>)}
        </nav>
        <a className="github-link" href={REPO} target="_blank" rel="noreferrer">
          <Github size={17} />
          <span>Source</span>
        </a>
        <button className="menu-button" type="button" title="Open menu" onClick={() => setMenuOpen(true)}>
          <Menu size={21} />
        </button>
      </header>

      <nav className="package-bar" aria-label="Packages and release links">
        <span className="package-bar-label">INSTALL <b>v0.1.4</b></span>
        <div className="package-links">
          <PackageLink icon={<Package size={14} />} label="npm" detail="farcaster-in-three" href={NPM_PACKAGE} />
          <PackageLink icon={<Container size={14} />} label="Docker" detail="amd64 + arm64" href={CONTAINER_PACKAGE} />
          <PackageLink icon={<Download size={14} />} label="Release" detail="checksummed" href={RELEASE} />
          <PackageLink icon={<Github size={14} />} label="Source" detail="MIT" href={REPO} />
        </div>
      </nav>

      {menuOpen && (
        <div className="mobile-menu">
          <header>
            <span>Navigate</span>
            <button type="button" title="Close menu" onClick={() => setMenuOpen(false)}><X size={20} /></button>
          </header>
          {navigation.map((item) => (
            <a key={item.id} href={`#${item.id}`} onClick={() => setMenuOpen(false)}>
              {item.label}<ChevronRight size={17} />
            </a>
          ))}
          <a href={REPO} target="_blank" rel="noreferrer">GitHub<ExternalLink size={16} /></a>
        </div>
      )}

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="release-line">
              <span>OPEN-SOURCE FARCASTER STARTER</span>
              <i />
              <span>v0.1.4</span>
            </div>
            <h1>Farcaster,<br /><em>in three.</em></h1>
            <p>Provision a server, start a Snapchain node, and open your own browser client. Reads and writes go through infrastructure you operate.</p>
            <div className="hero-actions">
              <a className="primary-link" href="#quickstart">Start here <ArrowDown size={17} /></a>
              <a className="text-link" href={REPO} target="_blank" rel="noreferrer">Inspect the code <ArrowRight size={16} /></a>
            </div>
          </div>

          <div className="command-console" aria-label="Three command overview">
            <header>
              <span className="console-lights"><i /><i /><i /></span>
              <span>~/in-three-node</span>
              <b>MAINNET</b>
            </header>
            {commands.map((item) => <Command key={item.number} {...item} />)}
            <footer>
              <span><i /> YOUR NODE</span>
              <span>YOUR CLIENT</span>
              <span>MIT LICENSED</span>
            </footer>
          </div>
        </section>

        <section className="proof-strip" aria-label="Project summary">
          <div><Terminal size={19} /><strong>3</strong><span>commands after install</span></div>
          <div><Network size={19} /><strong>0</strong><span>hosted Farcaster APIs</span></div>
          <div><KeyRound size={19} /><strong>0</strong><span>OP transactions</span></div>
          <div><ShieldCheck size={19} /><strong>MIT</strong><span>open source</span></div>
        </section>

        <section className="quickstart section" id="quickstart">
          <SectionLabel number="00" text="START HERE" />
          <div className="section-heading">
            <h2>Before you run<br />anything.</h2>
            <p>This starts real cloud infrastructure and costs about $265 per month. Use a disposable Farcaster test account, not an account holding value.</p>
          </div>

          <div className="prereq-grid">
            <Prerequisite icon={<Box size={22} />} title="Docker" detail="Running on macOS or Linux." />
            <Prerequisite icon={<Cloud size={22} />} title="Hetzner token" detail="Create it in a new, empty project." />
            <Prerequisite icon={<UserRound size={22} />} title="Test account" detail="It needs an FID and active storage." />
            <Prerequisite icon={<Clock3 size={22} />} title="Several hours" detail="The first Snapchain sync is large." />
          </div>

          <Callout tone="orange" icon={<KeyRound size={21} />} title="A recovery phrase controls the account">
            Use a test account only. Enter its phrase only after inspecting code you trust. Never paste it into chat. Production clients should use wallet-based delegated authorization.
          </Callout>

          <div className="install-block">
            <span>INSTALL THE CONTAINER LAUNCHER</span>
            <CodeBlock code={"mkdir in-three-node && cd in-three-node\ncurl -fsSLO https://raw.githubusercontent.com/P-U-C/farcaster-in-three/v0.1.4/in-three-container\nchmod +x in-three-container\n./in-three-container doctor"} />
            <p><b>Expected result:</b> <code>All checks passed.</code> Keep using this directory; it holds the local state needed to resume safely.</p>
          </div>

          <div className="manual-label"><span>NOW RUN THESE THREE COMMANDS</span><i /></div>

          <div className="three-steps">
            {commands.map((item, index) => (
              <article key={item.number}>
                <header><b>{item.number}</b><span>{item.label}</span></header>
                <h3>{["Create the server", "Start the node", "Create the client"][index]}</h3>
                <CodeBlock code={item.command} />
                <p>{[
                  "Shows the exact Hetzner plan and waits for you to type PROVISION before billing starts.",
                  "Starts Snapchain, prints its status, and leaves the initial sync running on the server.",
                  "Waits for the node, creates a gasless app key, deploys the browser client, and prints its URL.",
                ][index]}</p>
              </article>
            ))}
          </div>

          <Callout tone="green" icon={<CheckCircle2 size={22} />} title="It is safe to stop and resume">
            If the node is still syncing, command 2 prints progress and keeps waiting. Press Ctrl-C when needed and rerun the same command from this directory.
          </Callout>

          <div className="alternate-install">
            <strong>Prefer npm?</strong>
            <p>Run <code>npm install -g farcaster-in-three</code>, then replace <code>./in-three-container</code> with <code>in-three</code>. Use the container launcher unless you specifically want a host-installed CLI.</p>
          </div>
        </section>

        <section className="architecture section-band" id="system">
          <div className="section narrow">
            <SectionLabel number="01" text="WHAT IT BUILDS" light />
            <div className="section-heading light">
              <h2>One server.<br />Two clear paths.</h2>
              <p>Your browser reads from your Snapchain node. Signed actions go back to that same node, which validates and relays them to validators.</p>
            </div>
            <div className="simple-system">
              <SystemPart label="YOU" icon={<Terminal size={28} />} title="Browser" detail="feed and actions" />
              <ArrowRight />
              <SystemPart label="YOUR SERVER" icon={<Cloud size={28} />} title="Client service" detail="login and signing" />
              <ArrowRight />
              <SystemPart label="YOUR SERVER" icon={<Server size={28} />} title="Snapchain" detail="read, validate, relay" />
              <ArrowRight />
              <SystemPart label="NETWORK" icon={<Network size={28} />} title="Validators" detail="include messages" />
            </div>
            <p className="architecture-note"><b>In plain English:</b> no third-party Farcaster API serves the feed or accepts the cast. The node you operate handles both.</p>
          </div>
        </section>

        <section className="first-run section" id="first-cast">
          <SectionLabel number="02" text="YOUR FIRST CAST" />
          <div className="section-heading">
            <h2>The final command<br />prints your URL.</h2>
            <p>Open it on desktop or mobile. The client supports feeds, casts, follows, likes, recasts, and source filters.</p>
          </div>
          <div className="first-run-grid">
            <ol className="first-run-steps">
              <li><span>1</span><p>Open the HTTPS URL and enter the password you created.</p></li>
              <li><span>2</span><p>Select <b>New cast</b>, write a test message, and publish it.</p></li>
              <li><span>3</span><p>Refresh until your node returns the cast.</p></li>
              <li><span>4</span><p>Open another Farcaster client and confirm the same cast appears there.</p></li>
            </ol>
            <figure className="client-frame compact-preview">
              <div className="browser-bar"><i /><i /><i /><span>your-node.sslip.io</span></div>
              <img src="./client-preview.webp" alt="Illustrative In Three client preview using synthetic profiles and casts" />
              <figcaption>Illustrative preview. All shown accounts and casts are synthetic.</figcaption>
            </figure>
          </div>
        </section>

        <section className="protocol section" id="learn">
          <SectionLabel number="03" text="SIX USEFUL TERMS" />
          <div className="section-heading">
            <h2>Enough protocol<br />to read the output.</h2>
            <p>You do not need to memorize Farcaster before starting. These are the terms used by the setup and recovery messages.</p>
          </div>
          <div className="concepts">
            <Concept index="01" title="FID" accent="purple">Your numeric Farcaster account ID.</Concept>
            <Concept index="02" title="Custody address" accent="orange">The wallet that owns the FID. It stays off the server.</Concept>
            <Concept index="03" title="App key" accent="cyan">A revocable key for casts, follows, and reactions. Creating it is gasless.</Concept>
            <Concept index="04" title="Message" accent="green">A signed instruction such as publishing a cast or following an FID.</Concept>
            <Concept index="05" title="Read node" accent="purple">Your copy of Farcaster data. It also validates and relays writes.</Concept>
            <Concept index="06" title="Storage" accent="orange">Account capacity for casts, follows, and reactions.</Concept>
          </div>
        </section>

        <section className="agent-summary section-band">
          <div className="section narrow">
            <SectionLabel number="04" text="OPTIONAL: AGENT ACCESS" light />
            <div className="agent-summary-grid">
              <div>
                <h2>Keep the first run simple.</h2>
                <p>The normal command creates only the browser client. To add paid x402 access for agents, use <code>client create --with-agent</code> during initial setup and follow the separate agent guide.</p>
              </div>
              <div className="agent-summary-facts">
                <AgentFact icon={<Bot size={22} />} title="Discover" detail="/.well-known/agent.json" />
                <AgentFact icon={<Network size={22} />} title="Pay" detail="USDC on Celo or Base" />
                <AgentFact icon={<ShieldCheck size={22} />} title="Write" detail="payment plus owner capability" />
              </div>
            </div>
            <div className="agent-links">
              <a href={`${DOCS}/docs/AGENT-API.md`} target="_blank" rel="noreferrer">Read the optional agent guide <ArrowRight size={15} /></a>
            </div>
          </div>
        </section>

        <section className="faq section" id="help">
          <SectionLabel number="05" text="HELP AND REFERENCE" />
          <div className="section-heading">
            <h2>Go deeper only<br />when you need to.</h2>
            <p>The quickstart is enough for a clean first run. These references cover recovery, security, architecture, and advanced operation.</p>
          </div>
          <div className="docs-grid">
            <DocLink icon={<BookOpen size={22} />} title="Operations" detail="Expected output, sync status, recovery, upgrades, and teardown." href={`${DOCS}/docs/OPERATIONS.md`} />
            <DocLink icon={<Network size={22} />} title="Architecture" detail="What runs where and how reads and writes move." href={`${DOCS}/docs/ARCHITECTURE.md`} />
            <DocLink icon={<ShieldCheck size={22} />} title="Security" detail="Phrase handling, app keys, secrets, and incident response." href={`${DOCS}/SECURITY.md`} />
            <DocLink icon={<Bot size={22} />} title="Agent API" detail="Optional x402 setup, routes, prices, and payment safety." href={`${DOCS}/docs/AGENT-API.md`} />
            <DocLink icon={<FileCheck2 size={22} />} title="Primary sources" detail="Pinned Snapchain and Farcaster protocol references." href={`${DOCS}/docs/SOURCES.md`} />
            <DocLink icon={<Github size={22} />} title="Source code" detail="MIT-licensed scripts, client, tests, and release files." href={REPO} />
          </div>

          <div className="faq-grid compact">
            <h2>Common<br />questions.</h2>
            <div>
              <Details question="What will this cost?">The default Hetzner server and 2 TiB volume are about $265 per month before tax, traffic, IPv4, or provider price changes. The script shows the plan before creating it.</Details>
              <Details question="Can the app key move funds?">No. It can sign Farcaster casts, follows, and reactions. It cannot transfer custody or sign wallet transactions.</Details>
              <Details question="What does a successful write mean?">Your node accepted the message for relay. Read it back from the synced node to confirm inclusion.</Details>
              <Details question="How do I stop the bill?">Run <code>./in-three-container destroy</code>, then confirm the server and volume are gone in Hetzner.</Details>
            </div>
          </div>
        </section>

        <section className="final-cta">
          <span className="eyebrow">READ THE COST. USE A TEST ACCOUNT. KEEP THE WORKING DIRECTORY.</span>
          <h2>Then run<br />the three.</h2>
          <div>
            <a href="#quickstart">Open the quickstart <Terminal size={18} /></a>
            <a href={REPO} target="_blank" rel="noreferrer">Inspect the source <Github size={18} /></a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div><span className="wordmark compact"><i>III</i><strong>IN THREE</strong></span><p>Built in public by Permanent Upper Class.</p></div>
        <div><span>LICENSE</span><strong>MIT</strong></div>
        <div><span>SNAPCHAIN</span><strong>v0.14.3</strong></div>
        <div><span>RELEASE</span><strong>v0.1.4</strong></div>
      </footer>
    </>
  );
}

function Command({ number, label, command }: { number: string; label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="console-command">
      <span className="command-number">{number}</span>
      <div><small>{label}</small><code><i>$</i> {command}</code></div>
      <button type="button" title={`Copy ${label.toLowerCase()} command`} onClick={async () => {
        await navigator.clipboard.writeText(command);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}>{copied ? <Check size={16} /> : <Clipboard size={16} />}</button>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block">
      <code><i>$</i> {code}</code>
      <button type="button" title="Copy command" onClick={async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}>{copied ? <Check size={16} /> : <Clipboard size={16} />}</button>
    </div>
  );
}

function SectionLabel({ number, text, light = false }: { number: string; text: string; light?: boolean }) {
  return <div className={light ? "section-label light" : "section-label"}><span>{number}</span><i /><b>{text}</b></div>;
}

function Callout({ tone, icon, title, children }: { tone: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <div className={`callout ${tone}`}>{icon}<div><strong>{title}</strong><p>{children}</p></div></div>;
}

function Prerequisite({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="prerequisite">{icon}<strong>{title}</strong><span>{detail}</span></div>;
}

function SystemPart({ label, icon, title, detail }: { label: string; icon: React.ReactNode; title: string; detail: string }) {
  return <div><span>{label}</span>{icon}<strong>{title}</strong><small>{detail}</small></div>;
}

function AgentFact({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div>{icon}<span><b>{title}</b><small>{detail}</small></span></div>;
}

function Concept({ index, title, accent, children }: { index: string; title: string; accent: string; children: React.ReactNode }) {
  return <article className={`concept ${accent}`}><span>{index}</span><h3>{title}</h3><p>{children}</p></article>;
}

function PackageLink({ icon, label, detail, href }: { icon: React.ReactNode; label: string; detail: string; href: string }) {
  return <a className="package-pill" href={href} target="_blank" rel="noreferrer">{icon}<b>{label}</b><small>{detail}</small><ExternalLink size={12} /></a>;
}

function DocLink({ icon, title, detail, href }: { icon: React.ReactNode; title: string; detail: string; href: string }) {
  return <a className="doc-link" href={href} target="_blank" rel="noreferrer">{icon}<span><strong>{title}</strong><small>{detail}</small></span><ExternalLink size={15} /></a>;
}

function Details({ question, children }: { question: string; children: React.ReactNode }) {
  return <details><summary>{question}<span>+</span></summary><p>{children}</p></details>;
}

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
  ExternalLink,
  FileCheck2,
  Github,
  KeyRound,
  Menu,
  Network,
  Server,
  ShieldCheck,
  Terminal,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const DEADLINE = new Date("2026-10-24T14:47:30Z");
const REPO = "https://github.com/P-U-C/farcaster-in-three";
const DOCS = `${REPO}/blob/main`;

const commands = [
  { number: "0", label: "COMPUTE", command: "./in-three-container provision" },
  { number: "1", label: "SNAPCHAIN", command: "./in-three-container node up" },
  { number: "2", label: "CLIENT", command: "./in-three-container client create" },
];

const navigation = [
  { id: "quickstart", label: "Start" },
  { id: "system", label: "What it builds" },
  { id: "learn", label: "Learn" },
  { id: "verify", label: "Verify" },
];

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const remaining = useCountdown(DEADLINE);

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
            <div className="prize-line">
              <span>OPEN-SOURCE FARCASTER STARTER</span>
              <i />
              <span>{remaining}</span>
            </div>
            <h1>Farcaster,<br /><em>in three.</em></h1>
            <p>Run your own Farcaster node and client in three commands. No hosted Farcaster API key, no source build, and no Optimism transaction for the app key.</p>
            <div className="hero-actions">
              <a className="primary-link" href="#quickstart">See the three commands <ArrowDown size={17} /></a>
              <a className="text-link" href={REPO} target="_blank" rel="noreferrer">Read the source <ArrowRight size={16} /></a>
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
          <div><Terminal size={19} /><strong>3</strong><span>commands</span></div>
          <div><Network size={19} /><strong>0</strong><span>Farcaster API keys</span></div>
          <div><KeyRound size={19} /><strong>0</strong><span>OP transactions</span></div>
          <div><ShieldCheck size={19} /><strong>MIT</strong><span>open source</span></div>
        </section>

        <section className="quickstart section" id="quickstart">
          <SectionLabel number="00" text="START HERE" />
          <div className="section-heading">
            <h2>Know this before<br />you start.</h2>
            <p>This is a developer setup for a real network node. The scripts remove busywork; they do not turn the infrastructure into a free phone app.</p>
          </div>

          <div className="prereq-grid">
            <Prerequisite icon={<Box size={22} />} title="Docker" detail="Installed on macOS or Linux." />
            <Prerequisite icon={<Cloud size={22} />} title="Hetzner token" detail="From a new, empty cloud project." />
            <Prerequisite icon={<UserRound size={22} />} title="Test account" detail="An FID with storage. Never use a valuable account." />
            <Prerequisite icon={<Clock3 size={22} />} title="Time and cost" detail="About $265/month. First sync commonly takes hours." />
          </div>

          <Callout tone="orange" icon={<KeyRound size={21} />} title="Use a disposable Farcaster test account">
            A recovery phrase controls the account. Enter one only into code you have inspected and trust, never through chat, and never for an account holding value. Production clients should use delegated wallet authorization.
          </Callout>

          <div className="install-block">
            <span>GET THE CONTAINER LAUNCHER</span>
            <CodeBlock code={"mkdir in-three-node && cd in-three-node\ncurl -fsSLO https://raw.githubusercontent.com/P-U-C/farcaster-in-three/v0.1.2/in-three-container\nchmod +x in-three-container\n./in-three-container doctor"} />
            <p>The launcher downloads a checksummed, prebuilt operator image. It does not mount the Docker socket and keeps state in this directory.</p>
          </div>

          <div className="manual-label"><span>THEN RUN EXACTLY THESE</span><i /></div>

          <div className="three-steps">
            {commands.map((item, index) => (
              <article key={item.number}>
                <header><b>{item.number}</b><span>{item.label}</span></header>
                <h3>{["Create the server", "Start the node", "Open the client"][index]}</h3>
                <CodeBlock code={item.command} />
                <p>{[
                  "Shows the billable plan, asks for confirmation, then creates your cloud server and storage.",
                  "Starts Snapchain and returns while its large first snapshot continues downloading.",
                  "Waits for the node, creates a gasless app key, and prints your private HTTPS client URL.",
                ][index]}</p>
              </article>
            ))}
          </div>

          <Callout tone="green" icon={<CheckCircle2 size={22} />} title="You do not have to babysit the sync">
            Command 1 leaves the node running. Command 2 waits, prints progress every five minutes, and continues automatically when Snapchain is ready.
          </Callout>

          <div className="install-choices">
            <div>
              <b>RECOMMENDED</b>
              <strong>Container launcher</strong>
              <p>Small host surface, prebuilt application, amd64 and arm64 support.</p>
            </div>
            <div>
              <b>PREBUILT CLI</b>
              <strong>npm tarball</strong>
              <p>Install the compiled CLI directly from the signed GitHub release.</p>
              <a href="https://github.com/P-U-C/farcaster-in-three/releases/tag/v0.1.2" target="_blank" rel="noreferrer">Open release <ExternalLink size={14} /></a>
            </div>
            <div>
              <b>REVIEW</b>
              <strong>Source checkout</strong>
              <p>Best when you want to inspect, modify, or contribute to the implementation.</p>
              <a href={REPO} target="_blank" rel="noreferrer">Open repository <ExternalLink size={14} /></a>
            </div>
          </div>
        </section>

        <section className="architecture section-band" id="system">
          <div className="section narrow">
            <SectionLabel number="01" text="WHAT IT BUILDS" light />
            <div className="section-heading light">
              <h2>Your client talks<br />to your node.</h2>
              <p>Reads and signed writes both go to your Snapchain read node. The node validates writes and relays them to validators over the Farcaster network.</p>
            </div>
            <div className="simple-system">
              <SystemPart label="YOU" icon={<Terminal size={28} />} title="Browser client" detail="feed, casts, follows, reactions" />
              <ArrowRight />
              <SystemPart label="YOUR SERVER" icon={<Cloud size={28} />} title="Client service" detail="login and message signing" />
              <ArrowRight />
              <SystemPart label="YOUR SERVER" icon={<Server size={28} />} title="Snapchain node" detail="read, validate, and relay" />
              <ArrowRight />
              <SystemPart label="NETWORK" icon={<Network size={28} />} title="Validators" detail="order and include messages" />
            </div>
            <p className="architecture-note"><b>Plain English:</b> the app does not rent its feed from a data provider. It reads protocol state from the node you pay for and operate.</p>
          </div>
        </section>

        <section className="first-run section">
          <SectionLabel number="02" text="YOUR FIRST CAST" />
          <div className="section-heading">
            <h2>Once it says<br />client is live.</h2>
            <p>The final command prints the URL. The browser experience works on desktop and mobile.</p>
          </div>
          <div className="first-run-grid">
            <ol className="first-run-steps">
              <li><span>1</span><p>Open the printed HTTPS URL and enter the password you created.</p></li>
              <li><span>2</span><p>Select <b>New cast</b>, write a test message, and publish it.</p></li>
              <li><span>3</span><p>Refresh until your node returns the cast, then check it in another Farcaster client.</p></li>
              <li><span>4</span><p>Try a follow, a like, a recast, and the source filters.</p></li>
            </ol>
            <figure className="client-frame compact-preview">
              <div className="browser-bar"><i /><i /><i /><span>your-node.sslip.io</span></div>
              <img src="./client-preview.webp" alt="Illustrative In Three client preview using synthetic profiles and casts" />
              <figcaption>Illustrative preview. All shown accounts and casts are synthetic.</figcaption>
            </figure>
          </div>
        </section>

        <section className="agent-summary section-band">
          <div className="section narrow">
            <SectionLabel number="03" text="FOR AGENTS" light />
            <div className="agent-summary-grid">
              <div>
                <h2>Agents use the same node.</h2>
                <p>The deployment publishes a machine-readable API. Reads are paid with USDC over x402 on Celo or Base. Writes also require a private capability from the owner.</p>
              </div>
              <div className="agent-summary-facts">
                <AgentFact icon={<Bot size={22} />} title="Discover" detail="/.well-known/agent.json" />
                <AgentFact icon={<Network size={22} />} title="Pay" detail="Celo or Base, no bridge required" />
                <AgentFact icon={<ShieldCheck size={22} />} title="Write" detail="payment plus owner capability" />
              </div>
            </div>
            <div className="agent-links">
              <a href="https://usebuy.ai/docs" target="_blank" rel="noreferrer">usebuy.ai documentation <ExternalLink size={15} /></a>
              <a href={`${DOCS}/docs/AGENT-API.md`} target="_blank" rel="noreferrer">Agent API and pricing <ArrowRight size={15} /></a>
            </div>
          </div>
        </section>

        <section className="protocol section" id="learn">
          <SectionLabel number="04" text="SIX PLAIN-ENGLISH TERMS" />
          <div className="section-heading">
            <h2>Enough protocol<br />to stay oriented.</h2>
            <p>You can start without memorizing Farcaster. These are the words the setup and error messages use.</p>
          </div>
          <div className="concepts">
            <Concept index="01" title="FID" accent="purple">Your numeric Farcaster account ID.</Concept>
            <Concept index="02" title="Custody address" accent="orange">The wallet that owns the FID. Keep it off the server.</Concept>
            <Concept index="03" title="App key" accent="cyan">A revocable key that can cast, follow, and react. Creating it is gasless.</Concept>
            <Concept index="04" title="Message" accent="green">A signed instruction such as "publish this cast" or "follow this FID."</Concept>
            <Concept index="05" title="Read node" accent="purple">Your copy of Farcaster data. It also validates and relays your writes.</Concept>
            <Concept index="06" title="Storage" accent="orange">The account capacity required to store casts, follows, and reactions.</Concept>
          </div>

          <div className="docs-grid">
            <DocLink icon={<BookOpen size={22} />} title="Operations" detail="Costs, expected output, recovery, updates, and teardown." href={`${DOCS}/docs/OPERATIONS.md`} />
            <DocLink icon={<Network size={22} />} title="Architecture" detail="Trust boundaries and separate read and write paths." href={`${DOCS}/docs/ARCHITECTURE.md`} />
            <DocLink icon={<ShieldCheck size={22} />} title="Security" detail="Phrase handling, app keys, containers, and threat model." href={`${DOCS}/SECURITY.md`} />
            <DocLink icon={<Bot size={22} />} title="Agent API" detail="x402 discovery, prices, chains, capabilities, and examples." href={`${DOCS}/docs/AGENT-API.md`} />
            <DocLink icon={<FileCheck2 size={22} />} title="Primary sources" detail="The exact Farcaster and Snapchain references used here." href={`${DOCS}/docs/SOURCES.md`} />
            <DocLink icon={<Github size={22} />} title="All source code" detail="MIT-licensed scripts, client, tests, and release files." href={REPO} />
          </div>
        </section>

        <section className="verification section-band light-band" id="verify">
          <div className="section narrow">
            <SectionLabel number="05" text="HUMAN PROOF" />
            <div className="verify-layout">
              <div>
                <h2>One clean run<br /><em>still matters.</em></h2>
                <p>The code and browser tests pass. Prize qualification still requires an independent person to run the full paid infrastructure path and vouch publicly on Farcaster.</p>
              </div>
              <div className="voucher-list">
                <Voucher number="1" text="Start on a clean macOS or Linux machine." />
                <Voucher number="2" text="Run the three commands and let Snapchain fully sync." />
                <Voucher number="3" text="Cast, follow, react, and verify the data comes from the owned node." />
                <Voucher number="4" text="Publish an honest Farcaster report with the resulting cast." />
              </div>
            </div>
            <div className="bounty-board" aria-labelledby="bounty-title">
              <header>
                <span>2 RESERVED SLOTS · 400 USDC TOTAL</span>
                <h3 id="bounty-title">One human. One agent. Real evidence.</h3>
                <p>Each track pays 200 USDC. Claim before spending; reproducible failures are valid results.</p>
              </header>
              <div className="bounty-tracks">
                <div><UserRound size={23} /><span>HUMAN</span><strong>200 <small>USDC</small></strong><p>Complete the clean-machine node and client run.</p></div>
                <div><Bot size={23} /><span>AGENT</span><strong>200 <small>USDC</small></strong><p>Exercise discovery, x402 reads, and an authorized write.</p></div>
              </div>
              <footer>
                <span>Evidence due 2026-10-23 · 14:47 UTC</span>
                <a href={`${DOCS}/TESTER-BOUNTY.md`} target="_blank" rel="noreferrer">Rules and claim process <ArrowRight size={16} /></a>
              </footer>
            </div>
          </div>
        </section>

        <section className="faq section">
          <SectionLabel number="06" text="QUICK ANSWERS" />
          <div className="faq-grid">
            <h2>Before you<br />spend money.</h2>
            <div>
              <Details question="Does Snapchain need an API key?">No. The Hetzner token creates your server; Snapchain syncs the public network without a hosted Farcaster data key.</Details>
              <Details question="What will this cost?">The default Hetzner server and 2 TiB volume are about $265 per month before IPv4, traffic, tax, or provider price changes. The script shows the plan before creating it.</Details>
              <Details question="Can the app key move wallet funds?">No. It signs Farcaster casts, follows, and reactions. It cannot transfer custody or sign wallet transactions.</Details>
              <Details question="How do I stop the bill?">Run <code>./in-three-container destroy</code>, confirm the named resources are gone, and verify the project in the Hetzner console.</Details>
            </div>
          </div>
        </section>

        <section className="final-cta">
          <span className="eyebrow">READ THE COST. USE A TEST ACCOUNT. THEN RUN IT.</span>
          <h2>Three commands.<br />Your node.</h2>
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
        <div><span>DEADLINE</span><strong>24 OCT 2026 · 14:47 UTC</strong></div>
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

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block">
      {label && <span>{label}</span>}
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

function DocLink({ icon, title, detail, href }: { icon: React.ReactNode; title: string; detail: string; href: string }) {
  return <a className="doc-link" href={href} target="_blank" rel="noreferrer">{icon}<span><strong>{title}</strong><small>{detail}</small></span><ExternalLink size={15} /></a>;
}

function Voucher({ number, text }: { number: string; text: string }) {
  return <div><span>{number}</span><p>{text}</p></div>;
}

function Details({ question, children }: { question: string; children: React.ReactNode }) {
  return <details><summary>{question}<span>+</span></summary><p>{children}</p></details>;
}

function useCountdown(deadline: Date) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  return useMemo(() => {
    const seconds = Math.max(0, Math.floor((deadline.getTime() - now) / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (seconds === 0) return "SUBMISSION WINDOW CLOSED";
    return `${days}D ${String(hours).padStart(2, "0")}H ${String(minutes).padStart(2, "0")}M TO DEADLINE`;
  }, [deadline, now]);
}

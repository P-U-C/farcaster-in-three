import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Clock3,
  Cloud,
  Container,
  Download,
  ExternalLink,
  Github,
  KeyRound,
  Menu,
  Package,
  Server,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { useState } from "react";

const REPO = "https://github.com/P-U-C/farcaster-in-three";
const DOCS = `${REPO}/blob/main`;
const NPM_PACKAGE = "https://www.npmjs.com/package/farcaster-in-three";
const CONTAINER_PACKAGE = "https://github.com/orgs/P-U-C/packages/container/package/farcaster-in-three";
const RELEASE = `${REPO}/releases/tag/v0.1.14`;

type InstallMethod = "npm" | "container";

const setupCommands: Record<InstallMethod, Array<{ number: string; label: string; command: string; detail: string }>> = {
  npm: [
    { number: "0", label: "COMPUTE", command: "in-three provision", detail: "Review the price, then create the server." },
    { number: "1", label: "SNAPCHAIN", command: "in-three node up", detail: "Start the node. The first sync takes hours." },
    { number: "2", label: "CLIENT", command: "in-three client create", detail: "Create an account and open your client." },
  ],
  container: [
    { number: "0", label: "COMPUTE", command: "./in-three-container provision", detail: "Review the price, then create the server." },
    { number: "1", label: "SNAPCHAIN", command: "./in-three-container node up", detail: "Start the node. The first sync takes hours." },
    { number: "2", label: "CLIENT", command: "./in-three-container client create", detail: "Create an account and open your client." },
  ],
};

const installCommands: Record<InstallMethod, string> = {
  npm: "npm install --global farcaster-in-three\nmkdir in-three-node && cd in-three-node\nin-three doctor",
  container: "mkdir in-three-node && cd in-three-node\ncurl -fsSLO https://raw.githubusercontent.com/P-U-C/farcaster-in-three/v0.1.14/in-three-container\nchmod +x in-three-container\n./in-three-container doctor",
};

const navigation = [
  { id: "start", label: "Start" },
  { id: "after", label: "After setup" },
  { id: "help", label: "Help" },
];

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [installMethod, setInstallMethod] = useState<InstallMethod>("npm");
  const commands = setupCommands[installMethod];
  const prefix = installMethod === "npm" ? "in-three" : "./in-three-container";

  return (
    <>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="In Three home">
          <img src="./profile.svg" alt="" width="36" height="36" />
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
        <span className="package-bar-label">GET <b>v0.1.14</b></span>
        <div className="package-links">
          <PackageLink icon={<Package size={14} />} label="npm" detail="recommended" href={NPM_PACKAGE} />
          <PackageLink icon={<Container size={14} />} label="Docker" detail="amd64 + arm64" href={CONTAINER_PACKAGE} />
          <PackageLink icon={<Download size={14} />} label="Release" detail="checksummed" href={RELEASE} />
          <PackageLink icon={<Github size={14} />} label="Source" detail="MIT" href={REPO} />
        </div>
      </nav>

      {menuOpen && (
        <div className="mobile-menu">
          <header>
            <span>IN THREE</span>
            <button type="button" title="Close menu" onClick={() => setMenuOpen(false)}><X size={20} /></button>
          </header>
          {navigation.map((item) => (
            <a key={item.id} href={`#${item.id}`} onClick={() => setMenuOpen(false)}>
              {item.label}<ChevronRight size={18} />
            </a>
          ))}
          <a href={REPO} target="_blank" rel="noreferrer">Source<ExternalLink size={16} /></a>
        </div>
      )}

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="release-line">
              <img src="./profile.svg" alt="" width="54" height="54" />
              <span>FARCASTER ON YOUR OWN NODE</span>
            </div>
            <h1>Farcaster,<br /><em>in three.</em></h1>
            <p>One server. One Snapchain node. One private browser client. Set it up in three commands.</p>
            <div className="hero-actions">
              <a className="primary-link" href="#start">Run the three <ArrowDown size={17} /></a>
              <a className="text-link" href={REPO} target="_blank" rel="noreferrer">View source <ArrowRight size={16} /></a>
            </div>
          </div>

          <div className="command-console" aria-label="The three setup commands">
            <header>
              <span>~/in-three-node</span>
              <b>3 COMMANDS</b>
            </header>
            {commands.map((item) => <Command key={item.number} {...item} />)}
            <footer>
              <span><i /> YOUR NODE</span>
              <span>YOUR CLIENT</span>
            </footer>
          </div>
        </section>

        <section className="plain-facts" aria-label="Before you begin">
          <div><CheckCircle2 size={18} /><span><b>No account needed</b><small>Command 3 can create a test account.</small></span></div>
          <div><Clock3 size={18} /><span><b>Allow several hours</b><small>Snapchain downloads its first snapshot.</small></span></div>
          <div><Cloud size={18} /><span><b>About $324/month</b><small>You approve the live Hetzner price first.</small></span></div>
          <div><ShieldCheck size={18} /><span><b>Use a test account</b><small>Never import a wallet holding value.</small></span></div>
        </section>

        <section className="start section" id="start">
          <div className="section-intro">
            <span>START HERE</span>
            <h2>Install once. Run three.</h2>
            <p>Use macOS or Linux. You need a new Hetzner project with 2 TiB Volume quota.</p>
          </div>

          <div className="install-method-picker">
            <span>RUN WITH</span>
            <div className="install-method-switch" aria-label="Installation method">
              <button
                className={installMethod === "npm" ? "active" : ""}
                type="button"
                aria-pressed={installMethod === "npm"}
                onClick={() => setInstallMethod("npm")}
              >
                <Package size={17} />
                <span><b>npm CLI</b><small>Node.js 22+</small></span>
              </button>
              <button
                className={installMethod === "container" ? "active" : ""}
                type="button"
                aria-pressed={installMethod === "container"}
                onClick={() => setInstallMethod("container")}
              >
                <Container size={17} />
                <span><b>Docker</b><small>isolated package</small></span>
              </button>
            </div>
          </div>

          <div className="install-block">
            <span>INSTALL AND CHECK</span>
            <CodeBlock code={installCommands[installMethod]} />
            <p>Continue when you see <code>All checks passed.</code></p>
          </div>

          <div className="three-steps">
            {commands.map((item) => (
              <article key={item.number}>
                <header><b>{item.number}</b><span>{item.label}</span></header>
                <CodeBlock code={item.command} />
                <p>{item.detail}</p>
              </article>
            ))}
          </div>

          <div className="keep-note">
            <Terminal size={20} />
            <p><b>Keep this folder.</b> If setup pauses, rerun the same command from here. In Three resumes instead of starting over.</p>
          </div>
        </section>

        <section className="guided section-band">
          <div className="section">
            <div className="section-intro light">
              <span>COMMAND 3</span>
              <h2>No Farcaster account? No extra step.</h2>
              <p>Choose <code>CREATE</code>. The final command handles the rest.</p>
            </div>

            <ol className="guided-steps">
              <li><b>1</b><span><strong>Press Enter</strong><small>CREATE is already selected.</small></span></li>
              <li><b>2</b><span><strong>Choose a password</strong><small>Your recovery kit stays encrypted on this machine.</small></span></li>
              <li><b>3</b><span><strong>Send the quoted OP ETH</strong><small>Use the address and amount shown on screen.</small></span></li>
              <li><b>4</b><span><strong>Continue</strong><small>In Three registers the account and deploys your client.</small></span></li>
            </ol>

            <div className="safety-note">
              <KeyRound size={22} />
              <div>
                <strong>Use a new test account.</strong>
                <p>The server gets a revocable app key, not your recovery phrase. The app key can post, follow, react, and edit the profile. It cannot move funds.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="after section" id="after">
          <div className="section-intro">
            <span>AFTER SETUP</span>
            <h2>Open the URL. Make a cast.</h2>
            <p>Command 3 prints the private client URL and your next action.</p>
          </div>

          <div className="after-layout">
            <ol>
              <li><b>1</b><p>Open the HTTPS URL and sign in.</p></li>
              <li><b>2</b><p>Publish a test cast.</p></li>
              <li><b>3</b><p>Read it back from your node.</p></li>
            </ol>
            <figure>
              <img src="./client-preview.webp" alt="Illustrative preview of the In Three Farcaster client" />
              <figcaption>Illustrative client preview. Shown profiles and casts are synthetic.</figcaption>
            </figure>
          </div>

          <div className="finish-strip">
            <div><Server size={20} /><span><b>Check the node</b><code>{prefix} node status</code></span></div>
            <div><Download size={20} /><span><b>Save a receipt</b><code>{prefix} proof</code></span></div>
            <div><X size={20} /><span><b>Stop the bill</b><code>{prefix} destroy</code></span></div>
          </div>
        </section>

        <section className="help section" id="help">
          <div className="section-intro">
            <span>ONLY IF YOU NEED IT</span>
            <h2>Help without the wall of text.</h2>
            <p>Start with the short answer. Open the detailed reference only when something pauses or fails.</p>
          </div>

          <div className="quick-answers">
            <Details question="The node says it is still syncing.">
              Leave it running. Check <code>{prefix} node status</code>. Do not restart during snapshot extraction.
            </Details>
            <Details question="Command 3 stopped.">
              Keep the folder and rerun <code>{prefix} client create</code>. Signed recovery data is saved before broadcast.
            </Details>
            <Details question="I want Docker instead.">
              Select Docker above. The setup and three commands stay the same.
            </Details>
            <Details question="I want agent or x402 access.">
              Finish the normal browser setup first, then use the separate advanced agent guide.
            </Details>
          </div>

          <div className="docs-list">
            <DocLink icon={<BookOpen size={20} />} title="Operations" detail="Sync, recovery, upgrades, and teardown" href={`${DOCS}/docs/OPERATIONS.md`} />
            <DocLink icon={<ShieldCheck size={20} />} title="Security" detail="Keys, recovery files, and exposure" href={`${DOCS}/SECURITY.md`} />
            <DocLink icon={<Server size={20} />} title="Architecture" detail="How reads and writes move" href={`${DOCS}/docs/ARCHITECTURE.md`} />
            <DocLink icon={<CheckCircle2 size={20} />} title="Proof" detail="Receipts and verification status" href={`${DOCS}/docs/PROOF.md`} />
            <DocLink icon={<Terminal size={20} />} title="All documentation" detail="Advanced and contributor references" href={`${DOCS}/docs/README.md`} />
          </div>
        </section>

        <section className="final-cta">
          <img src="./profile.svg" alt="" width="58" height="58" />
          <div>
            <span>READY?</span>
            <h2>Run the three.</h2>
          </div>
          <a href="#start">Start <ArrowRight size={18} /></a>
        </section>
      </main>

      <footer className="site-footer">
        <span>IN THREE</span>
        <p>Built by Permanent Upper Class.</p>
        <a href={REPO} target="_blank" rel="noreferrer">MIT source <ExternalLink size={13} /></a>
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
      <code>{code}</code>
      <button type="button" title="Copy command" onClick={async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}>{copied ? <Check size={16} /> : <Clipboard size={16} />}</button>
    </div>
  );
}

function PackageLink({ icon, label, detail, href }: { icon: React.ReactNode; label: string; detail: string; href: string }) {
  return <a className="package-pill" href={href} target="_blank" rel="noreferrer">{icon}<b>{label}</b><small>{detail}</small><ExternalLink size={12} /></a>;
}

function Details({ question, children }: { question: string; children: React.ReactNode }) {
  return <details><summary>{question}<span>+</span></summary><p>{children}</p></details>;
}

function DocLink({ icon, title, detail, href }: { icon: React.ReactNode; title: string; detail: string; href: string }) {
  return <a className="doc-link" href={href} target="_blank" rel="noreferrer">{icon}<span><strong>{title}</strong><small>{detail}</small></span><ArrowRight size={16} /></a>;
}

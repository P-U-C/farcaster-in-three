import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Cloud,
  ExternalLink,
  FileCheck2,
  Filter,
  Github,
  HardDrive,
  KeyRound,
  Menu,
  Network,
  Server,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const DEADLINE = new Date("2026-10-24T14:47:30Z");
const REPO = "https://github.com/P-U-C/farcaster-in-three";

const commands = [
  { number: "0", label: "COMPUTE", command: "./farcaster provision" },
  { number: "1", label: "SNAPCHAIN", command: "./farcaster node up" },
  { number: "2", label: "CLIENT", command: "./farcaster client create" },
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
          <a href="#quickstart">Quickstart</a>
          <a href="#tutorial">Tutorial</a>
          <a href="#protocol">Protocol</a>
          <a href="#verify">Verify</a>
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
          <header><span>Navigate</span><button type="button" title="Close menu" onClick={() => setMenuOpen(false)}><X size={20} /></button></header>
          {["quickstart", "tutorial", "protocol", "verify"].map((item) => (
            <a key={item} href={`#${item}`} onClick={() => setMenuOpen(false)}>
              {item}<ChevronRight size={17} />
            </a>
          ))}
          <a href={REPO} target="_blank" rel="noreferrer">GitHub<ExternalLink size={16} /></a>
        </div>
      )}

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="prize-line">
              <span>OPEN-SOURCE FIELD MANUAL</span>
              <i />
              <span>{remaining}</span>
            </div>
            <h1>Farcaster,<br /><em>in three.</em></h1>
            <p>Provision the compute. Sync the protocol. Ship a client that reads from your node and answers to your keys.</p>
            <div className="hero-actions">
              <a className="primary-link" href="#quickstart">Start building <ArrowDown size={17} /></a>
              <a className="text-link" href={REPO} target="_blank" rel="noreferrer">Inspect every line <ArrowRight size={16} /></a>
            </div>
          </div>

          <div className="command-console" aria-label="Three command overview">
            <header>
              <span className="console-lights"><i /><i /><i /></span>
              <span>~/farcaster-in-three</span>
              <b>MAINNET</b>
            </header>
            {commands.map((item) => <Command key={item.number} {...item} />)}
            <footer>
              <span><i /> READS LOCAL</span>
              <span>WRITES VALIDATOR</span>
              <span>CUSTODY ABSENT</span>
            </footer>
          </div>
        </section>

        <section className="proof-strip" aria-label="System guarantees">
          <div><HardDrive size={19} /><strong>2 TiB</strong><span>data volume</span></div>
          <div><Network size={19} /><strong>0</strong><span>data API keys</span></div>
          <div><KeyRound size={19} /><strong>1</strong><span>OP transaction</span></div>
          <div><ShieldCheck size={19} /><strong>MIT</strong><span>client code</span></div>
        </section>

        <section className="quickstart section" id="quickstart">
          <SectionLabel number="00" text="QUICKSTART" />
          <div className="section-heading">
            <h2>Clone once.<br />Then count to three.</h2>
            <p>The operator command runs on macOS or Linux. It provisions a fresh host, starts an unauthenticated Snapchain read node, and deploys the client behind HTTPS.</p>
          </div>

          <div className="clone-line">
            <span>GET THE SOURCE</span>
            <CodeBlock code="git clone https://github.com/P-U-C/farcaster-in-three.git && cd farcaster-in-three" />
          </div>

          <div className="three-steps">
            {commands.map((item, index) => (
              <article key={item.number}>
                <header><b>{item.number}</b><span>{item.label}</span></header>
                <h3>{["Furnish the machine", "Sync the network", "Issue the app key"][index]}</h3>
                <CodeBlock code={item.command} />
                <p>{[
                  "Creates a hardened Hetzner host, a 2 TiB volume, an isolated SSH key, and narrow firewall rules.",
                  "Starts Snapchain v0.14.3 from an immutable image digest and verifies the validator-set checksum.",
                  "Registers a revocable Ed25519 signer with one OP transaction, then launches the responsive client.",
                ][index]}</p>
              </article>
            ))}
          </div>

          <Callout tone="green" icon={<CheckCircle2 size={22} />} title="What success looks like">
            Command 2 prints an HTTPS URL. Sign in, read casts fetched by your node, publish one, follow an FID, and react. No Neynar, Pinata, or hosted Farcaster data API sits in the path.
          </Callout>
        </section>

        <section className="architecture section-band" id="architecture">
          <div className="section narrow">
            <SectionLabel number="01" text="SYSTEM MAP" light />
            <div className="section-heading light">
              <h2>Read here.<br />Write there.</h2>
              <p>A read node follows and stores consensus state. A validator can place a signed message into its mempool. The client deliberately uses each for the job it can guarantee.</p>
            </div>
            <div className="system-map">
              <div className="map-node operator">
                <span>YOU</span><Terminal size={27} /><strong>Browser client</strong><small>HTTPS + session cookie</small>
              </div>
              <div className="map-arrow"><span>read</span><ArrowRight /><span>JSON</span></div>
              <div className="map-node read-node">
                <span>YOURS</span><Server size={27} /><strong>Snapchain read node</strong><small>full state · ports private</small>
              </div>
              <div className="map-arrow write"><span>write</span><ArrowRight /><span>protobuf</span></div>
              <div className="map-node validator">
                <span>NETWORK</span><Network size={27} /><strong>Validator</strong><small>mempool · consensus</small>
              </div>
            </div>
            <p className="architecture-note"><b>Why not submit to the read node?</b> It can gossip a write, but it has no mempool. Direct validator submission survives a gossip miss and still keeps reads sovereign.</p>
          </div>
        </section>

        <section className="tutorial section" id="tutorial">
          <SectionLabel number="02" text="THE TUTORIAL" />
          <div className="section-heading">
            <h2>From empty host<br />to first cast.</h2>
            <p>Read this once before running the commands. The script is concise; the system it creates is not a toy.</p>
          </div>

          <div className="tutorial-layout">
            <aside className="toc">
              <span>ON THIS PAGE</span>
              <a href="#before">Before you begin</a>
              <a href="#compute">0 · Compute</a>
              <a href="#node">1 · Read node</a>
              <a href="#client">2 · Client</a>
              <a href="#operate">Operate it</a>
              <a href="#keys">Key safety</a>
            </aside>

            <div className="chapters">
              <Chapter id="before" number="A" title="Before you begin">
                <p>You need an existing Farcaster account with storage, its custody recovery phrase, a small amount of ETH on Optimism for signer registration, and a Hetzner Cloud API token allowed to create servers, volumes, firewalls, and SSH keys.</p>
                <Checklist items={[
                  "Linux or macOS operator machine with Bash, Node.js 22+, npm, curl, jq, SSH, and tar",
                  "Custody phrase for the address that owns your FID",
                  "At least one active Farcaster storage unit",
                  "Enough OP ETH for one KeyGateway.add transaction",
                ]} />
                <CodeBlock code="./farcaster doctor" label="CHECK FIRST" />
                <p className="fine-print">The default cloud path is Hetzner. Snapchain itself needs no provider token or hosted RPC key. The infrastructure token creates compute only.</p>
              </Chapter>

              <Chapter id="compute" number="0" title="Furnish the compute">
                <p>Run the provisioner. It shows the selected region, machine class, volume size, and inbound rules before it creates anything billable.</p>
                <CodeBlock code="./farcaster provision" label="COMMAND 0" />
                <div className="fact-grid">
                  <Fact label="DEFAULT" value="ccx33" detail="validated against the live provider catalog" />
                  <Fact label="DATA" value="2 TiB" detail="mounted at /srv/in-three" />
                  <Fact label="PUBLIC" value="3382/UDP" detail="Snapchain gossip only" />
                  <Fact label="PRIVATE" value="3381 + 3383" detail="HTTP and gRPC bound to loopback" />
                </div>
                <p>Provisioning generates a dedicated local SSH key, limits SSH to your detected IP, and opens only HTTP/HTTPS plus QUIC gossip globally. The generated state file and key live under <code>.state/</code>, are mode 0600, and are excluded from Git.</p>
                <Callout tone="orange" icon={<Cloud size={21} />} title="Cost boundary">
                  The server and 2 TiB block volume are recurring cloud resources. Hetzner shows the exact rate in your console. Run <code>./farcaster destroy</code> when the experiment is over.
                </Callout>
              </Chapter>

              <Chapter id="node" number="1" title="Start the read node">
                <p>The second command checks for at least 1.5 TB free, fetches the validator set from the pinned Snapchain commit, verifies its SHA-256 checksum, pulls the x86-64 image by digest, and starts snapshot sync.</p>
                <CodeBlock code="./farcaster node up" label="COMMAND 1" />
                <p>The initial snapshot is several hundred gigabytes. Downloading, decompressing, and replaying newer blocks normally takes hours. The process continues after your SSH session ends.</p>
                <CodeBlock code="./farcaster node status" label="WATCH SYNC" />
                <p><b>Ready means every reported shard delay is under 30 seconds.</b> You can deploy the client earlier, but the home feed will only be current when the node catches up.</p>
                <div className="source-note">
                  <FileCheck2 size={20} />
                  <p><b>Version lock:</b> Snapchain 0.14.3, release commit <code>fc87f268…</code>, validator manifest <code>ca9912d…</code>. Upgrades should be reviewed, re-pinned, and tested, never silently pulled from <code>latest</code>.</p>
                </div>
              </Chapter>

              <Chapter id="client" number="2" title="Issue a client key">
                <p>The final command builds the setup utility locally and asks for the custody recovery phrase in a no-echo prompt. It derives account zero at <code>m/44&apos;/60&apos;/0&apos;/0/0</code>, resolves the FID on OP Mainnet, checks storage, and creates a fresh Ed25519 key.</p>
                <CodeBlock code="./farcaster client create" label="COMMAND 2" />
                <div className="key-ceremony">
                  <div><span>1</span><strong>Phrase enters local memory</strong><small>never an argument, environment variable, file, log, or network request</small></div>
                  <div><span>2</span><strong>App signer is generated</strong><small>32-byte Ed25519 key; metadata identifies its requesting FID</small></div>
                  <div><span>3</span><strong>KeyGateway.add is simulated</strong><small>you type REGISTER before one OP Mainnet transaction is sent</small></div>
                  <div><span>4</span><strong>Only the app key deploys</strong><small>the custody phrase is discarded; the signer remains independently revocable</small></div>
                </div>
                <p>The generated web password is scrypt-hashed. Caddy obtains TLS for the printed <code>sslip.io</code> hostname, and the app key file is owner-readable only. Replace that hostname with your own domain in <code>/srv/in-three/.env</code> whenever you are ready.</p>
              </Chapter>

              <Chapter id="operate" number="O" title="Operate what you own">
                <div className="ops-table">
                  <div><code>./farcaster node status</code><span>container, version, block delay, disk</span></div>
                  <div><code>./farcaster node logs</code><span>follow Snapchain logs</span></div>
                  <div><code>./farcaster client status</code><span>containers, TLS, node health</span></div>
                  <div><code>./farcaster client logs</code><span>follow app and proxy logs</span></div>
                  <div><code>./farcaster destroy</code><span>delete all billable resources</span></div>
                </div>
                <p>Back up the delegated app key only if you need continuity. Losing it means registering another small OP transaction. Losing the Snapchain database means downloading a new verified snapshot. Neither loss compromises custody.</p>
              </Chapter>

              <Chapter id="keys" number="S" title="The key boundary">
                <div className="boundary-grid">
                  <div className="never"><b>NEVER LEAVES YOUR TERMINAL</b><KeyRound size={24} /><strong>Custody recovery phrase</strong><p>Can register and revoke app keys. Used once in memory.</p></div>
                  <div className="stored"><b>STORED ON YOUR HOST</b><ShieldCheck size={24} /><strong>Delegated app key</strong><p>Can sign Farcaster messages for one FID. Cannot transfer custody.</p></div>
                </div>
                <p>Compromise of the client host requires revoking that signer. Use the signer public key printed in your deployment receipt and remove it from your Farcaster account’s connected-app management. Then rotate the web password and rebuild the host.</p>
              </Chapter>
            </div>
          </div>
        </section>

        <section className="client-showcase section-band">
          <div className="section wide">
            <SectionLabel number="03" text="REFERENCE CLIENT" light />
            <div className="showcase-copy">
              <div>
                <h2>Not a demo.<br />A working client.</h2>
                <p>The home feed is assembled from follows and casts on your read node. Every write is signed by your delegated key and encoded with the official Farcaster message builders.</p>
              </div>
              <ul>
                <li><Check size={16} /> Read a chronological network feed</li>
                <li><Check size={16} /> Publish casts with optional embeds</li>
                <li><Check size={16} /> Follow FIDs, like, and recast</li>
                <li><Check size={16} /> Include or exclude exact client signer keys</li>
                <li><Check size={16} /> Resolve signed-key request attribution</li>
              </ul>
            </div>
            <div className="client-frame">
              <div className="browser-bar"><i /><i /><i /><span>your-node.sslip.io</span></div>
              <img src="./client-preview.webp" alt="In Three client showing a Farcaster feed and client-source filters" />
            </div>
          </div>
        </section>

        <section className="protocol section" id="protocol">
          <SectionLabel number="04" text="PROTOCOL PRIMER" />
          <div className="section-heading">
            <h2>The six things<br />that matter.</h2>
            <p>You do not need to memorize the protocol. You do need the right mental model when a cast fails or a key must be rotated.</p>
          </div>
          <div className="concepts">
            <Concept index="01" title="FID" accent="purple">A numeric identity registered on OP Mainnet. The IdRegistry maps one FID to its custody address.</Concept>
            <Concept index="02" title="Custody address" accent="orange">The Ethereum account that owns the FID. It authorizes app signers and recovery; it should not live on an app server.</Concept>
            <Concept index="03" title="App key" accent="cyan">A revocable Ed25519 key registered for one FID. It signs casts, reactions, links, and other Snapchain messages.</Concept>
            <Concept index="04" title="Snapchain message" accent="green">Typed protobuf data plus FID, network, timestamp, hash, signature, and signer public key.</Concept>
            <Concept index="05" title="Read node / validator" accent="purple">Both verify state. Only validators propose and vote on blocks; a read node stores state and serves your queries.</Concept>
            <Concept index="06" title="Storage rent" accent="orange">Onchain capacity for casts, reactions, links, profile data, and verifications. A valid signer still cannot exceed its FID’s limits.</Concept>
          </div>

          <div className="client-filter-explainer">
            <Filter size={28} />
            <div><h3>What “filter by client” actually means</h3><p>A cast carries the public key that signed it, not a free-form client name. In Three filters exact signer keys. When the signer’s onchain metadata contains a signed key request, it decodes <code>requestFid</code> and resolves that FID’s profile for a human label. Unknown keys stay visible as shortened fingerprints.</p></div>
          </div>

          <div className="references">
            <h3>Primary references</h3>
            <a href="https://snapchain.farcaster.xyz/getting-started" target="_blank" rel="noreferrer"><span>Snapchain</span> Getting started <ExternalLink size={15} /></a>
            <a href="https://snapchain.farcaster.xyz/node-types" target="_blank" rel="noreferrer"><span>Snapchain</span> Read nodes vs validators <ExternalLink size={15} /></a>
            <a href="https://github.com/farcasterxyz/protocol" target="_blank" rel="noreferrer"><span>Protocol</span> Specification <ExternalLink size={15} /></a>
            <a href="https://github.com/farcasterxyz/contracts" target="_blank" rel="noreferrer"><span>Contracts</span> OP deployments <ExternalLink size={15} /></a>
            <a href="https://docs.farcaster.xyz/reference/farcaster/signers" target="_blank" rel="noreferrer"><span>Farcaster</span> Signers <ExternalLink size={15} /></a>
            <a href="https://docs.farcaster.xyz/reference/contracts/reference/storage-registry" target="_blank" rel="noreferrer"><span>Farcaster</span> Storage <ExternalLink size={15} /></a>
          </div>
        </section>

        <section className="verification section-band light-band" id="verify">
          <div className="section narrow">
            <SectionLabel number="05" text="HUMAN PROOF" />
            <div className="verify-layout">
              <div>
                <h2>Machines can test code.<br /><em>A human must test the path.</em></h2>
                <p>Prize eligibility requires at least one independent person to complete the tutorial, create the node and client, and vouch publicly on Farcaster.</p>
              </div>
              <div className="voucher-list">
                <Voucher number="1" text="Start from a clean operator machine and record the three commands." />
                <Voucher number="2" text="Confirm the read node catches up and the feed comes from localhost:3381." />
                <Voucher number="3" text="Post a cast, follow an FID, and react through the deployed client." />
                <Voucher number="4" text="Check that no custody phrase appears in shell history, files, process arguments, or logs." />
                <Voucher number="5" text="Publish a Farcaster endorsement naming what worked and any friction found." />
              </div>
            </div>
            <div className="voucher-cta">
              <div><FileCheck2 size={25} /><span><strong>Tester runbook</strong><small>Exact checks, evidence, and endorsement template</small></span></div>
              <a href={`${REPO}/blob/main/VOUCHER.md`} target="_blank" rel="noreferrer">Open VOUCHER.md <ArrowRight size={16} /></a>
            </div>
          </div>
        </section>

        <section className="faq section">
          <SectionLabel number="06" text="FIELD NOTES" />
          <div className="faq-grid">
            <h2>Questions worth<br />answering first.</h2>
            <div>
              <Details question="Does the read node need an API key?">No. It downloads a public, verifiable snapshot and syncs blocks over the Farcaster network. The Hetzner token provisions infrastructure and is never installed on the node.</Details>
              <Details question="Why does the client write to a validator?">Read-node submission is best-effort gossip. A validator places a valid message in its mempool and can propose it directly, giving the client a stronger delivery path.</Details>
              <Details question="Can the app key move my wallet funds?">No. The Ed25519 signer authorizes Farcaster messages for its FID. It is not the Ethereum custody key and cannot sign wallet transactions.</Details>
              <Details question="Why import a recovery phrase at all?">The stated challenge calls for importing an existing account and issuing the client its own key in one OP transaction. The phrase signs that one KeyGateway call locally, then disappears.</Details>
              <Details question="What is not automated?">A human voucher and the final prize reply. They are intentionally not fabricated or posted by a bot.</Details>
            </div>
          </div>
        </section>

        <section className="final-cta">
          <span className="eyebrow">OWN YOUR SOCIAL EDGE</span>
          <h2>Three commands.<br />No data landlord.</h2>
          <div>
            <a href="#quickstart">Run the quickstart <Terminal size={18} /></a>
            <a href={REPO} target="_blank" rel="noreferrer">Read the source <Github size={18} /></a>
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
  return <div className="code-block">{label && <span>{label}</span>}<code><i>$</i> {code}</code><button type="button" title="Copy command" onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }}>{copied ? <Check size={16} /> : <Clipboard size={16} />}</button></div>;
}

function SectionLabel({ number, text, light = false }: { number: string; text: string; light?: boolean }) {
  return <div className={light ? "section-label light" : "section-label"}><span>{number}</span><i /><b>{text}</b></div>;
}

function Callout({ tone, icon, title, children }: { tone: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <div className={`callout ${tone}`}>{icon}<div><strong>{title}</strong><p>{children}</p></div></div>;
}

function Chapter({ id, number, title, children }: { id: string; number: string; title: string; children: React.ReactNode }) {
  return <article className="chapter" id={id}><header><span>{number}</span><h3>{title}</h3></header><div>{children}</div></article>;
}

function Checklist({ items }: { items: string[] }) {
  return <ul className="checklist">{items.map((item) => <li key={item}><Check size={15} />{item}</li>)}</ul>;
}

function Fact({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="fact"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function Concept({ index, title, accent, children }: { index: string; title: string; accent: string; children: React.ReactNode }) {
  return <article className={`concept ${accent}`}><span>{index}</span><h3>{title}</h3><p>{children}</p></article>;
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

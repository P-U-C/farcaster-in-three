import {
  ArrowDown,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  CircleDollarSign,
  ChevronRight,
  Clipboard,
  Cloud,
  ExternalLink,
  FileCheck2,
  Filter,
  Github,
  HardDrive,
  KeyRound,
  LockKeyhole,
  Menu,
  Network,
  Server,
  ShieldCheck,
  Terminal,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const DEADLINE = new Date("2026-10-24T14:47:30Z");
const REPO = "https://github.com/P-U-C/farcaster-in-three";

const commands = [
  { number: "0", label: "COMPUTE", command: "./in-three-container provision" },
  { number: "1", label: "SNAPCHAIN", command: "./in-three-container node up" },
  { number: "2", label: "CLIENT", command: "./in-three-container client create" },
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
          <a href="#agents">Agents</a>
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
          {["quickstart", "tutorial", "agents", "protocol", "verify"].map((item) => (
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
              <span>WRITES LOCAL</span>
              <span>CUSTODY ABSENT</span>
            </footer>
          </div>
        </section>

        <section className="proof-strip" aria-label="System guarantees">
          <div><HardDrive size={19} /><strong>2 TiB</strong><span>data volume</span></div>
          <div><Network size={19} /><strong>0</strong><span>data API keys</span></div>
          <div><KeyRound size={19} /><strong>0</strong><span>OP transactions</span></div>
          <div><ShieldCheck size={19} /><strong>MIT</strong><span>client code</span></div>
        </section>

        <section className="quickstart section" id="quickstart">
          <SectionLabel number="00" text="QUICKSTART" />
          <div className="section-heading">
            <h2>Run these three<br />commands.</h2>
            <p>Load the versioned operator image on macOS or Linux. The launcher verifies the tagged release archive, mounts only this directory, runs as your user, drops capabilities, and never mounts the Docker socket.</p>
          </div>

          <div className="clone-line">
            <span>GET THE CONTAINER LAUNCHER</span>
            <CodeBlock code={"mkdir in-three-node && cd in-three-node\ncurl -fsSLO https://raw.githubusercontent.com/P-U-C/farcaster-in-three/v0.1.2/in-three-container\nchmod +x in-three-container"} />
          </div>

          <div className="paid-quickstart">
            <div>
              <span>ONE-PURCHASE PATH</span>
              <h3>Pay once. Provision the full stack.</h3>
              <p>A free preflight checks the fixed Hetzner plan and token permissions. One 25 USDC x402 request creates the server, volume, firewall, and SSH key, then starts Snapchain. Hetzner bills the infrastructure separately.</p>
            </div>
            <div>
              <CodeBlock code="./in-three-container deploy --service https://YOUR_BROKER --payment-network base" label="FULL DEPLOY" />
              <small>The container uses a dedicated Base payer. Celo usebuy.ai stays on the host OS keychain. Interrupted payments resume without buying again.</small>
            </div>
          </div>

          <div className="manual-label"><span>OR RUN THE MANUAL PRIZE PATH</span><i /></div>

          <div className="three-steps">
            {commands.map((item, index) => (
              <article key={item.number}>
                <header><b>{item.number}</b><span>{item.label}</span></header>
                <h3>{["Furnish the machine", "Sync the network", "Issue the app key"][index]}</h3>
                <CodeBlock code={item.command} />
                <p>{[
                  "Creates a hardened Hetzner host, a 2 TiB volume, an isolated SSH key, and narrow firewall rules.",
                  "Starts Snapchain v0.14.3 from an immutable image digest and verifies the validator-set checksum.",
                  "Creates the revenue routes, authorizes a scoped gasless signer through your node, then launches the browser and agent clients.",
                ][index]}</p>
              </article>
            ))}
          </div>

          <Callout tone="green" icon={<CheckCircle2 size={22} />} title="What each command returns">
            Provision prints the server IP, future client URL, and local state path. Node up either reports an online API or a resumable snapshot bootstrap. Client create waits for that API, then prints the live HTTPS URL and the separate read and write paths.
          </Callout>
        </section>

        <section className="architecture section-band" id="architecture">
          <div className="section narrow">
            <SectionLabel number="01" text="SYSTEM MAP" light />
            <div className="section-heading light">
              <h2>Two paths,<br />one client service.</h2>
              <p>Human sessions and paid agents terminate at your host. The client sends both reads and signed writes to your Snapchain node. The node relays valid writes to validators over gossip.</p>
            </div>
            <div className="system-map">
              <div className="map-ingress">
                <div className="map-node operator">
                  <span>YOU</span><Terminal size={27} /><strong>Browser</strong><small>HTTPS + session cookie</small>
                </div>
                <div className="map-arrow"><span>request</span><ArrowRight /><span>HTTPS</span></div>
                <div className="map-node client-service">
                  <span>YOUR HOST</span><Cloud size={27} /><strong>Client service</strong><small>auth · feed · message signing</small>
                </div>
              </div>
              <div className="route-row read-route">
                <div className="route-label"><b>READ PATH</b><span>Protocol data</span></div>
                <div className="route-origin"><strong>Client service</strong><small>HTTP JSON query</small></div>
                <div className="map-arrow"><ArrowRight /></div>
                <div className="map-node read-node">
                  <span>YOURS</span><Server size={27} /><strong>Snapchain read node</strong><small>full state · private ports</small>
                </div>
              </div>
              <div className="route-row write-route">
                <div className="route-label"><b>WRITE PATH</b><span>Signed messages</span></div>
                <div className="route-origin"><strong>Client service</strong><small>binary protobuf</small></div>
                <div className="map-arrow write"><ArrowRight /></div>
                <div className="map-node validator">
                  <span>YOURS</span><Server size={27} /><strong>Snapchain read node</strong><small>validate · gossip to validators</small>
                </div>
              </div>
            </div>
            <p className="architecture-note"><b>What success means:</b> the read node validates the message and gossips it to validators. Because it has no mempool, acceptance means relayed, not included. Confirm the message when it appears in synced node state.</p>
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
              <a href="#first-cast">First cast</a>
              <a href="#operate">Operate it</a>
              <a href="#keys">Key safety</a>
            </aside>

            <div className="chapters">
              <Chapter id="before" number="A" title="Before you begin">
                <p>You need Docker, a Hetzner Cloud token, an otherwise disposable Farcaster test account with storage, a Celo x402 facilitator key from <a href="https://x402.celo.org/" target="_blank" rel="noreferrer">x402.celo.org</a>, and a Coinbase CDP key for Base settlement.</p>
                <Checklist items={[
                  "Linux or macOS with Docker, Bash, curl, gzip, and a SHA-256 tool",
                  "Recovery phrase for a disposable test account that owns an FID",
                  "At least one active Farcaster storage unit",
                  "No OP ETH: app-key authorization is gasless",
                  "Small CELO and Base ETH balances only if split creation is needed",
                  "Celo facilitator API key plus Coinbase CDP Secret API key",
                ]} />
                <Callout tone="orange" icon={<KeyRound size={21} />} title="Developer flow: test accounts only">
                  A recovery phrase is full account control. Enter one only into source you have inspected and trust; never send it through chat or reuse an account that holds value. Production clients should use delegated authorization from a trusted wallet.
                </Callout>
                <CodeBlock code="./in-three-container doctor" label="CHECK FIRST" />
                <p className="fine-print">The default cloud path is Hetzner. Snapchain itself needs no provider token or hosted RPC key. The infrastructure token creates compute only.</p>
              </Chapter>

              <Chapter id="compute" number="0" title="Furnish the compute">
                <p>Run the provisioner. It shows the selected region, machine class, volume size, and inbound rules before it creates anything billable.</p>
                <CodeBlock code="./in-three-container provision" label="COMMAND 0" />
                <div className="fact-grid">
                  <Fact label="DEFAULT" value="ccx33" detail="validated against the live provider catalog" />
                  <Fact label="DATA" value="2 TiB" detail="mounted at /srv/in-three" />
                  <Fact label="PUBLIC" value="3382/UDP" detail="Snapchain gossip only" />
                  <Fact label="PRIVATE" value="3381 + 3383" detail="HTTP and gRPC bound to loopback" />
                </div>
                <p>Provisioning generates a dedicated local SSH key, limits SSH to your detected IP, and opens only HTTP/HTTPS plus QUIC gossip globally. The generated state file and key live under <code>.state/</code>, are mode 0600, and are excluded from Git.</p>
                <OutputBlock lines={[
                  "Compute is ready at 203.0.113.10",
                  "client URL   https://203-0-113-10.sslip.io (activated by command 2)",
                  "local state  .state/config",
                  "Next: ./in-three-container node up",
                ]} />
                <Callout tone="orange" icon={<Cloud size={21} />} title="Approximate recurring cost">
                  At Hetzner&apos;s current Ashburn list rates, the default CCX33 is $165.99/month and 2,048 GiB of volume storage is about $99.12/month: roughly $265/month before IPv4, traffic, or tax. Check the <a href="https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/" target="_blank" rel="noreferrer">server rate</a> and <a href="https://www.hetzner.com/cloud/" target="_blank" rel="noreferrer">volume rate</a> in your console before typing <code>PROVISION</code>. Run <code>./in-three-container destroy</code> when finished.
                </Callout>
              </Chapter>

              <Chapter id="node" number="1" title="Start the read node">
                <p>The second command checks for at least 1.5 TB free, verifies the vendored validator set against the pinned Snapchain release checksum, pulls the x86-64 image by digest, and starts snapshot sync.</p>
                <CodeBlock code="./in-three-container node up" label="COMMAND 1" />
                <p>The initial snapshot is several hundred gigabytes. Downloading, decompressing, and replaying newer blocks commonly takes hours. Node up returns after confirming that the container is running; closing your terminal does not stop bootstrap.</p>
                <OutputBlock lines={[
                  "Snapchain bootstrap is running on the server",
                  "HTTP API      waiting for snapshot bootstrap",
                  "Check progress: ./in-three-container node status",
                  "Next: ./in-three-container client create (waits, then continues)",
                ]} />
                <CodeBlock code="./in-three-container node status" label="WATCH SYNC" />
                <p><b>Ready means every reported shard delay is under 30 seconds.</b> Start command 2 immediately: it reports bootstrap progress every five minutes and continues automatically when the local HTTP API appears. It does not request the phrase or register an app key while waiting.</p>
                <div className="source-note">
                  <FileCheck2 size={20} />
                  <p><b>Version lock:</b> Snapchain 0.14.3, release commit <code>fc87f268…</code>, validator manifest <code>ca9912d…</code>. Upgrades should be reviewed, re-pinned, and tested, never silently pulled from <code>latest</code>.</p>
                </div>
              </Chapter>

              <Chapter id="client" number="2" title="Issue a client key">
                <p>The final command validates the client password and facilitator credentials, opens a local tunnel to your node, and requires <code>TEST ACCOUNT</code> before the hidden phrase prompt. It resolves the FID and storage, prepares Celo/Base revenue routes, and creates a fresh Ed25519 key.</p>
                <CodeBlock code="./in-three-container client create" label="COMMAND 2" />
                <div className="key-ceremony">
                  <div><span>1</span><strong>Secrets are separated</strong><small>password and both facilitator credentials are validated before custody is requested</small></div>
                  <div><span>2</span><strong>Phrase stays in local memory</strong><small>test account only; never an argument, file, environment variable, log, or network request</small></div>
                  <div><span>3</span><strong>Gasless message is recoverable</strong><small>exact KEY_ADD protobuf, hash, checksum, and app key are saved before submission</small></div>
                  <div><span>4</span><strong>Node state is checked</strong><small>a rerun checks the signer first and resubmits only the saved bytes</small></div>
                </div>
                <OutputBlock lines={[
                  "Client is live",
                  "URL           https://203-0-113-10.sslip.io",
                  "agent API     https://203-0-113-10.sslip.io/.well-known/agent.json",
                  "agent access  .state/agent.env",
                  "read path     browser or paid agent -> client service -> your node",
                  "write path    authorized client -> your node -> validator gossip",
                  "custody key   not stored",
                ]} />
                <p>The password is scrypt-hashed. The Farcaster signer and payment credentials are installed in separate read-only containers. Caddy obtains TLS for the printed <code>sslip.io</code> hostname, and <code>.state/agent.env</code> stores the owner&apos;s write capability with mode 0600.</p>
                <div className="source-note">
                  <FileCheck2 size={20} />
                  <p><b>If submission is uncertain:</b> keep <code>.state/client.env.pending</code>. It contains the exact gasless message, hash, checksum, app key, and any Celo/Base split transactions. Rerun <code>./in-three-container client create</code>; it checks signer state and receipts before resubmitting only the saved bytes.</p>
                </div>
              </Chapter>

              <Chapter id="first-cast" number="F" title="Publish the first cast">
                <ol className="walkthrough">
                  <li><span>1</span><p>Open the HTTPS URL printed by command 2 and sign in with the client password you just set.</p></li>
                  <li><span>2</span><p>Select <b>New cast</b>, enter plain text, and optionally add one HTTPS embed URL.</p></li>
                  <li><span>3</span><p>Select <b>Publish</b>. The client signs a Snapchain message and submits its binary protobuf to your read node.</p></li>
                  <li><span>4</span><p>The first response means accepted for relay. Copy the hash, then refresh until your synced node returns the cast; that later read is confirmation.</p></li>
                  <li><span>5</span><p>Open another Farcaster client and verify the same cast publicly. Save that public cast URL for the independent voucher.</p></li>
                </ol>
              </Chapter>

              <Chapter id="operate" number="O" title="Operate what you own">
                <div className="ops-table">
                  <div><code>./in-three-container node status</code><span>container, version, block delay, disk</span></div>
                  <div><code>./in-three-container node logs</code><span>follow Snapchain logs</span></div>
                  <div><code>./in-three-container client status</code><span>containers, TLS, node health</span></div>
                  <div><code>./in-three-container client logs</code><span>follow app and proxy logs</span></div>
                  <div><code>./in-three-container destroy</code><span>delete all billable resources</span></div>
                </div>
                <p>Back up the delegated app key only if continuity matters. Losing it means authorizing another gasless signer and revoking the old key. Losing the Snapchain database means downloading a new snapshot. If provisioning aborts, check the provider console before retrying. None of these failures transfers custody.</p>
              </Chapter>

              <Chapter id="keys" number="S" title="The key boundary">
                <div className="boundary-grid">
                  <div className="never"><b>TEST ACCOUNT · LOCAL ONLY</b><KeyRound size={24} /><strong>Recovery phrase</strong><p>Full account control. Enter only into reviewed, trusted code.</p></div>
                  <div className="stored"><b>STORED ON YOUR HOST</b><ShieldCheck size={24} /><strong>Scoped app key</strong><p>Casts, reactions, and follows only. Gasless and revocable.</p></div>
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
                <h2>Reference client,<br />included.</h2>
                <p>The home feed is assembled from your read node. Every write is signed by the scoped key, encoded with the official builders, and submitted back to that node for validator gossip.</p>
              </div>
              <ul>
                <li><Check size={16} /> Read a chronological network feed</li>
                <li><Check size={16} /> Publish casts with optional embeds</li>
                <li><Check size={16} /> Follow FIDs, like, and recast</li>
                <li><Check size={16} /> Include or exclude every discovered source</li>
                <li><Check size={16} /> Group attributed keys by app; expose unknown keys exactly</li>
              </ul>
            </div>
            <figure className="client-frame">
              <div className="browser-bar"><i /><i /><i /><span>your-node.sslip.io</span></div>
              <img src="./client-preview.webp" alt="Illustrative In Three client preview using synthetic profiles and casts" />
              <figcaption>Illustrative preview using synthetic accounts and casts. A deployed client reads live protocol data from your own node.</figcaption>
            </figure>
          </div>
        </section>

        <section className="agents section" id="agents">
          <SectionLabel number="04" text="AGENT COMMERCE" />
          <div className="section-heading agent-heading">
            <h2>Agents can deploy<br />and operate it.</h2>
            <p>Every deployment can provision the next buyer-owned node and publishes a paid operational API. One x402 v2 response offers chain-local USDC on Celo and Base without customer accounts or hosted Farcaster data keys.</p>
          </div>

          <div className="deploy-offer">
            <div>
              <span>FIXED DEPLOYMENT</span>
              <h3>One x402 payment starts the node.</h3>
              <p>The buyer supplies a dedicated Hetzner project token and SSH public key. The broker records a token hash for recovery, creates the fixed <code>ccx33 + 2 TiB</code> plan, and returns the resource IDs. Custody happens later on the buyer&apos;s machine.</p>
            </div>
            <div>
              <CodeBlock code="./in-three-container deploy --service https://YOUR_BROKER --payment-network base" label="25 USDC · ONCE" />
              <dl>
                <div><dt>BEFORE PAYMENT</dt><dd>plan + write-access preflight</dd></div>
                <div><dt>AFTER PAYMENT</dt><dd>idempotent status + free resume</dd></div>
                <div><dt>SEPARATE BILL</dt><dd>Hetzner runs until destroy</dd></div>
                <div><dt>CONTAINER RAIL</dt><dd>dedicated Base payer</dd></div>
              </dl>
            </div>
          </div>

          <div className="agent-commerce">
            <div className="agent-sequence" aria-label="Paid agent request sequence">
              <div><span>01</span><Bot size={23} /><strong>Discover</strong><small>Read the manifest and exact request schema.</small></div>
              <div><span>02</span><CircleDollarSign size={23} /><strong>Choose</strong><small>The 402 offers the same USDC price on Celo and Base.</small></div>
              <div><span>03</span><WalletCards size={23} /><strong>Pay locally</strong><small>The selected x402 wallet signs; its private key never leaves it.</small></div>
              <div><span>04</span><Network size={23} /><strong>Operate</strong><small>The gateway settles, then the client reads or signs the action.</small></div>
            </div>

            <div className="agent-terminal">
              <header><span>X402 V2</span><b>CELO · BASE</b></header>
              <CodeBlock code="buy quote https://YOUR_CLIENT/agent/v1/feed" label="QUOTE · FREE" />
              <CodeBlock code="buy curl --max-amount 0.005 https://YOUR_CLIENT/agent/v1/feed" label="CELO · 0.005 USDC" />
              <CodeBlock code="node scripts/pay-base.mjs --url https://YOUR_CLIENT/agent/v1/feed --max 0.005" label="BASE · 0.005 USDC" />
              <div className="agent-terminal-foot">
                <LockKeyhole size={19} />
                <p><b>Writes have two gates.</b> The owner capability is checked before the payment challenge. A stranger gets <code>401</code>, not a bill and not access to the Farcaster signer.</p>
              </div>
            </div>
          </div>

          <div className="agent-prices" aria-label="Default agent API prices">
            <div><span>FULL DEPLOYMENT</span><strong>25</strong><small>USDC / once</small></div>
            <div><span>PROFILE + SOURCES</span><strong>0.002</strong><small>USDC / request</small></div>
            <div><span>OWN-NODE FEED</span><strong>0.005</strong><small>USDC / request</small></div>
            <div><span>CAST · FOLLOW · REACT</span><strong>0.02</strong><small>USDC / request</small></div>
          </div>

          <div className="settlement-policy">
            <div className="settlement-heading">
              <span>SETTLEMENT POLICY</span>
              <h3>Direct rails. One durable split.</h3>
              <p>Each chain settles to the same deterministic address. Funds stay on the chain the buyer chose; bridging is optional after distribution.</p>
            </div>
            <div className="settlement-detail">
              <div className="split-meter" aria-label="95 percent operator and 5 percent P-U-C">
                <span className="operator-share"><b>95%</b><small>OPERATOR</small></span>
                <span className="puc-share"><b>5%</b><small>P-U-C</small></span>
              </div>
              <p>Immutable 0xSplits V2 allocation · 0.1% permissionless distribution incentive · no referral tree</p>
            </div>
          </div>

          <div className="agent-boundaries">
            <div><b>DEPLOYMENT SERVICE</b><p>Fixed cloud plan and entitlement hashes. Token is used in memory, not stored.</p></div>
            <div><b>CLIENT CONTAINER</b><p>Farcaster app signer, password hash, session secret. No payment credentials.</p></div>
            <div><b>PAYMENT CONTAINER</b><p>Celo/CDP credentials, prices, verified split address, write capability. No Farcaster signer.</p></div>
            <div><b>AUTHORIZED AGENT</b><p>Dedicated buy wallet and optional write capability. No custody phrase.</p></div>
          </div>

          <div className="agent-links">
            <a href="https://usebuy.ai/docs" target="_blank" rel="noreferrer">Install buy and its MCP server <ExternalLink size={15} /></a>
            <a href={`${REPO}/blob/main/docs/AGENT-API.md`} target="_blank" rel="noreferrer">Read the complete agent runbook <ArrowRight size={15} /></a>
          </div>

          <Callout tone="orange" icon={<Server size={21} />} title="Compute remains persistent">
            usebuy.ai&apos;s hosted CPU machines are one-hour jobs with a 24-hour renewal ceiling. They cannot honestly hold a long-lived multi-terabyte Snapchain database. In Three uses buy for discovery, payment, gating, and agent automation while the owned read node stays on persistent compute.
          </Callout>
        </section>

        <section className="protocol section" id="protocol">
          <SectionLabel number="05" text="PROTOCOL PRIMER" />
          <div className="section-heading">
            <h2>The six things<br />that matter.</h2>
            <p>You do not need to memorize the protocol. You do need the right mental model when a cast fails or a key must be rotated.</p>
          </div>
          <div className="concepts">
            <Concept index="01" title="FID" accent="purple">A numeric identity registered on OP Mainnet. The IdRegistry maps one FID to its custody address.</Concept>
            <Concept index="02" title="Custody address" accent="orange">The Ethereum account that owns the FID. It authorizes app signers and recovery; it should not live on an app server.</Concept>
            <Concept index="03" title="App key" accent="cyan">A scoped Ed25519 signer authorized by a gasless KEY_ADD. This build permits casts, reactions, and links for a 90-day sliding window.</Concept>
            <Concept index="04" title="Snapchain message" accent="green">Typed protobuf data plus FID, network, timestamp, hash, signature, and signer public key.</Concept>
            <Concept index="05" title="Read node / validator" accent="purple">Both accept and validate messages. A read node serves state and gossips writes; validators keep mempools and propose blocks.</Concept>
            <Concept index="06" title="Storage rent" accent="orange">Onchain capacity for casts, reactions, links, profile data, and verifications. A valid signer still cannot exceed its FID’s limits.</Concept>
          </div>

          <div className="client-filter-explainer">
            <Filter size={28} />
            <div><h3>What “filter by client” actually means</h3><p>A cast carries its signer key, not a free-form client name. In Three queries the unified signer API, exposes every discovered key, groups keys sharing available app attribution, and keeps unattributed keys as exact fingerprint controls.</p></div>
          </div>

          <div className="references">
            <h3>Primary references</h3>
            <a href="https://snapchain.farcaster.xyz/getting-started" target="_blank" rel="noreferrer"><span>Snapchain</span> Getting started <ExternalLink size={15} /></a>
            <a href="https://snapchain.farcaster.xyz/node-types" target="_blank" rel="noreferrer"><span>Snapchain</span> Read nodes vs validators <ExternalLink size={15} /></a>
            <a href="https://snapchain.farcaster.xyz/guides/writing-messages" target="_blank" rel="noreferrer"><span>Snapchain</span> Gasless writes and signers <ExternalLink size={15} /></a>
            <a href="https://github.com/farcasterxyz/protocol" target="_blank" rel="noreferrer"><span>Protocol</span> Specification <ExternalLink size={15} /></a>
            <a href="https://github.com/farcasterxyz/contracts" target="_blank" rel="noreferrer"><span>Contracts</span> OP deployments <ExternalLink size={15} /></a>
            <a href="https://docs.farcaster.xyz/reference/farcaster/signers" target="_blank" rel="noreferrer"><span>Farcaster</span> Signers <ExternalLink size={15} /></a>
            <a href="https://docs.farcaster.xyz/reference/contracts/reference/storage-registry" target="_blank" rel="noreferrer"><span>Farcaster</span> Storage <ExternalLink size={15} /></a>
          </div>
        </section>

        <section className="verification section-band light-band" id="verify">
          <div className="section narrow">
            <SectionLabel number="06" text="HUMAN PROOF" />
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
            <div className="bounty-board" aria-labelledby="bounty-title">
              <header>
                <span>2 RESERVED SLOTS · 400 USDC TOTAL</span>
                <h3 id="bounty-title">Run it. Break it honestly. Show the receipts.</h3>
                <p>Claim a track before spending. The reward covers testing, not praise; reproducible blockers remain valid findings.</p>
              </header>
              <div className="bounty-tracks">
                <div>
                  <UserRound size={23} />
                  <span>HUMAN</span>
                  <strong>200 <small>USDC</small></strong>
                  <p>Clean machine, full node and client, security checks, and an honest public Farcaster report.</p>
                </div>
                <div>
                  <Bot size={23} />
                  <span>AGENT</span>
                  <strong>200 <small>USDC</small></strong>
                  <p>Public skill, command transcript, x402 reads on both rails, an authorized paid cast, and receipts.</p>
                </div>
              </div>
              <footer>
                <span>Evidence due 2026-10-23 · 14:47 UTC</span>
                <a href={`${REPO}/blob/main/TESTER-BOUNTY.md`} target="_blank" rel="noreferrer">Read rules and claim <ArrowRight size={16} /></a>
              </footer>
            </div>
            <div className="voucher-cta">
              <div><FileCheck2 size={25} /><span><strong>Tester runbook</strong><small>Exact checks, evidence, and endorsement template</small></span></div>
              <a href={`${REPO}/blob/main/VOUCHER.md`} target="_blank" rel="noreferrer">Open VOUCHER.md <ArrowRight size={16} /></a>
            </div>
          </div>
        </section>

        <section className="faq section">
          <SectionLabel number="07" text="FIELD NOTES" />
          <div className="faq-grid">
            <h2>Questions worth<br />answering first.</h2>
            <div>
              <Details question="Does the read node need an API key?">No. It downloads a public, verifiable snapshot and syncs blocks over the Farcaster network. The Hetzner token provisions infrastructure and is never installed on the node.</Details>
              <Details question="Where does the client write?">To your read node. It validates the signed message and gossips it to validators. Because a read node has no mempool, submission means accepted for relay; a later node read confirms inclusion.</Details>
              <Details question="Can the app key move my wallet funds?">No. The Ed25519 signer authorizes Farcaster messages for its FID. It is not the Ethereum custody key and cannot sign wallet transactions.</Details>
              <Details question="Why enter a recovery phrase at all?">This developer tutorial demonstrates custody authorization for a scoped gasless signer. Use only a disposable test account and code you trust. Production clients should request delegated wallet authorization instead of collecting phrases. Split setup may also sign fixed zero-value Celo/Base factory calls.</Details>
              <Details question="How does an agent pay?">The 402 offers equal USDC prices on Celo and Base. The bundled buy CLI or MCP selects Celo; another x402 v2 wallet may select Base. Write routes also require the owner capability before a quote is issued.</Details>
              <Details question="What is not automated?">The owner supplies secrets locally, acknowledges the test-account ceremony, and confirms Celo/Base split creation plus gasless signer authorization. The human voucher and final prize reply remain human work. Hetzner's recurring bill is separate from the broker fee.</Details>
            </div>
          </div>
        </section>

        <section className="final-cta">
          <span className="eyebrow">RUN IT, THEN VERIFY IT</span>
          <h2>Start with the<br />quickstart.</h2>
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

function OutputBlock({ lines }: { lines: string[] }) {
  return <div className="output-block"><span>EXPECTED OUTPUT</span><pre>{lines.join("\n")}</pre></div>;
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

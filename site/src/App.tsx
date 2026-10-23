import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Captions,
  Check,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Container,
  Download,
  ExternalLink,
  Github,
  KeyRound,
  Languages,
  Menu,
  Monitor,
  Network,
  Package,
  Server,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { messages, type Locale } from "./i18n";

const REPO = "https://github.com/P-U-C/farcaster-in-three";
const DOCS = `${REPO}/blob/main`;
const NPM_PACKAGE = "https://www.npmjs.com/package/farcaster-in-three";
const CONTAINER_PACKAGE = "https://github.com/orgs/P-U-C/packages/container/package/farcaster-in-three";
const RELEASE = `${REPO}/releases/tag/v0.1.24`;
const LIVE_PROOF = `${DOCS}/docs/PROOF.md`;
const AGENT_PROMPT =
  "Set up In Three using https://farcaster.permanentupperclass.com/agent.md";

type InstallMethod = "npm" | "container";

const commandValues: Record<InstallMethod, readonly string[]> = {
  npm: ["in-three provision", "in-three node up", "in-three client create"],
  container: [
    "./in-three-container provision",
    "./in-three-container node up",
    "./in-three-container client create",
  ],
};

const installCommands: Record<InstallMethod, string> = {
  npm: "npm install --global farcaster-in-three\nmkdir in-three-node && cd in-three-node\nin-three doctor",
  container:
    "mkdir in-three-node && cd in-three-node\ncurl -fsSLO https://raw.githubusercontent.com/P-U-C/farcaster-in-three/v0.1.24/in-three-container\nchmod +x in-three-container\n./in-three-container doctor",
};

function initialLocale(): Locale {
  const query = new URLSearchParams(window.location.search).get("lang");
  if (query === "zh") return "zh";
  if (query === "en") return "en";
  return window.localStorage.getItem("in-three-locale") === "zh" ? "zh" : "en";
}

function openHetznerHelp() {
  const details = document.getElementById("hetzner-help");
  if (details instanceof HTMLDetailsElement) details.open = true;
}

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [installMethod, setInstallMethod] = useState<InstallMethod>("npm");
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const copy = messages[locale];
  const prefix =
    installMethod === "npm" ? "in-three" : "./in-three-container";
  const commands = copy.commands.map((item, index) => ({
    ...item,
    command: commandValues[installMethod][index] ?? "",
  }));
  const navigation = [
    { id: "start", label: copy.nav.start },
    { id: "after", label: copy.nav.after },
    { id: "help", label: copy.nav.help },
  ];
  const docIcons = [
    <BookOpen size={20} />,
    <ShieldCheck size={20} />,
    <Server size={20} />,
    <CheckCircle2 size={20} />,
    <Terminal size={20} />,
  ];
  const docHrefs = [
    `${DOCS}/docs/OPERATIONS.md`,
    `${DOCS}/SECURITY.md`,
    `${DOCS}/docs/ARCHITECTURE.md`,
    `${DOCS}/docs/PROOF.md`,
    `${DOCS}/docs/README.md`,
  ];

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.title = copy.meta.title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", copy.meta.description);
    document
      .querySelector('meta[property="og:title"]')
      ?.setAttribute("content", copy.meta.title);
    document
      .querySelector('meta[property="og:description"]')
      ?.setAttribute("content", copy.meta.description);
    document
      .querySelector('meta[name="twitter:title"]')
      ?.setAttribute("content", copy.meta.title);
    document
      .querySelector('meta[name="twitter:description"]')
      ?.setAttribute("content", copy.meta.description);
  }, [copy.meta.description, copy.meta.title, locale]);

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    window.localStorage.setItem("in-three-locale", nextLocale);
    const url = new URL(window.location.href);
    if (nextLocale === "en") url.searchParams.delete("lang");
    else url.searchParams.set("lang", nextLocale);
    window.history.replaceState({}, "", url);
  }

  return (
    <>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="In Three home">
          <img src="./profile.svg" alt="" width="36" height="36" />
          <strong>IN THREE</strong>
        </a>
        <nav aria-label={copy.nav.mainLabel}>
          {navigation.map((item) => (
            <a key={item.id} href={`#${item.id}`}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <LanguageSwitch
            locale={locale}
            onChange={changeLocale}
            label={copy.language.label}
            english={copy.language.english}
            chinese={copy.language.chinese}
          />
          <a
            className="github-link"
            href={REPO}
            target="_blank"
            rel="noreferrer"
          >
            <Github size={17} />
            <span>{copy.nav.source}</span>
          </a>
          <button
            className="menu-button"
            type="button"
            title={copy.nav.openMenu}
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={21} />
          </button>
        </div>
      </header>

      <nav className="package-bar" aria-label={copy.nav.packagesLabel}>
        <span className="package-bar-label">
          {copy.packages.get} <b>v0.1.24</b>
        </span>
        <div className="package-links">
          <PackageLink
            icon={<Package size={14} />}
            label="npm"
            detail={copy.packages.npmDetail}
            href={NPM_PACKAGE}
          />
          <PackageLink
            icon={<Container size={14} />}
            label="Docker"
            detail={copy.packages.dockerDetail}
            href={CONTAINER_PACKAGE}
          />
          <PackageLink
            icon={<Download size={14} />}
            label="Release"
            detail={copy.packages.releaseDetail}
            href={RELEASE}
          />
          <PackageLink
            icon={<CheckCircle2 size={14} />}
            label={copy.packages.proofLabel}
            detail={copy.packages.proofDetail}
            href={LIVE_PROOF}
          />
          <PackageLink
            icon={<Github size={14} />}
            label={copy.nav.source}
            detail={copy.packages.sourceDetail}
            href={REPO}
          />
        </div>
      </nav>

      {menuOpen && (
        <div className="mobile-menu">
          <header>
            <span>IN THREE</span>
            <button
              type="button"
              title={copy.nav.closeMenu}
              onClick={() => setMenuOpen(false)}
            >
              <X size={20} />
            </button>
          </header>
          {navigation.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
              <ChevronRight size={18} />
            </a>
          ))}
          <a href={REPO} target="_blank" rel="noreferrer">
            {copy.nav.source}
            <ExternalLink size={16} />
          </a>
        </div>
      )}

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="release-line">
              <img src="./profile.svg" alt="" width="54" height="54" />
              <span>{copy.hero.eyebrow}</span>
            </div>
            <h1>
              {copy.hero.titleLead}
              <br />
              <em>{copy.hero.titleAccent}</em>
            </h1>
            <p>{copy.hero.body}</p>
            <div className="hero-actions">
              <a className="primary-link" href="#start">
                {copy.hero.primary} <ArrowDown size={17} />
              </a>
              <a
                className="text-link"
                href={REPO}
                target="_blank"
                rel="noreferrer"
              >
                {copy.hero.secondary} <ArrowRight size={16} />
              </a>
            </div>
          </div>

          <div
            className="command-console"
            aria-label={copy.hero.consoleLabel}
          >
            <header>
              <span>{copy.hero.consolePath}</span>
              <b>{copy.hero.consoleLabel}</b>
            </header>
            {commands.map((item) => (
              <Command
                key={item.number}
                {...item}
                copyLabel={copy.ui.copyCommand}
                copiedLabel={copy.ui.copied}
              />
            ))}
            <footer>
              <span>
                <i /> {copy.hero.node}
              </span>
              <span>{copy.hero.client}</span>
            </footer>
          </div>
        </section>

        <section className="film-section" aria-labelledby="film-title">
          <div className="film-heading">
            <div>
              <span>{copy.film.eyebrow}</span>
              <h2 id="film-title">{copy.film.title}</h2>
            </div>
            <p>{copy.film.body}</p>
          </div>
          <div className="film-frame">
            <video
              key={locale}
              controls
              playsInline
              preload="metadata"
              poster="./in-three-film-poster.webp"
              aria-label={copy.film.playLabel}
            >
              <source src="./in-three-film.mp4" type="video/mp4" />
              <track
                default={locale === "en"}
                kind="captions"
                src="./in-three-film.en.vtt"
                srcLang="en"
                label="English"
              />
              <track
                default={locale === "zh"}
                kind="captions"
                src="./in-three-film.zh.vtt"
                srcLang="zh"
                label="中文"
              />
            </video>
          </div>
          <div className="film-footer">
            <span>
              <Captions size={17} /> {copy.film.caption}
            </span>
            <a href="./in-three-vertical.mp4" download>
              <Download size={16} /> {copy.film.vertical}
            </a>
          </div>
        </section>

        <section className="system-map" aria-labelledby="system-map-title">
          <div className="system-map-inner">
            <header className="system-map-heading">
              <span>{copy.system.eyebrow}</span>
              <h2 id="system-map-title">{copy.system.title}</h2>
              <p>{copy.system.body}</p>
            </header>

            <div className="system-flow" aria-label={copy.system.diagramLabel}>
              <div className="system-node">
                <Monitor size={28} aria-hidden="true" />
                <span>
                  <b>{copy.system.client}</b>
                  <small>{copy.system.clientDetail}</small>
                </span>
              </div>
              <div className="system-link">
                <span>
                  <ArrowLeft size={16} aria-hidden="true" />
                  {copy.system.read}
                </span>
                <span>
                  {copy.system.write}
                  <ArrowRight size={16} aria-hidden="true" />
                </span>
              </div>
              <div className="system-node owned-node">
                <img src="./profile.svg" alt="" width="34" height="34" />
                <span>
                  <b>{copy.system.node}</b>
                  <small>{copy.system.nodeDetail}</small>
                </span>
                <em>{copy.system.owned}</em>
              </div>
              <div className="system-link">
                <span>
                  <ArrowLeft size={16} aria-hidden="true" />
                  {copy.system.sync}
                </span>
                <span>
                  {copy.system.relay}
                  <ArrowRight size={16} aria-hidden="true" />
                </span>
              </div>
              <div className="system-node">
                <Network size={28} aria-hidden="true" />
                <span>
                  <b>{copy.system.network}</b>
                  <small>{copy.system.networkDetail}</small>
                </span>
              </div>
            </div>

            <div className="system-note">
              <KeyRound size={18} aria-hidden="true" />
              <p>{copy.system.note}</p>
              <a
                href={`${DOCS}/docs/ARCHITECTURE.md`}
                target="_blank"
                rel="noreferrer"
              >
                {copy.system.link} <ArrowRight size={14} />
              </a>
            </div>
          </div>
        </section>

        <section className="start section" id="start">
          <div className="section-intro">
            <span>{copy.start.eyebrow}</span>
            <h2>{copy.start.title}</h2>
            <p>
              {copy.start.body}{" "}
              <a
                className="hetzner-jump"
                href="#hetzner-help"
                onClick={openHetznerHelp}
              >
                {locale === "en" ? (
                  <>
                    Add <strong><code>--hetzner</code></strong> if you want In
                    Three to create one.
                  </>
                ) : (
                  <>
                    如果希望 In Three 自动创建机器，请添加{" "}
                    <strong><code>--hetzner</code></strong>。
                  </>
                )}
              </a>
            </p>
          </div>

          <div className="install-method-picker">
            <span>{copy.start.runWith}</span>
            <div
              className="install-method-switch"
              aria-label={copy.start.methodLabel}
            >
              <button
                className={installMethod === "npm" ? "active" : ""}
                type="button"
                aria-pressed={installMethod === "npm"}
                onClick={() => setInstallMethod("npm")}
              >
                <Package size={17} />
                <span>
                  <b>{copy.start.npmName}</b>
                  <small>{copy.start.npmDetail}</small>
                </span>
              </button>
              <button
                className={installMethod === "container" ? "active" : ""}
                type="button"
                aria-pressed={installMethod === "container"}
                onClick={() => setInstallMethod("container")}
              >
                <Container size={17} />
                <span>
                  <b>{copy.start.dockerName}</b>
                  <small>{copy.start.dockerDetail}</small>
                </span>
              </button>
            </div>
          </div>

          <div className="install-block">
            <span>{copy.start.install}</span>
            <CodeBlock
              code={installCommands[installMethod]}
              copyLabel={copy.ui.copyCommand}
              copiedLabel={copy.ui.copied}
            />
            <p>
              {copy.start.continueLead}{" "}
              <code>{copy.start.passed}</code>
            </p>
          </div>

          <div className="three-steps">
            {commands.map((item) => (
              <article key={item.number}>
                <header>
                  <b>{item.number}</b>
                  <span>{item.label}</span>
                </header>
                <CodeBlock
                  code={item.command}
                  copyLabel={copy.ui.copyCommand}
                  copiedLabel={copy.ui.copied}
                />
                <p>{item.detail}</p>
              </article>
            ))}
          </div>

          <div className="keep-note">
            <Terminal size={20} />
            <p>
              <b>{copy.start.keepTitle}</b> {copy.start.keepBody}
            </p>
          </div>
        </section>

        <section className="guided section-band">
          <div className="section">
            <div className="section-intro light">
              <span>{copy.guided.eyebrow}</span>
              <h2>{copy.guided.title}</h2>
              <p>
                {copy.guided.bodyLead} <code>CREATE</code>.{" "}
                {copy.guided.bodyTail}
              </p>
            </div>

            <ol className="guided-steps">
              {copy.guided.steps.map(([title, detail], index) => (
                <li key={title}>
                  <b>{index + 1}</b>
                  <span>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </span>
                </li>
              ))}
            </ol>

            <div className="safety-note">
              <KeyRound size={22} />
              <div>
                <strong>{copy.guided.safetyTitle}</strong>
                <p>{copy.guided.safetyBody}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="after section" id="after">
          <div className="section-intro">
            <span>{copy.after.eyebrow}</span>
            <h2>{copy.after.title}</h2>
            <p>{copy.after.body}</p>
          </div>

          <div className="after-layout">
            <ol>
              {copy.after.steps.map((step, index) => (
                <li key={step}>
                  <b>{index + 1}</b>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
            <figure>
              <img
                src="./client-preview.webp"
                alt={copy.after.previewAlt}
              />
              <figcaption>{copy.after.previewCaption}</figcaption>
            </figure>
          </div>

          <div className="finish-strip">
            {copy.after.finish.map(([title, command], index) => {
              const Icon = [Server, Download, X][index] ?? Server;
              return (
                <div key={title}>
                  <Icon size={20} />
                  <span>
                    <b>{title}</b>
                    <code>
                      {prefix} {command}
                    </code>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="help section" id="help">
          <div className="section-intro">
            <h2>{copy.help.title}</h2>
          </div>

          <div className="quick-answers">
            <Details id="hetzner-help" question={copy.help.hetznerQuestion}>
              <ol>
                {copy.help.hetznerSteps.map((step, index) => (
                  <li key={step}>
                    {index === 0 ? (
                      <a
                        href="https://console.hetzner.cloud/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {step}
                      </a>
                    ) : index === 3 ? (
                      <>
                        {copy.help.hetznerSteps[3].split("provision --hetzner")[0]}
                        <code>{prefix} provision --hetzner</code>
                        {copy.help.hetznerSteps[3].split("provision --hetzner")[1]}
                      </>
                    ) : (
                      step
                    )}
                  </li>
                ))}
              </ol>
              <p>
                <a
                  href="https://docs.hetzner.com/cloud/api/getting-started/generating-api-token/"
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.help.apiGuide}
                </a>{" "}
                ·{" "}
                <a
                  href="https://docs.hetzner.com/cloud/general/faq/#are-there-limits-to-the-number-of-resources-i-can-get"
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.help.quotaGuide}
                </a>
              </p>
            </Details>
            <Details id="self-healing-help" question={copy.help.healingQuestion}>
              <p>{copy.help.healingLead}</p>
              <ol className="healing-flow">
                {copy.help.healingSteps.map(([stage, detail]) => (
                  <li key={stage}>
                    <b>{stage}</b>
                    <span>{detail}</span>
                  </li>
                ))}
              </ol>
              <p>{copy.help.healingTail}</p>
              <p>
                <a
                  href="https://github.com/farcasterxyz/snapchain/issues/1044"
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.help.healingIssue}
                </a>{" "}
                ·{" "}
                <a
                  href="https://github.com/farcasterxyz/snapchain/pull/1065"
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.help.healingPr}
                </a>{" "}
                ·{" "}
                <a
                  href={`${DOCS}/docs/OPERATIONS.md#recover-one-stale-shard`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.help.healingGuide}
                </a>
              </p>
            </Details>
            <Details id="concepts-help" question={copy.help.conceptsQuestion}>
              <dl className="concept-list">
                {copy.help.concepts.map(([term, detail]) => (
                  <div key={term}>
                    <dt>{term}</dt>
                    <dd>{detail}</dd>
                  </div>
                ))}
              </dl>
            </Details>
            <Details question={copy.help.syncingQuestion}>
              {copy.help.syncingLead} <code>{prefix} node status</code>.{" "}
              {copy.help.syncingMiddle} <code>RECOVERY REQUIRED</code>,{" "}
              {copy.help.syncingTail}
            </Details>
            <Details question={copy.help.stoppedQuestion}>
              {copy.help.stoppedLead}{" "}
              <code>{prefix} client create</code>. {copy.help.stoppedTail}
            </Details>
            <Details question={copy.help.dockerQuestion}>
              {locale === "en" ? (
                <>
                  Select Docker above. For your own machine, put a dedicated SSH
                  key in this folder and pass{" "}
                  <code>--ssh-key /work/node-key</code> in step 1.
                </>
              ) : (
                <>
                  请在上方选择 Docker。使用自己的机器时，把专用 SSH
                  密钥放进这个目录，并在第 1 步传入{" "}
                  <code>--ssh-key /work/node-key</code>。
                </>
              )}
            </Details>
            <Details id="agent-help" question={copy.help.agentQuestion}>
              <p>{copy.help.agentBody}</p>
              <CodeBlock
                code={AGENT_PROMPT}
                copyLabel={copy.ui.copyCommand}
                copiedLabel={copy.ui.copied}
              />
              <p>
                <a href="./agent.md">{copy.help.agentGuide}</a>{" "}
                ·{" "}
                <a
                  href={`${DOCS}/docs/AGENT-API.md`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.help.agentCommerce}
                </a>
              </p>
            </Details>
          </div>

          <div className="docs-list">
            {copy.help.docs.map(([title, detail], index) => (
              <DocLink
                key={title}
                icon={docIcons[index]}
                title={title}
                detail={detail}
                href={docHrefs[index] ?? DOCS}
              />
            ))}
          </div>
        </section>

        <section className="final-cta">
          <img src="./profile.svg" alt="" width="58" height="58" />
          <div>
            <span>{copy.final.eyebrow}</span>
            <h2>{copy.final.title}</h2>
          </div>
          <a href="#start">
            {copy.final.action} <ArrowRight size={18} />
          </a>
        </section>
      </main>

      <footer className="site-footer">
        <span>IN THREE</span>
        <p>{copy.footer.built}</p>
        <a href={REPO} target="_blank" rel="noreferrer">
          {copy.footer.source} <ExternalLink size={13} />
        </a>
      </footer>
    </>
  );
}

function LanguageSwitch({
  locale,
  onChange,
  label,
  english,
  chinese,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
  label: string;
  english: string;
  chinese: string;
}) {
  return (
    <div className="language-switch" role="group" aria-label={label}>
      <Languages size={15} aria-hidden="true" />
      <button
        type="button"
        aria-pressed={locale === "en"}
        className={locale === "en" ? "active" : ""}
        onClick={() => onChange("en")}
      >
        {english}
      </button>
      <button
        type="button"
        aria-pressed={locale === "zh"}
        className={locale === "zh" ? "active" : ""}
        onClick={() => onChange("zh")}
      >
        {chinese}
      </button>
    </div>
  );
}

function Command({
  number,
  label,
  command,
  copyLabel,
  copiedLabel,
}: {
  number: string;
  label: string;
  command: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="console-command">
      <span className="command-number">{number}</span>
      <div>
        <small>{label}</small>
        <code>
          <i>$</i> {command}
        </code>
      </div>
      <button
        type="button"
        title={copied ? copiedLabel : `${copyLabel}: ${label}`}
        onClick={async () => {
          await navigator.clipboard.writeText(command);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={16} /> : <Clipboard size={16} />}
      </button>
    </div>
  );
}

function CodeBlock({
  code,
  copyLabel,
  copiedLabel,
}: {
  code: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block">
      <code>{code}</code>
      <button
        type="button"
        title={copied ? copiedLabel : copyLabel}
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? <Check size={16} /> : <Clipboard size={16} />}
      </button>
    </div>
  );
}

function PackageLink({
  icon,
  label,
  detail,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  href: string;
}) {
  return (
    <a
      className="package-pill"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {icon}
      <b>{label}</b>
      <small>{detail}</small>
      <ExternalLink size={12} />
    </a>
  );
}

function Details({
  id,
  question,
  children,
}: {
  id?: string;
  question: string;
  children: React.ReactNode;
}) {
  return (
    <details id={id}>
      <summary>
        {question}
        <span>+</span>
      </summary>
      <div className="details-body">{children}</div>
    </details>
  );
}

function DocLink({
  icon,
  title,
  detail,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  href: string;
}) {
  return (
    <a
      className="doc-link"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {icon}
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <ArrowRight size={16} />
    </a>
  );
}

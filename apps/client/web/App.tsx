import {
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  Filter,
  Heart,
  Home,
  LoaderCircle,
  LogOut,
  PenLine,
  Plus,
  RefreshCw,
  Repeat2,
  Send,
  Server,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

interface Profile {
  fid: number;
  username: string;
  displayName: string;
  bio: string;
  pfpUrl: string | null;
}

interface Cast {
  fid: number;
  hash: string;
  text: string;
  timestamp: string;
  signer: string;
  profile: Profile;
  embeds: Array<{ url?: string }>;
}

interface Source {
  signer: string;
  requestFid: number | null;
  label: string;
  isThisClient: boolean;
}

interface Me {
  profile: Profile;
  storage: {
    limits?: Array<{ name?: string; limit?: number; used?: number }>;
    units?: number;
  };
  node: Record<string, unknown>;
  fid: number;
  signer: string;
}

type AuthState = "checking" | "signed-out" | "signed-in";

export function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [me, setMe] = useState<Me | null>(null);
  const [casts, setCasts] = useState<Cast[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadingFeed(true);
    try {
      const [meData, feedData] = await Promise.all([
        api<Me>("/api/me"),
        api<{ casts: Cast[] }>("/api/feed"),
      ]);
      setMe(meData);
      setCasts(feedData.casts);
      setAuth("signed-in");
      const sourceData = await api<{ sources: Source[] }>("/api/sources");
      setSources(dedupeSources(sourceData.sources));
    } catch (error) {
      if (isUnauthorized(error)) setAuth("signed-out");
      else setNotice(errorMessage(error));
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleCasts = useMemo(
    () => casts.filter((cast) => !excluded.has(cast.signer)),
    [casts, excluded],
  );

  if (auth === "checking") return <Splash />;
  if (auth === "signed-out") {
    return (
      <Login
        onSuccess={() => {
          setAuth("checking");
          void load();
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="primary-nav" aria-label="Primary">
          <button className="nav-item active" type="button">
            <Home size={19} aria-hidden="true" />
            <span>Home</span>
          </button>
          <button className="nav-item" type="button" onClick={() => setFiltersOpen(true)}>
            <Filter size={19} aria-hidden="true" />
            <span>Sources</span>
            {excluded.size > 0 && <b>{excluded.size}</b>}
          </button>
          <a
            className="nav-item"
            href="https://p-u-c.github.io/farcaster-in-three/"
            target="_blank"
            rel="noreferrer"
          >
            <Server size={19} aria-hidden="true" />
            <span>Node guide</span>
          </a>
        </nav>

        <div className="node-panel">
          <div className="node-heading">
            <span className="status-dot" />
            <span>OWN NODE</span>
          </div>
          <strong>Snapchain online</strong>
          <p>FID {me?.fid ?? "—"} · {me?.storage.units ?? 0} storage units</p>
        </div>

        <button
          className="profile-row"
          type="button"
          onClick={async () => {
            await api("/api/logout", { method: "POST" });
            setAuth("signed-out");
          }}
          title="Sign out"
        >
          <Avatar profile={me!.profile} />
          <span>
            <strong>{me?.profile.displayName}</strong>
            <small>@{me?.profile.username}</small>
          </span>
          <LogOut size={17} aria-hidden="true" />
        </button>
      </aside>

      <main className="timeline">
        <header className="timeline-header">
          <div>
            <span className="eyebrow">YOUR NETWORK</span>
            <h1>Home</h1>
          </div>
          <div className="header-actions">
            <button
              className="icon-button"
              type="button"
              title="Refresh feed"
              onClick={() => void load()}
              disabled={loadingFeed}
            >
              <RefreshCw size={19} className={loadingFeed ? "spin" : ""} />
            </button>
            <button className="publish-button" type="button" onClick={() => setComposerOpen(true)}>
              <PenLine size={18} />
              <span>New cast</span>
            </button>
          </div>
        </header>

        <ComposerPrompt profile={me!.profile} onOpen={() => setComposerOpen(true)} />

        <div className="feed-meta">
          <span>{visibleCasts.length} recent casts</span>
          {excluded.size > 0 && (
            <button type="button" onClick={() => setExcluded(new Set())}>
              Show all sources
            </button>
          )}
        </div>

        <section className="feed" aria-live="polite">
          {loadingFeed && casts.length === 0 ? (
            <FeedSkeleton />
          ) : visibleCasts.length === 0 ? (
            <div className="empty-state">
              <EyeOff size={24} />
              <strong>No casts match these source filters.</strong>
              <button type="button" onClick={() => setExcluded(new Set())}>Reset filters</button>
            </div>
          ) : (
            visibleCasts.map((cast) => (
              <CastRow
                key={`${cast.fid}:${cast.hash}`}
                cast={cast}
                source={sources.find((source) => source.signer === cast.signer)}
                onNotice={setNotice}
              />
            ))
          )}
        </section>
      </main>

      <aside className="context-rail">
        <SourcePanel
          sources={sources}
          excluded={excluded}
          onToggle={(signer) => setExcluded(toggleSet(excluded, signer))}
        />
        <FollowPanel onDone={(message) => { setNotice(message); void load(); }} />
        <ProtocolPanel />
      </aside>

      <nav className="mobile-nav" aria-label="Mobile">
        <button className="active" type="button" title="Home"><Home size={21} /></button>
        <button type="button" title="Sources" onClick={() => setFiltersOpen(true)}><Filter size={21} /></button>
        <button className="mobile-compose" type="button" title="New cast" onClick={() => setComposerOpen(true)}><Plus size={23} /></button>
        <button type="button" title="Refresh" onClick={() => void load()}><RefreshCw size={21} /></button>
        <button type="button" title="Sign out" onClick={async () => { await api("/api/logout", { method: "POST" }); setAuth("signed-out"); }}><LogOut size={21} /></button>
      </nav>

      {composerOpen && (
        <Composer
          profile={me!.profile}
          onClose={() => setComposerOpen(false)}
          onPublished={(message) => {
            setComposerOpen(false);
            setNotice(message);
            setTimeout(() => void load(), 1500);
          }}
        />
      )}

      {filtersOpen && (
        <MobileFilters
          sources={sources}
          excluded={excluded}
          onToggle={(signer) => setExcluded(toggleSet(excluded, signer))}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {notice && <Toast message={notice} onClose={() => setNotice(null)} />}
    </div>
  );
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      onSuccess();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <div className="login-brand"><Brand /></div>
      <form className="login-form" onSubmit={submit}>
        <div className="login-mark"><Server size={24} /></div>
        <span className="eyebrow">PRIVATE CLIENT</span>
        <h1>Enter your node.</h1>
        <label htmlFor="password">Client password</label>
        <div className="password-field">
          <input
            id="password"
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
          <button type="button" title={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)}>
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {error && <p className="form-error"><CircleAlert size={15} /> {error}</p>}
        <button className="login-button" type="submit" disabled={busy || !password}>
          {busy ? <LoaderCircle className="spin" size={18} /> : <span>Open client</span>}
        </button>
      </form>
      <p className="login-foot">Custody key absent · App key revocable</p>
    </main>
  );
}

function Brand() {
  return (
    <a className="brand" href="/" aria-label="In Three home">
      <span className="brand-mark">III</span>
      <span><strong>IN THREE</strong><small>FARCASTER CLIENT</small></span>
    </a>
  );
}

function ComposerPrompt({ profile, onOpen }: { profile: Profile; onOpen: () => void }) {
  return (
    <button className="composer-prompt" type="button" onClick={onOpen}>
      <Avatar profile={profile} />
      <span>What’s happening?</span>
      <PenLine size={18} />
    </button>
  );
}

function CastRow({
  cast,
  source,
  onNotice,
}: {
  cast: Cast;
  source?: Source;
  onNotice: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function react(type: "like" | "recast") {
    setBusy(type);
    try {
      await api("/api/reactions", {
        method: "POST",
        body: JSON.stringify({
          type,
          targetFid: cast.fid,
          targetHash: cast.hash,
          remove: false,
        }),
      });
      onNotice(type === "like" ? "Liked through your app key" : "Recast submitted");
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="cast-row">
      <Avatar profile={cast.profile} />
      <div className="cast-content">
        <header>
          <strong>{cast.profile.displayName}</strong>
          <span>@{cast.profile.username}</span>
          <i>·</i>
          <time dateTime={cast.timestamp}>{relativeTime(cast.timestamp)}</time>
          {source && <span className={source.isThisClient ? "source own" : "source"}>{source.label}</span>}
        </header>
        <p>{cast.text}</p>
        {cast.embeds.map((embed) =>
          embed.url ? (
            <a className="cast-embed" href={embed.url} target="_blank" rel="noreferrer" key={embed.url}>
              {safeHostname(embed.url)}
              <small>{embed.url}</small>
            </a>
          ) : null,
        )}
        <footer>
          <button type="button" title="Like" onClick={() => void react("like")} disabled={busy !== null}>
            {busy === "like" ? <LoaderCircle className="spin" size={17} /> : <Heart size={17} />}
          </button>
          <button type="button" title="Recast" onClick={() => void react("recast")} disabled={busy !== null}>
            {busy === "recast" ? <LoaderCircle className="spin" size={17} /> : <Repeat2 size={17} />}
          </button>
          <button type="button" title="Reply" onClick={() => onNotice("Reply composer is next in the queue")}>
            <PenLine size={17} />
          </button>
          <code>{cast.hash.slice(0, 8)}</code>
        </footer>
      </div>
    </article>
  );
}

function Composer({
  profile,
  onClose,
  onPublished,
}: {
  profile: Profile;
  onClose: () => void;
  onPublished: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [embedUrl, setEmbedUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function publish(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ hash: string }>("/api/casts", {
        method: "POST",
        body: JSON.stringify({
          text,
          ...(embedUrl ? { embedUrl } : {}),
        }),
      });
      onPublished(`Cast submitted · ${result.hash.slice(0, 10)}`);
    } catch (error) {
      onPublished(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="composer-modal" onSubmit={publish} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span>New cast</span>
          <button type="button" title="Close composer" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="composer-body">
          <Avatar profile={profile} />
          <div>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="What’s happening?"
              maxLength={1024}
              autoFocus
            />
            <input
              type="url"
              value={embedUrl}
              onChange={(event) => setEmbedUrl(event.target.value)}
              placeholder="https:// optional link"
            />
          </div>
        </div>
        <footer>
          <span className={text.length > 960 ? "near-limit" : ""}>{text.length} / 1024</span>
          <button type="submit" disabled={!text.trim() || busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
            Publish
          </button>
        </footer>
      </form>
    </div>
  );
}

function SourcePanel({
  sources,
  excluded,
  onToggle,
}: {
  sources: Source[];
  excluded: Set<string>;
  onToggle: (signer: string) => void;
}) {
  return (
    <section className="rail-section">
      <header><div><span className="eyebrow">CAST SOURCES</span><h2>Client filter</h2></div><Filter size={18} /></header>
      <div className="source-list">
        {sources.slice(0, 7).map((source) => {
          const included = !excluded.has(source.signer);
          return (
            <button type="button" key={source.signer} onClick={() => onToggle(source.signer)}>
              <span className={source.isThisClient ? "source-icon own" : "source-icon"}>{source.label.charAt(0).toUpperCase()}</span>
              <span><strong>{source.label}</strong><small>{source.requestFid ? `FID ${source.requestFid}` : shortKey(source.signer)}</small></span>
              <i className={included ? "check on" : "check"}>{included && <Check size={13} />}</i>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MobileFilters(props: Parameters<typeof SourcePanel>[0] & { onClose: () => void }) {
  return (
    <div className="mobile-sheet-backdrop" onMouseDown={props.onClose}>
      <div className="mobile-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <header><strong>Client filter</strong><button type="button" title="Close" onClick={props.onClose}><X size={20} /></button></header>
        <SourcePanel sources={props.sources} excluded={props.excluded} onToggle={props.onToggle} />
      </div>
    </div>
  );
}

function FollowPanel({ onDone }: { onDone: (message: string) => void }) {
  const [fid, setFid] = useState("");
  const [busy, setBusy] = useState(false);

  async function follow(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/api/follows", {
        method: "POST",
        body: JSON.stringify({ targetFid: Number(fid), remove: false }),
      });
      setFid("");
      onDone(`Following FID ${fid}`);
    } catch (error) {
      onDone(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rail-section follow-panel">
      <header><div><span className="eyebrow">NETWORK</span><h2>Follow an FID</h2></div><Users size={18} /></header>
      <form onSubmit={follow}>
        <label htmlFor="follow-fid">FID</label>
        <input id="follow-fid" inputMode="numeric" pattern="[0-9]*" value={fid} onChange={(event) => setFid(event.target.value)} placeholder="e.g. 37" />
        <button type="submit" title="Follow FID" disabled={!fid || busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <UserPlus size={17} />}</button>
      </form>
    </section>
  );
}

function ProtocolPanel() {
  return (
    <section className="protocol-panel">
      <span className="status-dot" />
      <div><strong>Protocol direct</strong><small>Read node → validator</small></div>
    </section>
  );
}

function Avatar({ profile }: { profile: Profile }) {
  if (profile.pfpUrl) return <img className="avatar" src={profile.pfpUrl} alt="" loading="lazy" />;
  return <span className="avatar fallback">{profile.displayName.charAt(0).toUpperCase()}</span>;
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timeout = window.setTimeout(onClose, 4500);
    return () => window.clearTimeout(timeout);
  }, [onClose]);

  return <div className="toast"><Check size={16} /><span>{message}</span><button type="button" title="Dismiss" onClick={onClose}><X size={16} /></button></div>;
}

function Splash() {
  return <main className="splash"><Brand /><LoaderCircle className="spin" size={22} /></main>;
}

function FeedSkeleton() {
  return <>{[1, 2, 3, 4].map((item) => <div className="skeleton-row" key={item}><i /><span><b /><b /><b /></span></div>)}</>;
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    const error = new Error(data.error ?? `HTTP ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data as T;
}

function dedupeSources(sources: Source[]): Source[] {
  return [...new Map(sources.map((source) => [source.signer, source])).values()];
}

function toggleSet(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof Error && "status" in error && (error as Error & { status?: number }).status === 401;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "Attached link";
  }
}

function shortKey(key: string): string {
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

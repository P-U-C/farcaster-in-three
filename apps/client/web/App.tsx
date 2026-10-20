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
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { FARCASTER_CAST_MAX_BYTES } from "../src/limits.js";
import {
  groupSources,
  toggleSourceGroup,
  type CastSource as Source,
} from "./sources.js";

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
  const [followOpen, setFollowOpen] = useState(false);
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
      setSources(sourceData.sources);
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
            href="https://farcaster.permanentupperclass.com/"
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
            <button
              className="follow-button"
              type="button"
              onClick={() => setFollowOpen(true)}
            >
              <UserPlus size={18} />
              <span>Follow</span>
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
          onToggle={(signers) => setExcluded(toggleSourceGroup(excluded, signers))}
        />
        <FollowPanel inputId="follow-fid-rail" onDone={(message) => { setNotice(message); void load(); }} />
        <ProtocolPanel />
      </aside>

      <nav className="mobile-nav" aria-label="Mobile">
        <button className="active" type="button" title="Home"><Home size={21} /></button>
        <button type="button" title="Sources" onClick={() => setFiltersOpen(true)}><Filter size={21} /></button>
        <button className="mobile-compose" type="button" title="New cast" onClick={() => setComposerOpen(true)}><Plus size={23} /></button>
        <button type="button" title="Follow an FID" onClick={() => setFollowOpen(true)}><UserPlus size={21} /></button>
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
          onToggle={(signers) => setExcluded(toggleSourceGroup(excluded, signers))}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {followOpen && (
        <FollowSheet
          onClose={() => setFollowOpen(false)}
          onDone={(message) => {
            setFollowOpen(false);
            setNotice(message);
            void load();
          }}
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
  const [activeReactions, setActiveReactions] = useState({ like: false, recast: false });

  async function react(type: "like" | "recast") {
    const remove = activeReactions[type];
    setBusy(type);
    try {
      const result = await api<{ hash: string }>("/api/reactions", {
        method: "POST",
        body: JSON.stringify({
          type,
          targetFid: cast.fid,
          targetHash: cast.hash,
          remove,
        }),
      });
      setActiveReactions((current) => ({ ...current, [type]: !remove }));
      const label = type === "like" ? "Like" : "Recast";
      onNotice(`${label}${remove ? " removed" : ""} · ${result.hash.slice(0, 10)}`);
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
          <button
            className={activeReactions.like ? "active" : ""}
            type="button"
            title={activeReactions.like ? "Remove like" : "Like"}
            aria-pressed={activeReactions.like}
            onClick={() => void react("like")}
            disabled={busy !== null}
          >
            {busy === "like" ? <LoaderCircle className="spin" size={17} /> : <Heart size={17} />}
          </button>
          <button
            className={activeReactions.recast ? "active" : ""}
            type="button"
            title={activeReactions.recast ? "Remove recast" : "Recast"}
            aria-pressed={activeReactions.recast}
            onClick={() => void react("recast")}
            disabled={busy !== null}
          >
            {busy === "recast" ? <LoaderCircle className="spin" size={17} /> : <Repeat2 size={17} />}
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
  const textBytes = useMemo(
    () => new TextEncoder().encode(text.trim()).byteLength,
    [text],
  );
  const textIsTooLong = textBytes > FARCASTER_CAST_MAX_BYTES;

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
      onPublished(`Cast accepted for relay · ${result.hash.slice(0, 10)}`);
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
              maxLength={FARCASTER_CAST_MAX_BYTES}
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
          <span className={textBytes > 280 ? "near-limit" : ""}>
            {textBytes} / {FARCASTER_CAST_MAX_BYTES} bytes
          </span>
          <button type="submit" disabled={!text.trim() || textIsTooLong || busy}>
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
  onToggle: (signers: string[]) => void;
}) {
  const groups = groupSources(sources);
  return (
    <section className="rail-section source-panel">
      <header><div><span className="eyebrow">CAST SOURCES</span><h2>Source filter</h2></div><Filter size={18} /></header>
      <p className="source-help">Known apps are grouped by requesting FID. Unattributed keys remain separate.</p>
      <div className="source-list">
        {groups.map((group) => {
          const signerKeys = group.signers.map((source) => source.signer);
          const included = signerKeys.every((signer) => !excluded.has(signer));
          const detail = group.requestFid
            ? `FID ${group.requestFid} · ${signerKeys.length} ${signerKeys.length === 1 ? "key" : "keys"}`
            : shortKey(signerKeys[0] ?? "");
          return (
            <button
              type="button"
              key={group.id}
              title={group.requestFid ? undefined : signerKeys[0]}
              aria-pressed={included}
              onClick={() => onToggle(signerKeys)}
            >
              <span className={group.isThisClient ? "source-icon own" : "source-icon"}>{group.label.charAt(0).toUpperCase()}</span>
              <span><strong>{group.label}</strong><small>{detail}</small></span>
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
      <div className="mobile-sheet" role="dialog" aria-modal="true" aria-label="Source filter" onMouseDown={(event) => event.stopPropagation()}>
        <header><strong>Source filter</strong><button type="button" title="Close" onClick={props.onClose}><X size={20} /></button></header>
        <SourcePanel sources={props.sources} excluded={props.excluded} onToggle={props.onToggle} />
      </div>
    </div>
  );
}

function FollowSheet({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  return (
    <div className="mobile-sheet-backdrop" onMouseDown={onClose}>
      <div className="mobile-sheet follow-sheet" role="dialog" aria-modal="true" aria-label="Follow an FID" onMouseDown={(event) => event.stopPropagation()}>
        <header><strong>Follow an FID</strong><button type="button" title="Close" onClick={onClose}><X size={20} /></button></header>
        <FollowPanel inputId="follow-fid-sheet" onDone={onDone} />
      </div>
    </div>
  );
}

function FollowPanel({ inputId, onDone }: { inputId: string; onDone: (message: string) => void }) {
  const [fid, setFid] = useState("");
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  async function follow(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ hash: string }>("/api/follows", {
        method: "POST",
        body: JSON.stringify({ targetFid: Number(fid), remove }),
      });
      const targetFid = fid;
      setFid("");
      onDone(`${remove ? "Unfollow" : "Follow"} · FID ${targetFid} · ${result.hash.slice(0, 10)}`);
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
        <div className="follow-mode" aria-label="Follow action">
          <button type="button" className={!remove ? "active" : ""} aria-pressed={!remove} onClick={() => setRemove(false)}>Follow</button>
          <button type="button" className={remove ? "active" : ""} aria-pressed={remove} onClick={() => setRemove(true)}>Unfollow</button>
        </div>
        <label htmlFor={inputId}>FID</label>
        <input id={inputId} inputMode="numeric" pattern="[0-9]*" value={fid} onChange={(event) => setFid(event.target.value)} placeholder="e.g. 37" />
        <button className="follow-submit" type="submit" title={`${remove ? "Unfollow" : "Follow"} FID`} disabled={!fid || busy}>
          {busy ? <LoaderCircle className="spin" size={17} /> : remove ? <UserMinus size={17} /> : <UserPlus size={17} />}
        </button>
      </form>
    </section>
  );
}

function ProtocolPanel() {
  return (
    <section className="protocol-panel">
      <span className="status-dot" />
      <div>
        <strong>Read</strong><small>Client service → own node</small>
        <strong>Write</strong><small>Client → your node → validator gossip</small>
      </div>
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

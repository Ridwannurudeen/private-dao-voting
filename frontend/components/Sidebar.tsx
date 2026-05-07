import { DEVELOPMENT_MODE } from "../lib/arcium";

interface SidebarProps {
  arciumClient: any;
  connected: boolean;
  activeSection?: string;
  onNavigate?: (section: string) => void;
  onOpenDrawer?: () => void;
}

const NAV_ITEMS = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    id: "proposals",
    label: "Proposals",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
];

export function Sidebar({
  arciumClient,
  connected: _connected,
  activeSection = "dashboard",
  onNavigate,
  onOpenDrawer,
}: SidebarProps) {
  const status = arciumClient
    ? arciumClient.isFallback()
      ? { label: "Awaiting MXE", tone: "warn" as const }
      : { label: "MXE Active", tone: "ok" as const }
    : DEVELOPMENT_MODE
    ? { label: "Dev Mode", tone: "warn" as const }
    : { label: "MXE Offline", tone: "crit" as const };

  return (
    <div className="flex flex-col h-full">
      {/* Mark */}
      <div className="p-5 pb-4">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="shrink-0 flex items-center justify-center"
            style={{
              width: 28, height: 28, borderRadius: 6,
              background: "var(--ink-2)", border: "1px solid var(--ink-4)",
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 999, background: "var(--seal)", boxShadow: "0 0 0 2px var(--seal-soft)" }} />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="font-display text-paper-0 text-[15px] tracking-tighter">Private DAO</div>
            <div className="h-meta">arcium · sol</div>
          </div>
        </div>
      </div>

      {/* Section divider */}
      <div className="px-3 mt-2">
        <div className="h-eyebrow px-2 mb-2">Navigate</div>
      </div>

      {/* Navigation */}
      <nav className="px-3 space-y-0.5">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              onNavigate?.(item.id);
              const el = document.getElementById(`section-${item.id}`);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              else window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className={`sidebar-nav-item w-full ${activeSection === item.id ? "active" : ""}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}

        {onOpenDrawer && (
          <button onClick={onOpenDrawer} className="sidebar-nav-item w-full">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>How it works</span>
          </button>
        )}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* MXE Status */}
      <div className="px-4 pb-4 space-y-3">
        <div className="panel-hairline px-3 py-3">
          <div className="h-eyebrow mb-2">Cluster</div>
          <div className="flex items-center gap-2">
            <span
              className={status.tone === "ok" ? "seal-dot seal-dot-pulse" : ""}
              aria-hidden="true"
              style={
                status.tone === "ok"
                  ? { background: "var(--reveal)", boxShadow: "0 0 0 3px var(--reveal-soft)" }
                  : status.tone === "warn"
                  ? { width: 8, height: 8, borderRadius: 999, background: "var(--steel)", boxShadow: "0 0 0 3px var(--steel-soft)", display: "inline-block" }
                  : { width: 8, height: 8, borderRadius: 999, background: "var(--crit)", boxShadow: "0 0 0 3px var(--crit-soft)", display: "inline-block" }
              }
            />
            <span className="font-mono text-[11px] text-paper-1 tracking-wide">
              {status.label}
            </span>
          </div>
        </div>

        {/* Keyboard shortcuts */}
        <div className="hidden lg:flex items-center gap-2 text-[10px] px-1 flex-wrap" style={{ color: "var(--paper-3)" }}>
          <span><Kbd>N</Kbd> New</span>
          <span><Kbd>R</Kbd> Refresh</span>
          <span><Kbd>D</Kbd> Debug</span>
          <span><Kbd>Esc</Kbd> Close</span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="font-mono"
      style={{
        padding: "1px 5px",
        background: "var(--ink-2)",
        border: "1px solid var(--ink-4)",
        borderRadius: 4,
        color: "var(--paper-2)",
        fontSize: 9,
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </kbd>
  );
}

import { ShieldCheckIcon } from "./Icons";
import { getMempoolCapacity, DEVNET_CLUSTER_OFFSET, DEVELOPMENT_MODE } from "../lib/arcium";

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
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    id: "proposals",
    label: "Proposals",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
];

const CAPACITY_COLORS: Record<string, string> = {
  Tiny: "text-gray-400 bg-gray-500/10 border-gray-500/20",
  Small: "text-green-400 bg-green-500/10 border-green-500/20",
  Medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  Large: "text-red-400 bg-red-500/10 border-red-500/20",
};

export function Sidebar({
  arciumClient,
  connected,
  activeSection = "dashboard",
  onNavigate,
  onOpenDrawer,
}: SidebarProps) {
  const capacity = getMempoolCapacity();
  const capacityColor = CAPACITY_COLORS[capacity] || CAPACITY_COLORS.Tiny;

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-5 pb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 glow-purple"
            style={{ background: "linear-gradient(135deg, rgba(147,51,234,0.3), rgba(34,211,238,0.2))" }}
          >
            <ShieldCheckIcon className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-white truncate">Private DAO</h1>
            <p className="text-[9px] text-gray-500 tracking-[0.15em] uppercase">Powered by Arcium</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="px-3 space-y-1">
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

        {/* Learn button */}
        {onOpenDrawer && (
          <button onClick={onOpenDrawer} className="sidebar-nav-item w-full">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>How It Works</span>
          </button>
        )}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* MXE Heartbeat Monitor */}
      <div className="px-4 pb-4 space-y-3">
        <div className="glass-card p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">MXE Status</span>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  arciumClient
                    ? "bg-green-400 animate-heartbeat"
                    : DEVELOPMENT_MODE
                    ? "bg-yellow-400 animate-pulse"
                    : "bg-red-400"
                }`}
              />
              <span className={`text-[10px] font-medium ${
                arciumClient ? "text-green-400" : DEVELOPMENT_MODE ? "text-yellow-400" : "text-red-400"
              }`}>
                {arciumClient ? "Active" : DEVELOPMENT_MODE ? "Dev Mode" : "Offline"}
              </span>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white/[0.02] rounded-lg p-2">
              <p className="text-[9px] text-gray-600 uppercase">Arx Nodes</p>
              <p className="text-sm font-semibold text-white">5</p>
            </div>
            <div className="bg-white/[0.02] rounded-lg p-2">
              <p className="text-[9px] text-gray-600 uppercase">MPC Epoch</p>
              <p className="text-sm font-semibold text-white font-mono">
                {DEVNET_CLUSTER_OFFSET.toString().slice(0, 6)}
              </p>
            </div>
          </div>

          {/* Mempool Capacity */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-500">Mempool</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${capacityColor}`}>
              {capacity}
            </span>
          </div>
        </div>

        {/* Keyboard shortcuts */}
        <div className="hidden lg:flex items-center gap-2 text-[9px] text-gray-600 px-1">
          <span><kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-gray-500">N</kbd> New</span>
          <span><kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-gray-500">R</kbd> Refresh</span>
          <span><kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-gray-500">Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}

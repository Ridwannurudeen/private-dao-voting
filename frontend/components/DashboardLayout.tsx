import { ReactNode } from "react";

interface DashboardLayoutProps {
  sidebar: ReactNode;
  rightPanel: ReactNode;
  children: ReactNode;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function DashboardLayout({
  sidebar,
  rightPanel,
  children,
  sidebarOpen,
  onToggleSidebar,
}: DashboardLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onToggleSidebar}
        />
      )}

      {/* Left sidebar */}
      <aside
        className={`sidebar fixed lg:static inset-y-0 left-0 z-50 w-60 shrink-0 flex flex-col overflow-y-auto transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebar}
      </aside>

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto min-w-0">
        {/* Mobile hamburger */}
        <button
          onClick={onToggleSidebar}
          className="lg:hidden fixed top-3 left-3 z-40 w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all"
          aria-label="Toggle sidebar"
        >
          <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>

        {children}
      </div>

      {/* Right panel — hidden on mobile, shown on xl */}
      <aside className="right-panel hidden xl:block w-80 shrink-0 overflow-y-auto">
        <div className="p-4 space-y-4">
          {rightPanel}
        </div>
      </aside>
    </div>
  );
}

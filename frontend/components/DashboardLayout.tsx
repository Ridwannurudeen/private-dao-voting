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
    <div className="flex h-screen overflow-hidden max-w-[100vw] bg-page">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          style={{ background: "rgba(0,0,0,0.65)" }}
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
          className="lg:hidden fixed top-3 left-3 z-40 w-10 h-10 flex items-center justify-center transition-colors"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--ink-3)",
            borderRadius: 6,
            color: "var(--paper-1)",
          }}
          aria-label="Toggle sidebar"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
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

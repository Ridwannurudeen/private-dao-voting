import { useEffect } from "react";

export type ToastType = "success" | "error" | "info";

export interface ToastData {
  message: string;
  type: ToastType;
  txUrl?: string;
}

export function Toast({ message, type, txUrl, onClose }: { message: string; type: ToastType; txUrl?: string; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const tones: Record<ToastType, { color: string; border: string; bg: string; icon: string }> = {
    success: { color: "var(--reveal)", border: "var(--reveal-line)", bg: "var(--reveal-soft)", icon: "✓" },
    error: { color: "var(--crit)", border: "var(--crit-soft)", bg: "var(--crit-soft)", icon: "✕" },
    info: { color: "var(--seal)", border: "var(--seal-line)", bg: "var(--seal-soft)", icon: "·" },
  };
  const t = tones[type];

  return (
    <div
      className="fixed bottom-6 right-6 z-50 px-4 py-3 flex items-start gap-3 max-w-md drawer-enter"
      style={{
        background: "var(--ink-1)",
        border: `1px solid ${t.border}`,
        borderRadius: 6,
        boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
      }}
    >
      <span className="font-mono text-[14px] leading-none mt-0.5 shrink-0" style={{ color: t.color }}>
        {t.icon}
      </span>
      <div className="flex-1 min-w-0">
        <span className="text-[13.5px] text-paper-1 leading-snug block">{message}</span>
        {txUrl && (
          <a
            href={txUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[10.5px] mt-1 inline-block transition-colors"
            style={{ color: "var(--paper-3)" }}
          >
            <span className="hover:text-seal">view tx ↗</span>
          </a>
        )}
      </div>
      <button
        onClick={onClose}
        className="shrink-0 transition-colors"
        style={{ color: "var(--paper-3)" }}
        aria-label="Close"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>
  );
}

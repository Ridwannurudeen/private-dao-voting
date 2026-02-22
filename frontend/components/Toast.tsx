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

  const styles: Record<string, { bg: string; icon: string }> = {
    success: {
      bg: "bg-green-500/10 border-green-500/20 text-green-400 shadow-[0_8px_32px_rgba(34,197,94,0.15)]",
      icon: "\u2713",
    },
    error: {
      bg: "bg-red-500/10 border-red-500/20 text-red-400 shadow-[0_8px_32px_rgba(239,68,68,0.15)]",
      icon: "\u2715",
    },
    info: {
      bg: "bg-cyan-500/10 border-cyan-500/20 text-cyan-400 shadow-[0_8px_32px_rgba(34,211,238,0.15)]",
      icon: "\u2139",
    },
  };

  const s = styles[type];

  return (
    <div className={`fixed bottom-6 right-6 z-50 backdrop-blur-xl rounded-2xl border px-5 py-4 flex items-center gap-3 max-w-md animate-[slideUp_0.3s_ease-out] ${s.bg}`}>
      <span className="text-lg shrink-0">{s.icon}</span>
      <div className="flex-1 min-w-0">
        <span className="text-sm leading-snug block">{message}</span>
        {txUrl && (
          <a href={txUrl} target="_blank" rel="noopener noreferrer"
            className="text-[11px] opacity-70 hover:opacity-100 underline underline-offset-2 mt-0.5 inline-block">
            View on Solana Explorer &rarr;
          </a>
        )}
      </div>
      <button onClick={onClose} className="ml-1 opacity-60 hover:opacity-100 transition-opacity text-lg shrink-0">&times;</button>
    </div>
  );
}

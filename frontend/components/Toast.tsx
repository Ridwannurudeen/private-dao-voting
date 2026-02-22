import { useEffect } from "react";

export type ToastType = "success" | "error" | "info";

export interface ToastData {
  message: string;
  type: ToastType;
}

export function Toast({ message, type, onClose }: { message: string; type: ToastType; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
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
    <div className={`fixed bottom-6 right-6 z-50 backdrop-blur-xl rounded-2xl border px-5 py-4 flex items-center gap-3 max-w-sm animate-[slideUp_0.3s_ease-out] ${s.bg}`}>
      <span className="text-lg">{s.icon}</span>
      <span className="text-sm leading-snug flex-1">{message}</span>
      <button onClick={onClose} className="ml-1 opacity-60 hover:opacity-100 transition-opacity text-lg">&times;</button>
    </div>
  );
}

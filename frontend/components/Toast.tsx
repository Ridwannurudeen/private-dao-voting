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

  const colors: Record<string, string> = {
    success: "bg-green-500/10 backdrop-blur-xl border-green-500/30 text-green-400 shadow-lg shadow-green-500/10",
    error: "bg-red-500/10 backdrop-blur-xl border-red-500/30 text-red-400 shadow-lg shadow-red-500/10",
    info: "bg-cyan-500/10 backdrop-blur-xl border-cyan-500/30 text-cyan-400 shadow-lg shadow-cyan-500/10",
  };
  const icons: Record<string, string> = { success: "\u2713", error: "\u2715", info: "\uD83D\uDD10" };

  return (
    <div className={`fixed bottom-6 right-6 px-6 py-4 rounded-xl flex items-center gap-3 z-50 border ${colors[type]}`}>
      <span>{icons[type]}</span>
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 hover:opacity-70">&times;</button>
    </div>
  );
}

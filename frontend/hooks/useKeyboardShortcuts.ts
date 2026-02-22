import { useEffect } from "react";

interface ShortcutHandlers {
  onVote?: () => void;
  onConfirm?: () => void;
  onClose?: () => void;
  onRefresh?: () => void;
  onNewProposal?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key.toLowerCase()) {
        case "v":
          e.preventDefault();
          handlers.onVote?.();
          break;
        case "enter":
          handlers.onConfirm?.();
          break;
        case "escape":
          handlers.onClose?.();
          break;
        case "r":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            handlers.onRefresh?.();
          }
          break;
        case "n":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            handlers.onNewProposal?.();
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handlers]);
}

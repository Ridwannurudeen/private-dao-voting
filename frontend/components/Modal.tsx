import React, { useEffect, useRef, useCallback } from "react";

export function Modal({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) {
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus trap and Esc to close
  useEffect(() => {
    if (!isOpen) return;
    const prevFocus = document.activeElement as HTMLElement;

    // Focus the first input/textarea inside the modal, falling back to the modal itself
    requestAnimationFrame(() => {
      const firstInput = modalRef.current?.querySelector<HTMLElement>("input, textarea, select");
      if (firstInput) {
        firstInput.focus();
      } else {
        modalRef.current?.focus();
      }
    });

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCloseRef.current(); return; }
      if (e.key !== "Tab" || !modalRef.current) return;

      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      prevFocus?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} aria-hidden="true" />
      <div ref={modalRef} tabIndex={-1} className="relative glass-card-elevated w-full max-w-lg outline-none" style={{ boxShadow: '0 0 60px rgba(147,51,234,0.1), 0 25px 50px rgba(0,0,0,0.5)' }}>
        {children}
      </div>
    </div>
  );
}

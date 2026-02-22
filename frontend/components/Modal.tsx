import React from "react";

export function Modal({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative glass-card-elevated w-full max-w-lg" style={{ boxShadow: '0 0 60px rgba(147,51,234,0.1), 0 25px 50px rgba(0,0,0,0.5)' }}>
        {children}
      </div>
    </div>
  );
}

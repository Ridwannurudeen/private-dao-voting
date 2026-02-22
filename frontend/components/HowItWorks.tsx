import { useState } from "react";

const STEPS = [
  {
    title: "Connect Wallet",
    desc: "Link your Solana wallet (Phantom, Solflare, etc.) to access the governance platform.",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
    color: "purple",
  },
  {
    title: "Create or Find a Proposal",
    desc: "Token-gated proposals with customizable quorum, duration, and delegation support.",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
      </svg>
    ),
    color: "cyan",
  },
  {
    title: "Cast Your Encrypted Vote",
    desc: "Your vote is encrypted with x25519 + RescueCipher before leaving your browser. No one can see it.",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    color: "emerald",
  },
  {
    title: "MPC Tallying",
    desc: "Arcium MXE nodes collectively compute on encrypted votes. No single node ever sees any vote.",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
      </svg>
    ),
    color: "blue",
  },
  {
    title: "Results Revealed",
    desc: "Only the aggregate totals are decrypted — individual votes stay secret forever. Correctness proofs included.",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    color: "green",
  },
];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string }> = {
  purple: { bg: "bg-purple-500/10", border: "border-purple-500/20", text: "text-purple-400" },
  cyan: { bg: "bg-cyan-500/10", border: "border-cyan-500/20", text: "text-cyan-400" },
  emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400" },
  blue: { bg: "bg-blue-500/10", border: "border-blue-500/20", text: "text-blue-400" },
  green: { bg: "bg-green-500/10", border: "border-green-500/20", text: "text-green-400" },
};

export function HowItWorks() {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(0);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 left-6 z-40 w-10 h-10 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center hover:bg-purple-500/30 transition-all group"
        aria-label="How it works"
        title="How it works"
      >
        <span className="text-purple-400 text-lg font-bold">?</span>
      </button>
    );
  }

  const current = STEPS[step];
  const c = COLOR_MAP[current.color];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
      <div className="relative glass-card-elevated w-full max-w-md p-6" style={{ boxShadow: '0 0 60px rgba(147,51,234,0.1)' }}>
        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-6">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={`w-2 h-2 rounded-full transition-all ${i === step ? "bg-cyan-400 w-6" : "bg-white/20 hover:bg-white/40"}`}
              aria-label={`Step ${i + 1}`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="text-center">
          <div className={`w-16 h-16 rounded-2xl ${c.bg} border ${c.border} flex items-center justify-center mx-auto mb-4`}>
            <span className={c.text}>{current.icon}</span>
          </div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Step {step + 1} of {STEPS.length}</p>
          <h3 className="text-xl font-bold text-white mb-3">{current.title}</h3>
          <p className="text-gray-400 text-sm leading-relaxed mb-6">{current.desc}</p>
        </div>

        {/* Navigation */}
        <div className="flex gap-3">
          {step > 0 ? (
            <button onClick={() => setStep(step - 1)} className="flex-1 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm hover:bg-white/10 transition-all">
              Back
            </button>
          ) : (
            <button onClick={() => setIsOpen(false)} className="flex-1 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm hover:bg-white/10 transition-all">
              Close
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button onClick={() => setStep(step + 1)} className="flex-1 py-2.5 bg-gradient-to-r from-purple-600 to-cyan-500 rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-cyan-500/20 transition-all">
              Next
            </button>
          ) : (
            <button onClick={() => { setIsOpen(false); setStep(0); }} className="flex-1 py-2.5 bg-gradient-to-r from-purple-600 to-cyan-500 rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-cyan-500/20 transition-all">
              Get Started
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

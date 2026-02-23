import { useEffect, useState } from "react";
import { LockIcon, CloudNodesIcon, DocumentCheckIcon, ShieldCheckIcon } from "./Icons";

interface OnboardingDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const STEPS = [
  {
    title: "Connect Wallet",
    desc: "Link your Solana wallet (Phantom, Solflare, etc.) to access the governance platform.",
    color: "purple",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
  },
  {
    title: "Create or Find a Proposal",
    desc: "Token-gated proposals with customizable quorum, duration, and delegation support.",
    color: "cyan",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
        <line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
      </svg>
    ),
  },
  {
    title: "Cast Your Encrypted Vote",
    desc: "Your vote is encrypted client-side as Enc<Shared, u8> via x25519 ECDH + RescueCipher. It's secret-shared across Arx Nodes before leaving your browser.",
    color: "emerald",
    icon: <LockIcon className="w-5 h-5" />,
  },
  {
    title: "MPC Tallying (Cerberus)",
    desc: "Arcium MXE nodes accumulate votes into Enc<Mxe, Tally> using the Cerberus protocol — dishonest majority security where even N-1 malicious nodes cannot learn or forge results.",
    color: "blue",
    icon: <CloudNodesIcon className="w-5 h-5" />,
  },
  {
    title: "Results Revealed",
    desc: "Threshold decryption reveals only aggregate totals — individual votes stay secret forever. The circuit_hash! macro ensures the MPC bytecode wasn't tampered with.",
    color: "green",
    icon: <DocumentCheckIcon className="w-5 h-5" />,
  },
];

const PRIVACY_FLOW = [
  {
    title: "1. Encrypt",
    desc: "Votes encrypted client-side via x25519 + RescueCipher as Enc<Shared, u8> before leaving your browser.",
    color: "cyan",
    icon: <LockIcon className="w-3.5 h-3.5" />,
  },
  {
    title: "2. MPC Tally (Cerberus)",
    desc: "Arx Nodes tally votes on Enc<Mxe, Tally> encrypted shared state. MAC-authenticated shares ensure integrity — even if N-1 of N nodes are malicious, they cannot learn your vote or forge the tally.",
    color: "purple",
    icon: <CloudNodesIcon className="w-3.5 h-3.5" />,
  },
  {
    title: "3. Verify",
    desc: "Only aggregate results are revealed on Solana via threshold decryption. The circuit_hash! macro verifies the MPC bytecode hasn't been tampered with.",
    color: "emerald",
    icon: <DocumentCheckIcon className="w-3.5 h-3.5" />,
  },
];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string }> = {
  purple: { bg: "bg-purple-500/10", border: "border-purple-500/20", text: "text-purple-400" },
  cyan: { bg: "bg-cyan-500/10", border: "border-cyan-500/20", text: "text-cyan-400" },
  emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400" },
  blue: { bg: "bg-blue-500/10", border: "border-blue-500/20", text: "text-blue-400" },
  green: { bg: "bg-green-500/10", border: "border-green-500/20", text: "text-green-400" },
};

export function OnboardingDrawer({ isOpen, onClose }: OnboardingDrawerProps) {
  const [tab, setTab] = useState<"steps" | "protocol">("steps");

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md z-50 drawer-enter">
        <div className="h-full overflow-y-auto" style={{ background: "rgba(8, 8, 20, 0.98)", borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
          {/* Header */}
          <div className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between" style={{ background: "rgba(8, 8, 20, 0.95)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div>
              <h2 className="text-lg font-bold text-white">Encrypted Supercomputer</h2>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">How Arcium MXE Powers Private Voting</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all"
              aria-label="Close drawer"
            >
              <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tab switcher */}
          <div className="px-6 pt-4 flex gap-2">
            <button
              onClick={() => setTab("steps")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                tab === "steps" ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              5-Step Flow
            </button>
            <button
              onClick={() => setTab("protocol")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                tab === "protocol" ? "bg-purple-500/10 text-purple-400 border border-purple-500/20" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Privacy Protocol
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {tab === "steps" ? (
              /* 5-Step Voting Flow */
              STEPS.map((step, i) => {
                const c = COLOR_MAP[step.color];
                return (
                  <div key={i} className="flex items-start gap-4">
                    {/* Step number + line */}
                    <div className="flex flex-col items-center shrink-0">
                      <div className={`w-10 h-10 rounded-xl ${c.bg} border ${c.border} flex items-center justify-center ${c.text}`}>
                        {step.icon}
                      </div>
                      {i < STEPS.length - 1 && (
                        <div className="w-px h-8 bg-white/10 mt-2" />
                      )}
                    </div>
                    <div className="pt-1">
                      <p className={`text-[10px] ${c.text} uppercase tracking-wider mb-0.5`}>Step {i + 1}</p>
                      <h4 className="text-sm font-semibold text-white mb-1">{step.title}</h4>
                      <p className="text-xs text-gray-400 leading-relaxed">{step.desc}</p>
                    </div>
                  </div>
                );
              })
            ) : (
              /* Privacy Protocol */
              <>
                {PRIVACY_FLOW.map((item, i) => {
                  const c = COLOR_MAP[item.color];
                  return (
                    <div key={i} className={`flex items-start gap-3 p-3 rounded-xl ${c.bg.replace("/10", "/5")} border ${c.border}`}>
                      <div className={`w-6 h-6 rounded-lg ${c.bg} flex items-center justify-center shrink-0 mt-0.5 ${c.text}`}>
                        {item.icon}
                      </div>
                      <div>
                        <p className={`text-xs font-medium ${c.text} mb-0.5`}>{item.title}</p>
                        <p className="text-[11px] text-gray-400 leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  );
                })}

                {/* Security badge */}
                <div className="flex items-center gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/5 mt-4">
                  <ShieldCheckIcon className="w-5 h-5 text-purple-400 shrink-0" />
                  <div>
                    <p className="text-[11px] text-purple-400 font-medium">Dishonest Majority Security</p>
                    <p className="text-[10px] text-gray-500">
                      Computation is correct and private as long as at least one Arx Node is honest.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

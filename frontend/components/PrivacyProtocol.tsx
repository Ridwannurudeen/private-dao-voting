import { useState } from "react";
import { LockIcon, CloudNodesIcon, DocumentCheckIcon } from "./Icons";

export function PrivacyProtocol() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="glass-card-elevated overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
            <LockIcon className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">How Privacy Works</h3>
            <p className="text-[10px] text-gray-500">Arcium MXE architecture</p>
          </div>
        </div>
        <svg className={`w-4 h-4 text-gray-500 transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
            <div className="w-6 h-6 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <LockIcon className="w-3 h-3 text-cyan-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-cyan-400 mb-0.5">1. Encrypt</p>
              <p className="text-[11px] text-gray-400 leading-relaxed">Votes encrypted client-side via x25519 + RescueCipher before leaving your browser.</p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-xl bg-purple-500/5 border border-purple-500/10">
            <div className="w-6 h-6 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <CloudNodesIcon className="w-3 h-3 text-purple-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-purple-400 mb-0.5">2. MPC Tally</p>
              <p className="text-[11px] text-gray-400 leading-relaxed">Arcium MXE nodes tally votes on encrypted shared state. No node sees any plaintext.</p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <DocumentCheckIcon className="w-3 h-3 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-emerald-400 mb-0.5">3. Verify</p>
              <p className="text-[11px] text-gray-400 leading-relaxed">Only aggregate results are revealed on Solana with cryptographic correctness proofs.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

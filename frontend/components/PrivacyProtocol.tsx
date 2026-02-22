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
            <p className="text-[10px] text-gray-500">Cerberus MPC on Arcium MXE</p>
          </div>
        </div>
        <svg className={`w-4 h-4 text-gray-500 transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Step 1: Encrypt */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
            <div className="w-6 h-6 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <LockIcon className="w-3 h-3 text-cyan-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-cyan-400 mb-0.5">1. Encrypt</p>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Votes encrypted client-side via x25519 + RescueCipher as <code className="text-[10px] text-cyan-400/60">Enc&lt;Shared, u8&gt;</code> before leaving your browser.
              </p>
            </div>
          </div>

          {/* Step 2: MPC Tally */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-purple-500/5 border border-purple-500/10">
            <div className="w-6 h-6 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <CloudNodesIcon className="w-3 h-3 text-purple-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-purple-400 mb-0.5">2. MPC Tally (Cerberus)</p>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Arx Nodes tally votes on <code className="text-[10px] text-purple-400/60">Enc&lt;Mxe, Tally&gt;</code> encrypted shared state using the Cerberus protocol.
                MAC-authenticated shares ensure integrity — even if N-1 of N nodes are malicious, they cannot learn your vote or forge the tally.
              </p>
            </div>
          </div>

          {/* Step 3: Verify */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <DocumentCheckIcon className="w-3 h-3 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-emerald-400 mb-0.5">3. Verify</p>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Only aggregate results are revealed on Solana via threshold decryption.
                The <code className="text-[10px] text-emerald-400/60">circuit_hash!</code> macro verifies the MPC bytecode hasn't been tampered with.
              </p>
            </div>
          </div>

          {/* Security model badge */}
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
            <svg className="w-4 h-4 text-purple-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <div>
              <p className="text-[10px] text-purple-400 font-medium">Dishonest Majority Security</p>
              <p className="text-[9px] text-gray-500">
                Computation is correct and private as long as at least one Arx Node is honest.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { LockIcon, CloudNodesIcon, DocumentCheckIcon } from "./Icons";

export function PrivacyProtocol() {
  const [showTechDeep, setShowTechDeep] = useState(false);

  return (
    <div className="pt-4 border-t border-white/10">
      <h2 className="text-2xl font-bold text-center mb-2 bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
        The Privacy Protocol
      </h2>
      <p className="text-gray-400 text-sm text-center mb-8 max-w-lg mx-auto">
        How Arcium&apos;s confidential computing protects every vote from submission to result
      </p>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Step 1 */}
        <div className="glass-card neon-border p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
              <LockIcon className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <span className="text-[10px] text-cyan-400/60 uppercase tracking-widest">Step 1</span>
              <h3 className="font-semibold text-white">Encrypted Submission</h3>
            </div>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">
            Votes are encrypted client-side using Arcium&apos;s SDK before leaving your browser.
            Your choice is private from the moment you click &mdash; no one, not even validators,
            can see how you voted.
          </p>
        </div>

        {/* Step 2 */}
        <div className="glass-card neon-border p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
              <CloudNodesIcon className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <span className="text-[10px] text-purple-400/60 uppercase tracking-widest">Step 2</span>
              <h3 className="font-semibold text-white">Secure MPC Tallying</h3>
            </div>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">
            The MXE (Multi-Party Computation eXecution Environment) processes votes in a
            Shared Private State &mdash; tallying without ever decrypting individual inputs. This
            eliminates front-running and social coercion.
          </p>
        </div>

        {/* Step 3 */}
        <div className="glass-card neon-border p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
              <DocumentCheckIcon className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <span className="text-[10px] text-emerald-400/60 uppercase tracking-widest">Step 3</span>
              <h3 className="font-semibold text-white">Verifiable Results</h3>
            </div>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">
            Only the final aggregate result is published to Solana, accompanied by a
            Proof of Correctness that ensures the tally is mathematically valid &mdash;
            verifiable by anyone, without revealing individual votes.
          </p>
        </div>
      </div>

      {/* Technical Deep Dive Toggle */}
      <div className="mt-6">
        <button
          onClick={() => setShowTechDeep(!showTechDeep)}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm text-gray-400 hover:text-cyan-400 transition-colors"
        >
          <span>Technical Deep Dive</span>
          <svg className={`w-4 h-4 transition-transform duration-200 ${showTechDeep ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {showTechDeep && (
          <div className="glass-card p-5 mt-2">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-3">Architecture</h4>
                <ul className="space-y-2 text-sm text-gray-300">
                  <li className="flex items-start gap-2">
                    <span className="text-cyan-400/60 mt-0.5">&rsaquo;</span>
                    <span><span className="text-white font-medium">Arx Nodes</span> &mdash; Distributed MPC cluster operators that collectively compute on encrypted data without any single node seeing plaintext</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-cyan-400/60 mt-0.5">&rsaquo;</span>
                    <span><span className="text-white font-medium">Secret Sharing</span> &mdash; Each vote is split into cryptographic shares distributed across nodes; reconstruction requires threshold consensus</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-cyan-400/60 mt-0.5">&rsaquo;</span>
                    <span><span className="text-white font-medium">Computation Definitions</span> &mdash; Tally logic runs as a verifiable program inside the MXE, defining how encrypted inputs are aggregated</span>
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3">Guarantees</h4>
                <ul className="space-y-2 text-sm text-gray-300">
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400/60 mt-0.5">&rsaquo;</span>
                    <span><span className="text-white font-medium">Input Privacy</span> &mdash; Individual votes are never revealed to any party, including the DAO authority</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400/60 mt-0.5">&rsaquo;</span>
                    <span><span className="text-white font-medium">Output Integrity</span> &mdash; Correctness proofs cryptographically guarantee the published result matches the actual encrypted votes</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400/60 mt-0.5">&rsaquo;</span>
                    <span><span className="text-white font-medium">On-Chain Settlement</span> &mdash; Final results are anchored to Solana, providing immutable public verifiability on the fastest L1</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

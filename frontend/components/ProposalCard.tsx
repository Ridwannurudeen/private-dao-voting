import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { LockIcon, UnlockIcon, ShieldCheckIcon } from "./Icons";

export interface Proposal {
  publicKey: PublicKey;
  id: BN;
  authority: PublicKey;
  title: string;
  description: string;
  votingEndsAt: BN;
  isActive: boolean;
  isRevealed: boolean;
  totalVotes: number;
  gateMint: PublicKey;
  minBalance: BN;
  yesVotes: number;
  noVotes: number;
  abstainVotes: number;
  quorum: number;
}

function formatTime(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return "Ended";
  const hours = Math.floor(secondsRemaining / 3600);
  const minutes = Math.floor((secondsRemaining % 3600) / 60);
  if (hours > 24) return Math.floor(hours / 24) + "d " + (hours % 24) + "h";
  if (hours > 0) return hours + "h " + minutes + "m";
  if (minutes > 0) return minutes + "m";
  return Math.floor(secondsRemaining) + "s";
}

interface ProposalCardProps {
  proposal: Proposal;
  nowTs: number;
  publicKey: PublicKey | null;
  hasVoted: boolean;
  tokenBalance: number;
  selectedChoice: "yes" | "no" | "abstain" | null;
  isVoting: boolean;
  isRevealing: boolean;
  isClaiming: boolean;
  isEncrypting: boolean;
  onSelectChoice: (choice: "yes" | "no" | "abstain") => void;
  onVote: () => void;
  onReveal: () => void;
  onClaimTokens: () => void;
  onToggleHide: () => void;
}

export function ProposalCard({
  proposal: p,
  nowTs,
  publicKey,
  hasVoted,
  tokenBalance,
  selectedChoice,
  isVoting,
  isRevealing,
  isClaiming,
  isEncrypting,
  onSelectChoice,
  onVote,
  onReveal,
  onClaimTokens,
  onToggleHide,
}: ProposalCardProps) {
  const active = p.isActive && nowTs < p.votingEndsAt.toNumber();
  const isAuthority = publicKey && p.authority.equals(publicKey);
  const isEnded = nowTs >= p.votingEndsAt.toNumber();
  const canReveal = isAuthority && isEnded && !p.isRevealed && p.isActive;

  const yes = typeof p.yesVotes === "number" ? p.yesVotes : 0;
  const no = typeof p.noVotes === "number" ? p.noVotes : 0;
  const abstain = typeof p.abstainVotes === "number" ? p.abstainVotes : 0;
  const total = typeof p.totalVotes === "number" ? p.totalVotes : 0;
  const yesPct = total > 0 ? Math.round((yes / total) * 100) : 0;
  const noPct = total > 0 ? Math.round((no / total) * 100) : 0;
  const abstainPct = total > 0 ? Math.round((abstain / total) * 100) : 0;
  const remaining = p.votingEndsAt.toNumber() - nowTs;

  return (
    <div className="glass-card neon-border p-6 relative group">
      {isAuthority && (
        <button onClick={onToggleHide} title="Hide proposal"
          className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all p-1">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        </button>
      )}

      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="text-lg font-semibold">{p.title}</h3>
          <p className="text-sm text-gray-400">by {p.authority.toString().slice(0, 4)}...{p.authority.toString().slice(-4)}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${active ? "bg-green-500/20 text-green-400" : p.isRevealed ? "bg-blue-500/20 text-blue-400" : "bg-gray-500/20 text-gray-400"}`}>
            {active ? "Active" : p.isRevealed ? "Revealed" : "Ended"}
          </span>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${p.isRevealed ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20" : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"}`}>
            {p.isRevealed ? (
              <><UnlockIcon className="w-3 h-3" /> Results Public</>
            ) : (
              <><LockIcon className="w-3 h-3" /> Encrypted Tally</>
            )}
          </span>
          {active && <p className="text-xs text-cyan-400 mt-0.5">{formatTime(remaining)} left</p>}
        </div>
      </div>

      <p className="text-gray-300 mb-4 line-clamp-3">{p.description}</p>
      <p className="text-xs text-gray-400 mb-4">
        Gate: {p.gateMint.toString().slice(0, 8)}... | Min balance: {p.minBalance.toString()} | Votes: {total}
        {p.quorum > 0 && (<> | Quorum: {total}/{p.quorum} {total >= p.quorum ? <span className="text-green-400">met</span> : <span className="text-yellow-400">not met</span>}</>)}
      </p>

      {/* Token gate check */}
      {active && !hasVoted && tokenBalance < p.minBalance.toNumber() && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 space-y-3">
          <p className="text-sm text-yellow-400">You need gate tokens to vote on this proposal.</p>
          <button onClick={onClaimTokens} disabled={isClaiming}
            className="w-full py-3 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-xl font-semibold text-white disabled:opacity-50">
            {isClaiming ? "Claiming..." : "Claim Gate Tokens"}
          </button>
        </div>
      )}

      {/* Voting buttons */}
      {active && !hasVoted && tokenBalance >= p.minBalance.toNumber() && (
        <div className="space-y-3">
          <div className="flex gap-3">
            <button onClick={() => onSelectChoice("yes")} disabled={isVoting}
              className={`flex-1 py-3 rounded-xl font-semibold transition-all ${selectedChoice === "yes" ? "bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500 shadow-lg shadow-emerald-500/25" : "bg-white/5 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/10"}`}>
              YES
            </button>
            <button onClick={() => onSelectChoice("no")} disabled={isVoting}
              className={`flex-1 py-3 rounded-xl font-semibold transition-all ${selectedChoice === "no" ? "bg-red-500/20 text-red-400 border-2 border-red-500 shadow-lg shadow-red-500/25" : "bg-white/5 text-red-400 border border-red-500/30 hover:bg-red-500/10"}`}>
              NO
            </button>
            <button onClick={() => onSelectChoice("abstain")} disabled={isVoting}
              className={`flex-1 py-3 rounded-xl font-semibold transition-all ${selectedChoice === "abstain" ? "bg-slate-500/20 text-slate-300 border-2 border-slate-400 shadow-lg shadow-slate-500/25" : "bg-white/5 text-slate-400 border border-slate-500/30 hover:bg-slate-500/10"}`}>
              ABSTAIN
            </button>
          </div>
          {selectedChoice && (
            <>
              <button onClick={onVote} disabled={isVoting}
                className="w-full py-3 bg-gradient-to-r from-purple-600 to-cyan-500 rounded-xl font-semibold disabled:opacity-50 hover:shadow-lg hover:shadow-cyan-500/20 transition-all border border-cyan-500/20">
                {isVoting ? (isEncrypting ? "Encrypting vote..." : "Submitting to Solana...") : "Submit Encrypted Vote"}
              </button>
              {isVoting && (
                <div className="space-y-2 mt-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-gray-400">Privacy Integrity</span>
                    <span className="text-cyan-400">{isEncrypting ? "Encrypting via MXE..." : "Submitting to chain..."}</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                    <div className={`h-full rounded-full transition-all duration-700 ease-out integrity-bar-fill ${isEncrypting ? "w-1/3 animate-pulse" : "w-2/3"}`} />
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className={isEncrypting ? "text-cyan-400 font-medium" : "text-cyan-400/40"}>Encrypt</span>
                    <span className={!isEncrypting ? "text-purple-400 font-medium" : "text-purple-400/40"}>Submit</span>
                    <span className="text-gray-500">Confirm</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Already voted */}
      {active && hasVoted && (
        <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-4 flex items-center justify-center gap-2">
          <ShieldCheckIcon className="w-5 h-5 text-cyan-400" />
          <span className="text-cyan-400">Your encrypted vote is sealed on-chain</span>
        </div>
      )}

      {/* Reveal button */}
      {canReveal && (
        <button onClick={onReveal} disabled={isRevealing}
          className="w-full py-3 mt-4 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl font-semibold disabled:opacity-50 hover:shadow-lg hover:shadow-cyan-500/20 transition-all">
          {isRevealing ? "Revealing..." : "Reveal Results"}
        </button>
      )}

      {/* Results */}
      {p.isRevealed && total > 0 && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-green-400">Yes: {yes} ({yesPct}%)</span>
            <span className="text-red-400">No: {no} ({noPct}%)</span>
            {abstain > 0 && <span className="text-slate-400">Abstain: {abstain} ({abstainPct}%)</span>}
          </div>
          <div className="h-3 bg-white/5 rounded-full overflow-hidden flex border border-white/10">
            {yesPct > 0 && <div className="bg-gradient-to-r from-green-500 to-emerald-400 h-full shadow-[0_0_8px_rgba(16,185,129,0.4)]" style={{ width: yesPct + "%" }} />}
            {noPct > 0 && <div className="bg-gradient-to-r from-red-500 to-rose-400 h-full shadow-[0_0_8px_rgba(239,68,68,0.4)]" style={{ width: noPct + "%" }} />}
            {abstainPct > 0 && <div className="bg-slate-500 h-full" style={{ width: abstainPct + "%" }} />}
          </div>
          <p className="text-center text-xs text-gray-400 mt-2">Total: {total} votes</p>
        </div>
      )}

      {/* Encrypted votes vault */}
      {active && total > 0 && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className={`bg-slate-800/50 rounded-xl p-4 border relative overflow-hidden ${isVoting ? "border-cyan-500/30" : "border-cyan-500/10"}`}>
            <div className={`absolute inset-0 pointer-events-none ${isVoting ? "shimmer-bg-active" : "shimmer-bg"}`} />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheckIcon className={`w-5 h-5 text-cyan-400 ${isVoting ? "animate-pulse" : "animate-pulse-slow"}`} />
                <span className="text-gray-300">{total} vote{total !== 1 ? "s" : ""} sealed</span>
              </div>
              <LockIcon className="w-4 h-4 text-cyan-400/50" />
            </div>
            <div className="relative flex items-center justify-center gap-3 mt-2">
              <span className="text-[10px] text-cyan-400/60 flex items-center gap-1">
                <LockIcon className="w-2.5 h-2.5" /> Encrypted Shared State
              </span>
              <span className="text-[10px] text-gray-600">|</span>
              <span className="text-[10px] text-purple-400/60 flex items-center gap-1">
                <ShieldCheckIcon className="w-2.5 h-2.5" /> Correctness Proofs
              </span>
            </div>
            <p className="relative text-xs text-gray-400 text-center mt-1">Secured by Arcium MXE</p>
          </div>
        </div>
      )}

      {/* Ended but not revealed */}
      {!active && !p.isRevealed && !canReveal && (
        <div className="mt-4 pt-4 border-t border-white/10 text-xs text-gray-400">
          Voting ended. Pending reveal by the proposal authority.
        </div>
      )}
    </div>
  );
}

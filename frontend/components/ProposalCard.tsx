import { useState, useEffect } from "react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { LockIcon, UnlockIcon, ShieldCheckIcon } from "./Icons";
import { ExportResults } from "./ExportResults";
import { EncryptionAnimation } from "./EncryptionAnimation";
import { VoteProgress, VoteStep } from "./VoteProgress";

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
}

function formatTime(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return "Ended";
  const hours = Math.floor(secondsRemaining / 3600);
  const minutes = Math.floor((secondsRemaining % 3600) / 60);
  const seconds = Math.floor(secondsRemaining % 60);
  if (hours > 24) return Math.floor(hours / 24) + "d " + (hours % 24) + "h";
  if (hours > 0) return hours + "h " + minutes + "m " + seconds + "s";
  if (minutes > 0) return minutes + "m " + seconds + "s";
  return seconds + "s";
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
  currentVoteStep: VoteStep;
  onSelectChoice: (choice: "yes" | "no" | "abstain") => void;
  onVote: () => void;
  onReveal: () => void;
  onClaimTokens: () => void;
  onToggleHide: () => void;
  onVoteStepComplete: () => void;
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
  currentVoteStep,
  onSelectChoice,
  onVote,
  onReveal,
  onClaimTokens,
  onToggleHide,
  onVoteStepComplete,
}: ProposalCardProps) {
  // Real-time countdown
  const [liveRemaining, setLiveRemaining] = useState(Number(p.votingEndsAt) - nowTs);

  useEffect(() => {
    const endTime = Number(p.votingEndsAt);
    const update = () => setLiveRemaining(endTime - Math.floor(Date.now() / 1000));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [p.votingEndsAt]);

  const active = p.isActive && liveRemaining > 0;
  const isAuthority = publicKey && p.authority.equals(publicKey);
  const isEnded = liveRemaining <= 0;
  const canReveal = isAuthority && isEnded && !p.isRevealed && p.isActive;
  const isUrgent = active && liveRemaining < 300; // < 5 minutes

  const yes = typeof p.yesVotes === "number" ? p.yesVotes : 0;
  const no = typeof p.noVotes === "number" ? p.noVotes : 0;
  const abstain = typeof p.abstainVotes === "number" ? p.abstainVotes : 0;
  const total = typeof p.totalVotes === "number" ? p.totalVotes : 0;
  const yesPct = total > 0 ? Math.round((yes / total) * 100) : 0;
  const noPct = total > 0 ? Math.round((no / total) * 100) : 0;
  const abstainPct = total > 0 ? Math.round((abstain / total) * 100) : 0;

  const copyLink = () => {
    const url = `${window.location.origin}/proposal/${p.id.toString()}`;
    navigator.clipboard.writeText(url);
  };

  return (
    <article className="glass-card-elevated neon-border p-4 sm:p-6 relative group" aria-label={`Proposal: ${p.title}`} role="region">
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
      <div className="flex flex-col sm:flex-row justify-between items-start mb-3 gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold truncate">{p.title}</h3>
            <button onClick={copyLink} title="Copy shareable link"
              className="shrink-0 text-gray-500 hover:text-cyan-400 transition-colors">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-gray-400">by {p.authority.toString().slice(0, 4)}...{p.authority.toString().slice(-4)}</p>
        </div>
        <div className="flex flex-row sm:flex-col items-start sm:items-end gap-2 flex-wrap">
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
          {active && (
            <p className={`text-xs mt-0.5 font-mono ${isUrgent ? "text-red-400 animate-pulse" : "text-cyan-400"}`}>
              {formatTime(liveRemaining)} left
            </p>
          )}
        </div>
      </div>

      {/* Description with Markdown support */}
      <div className="text-gray-300 mb-4 line-clamp-3 prose prose-sm prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {p.description}
        </ReactMarkdown>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-2 mb-3">
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" title="Cerberus MPC: secure even if N-1 of N nodes are malicious">
          Cerberus Protected
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center gap-1" title="Votes processed in Shared Private State">
          <LockIcon className="w-2.5 h-2.5" /> Shielded
        </span>
      </div>

      <p className="text-xs text-gray-400 mb-4 break-all sm:break-normal">
        Gate: {p.gateMint.toString().slice(0, 8)}... | Min balance: {p.minBalance.toString()} | Votes: {total}
      </p>

      {/* Token gate check: show claim when ATA missing (balance=-1) or below minimum */}
      {active && !hasVoted && (tokenBalance < 0 || tokenBalance < Number(p.minBalance)) && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 space-y-3">
          <p className="text-sm text-yellow-400">
            {tokenBalance < 0
              ? "You need the gate token to vote on this proposal."
              : `You need at least ${p.minBalance.toString()} gate token(s) to vote.`}
          </p>
          <button onClick={onClaimTokens} disabled={isClaiming}
            className="w-full py-3 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-xl font-semibold text-white disabled:opacity-50">
            {isClaiming ? "Claiming..." : "Claim Gate Tokens"}
          </button>
        </div>
      )}

      {/* Voting buttons */}
      {active && !hasVoted && tokenBalance >= 0 && tokenBalance >= Number(p.minBalance) && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <button onClick={() => onSelectChoice("yes")} disabled={isVoting} aria-label="Vote Yes" aria-pressed={selectedChoice === "yes"}
              className={`flex-1 py-3 rounded-xl font-semibold transition-all ${selectedChoice === "yes" ? "bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500 shadow-lg shadow-emerald-500/25" : "bg-white/5 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/10"}`}>
              YES
            </button>
            <button onClick={() => onSelectChoice("no")} disabled={isVoting} aria-label="Vote No" aria-pressed={selectedChoice === "no"}
              className={`flex-1 py-3 rounded-xl font-semibold transition-all ${selectedChoice === "no" ? "bg-red-500/20 text-red-400 border-2 border-red-500 shadow-lg shadow-red-500/25" : "bg-white/5 text-red-400 border border-red-500/30 hover:bg-red-500/10"}`}>
              NO
            </button>
            <button onClick={() => onSelectChoice("abstain")} disabled={isVoting} aria-label="Vote Abstain" aria-pressed={selectedChoice === "abstain"}
              className={`flex-1 py-3 rounded-xl font-semibold transition-all ${selectedChoice === "abstain" ? "bg-slate-500/20 text-slate-300 border-2 border-slate-400 shadow-lg shadow-slate-500/25" : "bg-white/5 text-slate-400 border border-slate-500/30 hover:bg-slate-500/10"}`}>
              ABSTAIN
            </button>
          </div>
          {selectedChoice && (
            <>
              {isVoting && isEncrypting && <EncryptionAnimation active={true} />}
              <button onClick={onVote} disabled={isVoting}
                aria-label={`Submit encrypted ${selectedChoice} vote`}
                className="w-full py-3 bg-gradient-to-r from-purple-600 to-cyan-500 rounded-xl font-semibold disabled:opacity-50 hover:shadow-lg hover:shadow-cyan-500/20 transition-all border border-cyan-500/20">
                {isVoting ? (isEncrypting ? "Encrypting vote..." : "Submitting to Solana...") : "Submit Encrypted Vote"}
              </button>
              {isVoting && (
                <VoteProgress step={currentVoteStep} onComplete={onVoteStepComplete} />
              )}
            </>
          )}
        </div>
      )}

      {/* Already voted */}
      {active && hasVoted && (
        <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-4 flex items-center justify-center gap-2">
          <ShieldCheckIcon className="w-5 h-5 text-cyan-400" />
          <span className="text-cyan-400 text-sm sm:text-base">Your encrypted vote is sealed on-chain</span>
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
          <div className="flex flex-wrap justify-between text-sm mb-2 gap-1">
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
          <ExportResults proposal={p} />
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
                <span className={`text-gray-300 ${isVoting ? "data-mask-animation" : ""}`}>{total} vote{total !== 1 ? "s" : ""} sealed</span>
              </div>
              <LockIcon className="w-4 h-4 text-cyan-400/50" />
            </div>
            <div className="relative flex items-center justify-center gap-3 mt-2 flex-wrap">
              <span className="text-[10px] text-cyan-400/60 flex items-center gap-1">
                <LockIcon className="w-2.5 h-2.5" /> Encrypted Shared State
              </span>
              <span className="text-[10px] text-gray-600 hidden sm:inline">|</span>
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
    </article>
  );
}

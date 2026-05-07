import { useState, useEffect } from "react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
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

interface DelegationInfo {
  delegator: PublicKey;
  createdAt: number;
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
  isCancelling: boolean;
  isEncrypting: boolean;
  currentVoteStep: VoteStep;
  onSelectChoice: (choice: "yes" | "no" | "abstain") => void;
  onVote: () => void;
  onReveal: () => void;
  onCancel: () => void;
  onClaimTokens: () => void;
  onToggleHide: () => void;
  onVoteStepComplete: () => void;
  availableDelegations?: DelegationInfo[];
  votedDelegationCount?: number;
  delegatedVoting?: Record<string, boolean>;
  delegatedSelected?: Record<string, "yes" | "no" | "abstain" | null>;
  onDelegatedSelectChoice?: (delegatorKey: string, choice: "yes" | "no" | "abstain") => void;
  onDelegatedVote?: (delegator: PublicKey, choice: "yes" | "no" | "abstain") => void;
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
  isCancelling,
  isEncrypting,
  currentVoteStep,
  onSelectChoice,
  onVote,
  onReveal,
  onCancel,
  onClaimTokens,
  onToggleHide,
  onVoteStepComplete,
  availableDelegations = [],
  votedDelegationCount = 0,
  delegatedVoting = {},
  delegatedSelected = {},
  onDelegatedSelectChoice,
  onDelegatedVote,
}: ProposalCardProps) {
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
  const canReveal = isEnded && !p.isRevealed && p.isActive;
  const canCancel = isAuthority && p.isActive && (liveRemaining > 0 || p.totalVotes === 0);
  const isUrgent = active && liveRemaining < 300;

  const yes = typeof p.yesVotes === "number" ? p.yesVotes : 0;
  const no = typeof p.noVotes === "number" ? p.noVotes : 0;
  const abstain = typeof p.abstainVotes === "number" ? p.abstainVotes : 0;
  const total = typeof p.totalVotes === "number" ? p.totalVotes : 0;
  const yesPct = total > 0 ? Math.round((yes / total) * 100) : 0;
  const noPct = total > 0 ? Math.round((no / total) * 100) : 0;
  const abstainPct = total > 0 ? Math.round((abstain / total) * 100) : 0;

  const status =
    active ? { label: "Active", tone: "active" as const }
    : p.isRevealed ? { label: "Revealed", tone: "revealed" as const }
    : !p.isActive && !isEnded ? { label: "Cancelled", tone: "crit" as const }
    : { label: "Ended", tone: "neutral" as const };

  const copyLink = () => {
    const url = `${window.location.origin}/proposal/${p.id.toString()}`;
    navigator.clipboard.writeText(url);
  };

  const idHex = p.id.toString(16).padStart(4, "0");
  const authorityShort = `${p.authority.toString().slice(0, 4)}…${p.authority.toString().slice(-4)}`;

  return (
    <article className="panel neon-border p-5 sm:p-7 relative group" aria-label={`Proposal: ${p.title}`} role="region">
      {isAuthority && (
        <button onClick={onToggleHide} title="Hide proposal"
          className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all p-1"
          style={{ color: "var(--paper-3)" }}>
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        </button>
      )}

      {/* Top meta row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-[10px] tracking-widest" style={{ color: "var(--paper-3)" }}>
            #{idHex}
          </span>
          <span className="hr-hair" style={{ width: 18, opacity: 0.5 }} />
          <StatusBadge status={status} />
          {active && (
            <span className={`font-mono text-[10px] tracking-wider tabular-nums ${isUrgent ? "animate-pulse" : ""}`}
              style={{ color: isUrgent ? "var(--seal)" : "var(--paper-2)" }}>
              {formatTime(liveRemaining)} left
            </span>
          )}
        </div>
        <button onClick={copyLink} title="Copy shareable link"
          className="shrink-0 transition-colors"
          style={{ color: "var(--paper-3)" }}>
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </button>
      </div>

      {/* Title */}
      <h3 className="font-display text-paper-0 text-[22px] sm:text-[26px] tracking-tighter leading-tight mb-2">
        {p.title}
      </h3>

      <div className="h-meta mb-4">
        proposed by{" "}
        <span className="text-paper-2">{authorityShort}</span>
      </div>

      {/* Description */}
      <div className="text-paper-2 text-[14.5px] leading-relaxed mb-5 line-clamp-3 prose prose-sm prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {p.description}
        </ReactMarkdown>
      </div>

      {/* Meta strip */}
      <div className="flex items-center gap-4 mb-5 pb-5" style={{ borderBottom: "1px solid var(--ink-3)" }}>
        <Meta label="Ballots" value={String(total)} />
        {Number(p.minBalance) > 0 && <Meta label="Gate" value={`${p.minBalance.toString()} tokens`} />}
        <Meta label="State" value={active ? "Sealed" : p.isRevealed ? "Revealed" : "Closed"} />
      </div>

      {/* Token gate check */}
      {active && !hasVoted && (tokenBalance < 0 || tokenBalance < Number(p.minBalance)) && (
        <div className="p-4 mb-1" style={{
          background: "var(--steel-soft)",
          border: "1px solid var(--steel-line)",
          borderRadius: 6,
        }}>
          <p className="text-[13px] text-paper-1 leading-snug mb-3">
            {tokenBalance < 0
              ? "You need the gate token to vote on this proposal."
              : `You need at least ${p.minBalance.toString()} gate token(s) to vote.`}
          </p>
          <button onClick={onClaimTokens} disabled={isClaiming} className="btn-secondary w-full">
            {isClaiming ? "Claiming…" : "Claim gate tokens"}
          </button>
        </div>
      )}

      {/* Voting buttons */}
      {active && !hasVoted && tokenBalance >= 0 && tokenBalance >= Number(p.minBalance) && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <VoteButton kind="yes" selected={selectedChoice === "yes"} disabled={isVoting} onClick={() => onSelectChoice("yes")}>Yes</VoteButton>
            <VoteButton kind="no" selected={selectedChoice === "no"} disabled={isVoting} onClick={() => onSelectChoice("no")}>No</VoteButton>
            <VoteButton kind="abstain" selected={selectedChoice === "abstain"} disabled={isVoting} onClick={() => onSelectChoice("abstain")}>Abstain</VoteButton>
          </div>
          {selectedChoice && (
            <>
              {isVoting && isEncrypting && <EncryptionAnimation active={true} />}
              <button onClick={onVote} disabled={isVoting} aria-label={`Submit encrypted ${selectedChoice} vote`} className="btn-primary w-full">
                {isVoting ? (isEncrypting ? "Encrypting…" : "Submitting to Solana…") : "Seal & submit ballot"}
              </button>
              {isVoting && <VoteProgress step={currentVoteStep} onComplete={onVoteStepComplete} />}
            </>
          )}
        </div>
      )}

      {/* Already voted */}
      {active && hasVoted && (
        <div className="p-4 flex items-center gap-3" style={{
          background: "var(--seal-soft)",
          border: "1px solid var(--seal-line)",
          borderRadius: 6,
        }}>
          <span className="seal-dot seal-dot-pulse" aria-hidden="true" />
          <span className="font-display italic text-paper-1 text-[15px]">
            Your ballot is sealed on-chain.
          </span>
        </div>
      )}

      {/* Delegated voting */}
      {active && (availableDelegations.length > 0 || votedDelegationCount > 0) && onDelegatedVote && onDelegatedSelectChoice && (
        <div className="mt-5 pt-4 space-y-3" style={{ borderTop: "1px solid var(--ink-3)" }}>
          <div className="flex items-center justify-between">
            <div className="h-eyebrow">Delegated ballots</div>
            <span className="font-mono text-[10px] text-paper-3">
              {availableDelegations.length} available{votedDelegationCount > 0 ? ` · ${votedDelegationCount} cast` : ""}
            </span>
          </div>

          {availableDelegations.map((d) => {
            const dKey = d.delegator.toString();
            const compoundKey = `${p.publicKey.toString()}:${dKey}`;
            const isVotingDelegated = delegatedVoting[compoundKey] || false;
            const selectedDelegated = delegatedSelected[compoundKey] || null;
            const shortAddr = `${dKey.slice(0, 4)}…${dKey.slice(-4)}`;

            return (
              <div key={dKey} className="p-3 space-y-2.5" style={{ background: "var(--ink-2)", border: "1px solid var(--ink-3)", borderRadius: 6 }}>
                <div className="h-meta">
                  voting on behalf of <span className="text-paper-1">{shortAddr}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <VoteButton kind="yes" small selected={selectedDelegated === "yes"} disabled={isVotingDelegated} onClick={() => onDelegatedSelectChoice(dKey, "yes")}>Yes</VoteButton>
                  <VoteButton kind="no" small selected={selectedDelegated === "no"} disabled={isVotingDelegated} onClick={() => onDelegatedSelectChoice(dKey, "no")}>No</VoteButton>
                  <VoteButton kind="abstain" small selected={selectedDelegated === "abstain"} disabled={isVotingDelegated} onClick={() => onDelegatedSelectChoice(dKey, "abstain")}>Abstain</VoteButton>
                </div>
                {selectedDelegated && (
                  <button onClick={() => onDelegatedVote(d.delegator, selectedDelegated)} disabled={isVotingDelegated} className="btn-secondary w-full text-[12px] py-2">
                    {isVotingDelegated ? "Submitting…" : `Cast as delegate for ${shortAddr}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reveal */}
      {canReveal && (
        <button onClick={onReveal} disabled={isRevealing} className="btn-primary w-full mt-4">
          {isRevealing ? "Revealing…" : "Reveal results"}
        </button>
      )}

      {/* Cancel */}
      {canCancel && (
        <button onClick={onCancel} disabled={isCancelling} className="btn-secondary w-full mt-4"
          style={{ color: "var(--crit)", borderColor: "var(--crit-soft)" }}>
          {isCancelling ? "Cancelling…" : "Cancel proposal"}
        </button>
      )}

      {/* Results — revealed */}
      {p.isRevealed && total > 0 && (
        <div className="mt-5 pt-5" style={{ borderTop: "1px solid var(--ink-3)" }}>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <ResultCell label="Yes" count={yes} pct={yesPct} tone="reveal" />
            <ResultCell label="No" count={no} pct={noPct} tone="crit" />
            <ResultCell label="Abstain" count={abstain} pct={abstainPct} tone="steel" />
          </div>
          <div className="flex h-2 overflow-hidden" style={{ background: "var(--ink-2)", border: "1px solid var(--ink-3)", borderRadius: 999 }}>
            {yesPct > 0 && <div style={{ width: yesPct + "%", background: "var(--reveal)" }} />}
            {noPct > 0 && <div style={{ width: noPct + "%", background: "var(--crit)" }} />}
            {abstainPct > 0 && <div style={{ width: abstainPct + "%", background: "var(--steel)" }} />}
          </div>
          <p className="h-meta text-center mt-3">{total} ballots · threshold-decrypted via MPC</p>
          <ExportResults proposal={p} />
        </div>
      )}

      {/* Encrypted ballot summary — active */}
      {active && total > 0 && (
        <div className="mt-5 pt-4 flex items-center justify-between" style={{ borderTop: "1px solid var(--ink-3)" }}>
          <div className="flex items-center gap-3">
            <span className="seal-dot" aria-hidden="true" />
            <span className="text-[13px] text-paper-1">
              {total} ballot{total !== 1 ? "s" : ""} sealed
            </span>
          </div>
          <span className="redact-bar font-mono text-[12px] tracking-widest" aria-hidden="true">
            ▓▓▓ ▓▓▓ ▓▓▓
          </span>
        </div>
      )}

      {/* Ended but not revealed */}
      {!active && !p.isRevealed && !canReveal && (
        <div className="mt-5 pt-4 h-meta" style={{ borderTop: "1px solid var(--ink-3)" }}>
          Voting ended. Connect your wallet to reveal results.
        </div>
      )}
    </article>
  );
}

/* ============== Sub-components ============== */

function StatusBadge({ status }: { status: { label: string; tone: "active" | "revealed" | "crit" | "neutral" } }) {
  const styles = {
    active: { color: "var(--seal)", border: "1px solid var(--seal-line)", background: "var(--seal-soft)" },
    revealed: { color: "var(--reveal)", border: "1px solid var(--reveal-line)", background: "var(--reveal-soft)" },
    crit: { color: "var(--crit)", border: "1px solid var(--crit-soft)", background: "var(--crit-soft)" },
    neutral: { color: "var(--paper-2)", border: "1px solid var(--ink-3)", background: "transparent" },
  } as const;
  const s = styles[status.tone];
  return (
    <span
      className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 inline-flex items-center gap-1"
      style={{ ...s, borderRadius: 4 }}
    >
      {status.tone === "active" && <span style={{ width: 5, height: 5, borderRadius: 999, background: "currentColor" }} />}
      {status.label}
    </span>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="leading-tight">
      <div className="h-eyebrow">{label}</div>
      <div className="text-[13px] text-paper-1 font-mono tabular-nums">{value}</div>
    </div>
  );
}

function VoteButton({
  kind,
  selected,
  disabled,
  onClick,
  small,
  children,
}: {
  kind: "yes" | "no" | "abstain";
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`btn-vote is-${kind} ${selected ? "is-selected" : ""} ${small ? "py-1.5 text-[10.5px]" : ""}`}
      style={small ? { fontSize: 10.5 } : undefined}
    >
      {children}
    </button>
  );
}

function ResultCell({ label, count, pct, tone }: { label: string; count: number; pct: number; tone: "reveal" | "crit" | "steel" }) {
  const color = tone === "reveal" ? "var(--reveal)" : tone === "crit" ? "var(--crit)" : "var(--steel)";
  return (
    <div className="text-center">
      <div className="h-eyebrow mb-1">{label}</div>
      <div className="font-display text-paper-0 text-[24px] tracking-tighter leading-none mb-1" style={{ color }}>
        {count}
      </div>
      <div className="font-mono text-[10.5px] tabular-nums" style={{ color: "var(--paper-3)" }}>
        {pct}%
      </div>
    </div>
  );
}

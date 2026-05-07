import { Proposal } from "./ProposalCard";
import { formatCompactNumber } from "../lib/format";

interface StatsBarProps {
  proposals: Proposal[];
  nowTs: number;
}

export function StatsBar({ proposals, nowTs }: StatsBarProps) {
  const totalProposals = proposals.length;
  const activeProposals = proposals.filter(
    (p) => p.isActive && nowTs < Number(p.votingEndsAt)
  ).length;
  const totalVotes = proposals.reduce((sum, p) => sum + (p.totalVotes || 0), 0);
  const revealedCount = proposals.filter((p) => p.isRevealed).length;

  const stats = [
    { label: "Proposals", value: formatCompactNumber(totalProposals), sub: `${revealedCount} revealed` },
    { label: "Active", value: String(activeProposals), sub: activeProposals === 0 ? "none open" : "voting now", live: activeProposals > 0 },
    { label: "Ballots cast", value: formatCompactNumber(totalVotes), sub: `across ${activeProposals} open` },
  ];

  return (
    <div className="panel">
      <div className="grid grid-cols-3 divide-x" style={{ borderColor: "var(--ink-3)" }}>
        {stats.map((s) => (
          <div key={s.label} className="px-5 py-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="h-eyebrow">{s.label}</span>
              {s.live && <span className="seal-dot seal-dot-pulse" aria-hidden="true" style={{ width: 6, height: 6 }} />}
            </div>
            <div className="font-display text-paper-0 text-[28px] sm:text-[32px] tracking-tighter leading-none mb-1.5">
              {s.value}
            </div>
            <div className="h-meta">{s.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { Proposal } from "./ProposalCard";

interface StatsBarProps {
  proposals: Proposal[];
  nowTs: number;
}

export function StatsBar({ proposals, nowTs }: StatsBarProps) {
  const totalProposals = proposals.length;
  const activeProposals = proposals.filter(
    (p) => p.isActive && nowTs < p.votingEndsAt.toNumber()
  ).length;
  const totalVotes = proposals.reduce((sum, p) => sum + (p.totalVotes || 0), 0);
  const revealedCount = proposals.filter((p) => p.isRevealed).length;

  const stats = [
    { label: "Proposals", value: totalProposals, color: "text-purple-400" },
    { label: "Active", value: activeProposals, color: "text-green-400" },
    { label: "Total Votes", value: totalVotes, color: "text-cyan-400" },
    { label: "Revealed", value: revealedCount, color: "text-blue-400" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="glass-card p-3 text-center border border-white/5"
        >
          <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          <p className="text-[11px] text-gray-500 uppercase tracking-wider">
            {s.label}
          </p>
        </div>
      ))}
    </div>
  );
}

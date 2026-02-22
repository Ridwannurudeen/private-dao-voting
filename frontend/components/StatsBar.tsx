import { Proposal } from "./ProposalCard";
import { LockIcon, ShieldCheckIcon } from "./Icons";

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
    {
      label: "Proposals",
      value: totalProposals,
      icon: <LockIcon className="w-4 h-4" />,
      color: "text-purple-400",
      bg: "bg-purple-500/10",
      border: "border-purple-500/20",
    },
    {
      label: "Active",
      value: activeProposals,
      icon: <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />,
      color: "text-green-400",
      bg: "bg-green-500/10",
      border: "border-green-500/20",
    },
    {
      label: "Total Votes",
      value: totalVotes,
      icon: <ShieldCheckIcon className="w-4 h-4" />,
      color: "text-cyan-400",
      bg: "bg-cyan-500/10",
      border: "border-cyan-500/20",
    },
    {
      label: "Revealed",
      value: revealedCount,
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      ),
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      border: "border-blue-500/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className={`glass-card-elevated p-4 flex items-center gap-3 border ${s.border}`}
        >
          <div className={`w-10 h-10 rounded-xl ${s.bg} border ${s.border} flex items-center justify-center shrink-0 ${s.color}`}>
            {s.icon}
          </div>
          <div>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">{s.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

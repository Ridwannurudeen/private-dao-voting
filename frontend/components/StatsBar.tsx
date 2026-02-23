import { Proposal } from "./ProposalCard";
import { LockIcon, ShieldCheckIcon } from "./Icons";
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
  const poolValue = proposals.reduce((sum, p) => sum + (p.depositAmount || 0), 0);

  const stats = [
    {
      label: "Pool Value",
      value: formatCompactNumber(poolValue || totalVotes),
      sub: `${totalProposals} proposal${totalProposals !== 1 ? "s" : ""} total`,
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      ),
      color: "text-purple-400",
      bg: "bg-purple-500/10",
      border: "border-purple-500/20",
    },
    {
      label: "Active Proposals",
      value: String(activeProposals),
      sub: `${revealedCount} revealed`,
      icon: <span className="w-3 h-3 rounded-full bg-green-400 animate-pulse" />,
      color: "text-green-400",
      bg: "bg-green-500/10",
      border: "border-green-500/20",
    },
    {
      label: "Total Votes",
      value: formatCompactNumber(totalVotes),
      sub: `across ${activeProposals} active`,
      icon: <ShieldCheckIcon className="w-5 h-5" />,
      color: "text-cyan-400",
      bg: "bg-cyan-500/10",
      border: "border-cyan-500/20",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className={`glass-card-elevated p-5 border ${s.border} hover:border-opacity-40 transition-all`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className={`w-10 h-10 rounded-xl ${s.bg} border ${s.border} flex items-center justify-center shrink-0 ${s.color}`}>
              {s.icon}
            </div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">{s.label}</p>
          </div>
          <p className={`text-3xl font-bold ${s.color} mb-0.5`}>{s.value}</p>
          <p className="text-[11px] text-gray-500">{s.sub}</p>
        </div>
      ))}
    </div>
  );
}

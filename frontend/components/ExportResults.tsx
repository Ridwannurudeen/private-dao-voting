import { Proposal } from "./ProposalCard";

interface ExportResultsProps {
  proposal: Proposal;
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportResults({ proposal: p }: ExportResultsProps) {
  const total = p.totalVotes || 0;
  const yes = p.yesVotes || 0;
  const no = p.noVotes || 0;
  const abstain = p.abstainVotes || 0;

  const exportJSON = () => {
    const data = {
      proposal: p.title,
      id: p.id.toString(),
      authority: p.authority.toString(),
      results: { yes, no, abstain, total },
      quorum: p.quorum,
      quorumMet: p.quorum > 0 ? total >= p.quorum : null,
      votingEndedAt: new Date(p.votingEndsAt.toNumber() * 1000).toISOString(),
    };
    downloadFile(
      `proposal-${p.id.toString()}.json`,
      JSON.stringify(data, null, 2),
      "application/json"
    );
  };

  const exportCSV = () => {
    const rows = [
      ["Field", "Value"],
      ["Title", p.title],
      ["ID", p.id.toString()],
      ["Authority", p.authority.toString()],
      ["Yes Votes", String(yes)],
      ["No Votes", String(no)],
      ["Abstain Votes", String(abstain)],
      ["Total Votes", String(total)],
      ["Quorum", String(p.quorum)],
      ["Quorum Met", p.quorum > 0 ? String(total >= p.quorum) : "N/A"],
      ["Voting Ended", new Date(p.votingEndsAt.toNumber() * 1000).toISOString()],
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    downloadFile(`proposal-${p.id.toString()}.csv`, csv, "text/csv");
  };

  return (
    <div className="flex gap-2 mt-2">
      <button
        onClick={exportJSON}
        className="px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-[11px] text-gray-400 hover:text-cyan-400 hover:border-cyan-500/20 transition-all"
      >
        Export JSON
      </button>
      <button
        onClick={exportCSV}
        className="px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-[11px] text-gray-400 hover:text-cyan-400 hover:border-cyan-500/20 transition-all"
      >
        Export CSV
      </button>
    </div>
  );
}

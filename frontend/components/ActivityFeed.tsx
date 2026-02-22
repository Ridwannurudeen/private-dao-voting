import { useState, useEffect, useCallback } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "../lib/contract";
import { LockIcon, ShieldCheckIcon, UnlockIcon } from "./Icons";

interface ActivityItem {
  type: "vote" | "proposal" | "reveal" | "delegation";
  signature: string;
  timestamp: number;
  label: string;
}

interface ActivityFeedProps {
  connection: Connection;
}

function parseLogEvent(logs: string[]): ActivityItem["type"] | null {
  const joined = logs.join(" ");
  if (joined.includes("DevCastVote") || joined.includes("CastVote") || joined.includes("VoteCast"))
    return "vote";
  if (joined.includes("DevCreateProposal") || joined.includes("CreateProposal") || joined.includes("ProposalCreated"))
    return "proposal";
  if (joined.includes("RevealResults") || joined.includes("ResultsRevealed"))
    return "reveal";
  if (joined.includes("DelegateVote") || joined.includes("VoteDelegated"))
    return "delegation";
  return null;
}

const labels: Record<ActivityItem["type"], string> = {
  vote: "Vote cast",
  proposal: "Proposal created",
  reveal: "Results revealed",
  delegation: "Vote delegated",
};

const icons: Record<ActivityItem["type"], React.ReactNode> = {
  vote: <ShieldCheckIcon className="w-3.5 h-3.5 text-cyan-400" />,
  proposal: <LockIcon className="w-3.5 h-3.5 text-purple-400" />,
  reveal: <UnlockIcon className="w-3.5 h-3.5 text-blue-400" />,
  delegation: <ShieldCheckIcon className="w-3.5 h-3.5 text-emerald-400" />,
};

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return diff + "s ago";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

export function ActivityFeed({ connection }: ActivityFeedProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActivity = useCallback(async () => {
    try {
      const signatures = await connection.getSignaturesForAddress(PROGRAM_ID, {
        limit: 20,
      });

      const items: ActivityItem[] = [];
      for (const sig of signatures.slice(0, 10)) {
        try {
          const tx = await connection.getTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });
          if (!tx?.meta?.logMessages) continue;
          const eventType = parseLogEvent(tx.meta.logMessages);
          if (eventType) {
            items.push({
              type: eventType,
              signature: sig.signature,
              timestamp: sig.blockTime || 0,
              label: labels[eventType],
            });
          }
        } catch {
          // Skip unparseable transactions
        }
      }
      setActivities(items);
    } catch (e) {
      console.error("Activity feed error:", e);
    }
    setLoading(false);
  }, [connection]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  if (loading) {
    return (
      <div className="glass-card-elevated p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Recent Activity</h3>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 bg-white/5 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (activities.length === 0) return null;

  return (
    <div className="glass-card-elevated p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Recent Activity</h3>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {activities.map((a) => (
          <div
            key={a.signature}
            className="flex items-center justify-between text-xs py-1.5 border-b border-white/5 last:border-0"
          >
            <div className="flex items-center gap-2">
              {icons[a.type]}
              <span className="text-gray-300">{a.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">{a.timestamp ? timeAgo(a.timestamp) : ""}</span>
              <a
                href={`https://explorer.solana.com/tx/${a.signature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400/60 hover:text-cyan-400 transition-colors"
              >
                {a.signature.slice(0, 6)}...
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

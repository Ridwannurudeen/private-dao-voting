import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { DEFAULT_GATE_MINT } from "../lib/contract";
import { DEVELOPMENT_MODE } from "../lib/arcium";
import { Modal } from "./Modal";
import { ShieldCheckIcon } from "./Icons";

interface CreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (title: string, desc: string, duration: number, gateMint: string, minBalance: string, quorum: string) => void;
  loading: boolean;
}

export function CreateModal({ isOpen, onClose, onSubmit, loading }: CreateModalProps) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [duration, setDuration] = useState(86400);
  const [gateMint, setGateMint] = useState(DEFAULT_GATE_MINT.toString());
  const [minBalance, setMinBalance] = useState("1");
  const [quorum, setQuorum] = useState("0");

  const [validationError, setValidationError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError("");

    if (!title.trim() || !desc.trim()) {
      setValidationError("Title and description are required.");
      return;
    }

    try {
      new PublicKey(gateMint.trim());
    } catch {
      setValidationError("Invalid gate token mint address.");
      return;
    }

    const bal = Number(minBalance.trim());
    if (isNaN(bal) || bal < 0 || !Number.isInteger(bal)) {
      setValidationError("Minimum balance must be a non-negative integer.");
      return;
    }

    const q = Number(quorum.trim() || "0");
    if (isNaN(q) || q < 0 || !Number.isInteger(q)) {
      setValidationError("Quorum must be a non-negative integer.");
      return;
    }

    onSubmit(title, desc, duration, gateMint.trim(), minBalance.trim(), quorum.trim() || "0");
  };

  const durations = [
    { label: "5 min", seconds: 300 },
    { label: "1 hour", seconds: 3600 },
    { label: "24 hours", seconds: 86400 },
    { label: "3 days", seconds: 259200 },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="p-6 border-b border-white/10 flex justify-between items-center">
        <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">Create Private Proposal</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">&times;</button>
      </div>
      <form onSubmit={submit} className="p-6 space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Title ({title.length}/100)</label>
          <input
            value={title} onChange={(e) => setTitle(e.target.value.slice(0, 100))}
            placeholder="Enter proposal title..."
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/30 transition-all"
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Description ({desc.length}/500)</label>
          <textarea
            value={desc} onChange={(e) => setDesc(e.target.value.slice(0, 500))}
            placeholder="Describe your proposal..." rows={3}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/30 transition-all"
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-2">Voting Duration</label>
          <div className="flex gap-2 flex-wrap">
            {durations.map((d) => (
              <button key={d.seconds} type="button" onClick={() => setDuration(d.seconds)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${duration === d.seconds ? "bg-gradient-to-r from-purple-600 to-cyan-500 text-white shadow-cyan-glow" : "bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10"}`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Gate Token Mint</label>
          <input value={gateMint} onChange={(e) => setGateMint(e.target.value)}
            placeholder="Token mint address..."
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/30 transition-all"
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Minimum Token Balance</label>
          <input value={minBalance} onChange={(e) => setMinBalance(e.target.value)}
            placeholder="1"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/30 transition-all"
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Quorum (minimum votes required, 0 = none)</label>
          <input value={quorum} onChange={(e) => setQuorum(e.target.value)}
            placeholder="0"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/30 transition-all"
            disabled={loading}
          />
        </div>
        {validationError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
            <p className="text-sm text-red-400">{validationError}</p>
          </div>
        )}
        <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-4">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="w-4 h-4 text-cyan-400" />
            <p className="text-sm text-cyan-400">{DEVELOPMENT_MODE ? "Dev mode: votes encrypted locally via x25519 + RescueCipher" : "Votes encrypted via Arcium MXE cluster"}</p>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-semibold transition-all">Cancel</button>
          <button type="submit" disabled={!title.trim() || !desc.trim() || !gateMint.trim() || !minBalance.trim() || loading}
            className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-cyan-500 rounded-xl font-semibold disabled:opacity-50 hover:shadow-lg hover:shadow-cyan-500/20 transition-all">
            {loading ? "Creating..." : "Create Proposal"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

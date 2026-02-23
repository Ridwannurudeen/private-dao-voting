import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { DEFAULT_GATE_MINT } from "../lib/contract";
import { DEVELOPMENT_MODE } from "../lib/arcium";
import { Modal } from "./Modal";
import { ShieldCheckIcon, LockIcon } from "./Icons";

interface CreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    title: string,
    desc: string,
    duration: number,
    gateMint: string,
    minBalance: string,
    quorum: string,
    thresholdBps: number,
    privacyLevel: number,
    discussionUrl: string,
    executionDelay: number
  ) => void;
  loading: boolean;
}

const PRIVACY_LEVELS = [
  {
    value: 0,
    label: "Full Privacy",
    desc: "Voters & tally hidden until end",
    detail: "Best for elections & high-stakes governance",
  },
  {
    value: 1,
    label: "Partial Privacy",
    desc: "Voters hidden, voter list shown after",
    detail: "Best for committees & grant decisions",
  },
  {
    value: 2,
    label: "Transparent Tally",
    desc: "Voters hidden, live tally visible",
    detail: "Best for polls & temperature checks",
  },
];

const THRESHOLD_PRESETS = [
  { label: "Simple Majority", bps: 5001 },
  { label: "60%", bps: 6000 },
  { label: "Two-Thirds", bps: 6667 },
  { label: "80%", bps: 8000 },
];

export function CreateModal({ isOpen, onClose, onSubmit, loading }: CreateModalProps) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [duration, setDuration] = useState(86400);
  const [gateMint, setGateMint] = useState(DEFAULT_GATE_MINT.toString());
  const [minBalance, setMinBalance] = useState("1");
  const [quorum, setQuorum] = useState("0");
  const [thresholdBps, setThresholdBps] = useState(5001);
  const [privacyLevel, setPrivacyLevel] = useState(0);
  const [discussionUrl, setDiscussionUrl] = useState("");
  const [executionDelay, setExecutionDelay] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

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

    if (discussionUrl.trim()) {
      try {
        new URL(discussionUrl.trim());
      } catch {
        setValidationError("Discussion URL must be a valid URL.");
        return;
      }
    }

    onSubmit(
      title,
      desc,
      duration,
      gateMint.trim(),
      minBalance.trim(),
      quorum.trim() || "0",
      thresholdBps,
      privacyLevel,
      discussionUrl.trim(),
      executionDelay
    );
  };

  const durations = [
    { label: "5 min", seconds: 300 },
    { label: "1 hour", seconds: 3600 },
    { label: "24 hours", seconds: 86400 },
    { label: "3 days", seconds: 259200 },
  ];

  const executionDelays = [
    { label: "None", seconds: 0 },
    { label: "1 hour", seconds: 3600 },
    { label: "24 hours", seconds: 86400 },
    { label: "72 hours", seconds: 259200 },
  ];

  const thresholdPct = (thresholdBps / 100).toFixed(1);

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="p-6 border-b border-white/10 flex justify-between items-center">
        <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">Create Private Proposal</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">&times;</button>
      </div>
      <form onSubmit={submit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
        {/* Title */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Title ({title.length}/100)</label>
          <input
            value={title} onChange={(e) => setTitle(e.target.value.slice(0, 100))}
            placeholder="Enter proposal title..."
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white caret-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/30 transition-all"
            disabled={loading}
          />
        </div>

        {/* Description with Markdown */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm text-gray-400">Description ({desc.length}/5000)</label>
            <div className="flex gap-1">
              <button type="button" onClick={() => setShowPreview(false)}
                className={`px-2 py-0.5 text-xs rounded ${!showPreview ? "bg-cyan-500/20 text-cyan-400" : "text-gray-500 hover:text-gray-300"}`}>
                Edit
              </button>
              <button type="button" onClick={() => setShowPreview(true)}
                className={`px-2 py-0.5 text-xs rounded ${showPreview ? "bg-cyan-500/20 text-cyan-400" : "text-gray-500 hover:text-gray-300"}`}>
                Preview
              </button>
            </div>
          </div>
          {showPreview ? (
            <div className="w-full min-h-[120px] max-h-[200px] overflow-y-auto px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-gray-300 prose prose-sm prose-invert max-w-none">
              {desc ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                  {desc}
                </ReactMarkdown>
              ) : (
                <p className="text-gray-500 italic">Nothing to preview</p>
              )}
            </div>
          ) : (
            <textarea
              value={desc} onChange={(e) => setDesc(e.target.value.slice(0, 5000))}
              placeholder="Describe your proposal... (Markdown supported: **bold**, *italic*, ## headings, - lists, | tables |)"
              rows={4}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white caret-cyan-400 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/30 transition-all font-mono text-sm"
              disabled={loading}
            />
          )}
          <p className="text-[10px] text-gray-600 mt-1">Supports Markdown: **bold**, *italic*, ## headings, tables, links</p>
        </div>

        {/* Discussion URL */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Discussion URL (optional)</label>
          <input
            value={discussionUrl}
            onChange={(e) => setDiscussionUrl(e.target.value)}
            placeholder="https://forum.dao.xyz/proposal-42"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white caret-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/30 transition-all text-sm"
            disabled={loading}
          />
          {discussionUrl.trim() && (
            <p className="text-[10px] text-yellow-400/60 mt-1 flex items-center gap-1">
              External link — your wallet address will NOT be shared, but your IP may be visible to the forum operator.
            </p>
          )}
        </div>

        <div className="border-t border-white/5 pt-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-medium">Voting Rules</p>

          {/* Duration */}
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">Duration</label>
            <div className="flex gap-2 flex-wrap">
              {durations.map((d) => (
                <button key={d.seconds} type="button" onClick={() => setDuration(d.seconds)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${duration === d.seconds ? "bg-gradient-to-r from-purple-600 to-cyan-500 text-white shadow-cyan-glow" : "bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10"}`}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quorum */}
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-1">Quorum (minimum votes required, 0 = none)</label>
            <input value={quorum} onChange={(e) => setQuorum(e.target.value)}
              placeholder="0"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white caret-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/30 transition-all"
              disabled={loading}
            />
          </div>

          {/* Passing Threshold */}
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">Passing Threshold ({thresholdPct}% of non-abstain votes must be YES)</label>
            <input
              type="range"
              min={1}
              max={10000}
              step={1}
              value={thresholdBps}
              onChange={(e) => setThresholdBps(Number(e.target.value))}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-500"
              disabled={loading}
            />
            <div className="flex gap-2 flex-wrap mt-2">
              {THRESHOLD_PRESETS.map((p) => (
                <button
                  key={p.bps}
                  type="button"
                  onClick={() => setThresholdBps(p.bps)}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-all ${thresholdBps === p.bps ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Privacy Level */}
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">Privacy Level</label>
            <div className="grid grid-cols-3 gap-2">
              {PRIVACY_LEVELS.map((pl) => (
                <button
                  key={pl.value}
                  type="button"
                  onClick={() => setPrivacyLevel(pl.value)}
                  className={`p-3 rounded-xl text-left transition-all border ${privacyLevel === pl.value ? "bg-cyan-500/10 border-cyan-500/30" : "bg-white/3 border-white/8 hover:border-white/15"}`}
                >
                  <p className={`text-xs font-semibold mb-0.5 ${privacyLevel === pl.value ? "text-cyan-400" : "text-gray-300"}`}>
                    {pl.value === privacyLevel && <span className="mr-1">&#x25CF;</span>}
                    {pl.label}
                  </p>
                  <p className="text-[10px] text-gray-500 leading-tight">{pl.desc}</p>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-600 mt-1.5 flex items-center gap-1">
              <LockIcon className="w-2.5 h-2.5 text-cyan-400/50" />
              All levels encrypt individual vote choices. No one ever sees HOW you voted.
            </p>
          </div>

          {/* Execution Delay */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Execution Delay (timelock after reveal)</label>
            <div className="flex gap-2 flex-wrap">
              {executionDelays.map((d) => (
                <button key={d.seconds} type="button" onClick={() => setExecutionDelay(d.seconds)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${executionDelay === d.seconds ? "bg-gradient-to-r from-purple-600 to-cyan-500 text-white shadow-cyan-glow" : "bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10"}`}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-white/5 pt-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-medium">Access Control</p>

          {/* Gate Token */}
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-1">Gate Token Mint</label>
            <input value={gateMint} onChange={(e) => setGateMint(e.target.value)}
              placeholder="Token mint address..."
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white caret-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/30 transition-all"
              disabled={loading}
            />
          </div>

          {/* Min Balance */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Minimum Token Balance</label>
            <input value={minBalance} onChange={(e) => setMinBalance(e.target.value)}
              placeholder="1"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white caret-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/30 transition-all"
              disabled={loading}
            />
          </div>
        </div>

        {/* Quorum + Threshold Preview */}
        {(Number(quorum) > 0 || thresholdBps !== 5001) && (
          <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-3">
            <p className="text-xs text-purple-400/80">
              {Number(quorum) > 0 && <>Need {"\u2265"}{quorum} votes to reach quorum. </>}
              Of non-abstain votes, {"\u2265"}{thresholdPct}% must be YES to pass.
            </p>
          </div>
        )}

        {validationError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
            <p className="text-sm text-red-400">{validationError}</p>
          </div>
        )}

        <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-4">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="w-4 h-4 text-cyan-400" />
            <p className="text-sm text-cyan-400">
              {DEVELOPMENT_MODE
                ? "Dev mode: votes encrypted locally via x25519 + RescueCipher"
                : "Votes encrypted via Arcium MXE cluster"}
              {" | "}
              {PRIVACY_LEVELS[privacyLevel].label}
            </p>
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

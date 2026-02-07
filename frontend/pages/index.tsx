import { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { AnchorProvider, Program, BN, Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  PROGRAM_ID,
  DEFAULT_GATE_MINT,
  findProposalPDA,
  findTallyPDA,
  findVoteRecordPDA,
  devCreateProposal,
  devInitTally,
  devCastVote,
  castVoteWithArcium,
  devRevealResults,
} from "../lib/contract";
import {
  ArciumClient,
  createArciumClient,
  MXE_PROGRAM_ID,
  DEVELOPMENT_MODE,
  DEVNET_CLUSTER_OFFSET,
  ArciumStatusEvent,
  deriveComputationOffset,
} from "../lib/arcium";
import { GetProgramAccountsFilter } from "@solana/web3.js";

// Load the generated IDL at build time
import generatedIdl from "../idl/private_dao_voting.json";

// ==================== INLINE SVG ICONS ====================
const LockIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const UnlockIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </svg>
);

const ShieldCheckIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

const CloudNodesIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    <circle cx="8" cy="14" r="1" fill="currentColor" />
    <circle cx="13" cy="14" r="1" fill="currentColor" />
    <circle cx="16" cy="17" r="1" fill="currentColor" />
    <path d="M8 14h5M13 14l3 3" />
  </svg>
);

const DocumentCheckIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M9 15l2 2 4-4" />
  </svg>
);

// ==================== HELPERS ====================
function formatTime(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return "Ended";
  const hours = Math.floor(secondsRemaining / 3600);
  const minutes = Math.floor((secondsRemaining % 3600) / 60);
  if (hours > 24) return Math.floor(hours / 24) + "d " + (hours % 24) + "h";
  if (hours > 0) return hours + "h " + minutes + "m";
  if (minutes > 0) return minutes + "m";
  return Math.floor(secondsRemaining) + "s";
}

// ==================== COMPONENTS ====================
function Modal({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-card shadow-2xl shadow-purple-500/10 w-full max-w-lg mx-4">{children}</div>
    </div>
  );
}

function Toast({ message, type, onClose }: { message: string; type: "success" | "error" | "info"; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const colors: Record<string, string> = {
    success: "bg-green-500/10 backdrop-blur-xl border-green-500/30 text-green-400 shadow-lg shadow-green-500/10",
    error: "bg-red-500/10 backdrop-blur-xl border-red-500/30 text-red-400 shadow-lg shadow-red-500/10",
    info: "bg-cyan-500/10 backdrop-blur-xl border-cyan-500/30 text-cyan-400 shadow-lg shadow-cyan-500/10",
  };
  const icons: Record<string, string> = { success: "\u2713", error: "\u2715", info: "\uD83D\uDD10" };

  return (
    <div className={`fixed bottom-6 right-6 px-6 py-4 rounded-xl flex items-center gap-3 z-50 border ${colors[type]}`}>
      <span>{icons[type]}</span>
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 hover:opacity-70">&times;</button>
    </div>
  );
}

function CreateModal({ isOpen, onClose, onSubmit, loading }: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (t: string, d: string, s: number, m: string, b: string) => void;
  loading: boolean;
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [duration, setDuration] = useState(86400);
  const [gateMint, setGateMint] = useState(DEFAULT_GATE_MINT.toString());
  const [minBalance, setMinBalance] = useState("1");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim() && desc.trim() && gateMint.trim() && minBalance.trim()) {
      onSubmit(title, desc, duration, gateMint.trim(), minBalance.trim());
    }
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

// ==================== MAIN ====================
interface Proposal {
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

export default function Home() {
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();

  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [voting, setVoting] = useState<Record<string, boolean>>({});
  const [revealing, setRevealing] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, "yes" | "no" | "abstain" | null>>({});
  const [voted, setVoted] = useState<Record<string, boolean>>({});
  const [nowTs, setNowTs] = useState(Math.floor(Date.now() / 1000));
  const [arciumClient, setArciumClient] = useState<ArciumClient | null>(null);
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [tokenBalances, setTokenBalances] = useState<Record<string, number>>({});
  const [claiming, setClaiming] = useState<Record<string, boolean>>({});
  const [showTechDeep, setShowTechDeep] = useState(false);
  const [hiddenProposals, setHiddenProposals] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem("hiddenProposals") || "[]")); } catch { return new Set(); }
  });

  const toggleHideProposal = (key: string) => {
    setHiddenProposals((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem("hiddenProposals", JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const getProgram = useCallback(() => {
    if (!anchorWallet) return null;
    const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
    return new Program(generatedIdl as unknown as Idl, provider);
  }, [connection, anchorWallet]);

  // Update clock every 5 seconds
  useEffect(() => {
    const tick = () => setNowTs(Math.floor(Date.now() / 1000));
    tick();
    const i = setInterval(tick, 5000);
    return () => clearInterval(i);
  }, []);

  // Initialize ArciumClient when wallet connects
  useEffect(() => {
    if (!anchorWallet || !connected) {
      setArciumClient(null);
      return;
    }

    const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
    const client = createArciumClient(provider, DEVNET_CLUSTER_OFFSET);

    const unsub = client.onStatusChange((event: ArciumStatusEvent) => {
      setIsEncrypting(event.status === "ENCRYPTING");
    });

    client.initialize(MXE_PROGRAM_ID).then((success) => {
      if (success) {
        setArciumClient(client);
        console.log("Arcium client initialized", DEVELOPMENT_MODE ? "(dev mode)" : "(production)");
      }
    });

    return () => { unsub(); };
  }, [connected, anchorWallet, connection]);

  // Proposal account discriminator from the IDL
  const PROPOSAL_DISCRIMINATOR = [26, 94, 189, 187, 116, 136, 53, 33];

  // Check token balances for all proposals
  const checkTokenBalances = useCallback(async (proposalList: Proposal[]) => {
    if (!publicKey) return;
    const balances: Record<string, number> = {};
    for (const p of proposalList) {
      try {
        const ata = getAssociatedTokenAddressSync(p.gateMint, publicKey);
        const info = await connection.getTokenAccountBalance(ata);
        balances[p.publicKey.toString()] = Number(info.value.amount);
      } catch {
        balances[p.publicKey.toString()] = 0;
      }
    }
    setTokenBalances(balances);
  }, [publicKey, connection]);

  // Load all proposals (resilient to corrupt/stale accounts)
  const load = useCallback(async () => {
    const program = getProgram();
    if (!program) return;
    setLoading(true);
    try {
      // Use raw getProgramAccounts with discriminator filter so that
      // a single corrupt account doesn't break the entire load.
      const discriminatorFilter: GetProgramAccountsFilter = {
        memcmp: {
          offset: 0,
          bytes: Buffer.from(PROPOSAL_DISCRIMINATOR).toString("base64"),
          encoding: "base64",
        },
      };

      const rawAccounts = await connection.getProgramAccounts(
        PROGRAM_ID,
        { filters: [discriminatorFilter] }
      );

      const mapped: Proposal[] = [];
      for (const raw of rawAccounts) {
        try {
          const a = program.coder.accounts.decode("proposal", raw.account.data);
          mapped.push({
            publicKey: raw.pubkey,
            id: a.id,
            authority: a.authority,
            title: a.title,
            description: a.description,
            votingEndsAt: a.votingEndsAt ?? a.voting_ends_at,
            isActive: a.isActive ?? a.is_active,
            isRevealed: a.isRevealed ?? a.is_revealed,
            totalVotes: a.totalVotes ?? a.total_votes ?? 0,
            gateMint: a.gateMint ?? a.gate_mint,
            minBalance: a.minBalance ?? a.min_balance,
            yesVotes: a.yesVotes ?? a.yes_votes ?? 0,
            noVotes: a.noVotes ?? a.no_votes ?? 0,
            abstainVotes: a.abstainVotes ?? a.abstain_votes ?? 0,
          });
        } catch {
          console.warn(
            "Skipping undeserializable proposal account:",
            raw.pubkey.toBase58()
          );
        }
      }
      setProposals(mapped);
      checkTokenBalances(mapped);

      if (publicKey) {
        const v: Record<string, boolean> = {};
        for (const p of mapped) {
          try {
            const [pda] = findVoteRecordPDA(p.publicKey, publicKey);
            await (program.account as any).voteRecord.fetch(pda);
            v[p.publicKey.toString()] = true;
          } catch {
            v[p.publicKey.toString()] = false;
          }
        }
        setVoted(v);
      }
    } catch (e: any) {
      console.error("Load failed:", e);
    }
    setLoading(false);
  }, [getProgram, publicKey, connection, checkTokenBalances]);

  // Claim gate tokens via faucet
  const claimTokens = async (proposal: Proposal) => {
    if (!publicKey) return;
    const key = proposal.publicKey.toString();
    setClaiming((c) => ({ ...c, [key]: true }));
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: publicKey.toBase58() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Faucet request failed");
      setToast({ message: "Gate tokens claimed! You can now vote.", type: "success" });
      await checkTokenBalances(proposals);
    } catch (e: any) {
      console.error("Claim error:", e);
      setToast({ message: e.message || "Failed to claim tokens", type: "error" });
    }
    setClaiming((c) => ({ ...c, [key]: false }));
  };

  // Auto-load when wallet connects
  useEffect(() => {
    if (connected && anchorWallet) load();
  }, [connected, anchorWallet, load]);

  // Create proposal
  const create = async (title: string, desc: string, duration: number, gateMintStr: string, minBalanceStr: string) => {
    const program = getProgram();
    if (!program || !publicKey) return;
    setCreating(true);
    try {
      const gateMint = new PublicKey(gateMintStr);
      const minBalance = new BN(minBalanceStr);

      // Step 1: Create proposal
      const { proposalPDA } = await devCreateProposal(
        program, publicKey, title, desc, duration, gateMint, minBalance
      );

      // Step 2: Initialize tally
      await devInitTally(program, publicKey, proposalPDA);

      setToast({ message: "Proposal created with tally initialized!", type: "success" });
      setModal(false);
      load();
    } catch (e: any) {
      console.error("Create failed:", e);
      setToast({ message: e.message || "Failed to create proposal", type: "error" });
    }
    setCreating(false);
  };

  // Cast vote
  const vote = async (proposal: Proposal, choice: "yes" | "no" | "abstain") => {
    const program = getProgram();
    if (!program || !publicKey) return;

    const key = proposal.publicKey.toString();
    setVoting((v) => ({ ...v, [key]: true }));

    try {
      // Ensure ArciumClient is ready
      let client = arciumClient;
      if (!client) {
        const provider = new AnchorProvider(connection, anchorWallet!, { commitment: "confirmed" });
        client = createArciumClient(provider, DEVNET_CLUSTER_OFFSET);
        await client.initialize(MXE_PROGRAM_ID);
        setArciumClient(client);
      }

      // Encrypt the vote
      const voteValue: 0 | 1 | 2 = choice === "yes" ? 1 : choice === "abstain" ? 2 : 0;
      setIsEncrypting(true);
      const encryptedVote = await client.encryptVote(voteValue, proposal.publicKey, publicKey);

      console.log("Encrypted vote ciphertext preview:", Array.from(encryptedVote.ciphertext.slice(0, 8)));

      // Convert to on-chain format
      const secretInput = client.toSecretInput(encryptedVote, publicKey);
      setIsEncrypting(false);

      if (DEVELOPMENT_MODE) {
        // Dev mode: use dev_cast_vote instruction (no Arcium CPI)
        await devCastVote(
          program, publicKey, proposal.publicKey, proposal.gateMint,
          secretInput.encryptedChoice, secretInput.nonce, secretInput.voterPubkey
        );
      } else {
        // Production mode: use cast_vote instruction with full Arcium accounts
        const computationOffset = deriveComputationOffset(proposal.publicKey, Date.now());
        const arciumAccounts = client.getArciumAccounts("vote", computationOffset);
        await castVoteWithArcium(
          program, publicKey, proposal.publicKey, proposal.gateMint,
          secretInput.encryptedChoice, secretInput.nonce, secretInput.voterPubkey,
          arciumAccounts
        );
      }

      setToast({ message: "Encrypted vote recorded on-chain!", type: "success" });
      setVoted((v) => ({ ...v, [key]: true }));
      setSelected((s) => ({ ...s, [key]: null }));
      load();
    } catch (e: any) {
      console.error("Vote error:", e);
      setIsEncrypting(false);
      setToast({ message: e.message || "Vote failed", type: "error" });
    }
    setVoting((v) => ({ ...v, [key]: false }));
  };

  // Reveal results (authority only)
  const reveal = async (proposal: Proposal) => {
    const program = getProgram();
    if (!program || !publicKey) return;

    const key = proposal.publicKey.toString();
    setRevealing((r) => ({ ...r, [key]: true }));

    try {
      // In dev mode, the authority provides the counts manually.
      // In a real scenario, MXE would compute these from encrypted votes.
      await devRevealResults(
        program,
        publicKey,
        proposal.publicKey,
        proposal.totalVotes, // For dev mode: assume all votes are YES
        0,
        0
      );

      setToast({ message: "Results revealed!", type: "success" });
      load();
    } catch (e: any) {
      console.error("Reveal error:", e);
      setToast({ message: e.message || "Reveal failed", type: "error" });
    }
    setRevealing((r) => ({ ...r, [key]: false }));
  };

  const isActive = (p: Proposal) => p.isActive && nowTs < p.votingEndsAt.toNumber();
  const isAuthority = (p: Proposal) => publicKey && p.authority.equals(publicKey);
  const isEnded = (p: Proposal) => nowTs >= p.votingEndsAt.toNumber();

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-white/10 sticky top-0 bg-slate-900/90 backdrop-blur-xl z-40">
        <div className="max-w-5xl mx-auto flex justify-between items-center p-4">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">Private DAO Voting</h1>
              <p className="text-[10px] text-gray-500 tracking-widest uppercase">Powered by Arcium</p>
            </div>
            <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full">Devnet</span>
            {DEVELOPMENT_MODE ? (
              <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded-full">Dev Mode (Local Encryption)</span>
            ) : (
              <span className={`text-xs px-2 py-1 rounded-full ${arciumClient ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                {arciumClient ? "MXE Connected" : "MXE Disconnected"}
              </span>
            )}
          </div>
          <WalletMultiButton />
        </div>
        <div className="h-[1px] bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto p-6">
        {!connected ? (
          <div className="text-center py-20 relative">
            {/* Dot grid background */}
            <div className="absolute inset-0 opacity-10" style={{
              backgroundImage: 'radial-gradient(circle, rgba(139,92,246,0.3) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }} />
            <div className="relative">
              <h2 className="text-5xl font-bold mb-4 bg-gradient-to-r from-purple-400 via-cyan-400 to-purple-400 bg-clip-text text-transparent">
                Private DAO Voting
              </h2>
              <p className="text-gray-400 mb-2 max-w-md mx-auto">Token-gated private voting on Solana. Connect your wallet to get started.</p>
              <p className="text-cyan-400/70 text-sm mb-5">Your vote is encrypted end-to-end via confidential computing</p>
              <div className="flex justify-center gap-3 mb-8 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <LockIcon className="w-3 h-3" /> Encrypted Shared State
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <ShieldCheckIcon className="w-3 h-3" /> Correctness Proofs
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <ShieldCheckIcon className="w-3 h-3" /> Token-Gated Access
                </span>
              </div>
              <WalletMultiButton />
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">Proposals</h2>
                <div className="flex items-center gap-2">
                  <p className="text-sm text-gray-400">{new Date(nowTs * 1000).toLocaleString()}</p>
                  {hiddenProposals.size > 0 && (
                    <button onClick={() => { setHiddenProposals(new Set()); localStorage.removeItem("hiddenProposals"); }}
                      className="text-xs text-gray-500 hover:text-cyan-400 transition-colors">
                      ({hiddenProposals.size} hidden &mdash; show all)
                    </button>
                  )}
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={load} className="px-4 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-sm transition-all border border-white/5 hover:border-white/20">Refresh</button>
                <button onClick={() => setModal(true)} className="px-6 py-3 bg-gradient-to-r from-purple-600 to-cyan-500 rounded-xl font-semibold hover:shadow-lg hover:shadow-cyan-500/20 transition-all">New Proposal</button>
              </div>
            </div>

            {loading && <div className="text-center py-12 text-gray-400">Loading proposals...</div>}

            {!loading && proposals.length === 0 && (
              <div className="text-center py-16 glass-card neon-border p-8">
                <h3 className="text-xl font-semibold mb-2">No proposals yet</h3>
                <p className="text-gray-400 mb-4">Create the first proposal to get started</p>
                <button onClick={() => setModal(true)} className="px-6 py-3 bg-gradient-to-r from-purple-600 to-cyan-500 rounded-xl font-semibold hover:shadow-lg hover:shadow-cyan-500/20 transition-all">Create Proposal</button>
              </div>
            )}

            {/* ==================== THE PRIVACY PROTOCOL ==================== */}
            <div className="pt-4 border-t border-white/10">
              <h2 className="text-2xl font-bold text-center mb-2 bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                The Privacy Protocol
              </h2>
              <p className="text-gray-400 text-sm text-center mb-8 max-w-lg mx-auto">
                How Arcium&apos;s confidential computing protects every vote from submission to result
              </p>

              <div className="grid md:grid-cols-3 gap-4">
                {/* Step 1 */}
                <div className="glass-card neon-border p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                      <LockIcon className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div>
                      <span className="text-[10px] text-cyan-400/60 uppercase tracking-widest">Step 1</span>
                      <h3 className="font-semibold text-white">Encrypted Submission</h3>
                    </div>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed">
                    Votes are encrypted client-side using Arcium&apos;s SDK before leaving your browser.
                    Your choice is private from the moment you click &mdash; no one, not even validators,
                    can see how you voted.
                  </p>
                </div>

                {/* Step 2 */}
                <div className="glass-card neon-border p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                      <CloudNodesIcon className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                      <span className="text-[10px] text-purple-400/60 uppercase tracking-widest">Step 2</span>
                      <h3 className="font-semibold text-white">Secure MPC Tallying</h3>
                    </div>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed">
                    The MXE (Multi-Party Computation eXecution Environment) processes votes in a
                    Shared Private State &mdash; tallying without ever decrypting individual inputs. This
                    eliminates front-running and social coercion.
                  </p>
                </div>

                {/* Step 3 */}
                <div className="glass-card neon-border p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                      <DocumentCheckIcon className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <span className="text-[10px] text-emerald-400/60 uppercase tracking-widest">Step 3</span>
                      <h3 className="font-semibold text-white">Verifiable Results</h3>
                    </div>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed">
                    Only the final aggregate result is published to Solana, accompanied by a
                    Proof of Correctness that ensures the tally is mathematically valid &mdash;
                    verifiable by anyone, without revealing individual votes.
                  </p>
                </div>
              </div>

              {/* Technical Deep Dive Toggle */}
              <div className="mt-6">
                <button
                  onClick={() => setShowTechDeep(!showTechDeep)}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm text-gray-400 hover:text-cyan-400 transition-colors"
                >
                  <span>Technical Deep Dive</span>
                  <svg className={`w-4 h-4 transition-transform duration-200 ${showTechDeep ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>

                {showTechDeep && (
                  <div className="glass-card p-5 mt-2">
                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-3">Architecture</h4>
                        <ul className="space-y-2 text-sm text-gray-300">
                          <li className="flex items-start gap-2">
                            <span className="text-cyan-400/60 mt-0.5">&rsaquo;</span>
                            <span><span className="text-white font-medium">Arx Nodes</span> &mdash; Distributed MPC cluster operators that collectively compute on encrypted data without any single node seeing plaintext</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-cyan-400/60 mt-0.5">&rsaquo;</span>
                            <span><span className="text-white font-medium">Secret Sharing</span> &mdash; Each vote is split into cryptographic shares distributed across nodes; reconstruction requires threshold consensus</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-cyan-400/60 mt-0.5">&rsaquo;</span>
                            <span><span className="text-white font-medium">Computation Definitions</span> &mdash; Tally logic runs as a verifiable program inside the MXE, defining how encrypted inputs are aggregated</span>
                          </li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3">Guarantees</h4>
                        <ul className="space-y-2 text-sm text-gray-300">
                          <li className="flex items-start gap-2">
                            <span className="text-purple-400/60 mt-0.5">&rsaquo;</span>
                            <span><span className="text-white font-medium">Input Privacy</span> &mdash; Individual votes are never revealed to any party, including the DAO authority</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-purple-400/60 mt-0.5">&rsaquo;</span>
                            <span><span className="text-white font-medium">Output Integrity</span> &mdash; Correctness proofs cryptographically guarantee the published result matches the actual encrypted votes</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-purple-400/60 mt-0.5">&rsaquo;</span>
                            <span><span className="text-white font-medium">On-Chain Settlement</span> &mdash; Final results are anchored to Solana, providing immutable public verifiability on the fastest L1</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {proposals.filter((p) => !hiddenProposals.has(p.publicKey.toString())).map((p) => {
              const key = p.publicKey.toString();
              const active = isActive(p);
              const hasVoted = voted[key];
              const yes = typeof p.yesVotes === "number" ? p.yesVotes : 0;
              const no = typeof p.noVotes === "number" ? p.noVotes : 0;
              const abstain = typeof p.abstainVotes === "number" ? p.abstainVotes : 0;
              const total = typeof p.totalVotes === "number" ? p.totalVotes : 0;
              const yesPct = total > 0 ? Math.round((yes / total) * 100) : 0;
              const noPct = total > 0 ? Math.round((no / total) * 100) : 0;
              const abstainPct = total > 0 ? Math.round((abstain / total) * 100) : 0;
              const remaining = p.votingEndsAt.toNumber() - nowTs;
              const canReveal = isAuthority(p) && isEnded(p) && !p.isRevealed && p.isActive;

              return (
                <div key={key} className="glass-card neon-border p-6 relative group">
                  {isAuthority(p) && (
                    <button onClick={() => toggleHideProposal(key)} title="Hide proposal"
                      className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all p-1">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    </button>
                  )}
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="text-lg font-semibold">{p.title}</h3>
                      <p className="text-sm text-gray-400">by {p.authority.toString().slice(0, 4)}...{p.authority.toString().slice(-4)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${active ? "bg-green-500/20 text-green-400" : p.isRevealed ? "bg-blue-500/20 text-blue-400" : "bg-gray-500/20 text-gray-400"}`}>
                        {active ? "Active" : p.isRevealed ? "Revealed" : "Ended"}
                      </span>
                      {/* Privacy Badge */}
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${p.isRevealed ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20" : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"}`}>
                        {p.isRevealed ? (
                          <><UnlockIcon className="w-3 h-3" /> Results Public</>
                        ) : (
                          <><LockIcon className="w-3 h-3" /> Encrypted Tally</>
                        )}
                      </span>
                      {active && <p className="text-xs text-cyan-400 mt-0.5">{formatTime(remaining)} left</p>}
                    </div>
                  </div>

                  <p className="text-gray-300 mb-4 line-clamp-3">{p.description}</p>
                  <p className="text-xs text-gray-400 mb-4">
                    Gate: {p.gateMint.toString().slice(0, 8)}... | Min balance: {p.minBalance.toString()} | Votes: {total}
                  </p>

                  {/* Token gate check + Voting buttons (active + not voted) */}
                  {active && !hasVoted && (tokenBalances[key] ?? 0) < p.minBalance.toNumber() && (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 space-y-3">
                      <p className="text-sm text-yellow-400">You need gate tokens to vote on this proposal.</p>
                      <button onClick={() => claimTokens(p)} disabled={claiming[key]}
                        className="w-full py-3 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-xl font-semibold text-white disabled:opacity-50">
                        {claiming[key] ? "Claiming..." : "Claim Gate Tokens"}
                      </button>
                    </div>
                  )}

                  {active && !hasVoted && (tokenBalances[key] ?? 0) >= p.minBalance.toNumber() && (
                    <div className="space-y-3">
                      <div className="flex gap-3">
                        <button onClick={() => setSelected((s) => ({ ...s, [key]: "yes" }))} disabled={voting[key]}
                          className={`flex-1 py-3 rounded-xl font-semibold transition-all ${selected[key] === "yes" ? "bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500 shadow-lg shadow-emerald-500/25" : "bg-white/5 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/10"}`}>
                          YES
                        </button>
                        <button onClick={() => setSelected((s) => ({ ...s, [key]: "no" }))} disabled={voting[key]}
                          className={`flex-1 py-3 rounded-xl font-semibold transition-all ${selected[key] === "no" ? "bg-red-500/20 text-red-400 border-2 border-red-500 shadow-lg shadow-red-500/25" : "bg-white/5 text-red-400 border border-red-500/30 hover:bg-red-500/10"}`}>
                          NO
                        </button>
                        <button onClick={() => setSelected((s) => ({ ...s, [key]: "abstain" }))} disabled={voting[key]}
                          className={`flex-1 py-3 rounded-xl font-semibold transition-all ${selected[key] === "abstain" ? "bg-slate-500/20 text-slate-300 border-2 border-slate-400 shadow-lg shadow-slate-500/25" : "bg-white/5 text-slate-400 border border-slate-500/30 hover:bg-slate-500/10"}`}>
                          ABSTAIN
                        </button>
                      </div>
                      {selected[key] && (
                        <>
                          <button onClick={() => vote(p, selected[key]!)} disabled={voting[key]}
                            className="w-full py-3 bg-gradient-to-r from-purple-600 to-cyan-500 rounded-xl font-semibold disabled:opacity-50 hover:shadow-lg hover:shadow-cyan-500/20 transition-all border border-cyan-500/20">
                            {voting[key] ? (isEncrypting ? "Encrypting vote..." : "Submitting to Solana...") : "Submit Encrypted Vote"}
                          </button>
                          {voting[key] && (
                            <div className="space-y-2 mt-1">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-gray-400">Privacy Integrity</span>
                                <span className="text-cyan-400">{isEncrypting ? "Encrypting via MXE..." : "Submitting to chain..."}</span>
                              </div>
                              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                                <div className={`h-full rounded-full transition-all duration-700 ease-out integrity-bar-fill ${isEncrypting ? "w-1/3 animate-pulse" : "w-2/3"}`} />
                              </div>
                              <div className="flex justify-between text-[10px]">
                                <span className={isEncrypting ? "text-cyan-400 font-medium" : "text-cyan-400/40"}>Encrypt</span>
                                <span className={!isEncrypting ? "text-purple-400 font-medium" : "text-purple-400/40"}>Submit</span>
                                <span className="text-gray-500">Confirm</span>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Already voted */}
                  {active && hasVoted && (
                    <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-4 flex items-center justify-center gap-2">
                      <ShieldCheckIcon className="w-5 h-5 text-cyan-400" />
                      <span className="text-cyan-400">Your encrypted vote is sealed on-chain</span>
                    </div>
                  )}

                  {/* Reveal button (authority only, after voting ends) */}
                  {canReveal && (
                    <button onClick={() => reveal(p)} disabled={revealing[key]}
                      className="w-full py-3 mt-4 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl font-semibold disabled:opacity-50 hover:shadow-lg hover:shadow-cyan-500/20 transition-all">
                      {revealing[key] ? "Revealing..." : "Reveal Results"}
                    </button>
                  )}

                  {/* Results (revealed) */}
                  {p.isRevealed && total > 0 && (
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <div className="flex justify-between text-sm mb-2">
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
                    </div>
                  )}

                  {/* Encrypted votes vault (active, has votes) */}
                  {active && total > 0 && (
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <div className={`bg-slate-800/50 rounded-xl p-4 border relative overflow-hidden ${voting[key] ? "border-cyan-500/30" : "border-cyan-500/10"}`}>
                        <div className={`absolute inset-0 pointer-events-none ${voting[key] ? "shimmer-bg-active" : "shimmer-bg"}`} />
                        <div className="relative flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ShieldCheckIcon className={`w-5 h-5 text-cyan-400 ${voting[key] ? "animate-pulse" : "animate-pulse-slow"}`} />
                            <span className="text-gray-300">{total} vote{total !== 1 ? "s" : ""} sealed</span>
                          </div>
                          <LockIcon className="w-4 h-4 text-cyan-400/50" />
                        </div>
                        <div className="relative flex items-center justify-center gap-3 mt-2">
                          <span className="text-[10px] text-cyan-400/60 flex items-center gap-1">
                            <LockIcon className="w-2.5 h-2.5" /> Encrypted Shared State
                          </span>
                          <span className="text-[10px] text-gray-600">|</span>
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
                </div>
              );
            })}
          </div>
        )}
      </main>

      <CreateModal isOpen={modal} onClose={() => setModal(false)} onSubmit={create} loading={creating} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { AnchorProvider, Program, BN, Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { GetProgramAccountsFilter } from "@solana/web3.js";
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
  delegateVote,
  revokeDelegation,
  getDelegation,
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
import { LockIcon, ShieldCheckIcon } from "../components/Icons";
import { Toast, ToastData } from "../components/Toast";
import { CreateModal } from "../components/CreateModal";
import { PrivacyProtocol } from "../components/PrivacyProtocol";
import { ProposalCard, Proposal } from "../components/ProposalCard";
import { SkeletonCard } from "../components/SkeletonCard";
import { StatsBar } from "../components/StatsBar";
import { ActivityFeed } from "../components/ActivityFeed";

import generatedIdl from "../idl/private_dao_voting.json";

// Proposal account discriminator from the IDL
const PROPOSAL_DISCRIMINATOR = [26, 94, 189, 187, 116, 136, 53, 33];

export default function Home() {
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();

  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
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
  const [delegation, setDelegation] = useState<{ delegate: PublicKey; createdAt: number } | null>(null);
  const [delegateInput, setDelegateInput] = useState("");
  const [delegating, setDelegating] = useState(false);

  // Dev mode: track local vote tallies since MXE isn't aggregating
  const [devTallies, setDevTallies] = useState<Record<string, { yes: number; no: number; abstain: number }>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("devTallies") || "{}"); } catch { return {}; }
  });

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

  // Load all proposals
  const load = useCallback(async () => {
    const program = getProgram();
    if (!program) return;
    setLoading(true);
    try {
      const discriminatorFilter: GetProgramAccountsFilter = {
        memcmp: {
          offset: 0,
          bytes: Buffer.from(PROPOSAL_DISCRIMINATOR).toString("base64"),
          encoding: "base64",
        },
      };

      const rawAccounts = await connection.getProgramAccounts(PROGRAM_ID, { filters: [discriminatorFilter] });

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
            quorum: a.quorum ?? 0,
          });
        } catch {
          console.warn("Skipping undeserializable proposal account:", raw.pubkey.toBase58());
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

  // Check delegation status
  useEffect(() => {
    if (!publicKey || !connected) { setDelegation(null); return; }
    const program = getProgram();
    if (!program) return;
    getDelegation(program, publicKey).then(setDelegation);
  }, [publicKey, connected, getProgram]);

  const handleDelegate = async () => {
    const program = getProgram();
    if (!program || !publicKey || !delegateInput.trim()) return;
    setDelegating(true);
    try {
      const delegate = new PublicKey(delegateInput.trim());
      await delegateVote(program, publicKey, delegate);
      setDelegation({ delegate, createdAt: Math.floor(Date.now() / 1000) });
      setDelegateInput("");
      setToast({ message: "Vote delegation active!", type: "success" });
    } catch (e: any) {
      setToast({ message: e.message || "Delegation failed", type: "error" });
    }
    setDelegating(false);
  };

  const handleRevoke = async () => {
    const program = getProgram();
    if (!program || !publicKey) return;
    setDelegating(true);
    try {
      await revokeDelegation(program, publicKey);
      setDelegation(null);
      setToast({ message: "Delegation revoked", type: "success" });
    } catch (e: any) {
      setToast({ message: e.message || "Revoke failed", type: "error" });
    }
    setDelegating(false);
  };

  // Create proposal
  const create = async (title: string, desc: string, duration: number, gateMintStr: string, minBalanceStr: string, quorumStr: string) => {
    const program = getProgram();
    if (!program || !publicKey) return;
    setCreating(true);
    try {
      const gateMint = new PublicKey(gateMintStr);
      const minBalance = new BN(minBalanceStr);
      const quorum = new BN(quorumStr || "0");
      const { proposalPDA } = await devCreateProposal(program, publicKey, title, desc, duration, gateMint, minBalance, quorum);
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
      let client = arciumClient;
      if (!client) {
        const provider = new AnchorProvider(connection, anchorWallet!, { commitment: "confirmed" });
        client = createArciumClient(provider, DEVNET_CLUSTER_OFFSET);
        await client.initialize(MXE_PROGRAM_ID);
        setArciumClient(client);
      }

      const voteValue: 0 | 1 | 2 = choice === "yes" ? 1 : choice === "abstain" ? 2 : 0;
      setIsEncrypting(true);
      const encryptedVote = await client.encryptVote(voteValue, proposal.publicKey, publicKey);
      const secretInput = client.toSecretInput(encryptedVote, publicKey);
      setIsEncrypting(false);

      if (DEVELOPMENT_MODE) {
        await devCastVote(
          program, publicKey, proposal.publicKey, proposal.gateMint,
          secretInput.encryptedChoice, secretInput.nonce, secretInput.voterPubkey
        );
      } else {
        const computationOffset = deriveComputationOffset(proposal.publicKey, Date.now());
        const arciumAccounts = client.getArciumAccounts("vote", computationOffset);
        await castVoteWithArcium(
          program, publicKey, proposal.publicKey, proposal.gateMint,
          secretInput.encryptedChoice, secretInput.nonce, secretInput.voterPubkey,
          arciumAccounts
        );
      }

      // In dev mode, track the vote choice locally for reveal
      if (DEVELOPMENT_MODE) {
        setDevTallies((prev) => {
          const current = prev[key] || { yes: 0, no: 0, abstain: 0 };
          const updated = {
            ...prev,
            [key]: {
              yes: current.yes + (choice === "yes" ? 1 : 0),
              no: current.no + (choice === "no" ? 1 : 0),
              abstain: current.abstain + (choice === "abstain" ? 1 : 0),
            },
          };
          localStorage.setItem("devTallies", JSON.stringify(updated));
          return updated;
        });
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
      const tally = devTallies[key] || { yes: 0, no: 0, abstain: 0 };
      await devRevealResults(program, publicKey, proposal.publicKey, tally.yes, tally.no, tally.abstain);
      setToast({ message: "Results revealed!", type: "success" });
      load();
    } catch (e: any) {
      console.error("Reveal error:", e);
      setToast({ message: e.message || "Reveal failed", type: "error" });
    }
    setRevealing((r) => ({ ...r, [key]: false }));
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-white/10 sticky top-0 bg-slate-900/90 backdrop-blur-xl z-40">
        <div className="max-w-5xl mx-auto flex justify-between items-center p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent truncate">Private DAO Voting</h1>
              <p className="text-[10px] text-gray-500 tracking-widest uppercase">Powered by Arcium</p>
            </div>
            <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full shrink-0 hidden sm:inline">Devnet</span>
            {DEVELOPMENT_MODE ? (
              <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded-full shrink-0 hidden md:inline">Dev Mode</span>
            ) : (
              <span className={`text-xs px-2 py-1 rounded-full shrink-0 hidden md:inline ${arciumClient ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
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
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold">Proposals</h2>
                <div className="flex items-center gap-2">
                  <p className="text-xs sm:text-sm text-gray-400">{new Date(nowTs * 1000).toLocaleString()}</p>
                  {hiddenProposals.size > 0 && (
                    <button onClick={() => { setHiddenProposals(new Set()); localStorage.removeItem("hiddenProposals"); }}
                      className="text-xs text-gray-500 hover:text-cyan-400 transition-colors">
                      ({hiddenProposals.size} hidden &mdash; show all)
                    </button>
                  )}
                </div>
              </div>
              <div className="flex gap-2 sm:gap-3 w-full sm:w-auto">
                <button onClick={load} className="flex-1 sm:flex-none px-4 py-2.5 sm:py-3 bg-white/10 hover:bg-white/20 rounded-xl text-sm transition-all border border-white/5 hover:border-white/20">Refresh</button>
                <button onClick={() => setModal(true)} className="flex-1 sm:flex-none px-4 sm:px-6 py-2.5 sm:py-3 bg-gradient-to-r from-purple-600 to-cyan-500 rounded-xl font-semibold hover:shadow-lg hover:shadow-cyan-500/20 transition-all">New Proposal</button>
              </div>
            </div>

            {/* Delegation Panel */}
            <div className="glass-card neon-border p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-2">Vote Delegation</h3>
              {delegation ? (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">
                    Delegated to <span className="text-cyan-400">{delegation.delegate.toString().slice(0, 8)}...{delegation.delegate.toString().slice(-4)}</span>
                  </p>
                  <button onClick={handleRevoke} disabled={delegating}
                    className="px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-xs hover:bg-red-500/20 transition-all disabled:opacity-50">
                    {delegating ? "..." : "Revoke"}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={delegateInput}
                    onChange={(e) => setDelegateInput(e.target.value)}
                    placeholder="Delegate address (wallet pubkey)"
                    className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                  />
                  <button onClick={handleDelegate} disabled={delegating || !delegateInput.trim()}
                    className="px-4 py-1.5 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-lg text-xs hover:bg-cyan-500/20 transition-all disabled:opacity-50">
                    {delegating ? "..." : "Delegate"}
                  </button>
                </div>
              )}
              <p className="text-[10px] text-gray-500 mt-1">Delegate your voting power to a trusted address. You cannot vote directly while delegation is active.</p>
            </div>

            {/* Stats Dashboard */}
            {!loading && proposals.length > 0 && (
              <StatsBar proposals={proposals} nowTs={nowTs} />
            )}

            {loading && (
              <div className="space-y-4">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            )}

            {!loading && proposals.length === 0 && (
              <div className="text-center py-16 glass-card neon-border p-8">
                <h3 className="text-xl font-semibold mb-2">No proposals yet</h3>
                <p className="text-gray-400 mb-4">Create the first proposal to get started</p>
                <button onClick={() => setModal(true)} className="px-6 py-3 bg-gradient-to-r from-purple-600 to-cyan-500 rounded-xl font-semibold hover:shadow-lg hover:shadow-cyan-500/20 transition-all">Create Proposal</button>
              </div>
            )}

            <PrivacyProtocol />

            {proposals.filter((p) => !hiddenProposals.has(p.publicKey.toString())).map((p) => {
              const key = p.publicKey.toString();
              return (
                <ProposalCard
                  key={key}
                  proposal={p}
                  nowTs={nowTs}
                  publicKey={publicKey}
                  hasVoted={voted[key] || false}
                  tokenBalance={tokenBalances[key] ?? 0}
                  selectedChoice={selected[key] || null}
                  isVoting={voting[key] || false}
                  isRevealing={revealing[key] || false}
                  isClaiming={claiming[key] || false}
                  isEncrypting={isEncrypting}
                  onSelectChoice={(choice) => setSelected((s) => ({ ...s, [key]: choice }))}
                  onVote={() => vote(p, selected[key]!)}
                  onReveal={() => reveal(p)}
                  onClaimTokens={() => claimTokens(p)}
                  onToggleHide={() => toggleHideProposal(key)}
                />
              );
            })}

            {/* Activity Feed */}
            {!loading && proposals.length > 0 && (
              <ActivityFeed connection={connection} />
            )}
          </div>
        )}
      </main>

      <CreateModal isOpen={modal} onClose={() => setModal(false)} onSubmit={create} loading={creating} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

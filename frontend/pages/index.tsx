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

  const visibleProposals = proposals.filter((p) => !hiddenProposals.has(p.publicKey.toString()));

  return (
    <div className="min-h-screen bg-mesh">
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl" style={{ background: 'rgba(10, 10, 26, 0.85)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="max-w-6xl mx-auto flex justify-between items-center px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Logo mark */}
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 glow-purple" style={{ background: 'linear-gradient(135deg, rgba(147,51,234,0.3), rgba(34,211,238,0.2))' }}>
              <ShieldCheckIcon className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-gradient truncate">Private DAO Voting</h1>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-gray-500 tracking-[0.2em] uppercase">Powered by Arcium</span>
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[9px] text-green-400/70">Devnet</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {DEVELOPMENT_MODE ? (
              <span className="text-[10px] bg-yellow-500/10 text-yellow-400/80 px-2.5 py-1 rounded-full border border-yellow-500/20 hidden sm:inline">Dev Mode</span>
            ) : (
              <span className={`text-[10px] px-2.5 py-1 rounded-full border hidden sm:inline ${arciumClient ? "bg-green-500/10 text-green-400/80 border-green-500/20" : "bg-red-500/10 text-red-400/80 border-red-500/20"}`}>
                {arciumClient ? "MXE Connected" : "MXE Disconnected"}
              </span>
            )}
            <WalletMultiButton />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {!connected ? (
          /* ==================== HERO LANDING ==================== */
          <div className="relative overflow-hidden">
            {/* Floating orbs */}
            <div className="orb orb-purple w-[400px] h-[400px] -top-32 -left-32" />
            <div className="orb orb-cyan w-[300px] h-[300px] top-20 right-0" />
            <div className="orb orb-blue w-[250px] h-[250px] bottom-0 left-1/3" />

            <div className="relative grid-pattern py-16 sm:py-24">
              {/* Main hero */}
              <div className="text-center mb-16">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-cyan-500/20 bg-cyan-500/5 mb-8">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-xs text-cyan-400">Built on Arcium MXE &mdash; Confidential Computing for Solana</span>
                </div>

                <h2 className="text-4xl sm:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
                  <span className="text-white">Vote </span>
                  <span className="text-gradient-animated">Privately</span>
                  <br />
                  <span className="text-white">on Solana</span>
                </h2>

                <p className="text-gray-400 text-lg sm:text-xl mb-4 max-w-2xl mx-auto leading-relaxed">
                  Token-gated governance where individual votes are
                  <span className="text-cyan-400"> never revealed</span>.
                  Encrypted, tallied via MPC, verified on-chain.
                </p>

                <p className="text-gray-500 text-sm mb-10 max-w-lg mx-auto">
                  No vote buying. No social coercion. No front-running. Just anonymous, verifiable results.
                </p>

                <WalletMultiButton />
              </div>

              {/* Feature cards */}
              <div className="grid sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
                <div className="glass-card-elevated p-6 text-center group hover:border-cyan-500/20 transition-all duration-500">
                  <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mx-auto mb-4 group-hover:glow-cyan transition-all">
                    <LockIcon className="w-6 h-6 text-cyan-400" />
                  </div>
                  <h3 className="font-semibold text-white mb-2">Encrypted Votes</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">x25519 ECDH + RescueCipher encryption before votes leave your browser</p>
                </div>

                <div className="glass-card-elevated p-6 text-center group hover:border-purple-500/20 transition-all duration-500">
                  <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-4 group-hover:glow-purple transition-all">
                    <svg className="w-6 h-6 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                      <circle cx="8" cy="14" r="1" fill="currentColor" /><circle cx="13" cy="14" r="1" fill="currentColor" />
                      <path d="M8 14h5" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-white mb-2">MPC Tallying</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">Arcium MXE nodes compute on encrypted data &mdash; no single party sees votes</p>
                </div>

                <div className="glass-card-elevated p-6 text-center group hover:border-emerald-500/20 transition-all duration-500">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                    <ShieldCheckIcon className="w-6 h-6 text-emerald-400" />
                  </div>
                  <h3 className="font-semibold text-white mb-2">Verified Results</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">Correctness proofs guarantee the tally matches all submitted votes</p>
                </div>
              </div>

              {/* Tech badges */}
              <div className="flex justify-center gap-6 mt-12 flex-wrap">
                {["Solana", "Anchor", "Arcium MXE", "x25519", "SPL Tokens"].map((t) => (
                  <span key={t} className="text-xs text-gray-500 border border-white/5 px-3 py-1.5 rounded-full">{t}</span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* ==================== CONNECTED STATE ==================== */
          <div className="space-y-6">
            {/* Top bar: title + actions */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white">Governance</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {proposals.length} proposal{proposals.length !== 1 ? "s" : ""}
                  {hiddenProposals.size > 0 && (
                    <button onClick={() => { setHiddenProposals(new Set()); localStorage.removeItem("hiddenProposals"); }}
                      className="text-gray-600 hover:text-cyan-400 transition-colors ml-2">
                      ({hiddenProposals.size} hidden &mdash; show)
                    </button>
                  )}
                </p>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <button onClick={load} className="btn-secondary flex-1 sm:flex-none px-4 py-2.5 text-sm !rounded-xl">Refresh</button>
                <button onClick={() => setModal(true)} className="btn-primary flex-1 sm:flex-none px-5 py-2.5 text-sm !rounded-xl">+ New Proposal</button>
              </div>
            </div>

            {/* Stats Dashboard */}
            {!loading && proposals.length > 0 && (
              <StatsBar proposals={proposals} nowTs={nowTs} />
            )}

            {/* Two column layout: proposals + sidebar */}
            <div className="grid lg:grid-cols-[1fr_320px] gap-6">
              {/* Proposals column */}
              <div className="space-y-4 min-w-0">
                {loading && (
                  <>
                    <SkeletonCard />
                    <SkeletonCard />
                  </>
                )}

                {!loading && proposals.length === 0 && (
                  <div className="text-center py-20 glass-card-elevated p-8">
                    <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-6">
                      <LockIcon className="w-8 h-8 text-purple-400" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2 text-white">No proposals yet</h3>
                    <p className="text-gray-400 mb-6 max-w-sm mx-auto">Create the first private proposal to start encrypted governance</p>
                    <button onClick={() => setModal(true)} className="btn-primary px-8 py-3">Create First Proposal</button>
                  </div>
                )}

                {visibleProposals.map((p) => {
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
              </div>

              {/* Sidebar */}
              <div className="space-y-4">
                {/* Delegation Panel */}
                <div className="glass-card-elevated p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                      <svg className="w-3.5 h-3.5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><path d="M20 8v6M23 11h-6" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-semibold text-white">Vote Delegation</h3>
                  </div>
                  {delegation ? (
                    <div className="space-y-3">
                      <div className="bg-cyan-500/5 border border-cyan-500/10 rounded-xl p-3">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Delegated to</p>
                        <p className="text-xs text-cyan-400 font-mono">{delegation.delegate.toString().slice(0, 12)}...{delegation.delegate.toString().slice(-4)}</p>
                      </div>
                      <button onClick={handleRevoke} disabled={delegating}
                        className="w-full py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-xs hover:bg-red-500/20 transition-all disabled:opacity-50">
                        {delegating ? "Revoking..." : "Revoke Delegation"}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        value={delegateInput}
                        onChange={(e) => setDelegateInput(e.target.value)}
                        placeholder="Enter delegate wallet address"
                        className="w-full px-3 py-2.5 bg-white/3 border border-white/8 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/30 transition-colors"
                      />
                      <button onClick={handleDelegate} disabled={delegating || !delegateInput.trim()}
                        className="w-full py-2.5 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-xl text-xs font-medium hover:bg-cyan-500/20 transition-all disabled:opacity-50">
                        {delegating ? "Delegating..." : "Delegate Votes"}
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-gray-600 mt-2 leading-relaxed">Delegate your voting power to a trusted address on-chain.</p>
                </div>

                {/* Activity Feed */}
                {!loading && proposals.length > 0 && (
                  <ActivityFeed connection={connection} />
                )}

                {/* Privacy Protocol (collapsed in sidebar) */}
                <PrivacyProtocol />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 mt-16">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-xs text-gray-600">Private DAO Voting &mdash; Confidential governance on Solana</p>
          <div className="flex items-center gap-4">
            <a href="https://github.com/Ridwannurudeen/private-dao-voting" target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-cyan-400 transition-colors">GitHub</a>
            <span className="text-gray-700">|</span>
            <span className="text-xs text-gray-600">Powered by Arcium MXE</span>
          </div>
        </div>
      </footer>

      <CreateModal isOpen={modal} onClose={() => setModal(false)} onSubmit={create} loading={creating} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

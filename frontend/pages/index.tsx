import { useState, useEffect, useCallback, useMemo } from "react";
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
import { parseAnchorError, explorerTxUrl } from "../lib/errors";
import { withRetry } from "../lib/retry";
import { LockIcon, ShieldCheckIcon } from "../components/Icons";
import { Toast, ToastData } from "../components/Toast";
import { CreateModal } from "../components/CreateModal";
import { ProposalCard, Proposal } from "../components/ProposalCard";
import { SkeletonCard } from "../components/SkeletonCard";
import { StatsBar } from "../components/StatsBar";
import { ActivityFeed } from "../components/ActivityFeed";
import { Confetti } from "../components/Confetti";
import { ThemeToggle } from "../components/ThemeToggle";
import { VoteProgress, VoteStep } from "../components/VoteProgress";
import { DeveloperConsole } from "../components/DeveloperConsole";
import { DashboardLayout } from "../components/DashboardLayout";
import { Sidebar } from "../components/Sidebar";
import { NetworkVisualization } from "../components/NetworkVisualization";
import { OnboardingDrawer } from "../components/OnboardingDrawer";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";

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
  const [showConfetti, setShowConfetti] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [voteStep, setVoteStep] = useState<Record<string, VoteStep>>({});
  const PROPOSALS_PER_PAGE = 10;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [devConsoleOpen, setDevConsoleOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("dashboard");

  // Dev mode: track local vote tallies since MXE isn't aggregating
  const [devTallies, setDevTallies] = useState<Record<string, { yes: number; no: number; abstain: number }>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("devTallies") || "{}"); } catch { return {}; }
  });

  const [hiddenProposals, setHiddenProposals] = useState<Set<string>>(new Set());

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
    const provider = new AnchorProvider(connection, anchorWallet, {
      commitment: "confirmed",
      skipPreflight: true,
      preflightCommitment: "processed",
    });
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
  // Returns -1 when ATA doesn't exist (voter needs to claim), 0+ for actual balance
  const checkTokenBalances = useCallback(async (proposalList: Proposal[]) => {
    if (!publicKey) return;
    const results = await Promise.all(
      proposalList.map(async (p) => {
        try {
          const ata = getAssociatedTokenAddressSync(p.gateMint, publicKey);
          const info = await withRetry(() => connection.getTokenAccountBalance(ata));
          return { key: p.publicKey.toString(), balance: Number(info.value.amount) };
        } catch {
          return { key: p.publicKey.toString(), balance: -1 };
        }
      })
    );
    const balances: Record<string, number> = {};
    for (const r of results) balances[r.key] = r.balance;
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
            votingEndsAt: Number(a.votingEndsAt ?? a.voting_ends_at ?? 0),
            isActive: a.isActive ?? a.is_active,
            isRevealed: a.isRevealed ?? a.is_revealed,
            totalVotes: Number(a.totalVotes ?? a.total_votes ?? 0),
            gateMint: a.gateMint ?? a.gate_mint,
            minBalance: Number(a.minBalance ?? a.min_balance ?? 0),
            yesVotes: Number(a.yesVotes ?? a.yes_votes ?? 0),
            noVotes: Number(a.noVotes ?? a.no_votes ?? 0),
            abstainVotes: Number(a.abstainVotes ?? a.abstain_votes ?? 0),
          });
        } catch {
          console.warn("Skipping undeserializable proposal account:", raw.pubkey.toBase58());
        }
      }
      // Sort: active proposals first, then newest to oldest within each group
      mapped.sort((a, b) => {
        const aActive = a.isActive && !a.isRevealed ? 1 : 0;
        const bActive = b.isActive && !b.isRevealed ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        const aId = BN.isBN(a.id) ? a.id : new BN(a.id.toString());
        const bId = BN.isBN(b.id) ? b.id : new BN(b.id.toString());
        return bId.cmp(aId);
      });
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
        body: JSON.stringify({ walletAddress: publicKey.toBase58(), gateMint: proposal.gateMint.toBase58() }),
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

  // Track previous connection state for disconnect detection
  const [wasConnected, setWasConnected] = useState(false);

  // Auto-load when wallet connects (or switches accounts), clear state on disconnect
  useEffect(() => {
    if (connected && anchorWallet && publicKey) {
      // Reset stale state from previous wallet before loading
      setVoted({});
      setSelected({});
      setTokenBalances({});
      load();
      setWasConnected(true);
    } else {
      if (wasConnected) {
        setToast({ message: "Wallet disconnected. Reconnect to continue voting.", type: "info" });
      }
      setProposals([]);
      setVoted({});
      setSelected({});
      setTokenBalances({});
      setCurrentPage(1);
    }
  }, [connected, anchorWallet, publicKey, load]);

  // Create proposal
  const create = async (
    title: string,
    desc: string,
    duration: number,
    gateMintStr: string,
    minBalanceStr: string
  ) => {
    const program = getProgram();
    if (!program || !publicKey) return;
    setCreating(true);
    try {
      const gateMint = new PublicKey(gateMintStr);
      const minBalance = new BN(minBalanceStr);
      const result = await withRetry(() => devCreateProposal(
        program, publicKey, title, desc, duration, gateMint, minBalance
      ));
      await withRetry(() => devInitTally(program, publicKey, result.proposalPDA));
      setToast({ message: "Proposal created with tally initialized!", type: "success", txUrl: explorerTxUrl(result.tx) });
      setModal(false);
      load();
    } catch (e: any) {
      console.error("Create failed:", e);
      setToast({ message: parseAnchorError(e), type: "error" });
    }
    setCreating(false);
  };

  // Cast vote
  const vote = async (proposal: Proposal, choice: "yes" | "no" | "abstain") => {
    const program = getProgram();
    if (!program || !publicKey) return;

    const key = proposal.publicKey.toString();
    setVoting((v) => ({ ...v, [key]: true }));
    setVoteStep((s) => ({ ...s, [key]: "encrypting" }));

    try {
      // Pre-validate: check voter holds the gate token before sending tx
      // tokenBalances is -1 when ATA doesn't exist, 0+ for actual balance
      const balance = tokenBalances[key] ?? -1;
      const minBal = Number(proposal.minBalance) || 0;
      if (balance < 0) {
        throw new Error(
          "InsufficientBalance: You don't have the gate token for this proposal. " +
          "Claim gate tokens first."
        );
      }
      if (balance < minBal) {
        throw new Error(
          `InsufficientBalance: You need at least ${minBal} gate token(s) to vote. ` +
          `Use the faucet to claim tokens first.`
        );
      }

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
      setVoteStep((s) => ({ ...s, [key]: "submitting" }));

      let txSig: string;
      if (DEVELOPMENT_MODE) {
        txSig = await devCastVote(
          program, publicKey, proposal.publicKey, proposal.gateMint,
          secretInput.encryptedChoice, secretInput.nonce, secretInput.voterPubkey
        );
      } else {
        const computationOffset = deriveComputationOffset(proposal.publicKey, Date.now());
        const arciumAccounts = client.getArciumAccounts("vote", computationOffset);
        txSig = await castVoteWithArcium(
          program, publicKey, proposal.publicKey, proposal.gateMint,
          secretInput.encryptedChoice, secretInput.nonce, secretInput.voterPubkey,
          arciumAccounts
        );
      }

      setVoteStep((s) => ({ ...s, [key]: "processing" }));

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

      // Brief delay to show processing step before confirmed
      await new Promise((r) => setTimeout(r, 800));
      setVoteStep((s) => ({ ...s, [key]: "confirmed" }));

      setToast({ message: "Encrypted vote recorded on-chain!", type: "success", txUrl: explorerTxUrl(txSig) });
      setVoted((v) => ({ ...v, [key]: true }));
      setSelected((s) => ({ ...s, [key]: null }));
      setShowConfetti(true);
      load();
    } catch (e: any) {
      console.error("Vote error:", e);
      setIsEncrypting(false);
      setVoteStep((s) => ({ ...s, [key]: "idle" }));
      setToast({ message: parseAnchorError(e), type: "error" });
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
      const txSig = await devRevealResults(program, publicKey, proposal.publicKey, tally.yes, tally.no, tally.abstain);
      setToast({ message: "Results revealed!", type: "success", txUrl: explorerTxUrl(txSig) });
      load();
    } catch (e: any) {
      console.error("Reveal error:", e);
      setToast({ message: parseAnchorError(e), type: "error" });
    }
    setRevealing((r) => ({ ...r, [key]: false }));
  };

  const handleConfettiDone = useCallback(() => setShowConfetti(false), []);
  const visibleProposals = proposals.filter((p) => !hiddenProposals.has(p.publicKey.toString()));
  const totalPages = Math.max(1, Math.ceil(visibleProposals.length / PROPOSALS_PER_PAGE));
  const paginatedProposals = visibleProposals.slice(
    (currentPage - 1) * PROPOSALS_PER_PAGE,
    currentPage * PROPOSALS_PER_PAGE
  );

  // Keyboard shortcuts
  const shortcutHandlers = useMemo(() => ({
    onClose: () => setModal(false),
    onRefresh: () => { if (connected) load(); },
    onNewProposal: () => { if (connected) setModal(true); },
  }), [connected, load]);
  useKeyboardShortcuts(shortcutHandlers);

  return (
    <div className="min-h-screen bg-mesh">
      {!connected ? (
        /* ==================== HERO LANDING (unchanged) ==================== */
        <>
          <header className="sticky top-0 z-40 backdrop-blur-xl" role="banner" style={{ background: 'rgba(10, 10, 26, 0.85)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="max-w-6xl mx-auto flex justify-between items-center px-4 sm:px-6 py-3">
              <div className="flex items-center gap-3 min-w-0">
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
                <ThemeToggle />
                <WalletMultiButton />
              </div>
            </div>
          </header>

          <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8" role="main">
            <div className="relative overflow-hidden">
              <div className="orb orb-purple w-[400px] h-[400px] -top-32 -left-32" />
              <div className="orb orb-cyan w-[300px] h-[300px] top-20 right-0" />
              <div className="orb orb-blue w-[250px] h-[250px] bottom-0 left-1/3" />

              <div className="relative grid-pattern py-16 sm:py-24">
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

                <div className="flex justify-center gap-6 mt-12 flex-wrap">
                  {["Solana", "Anchor", "Arcium MXE", "x25519", "SPL Tokens"].map((t) => (
                    <span key={t} className="text-xs text-gray-500 border border-white/5 px-3 py-1.5 rounded-full">{t}</span>
                  ))}
                </div>
              </div>
            </div>
          </main>
        </>
      ) : (
        /* ==================== DASHBOARD LAYOUT ==================== */
        <DashboardLayout
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          sidebar={
            <Sidebar
              arciumClient={arciumClient}
              connected={connected}
              activeSection={activeSection}
              onNavigate={setActiveSection}
              onOpenDrawer={() => setDrawerOpen(true)}
            />
          }
          rightPanel={
            <>
              {/* Live Network Visualization */}
              <NetworkVisualization isConnected={!!arciumClient} />

              {/* Create Proposal */}
              <button
                onClick={() => setModal(true)}
                className="w-full btn-primary py-3 text-sm !rounded-xl flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Create Proposal
              </button>

              {/* Activity Feed */}
              {!loading && proposals.length > 0 && (
                <ActivityFeed connection={connection} />
              )}
            </>
          }
        >
          {/* ===== MAIN CONTENT AREA ===== */}

          {/* Dashboard Top Bar */}
          <div className="dashboard-topbar flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="flex items-center gap-4 min-w-0 pl-12 lg:pl-0">
              <h2 className="text-xl sm:text-2xl font-bold text-gradient truncate">Private DAO Governance</h2>
              <div className="hidden sm:flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  arciumClient
                    ? "bg-green-500/10 text-green-400 border-green-500/20"
                    : DEVELOPMENT_MODE
                    ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                    : "bg-red-500/10 text-red-400 border-red-500/20"
                }`}>
                  {arciumClient ? "MXE Active" : DEVELOPMENT_MODE ? "Dev Mode" : "MXE Offline"}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  Cerberus Protocol
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDevConsoleOpen(true)}
                className="px-3 py-1.5 text-[10px] bg-white/5 border border-white/10 rounded-lg text-gray-400 hover:text-cyan-400 hover:border-cyan-500/30 transition-all hidden sm:inline-flex items-center gap-1.5"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                System Integrity
              </button>
              <ThemeToggle />
              <WalletMultiButton />
            </div>
          </div>

          {/* Main scrollable content */}
          <div id="section-dashboard" className="px-6 py-6 space-y-6" role="main" aria-label="Governance proposals">
            {/* Action bar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <p className="text-sm text-gray-500">
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
                <button onClick={load} className="btn-secondary flex-1 sm:flex-none px-4 py-2 text-sm !rounded-xl">Refresh</button>
                <button onClick={() => setModal(true)} className="btn-primary flex-1 sm:flex-none px-4 py-2 text-sm !rounded-xl xl:hidden">+ New Proposal</button>
              </div>
            </div>

            {/* Stats Dashboard */}
            {!loading && proposals.length > 0 && (
              <StatsBar proposals={proposals} nowTs={nowTs} />
            )}

            {/* Proposals list */}
            {loading && (
              <div className="space-y-4">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            )}

            {!loading && proposals.length === 0 && (
              <div className="text-center py-16 glass-card-elevated p-8">
                <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-6">
                  <LockIcon className="w-8 h-8 text-purple-400" />
                </div>
                <h3 className="text-xl font-semibold mb-2 text-white">Welcome to Private DAO Voting</h3>
                <p className="text-gray-400 mb-6 max-w-md mx-auto">No proposals yet. Create the first one to start encrypted governance — votes are sealed with Arcium MPC and only aggregate results are revealed.</p>
                <button onClick={() => setModal(true)} className="btn-primary px-8 py-3 text-base">+ Create First Proposal</button>

                <div className="mt-8 pt-6 border-t border-white/5 grid sm:grid-cols-3 gap-4 text-left max-w-lg mx-auto">
                  <div className="flex items-start gap-2">
                    <span className="text-cyan-400 text-sm font-bold mt-0.5">1.</span>
                    <p className="text-xs text-gray-500">Create a proposal with a title, description, and voting duration</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-cyan-400 text-sm font-bold mt-0.5">2.</span>
                    <p className="text-xs text-gray-500">Community members cast encrypted votes (YES / NO / ABSTAIN)</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-cyan-400 text-sm font-bold mt-0.5">3.</span>
                    <p className="text-xs text-gray-500">After voting ends, reveal the aggregate results with correctness proofs</p>
                  </div>
                </div>
              </div>
            )}

            <div id="section-proposals" className="space-y-4">
              {paginatedProposals.map((p) => {
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
                    currentVoteStep={voteStep[key] || "idle"}
                    onSelectChoice={(choice) => setSelected((s) => ({ ...s, [key]: choice }))}
                    onVote={() => vote(p, selected[key]!)}
                    onReveal={() => reveal(p)}
                    onClaimTokens={() => claimTokens(p)}
                    onToggleHide={() => toggleHideProposal(key)}
                    onVoteStepComplete={() => setVoteStep((s) => ({ ...s, [key]: "idle" }))}
                  />
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 pt-4">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 text-sm rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:border-cyan-500/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-8 h-8 text-sm rounded-lg transition-all ${
                      page === currentPage
                        ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                        : "bg-white/5 border border-white/10 text-gray-500 hover:text-white"
                    }`}
                  >
                    {page}
                  </button>
                ))}
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 text-sm rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:border-cyan-500/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}

            {/* Right panel content on smaller screens (below xl) */}
            <div className="xl:hidden space-y-4 mt-6">
              <NetworkVisualization isConnected={!!arciumClient} />
              {!loading && proposals.length > 0 && (
                <ActivityFeed connection={connection} />
              )}
            </div>
          </div>
        </DashboardLayout>
      )}

      {/* Overlays — always rendered regardless of layout */}
      <CreateModal isOpen={modal} onClose={() => setModal(false)} onSubmit={create} loading={creating} />
      {toast && <Toast message={toast.message} type={toast.type} txUrl={toast.txUrl} onClose={() => setToast(null)} />}
      <Confetti active={showConfetti} onDone={handleConfettiDone} />
      <OnboardingDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <DeveloperConsole arciumClient={arciumClient} isOpen={devConsoleOpen} onClose={() => setDevConsoleOpen(false)} />
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  revealResultsWithArcium,
  ensureTallyInitialized,
  devRevealResults,
  cancelProposal,
  initProgramConfig,
  transferAuthority,
  freezeProgram,
  unfreezeProgram,
  fetchProgramConfig,
  ProgramConfigData,
  communityCreateProposal,
  fetchDaoConfig,
  DaoConfigData,
  getDelegationsToMe,
  castDelegatedVote,
  hasUserVoted,
} from "../lib/contract";
import {
  ArciumClient,
  createArciumClient,
  MXE_PROGRAM_ID,
  DEVELOPMENT_MODE,
  CLUSTER_OFFSET,
  ArciumStatusEvent,
  deriveComputationOffset,
} from "../lib/arcium";
import { getVoteQueue, QueuedVote } from "../lib/vote-queue";
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
  const [proposals, setProposals] = useState<Proposal[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const cached = sessionStorage.getItem("cachedProposals");
      if (cached) {
        const parsed = JSON.parse(cached);
        // Rehydrate PublicKey and BN objects, filtering out any that fail
        return parsed
          .map((p: any) => {
            try {
              return {
                ...p,
                publicKey: new PublicKey(p.publicKey),
                id: new BN(p.id),
                authority: new PublicKey(p.authority),
                gateMint: new PublicKey(p.gateMint),
              };
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      }
    } catch {}
    return [];
  });
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
  const [cancelling, setCancelling] = useState<Record<string, boolean>>({});
  const [showConfetti, setShowConfetti] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [voteStep, setVoteStep] = useState<Record<string, VoteStep>>({});
  const PROPOSALS_PER_PAGE = 10;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [devConsoleOpen, setDevConsoleOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("dashboard");
  const [daoConfig, setDaoConfig] = useState<DaoConfigData | null>(null);
  const [queuedCount, setQueuedCount] = useState(() => {
    if (typeof window === "undefined") return 0;
    return getVoteQueue().getQueueLength();
  });

  // Program config state (mainnet readiness)
  const [programConfig, setProgramConfig] = useState<ProgramConfigData | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [transferTarget, setTransferTarget] = useState("");

  // Dev mode: track local vote tallies since MXE isn't aggregating
  const [devTallies, setDevTallies] = useState<Record<string, { yes: number; no: number; abstain: number }>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("devTallies") || "{}"); } catch { return {}; }
  });

  // Delegation state: delegators who have delegated to the connected wallet
  const [delegationsToMe, setDelegationsToMe] = useState<{ delegator: PublicKey; createdAt: number }[]>([]);
  // Track which delegator votes have already been cast per proposal: { proposalKey: Set<delegatorKey> }
  const [delegatorVoted, setDelegatorVoted] = useState<Record<string, Set<string>>>({});
  // Track delegated voting in progress: { "proposalKey:delegatorKey": true }
  const [delegatedVoting, setDelegatedVoting] = useState<Record<string, boolean>>({});
  // Track delegated vote choice selection: { "proposalKey:delegatorKey": choice }
  const [delegatedSelected, setDelegatedSelected] = useState<Record<string, "yes" | "no" | "abstain" | null>>({});

  const [hiddenProposals, setHiddenProposals] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('hiddenProposals');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
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
    const provider = new AnchorProvider(connection, anchorWallet, {
      commitment: "confirmed",
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

  // Submit a queued vote on-chain
  const submitQueuedVote = useCallback(async (qv: QueuedVote) => {
    const program = getProgram();
    if (!program || !publicKey) throw new Error("Program or wallet unavailable");

    const proposalPDA = new PublicKey(qv.proposalPDA);
    const gateMint = new PublicKey(qv.gateMint);

    await devCastVote(
      program, publicKey, proposalPDA, gateMint,
      qv.encryptedChoice, qv.nonce, qv.voterPubkey
    );

    // Track the vote locally for dev tally
    const key = qv.proposalPDA;
    setDevTallies((prev) => {
      const current = prev[key] || { yes: 0, no: 0, abstain: 0 };
      const updated = {
        ...prev,
        [key]: {
          yes: current.yes + (qv.choice === "yes" ? 1 : 0),
          no: current.no + (qv.choice === "no" ? 1 : 0),
          abstain: current.abstain + (qv.choice === "abstain" ? 1 : 0),
        },
      };
      localStorage.setItem("devTallies", JSON.stringify(updated));
      return updated;
    });

    setVoted((v) => ({ ...v, [key]: true }));
  }, [getProgram, publicKey]);

  // Initialize ArciumClient when wallet connects
  useEffect(() => {
    if (!anchorWallet || !connected) {
      setArciumClient(null);
      return;
    }

    const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
    const client = createArciumClient(provider, CLUSTER_OFFSET);

    const unsub = client.onStatusChange((event: ArciumStatusEvent) => {
      setIsEncrypting(event.status === "ENCRYPTING");
    });

    client.initialize(MXE_PROGRAM_ID).then((success) => {
      if (success) {
        setArciumClient(client);
      }
    });

    return () => { unsub(); };
  }, [connected, anchorWallet, connection]);

  // Wire up vote queue: listen for changes and process on MXE reconnect
  useEffect(() => {
    const voteQueue = getVoteQueue();

    // Sync queue count state with actual queue
    const unsubQueue = voteQueue.onChange((len) => setQueuedCount(len));

    // Clean expired votes on mount
    voteQueue.clearExpiredVotes();

    if (!arciumClient) return () => { unsubQueue(); };

    // When MXE reconnects, process queued votes
    const unsubReconnect = arciumClient.onMXEReconnect(async () => {
      if (voteQueue.getQueueLength() === 0) return;
      setToast({ message: "MXE reconnected! Processing queued votes...", type: "info" });
      const result = await voteQueue.processQueue(submitQueuedVote);
      if (result.succeeded.length > 0) {
        setToast({
          message: `${result.succeeded.length} queued vote(s) submitted successfully!`,
          type: "success",
        });
      }
      if (result.remaining > 0) {
        setToast({
          message: `${result.remaining} vote(s) still pending. Will retry automatically.`,
          type: "info",
        });
      }
    });

    // If there are already queued votes and we're in fallback, start auto-retry
    if (arciumClient.isFallback() && voteQueue.getQueueLength() > 0) {
      voteQueue.startAutoRetry(submitQueuedVote);
    }

    return () => {
      unsubQueue();
      unsubReconnect();
      voteQueue.stopAutoRetry();
    };
  }, [arciumClient, submitQueuedVote]);

  // Check token balances for all proposals using batch RPC
  const checkTokenBalances = useCallback(async (proposalList: Proposal[]) => {
    if (!publicKey) return;
    // Deduplicate gate mints — most proposals share the same mint
    const mintSet = new Set(proposalList.map((p) => p.gateMint.toString()));
    const mintToBalance: Record<string, number> = {};

    // Single batched call per unique mint
    for (const mintStr of mintSet) {
      try {
        const mint = new PublicKey(mintStr);
        const ata = getAssociatedTokenAddressSync(mint, publicKey);
        const info = await connection.getTokenAccountBalance(ata);
        mintToBalance[mintStr] = Number(info.value.amount);
      } catch {
        mintToBalance[mintStr] = -1;
      }
    }

    const balances: Record<string, number> = {};
    for (const p of proposalList) {
      balances[p.publicKey.toString()] = mintToBalance[p.gateMint.toString()] ?? -1;
    }
    setTokenBalances(balances);
  }, [publicKey, connection]);

  // Load all proposals
  const load = useCallback(async () => {
    const program = getProgram();
    if (!program) return;
    // Only show loading skeleton if we have no cached proposals to display
    if (proposals.length === 0) setLoading(true);

    // Load program config and DAO config in parallel (non-blocking)
    fetchProgramConfig(program).then((config) => setProgramConfig(config)).catch(() => {});
    fetchDaoConfig(program).then((config) => setDaoConfig(config)).catch(() => {});

    try {
      const discriminatorFilter: GetProgramAccountsFilter = {
        memcmp: {
          offset: 0,
          bytes: Buffer.from(PROPOSAL_DISCRIMINATOR).toString("base64"),
          encoding: "base64",
        },
      };

      const rawAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [discriminatorFilter],
        commitment: "processed",
      });

      const mapped: Proposal[] = [];
      // Safe BN-to-number: clamp to MAX_SAFE_INTEGER to avoid garbage from old struct layouts
      const safeNum = (v: any): number => {
        if (!v) return 0;
        if (BN.isBN(v)) {
          try { const n = v.toNumber(); return n >= 0 && n <= 1e12 ? n : 0; } catch { return 0; }
        }
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 && n <= 1e12 ? n : 0;
      };
      for (const raw of rawAccounts) {
        try {
          const a = program.coder.accounts.decode("proposal", raw.account.data);
          mapped.push({
            publicKey: raw.pubkey,
            id: a.id,
            authority: a.authority,
            title: a.title,
            description: a.description,
            votingEndsAt: safeNum(a.votingEndsAt ?? a.voting_ends_at),
            isActive: a.isActive ?? a.is_active,
            isRevealed: a.isRevealed ?? a.is_revealed,
            totalVotes: safeNum(a.totalVotes ?? a.total_votes),
            gateMint: a.gateMint ?? a.gate_mint,
            minBalance: safeNum(a.minBalance ?? a.min_balance),
            yesVotes: safeNum(a.yesVotes ?? a.yes_votes),
            noVotes: safeNum(a.noVotes ?? a.no_votes),
            abstainVotes: safeNum(a.abstainVotes ?? a.abstain_votes),
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
      // Show proposals immediately — don't wait for vote records or balances
      setProposals(mapped);
      setLoading(false);

      // Cache for instant display on next visit
      try {
        const serializable = mapped.map((p) => ({
          ...p,
          publicKey: p.publicKey.toString(),
          id: p.id.toString(),
          authority: p.authority.toString(),
          gateMint: p.gateMint.toString(),
        }));
        sessionStorage.setItem("cachedProposals", JSON.stringify(serializable));
      } catch {}

      // Load vote records, token balances, and delegations in parallel (background)
      if (publicKey) {
        const [voteResults, , delegations] = await Promise.all([
          Promise.all(
            mapped.map(async (p) => {
              try {
                const [pda] = findVoteRecordPDA(p.publicKey, publicKey);
                await (program.account as any).voteRecord.fetch(pda);
                return { key: p.publicKey.toString(), voted: true };
              } catch {
                return { key: p.publicKey.toString(), voted: false };
              }
            })
          ),
          checkTokenBalances(mapped),
          getDelegationsToMe(program, publicKey),
        ]);
        const v: Record<string, boolean> = {};
        for (const r of voteResults) v[r.key] = r.voted;
        setVoted(v);
        setDelegationsToMe(delegations);

        // Check which delegator votes have already been cast per proposal
        if (delegations.length > 0) {
          const dvoted: Record<string, Set<string>> = {};
          await Promise.all(
            mapped.map(async (p) => {
              const pKey = p.publicKey.toString();
              const votedSet = new Set<string>();
              await Promise.all(
                delegations.map(async (d) => {
                  const alreadyVoted = await hasUserVoted(program, p.publicKey, d.delegator);
                  if (alreadyVoted) votedSet.add(d.delegator.toString());
                })
              );
              dvoted[pKey] = votedSet;
            })
          );
          setDelegatorVoted(dvoted);
        }
      } else {
        checkTokenBalances(mapped);
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
      setToast({ message: parseAnchorError(e), type: "error" });
    }
    setClaiming((c) => ({ ...c, [key]: false }));
  };

  // Track previous connection state for disconnect detection
  const wasConnectedRef = useRef(false);

  // Auto-load when wallet connects (or switches accounts), clear state on disconnect
  useEffect(() => {
    if (connected && anchorWallet && publicKey) {
      // Reset stale state from previous wallet before loading
      setVoted({});
      setSelected({});
      setTokenBalances({});
      setDelegationsToMe([]);
      setDelegatorVoted({});
      setDelegatedVoting({});
      setDelegatedSelected({});
      load();
      wasConnectedRef.current = true;
    } else {
      if (wasConnectedRef.current) {
        setToast({ message: "Wallet disconnected. Reconnect to continue voting.", type: "info" });
      }
      wasConnectedRef.current = false;
      setProposals([]);
      setVoted({});
      setSelected({});
      setTokenBalances({});
      setDelegationsToMe([]);
      setDelegatorVoted({});
      setDelegatedVoting({});
      setDelegatedSelected({});
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

    if (!title.trim() || title.length > 100) {
      setToast({ message: "Title must be 1-100 characters.", type: "error" });
      return;
    }
    if (!desc.trim() || desc.length > 5000) {
      setToast({ message: "Description must be 1-5000 characters.", type: "error" });
      return;
    }

    setCreating(true);
    try {
      const gateMint = new PublicKey(gateMintStr);
      const minBalance = new BN(minBalanceStr);

      let result: { tx: string; proposalId: BN; proposalPDA: PublicKey };

      if (daoConfig && !DEVELOPMENT_MODE) {
        // Community mode: anyone with sufficient governance tokens can create
        result = await withRetry(() => communityCreateProposal(
          program, publicKey, title, desc, duration, gateMint, minBalance,
          daoConfig.governanceMint
        ));
      } else {
        // Dev/fallback mode: authority-only proposal creation
        result = await withRetry(() => devCreateProposal(
          program, publicKey, title, desc, duration, gateMint, minBalance
        ));
      }

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
        client = createArciumClient(provider, CLUSTER_OFFSET);
        await client.initialize(MXE_PROGRAM_ID);
        setArciumClient(client);
      }

      const voteValue: 0 | 1 | 2 = choice === "yes" ? 1 : choice === "abstain" ? 2 : 0;
      setIsEncrypting(true);
      const encryptedVote = await client.encryptVote(voteValue, proposal.publicKey, publicKey);
      const secretInput = client.toSecretInput(encryptedVote);
      setIsEncrypting(false);
      setVoteStep((s) => ({ ...s, [key]: "submitting" }));

      // Ensure tally account exists before voting
      await ensureTallyInitialized(program, publicKey, proposal.publicKey);

      let txSig: string;
      if (DEVELOPMENT_MODE || client.isFallback()) {
        txSig = await devCastVote(
          program, publicKey, proposal.publicKey, proposal.gateMint,
          secretInput.encryptedChoice, secretInput.nonce, secretInput.voterPubkey
        );
      } else {
        const computationOffset = deriveComputationOffset(proposal.publicKey, Date.now());
        const arciumAccounts = client.getArciumAccounts("cast_vote", computationOffset);
        txSig = await castVoteWithArcium(
          program, publicKey, proposal.publicKey, proposal.gateMint,
          secretInput.encryptedChoice, secretInput.nonce, secretInput.voterPubkey,
          arciumAccounts
        );
      }

      setVoteStep((s) => ({ ...s, [key]: "processing" }));

      // In dev/fallback mode, track the vote choice locally for reveal
      if (DEVELOPMENT_MODE || client.isFallback()) {
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

      // If MXE is in fallback mode and the on-chain tx failed, queue for retry
      const isMXEDown = arciumClient?.isFallback() || false;
      const msg = e?.message || "";
      const isNetworkError =
        msg.includes("failed to fetch") ||
        msg.includes("FetchError") ||
        msg.includes("NetworkError") ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("503") ||
        msg.includes("502") ||
        msg.includes("429") ||
        msg.includes("Blockhash not found") ||
        msg.includes("blockhash not found") ||
        msg.includes("cluster") ||
        msg.includes("MXE");

      if ((isMXEDown || isNetworkError) && !msg.includes("InsufficientBalance") && !msg.includes("User rejected")) {
        // Queue the vote for retry when MXE comes back
        const voteQueue = getVoteQueue();
        const client = arciumClient;
        if (client) {
          const voteValue: 0 | 1 | 2 = choice === "yes" ? 1 : choice === "abstain" ? 2 : 0;
          try {
            const encryptedVote = await client.encryptVote(voteValue, proposal.publicKey, publicKey);
            const secretInput = client.toSecretInput(encryptedVote);
            voteQueue.enqueue({
              proposalPDA: key,
              encryptedChoice: secretInput.encryptedChoice,
              nonce: secretInput.nonce,
              voterPubkey: secretInput.voterPubkey,
              walletPubkey: publicKey.toBase58(),
              gateMint: proposal.gateMint.toBase58(),
              choice,
            });
            voteQueue.startAutoRetry(submitQueuedVote);
            setToast({ message: "Vote queued -- will auto-submit when MXE reconnects", type: "info" });
          } catch {
            // Encryption itself failed -- show original error
            setToast({ message: parseAnchorError(e), type: "error" });
          }
        } else {
          setToast({ message: parseAnchorError(e), type: "error" });
        }
      } else {
        setToast({ message: parseAnchorError(e), type: "error" });
      }
    }
    setVoting((v) => ({ ...v, [key]: false }));
  };

  // Cast a delegated vote on behalf of a delegator
  const voteAsDelegate = async (proposal: Proposal, delegator: PublicKey, choice: "yes" | "no" | "abstain") => {
    const program = getProgram();
    if (!program || !publicKey) return;

    const pKey = proposal.publicKey.toString();
    const dKey = delegator.toString();
    const compoundKey = `${pKey}:${dKey}`;
    setDelegatedVoting((v) => ({ ...v, [compoundKey]: true }));

    try {
      let client = arciumClient;
      if (!client) {
        const provider = new AnchorProvider(connection, anchorWallet!, { commitment: "confirmed" });
        client = createArciumClient(provider, CLUSTER_OFFSET);
        await client.initialize(MXE_PROGRAM_ID);
        setArciumClient(client);
      }

      const voteValue: 0 | 1 | 2 = choice === "yes" ? 1 : choice === "abstain" ? 2 : 0;
      const encryptedVote = await client.encryptVote(voteValue, proposal.publicKey, delegator);
      const secretInput = client.toSecretInput(encryptedVote);

      await ensureTallyInitialized(program, publicKey, proposal.publicKey);

      const txSig = await castDelegatedVote(
        program, publicKey, delegator, proposal.publicKey, proposal.gateMint,
        secretInput.encryptedChoice, secretInput.nonce, secretInput.voterPubkey
      );

      // Track dev tally
      if (DEVELOPMENT_MODE || client.isFallback()) {
        setDevTallies((prev) => {
          const current = prev[pKey] || { yes: 0, no: 0, abstain: 0 };
          const updated = {
            ...prev,
            [pKey]: {
              yes: current.yes + (choice === "yes" ? 1 : 0),
              no: current.no + (choice === "no" ? 1 : 0),
              abstain: current.abstain + (choice === "abstain" ? 1 : 0),
            },
          };
          localStorage.setItem("devTallies", JSON.stringify(updated));
          return updated;
        });
      }

      // Mark this delegator's vote as cast for this proposal
      setDelegatorVoted((prev) => {
        const updated = { ...prev };
        const set = new Set(prev[pKey] || []);
        set.add(dKey);
        updated[pKey] = set;
        return updated;
      });
      setDelegatedSelected((s) => ({ ...s, [compoundKey]: null }));
      setToast({ message: `Delegated vote cast for ${dKey.slice(0, 4)}...${dKey.slice(-4)}!`, type: "success", txUrl: explorerTxUrl(txSig) });
      load();
    } catch (e: any) {
      console.error("Delegated vote error:", e);
      setToast({ message: parseAnchorError(e), type: "error" });
    }
    setDelegatedVoting((v) => ({ ...v, [compoundKey]: false }));
  };

  // Reveal results (permissionless after voting ends)
  const reveal = async (proposal: Proposal) => {
    const program = getProgram();
    if (!program || !publicKey) return;

    const key = proposal.publicKey.toString();
    setRevealing((r) => ({ ...r, [key]: true }));

    try {
      let client = arciumClient;
      const useDevMode = DEVELOPMENT_MODE || !client || client.isFallback();

      if (useDevMode) {
        // Dev/fallback mode: use local tallies
        const tally = devTallies[key] || { yes: 0, no: 0, abstain: 0 };
        const txSig = await devRevealResults(program, publicKey, proposal.publicKey, tally.yes, tally.no, tally.abstain);
        setToast({ message: "Results revealed!", type: "success", txUrl: explorerTxUrl(txSig) });
      } else {
        // Production MXE mode: queue finalize_and_reveal computation
        const computationOffset = deriveComputationOffset(proposal.publicKey, Date.now());
        const arciumAccounts = client!.getArciumAccounts("finalize_and_reveal", computationOffset);
        const txSig = await revealResultsWithArcium(
          program, publicKey, proposal.publicKey, arciumAccounts
        );
        setToast({
          message: "Reveal computation queued. MXE will deliver results via callback.",
          type: "success",
          txUrl: explorerTxUrl(txSig),
        });
      }
      load();
    } catch (e: any) {
      console.error("Reveal error:", e);
      setToast({ message: parseAnchorError(e), type: "error" });
    }
    setRevealing((r) => ({ ...r, [key]: false }));
  };

  // Cancel proposal (authority only)
  const cancel = async (proposal: Proposal) => {
    const program = getProgram();
    if (!program || !publicKey) return;

    const key = proposal.publicKey.toString();
    setCancelling((c) => ({ ...c, [key]: true }));

    try {
      const txSig = await cancelProposal(program, publicKey, proposal.publicKey);
      setToast({ message: "Proposal cancelled.", type: "success", txUrl: explorerTxUrl(txSig) });
      load();
    } catch (e: any) {
      console.error("Cancel error:", e);
      setToast({ message: parseAnchorError(e), type: "error" });
    }
    setCancelling((c) => ({ ...c, [key]: false }));
  };

  // ==================== ADMIN ACTIONS (MAINNET READINESS) ====================

  const isAuthority = publicKey && programConfig && programConfig.authority.equals(publicKey);

  const handleInitConfig = async () => {
    const program = getProgram();
    if (!program || !publicKey) return;
    setAdminLoading(true);
    try {
      const txSig = await initProgramConfig(program, publicKey);
      setToast({ message: "ProgramConfig initialized.", type: "success", txUrl: explorerTxUrl(txSig) });
      const config = await fetchProgramConfig(program);
      setProgramConfig(config);
    } catch (e: any) {
      setToast({ message: parseAnchorError(e), type: "error" });
    }
    setAdminLoading(false);
  };

  const handleTransferAuthority = async () => {
    const program = getProgram();
    if (!program || !publicKey || !transferTarget) return;
    setAdminLoading(true);
    try {
      const newAuth = new PublicKey(transferTarget);
      const txSig = await transferAuthority(program, publicKey, newAuth);
      setToast({ message: `Authority transferred to ${newAuth.toBase58().slice(0, 8)}...`, type: "success", txUrl: explorerTxUrl(txSig) });
      setTransferTarget("");
      const config = await fetchProgramConfig(program);
      setProgramConfig(config);
    } catch (e: any) {
      setToast({ message: parseAnchorError(e), type: "error" });
    }
    setAdminLoading(false);
  };

  const handleToggleFreeze = async () => {
    const program = getProgram();
    if (!program || !publicKey || !programConfig) return;
    setAdminLoading(true);
    try {
      const txSig = programConfig.isFrozen
        ? await unfreezeProgram(program, publicKey)
        : await freezeProgram(program, publicKey);
      setToast({
        message: programConfig.isFrozen ? "Program unfrozen." : "Program frozen.",
        type: "success",
        txUrl: explorerTxUrl(txSig),
      });
      const config = await fetchProgramConfig(program);
      setProgramConfig(config);
    } catch (e: any) {
      setToast({ message: parseAnchorError(e), type: "error" });
    }
    setAdminLoading(false);
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
    <div className="min-h-screen bg-mesh overflow-x-hidden">
      {!connected ? (
        /* ==================== HERO LANDING (unchanged) ==================== */
        <>
          <header className="sticky top-0 z-40 backdrop-blur-xl" role="banner" style={{ background: 'rgba(10, 10, 26, 0.85)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="max-w-6xl mx-auto flex justify-between items-center px-4 sm:px-6 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 glow-purple" style={{ background: 'linear-gradient(135deg, rgba(147,51,234,0.3), rgba(34,211,238,0.2))' }} aria-hidden="true">
                  <ShieldCheckIcon className="w-5 h-5 text-cyan-400" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-bold text-gradient truncate">Private DAO Voting</h1>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-gray-500 tracking-[0.2em] uppercase">Powered by Arcium</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <ThemeToggle />
                <WalletMultiButton />
              </div>
            </div>
          </header>

          <main id="main-content" className="max-w-6xl mx-auto px-4 sm:px-6 py-8" role="main">
            <div className="relative overflow-hidden">
              <div className="orb orb-purple w-[200px] h-[200px] sm:w-[400px] sm:h-[400px] -top-16 -left-16 sm:-top-32 sm:-left-32" aria-hidden="true" />
              <div className="orb orb-cyan w-[150px] h-[150px] sm:w-[300px] sm:h-[300px] top-20 -right-10 sm:right-0" aria-hidden="true" />
              <div className="orb orb-blue w-[120px] h-[120px] sm:w-[250px] sm:h-[250px] bottom-0 left-1/4 sm:left-1/3" aria-hidden="true" />

              <div className="relative grid-pattern py-16 sm:py-24">
                <div className="text-center mb-16">
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-cyan-500/20 bg-cyan-500/5 mb-8">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" aria-hidden="true" />
                    <span className="text-xs text-cyan-400">Built on Arcium MXE &mdash; Confidential Computing for Solana</span>
                  </div>

                  <h2 className="text-4xl sm:text-6xl lg:text-7xl font-display font-bold mb-6 leading-tight">
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
                    Governance without social pressure.
                  </p>

                  <WalletMultiButton />
                </div>

                <div className="grid sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
                  <div className="glass-card-elevated p-6 text-center group hover:border-cyan-500/20 transition-all duration-500">
                    <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mx-auto mb-4 group-hover:glow-cyan transition-all" aria-hidden="true">
                      <LockIcon className="w-6 h-6 text-cyan-400" />
                    </div>
                    <h3 className="font-display font-semibold text-white mb-2">Encrypted Votes</h3>
                    <p className="text-sm text-gray-400 leading-relaxed">Your vote is encrypted before it leaves your browser. No one &mdash; not even validators &mdash; can see how you voted.</p>
                  </div>

                  <div className="glass-card-elevated p-6 text-center group hover:border-purple-500/20 transition-all duration-500">
                    <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-4 group-hover:glow-purple transition-all">
                      <svg className="w-6 h-6 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                        <circle cx="8" cy="14" r="1" fill="currentColor" /><circle cx="13" cy="14" r="1" fill="currentColor" />
                        <path d="M8 14h5" />
                      </svg>
                    </div>
                    <h3 className="font-display font-semibold text-white mb-2">MPC Tallying</h3>
                    <p className="text-sm text-gray-400 leading-relaxed">Votes are tallied by a network of independent nodes, without ever being decrypted.</p>
                  </div>

                  <div className="glass-card-elevated p-6 text-center group hover:border-emerald-500/20 transition-all duration-500">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                      <ShieldCheckIcon className="w-6 h-6 text-emerald-400" />
                    </div>
                    <h3 className="font-display font-semibold text-white mb-2">Verified Results</h3>
                    <p className="text-sm text-gray-400 leading-relaxed">Cryptographic proofs ensure the final count is honest and tamper-proof.</p>
                  </div>
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
              <h2 className="text-xl sm:text-2xl font-display font-bold text-gradient truncate">Private DAO Governance</h2>
              <div className="hidden sm:flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  arciumClient
                    ? arciumClient.isFallback()
                      ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                      : "bg-green-500/10 text-green-400 border-green-500/20"
                    : DEVELOPMENT_MODE
                    ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                    : "bg-red-500/10 text-red-400 border-red-500/20"
                }`}>
                  {arciumClient
                    ? arciumClient.isFallback()
                      ? "Awaiting MXE"
                      : "MXE Active"
                    : DEVELOPMENT_MODE ? "Dev Mode" : "MXE Offline"}
                </span>
                {queuedCount > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full border bg-orange-500/10 text-orange-400 border-orange-500/20 flex items-center gap-1"
                    title={`${queuedCount} vote(s) queued for retry when MXE reconnects`}>
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    {queuedCount} queued
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <WalletMultiButton />
            </div>
          </div>

          {/* Main scrollable content */}
          <div id="section-dashboard" className="px-6 py-6 space-y-6" role="main" aria-label="Governance proposals">

            {/* Frozen banner */}
            {programConfig?.isFrozen && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center gap-3">
                <svg className="w-5 h-5 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <p className="text-sm text-amber-300">Governance is temporarily paused. New proposals and votes are blocked until the program authority unfreezes the system.</p>
              </div>
            )}

            {/* Admin panel — only visible to the program authority */}
            {isAuthority && (
              <div className="glass-card-elevated p-5 space-y-4 border border-purple-500/20">
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheckIcon className="w-4 h-4 text-purple-400" />
                  <h3 className="text-sm font-display font-semibold text-purple-300 uppercase tracking-wider">Admin Panel</h3>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  {/* Freeze / Unfreeze toggle */}
                  <button
                    onClick={handleToggleFreeze}
                    disabled={adminLoading}
                    className={`px-4 py-2 text-sm rounded-lg border transition-all disabled:opacity-50 ${
                      programConfig?.isFrozen
                        ? "bg-green-500/10 text-green-400 border-green-500/30 hover:bg-green-500/20"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
                    }`}
                  >
                    {programConfig?.isFrozen ? "Unfreeze Program" : "Freeze Program"}
                  </button>
                </div>

                {/* Transfer authority */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    placeholder="New authority pubkey (e.g., Squads multisig)..."
                    value={transferTarget}
                    onChange={(e) => setTransferTarget(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/40"
                  />
                  <button
                    onClick={handleTransferAuthority}
                    disabled={adminLoading || !transferTarget}
                    className="px-4 py-2 text-sm rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/30 hover:bg-purple-500/20 transition-all disabled:opacity-50 whitespace-nowrap"
                  >
                    Transfer Authority
                  </button>
                </div>

                <p className="text-[11px] text-gray-500">
                  Authority: {programConfig?.authority.toBase58().slice(0, 16)}...
                  {programConfig?.isFrozen ? " | Status: FROZEN" : " | Status: Active"}
                </p>
              </div>
            )}

            {/* Init ProgramConfig — shown if config doesn't exist and user is connected */}
            {!programConfig && connected && (
              <div className="glass-card p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 border border-white/5">
                <p className="text-xs text-gray-400 flex-1">ProgramConfig not initialized. Initialize it to enable freeze controls and authority transfer.</p>
                <button
                  onClick={handleInitConfig}
                  disabled={adminLoading}
                  className="px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:border-cyan-500/30 transition-all disabled:opacity-50"
                >
                  Initialize Config
                </button>
              </div>
            )}

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
                <h3 className="text-xl font-display font-semibold mb-2 text-white">Welcome to Private DAO Voting</h3>
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
                // Filter delegations: only show delegators who haven't voted yet on this proposal
                const availableDelegations = delegationsToMe.filter(
                  (d) => !(delegatorVoted[key]?.has(d.delegator.toString()))
                );
                const votedDelegationCount = delegatorVoted[key]?.size ?? 0;
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
                    isCancelling={cancelling[key] || false}
                    isEncrypting={isEncrypting}
                    currentVoteStep={voteStep[key] || "idle"}
                    onSelectChoice={(choice) => setSelected((s) => ({ ...s, [key]: choice }))}
                    onVote={() => vote(p, selected[key]!)}
                    onReveal={() => reveal(p)}
                    onCancel={() => cancel(p)}
                    onClaimTokens={() => claimTokens(p)}
                    onToggleHide={() => toggleHideProposal(key)}
                    onVoteStepComplete={() => setVoteStep((s) => ({ ...s, [key]: "idle" }))}
                    availableDelegations={availableDelegations}
                    votedDelegationCount={votedDelegationCount}
                    delegatedVoting={delegatedVoting}
                    delegatedSelected={delegatedSelected}
                    onDelegatedSelectChoice={(delegatorKey, choice) =>
                      setDelegatedSelected((s) => ({ ...s, [`${key}:${delegatorKey}`]: choice }))
                    }
                    onDelegatedVote={(delegator, choice) => voteAsDelegate(p, delegator, choice)}
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

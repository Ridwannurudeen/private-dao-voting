import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { AnchorProvider, Program, BN, Idl } from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import {
  PROGRAM_ID,
  findProposalPDA,
  findVoteRecordPDA,
  devCastVote,
  castVoteWithArcium,
  ensureTallyInitialized,
  devRevealResults,
} from "../../lib/contract";
import {
  ArciumClient,
  createArciumClient,
  MXE_PROGRAM_ID,
  DEVELOPMENT_MODE,
  CLUSTER_OFFSET,
  ArciumStatusEvent,
  deriveComputationOffset,
} from "../../lib/arcium";
import { Proposal } from "../../components/ProposalCard";
import { Toast, ToastData } from "../../components/Toast";
import { LockIcon, UnlockIcon, ShieldCheckIcon } from "../../components/Icons";
import { ExportResults } from "../../components/ExportResults";
import { EncryptionAnimation } from "../../components/EncryptionAnimation";
import { VoteProgress, VoteStep } from "../../components/VoteProgress";
import { parseAnchorError, explorerTxUrl } from "../../lib/errors";

import generatedIdl from "../../idl/private_dao_voting.json";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";

function formatTime(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return "Ended";
  const hours = Math.floor(secondsRemaining / 3600);
  const minutes = Math.floor((secondsRemaining % 3600) / 60);
  const seconds = Math.floor(secondsRemaining % 60);
  if (hours > 24) return Math.floor(hours / 24) + "d " + (hours % 24) + "h";
  if (hours > 0) return hours + "h " + minutes + "m " + seconds + "s";
  if (minutes > 0) return minutes + "m " + seconds + "s";
  return seconds + "s";
}

/** Build a read-only Anchor Program instance (no wallet required). */
function getReadOnlyProgram(conn: Connection): Program {
  // AnchorProvider needs a wallet interface, but we never sign anything.
  const dummyWallet = {
    publicKey: Keypair.generate().publicKey,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any[]) => txs,
  };
  const provider = new AnchorProvider(conn, dummyWallet as any, { commitment: "confirmed" });
  return new Program(generatedIdl as unknown as Idl, provider);
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export default function ProposalDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [nowTs, setNowTs] = useState(Math.floor(Date.now() / 1000));
  const [selected, setSelected] = useState<"yes" | "no" | "abstain" | null>(null);
  const [voting, setVoting] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [voted, setVoted] = useState(false);
  const [tokenBalance, setTokenBalance] = useState(-1);
  const [claiming, setClaiming] = useState(false);
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [currentVoteStep, setCurrentVoteStep] = useState<VoteStep>("idle");
  const [arciumClient, setArciumClient] = useState<ArciumClient | null>(null);

  const [devTallies, setDevTallies] = useState<Record<string, { yes: number; no: number; abstain: number }>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("devTallies") || "{}"); } catch { return {}; }
  });

  /* ---- read-only connection for unauthenticated fetches ---- */
  const readOnlyConnection = useMemo(() => new Connection(RPC_URL, "confirmed"), []);

  /* ---- clock ---- */
  useEffect(() => {
    const tick = () => setNowTs(Math.floor(Date.now() / 1000));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  /* ---- helpers ---- */
  const safeNum = (v: any): number => {
    if (!v) return 0;
    if (BN.isBN(v)) {
      try { const n = v.toNumber(); return n >= 0 && n <= 1e12 ? n : 0; } catch { return 0; }
    }
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 1e12 ? n : 0;
  };

  const getProgram = useCallback(() => {
    if (!anchorWallet) return null;
    const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
    return new Program(generatedIdl as unknown as Idl, provider);
  }, [connection, anchorWallet]);

  /* ---- Arcium client ---- */
  useEffect(() => {
    if (!anchorWallet || !connected) { setArciumClient(null); return; }
    const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
    const client = createArciumClient(provider, CLUSTER_OFFSET);
    const unsub = client.onStatusChange((event: ArciumStatusEvent) => {
      setIsEncrypting(event.status === "ENCRYPTING");
    });
    client.initialize(MXE_PROGRAM_ID).then((success) => {
      if (success) setArciumClient(client);
    });
    return () => { unsub(); };
  }, [connected, anchorWallet, connection]);

  /* ---- parse raw account into Proposal ---- */
  const parseProposal = useCallback((a: any, proposalPDA: PublicKey): Proposal => ({
    publicKey: proposalPDA,
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
  }), []);

  /* ---- fetch proposal (read-only, no wallet needed) ---- */
  const loadProposal = useCallback(async () => {
    if (!id) return;
    // Validate id is a numeric string before constructing BN
    const idStr = String(id);
    if (!/^\d+$/.test(idStr)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const proposalId = new BN(idStr);
      const [proposalPDA] = findProposalPDA(proposalId);
      const program = getReadOnlyProgram(readOnlyConnection);
      const a = await (program.account as any).proposal.fetch(proposalPDA);
      setProposal(parseProposal(a, proposalPDA));
    } catch (e: any) {
      console.error("Proposal not found:", e);
      setNotFound(true);
    }
    setLoading(false);
  }, [id, readOnlyConnection, parseProposal]);

  useEffect(() => {
    if (id) loadProposal();
  }, [id, loadProposal]);

  /* ---- when wallet connects, load user-specific state ---- */
  const loadWalletState = useCallback(async () => {
    if (!proposal || !publicKey || !anchorWallet) return;
    const program = getProgram();
    if (!program) return;
    try {
      // Re-fetch proposal with wallet-connected program (fresher data)
      const a = await (program.account as any).proposal.fetch(proposal.publicKey);
      setProposal(parseProposal(a, proposal.publicKey));

      // Check vote record
      try {
        const [voteRecordPDA] = findVoteRecordPDA(proposal.publicKey, publicKey);
        await (program.account as any).voteRecord.fetch(voteRecordPDA);
        setVoted(true);
      } catch {
        setVoted(false);
      }

      // Check token balance
      try {
        const gateMint = a.gateMint ?? a.gate_mint;
        const ata = getAssociatedTokenAddressSync(gateMint, publicKey);
        const info = await connection.getTokenAccountBalance(ata);
        setTokenBalance(Number(info.value.amount));
      } catch {
        setTokenBalance(-1);
      }
    } catch (e: any) {
      console.error("Error loading wallet state:", e);
    }
  }, [proposal?.publicKey?.toString(), publicKey, anchorWallet, getProgram, connection, parseProposal]);

  useEffect(() => {
    if (connected && anchorWallet && proposal) loadWalletState();
  }, [connected, anchorWallet, proposal?.publicKey?.toString()]);

  /* ---- reload helper (for after vote / reveal) ---- */
  const reload = useCallback(async () => {
    await loadProposal();
    if (connected && anchorWallet) {
      // wallet state will re-load via the useEffect above after proposal updates
    }
  }, [loadProposal, connected, anchorWallet]);

  /* ---- vote ---- */
  const vote = async (p: Proposal, choice: "yes" | "no" | "abstain") => {
    const program = getProgram();
    if (!program || !publicKey) return;
    const key = p.publicKey.toString();
    setVoting(true);
    setCurrentVoteStep("encrypting");

    try {
      let client = arciumClient;
      if (!client) {
        const provider = new AnchorProvider(connection, anchorWallet!, { commitment: "confirmed" });
        client = createArciumClient(provider, CLUSTER_OFFSET);
        await client.initialize(MXE_PROGRAM_ID);
        setArciumClient(client);
      }

      const voteValue: 0 | 1 | 2 = choice === "yes" ? 1 : choice === "abstain" ? 2 : 0;
      setIsEncrypting(true);
      const encryptedVote = await client.encryptVote(voteValue, p.publicKey, publicKey);
      const secretInput = client.toSecretInput(encryptedVote);
      setIsEncrypting(false);
      setCurrentVoteStep("submitting");

      await ensureTallyInitialized(program, publicKey, p.publicKey);

      let txSig: string;
      if (DEVELOPMENT_MODE || client.isFallback()) {
        txSig = await devCastVote(
          program, publicKey, p.publicKey, p.gateMint,
          secretInput.encryptedChoice, secretInput.nonce, secretInput.voterPubkey
        );
      } else {
        const computationOffset = deriveComputationOffset(p.publicKey, Date.now());
        const arciumAccounts = client.getArciumAccounts("vote", computationOffset);
        txSig = await castVoteWithArcium(
          program, publicKey, p.publicKey, p.gateMint,
          secretInput.encryptedChoice, secretInput.nonce, secretInput.voterPubkey,
          arciumAccounts
        );
      }

      setCurrentVoteStep("processing");

      if (DEVELOPMENT_MODE || (client && client.isFallback())) {
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

      await new Promise((r) => setTimeout(r, 800));
      setCurrentVoteStep("confirmed");

      setToast({ message: "Encrypted vote recorded on-chain!", type: "success", txUrl: explorerTxUrl(txSig) });
      setVoted(true);
      setSelected(null);
      reload();
    } catch (e: any) {
      console.error("Vote error:", e);
      setIsEncrypting(false);
      setCurrentVoteStep("idle");
      setToast({ message: parseAnchorError(e), type: "error" });
    }
    setVoting(false);
  };

  /* ---- reveal ---- */
  const reveal = async (p: Proposal) => {
    const program = getProgram();
    if (!program || !publicKey) return;
    const key = p.publicKey.toString();
    setRevealing(true);
    try {
      const tally = devTallies[key] || { yes: 0, no: 0, abstain: 0 };
      const txSig = await devRevealResults(program, publicKey, p.publicKey, tally.yes, tally.no, tally.abstain);
      setToast({ message: "Results revealed!", type: "success", txUrl: explorerTxUrl(txSig) });
      reload();
    } catch (e: any) {
      setToast({ message: parseAnchorError(e), type: "error" });
    }
    setRevealing(false);
  };

  /* ---- claim tokens ---- */
  const claimTokens = async (p: Proposal) => {
    if (!publicKey) return;
    setClaiming(true);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: publicKey.toBase58() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Faucet request failed");
      setToast({ message: "Gate tokens claimed! You can now vote.", type: "success" });
      reload();
    } catch (e: any) {
      setToast({ message: parseAnchorError(e), type: "error" });
    }
    setClaiming(false);
  };

  /* ---- derived state ---- */
  const liveRemaining = proposal ? Number(proposal.votingEndsAt) - nowTs : 0;
  const active = proposal ? proposal.isActive && liveRemaining > 0 : false;
  const isEnded = liveRemaining <= 0;
  const isUrgent = active && liveRemaining < 300;
  const isAuthority = publicKey && proposal?.authority?.equals?.(publicKey);
  const canReveal = isAuthority && isEnded && proposal && !proposal.isRevealed && proposal.isActive;

  const yes = proposal ? (typeof proposal.yesVotes === "number" ? proposal.yesVotes : 0) : 0;
  const no = proposal ? (typeof proposal.noVotes === "number" ? proposal.noVotes : 0) : 0;
  const abstain = proposal ? (typeof proposal.abstainVotes === "number" ? proposal.abstainVotes : 0) : 0;
  const total = proposal ? (typeof proposal.totalVotes === "number" ? proposal.totalVotes : 0) : 0;
  const yesPct = total > 0 ? Math.round((yes / total) * 100) : 0;
  const noPct = total > 0 ? Math.round((no / total) * 100) : 0;
  const abstainPct = total > 0 ? Math.round((abstain / total) * 100) : 0;

  /* ================================================================ */
  /* Render                                                           */
  /* ================================================================ */

  return (
    <div className="min-h-screen bg-mesh">
      <Head>
        <title>{proposal ? `${proposal.title} | Private DAO Voting` : "Proposal | Private DAO Voting"}</title>
      </Head>

      {/* ---- Header ---- */}
      <header className="sticky top-0 z-40 backdrop-blur-xl" style={{ background: 'rgba(10, 10, 26, 0.85)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="max-w-3xl mx-auto flex justify-between items-center p-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-white transition-colors">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-display font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Proposal Detail
            </h1>
          </div>
          <WalletMultiButton />
        </div>
        <div className="h-[1px] bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />
      </header>

      {/* ---- Main Content ---- */}
      <main className="max-w-3xl mx-auto p-6">
        {loading ? (
          /* Skeleton loader */
          <div className="space-y-4">
            <div className="glass-card neon-border p-6 animate-pulse">
              <div className="h-7 w-72 bg-white/10 rounded mb-3" />
              <div className="h-4 w-40 bg-white/5 rounded mb-5" />
              <div className="h-4 w-full bg-white/5 rounded mb-2" />
              <div className="h-4 w-full bg-white/5 rounded mb-2" />
              <div className="h-4 w-3/4 bg-white/5 rounded mb-6" />
              <div className="flex gap-3">
                <div className="flex-1 h-12 bg-white/5 rounded-xl" />
                <div className="flex-1 h-12 bg-white/5 rounded-xl" />
                <div className="flex-1 h-12 bg-white/5 rounded-xl" />
              </div>
            </div>
          </div>
        ) : notFound ? (
          /* Not found */
          <div className="text-center py-20">
            <LockIcon className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <h2 className="text-2xl font-display font-bold mb-2">Proposal Not Found</h2>
            <p className="text-gray-400 mb-6">This proposal may not exist or the ID may be incorrect.</p>
            <Link href="/" className="px-6 py-3 bg-gradient-to-r from-purple-600 to-cyan-500 rounded-xl font-semibold inline-block">
              Back to Proposals
            </Link>
          </div>
        ) : proposal ? (
          <div className="space-y-4">
            {/* ============================================ */}
            {/* Proposal Info -- always visible              */}
            {/* ============================================ */}
            <article className="glass-card-elevated neon-border p-4 sm:p-6 relative" aria-label={`Proposal: ${proposal.title}`} role="region">
              {/* Header row */}
              <div className="flex flex-col sm:flex-row justify-between items-start mb-4 gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-display font-semibold mb-1">{proposal.title}</h2>
                  <p className="text-sm text-gray-400">
                    by {proposal.authority.toString().slice(0, 4)}...{proposal.authority.toString().slice(-4)}
                  </p>
                </div>
                <div className="flex flex-row sm:flex-col items-start sm:items-end gap-2 flex-wrap">
                  {/* Status badge */}
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    active
                      ? "bg-green-500/20 text-green-400"
                      : proposal.isRevealed
                        ? "bg-blue-500/20 text-blue-400"
                        : "bg-gray-500/20 text-gray-400"
                  }`}>
                    {active ? "Active" : proposal.isRevealed ? "Revealed" : "Ended"}
                  </span>
                  {/* Privacy badge */}
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
                    proposal.isRevealed
                      ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
                      : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                  }`}>
                    {proposal.isRevealed ? (
                      <><UnlockIcon className="w-3 h-3" /> Results Public</>
                    ) : (
                      <><LockIcon className="w-3 h-3" /> Encrypted Tally</>
                    )}
                  </span>
                  {/* Time remaining */}
                  {active && (
                    <p className={`text-xs mt-0.5 font-mono ${isUrgent ? "text-red-400 animate-pulse" : "text-cyan-400"}`}>
                      {formatTime(liveRemaining)} left
                    </p>
                  )}
                </div>
              </div>

              {/* Description */}
              <div className="text-gray-300 mb-4 prose prose-sm prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                  {proposal.description}
                </ReactMarkdown>
              </div>

              {/* Metadata row */}
              <p className="text-xs text-gray-400 mb-4 break-all sm:break-normal">
                Gate: {proposal.gateMint.toString().slice(0, 8)}... | Min balance: {proposal.minBalance.toString()} | Votes: {total}
              </p>

              {/* ======= Results (visible to everyone when revealed) ======= */}
              {proposal.isRevealed && total > 0 && (
                <div className="mt-2 pt-4 border-t border-white/10">
                  <div className="flex flex-wrap justify-between text-sm mb-2 gap-1">
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
                  <ExportResults proposal={proposal} />
                </div>
              )}

              {/* ======= Encrypted votes vault (visible to everyone when active + has votes) ======= */}
              {active && total > 0 && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <div className={`bg-slate-800/50 rounded-xl p-4 border relative overflow-hidden ${voting ? "border-cyan-500/30" : "border-cyan-500/10"}`}>
                    <div className={`absolute inset-0 pointer-events-none ${voting ? "shimmer-bg-active" : "shimmer-bg"}`} />
                    <div className="relative flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ShieldCheckIcon className={`w-5 h-5 text-cyan-400 ${voting ? "animate-pulse" : "animate-pulse-slow"}`} />
                        <span className={`text-gray-300 ${voting ? "data-mask-animation" : ""}`}>{total} vote{total !== 1 ? "s" : ""} sealed</span>
                      </div>
                      <LockIcon className="w-4 h-4 text-cyan-400/50" />
                    </div>
                    <div className="relative flex items-center justify-center gap-3 mt-2 flex-wrap">
                      <span className="text-[10px] text-cyan-400/60 flex items-center gap-1">
                        <LockIcon className="w-2.5 h-2.5" /> Encrypted Shared State
                      </span>
                      <span className="text-[10px] text-gray-600 hidden sm:inline">|</span>
                      <span className="text-[10px] text-purple-400/60 flex items-center gap-1">
                        <ShieldCheckIcon className="w-2.5 h-2.5" /> Correctness Proofs
                      </span>
                    </div>
                    <p className="relative text-xs text-gray-400 text-center mt-1">Secured by Arcium MXE</p>
                  </div>
                </div>
              )}

              {/* ======= Ended but not revealed (visible to everyone) ======= */}
              {!active && !proposal.isRevealed && !(isAuthority && isEnded && proposal.isActive) && (
                <div className="mt-4 pt-4 border-t border-white/10 text-xs text-gray-400">
                  Voting ended. Pending reveal by the proposal authority.
                </div>
              )}
            </article>

            {/* ============================================ */}
            {/* Voting Section                               */}
            {/* ============================================ */}
            <div className="glass-card neon-border p-4 sm:p-6">
              {!connected ? (
                /* ---- Not connected: CTA ---- */
                <div className="text-center py-6">
                  <LockIcon className="w-10 h-10 text-purple-400 mx-auto mb-3" />
                  <h3 className="text-lg font-display font-semibold mb-1">Connect Wallet to Vote</h3>
                  <p className="text-sm text-gray-400 mb-5">
                    {active
                      ? "Connect your Solana wallet to cast an encrypted vote on this proposal."
                      : proposal.isRevealed
                        ? "This proposal has concluded and results are public."
                        : "Voting has ended. Connect your wallet to view your vote record."}
                  </p>
                  {active && (
                    <WalletMultiButton />
                  )}
                </div>
              ) : (
                /* ---- Connected: interactive voting UI ---- */
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">
                    {active ? "Cast Your Vote" : "Your Vote Status"}
                  </h3>

                  {/* Token gate check */}
                  {active && !voted && (tokenBalance < 0 || tokenBalance < Number(proposal.minBalance)) && (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 space-y-3">
                      <p className="text-sm text-yellow-400">
                        {tokenBalance < 0
                          ? "You need the gate token to vote on this proposal."
                          : `You need at least ${proposal.minBalance.toString()} gate token(s) to vote.`}
                      </p>
                      <button onClick={() => claimTokens(proposal)} disabled={claiming}
                        className="w-full py-3 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-xl font-semibold text-white disabled:opacity-50">
                        {claiming ? "Claiming..." : "Claim Gate Tokens"}
                      </button>
                    </div>
                  )}

                  {/* Voting buttons */}
                  {active && !voted && tokenBalance >= 0 && tokenBalance >= Number(proposal.minBalance) && (
                    <div className="space-y-3">
                      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                        <button onClick={() => setSelected("yes")} disabled={voting} aria-label="Vote Yes" aria-pressed={selected === "yes"}
                          className={`flex-1 py-3 rounded-xl font-semibold transition-all ${selected === "yes" ? "bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500 shadow-lg shadow-emerald-500/25" : "bg-white/5 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/10"}`}>
                          YES
                        </button>
                        <button onClick={() => setSelected("no")} disabled={voting} aria-label="Vote No" aria-pressed={selected === "no"}
                          className={`flex-1 py-3 rounded-xl font-semibold transition-all ${selected === "no" ? "bg-red-500/20 text-red-400 border-2 border-red-500 shadow-lg shadow-red-500/25" : "bg-white/5 text-red-400 border border-red-500/30 hover:bg-red-500/10"}`}>
                          NO
                        </button>
                        <button onClick={() => setSelected("abstain")} disabled={voting} aria-label="Vote Abstain" aria-pressed={selected === "abstain"}
                          className={`flex-1 py-3 rounded-xl font-semibold transition-all ${selected === "abstain" ? "bg-slate-500/20 text-slate-300 border-2 border-slate-400 shadow-lg shadow-slate-500/25" : "bg-white/5 text-slate-400 border border-slate-500/30 hover:bg-slate-500/10"}`}>
                          ABSTAIN
                        </button>
                      </div>
                      {selected && (
                        <>
                          {voting && isEncrypting && <EncryptionAnimation active={true} />}
                          <button onClick={() => vote(proposal, selected)} disabled={voting}
                            aria-label={`Submit encrypted ${selected} vote`}
                            className="w-full py-3 bg-gradient-to-r from-purple-600 to-cyan-500 rounded-xl font-semibold disabled:opacity-50 hover:shadow-lg hover:shadow-cyan-500/20 transition-all border border-cyan-500/20">
                            {voting ? (isEncrypting ? "Encrypting vote..." : "Submitting to Solana...") : "Submit Encrypted Vote"}
                          </button>
                          {voting && (
                            <VoteProgress step={currentVoteStep} onComplete={() => setCurrentVoteStep("idle")} />
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Already voted */}
                  {active && voted && (
                    <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-4 flex items-center justify-center gap-2">
                      <ShieldCheckIcon className="w-5 h-5 text-cyan-400" />
                      <span className="text-cyan-400 text-sm sm:text-base">Your encrypted vote is sealed on-chain</span>
                    </div>
                  )}

                  {/* Reveal button (authority only) */}
                  {canReveal && (
                    <button onClick={() => reveal(proposal)} disabled={revealing}
                      className="w-full py-3 mt-3 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl font-semibold disabled:opacity-50 hover:shadow-lg hover:shadow-cyan-500/20 transition-all">
                      {revealing ? "Revealing..." : "Reveal Results"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ============================================ */}
            {/* On-chain details -- always visible           */}
            {/* ============================================ */}
            <div className="glass-card p-4 border border-white/5">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">On-Chain Details</h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Proposal PDA</span>
                  <a href={`https://explorer.solana.com/address/${proposal.publicKey.toString()}?cluster=devnet`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-cyan-400 hover:underline font-mono">
                    {proposal.publicKey.toString().slice(0, 16)}...
                  </a>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Authority</span>
                  <a href={`https://explorer.solana.com/address/${proposal.authority.toString()}?cluster=devnet`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-cyan-400 hover:underline font-mono">
                    {proposal.authority.toString().slice(0, 16)}...
                  </a>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Gate Mint</span>
                  <span className="text-gray-300 font-mono">{proposal.gateMint.toString().slice(0, 16)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Voting Ends</span>
                  <span className="text-gray-300">{new Date(Number(proposal.votingEndsAt) * 1000).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Program</span>
                  <a href={`https://explorer.solana.com/address/${PROGRAM_ID.toString()}?cluster=devnet`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-cyan-400 hover:underline font-mono">
                    {PROGRAM_ID.toString().slice(0, 16)}...
                  </a>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </main>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

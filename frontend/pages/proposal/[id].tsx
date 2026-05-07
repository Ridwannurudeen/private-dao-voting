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
        const arciumAccounts = client.getArciumAccounts("cast_vote", computationOffset);
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
  // Permissionless reveal: anyone can reveal after deadline; only authority before
  const canReveal = isEnded && proposal && !proposal.isRevealed && proposal.isActive;

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

  const status = proposal
    ? active ? { label: "Active", tone: "active" as const }
    : proposal.isRevealed ? { label: "Revealed", tone: "revealed" as const }
    : { label: "Ended", tone: "neutral" as const }
    : null;

  const idHex = proposal ? proposal.id.toString(16).padStart(4, "0") : "----";

  return (
    <div className="min-h-screen bg-page">
      <Head>
        <title>{proposal ? `${proposal.title} | Private DAO Voting` : "Proposal | Private DAO Voting"}</title>
      </Head>

      {/* ---- Header ---- */}
      <header className="sticky top-0 z-40" style={{ background: "rgba(10, 10, 13, 0.92)", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--ink-3)" }}>
        <div className="max-w-3xl mx-auto h-14 flex items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3 group">
            <svg className="w-4 h-4 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--paper-2)" }}>
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span className="font-mono text-[11px] tracking-widest uppercase text-paper-2 group-hover:text-paper-0 transition-colors">
              ← Proposals · #{idHex}
            </span>
          </Link>
          <WalletMultiButton />
        </div>
      </header>

      {/* ---- Main Content ---- */}
      <main className="max-w-3xl mx-auto px-5 sm:px-8 py-10">
        {loading ? (
          <div className="panel p-8">
            <div className="h-3 w-20 mb-6 animate-pulse" style={{ background: "var(--ink-3)" }} />
            <div className="h-9 w-3/4 mb-4 animate-pulse" style={{ background: "var(--ink-3)" }} />
            <div className="h-4 w-full mb-2 animate-pulse" style={{ background: "var(--ink-3)" }} />
            <div className="h-4 w-5/6 mb-2 animate-pulse" style={{ background: "var(--ink-3)" }} />
            <div className="h-4 w-2/3 mb-8 animate-pulse" style={{ background: "var(--ink-3)" }} />
            <div className="grid grid-cols-3 gap-2">
              <div className="h-10 animate-pulse" style={{ background: "var(--ink-3)" }} />
              <div className="h-10 animate-pulse" style={{ background: "var(--ink-3)" }} />
              <div className="h-10 animate-pulse" style={{ background: "var(--ink-3)" }} />
            </div>
          </div>
        ) : notFound ? (
          <div className="panel py-20 px-8 text-center">
            <div className="font-mono text-[11px] tracking-widest text-seal mb-3">404 · NOT FOUND</div>
            <h2 className="font-display text-paper-0 text-3xl tracking-tighter mb-3">
              No proposal at this ID.
            </h2>
            <p className="text-paper-2 text-[15px] leading-relaxed max-w-md mx-auto mb-8">
              This proposal may have been cancelled, the ID may be incorrect, or it may live on a different network.
            </p>
            <Link href="/" className="btn-primary">
              Back to proposals
            </Link>
          </div>
        ) : proposal && status ? (
          <div className="space-y-4">
            {/* ============= Proposal envelope ============= */}
            <article className="panel p-6 sm:p-8" aria-label={`Proposal: ${proposal.title}`} role="region">
              {/* Top meta row */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] tracking-widest text-paper-3">
                    PROPOSAL · #{idHex}
                  </span>
                  <span className="hr-hair" style={{ width: 18, opacity: 0.5 }} />
                  <DetailStatusBadge status={status} />
                </div>
                {active && (
                  <span className={`font-mono text-[11px] tracking-wider tabular-nums ${isUrgent ? "animate-pulse" : ""}`}
                    style={{ color: isUrgent ? "var(--seal)" : "var(--paper-2)" }}>
                    {formatTime(liveRemaining)} left
                  </span>
                )}
              </div>

              {/* Title */}
              <h2 className="font-display text-paper-0 text-3xl sm:text-[40px] tracking-tighter leading-[1.05] mb-3">
                {proposal.title}
              </h2>
              <div className="h-meta mb-7">
                proposed by{" "}
                <span className="text-paper-1">
                  {proposal.authority.toString().slice(0, 4)}…{proposal.authority.toString().slice(-4)}
                </span>
              </div>

              {/* Description */}
              <div className="text-paper-1 text-[15px] leading-relaxed prose prose-invert max-w-none mb-8">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                  {proposal.description}
                </ReactMarkdown>
              </div>

              {/* Metadata strip */}
              <div className="grid grid-cols-3 gap-px mb-8" style={{ background: "var(--ink-3)" }}>
                <DetailMeta label="Ballots" value={String(total)} bg="var(--ink-1)" />
                <DetailMeta label="Min gate" value={proposal.minBalance.toString()} bg="var(--ink-1)" />
                <DetailMeta label="State" value={active ? "Sealed" : proposal.isRevealed ? "Revealed" : "Closed"} bg="var(--ink-1)" />
              </div>

              {/* ======= Active + has ballots: redacted tally ======= */}
              {active && total > 0 && (
                <div className="envelope p-5" style={{ background: "var(--ink-2)", border: "1px solid var(--seal-line)" }}>
                  <div className="relative z-10 flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className="seal-dot seal-dot-pulse" aria-hidden="true" />
                      <span className="font-display italic text-paper-1 text-[18px]">
                        {total} ballot{total !== 1 ? "s" : ""} sealed inside the MXE
                      </span>
                    </div>
                    <span className="font-mono text-[10px] tracking-widest text-paper-3 uppercase hidden sm:inline">
                      Cerberus
                    </span>
                  </div>
                  <div className="relative z-10 grid grid-cols-3 gap-3 mt-4">
                    <RedactedTally label="Yes" />
                    <RedactedTally label="No" />
                    <RedactedTally label="Abstain" />
                  </div>
                </div>
              )}

              {/* ======= Revealed: results ======= */}
              {proposal.isRevealed && total > 0 && (
                <div className="pt-2">
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <DetailResultCell label="Yes" count={yes} pct={yesPct} tone="reveal" />
                    <DetailResultCell label="No" count={no} pct={noPct} tone="crit" />
                    <DetailResultCell label="Abstain" count={abstain} pct={abstainPct} tone="steel" />
                  </div>
                  <div className="flex h-2 overflow-hidden mb-3" style={{ background: "var(--ink-2)", border: "1px solid var(--ink-3)", borderRadius: 999 }}>
                    {yesPct > 0 && <div style={{ width: yesPct + "%", background: "var(--reveal)" }} />}
                    {noPct > 0 && <div style={{ width: noPct + "%", background: "var(--crit)" }} />}
                    {abstainPct > 0 && <div style={{ width: abstainPct + "%", background: "var(--steel)" }} />}
                  </div>
                  <p className="h-meta text-center">{total} ballots · threshold-decrypted via MPC</p>
                  <ExportResults proposal={proposal} />
                </div>
              )}

              {/* ======= Ended but not revealed ======= */}
              {!active && !proposal.isRevealed && !(isAuthority && isEnded && proposal.isActive) && (
                <div className="h-meta">
                  Voting has ended. Anyone can trigger the reveal.
                </div>
              )}
            </article>

            {/* ============= Voting Section ============= */}
            <div className="panel p-6 sm:p-8">
              {!connected ? (
                <div className="text-center py-4">
                  <div className="section-label mb-3">{active ? "§ cast a ballot" : "§ wallet"}</div>
                  <h3 className="font-display text-paper-0 text-2xl tracking-tighter mb-2">
                    {active ? "Connect a wallet to vote." : proposal.isRevealed ? "Results are public." : "Voting has ended."}
                  </h3>
                  <p className="text-paper-2 text-[14px] leading-relaxed max-w-md mx-auto mb-6">
                    {active
                      ? "Your ballot is encrypted in your browser and only the aggregate ever appears on-chain."
                      : proposal.isRevealed
                      ? "Anyone can audit the final tally below."
                      : "Connect your wallet to view your ballot record."}
                  </p>
                  {active && <WalletMultiButton />}
                </div>
              ) : (
                <div>
                  <div className="section-label mb-4">{active ? "§ cast a ballot" : "§ ballot status"}</div>

                  {/* Token gate */}
                  {active && !voted && (tokenBalance < 0 || tokenBalance < Number(proposal.minBalance)) && (
                    <div className="p-4 mb-1" style={{
                      background: "var(--steel-soft)",
                      border: "1px solid var(--steel-line)",
                      borderRadius: 6,
                    }}>
                      <p className="text-[14px] text-paper-1 leading-snug mb-3">
                        {tokenBalance < 0
                          ? "You need the gate token to vote on this proposal."
                          : `You need at least ${proposal.minBalance.toString()} gate token(s) to vote.`}
                      </p>
                      <button onClick={() => claimTokens(proposal)} disabled={claiming} className="btn-secondary w-full">
                        {claiming ? "Claiming…" : "Claim gate tokens"}
                      </button>
                    </div>
                  )}

                  {/* Voting buttons */}
                  {active && !voted && tokenBalance >= 0 && tokenBalance >= Number(proposal.minBalance) && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => setSelected("yes")} disabled={voting} aria-pressed={selected === "yes"}
                          className={`btn-vote is-yes ${selected === "yes" ? "is-selected" : ""}`}>Yes</button>
                        <button onClick={() => setSelected("no")} disabled={voting} aria-pressed={selected === "no"}
                          className={`btn-vote is-no ${selected === "no" ? "is-selected" : ""}`}>No</button>
                        <button onClick={() => setSelected("abstain")} disabled={voting} aria-pressed={selected === "abstain"}
                          className={`btn-vote is-abstain ${selected === "abstain" ? "is-selected" : ""}`}>Abstain</button>
                      </div>
                      {selected && (
                        <>
                          {voting && isEncrypting && <EncryptionAnimation active={true} />}
                          <button onClick={() => vote(proposal, selected)} disabled={voting}
                            className="btn-primary w-full"
                            aria-label={`Submit encrypted ${selected} vote`}>
                            {voting ? (isEncrypting ? "Encrypting…" : "Submitting to Solana…") : "Seal & submit ballot"}
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
                    <div className="p-4 flex items-center gap-3" style={{
                      background: "var(--seal-soft)",
                      border: "1px solid var(--seal-line)",
                      borderRadius: 6,
                    }}>
                      <span className="seal-dot seal-dot-pulse" aria-hidden="true" />
                      <span className="font-display italic text-paper-1 text-[15px]">
                        Your ballot is sealed on-chain.
                      </span>
                    </div>
                  )}

                  {/* Reveal button */}
                  {canReveal && (
                    <button onClick={() => reveal(proposal)} disabled={revealing} className="btn-primary w-full mt-3">
                      {revealing ? "Revealing…" : "Reveal results"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ============= On-chain details ============= */}
            <div className="panel p-6">
              <div className="section-label mb-4">§ on-chain</div>
              <dl className="space-y-2.5">
                <DetailLink label="Proposal PDA"
                  short={`${proposal.publicKey.toString().slice(0, 12)}…${proposal.publicKey.toString().slice(-6)}`}
                  href={`https://explorer.solana.com/address/${proposal.publicKey.toString()}?cluster=devnet`} />
                <DetailLink label="Authority"
                  short={`${proposal.authority.toString().slice(0, 12)}…${proposal.authority.toString().slice(-6)}`}
                  href={`https://explorer.solana.com/address/${proposal.authority.toString()}?cluster=devnet`} />
                <DetailRow label="Gate mint"
                  value={`${proposal.gateMint.toString().slice(0, 12)}…${proposal.gateMint.toString().slice(-6)}`} />
                <DetailRow label="Voting ends"
                  value={new Date(Number(proposal.votingEndsAt) * 1000).toUTCString()} />
                <DetailLink label="Program"
                  short={`${PROGRAM_ID.toString().slice(0, 12)}…${PROGRAM_ID.toString().slice(-6)}`}
                  href={`https://explorer.solana.com/address/${PROGRAM_ID.toString()}?cluster=devnet`} />
              </dl>
            </div>
          </div>
        ) : null}
      </main>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

/* =========================================================================
   Sub-components — local to detail page
   ========================================================================= */

function DetailStatusBadge({ status }: { status: { label: string; tone: "active" | "revealed" | "neutral" } }) {
  const styles = {
    active: { color: "var(--seal)", border: "1px solid var(--seal-line)", background: "var(--seal-soft)" },
    revealed: { color: "var(--reveal)", border: "1px solid var(--reveal-line)", background: "var(--reveal-soft)" },
    neutral: { color: "var(--paper-2)", border: "1px solid var(--ink-3)", background: "transparent" },
  } as const;
  const s = styles[status.tone];
  return (
    <span
      className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 inline-flex items-center gap-1"
      style={{ ...s, borderRadius: 4 }}
    >
      {status.tone === "active" && <span style={{ width: 5, height: 5, borderRadius: 999, background: "currentColor" }} />}
      {status.label}
    </span>
  );
}

function DetailMeta({ label, value, bg }: { label: string; value: string; bg: string }) {
  return (
    <div className="px-4 py-3" style={{ background: bg }}>
      <div className="h-eyebrow mb-1">{label}</div>
      <div className="font-mono text-[13px] text-paper-1 tabular-nums">{value}</div>
    </div>
  );
}

function DetailResultCell({ label, count, pct, tone }: { label: string; count: number; pct: number; tone: "reveal" | "crit" | "steel" }) {
  const color = tone === "reveal" ? "var(--reveal)" : tone === "crit" ? "var(--crit)" : "var(--steel)";
  return (
    <div className="text-center">
      <div className="h-eyebrow mb-1">{label}</div>
      <div className="font-display text-paper-0 text-[28px] tracking-tighter leading-none mb-1" style={{ color }}>
        {count}
      </div>
      <div className="font-mono text-[11px] tabular-nums text-paper-3">{pct}%</div>
    </div>
  );
}

function RedactedTally({ label }: { label: string }) {
  return (
    <div className="text-center">
      <div className="h-eyebrow mb-1">{label}</div>
      <div className="redact-bar font-display text-[28px] tracking-widest leading-none" aria-hidden="true">
        ▓▓▓
      </div>
    </div>
  );
}

function DetailLink({ label, short, href }: { label: string; short: string; href: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="h-eyebrow">{label}</dt>
      <dd>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[12px] text-paper-1 hover:text-seal transition-colors"
        >
          {short}
        </a>
      </dd>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="h-eyebrow">{label}</dt>
      <dd className="font-mono text-[12px] text-paper-1 truncate">{value}</dd>
    </div>
  );
}

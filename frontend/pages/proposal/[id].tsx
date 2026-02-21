import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { AnchorProvider, Program, BN, Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import Link from "next/link";
import {
  PROGRAM_ID,
  findProposalPDA,
  findVoteRecordPDA,
  devCastVote,
  devRevealResults,
} from "../../lib/contract";
import {
  ArciumClient,
  createArciumClient,
  MXE_PROGRAM_ID,
  DEVELOPMENT_MODE,
  DEVNET_CLUSTER_OFFSET,
  ArciumStatusEvent,
} from "../../lib/arcium";
import { ProposalCard, Proposal } from "../../components/ProposalCard";
import { Toast, ToastData } from "../../components/Toast";
import { LockIcon, ShieldCheckIcon } from "../../components/Icons";

import generatedIdl from "../../idl/private_dao_voting.json";

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
  const [tokenBalance, setTokenBalance] = useState(0);
  const [claiming, setClaiming] = useState(false);
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [arciumClient, setArciumClient] = useState<ArciumClient | null>(null);

  const [devTallies, setDevTallies] = useState<Record<string, { yes: number; no: number; abstain: number }>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("devTallies") || "{}"); } catch { return {}; }
  });

  useEffect(() => {
    const tick = () => setNowTs(Math.floor(Date.now() / 1000));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  const getProgram = useCallback(() => {
    if (!anchorWallet) return null;
    const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
    return new Program(generatedIdl as unknown as Idl, provider);
  }, [connection, anchorWallet]);

  // Initialize Arcium client
  useEffect(() => {
    if (!anchorWallet || !connected) { setArciumClient(null); return; }
    const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
    const client = createArciumClient(provider, DEVNET_CLUSTER_OFFSET);
    const unsub = client.onStatusChange((event: ArciumStatusEvent) => {
      setIsEncrypting(event.status === "ENCRYPTING");
    });
    client.initialize(MXE_PROGRAM_ID).then((success) => {
      if (success) setArciumClient(client);
    });
    return () => { unsub(); };
  }, [connected, anchorWallet, connection]);

  // Load proposal by ID
  const load = useCallback(async () => {
    if (!id || !anchorWallet) return;
    const program = getProgram();
    if (!program) return;
    setLoading(true);

    try {
      const proposalId = new BN(id as string);
      const [proposalPDA] = findProposalPDA(proposalId);

      const a = await (program.account as any).proposal.fetch(proposalPDA);
      const p: Proposal = {
        publicKey: proposalPDA,
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
      };
      setProposal(p);

      // Check vote status
      if (publicKey) {
        try {
          const [voteRecordPDA] = findVoteRecordPDA(proposalPDA, publicKey);
          await (program.account as any).voteRecord.fetch(voteRecordPDA);
          setVoted(true);
        } catch {
          setVoted(false);
        }

        // Check token balance
        try {
          const ata = getAssociatedTokenAddressSync(p.gateMint, publicKey);
          const info = await connection.getTokenAccountBalance(ata);
          setTokenBalance(Number(info.value.amount));
        } catch {
          setTokenBalance(0);
        }
      }
    } catch (e: any) {
      console.error("Proposal not found:", e);
      setNotFound(true);
    }
    setLoading(false);
  }, [id, getProgram, publicKey, connection, anchorWallet]);

  useEffect(() => {
    if (connected && anchorWallet && id) load();
  }, [connected, anchorWallet, id, load]);

  const vote = async (p: Proposal, choice: "yes" | "no" | "abstain") => {
    const program = getProgram();
    if (!program || !publicKey) return;
    const key = p.publicKey.toString();
    setVoting(true);

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
      const encryptedVote = await client.encryptVote(voteValue, p.publicKey, publicKey);
      const secretInput = client.toSecretInput(encryptedVote, publicKey);
      setIsEncrypting(false);

      await devCastVote(
        program, publicKey, p.publicKey, p.gateMint,
        secretInput.encryptedChoice, secretInput.nonce, secretInput.voterPubkey
      );

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
      setVoted(true);
      setSelected(null);
      load();
    } catch (e: any) {
      console.error("Vote error:", e);
      setIsEncrypting(false);
      setToast({ message: e.message || "Vote failed", type: "error" });
    }
    setVoting(false);
  };

  const reveal = async (p: Proposal) => {
    const program = getProgram();
    if (!program || !publicKey) return;
    const key = p.publicKey.toString();
    setRevealing(true);
    try {
      const tally = devTallies[key] || { yes: 0, no: 0, abstain: 0 };
      await devRevealResults(program, publicKey, p.publicKey, tally.yes, tally.no, tally.abstain);
      setToast({ message: "Results revealed!", type: "success" });
      load();
    } catch (e: any) {
      setToast({ message: e.message || "Reveal failed", type: "error" });
    }
    setRevealing(false);
  };

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
      load();
    } catch (e: any) {
      setToast({ message: e.message || "Failed to claim tokens", type: "error" });
    }
    setClaiming(false);
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 sticky top-0 bg-slate-900/90 backdrop-blur-xl z-40">
        <div className="max-w-3xl mx-auto flex justify-between items-center p-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-white transition-colors">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">Proposal Detail</h1>
              <p className="text-[10px] text-gray-500 tracking-widest uppercase">Powered by Arcium</p>
            </div>
          </div>
          <WalletMultiButton />
        </div>
        <div className="h-[1px] bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />
      </header>

      <main className="max-w-3xl mx-auto p-6">
        {!connected ? (
          <div className="text-center py-20">
            <ShieldCheckIcon className="w-12 h-12 text-cyan-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Connect Wallet</h2>
            <p className="text-gray-400 mb-6">Connect your wallet to view this proposal</p>
            <WalletMultiButton />
          </div>
        ) : loading ? (
          <div className="space-y-4">
            <div className="glass-card neon-border p-6 animate-pulse">
              <div className="h-6 w-64 bg-white/10 rounded mb-4" />
              <div className="h-4 w-full bg-white/5 rounded mb-2" />
              <div className="h-4 w-3/4 bg-white/5 rounded mb-4" />
              <div className="flex gap-3">
                <div className="flex-1 h-12 bg-white/5 rounded-xl" />
                <div className="flex-1 h-12 bg-white/5 rounded-xl" />
                <div className="flex-1 h-12 bg-white/5 rounded-xl" />
              </div>
            </div>
          </div>
        ) : notFound ? (
          <div className="text-center py-20">
            <LockIcon className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Proposal Not Found</h2>
            <p className="text-gray-400 mb-6">This proposal may not exist or the ID may be incorrect.</p>
            <Link href="/" className="px-6 py-3 bg-gradient-to-r from-purple-600 to-cyan-500 rounded-xl font-semibold inline-block">
              Back to Proposals
            </Link>
          </div>
        ) : proposal ? (
          <div className="space-y-4">
            <ProposalCard
              proposal={proposal}
              nowTs={nowTs}
              publicKey={publicKey}
              hasVoted={voted}
              tokenBalance={tokenBalance}
              selectedChoice={selected}
              isVoting={voting}
              isRevealing={revealing}
              isClaiming={claiming}
              isEncrypting={isEncrypting}
              onSelectChoice={setSelected}
              onVote={() => vote(proposal, selected!)}
              onReveal={() => reveal(proposal)}
              onClaimTokens={() => claimTokens(proposal)}
              onToggleHide={() => {}}
            />

            {/* On-chain details */}
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
                  <span className="text-gray-300">{new Date(proposal.votingEndsAt.toNumber() * 1000).toLocaleString()}</span>
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

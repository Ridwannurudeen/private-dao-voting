# Private DAO Voting — Arcium Hackathon Submission

## One-Liner

Token-gated confidential governance on Solana where votes are encrypted end-to-end via Arcium MPC — individual choices are never revealed, only aggregate results with correctness proofs.

## Problem

On-chain voting is fundamentally broken because votes are public. This leads to:

- **Vote buying** — Buyers can verify votes and pay/punish accordingly
- **Social coercion** — Whales and leaders influence others by voting publicly first
- **Front-running** — MEV bots and strategic voters game outcomes by reading interim tallies
- **Voter apathy** — People abstain rather than face backlash for unpopular positions

Every major DAO (Uniswap, Aave, Compound) suffers from these problems. Governance participation rates are consistently below 10% — partly because voting publicly is risky.

## Solution

Private DAO Voting encrypts every vote before it leaves the voter's browser using x25519 ECDH + RescueCipher. The encrypted votes are submitted on-chain and processed inside Arcium's MXE (Multi-Party Computation eXecution Environment), where they are tallied as secret-shared encrypted values across independent Arx Nodes. No single node ever sees any individual vote.

Only after the voting deadline can the authority reveal the **aggregate** results (yes/no/abstain totals) — with cryptographic correctness proofs that the tally is mathematically valid. Individual vote values are never reconstructed.

## How Arcium Is Used

### Arcis Circuit (`arcis/voting-circuit/src/lib.rs`)

The core privacy logic uses the `#[encrypted]` module pattern with `#[instruction]` annotations:

- **`initialize_voting`** — Creates an `Enc<Mxe, Tally>` (cluster-owned encrypted state) with zero counters
- **`cast_vote`** — Receives `Enc<Mxe, Tally>` (cumulative state) + `Enc<Shared, u8>` (individual vote, client-encrypted). Uses constant-time `eq()` + `cast()` comparisons to increment the correct counter without branching on secret values
- **`finalize_and_reveal`** — Triggers Cerberus threshold decryption of aggregate totals only (never individual votes)

Key design: `Enc<Shared, u8>` for individual votes (client-encrypted via x25519 ECDH) vs `Enc<Mxe, Tally>` for cumulative state (cluster-owned, only decryptable via Cerberus threshold). The `circuit_hash!` macro embeds a SHA-256 of the compiled circuit at build time — verified at `init_comp_def` to detect tampered MPC bytecode.

### Cerberus Protocol (Dishonest Majority Security)

We chose Cerberus over honest-majority alternatives because governance demands the highest security guarantees. Cerberus provides **N-1 node resilience** — even if all but one Arx Node is malicious, they cannot learn individual votes or forge the tally. MAC-authenticated secret shares detect tampering, making vote manipulation cryptographically infeasible.

### Arcium Client (`frontend/lib/arcium.ts`)

The frontend integrates with Arcium via:
- x25519 key exchange with the MXE cluster's public key
- RescueCipher encryption of vote values
- CPI (Cross-Program Invocation) from the Anchor program to queue computations on the MXE
- Callback handling when the MXE returns results to the Solana program

### Privacy Guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| Vote secrecy | Encrypted secret shares across Arx Nodes |
| Coercion resistance | Votes never individually decryptable |
| Tally integrity | Cryptographic correctness proofs |
| Front-running prevention | Opaque encrypted tally until reveal |
| Threshold trust | Multi-node MPC — single node compromise reveals nothing |

## Technical Architecture

### On-Chain Accounts

| Account | PDA Seeds | Description |
|---------|-----------|-------------|
| **Proposal** | `["proposal", id]` | Title, description, voting deadline, gate mint, vote counts (u32), reveal status |
| **Tally** | `["tally", proposal]` | Encrypted vote accumulator, initialized per proposal |
| **VoteRecord** | `["vote_record", proposal, voter]` | Double-vote prevention; created on first vote |

### Program Instructions

| Instruction | Description | Access |
|-------------|-------------|--------|
| `dev_create_proposal` | Create proposal with title, description, voting period, and gate token | Any wallet |
| `dev_init_tally` | Initialize the tally account for a proposal | Proposal authority |
| `dev_cast_vote` | Submit an encrypted vote (dev mode, bypasses Arcium CPI) | Token holders |
| `dev_reveal_results` | Reveal aggregate results after voting ends | Proposal authority |
| `cast_vote` | Submit encrypted vote with full Arcium CPI (production) | Token holders |

### Security Layers

| Layer | Mechanism | What it prevents |
|-------|-----------|-----------------|
| Vote privacy | x25519 ECDH + RescueCipher encryption | Anyone reading vote content |
| Double voting | `VoteRecord` PDA per (proposal, voter) | Same wallet voting twice |
| Token gating | SPL token balance check before vote | Non-stakeholders influencing outcomes |
| Callback auth | Sign PDA signer constraint on callbacks | Unauthorized result injection |
| Time lock | `voting_ends_at` timestamp enforcement | Votes after deadline |
| MPC integrity | Dishonest majority Cerberus protocol | Malicious nodes learning votes or forging tallies |
| Circuit integrity | `circuit_hash!` SHA-256 verification | Tampered MPC bytecode |

### Gate Token Faucet

The frontend includes a built-in faucet (`/api/faucet`) for devnet testing:
- Mints gate tokens to **any** wallet that wants to vote
- Rate limited: max 3 claims per wallet per 10 minutes
- Auto-creates the Associated Token Account if needed
- Uses a server-side mint authority keypair to sign mint transactions

## Technical Highlights

- **Anchor program** deployed on Solana Devnet (`71tbXM3A2j5pKHfjtu1LYgY8jfQWuoZtHecDu6F6EPJH`)
- **Dev mode** — Full end-to-end testing without a live MXE cluster (same encryption pipeline, bypasses CPI)
- **CI pipeline** — GitHub Actions: build, E2E, rustfmt, security audit
- **Dashboard UI** — Three-panel layout with sidebar (MXE heartbeat, Arx Nodes, mempool capacity), main governance area, and right panel (live network visualization, activity feed)
- **Proposal sorting** — Active proposals first, then newest to oldest by creation time
- **Graceful error handling** — Undecodable legacy accounts are skipped, user-friendly Anchor error messages

## User Experience

- Glass morphism dark theme with full light mode support
- Animated encryption visualization (hex particles flowing into a lock)
- 4-step vote progress: Encrypting → Submitting → Processing → Confirmed
- Interactive "How It Works" walkthrough
- Confetti celebration on successful vote
- Real-time countdown timers with urgency pulse
- Keyboard shortcuts (N/R/Esc), ARIA accessibility, focus trapping
- PWA-installable, mobile-responsive
- Solana Explorer links in toast notifications
- CSV/JSON result export
- Shareable proposal links (`/proposal/[id]`)

## Why Arcium? — Technical Justification

Blockchain governance has a privacy gap that threatens institutional adoption. Traditional encryption protects data at rest and in transit, but computation requires decryption — meaning vote aggregation has always required a trusted party who sees every ballot. This is the "data-in-use" problem, and it's why no major institution trusts on-chain governance for consequential decisions.

Arcium's MXE is the missing infrastructure layer. By performing arithmetic directly on secret-shared values via the Cerberus protocol, Private DAO Voting achieves what was previously impossible: a governance system where votes are encrypted end-to-end — including *during* tallying. The MXE's dishonest-majority security (N-1 tolerance) means even a near-total compromise of the compute cluster cannot reveal individual votes or manipulate results.

This isn't a theoretical exercise. The `#[encrypted]` module pattern with `Enc<Mxe, Tally>` demonstrates Arcium's unique decentralized compute stack in a production-grade application: client-side encryption via x25519 ECDH, MXE mempool submission, MPC consensus across Arx Nodes, and Solana settlement callbacks — all with a consumer-grade UX. The architecture generalizes to any confidential aggregation problem: sealed-bid auctions, private credit scoring, confidential treasury management.

## Impact

Private voting is a prerequisite for legitimate on-chain governance. Without it, DAOs can't have meaningful votes because the act of voting publicly creates perverse incentives. Private DAO Voting demonstrates that Arcium's MPC makes confidential governance practical — with the same UX as a regular voting app but with mathematical privacy guarantees.

This pattern applies beyond DAOs: board elections, grant committees, community polls, employee surveys — any context where honest expression requires privacy.

## Links

- **Live Demo:** https://privatedao-arcium.vercel.app/
- **GitHub:** https://github.com/Ridwannurudeen/private-dao-voting
- **Program ID:** `71tbXM3A2j5pKHfjtu1LYgY8jfQWuoZtHecDu6F6EPJH` (Solana Devnet)
- **Gate Token Mint:** `6JeDjgobNYjSzuUUyEaiNnzphBDgVYcwf3u9HLNtPu17`

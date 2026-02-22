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

The core privacy logic runs inside Arcium's MXE:

- **`initialize_voting`** — Creates encrypted zero counters (`Enc<Shared, u64>`) for yes, no, abstain, and total
- **`cast_vote`** — Receives an encrypted vote (`Enc<Shared, u8>`) and uses constant-time encrypted comparisons (`eq()` + `cast()`) to increment the correct counter without ever decrypting the vote
- **`finalize_and_reveal`** — Triggers threshold decryption of aggregate totals only (never individual votes)

Key MPC design decision: We use `encrypted_vote.eq(&Enc::new(1u8)).cast()` instead of branching (`if vote == 1`) because MPC cannot branch on secret values — that would leak the vote to the evaluating node.

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

## Technical Highlights

- **Anchor program** with 8-layer security: token gating, double-vote PDA, delegation check, quorum enforcement, checked arithmetic, callback auth, time locks, MPC integrity
- **Vote delegation** — On-chain delegation PDAs with revocation, enforced at the program level
- **Quorum thresholds** — Configurable minimum vote count to prevent low-participation decisions
- **Dev mode** — Full testing without a live MXE cluster (same encryption pipeline, bypasses CPI)
- **29 tests** across 3 layers: 9 Anchor integration, 10 Playwright E2E, 10 Arcis circuit
- **CI pipeline** — 4 GitHub Actions jobs: build, E2E, rustfmt, security audit

## User Experience

- Glass morphism dark theme with full light mode support
- Animated encryption visualization (hex particles flowing into a lock)
- Interactive 5-step "How It Works" walkthrough
- Confetti celebration on successful vote
- Real-time countdown timers with urgency pulse
- Keyboard shortcuts (N/R/Esc), ARIA accessibility, focus trapping
- PWA-installable, mobile-responsive
- Solana Explorer links in notifications
- CSV/JSON result export
- Rate-limited devnet token faucet

## Impact

Private voting is a prerequisite for legitimate on-chain governance. Without it, DAOs can't have meaningful votes because the act of voting publicly creates perverse incentives. Private DAO Voting demonstrates that Arcium's MPC makes confidential governance practical — with the same UX as a regular voting app but with mathematical privacy guarantees.

This pattern applies beyond DAOs: board elections, grant committees, community polls, employee surveys — any context where honest expression requires privacy.

## Links

- **Live Demo:** https://privatedao-arcium.vercel.app/
- **GitHub:** https://github.com/Ridwannurudeen/private-dao-voting
- **Program ID:** `71tbXM3A2j5pKHfjtu1LYgY8jfQWuoZtHecDu6F6EPJH` (Solana Devnet)

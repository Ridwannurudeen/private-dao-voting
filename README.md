# Private DAO Voting

Fully confidential on-chain governance for Solana, powered by [Arcium](https://arcium.com) MXE.

**[Live on Devnet](https://privatedao-arcium.vercel.app/)** | [Demo Video](https://www.loom.com/share/b7599bd310024a6cbef18e3b7fa0f70b) | [Explorer](https://explorer.solana.com/address/71tbXM3A2j5pKHfjtu1LYgY8jfQWuoZtHecDu6F6EPJH?cluster=devnet)

Votes are encrypted client-side with x25519 + RescueCipher, submitted as ciphertext to Solana, and tallied inside Arcium's MXE via the Cerberus protocol (dishonest-majority MPC). Only the aggregate result is ever revealed on-chain. No validator, no DAO authority, no other voter can see how anyone voted.

---

## Features

- **End-to-end encrypted voting** -- x25519 ECDH key exchange with MXE + RescueCipher encryption
- **MPC tallying via Arcium** -- Cluster 456 Arx Nodes compute on encrypted data (Cerberus protocol)
- **Token-gated governance** -- SPL token balance required to vote, with built-in devnet faucet
- **Vote delegation** -- Delegate and revoke voting power to another wallet, enforced on-chain
- **Privacy levels** -- Configurable per-proposal privacy settings
- **Double-vote prevention** -- On-chain VoteRecord PDA per (proposal, voter) pair
- **Configurable quorum & threshold** -- Minimum total votes and minimum YES percentage (basis points)
- **Time-locked voting** -- Configurable voting period with real-time countdown
- **Graceful MXE fallback** -- Local encryption when MXE cluster is bootstrapping
- **Shareable proposals** -- Direct links via `/proposal/[id]`
- **Export results** -- Download as CSV or JSON
- **4-step vote progress** -- Encrypting, Submitting, Processing, Confirmed
- **Dark/light theme** -- Toggle with localStorage persistence
- **Keyboard shortcuts** -- `N` new proposal, `R` refresh, `Esc` close modals
- **Live activity feed** -- On-chain event monitoring
- **Stats dashboard** -- Participation metrics and proposal overview
- **MXE status monitor** -- Real-time cluster status (Active / Awaiting MXE / Offline)
- **Developer console** -- MXE debug panel with cluster info, circuit details, and protocol stats
- **Mobile-responsive** -- Optimized for all screen sizes
- **PWA-installable** -- Add to home screen via Web App Manifest

---

## Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Smart contract | Anchor (Solana) | 0.32.1 |
| MPC circuit | Arcis (Arcium) | 0.1.0 |
| Arcium client | @arcium-hq/client | 0.9.2 |
| Frontend | Next.js + React | 14.2.x |
| Styling | Tailwind CSS | 3.4.x |
| Wallet | Solana Wallet Adapter | latest |
| Token standard | SPL Token | 0.4.x |
| Testing | Vitest + Playwright | latest |

---

## Architecture

```
Voter's Browser              Solana Program              Arcium MXE (Cluster 456)
================             ==============              ========================

1. Choose YES/NO/ABSTAIN
        |
2. x25519 ECDH key exchange
   with MXE public key
        |
3. RescueCipher encrypt
   (vote -> ciphertext)
        |
4. Sign & submit tx  ----->  5. Verify SPL token gate
                                 Check VoteRecord PDA
                                 Store ciphertext on-chain
                                          |
                               6. CPI to Arcium MXE  ----->  7. Secret-share across
                                  (queue computation)           Arx Nodes (Cerberus)
                                                                       |
                                                              8. Encrypted tally
                                                                 (homomorphic add
                                                                  without decrypting)
                                                                       |
                                          <----------------------------+
                               9. Callback writes           10. Threshold decrypt
                                  revealed aggregate  <----     aggregate ONLY
                                  (yes, no, abstain)
```

### Project Structure

```
private-dao-voting/
├── arcis/voting-circuit/          # Arcis MPC circuit (Rust)
│   └── src/lib.rs                 #   Tally struct, cast_vote, finalize_and_reveal
├── programs/private-dao-voting/   # Anchor/Solana program (Rust)
│   └── src/lib.rs                 #   On-chain logic, token gating, Arcium CPI
├── frontend/
│   ├── pages/
│   │   ├── index.tsx              #   Dashboard with proposals and voting
│   │   ├── proposal/[id].tsx      #   Shareable proposal detail page
│   │   └── api/faucet.ts          #   Rate-limited gate token faucet
│   ├── components/                #   22 React components (ProposalCard, Sidebar,
│   │                              #   DeveloperConsole, NetworkVisualization, etc.)
│   └── lib/
│       ├── arcium.ts              #   ArciumClient -- encryption, MXE key exchange, fallback
│       ├── contract.ts            #   Solana program helpers (PDAs, instructions, delegation)
│       ├── errors.ts              #   Anchor error parsing with log extraction
│       └── retry.ts              #   Exponential backoff for RPC calls
├── tests/
│   └── private-dao-voting.test.ts
└── .github/workflows/ci.yml
```

---

## Security

| Layer | Mechanism | What It Prevents |
|-------|-----------|-----------------|
| Vote privacy | x25519 ECDH + RescueCipher | Anyone reading vote content |
| MPC integrity | Cerberus (dishonest majority, MAC-authenticated shares) | N-1 malicious nodes forging tallies |
| Circuit integrity | `circuit_hash!` SHA-256 at `init_comp_def` | Tampered MPC bytecode |
| Double voting | VoteRecord PDA per (proposal, voter) | Same wallet voting twice |
| Token gating | SPL token balance check | Non-stakeholders influencing outcomes |
| Callback auth | Sign PDA signer constraint on MXE callbacks | Unauthorized result injection |
| Time lock | `voting_ends_at` timestamp enforcement | Votes after deadline |
| Quorum & threshold | Minimum votes + minimum YES basis points | Low-turnout or marginal decisions |
| Delegation checks | On-chain delegate/revoke with PDA validation | Unauthorized proxy voting |
| Front-running | Encrypted tally opaque until finalize | Strategic last-minute voting |

For a full threat analysis and anti-collusion design rationale, see [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

---

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) + [Solana CLI](https://docs.solanalabs.com/cli/install) (v1.18+)
- [Anchor](https://www.anchor-lang.com/docs/installation) v0.32.1
- [Node.js](https://nodejs.org/) v18+
- A Solana wallet (Phantom, Solflare, etc.)

### Build & Deploy

```bash
git clone https://github.com/Ridwannurudeen/private-dao-voting.git
cd private-dao-voting

# Build the Anchor program
anchor build

# Deploy to Solana devnet
solana config set --url devnet
anchor deploy --provider.cluster devnet
```

### Run the Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # then edit with your values
npm run dev
# Open http://localhost:3000
```

### Run Tests

```bash
# Anchor integration tests
anchor test --skip-local-validator

# Arcis circuit unit tests
cd arcis/voting-circuit && cargo test

# Frontend tests
cd frontend && npm test
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SOLANA_RPC` | Yes | Solana RPC endpoint |
| `NEXT_PUBLIC_GATE_MINT` | Yes | SPL token mint for vote gating (default: `6JeDjgobNYjSzuUUyEaiNnzphBDgVYcwf3u9HLNtPu17`) |
| `NEXT_PUBLIC_MXE_PROGRAM_ID` | No | Arcium MXE program ID. Leave empty for dev mode. Set to `Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ` for production. |
| `NEXT_PUBLIC_CLUSTER_OFFSET` | No | MXE cluster offset (default: `456`) |
| `NEXT_PUBLIC_NETWORK` | No | Network name: `devnet` or `mainnet` (default: `devnet`) |
| `GATE_MINT_AUTHORITY` | Yes | Base64-encoded mint authority keypair (used by faucet API) |

---

## Deployment

| Component | Location |
|-----------|----------|
| **Solana Program** | [`71tbXM3A2j5pKHfjtu1LYgY8jfQWuoZtHecDu6F6EPJH`](https://explorer.solana.com/address/71tbXM3A2j5pKHfjtu1LYgY8jfQWuoZtHecDu6F6EPJH?cluster=devnet) (Devnet) |
| **Arcium MXE** | Cluster 456 (v0.8.5, Devnet) |
| **MXE Program** | `Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ` |
| **Gate Token Mint** | [`6JeDjgobNYjSzuUUyEaiNnzphBDgVYcwf3u9HLNtPu17`](https://explorer.solana.com/address/6JeDjgobNYjSzuUUyEaiNnzphBDgVYcwf3u9HLNtPu17?cluster=devnet) |
| **Frontend** | [privatedao-arcium.vercel.app](https://privatedao-arcium.vercel.app/) (Vercel) |

---

## License

MIT

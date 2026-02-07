# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Private DAO Voting system on Solana using Arcium Network's MPC (Multi-Party Computation) for confidential vote tallying. Individual votes are encrypted end-to-end and never revealed; only the aggregate result is made public via a callback mechanism.

## Build & Test Commands

```bash
# Build the Anchor program
anchor build

# Build the Arcis encrypted circuits (requires arcis CLI)
cd arcis/voting-circuit && cargo build

# Run all tests via script
./test.sh all           # unit + integration + e2e
./test.sh unit          # Arcis circuit + TS mock tests
./test.sh integration   # Rust integration tests
./test.sh e2e           # Full E2E with local validator

# Run tests individually
npm run test:unit       # TS mock tests: ts-mocha tests/mock-arcium.test.ts
npm run test:e2e        # anchor test --skip-local-validator
npm run test:all        # test:unit && test:e2e
npm run test:watch      # Watch mode
anchor test             # Full Anchor test suite with local validator

# Rust unit tests
cd programs/private-dao-voting && cargo test    # Anchor program tests
cd arcis/voting-circuit && cargo test           # Arcis circuit tests

# Frontend
cd frontend && npm run dev      # Next.js dev server
cd frontend && npm run build    # Production build

# Deploy
anchor deploy --provider.cluster devnet
```

## Architecture

The system has three layers that work together:

### 1. Arcis Encrypted Circuits (MPC layer)
- **`arcis/voting-circuit/src/lib.rs`** - Production Arcis circuit using `arcis::prelude::*`. Exports: `initialize_voting`, `cast_vote`, `finalize_and_reveal`, `get_vote_count`. Uses `Enc<Shared, T>` for encrypted state and `.reveal()` to decrypt.
- **`lib.rs`** (root) - Alternative circuit implementation using `arcis_imports::*` and `#[encrypted]` module pattern with `#[instruction]` attributes. Defines `VoteInput`, `VoteTally`, `VoteResult` structs. Includes `check_threshold_and_reveal` for automatic reveal.
- **`mod.rs`** (root) - Second circuit variant using `#[state]` struct pattern with `VotingState`, `#[callback]` attribute on `finalize_and_reveal`.

### 2. Solana Anchor Program (on-chain layer)
- **`programs/private-dao-voting/src/lib.rs`** - The deployed Anchor program (ID: `71tbXM3A2j5pKHfjtu1LYgY8jfQWuoZtHecDu6F6EPJH`).
- **Instructions**: `create_proposal`, `init_tally_callback`, `cast_vote`, `vote_callback`, `reveal_results`, `reveal_results_callback`, `init_comp_def`, `init_computation_offset`
- **PDAs**: `proposal` (seed: `b"proposal"` + id), `tally` (seed: `b"tally"` + proposal key), `vote_record` (seed: `b"vote_record"` + proposal + voter), `sign` (seed: `b"sign"`), `computation_offset` (seed: `b"computation_offset"`)
- **Token gating**: Voters must hold a specific SPL token (gate_mint) with minimum balance
- **Key deps**: `anchor-lang 0.32.1`, `anchor-spl 0.32.1`, `arcium-client 0.6.6`

### 3. Frontend (Next.js)
- **`frontend/`** - Next.js 14 app with Solana wallet adapter integration
- **`frontend/pages/`** - `_app.tsx`, `index.tsx`, `WalletProvider.tsx`
- **`frontend/hooks/useConfidentialVoting.ts`** - React hook for the voting flow
- **`frontend/lib/arcium.ts`** - Arcium client wrapper (use SDK functions like `getArciumProgramId()`, not raw `new PublicKey()`)
- **`frontend/lib/contract.ts`** - Anchor program interaction helpers

### Data Flow
1. Browser encrypts vote via Arcium SDK (x25519 DH + RescueCipher)
2. Anchor program validates voter (token gate + VoteRecord PDA for double-vote prevention), queues `queue_computation` CPI to Arcium
3. Arcium MXE cluster processes vote on secret shares (no node sees plaintext)
4. MXE calls back to Anchor program with updated encrypted tally
5. On reveal: authority triggers `reveal_results` after voting ends, MXE decrypts aggregate and calls `reveal_results_callback` with plaintext counts

### Test Infrastructure
- **`tests/mock-arcium.test.ts`** - TypeScript tests using mock Arcium (AES-256-GCM simulation)
- **`arcium-mock.ts`** (root) - Mock classes: `ArciumClient`, `SharedSecretManager`, `ArcisTestContext`, `VotingState`
- **`tests/mocks/`** - Additional mock utilities

## Key Conventions

- Anchor version: `0.32.1` (set in `Anchor.toml`)
- Cluster: Solana devnet
- Wallet: `~/.config/solana/id.json`
- Test timeout: 30000ms for unit tests, 1000000ms for Anchor tests
- TypeScript: ES2020 target, CommonJS modules, strict mode
- Rust: edition 2021, overflow-checks enabled in release, LTO fat
- Workspace has a `getrandom` patch pointing to git tag v0.2.12

## Arcium-Specific Patterns

- `Enc<Shared, T>` - Encrypted with shared secret (user + MXE can decrypt cooperatively)
- `Enc<Mxe, T>` - Encrypted to MXE cluster key only
- `.to_arcis()` / `.from_arcis()` - Decrypt/encrypt inside MPC (nodes see only secret shares)
- `.reveal()` - Reconstruct plaintext from shares (makes data public)
- `.cast::<T>()` - Type conversion on encrypted values
- Both branches of encrypted `if` statements always execute (prevents timing side-channels)
- Computation definitions: `init_tally`, `vote`, `reveal_result` (must match between circuit and program)

# Private DAO Voting — Production Upgrade Design

**Date:** 2026-03-18
**Goal:** Upgrade from demo-grade to production/hackathon-winning quality
**Approach:** Layered — SDK upgrade first, then wire stubbed features, then polish

---

## Current State

- **Arcium SDK**: `arcium-client` 0.6.6 (Rust), `@arcium-hq/client` 0.7.0 (TS) — **2 major versions behind** (latest: 0.9.2, Mar 15 2026)
- **Arcis circuit**: `arcis` 0.1 — **massive version gap**, API likely changed
- **Circuit hash**: hardcoded placeholder `"dev-mode-circuit-hash-placeholder"` — security hole
- **V2 features**: DaoConfig, ProposalCounter, quorum/threshold, delegation defined in program but not enforced
- **Tests**: Circuit tests strong (16 cases), e2e tests skip Arcium integration, no frontend unit tests
- **Deployment**: Solana devnet, program `71tbXM3A2j5pKHfjtu1LYgY8jfQWuoZtHecDu6F6EPJH`

## What We're NOT Doing (and Why)

- **Execution payloads**: Major new attack surface (CPI from proposal PDA as signer). Better to ship bulletproof V1 than half-baked V2. Documented in roadmap.
- **DaoConfig deposit system**: SOL escrow handling adds complexity with low demo value. Deferred.
- **ProposalCounter anti-spam**: Cosmetic for devnet. No judge creates 100 proposals.
- **Clean room rewrite**: Throws away 1400 lines of tested, edge-case-hardened program code.

---

## Phase 1: SDK & Foundation Upgrade

### Rust Dependencies

**`programs/private-dao-voting/Cargo.toml`:**
- `arcium-client` 0.6.6 → 0.9.2
- Keep `anchor-lang = "0.32.1"`, `anchor-spl = "0.32.1"` (current stable)

**`arcis/voting-circuit/Cargo.toml`:**
- `arcis` 0.1 → 0.9.2 (major jump — verify all encrypted type APIs)

### Circuit Hash Fix

**`programs/private-dao-voting/src/lib.rs` line 106:**
- Replace `"dev-mode-circuit-hash-placeholder"` with actual `circuit_hash!("voting_circuit")` output
- This is the SHA-256 of compiled circuit bytecode, verified at `init_comp_def`

### TypeScript Dependencies

**`frontend/package.json`:**
- `@arcium-hq/client` 0.7.0 → 0.9.2
- `@arcium-hq/reader` 0.7.0 → 0.9.2
- `@solana/web3.js` 1.87.6 → ^1.95.4 (matches SDK peer dep)
- `@solana/wallet-adapter-*` bump to latest stable

### Frontend Integration

**`frontend/lib/arcium.ts`:**
- Verify `RescueCipher`, `x25519`, key exchange patterns match 0.9.2 API
- Verify PDA derivation functions (`getClusterAccAddress`, `getMXEAccAddress`, etc.)
- Verify `getMXEPublicKey()` / `getMXEPublicKeyWithRetry()` still exist
- Update changed function signatures

### Deployment Scripts

- CLI flag: `-kp` → `-k` (clap v4 migration in 0.9.0)
- Remove `--authority` flag (authority now defaults to keypair signer)
- Verify `--cluster-offset 456` still valid for devnet

### Network Config Toggle

- Add `NEXT_PUBLIC_CLUSTER_OFFSET` env var (456 devnet, 2026 mainnet)
- Add `NEXT_PUBLIC_NETWORK` env var (`devnet` | `mainnet-beta`)
- Frontend reads these to configure RPC + cluster

### Risk: Arcis 0.1 → 0.9.2

This is a ~90x version jump. The circuit may need significant rewriting:
- Read 0.9.2 Arcis docs/examples BEFORE porting
- Test circuit independently before touching the program
- Budget for potential circuit rewrite if API changed significantly
- Check if `Enc<Mxe, Tally>`, `Enc<Shared, u8>`, `eq()` + `cast()` patterns still work

---

## Phase 2: Wire Stubbed V2 Features

### 2.1 Quorum + Threshold Enforcement

Fields already exist on Proposal struct but are cosmetic.

- `reveal_results_callback`: check `total_votes >= quorum` before marking as passed
- `reveal_results_callback`: check `yes_votes * 10000 / (yes + no) >= threshold_bps`
- Add `ProposalOutcome` enum: `Passed`, `Failed`, `QuorumNotReached`
- Frontend: show outcome badge on revealed proposals

### 2.2 Delegation Hardening

Current bug: delegation check uses `remaining_accounts` which can be bypassed if account doesn't exist.

- Add explicit `delegation` account to instruction context with Anchor constraints
- Use `has_one` and `constraint` macros for proper validation
- Validate delegation is active and not expired

---

## Phase 3: End-to-End Verification

The most critical phase. If a reviewer clicks "Vote" and it fails, nothing else matters.

- Deploy upgraded program to devnet
- Test full flow: create proposal → claim gate tokens → cast encrypted vote → MXE processes → reveal results
- Verify MXE callbacks arrive correctly
- Verify dev mode fallback still works when MXE is unavailable
- Update `deployed_idl.json` to match new program
- Update `frontend/idl/` to match

---

## Phase 4: Polish & Testing

### Frontend Tests

- Add Vitest config
- Test `lib/arcium.ts`: encryption pipeline, key exchange, cipher creation
- Test `lib/contract.ts`: PDA derivation, instruction building
- Test `lib/errors.ts`: Anchor error parsing
- Test `lib/retry.ts`: exponential backoff logic

### CI Hardening

- Remove `continue-on-error` from npm audit step (fail on high severity)
- Add `arcium build` step (verify circuit compiles)
- Add Vitest step for frontend unit tests
- Pin Node.js version

### Frontend Quality

- Loading skeletons for proposal list
- Optimistic UI updates after vote submission
- Better error toasts with human-readable Anchor error messages

### Documentation

- Update README: reflect 0.9.2 SDK, quorum/threshold, delegation
- Update architecture diagram
- Refresh screenshots
- Update SUBMISSION.md feature list

---

## Phase 5: Security Model Documentation

Show depth of thinking that sets this apart from other voting projects.

### Threat Model

Document what the system protects against and what it doesn't:

| Threat | Status | Mechanism |
|--------|--------|-----------|
| Vote content exposure | Protected | x25519 + RescueCipher + MPC |
| Double voting | Protected | VoteRecord PDA |
| Non-stakeholder voting | Protected | SPL token gating |
| Tally manipulation | Protected | Cerberus MPC + MAC auth |
| Front-running | Protected | Encrypted tally until reveal |
| Vote buying | Partially | Votes encrypted but voter can screenshot choice |
| Social coercion | Partially | Vote is private but participation is visible |
| Sybil attacks | Delegated | Token gating (depends on token distribution) |

### Anti-Collusion Analysis

Document how this compares to MACI and what receipt-free voting would require:
- Current limitation: voter knows their own vote and could prove it to a briber
- MACI approach: key rotation after voting makes old proofs invalid
- Arcium approach: could add key refresh via MXE computation (V2 roadmap item)
- Shutter Network approach: threshold encryption with time-locked decryption

### V2 Roadmap

- Confidential execution payloads (treasury transfers, config changes)
- Receipt-free voting via MXE key rotation
- Privacy toggles (Full / Partial / Transparent)
- Stake-to-propose deposit system
- SDK for other DAOs to integrate

---

## Success Criteria

1. Program builds and deploys on Arcium SDK 0.9.2
2. Full voting flow works end-to-end on devnet with live MXE (Cluster 456)
3. Circuit hash is real (not placeholder)
4. Quorum + threshold are enforced in reveal
5. Delegation checks cannot be bypassed
6. Frontend tests exist and pass in CI
7. README accurately reflects current state
8. Security model is documented

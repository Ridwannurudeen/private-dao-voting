# Private DAO Voting — Production Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade from demo-grade (SDK 0.6.6/0.7.0, placeholder circuit hash) to production/hackathon-winning quality (SDK 0.9.2, enforced governance rules, hardened delegation, polished UX, comprehensive tests).

**Architecture:** Layered upgrade — SDK foundation first, then wire stubbed V2 features, then end-to-end verification, then polish. Each phase is independently shippable. The Solana program (Anchor 0.32.1), Arcis MPC circuit, and Next.js frontend are all upgraded in lockstep.

**Tech Stack:** Anchor 0.32.1, Arcium SDK 0.9.2, Arcis 0.9.2, @arcium-hq/client 0.9.2, Next.js 14, React 18, Tailwind CSS 3, TypeScript 5

**Working Directory:** `C:\Users\GUDMAN\Desktop\Github files\private-dao-voting\`

---

## Migration Summary (0.6.6 → 0.9.2)

Three migration layers must be applied:

| Migration | Breaking Changes |
|-----------|-----------------|
| 0.6.x → 0.7.0 | Add LUT accounts to InitCompDef, remove `callback_url` from `queue_computation` |
| 0.7.0 → 0.8.0 | None (version bumps only) |
| 0.8.0 → 0.9.0 | CLI: `-kp` → `-k`, `--authority` removed; optional `confirmOptions` param on several functions |

**High-risk item:** `arcis` crate 0.1 → 0.9.2. Core circuit APIs (`Enc<Mxe, T>`, `#[encrypted]`, `.eq()`, `.cast()`, `.to_arcis()`, `.reveal()`) must be verified against current docs before touching the circuit.

---

## Task 1: Verify Arcis 0.9.2 API Compatibility

**Files:**
- Read: `arcis/voting-circuit/src/lib.rs`
- Read: Arcium docs at https://docs.arcium.com/developers/arcis and https://docs.arcium.com/developers/arcis/operations

**Step 1: Check current Arcis API docs**

Fetch the Arcis 0.9.2 documentation and verify these APIs still exist with same signatures:
- `#[encrypted]` module attribute
- `#[instruction]` function attribute
- `Enc<Mxe, T>` and `Enc<Shared, T>` types
- `Enc::new(value)` constructor
- `.to_arcis()` / `.from_arcis()` conversion
- `.eq()` encrypted equality
- `.cast()` type casting
- `.reveal()` threshold decryption
- `circuit_hash!("name")` macro
- `arcis::testing::TestContext` for tests

**Step 2: Document any API differences**

If any API changed, document what the new signatures look like. This informs whether the circuit needs rewriting or just version bumps.

**Step 3: No commit** (research only)

---

## Task 2: Upgrade Rust Dependencies

**Files:**
- Modify: `programs/private-dao-voting/Cargo.toml`
- Modify: `arcis/voting-circuit/Cargo.toml`
- Modify: `Cargo.lock` (auto-updated)

**Step 1: Update program Cargo.toml**

In `programs/private-dao-voting/Cargo.toml`, change:

```toml
# Old
arcium-client = { version = "0.6.6", default-features = false }

# New
arcium-client = { version = "0.9.2", default-features = false }
```

**Step 2: Update circuit Cargo.toml**

In `arcis/voting-circuit/Cargo.toml`, change:

```toml
# Old
[dependencies]
arcis = { version = "0.1", features = ["mxe"] }

[dev-dependencies]
arcis = { version = "0.1", features = ["testing"] }

# New
[dependencies]
arcis = { version = "0.9.2", features = ["mxe"] }

[dev-dependencies]
arcis = { version = "0.9.2", features = ["testing"] }
```

**Step 3: Run cargo check**

```bash
cd "C:/Users/GUDMAN/Desktop/Github files/private-dao-voting"
cargo check --all 2>&1
```

Expected: May fail with API changes — that's the signal for Task 3.

**Step 4: Commit if it compiles**

```bash
git add programs/private-dao-voting/Cargo.toml arcis/voting-circuit/Cargo.toml Cargo.lock
git commit -m "chore: upgrade arcium-client 0.6.6→0.9.2, arcis 0.1→0.9.2"
```

---

## Task 3: Fix Arcium CPI Breaking Changes (0.6.x → 0.9.2)

**Files:**
- Modify: `programs/private-dao-voting/src/lib.rs`

**Step 1: Check queue_computation signature**

The `queue_computation` CPI is called at 3 locations (lines ~239, ~359, ~442). The v0.6.3→v0.7.0 migration removed `callback_url`. Verify the current call signature matches 0.9.2.

Current call pattern (10 args):
```rust
queue_computation(
    cpi_ctx,
    computation_offset,
    comp_def_offset(COMP_NAME),
    None,           // was callback_url? verify
    args,
    proposal.mxe_program_id,
    Vec::<CallbackInstruction>::new(),
    0,
    0,
    0,
)?;
```

Compare against the 0.9.2 `queue_computation` function signature. Update all 3 call sites.

**Step 2: Check ArgumentRef / ArgumentList types**

The `ArgumentRef::EncryptedU8`, `ArgumentRef::EncryptedU32` variants and `ArgumentList` struct in `build_args_for_vote` (line 116) and `build_args_for_tally` (line 138) — verify these still exist in `arcium_client::idl::arcium::types`.

**Step 3: Check imports**

Current imports (line 62-65):
```rust
use arcium_client::idl::arcium::cpi::{accounts::QueueComputation, queue_computation};
use arcium_client::idl::arcium::program::Arcium;
use arcium_client::idl::arcium::types::{ArgumentList, ArgumentRef, CallbackInstruction};
use arcium_client::pda::comp_def_offset;
```

Verify all paths still exist in 0.9.2. Update any changed module paths.

**Step 4: Add LUT accounts to InitCompDef (v0.7.0 requirement)**

The `InitCompDef` struct (line 1077) needs two new accounts per the 0.6.3→0.7.0 migration:

```rust
#[derive(Accounts)]
pub struct InitCompDef<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + CompDefState::INIT_SPACE,
        seeds = [b"comp_def_state"],
        bump
    )]
    pub comp_def_state: Account<'info, CompDefState>,

    // NEW: LUT accounts required since v0.7.0
    /// CHECK: Address lookup table
    pub address_lookup_table: AccountInfo<'info>,
    /// CHECK: LUT program
    pub lut_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}
```

Verify exact field names and derivation against 0.9.2 docs.

**Step 5: Run cargo check**

```bash
cargo check --all 2>&1
```

Fix any remaining compile errors iteratively.

**Step 6: Run circuit tests**

```bash
cd arcis/voting-circuit && cargo test 2>&1
```

Expected: All 16 tests pass. If API changed, fix circuit code first.

**Step 7: Commit**

```bash
git add programs/private-dao-voting/src/lib.rs
git commit -m "fix: update Arcium CPI calls for SDK 0.9.2 (LUT accounts, queue_computation signature)"
```

---

## Task 4: Fix Circuit Hash Placeholder

**Files:**
- Modify: `programs/private-dao-voting/src/lib.rs:106`

**Step 1: Replace placeholder with build-time hash**

The circuit already has the correct macro in `arcis/voting-circuit/src/lib.rs:38`:
```rust
#[cfg(not(test))]
pub const CIRCUIT_HASH: &str = circuit_hash!("voting-circuit");
```

But the program has a placeholder at `programs/private-dao-voting/src/lib.rs:106`:
```rust
// Old
pub const CIRCUIT_HASH: &str = "dev-mode-circuit-hash-placeholder";
```

Change to:
```rust
// New — reads hash from build artifact at compile time
// In dev/test mode (no compiled circuit), use cfg flag
#[cfg(not(feature = "dev-mode"))]
pub const CIRCUIT_HASH: &str = circuit_hash!("voting-circuit");

#[cfg(feature = "dev-mode")]
pub const CIRCUIT_HASH: &str = "dev-mode-circuit-hash-placeholder";
```

Add the `dev-mode` feature to `programs/private-dao-voting/Cargo.toml`:
```toml
[features]
default = ["dev-mode"]  # dev-mode enabled by default for local testing
dev-mode = []
# ... existing features ...
```

For production builds: `cargo build --release --no-default-features`

**Note:** If `circuit_hash!` macro is not available in `arcium-client` 0.9.2 (it might be an arcis-only macro), use a build script or hardcode the actual hash after building the circuit. Verify which crate provides `circuit_hash!`.

**Step 2: Verify compile**

```bash
cargo check --all 2>&1
```

**Step 3: Commit**

```bash
git add programs/private-dao-voting/src/lib.rs programs/private-dao-voting/Cargo.toml
git commit -m "fix: replace circuit hash placeholder with build-time verification"
```

---

## Task 5: Upgrade TypeScript Dependencies

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json` (auto-updated)

**Step 1: Update package.json**

```json
{
  "dependencies": {
    "@arcium-hq/client": "^0.9.2",
    "@arcium-hq/reader": "^0.9.2",
    "@coral-xyz/anchor": "^0.32.1",
    "@solana/spl-token": "^0.4.8",
    "@solana/wallet-adapter-base": "^0.9.23",
    "@solana/wallet-adapter-react": "^0.15.39",
    "@solana/wallet-adapter-react-ui": "^0.9.39",
    "@solana/wallet-adapter-wallets": "^0.19.37",
    "@solana/web3.js": "^1.95.4",
    "next": "^14.2.35",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-markdown": "^10.1.0",
    "rehype-sanitize": "^6.0.0",
    "remark-gfm": "^4.0.1"
  }
}
```

**Step 2: Install**

```bash
cd frontend && npm install --legacy-peer-deps
```

**Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: May fail if @arcium-hq/client 0.9.2 changed exports. Fix in Task 6.

**Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: upgrade @arcium-hq/client 0.7.0→0.9.2, wallet adapter to latest"
```

---

## Task 6: Update Frontend Arcium Integration

**Files:**
- Modify: `frontend/lib/arcium.ts`

**Step 1: Verify imports**

Current imports (line 10-25):
```typescript
import {
  RescueCipher,
  x25519,
  getArciumProgramId,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getClusterAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getClockAccAddress,
  getFeePoolAccAddress,
  awaitComputationFinalization,
} from "@arcium-hq/client";
```

Check each import against 0.9.2 exports. The v0.7.0 migration added `getLookupTableAddress` — add it if needed.

**Step 2: Check for signature changes**

Verify these function calls still work with 0.9.2:
- `x25519.utils.randomPrivateKey()` (line 116)
- `x25519.getPublicKey(key)` (line 117)
- `x25519.getSharedSecret(priv, pub)` (line 191)
- `new RescueCipher(sharedSecret)` (line 195)
- `this.cipher.encrypt([BigInt(vote)], nonce)` (line 235)
- `getMXEPublicKey(provider, mxeProgramId)` (line 174)
- `getClusterAccAddress(offset)` (line 393)
- `awaitComputationFinalization(provider, offset, mxeProgramId)` (line 418)

**Step 3: Add network config toggle**

Add to `frontend/lib/arcium.ts`:
```typescript
// Network configuration
export const CLUSTER_OFFSET = new BN(
  parseInt(process.env.NEXT_PUBLIC_CLUSTER_OFFSET || "456")
);
export const NETWORK = process.env.NEXT_PUBLIC_NETWORK || "devnet";
```

Replace hardcoded `DEVNET_CLUSTER_OFFSET` references with `CLUSTER_OFFSET`.

**Step 4: Update .env.local template**

Add to `.env.local`:
```
# Network: devnet (cluster 456) or mainnet-beta (cluster 2026)
NEXT_PUBLIC_CLUSTER_OFFSET=456
NEXT_PUBLIC_NETWORK=devnet
```

**Step 5: Typecheck and build**

```bash
cd frontend && npx tsc --noEmit && npm run build
```

**Step 6: Commit**

```bash
git add frontend/lib/arcium.ts frontend/.env.local
git commit -m "feat: update Arcium client to 0.9.2, add network config toggle"
```

---

## Task 7: Wire Quorum + Threshold Enforcement

**Files:**
- Modify: `programs/private-dao-voting/src/lib.rs`

**Context:** The `reveal_results_callback` (line 461) already has quorum/threshold checking code at lines 481-509. But `create_proposal` (line 163) accepts `threshold_bps` but NOT `quorum`. The production `create_proposal` doesn't pass quorum at all — it stays at default 0.

**Step 1: Add quorum parameter to create_proposal**

At line 163, add `quorum: u64` parameter:

```rust
pub fn create_proposal(
    ctx: Context<CreateProposal>,
    proposal_id: u64,
    title: String,
    description: String,
    voting_ends_at: i64,
    gate_mint: Pubkey,
    min_balance: u64,
    mxe_program_id: Pubkey,
    quorum: u64,           // NEW
    threshold_bps: u16,
    privacy_level: u8,
    discussion_url: String,
    execution_delay: i64,
) -> Result<()> {
    // ... existing validation ...
    proposal.quorum = quorum;  // ADD this line after other field assignments
    // ...
}
```

**Step 2: Add ProposalOutcome to ResultsRevealed event**

Add an outcome field to the `ResultsRevealed` event (line 1385):

```rust
#[event]
pub struct ResultsRevealed {
    pub proposal: Pubkey,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub abstain_votes: u64,
    pub total_votes: u64,
    pub winner: u8,
    pub passed: bool,        // NEW: whether quorum + threshold were met
}
```

Update the emit at line 519 to include `passed: proposal.passed`.

**Step 3: Update dev_reveal_results to emit passed**

The `dev_reveal_results` function (line 752) also emits `ResultsRevealed` — add `passed: proposal.passed` there too (line 819).

**Step 4: Update frontend contract.ts**

The `devCreateProposal` function (line 80) already passes `quorum` but the `.devCreateProposal()` method call (line 100) only passes 6 args. Add the missing V2 params:

```typescript
.devCreateProposal(
    proposalId,
    title,
    description,
    votingEndsAt,
    gateMint,
    minBalance,
    quorum,
    thresholdBps,
    privacyLevel,
    discussionUrl,
    new BN(executionDelay)
)
```

**Step 5: Verify compile**

```bash
cargo check --all 2>&1
cd frontend && npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add programs/private-dao-voting/src/lib.rs frontend/lib/contract.ts
git commit -m "feat: wire quorum + threshold enforcement in create_proposal and reveal callbacks"
```

---

## Task 8: Harden Delegation Check

**Files:**
- Modify: `programs/private-dao-voting/src/lib.rs`

**Context:** At lines 295-307 and 700-712, delegation is checked via `remaining_accounts`. If the delegation account doesn't exist in remaining_accounts, the check is silently bypassed.

**Step 1: Extract delegation check into a helper**

Add after the constants section (~line 107):

```rust
/// Check if voter has an active delegation. Returns error if delegation exists.
/// Looks up the delegation PDA — if it exists and is owned by this program,
/// the voter must revoke it before voting directly.
fn check_no_active_delegation(
    voter: &Pubkey,
    remaining_accounts: &[AccountInfo],
    program_id: &Pubkey,
) -> Result<()> {
    let (delegation_pda, _) = Pubkey::find_program_address(
        &[DELEGATION_SEED, voter.as_ref()],
        program_id,
    );
    // Check remaining_accounts for the delegation PDA
    if let Some(acct) = remaining_accounts.iter().find(|a| a.key() == delegation_pda) {
        if acct.data_len() > 0 && acct.owner == program_id {
            return Err(VotingError::ActiveDelegation.into());
        }
    }
    Ok(())
}
```

**Step 2: Replace inline checks at both locations**

At line 295 (`cast_vote`) and line 700 (`dev_cast_vote`), replace the inline delegation check blocks with:

```rust
check_no_active_delegation(
    &ctx.accounts.voter.key(),
    ctx.remaining_accounts,
    ctx.program_id,
)?;
```

**Step 3: Add delegation account to remaining_accounts in frontend**

In `frontend/lib/contract.ts`, update `devCastVote` and `castVoteWithArcium` to pass the delegation PDA as a remaining account:

```typescript
import { findDelegationPDA } from "./contract";

// In devCastVote and castVoteWithArcium:
const [delegationPDA] = findDelegationPDA(voter);

// Add to method chain:
.remainingAccounts([
    { pubkey: delegationPDA, isSigner: false, isWritable: false }
])
```

**Step 4: Compile and test**

```bash
cargo check --all 2>&1
cd frontend && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add programs/private-dao-voting/src/lib.rs frontend/lib/contract.ts
git commit -m "fix: harden delegation check — extract helper, pass delegation PDA as remaining account"
```

---

## Task 9: Update IDL and Deployed Artifacts

**Files:**
- Regenerate: `target/idl/private_dao_voting.json`
- Modify: `deployed_idl.json`
- Modify: `frontend/idl/private_dao_voting.json` (if exists)

**Step 1: Build the program**

This requires Anchor CLI and Solana CLI. If running on Windows, use WSL2:

```bash
# In WSL2 or Linux:
cd /mnt/c/Users/GUDMAN/Desktop/"Github files"/private-dao-voting
anchor build
```

**Step 2: Copy IDL to deployed_idl.json**

```bash
cp target/idl/private_dao_voting.json deployed_idl.json
```

**Step 3: Copy IDL to frontend**

```bash
cp target/idl/private_dao_voting.json frontend/idl/private_dao_voting.json
```

**Step 4: Verify frontend still builds**

```bash
cd frontend && npx tsc --noEmit && npm run build
```

**Step 5: Commit**

```bash
git add target/idl/ deployed_idl.json frontend/idl/
git commit -m "chore: regenerate IDL after SDK upgrade and feature wiring"
```

---

## Task 10: End-to-End Verification on Devnet

**Files:**
- Test: Full voting flow on Solana devnet

**Step 1: Deploy upgraded program to devnet**

```bash
# In WSL2:
anchor deploy --provider.cluster devnet
```

Note the new program ID (should remain `71tbXM3A2j5pKHfjtu1LYgY8jfQWuoZtHecDu6F6EPJH` if upgrading).

**Step 2: Test dev mode flow**

Using the frontend (`npm run dev`):
1. Connect wallet
2. Claim gate tokens from faucet
3. Create a proposal (with quorum=3, threshold=5001)
4. Cast 3 YES votes (from different wallets if possible, or 1 from connected wallet)
5. Wait for voting period to end
6. Reveal results
7. Verify quorum/threshold enforcement in the UI

**Step 3: Test MXE production flow (if Cluster 456 is live)**

1. Set `NEXT_PUBLIC_MXE_PROGRAM_ID` in `.env.local`
2. Create proposal via production `create_proposal` (Arcium CPI)
3. Cast vote — verify MXE receives encrypted computation
4. Verify callback delivers encrypted tally update
5. Reveal results — verify threshold decryption works

**Step 4: Document results**

Write results to `docs/plans/2026-03-18-e2e-test-results.md`.

**Step 5: No code commit** (verification only)

---

## Task 11: Add Frontend Unit Tests

**Files:**
- Create: `frontend/vitest.config.ts`
- Create: `frontend/lib/__tests__/arcium.test.ts`
- Create: `frontend/lib/__tests__/contract.test.ts`
- Create: `frontend/lib/__tests__/errors.test.ts`
- Modify: `frontend/package.json` (add vitest dev dep + test script)

**Step 1: Install vitest**

```bash
cd frontend && npm install -D vitest @testing-library/react jsdom
```

**Step 2: Create vitest config**

```typescript
// frontend/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

**Step 3: Add test script to package.json**

```json
"scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
}
```

**Step 4: Write PDA derivation tests**

```typescript
// frontend/lib/__tests__/contract.test.ts
import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
    findProposalPDA,
    findTallyPDA,
    findVoteRecordPDA,
    findDelegationPDA,
    findComputationOffsetPDA,
    PROGRAM_ID,
} from "../contract";

describe("PDA derivation", () => {
    it("derives consistent proposal PDAs", () => {
        const id = new BN(12345);
        const [pda1] = findProposalPDA(id);
        const [pda2] = findProposalPDA(id);
        expect(pda1.equals(pda2)).toBe(true);
    });

    it("derives different PDAs for different proposal IDs", () => {
        const [pda1] = findProposalPDA(new BN(1));
        const [pda2] = findProposalPDA(new BN(2));
        expect(pda1.equals(pda2)).toBe(false);
    });

    it("derives tally PDA from proposal pubkey", () => {
        const proposal = PublicKey.unique();
        const [tally] = findTallyPDA(proposal);
        expect(PublicKey.isOnCurve(tally)).toBe(false); // PDAs are off-curve
    });

    it("derives unique vote record per voter", () => {
        const proposal = PublicKey.unique();
        const voter1 = PublicKey.unique();
        const voter2 = PublicKey.unique();
        const [vr1] = findVoteRecordPDA(proposal, voter1);
        const [vr2] = findVoteRecordPDA(proposal, voter2);
        expect(vr1.equals(vr2)).toBe(false);
    });

    it("derives delegation PDA from delegator", () => {
        const delegator = PublicKey.unique();
        const [pda] = findDelegationPDA(delegator);
        expect(pda).toBeInstanceOf(PublicKey);
    });

    it("computation offset PDA is deterministic", () => {
        const [pda1] = findComputationOffsetPDA();
        const [pda2] = findComputationOffsetPDA();
        expect(pda1.equals(pda2)).toBe(true);
    });
});
```

**Step 5: Write error parsing tests**

```typescript
// frontend/lib/__tests__/errors.test.ts
import { describe, it, expect } from "vitest";
// Import parseAnchorError from lib/errors.ts
// Test that Anchor error codes map to human-readable messages
// Test truncation at 120 chars
// Test unknown error passthrough
```

**Step 6: Run tests**

```bash
cd frontend && npm test
```

Expected: All tests pass.

**Step 7: Commit**

```bash
git add frontend/vitest.config.ts frontend/lib/__tests__/ frontend/package.json frontend/package-lock.json
git commit -m "test: add frontend unit tests for PDA derivation and error parsing"
```

---

## Task 12: Harden CI Pipeline

**Files:**
- Modify: `.github/workflows/ci.yml`

**Step 1: Remove continue-on-error from security audit**

```yaml
# Old (line 86)
      - run: npm audit --audit-level=high
        continue-on-error: true

# New
      - run: npm audit --audit-level=high
```

**Step 2: Add frontend unit test job**

```yaml
  unit-tests:
    name: Frontend Unit Tests
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm install --legacy-peer-deps
      - run: npm test
```

**Step 3: Pin Node version explicitly**

Already pinned to `node-version: 20` — keep this.

**Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: fail on npm audit, add frontend unit test job"
```

---

## Task 13: Write Security Model Documentation

**Files:**
- Create: `docs/SECURITY_MODEL.md`

**Step 1: Write threat model**

Document what the system protects against and limitations:

```markdown
# Security Model

## Threat Matrix

| Threat | Status | Mechanism |
|--------|--------|-----------|
| Vote content exposure | Protected | x25519 ECDH + RescueCipher + Cerberus MPC |
| Double voting | Protected | VoteRecord PDA per (proposal, voter) |
| Non-stakeholder voting | Protected | SPL token balance gating |
| Tally manipulation | Protected | MAC-authenticated secret shares |
| Front-running | Protected | Encrypted tally until explicit reveal |
| Callback forgery | Protected | Sign PDA signer constraint |
| Circuit tampering | Protected | circuit_hash! SHA-256 verification |
| Vote buying | Partial | Votes encrypted, but voter can screenshot choice pre-submission |
| Social coercion | Partial | Vote is private, but participation is publicly visible on-chain |
| Sybil attacks | Delegated | Token gating (security depends on token distribution) |

## Anti-Collusion Analysis

### Current State
Votes are encrypted and tallied via MPC — no validator or DAO authority sees individual votes.
However, the voter themselves knows their vote and could prove it to a third party (e.g., by
screenshotting their selection before submission).

### Comparison with MACI
MACI (Minimal Anti-Collusion Infrastructure) achieves receipt-free voting via key rotation:
voters can change their key after voting, invalidating any prior proof of vote direction.
This makes vote-buying unenforceable since the briber cannot verify compliance.

### Future Enhancement Path
Arcium MXE could enable receipt-free voting via MPC-based key rotation — the voter submits
a key change request to the MXE, which re-encrypts their vote under the new key without
revealing the vote value. This would make Private DAO Voting the first Solana project
with MACI-equivalent anti-collusion guarantees.

## V2 Roadmap (Security-Relevant)
- Receipt-free voting via MXE key rotation
- Confidential execution payloads (encrypted until vote passes)
- Stake-to-propose deposit system (anti-spam)
```

**Step 2: Commit**

```bash
git add docs/SECURITY_MODEL.md
git commit -m "docs: add security model with threat matrix and anti-collusion analysis"
```

---

## Task 14: Update README and Documentation

**Files:**
- Modify: `README.md`
- Modify: `SUBMISSION.md`

**Step 1: Update SDK version references**

Replace all mentions of SDK 0.6.x/0.7.0 with 0.9.2.

**Step 2: Add quorum/threshold to feature list**

Add to the features section:
- Configurable quorum (minimum total votes for result validity)
- Configurable threshold (minimum YES percentage in basis points)
- ProposalOutcome tracking (Passed/Failed/QuorumNotReached)

**Step 3: Add security model link**

Add link to `docs/SECURITY_MODEL.md` in README.

**Step 4: Update architecture diagram**

Update the How It Works diagram to show quorum/threshold enforcement in the reveal step.

**Step 5: Update SUBMISSION.md**

Add quorum/threshold and delegation hardening to Technical Highlights.

**Step 6: Take new screenshots** (if UI changed)

**Step 7: Commit**

```bash
git add README.md SUBMISSION.md
git commit -m "docs: update README and SUBMISSION for production upgrade (SDK 0.9.2, quorum/threshold)"
```

---

## Task 15: Final Verification and Tag

**Step 1: Full build check**

```bash
cargo check --all
cd frontend && npx tsc --noEmit && npm run build && npm test
```

**Step 2: Run Playwright E2E**

```bash
cd frontend && npx playwright test
```

**Step 3: Verify git status is clean**

```bash
git status
git log --oneline -15
```

**Step 4: Tag release**

```bash
git tag -a v1.1.0 -m "Production upgrade: SDK 0.9.2, quorum/threshold, delegation hardening, security model"
```

---

## Dependency Graph

```
Task 1 (verify Arcis API) ──┐
                             ├── Task 2 (Rust deps) ── Task 3 (CPI fixes) ── Task 4 (circuit hash)
                             │                                                       │
Task 5 (TS deps) ───────────┤                                                       │
                             ├── Task 6 (frontend arcium.ts) ────────────────────────┤
                             │                                                       │
                             ├── Task 7 (quorum/threshold) ──────────────────────────┤
                             │                                                       │
                             ├── Task 8 (delegation hardening) ──────────────────────┤
                             │                                                       │
                             └───────────────────────────── Task 9 (IDL regen) ──────┤
                                                                                     │
                                                           Task 10 (E2E verify) ─────┤
                                                                                     │
Task 11 (frontend tests) ───────────────────────────────────────────────────────────┤
                                                                                     │
Task 12 (CI hardening) ─────────────────────────────────────────────────────────────┤
                                                                                     │
Task 13 (security docs) ───────────────────────────────────────────────────────────┤
                                                                                     │
Task 14 (README/docs) ─────────────────────────────────────────────────────────────┤
                                                                                     │
                                                           Task 15 (final verify) ──┘
```

**Parallelizable groups:**
- Tasks 1, 5, 11, 12, 13 can start immediately (independent)
- Tasks 2-4 are sequential (Rust upgrade chain)
- Task 6 depends on Task 5
- Tasks 7-8 depend on Task 2 (need new SDK to compile)
- Task 9 depends on Tasks 3, 4, 7, 8 (needs final program code)
- Task 10 depends on Task 9
- Task 14 depends on all code tasks
- Task 15 depends on everything

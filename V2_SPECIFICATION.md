# Private DAO Voting — Version 2.0 Specification

## Vision

Evolve from a **Private Signaling/Polling** tool into a **Confidential Execution Engine** — where a passed vote doesn't just signal intent, it _automatically executes_ an on-chain action with parameters that remained hidden until the vote concluded.

---

## 1. Governance Logic & Execution

### 1.1 On-Chain Action Payload (Confidential Execution)

**Current state:** Proposals are signal-only — a passed vote produces a result but triggers no on-chain action.

**V2.0 design:** Add an optional `ExecutionPayload` that is encrypted inside the MXE alongside vote tallies. When a proposal passes quorum + threshold, the payload is decrypted and executed atomically.

#### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Proposer's Browser                                     │
│                                                         │
│  1. Build Solana instruction(s) as serialized bytes     │
│  2. Encrypt payload with x25519 → Enc<Shared, [u8]>    │
│  3. Submit encrypted payload + proposal on-chain        │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Anchor Program (Proposal PDA)                          │
│                                                         │
│  Stores: encrypted_payload (opaque blob, max 1232 bytes)│
│  Stores: payload_hash (SHA-256 commitment)              │
│  Neither the program nor any observer can read it       │
└──────────────────────┬──────────────────────────────────┘
                       │  vote passes
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Arcium MXE (finalize_and_execute)                      │
│                                                         │
│  1. Threshold-decrypt aggregate tallies                 │
│  2. Check: yes_votes > threshold AND total >= quorum    │
│  3. If passed → decrypt payload → return plaintext      │
│  4. If failed → payload is NEVER decrypted              │
│  5. Callback writes result + payload to Solana          │
└──────────────────────┬──────────────────────────────────┘
                       │  callback
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Executor (Cranker / Timelock)                          │
│                                                         │
│  1. Reads decrypted payload from proposal PDA           │
│  2. Deserializes into Solana instruction(s)             │
│  3. Executes via CPI with proposal PDA as signer        │
│  4. Timelock: 24h delay between reveal and execution    │
└─────────────────────────────────────────────────────────┘
```

#### Supported Payload Types

| Type | Example | Serialization |
|------|---------|---------------|
| `TreasuryTransfer` | Send X SOL/SPL to address Y | `{ recipient: Pubkey, mint: Pubkey, amount: u64 }` |
| `ProgramUpgrade` | Upgrade program to buffer Z | `{ program_id: Pubkey, buffer: Pubkey }` |
| `ConfigChange` | Update DAO parameter | `{ key: String, value: Vec<u8> }` |
| `ExternalCPI` | Arbitrary CPI call | `{ program_id: Pubkey, data: Vec<u8>, accounts: Vec<AccountMeta> }` |

#### New Arcis Circuit Function

```rust
pub fn finalize_and_execute(
    state: VotingState,
    encrypted_payload: Enc<Shared, [u8; 1232]>,
    quorum: u64,
    threshold_bps: u64, // basis points, e.g. 5000 = 50%
) -> (u64, u64, u64, u64, Option<[u8; 1232]>) {
    let (yes, no, abstain, total) = finalize_and_reveal(state);

    let passed = total >= quorum
        && yes * 10_000 / (yes + no) >= threshold_bps;

    if passed {
        // Decrypt payload only on pass
        let payload = encrypted_payload.reveal();
        (yes, no, abstain, total, Some(payload))
    } else {
        // Payload NEVER leaves the MXE
        (yes, no, abstain, total, None)
    }
}
```

> **Note:** Branching on `passed` is safe here because the tallies are already being revealed — `passed` is derived from public values at this point, not from encrypted state.

#### Proposal PDA Changes

```rust
pub struct Proposal {
    // ... existing fields ...

    // V2.0 additions
    pub encrypted_payload: Option<Vec<u8>>,  // max 1232 bytes
    pub payload_hash: [u8; 32],              // SHA-256 commitment
    pub payload_type: PayloadType,           // enum discriminator
    pub threshold_bps: u16,                  // passing threshold in basis points
    pub execution_delay: i64,                // seconds after reveal before execution
    pub executed: bool,                      // prevent double-execution
    pub execution_tx: Option<[u8; 64]>,      // tx signature after execution
}
```

#### UI: Payload Builder

```
┌─────────────────────────────────────────────────────┐
│  On-Chain Action (Optional)                    [v2] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Action Type:  [Treasury Transfer ▾]                │
│                                                     │
│  ┌─ Treasury Transfer ──────────────────────────┐   │
│  │  Recipient:  [DaoTr...7xKp]  [Paste] [Book]│   │
│  │  Token:      [SOL ▾]  or [Custom Mint...]   │   │
│  │  Amount:     [1,000]  ≈ $142.50 USD         │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ┌─ Privacy Notice ─────────────────────────────┐   │
│  │  🔒 This action will be encrypted. No one    │   │
│  │  can see the recipient or amount until the   │   │
│  │  vote passes. If the vote fails, the payload │   │
│  │  is never decrypted.                         │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  Execution Delay: [24 hours ▾]                      │
│  (Time between reveal and execution for review)     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 1.2 Quorum vs. Threshold UI

**Current state:** Single `quorum` field (minimum vote count). No passing threshold — any majority wins.

**V2.0 design:** Separate Quorum (participation) from Threshold (approval percentage).

#### UI Layout

```
┌─────────────────────────────────────────────────────┐
│  Voting Rules                                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Quorum (Minimum Participation)                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  [====●==========] 25%                       │   │
│  │  At least 25% of token holders must vote     │   │
│  │  for the result to be valid.                 │   │
│  │                                              │   │
│  │  Presets: [10%] [25%] [50%] [Custom]         │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  Passing Threshold                                  │
│  ┌──────────────────────────────────────────────┐   │
│  │  [========●======] 60%                       │   │
│  │  At least 60% of non-abstain votes must be   │   │
│  │  YES for the proposal to pass.               │   │
│  │                                              │   │
│  │  Presets: [Simple Majority] [60%]            │   │
│  │           [Two-Thirds] [80%]                 │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ┌─ Preview ────────────────────────────────────┐   │
│  │  With 1,000 eligible voters:                 │   │
│  │  • Need ≥250 votes to reach quorum           │   │
│  │  • Of those, ≥60% YES to pass                │   │
│  │  • Example: 250 votes, 150 YES → ✓ Passes   │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

#### Program Changes

```rust
pub fn create_proposal(
    // ... existing params ...
    quorum_bps: u16,       // basis points of total supply, e.g. 2500 = 25%
    threshold_bps: u16,    // basis points of non-abstain votes, e.g. 6000 = 60%
) -> Result<()> {
    require!(quorum_bps <= 10_000, ErrorCode::InvalidQuorum);
    require!(threshold_bps > 0 && threshold_bps <= 10_000, ErrorCode::InvalidThreshold);
    // ...
}
```

The MXE callback validation becomes:

```rust
pub fn reveal_results_callback(
    // ...
    yes_count: u64,
    no_count: u64,
    abstain_count: u64,
) -> Result<()> {
    let total = yes_count + no_count + abstain_count;
    let eligible = get_eligible_voter_count(&proposal.gate_mint)?;

    let quorum_met = total * 10_000 / eligible >= proposal.quorum_bps as u64;
    let non_abstain = yes_count + no_count;
    let threshold_met = non_abstain > 0
        && yes_count * 10_000 / non_abstain >= proposal.threshold_bps as u64;

    proposal.passed = quorum_met && threshold_met;
    // ...
}
```

---

## 2. Privacy Toggles (The "Arcium Edge")

### 2.1 Granular Privacy Levels

**Current state:** Full privacy — all votes encrypted, tally hidden until reveal.

**V2.0 design:** Three privacy tiers selectable at proposal creation.

| Level | Voter Identity | Running Tally | Final Tally | Use Case |
|-------|---------------|---------------|-------------|----------|
| **Full Privacy** | Hidden | Hidden | Revealed at deadline | High-stakes governance, elections |
| **Partial Privacy** | Hidden | Hidden | Revealed at deadline, with voter list (not choices) | Grant committees, board votes |
| **Transparent Tally** | Hidden | Visible (live) | Visible | Temperature checks, polls |

#### UI: Privacy Selector

```
┌─────────────────────────────────────────────────────┐
│  Privacy Level                                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────┐  │
│  │  ● Full     │ │  ○ Partial  │ │  ○ Transparent│  │
│  │  Privacy    │ │  Privacy    │ │  Tally        │  │
│  │             │ │             │ │               │  │
│  │  Voters &   │ │  Voters     │ │  Voters       │  │
│  │  tally both │ │  hidden,    │ │  hidden,      │  │
│  │  hidden     │ │  voter list │ │  live tally   │  │
│  │  until end  │ │  shown      │ │  visible      │  │
│  │             │ │  after      │ │               │  │
│  │  Best for   │ │  Best for   │ │  Best for     │  │
│  │  elections  │ │  committees │ │  polls        │  │
│  └─────────────┘ └─────────────┘ └──────────────┘  │
│                                                     │
│  ⓘ All levels encrypt individual vote choices.      │
│    No one ever sees HOW you voted.                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

#### Implementation

- **Full Privacy**: Current behavior. No changes needed.
- **Partial Privacy**: After `finalize_and_reveal`, the program emits a `VoterListRevealed` event containing the list of voter pubkeys (already stored in VoteRecord PDAs) — but NOT their choices.
- **Transparent Tally**: New circuit function `get_live_tally()` that reveals running totals without revealing individual votes. Called periodically by a cranker or on-demand by the frontend.

```rust
// New circuit function for Transparent Tally mode
pub fn get_live_tally(state: &VotingState) -> (u64, u64, u64, u64) {
    (
        state.encrypted_yes_votes.reveal(),
        state.encrypted_no_votes.reveal(),
        state.encrypted_abstain_votes.reveal(),
        state.encrypted_total_votes.reveal(),
    )
}
```

#### Proposal PDA Addition

```rust
pub privacy_level: u8, // 0 = Full, 1 = Partial, 2 = Transparent
```

### 2.2 Privacy Processing UX

MPC proof generation takes 2-8 seconds. This needs a dedicated loading state.

#### State Machine

```
[Vote Button Clicked]
       │
       ▼
┌─────────────────────────┐
│  Step 1: Encrypting     │  (< 1s)
│  "Encrypting your vote  │
│   with x25519..."       │
│  [████░░░░░░] 30%       │
│                         │
│  Animated lock icon     │
│  with flowing hex       │
│  particles              │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Step 2: Submitting     │  (1-3s)
│  "Sending encrypted     │
│   vote to Solana..."    │
│  [██████░░░░] 55%       │
│                         │
│  Solana logo pulse      │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Step 3: MPC Processing │  (2-8s)
│  "Arcium nodes are      │
│   processing your vote  │
│   across 3 parties..."  │
│  [████████░░] 80%       │
│                         │
│  3 node icons with      │
│  animated connections   │
│  showing secret sharing │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Step 4: Confirmed      │
│  "Vote recorded!"       │
│  [██████████] 100%      │
│                         │
│  ✓ Checkmark + confetti │
│  [View on Explorer]     │
└─────────────────────────┘
```

#### Implementation Notes

- Use **optimistic UI** — show step 1 immediately on click, step 2 after wallet signs
- Step 3 polls the MXE callback account every 500ms
- If step 3 exceeds 15s, show: "Still processing — MPC takes a moment for large clusters" with a "Learn why" link
- Fallback: if 30s timeout, show error with retry button
- Each step uses `framer-motion` `AnimatePresence` for smooth transitions

---

## 3. Enhanced UI/UX for Institutions

### 3.1 Discussion Integration (Anonymous)

**Problem:** Governance needs debate, but linking to Discord/forums can deanonymize voters.

**Solution:** An optional `discussion_url` field with privacy-preserving design.

#### UI

```
┌─────────────────────────────────────────────────────┐
│  Discussion (Optional)                              │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Link:  [https://forum.dao.xyz/proposal-42    ]     │
│                                                     │
│  Platform: [Auto-detected: Discourse Forum]         │
│                                                     │
│  ┌─ Privacy Notice ─────────────────────────────┐   │
│  │  ⚠ Clicking this link will navigate to an    │   │
│  │  external site. Your wallet address will NOT  │   │
│  │  be shared, but your IP address may be        │   │
│  │  visible to the forum operator.               │   │
│  │                                              │   │
│  │  For maximum privacy, use a VPN or Tor        │   │
│  │  when accessing discussion forums.            │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  Supported: Discourse, Commonwealth, IPFS,          │
│  Snapshot, GitHub Discussions, Discord (read-only)   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

#### Implementation

- Store `discussion_url: Option<String>` (max 256 chars) in Proposal PDA
- Frontend opens link in new tab with `rel="noopener noreferrer"` — no wallet context leaked
- For IPFS links (`ipfs://` or `ar://`), resolve via a public gateway
- Display discussion link on the proposal card with a "shield" icon indicating it's external
- Future: Integrate an on-chain anonymous comment system using MXE-encrypted messages

### 3.2 Rich Text Description

**Current state:** Plain text description, 500 char limit.

**V2.0 design:** Markdown editor with preview, 5000 char limit.

#### UI

```
┌─────────────────────────────────────────────────────┐
│  Description                                        │
├─────────────────────────────────────────────────────┤
│  [Edit] [Preview]                          5000 max │
│  ┌──────────────────────────────────────────────┐   │
│  │ ## Treasury Diversification                  │   │
│  │                                              │   │
│  │ This proposal allocates **50,000 USDC** from │   │
│  │ the treasury to:                             │   │
│  │                                              │   │
│  │ 1. Audit fund (30%)                          │   │
│  │ 2. Dev grants (50%)                          │   │
│  │ 3. Marketing (20%)                           │   │
│  │                                              │   │
│  │ | Category | Amount | Recipient |            │   │
│  │ |----------|--------|-----------|            │   │
│  │ | Audit    | 15,000 | OtterSec  |            │   │
│  │ | Grants   | 25,000 | Multisig  |            │   │
│  │ | Market   | 10,000 | MarketDAO |            │   │
│  │                                              │   │
│  │ See [full breakdown](ipfs://Qm...)           │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  Toolbar: [B] [I] [H] [Link] [Table] [Code] [List] │
│                                                     │
└─────────────────────────────────────────────────────┘
```

#### Implementation

- Use `react-markdown` + `remark-gfm` for rendering (already lightweight, no heavy deps)
- Simple toolbar inserts markdown syntax at cursor position
- Live preview tab renders markdown in the same card style as the proposal view
- Store raw markdown on-chain (Proposal PDA `description` field expanded to 5000 bytes)
- Sanitize on render: strip `<script>`, `<iframe>`, `javascript:` URLs via `rehype-sanitize`
- Image references: only allow `ipfs://`, `ar://`, and allowlisted HTTPS domains

---

## 4. Anti-Spam & Economic Security

### 4.1 Stake-to-Propose

**Current state:** Anyone with the gate token can create unlimited proposals.

**V2.0 design:** Proposal creators must lock a configurable amount of tokens. The stake is returned if the proposal reaches quorum; slashed if it doesn't.

#### Mechanism

```
┌───────────────────────────────────────────────────────┐
│                                                       │
│  Proposal Created                                     │
│  Creator locks 100 GOV tokens                         │
│       │                                               │
│       ├── Voting ends, quorum MET                     │
│       │       │                                       │
│       │       ├── Proposal passes → stake returned    │
│       │       └── Proposal fails  → stake returned    │
│       │           (good faith effort, quorum reached) │
│       │                                               │
│       └── Voting ends, quorum NOT MET                 │
│               │                                       │
│               └── Stake slashed (sent to DAO treasury)│
│                   Spam deterrent: low-effort proposals│
│                   that nobody votes on cost tokens     │
│                                                       │
└───────────────────────────────────────────────────────┘
```

#### UI

```
┌─────────────────────────────────────────────────────┐
│  Proposal Deposit                                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Deposit Required: 100 GOV                          │
│  Your Balance:     2,450 GOV                        │
│                                                     │
│  ┌─ Rules ──────────────────────────────────────┐   │
│  │  • Deposit is locked until voting ends       │   │
│  │  • Returned if proposal reaches quorum       │   │
│  │  • Sent to DAO treasury if quorum not met    │   │
│  │  • You keep your deposit regardless of       │   │
│  │    whether the proposal passes or fails      │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  [Approve & Lock Deposit]                           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

#### Program Changes

```rust
pub struct DaoConfig {
    pub authority: Pubkey,
    pub proposal_deposit: u64,         // tokens required to create proposal
    pub deposit_mint: Pubkey,          // token mint for deposits
    pub treasury: Pubkey,              // where slashed deposits go
    pub slash_if_no_quorum: bool,      // enable/disable slashing
}

pub struct Proposal {
    // ... existing fields ...
    pub deposit_amount: u64,
    pub deposit_returned: bool,
    pub deposit_escrow: Pubkey,        // token account holding locked deposit
}
```

New instructions:

```rust
// Called by authority after reveal, or by anyone after expiry + grace period
pub fn return_or_slash_deposit(ctx: Context<ReturnDeposit>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    require!(!proposal.deposit_returned, ErrorCode::DepositAlreadyProcessed);
    require!(proposal.is_revealed, ErrorCode::NotYetRevealed);

    let quorum_met = proposal.total_votes >= proposal.quorum;

    if quorum_met {
        // Transfer from escrow back to creator
        transfer_tokens(escrow, creator_ata, proposal.deposit_amount)?;
    } else {
        // Transfer from escrow to DAO treasury
        transfer_tokens(escrow, treasury_ata, proposal.deposit_amount)?;
    }

    proposal.deposit_returned = true;
    Ok(())
}
```

### 4.2 Rate Limiting (Complementary)

In addition to economic deterrence, enforce per-wallet rate limits:

- **Max 3 active proposals per wallet** (checked on-chain via counter PDA)
- **Cooldown period**: 1 hour between proposal creations from the same wallet
- These are enforced at the program level, not just the frontend

---

## 5. Migration Path

### Phase 1: Non-Breaking Additions
- Quorum + threshold (backward compatible — default threshold to 5001 bps = simple majority)
- Rich text description (just increase field size)
- Discussion URL (optional field)
- Privacy level selector (default to Full Privacy = current behavior)

### Phase 2: Stake-to-Propose
- Deploy `DaoConfig` account with configurable deposit amount
- Add escrow token account creation in `create_proposal`
- Add `return_or_slash_deposit` instruction
- Frontend: deposit approval flow before proposal submission

### Phase 3: Confidential Execution
- New Arcis circuit function `finalize_and_execute`
- Payload builder UI with type-specific forms
- Timelock executor (cranker service or permissionless instruction)
- Security audit of payload deserialization and CPI execution

---

## 6. Updated Create Proposal UI (Complete V2.0 Mockup)

```
┌─────────────────────────────────────────────────────────┐
│  Create Private Proposal                          [X]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Title *                                                │
│  [Diversify Treasury into Stablecoins              ]    │
│                                                         │
│  Description *                                [Preview] │
│  ┌───────────────────────────────────────────────────┐  │
│  │ [B] [I] [H] [Link] [Table] [Code] [List]         │  │
│  │                                                   │  │
│  │ ## Summary                                        │  │
│  │ Allocate 30% of SOL treasury to USDC...           │  │
│  └───────────────────────────────────────────────────┘  │
│  4,847 / 5,000 characters                               │
│                                                         │
│  Discussion (Optional)                                  │
│  [https://forum.dao.xyz/proposals/42             ]      │
│                                                         │
│  ─── Voting Rules ───────────────────────────────────   │
│                                                         │
│  Duration:  [5 min] [1 hour] [●24 hours] [3 days]      │
│                                                         │
│  Quorum:    [====●==========] 25%                       │
│  Threshold: [========●======] 60%                       │
│                                                         │
│  Privacy:   [● Full] [○ Partial] [○ Transparent]        │
│                                                         │
│  ─── Access Control ─────────────────────────────────   │
│                                                         │
│  Gate Token: [So11...1112]                              │
│  Min Balance: [100]                                     │
│                                                         │
│  ─── On-Chain Action (Optional) ─────────────────────   │
│                                                         │
│  Action: [Treasury Transfer ▾]                          │
│  Recipient: [DaoTr...7xKp]                              │
│  Token: [USDC]  Amount: [50,000]                        │
│  Execution Delay: [24 hours]                            │
│  🔒 Encrypted — revealed only if vote passes            │
│                                                         │
│  ─── Deposit ────────────────────────────────────────   │
│                                                         │
│  Required: 100 GOV (returned if quorum met)             │
│  Your Balance: 2,450 GOV  ✓                             │
│                                                         │
│  [Cancel]                    [Lock Deposit & Create]    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 7. Security Considerations

| Risk | Mitigation |
|------|-----------|
| Malicious payload execution | Timelock (24h default) + payload hash published at creation for independent verification |
| Payload too large for on-chain storage | 1232 byte limit (fits in single Solana tx); larger payloads use IPFS hash with on-chain commitment |
| Deposit griefing (create + self-vote to reclaim) | Quorum based on % of total supply, not absolute count; single vote won't reach quorum |
| Privacy level downgrade attack | Privacy level is immutable after proposal creation |
| Rich text XSS | `rehype-sanitize` with strict allowlist; no raw HTML rendering |
| Discussion link phishing | Display domain prominently; warn on non-allowlisted domains |
| MPC timeout on execution | Fallback: if MXE doesn't respond in 60s, proposal enters "pending execution" state; authority can manually retry |

---

## 8. New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `react-markdown` | Markdown rendering | ~12KB gzipped |
| `remark-gfm` | GitHub-flavored markdown (tables, strikethrough) | ~3KB gzipped |
| `rehype-sanitize` | HTML sanitization | ~2KB gzipped |
| `@codemirror/lang-markdown` | Editor with syntax highlighting (optional) | ~15KB gzipped |

No heavy dependencies. Total bundle impact: ~32KB gzipped.

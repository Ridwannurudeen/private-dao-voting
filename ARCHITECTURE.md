# Private DAO Voting with Arcium - Architecture Guide

## Overview

This implementation provides **confidential voting** on Solana using Arcium's MPC (Multi-Party Computation) network. Individual votes are **never revealed** - only the final aggregate tally is made public.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER'S BROWSER                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  1. User selects vote choice (Yes/No/Abstain)                           │
│  2. ArciumClient.createSecretInput() encrypts choice                    │
│  3. Encrypted vote is passed to Solana transaction                      │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         SOLANA DEVNET                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐    ┌──────────────────────────────────────┐  │
│  │   Your Anchor        │    │         Arcium Program               │  │
│  │   Program            │───▶│   (queue_computation CPI)            │  │
│  │                      │    │                                      │  │
│  │  - Proposal PDA      │    │  - Receives encrypted inputs         │  │
│  │  - Tally PDA         │    │  - Adds to cluster mempool           │  │
│  │  - VoteRecord PDA    │    │  - Tracks computation state          │  │
│  └──────────────────────┘    └──────────────────────────────────────┘  │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      ARCIUM MXE CLUSTER                                  │
│                    (Cluster Offset: 69069069)                            │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │  Node 1  │ │  Node 2  │ │  Node 3  │ │  Node 4  │ │  Node 5  │      │
│  │ (share)  │ │ (share)  │ │ (share)  │ │ (share)  │ │ (share)  │      │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘      │
│       │            │            │            │            │             │
│       └────────────┴────────────┼────────────┴────────────┘             │
│                                 │                                        │
│                    ┌────────────┴────────────┐                          │
│                    │   MPC COMPUTATION       │                          │
│                    │                         │                          │
│                    │  - Decrypt vote shares  │                          │
│                    │  - Increment tally      │                          │
│                    │  - Re-encrypt result    │                          │
│                    │                         │                          │
│                    │  NO NODE SEES THE       │                          │
│                    │  ACTUAL VOTE!           │                          │
│                    └────────────┬────────────┘                          │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      CALLBACK TO SOLANA                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  vote_callback():                                                        │
│    - Receives new encrypted tally                                        │
│    - Updates Tally PDA on-chain                                         │
│    - Increments public vote counter                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Vote Encryption (Browser)

```typescript
// In the user's browser - vote is encrypted BEFORE leaving
const arciumClient = createArciumClient(provider);
await arciumClient.initialize(mxeProgramId);

// Create encrypted input - only MXE can decrypt
const secretInput = arciumClient.createSecretInput(1); // 1 = Yes vote
// Returns: { encryptedChoice: [u8;32], nonce: [u8;16], voterPubkey: [u8;32] }
```

The `createSecretInput()` method:
1. Uses x25519 Diffie-Hellman to derive a shared secret with the MXE
2. Encrypts the vote using RescueCipher (Arcium's symmetric cipher)
3. Returns ciphertext that ONLY the MXE cluster can decrypt

### 2. Solana Transaction

```typescript
// Vote is submitted to Solana with encrypted payload
await program.methods
  .castVote(
    secretInput.encryptedChoice,
    secretInput.nonce,
    secretInput.voterPubkey
  )
  .accounts({ /* ... Arcium accounts ... */ })
  .rpc();
```

Your Anchor program:
1. Validates the voter hasn't already voted (VoteRecord PDA)
2. Calls `queue_computation` CPI to the Arcium program
3. Passes encrypted vote + current encrypted tally

### 3. MXE Computation

Inside the MXE cluster, your `encrypted-ixs/src/lib.rs` runs:

```rust
#[instruction]
pub fn vote(
    vote_input: Enc<Shared, VoteInput>,    // Encrypted vote from user
    current_tally: Enc<Mxe, VoteTally>,    // Encrypted tally from chain
) -> Enc<Mxe, VoteTally> {
    // Decrypt inside MPC - nodes see only secret shares
    let vote = vote_input.to_arcis();
    let mut tally = current_tally.to_arcis();

    // Increment appropriate counter
    if vote.choice == 1 {
        tally.yes_count += 1;  // This runs on secret shares!
    }

    // Re-encrypt and return
    Mxe.from_arcis(tally)
}
```

**Key insight**: When `to_arcis()` is called, each node only sees a **share** of the vote. The actual vote value is never reconstructed on any single node.

### 4. Callback

After MPC computation completes, Arcium calls your callback:

```rust
pub fn vote_callback(
    ctx: Context<VoteCallback>,
    new_encrypted_tally: [u8; 128],  // New encrypted state
    nonce: [u8; 16],
) -> Result<()> {
    // Update on-chain state with new encrypted tally
    ctx.accounts.tally.encrypted_data = new_encrypted_tally;
    ctx.accounts.proposal.total_votes += 1;
    Ok(())
}
```

## Key Components

### 1. TypeScript Client (`lib/arcium.ts`)

**Fixed issues:**
- ❌ `new PublicKey("arcium...")` - Invalid Base58 string
- ✅ Use `getArciumProgramId()` from SDK
- ✅ Fetch MXE public key via `getMXEPublicKey()`
- ✅ Proper account derivation with SDK helpers

```typescript
// WRONG - This causes the crash
programId: new PublicKey("arcaborjAqAbTJVwxjPi3EjFfTZ2L7bFSjjA8MLRMb")

// CORRECT - Use SDK functions
import { getArciumProgramId, getMXEPublicKey } from "@arcium-hq/client";
const mxePublicKey = await getMXEPublicKey(provider, mxeProgramId);
```

### 2. Encrypted Instructions (`encrypted-ixs/src/lib.rs`)

Defines the MPC circuits:
- `init_tally()` - Create initial encrypted [0,0,0,0]
- `vote()` - Increment tally counter (encrypted)
- `reveal_result()` - Decrypt and return final counts

### 3. Solana Program (`programs/*/src/lib.rs`)

Manages on-chain state and orchestrates MXE calls:
- Store proposals and encrypted tallies
- Prevent double-voting via VoteRecord PDA
- Call `queue_computation` CPI to Arcium
- Receive callbacks with computation results

## File Structure

```
private-dao-voting/
├── lib/
│   └── arcium.ts              # Fixed Arcium client
├── hooks/
│   └── useConfidentialVoting.ts   # React hook
├── encrypted-ixs/
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs             # MPC circuits (Arcis)
├── programs/
│   └── private-dao-voting/
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs         # Anchor program
├── tests/
│   └── voting.ts              # Integration tests
├── Anchor.toml
├── Arcium.toml                # Arcium config
└── Cargo.toml
```

## Arcium.toml Configuration

```toml
[mxe]
# Your deployed MXE program ID (after `arcium deploy`)
program_id = "YOUR_MXE_PROGRAM_ID"

[cluster]
# Use Arcium devnet cluster
offset = 69069069

[encrypted_ixs]
# Path to your MPC circuits
path = "encrypted-ixs"
```

## Deployment Steps

1. **Build encrypted instructions:**
   ```bash
   arcium build
   ```

2. **Deploy to Solana Devnet:**
   ```bash
   arcium deploy \
     --cluster-offset 69069069 \
     --keypair-path ~/.config/solana/id.json \
     --rpc-url https://api.devnet.solana.com
   ```

3. **Initialize computation definitions:**
   ```typescript
   // In your test/deploy script
   await program.methods.initInitTallyCompDef(compDefData).rpc();
   await program.methods.initVoteCompDef(compDefData).rpc();
   await program.methods.initRevealResultCompDef(compDefData).rpc();
   ```

4. **Update client with MXE program ID:**
   ```typescript
   const MXE_PROGRAM_ID = new PublicKey("YOUR_DEPLOYED_MXE_ID");
   await arciumClient.initialize(MXE_PROGRAM_ID);
   ```

## Security Guarantees

| Property | Guarantee |
|----------|-----------|
| Vote Privacy | Individual votes are NEVER revealed to anyone |
| Double-voting | Prevented by VoteRecord PDA (on-chain) |
| Tally Integrity | MPC ensures correct computation even with malicious nodes |
| Verifiability | Final result is publicly verifiable on-chain |

## Common Issues

### "Invalid public key input"
**Cause:** Using `new PublicKey()` with Arcium program ID string
**Fix:** Use SDK functions like `getArciumProgramId()` and `getMXEPublicKey()`

### "MXE public key not set"
**Cause:** MXE not deployed or not initialized
**Fix:** Run `arcium deploy` and ensure MXE account exists

### "Computation not finalized"
**Cause:** Cluster nodes haven't completed MPC
**Fix:** Increase timeout in `awaitComputationFinalization()`

## Resources

- [Arcium Documentation](https://docs.arcium.com)
- [Arcium Examples](https://github.com/arcium-hq/examples)
- [QuickNode Election Example](https://github.com/quiknode-labs/arcium-election)
- [Arcium TypeScript SDK](https://ts.arcium.com/api)

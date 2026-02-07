# Private DAO Voting on Arcium Network

A fully private voting system for DAOs built on Solana using the Arcium Network's encrypted computation capabilities. Individual votes are encrypted and hidden from everyone, but the final tally is publicly revealed when voting ends.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              VOTING FLOW                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐    ┌───────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │  Voter   │───▶│ Client SDK    │───▶│   Solana     │───▶│  Arcium MXE  │ │
│  │          │    │ (Encryption)  │    │   Program    │    │  (Encrypted  │ │
│  │ Vote: 1  │    │               │    │              │    │   Compute)   │ │
│  └──────────┘    └───────────────┘    └──────────────┘    └──────────────┘ │
│       │                  │                   │                    │        │
│       │                  │                   │                    │        │
│       ▼                  ▼                   ▼                    ▼        │
│  ┌──────────┐    ┌───────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │ Plaintext│───▶│ Encrypted     │───▶│   Queue IX   │───▶│   Process    │ │
│  │ Vote     │    │ Vote Bytes    │    │   to MXE     │    │   in TEE     │ │
│  │ (0 or 1) │    │ [encrypted]   │    │              │    │              │ │
│  └──────────┘    └───────────────┘    └──────────────┘    └──────────────┘ │
│                                                                    │        │
│                                                                    │        │
│                         CALLBACK (Results)                         ▼        │
│  ┌──────────┐    ┌───────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │  Public  │◀───│   On-Chain    │◀───│   Callback   │◀───│   Decrypt    │ │
│  │  Result  │    │   Storage     │    │   Handler    │    │   Aggregate  │ │
│  │          │    │              │    │              │    │   Only       │ │
│  └──────────┘    └───────────────┘    └──────────────┘    └──────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## How the Shared Secret Works

### 1. Key Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                    ARCIUM MXE CLUSTER                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐       │
│   │ Node 1  │   │ Node 2  │   │ Node 3  │   │ Node N  │       │
│   │ (shard) │   │ (shard) │   │ (shard) │   │ (shard) │       │
│   └────┬────┘   └────┬────┘   └────┬────┘   └────┬────┘       │
│        │             │             │             │              │
│        └─────────────┴──────┬──────┴─────────────┘              │
│                             │                                    │
│                    ┌────────▼────────┐                          │
│                    │  Cluster Master │                          │
│                    │  Key (Threshold)│                          │
│                    └────────┬────────┘                          │
│                             │                                    │
│              ┌──────────────┼──────────────┐                    │
│              │              │              │                    │
│     ┌────────▼───────┐ ┌────▼────┐ ┌──────▼───────┐           │
│     │ Computation 1  │ │ Comp 2  │ │ Computation N │           │
│     │ (Proposal A)   │ │         │ │ (Proposal Z)  │           │
│     │                │ │         │ │               │           │
│     │ Derived Key    │ │  Key    │ │ Derived Key   │           │
│     └────────────────┘ └─────────┘ └───────────────┘           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Client-Side Key Derivation

When a voter wants to cast a vote, the client:

```typescript
// 1. Fetch computation parameters from on-chain
const tallyAccount = await program.account.tallyAccount.fetch(tallyPda);
const computationId = tallyAccount.computationId;

// 2. Derive shared encryption context from MXE public parameters
const encryptionContext = await sharedSecretManager.deriveContext({
  computationId,              // Unique to this proposal
  circuitName: "voting_circuit",
  keyType: "Shared"           // Maps to Enc<Shared, T>
});

// 3. Encrypt the vote
const encryptedVote = await arciumClient.encrypt({
  data: new Uint8Array([vote]),  // 0 or 1
  context: encryptionContext,
  dataType: "u8"
});
```

### 3. Why Individual Votes Stay Private

| Property | Explanation |
|----------|-------------|
| **Same Key, Different Nonces** | All voters use the same shared key, but each encryption uses a unique random nonce |
| **Encrypted Aggregation** | The MXE adds encrypted values without decrypting them |
| **No Individual Decryption** | The key can only be used for aggregate operations, not individual value extraction |
| **Callback-Only Reveal** | Results are only revealed through the official `finalize_and_reveal` callback |

## File Structure

```
private-dao-voting/
├── src/
│   └── encrypted-ixs/
│       └── mod.rs              # Arcis encrypted instructions
├── programs/
│   └── private-dao-voting/
│       └── src/
│           └── lib.rs          # Anchor/Solana program
├── app/
│   └── src/
│       └── client.ts           # TypeScript client SDK
└── README.md
```

## Component Details

### 1. Encrypted Instructions (Arcis)

Located in `src/encrypted-ixs/mod.rs`:

```rust
#[encrypted]
pub mod voting_circuit {
    #[state]
    pub struct VotingState {
        pub total_yes_votes: Enc<Shared, u64>,  // Overflow-safe
        pub total_no_votes: Enc<Shared, u64>,
        pub total_votes_cast: Enc<Shared, u64>,
        pub is_active: Enc<Shared, u8>,
    }

    #[instruction]
    pub fn cast_vote(state: &mut VotingState, vote: Enc<Shared, u8>) -> Enc<Shared, u8> {
        // Encrypted vote added to encrypted tally
        // No one can see individual votes!
    }

    #[instruction]
    #[callback(program_id = "VotingDAO...")]
    pub fn finalize_and_reveal(state: &VotingState) -> FinalTally {
        // ONLY place where encrypted -> public transition happens
        FinalTally {
            yes_votes: state.total_yes_votes.from_arcis(),
            no_votes: state.total_no_votes.from_arcis(),
            total_votes: state.total_votes_cast.from_arcis(),
        }
    }
}
```

### 2. Solana Program (Anchor)

Located in `programs/private-dao-voting/src/lib.rs`:

**Key Instructions:**
- `initialize_proposal` - Create new voting proposal with PDA
- `initialize_encrypted_state` - Setup encrypted state on MXE
- `cast_vote` - Queue encrypted vote to MXE
- `finalize_voting` - Trigger result revelation
- `finalize_voting_callback` - **CRITICAL**: Only way to reveal results

**Security Features:**
- Voter records prevent double voting
- Time-locked voting periods
- Authority-only finalization
- MXE-only callback validation

### 3. TypeScript Client

Located in `app/src/client.ts`:

```typescript
const client = new PrivateVotingClient({ connection, wallet });

// Create proposal
await client.createProposal(proposalId, title, description, duration);

// Initialize encrypted state
await client.initializeEncryptedState(proposalPda);

// Cast encrypted vote
await client.castVote(proposalPda, Vote.Yes);  // Vote is encrypted!

// Finalize and get results
await client.finalizeVoting(proposalPda);
const results = await client.waitForResults(proposalPda);
```

## Overflow Protection

The system uses `u64` for vote counting:

```rust
// Maximum votes supported: 18,446,744,073,709,551,615
// That's 18 quintillion votes - more than enough!

pub total_yes_votes: Enc<Shared, u64>,
pub total_no_votes: Enc<Shared, u64>,
pub total_votes_cast: Enc<Shared, u64>,
```

Even if the entire world voted multiple times, we wouldn't overflow.

## State Transition Diagram

```
┌─────────────┐     initialize_proposal      ┌──────────────────┐
│   (none)    │ ─────────────────────────▶  │ Proposal Created │
└─────────────┘                              └────────┬─────────┘
                                                      │
                                                      │ initialize_encrypted_state
                                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     VOTING ACTIVE                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Encrypted State (on Arcium MXE):                            ││
│  │   - total_yes_votes: Enc<Shared, u64>  [hidden]            ││
│  │   - total_no_votes: Enc<Shared, u64>   [hidden]            ││
│  │   - total_votes_cast: Enc<Shared, u64> [hidden]            ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  cast_vote(encrypted_ballot) ──▶ Updates hidden tally           │
│                                                                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ finalize_voting (after end_slot)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FINALIZATION PENDING                          │
│  Waiting for MXE to process finalize_and_reveal...              │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ finalize_voting_callback (MXE only!)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      RESULTS REVEALED                            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Public State (on Solana):                                   ││
│  │   - final_yes_votes: 1,234  [PUBLIC]                       ││
│  │   - final_no_votes: 567     [PUBLIC]                       ││
│  │   - final_total_votes: 1,801 [PUBLIC]                      ││
│  │   - is_revealed: true                                       ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Security Considerations

1. **Vote Privacy**: Individual votes never leave the client unencrypted
2. **No Replay Attacks**: VoterRecord PDA prevents double voting
3. **Time-Locked**: Votes can only be cast during the voting period
4. **Authorized Finalization**: Only proposal authority can trigger reveal
5. **Trusted Callback**: Only Arcium MXE can call the callback

## Building & Deployment

```bash
# Build Arcis encrypted instructions
arcis build

# Build Anchor program
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Run tests
anchor test
```

## Dependencies

**Rust (Arcis & Anchor):**
```toml
[dependencies]
anchor-lang = "0.29.0"
arcis = "0.1.0"
arcium-anchor = "0.1.0"
```

**TypeScript:**
```json
{
  "dependencies": {
    "@solana/web3.js": "^1.87.0",
    "@coral-xyz/anchor": "^0.29.0",
    "@arcium/sdk": "^0.1.0"
  }
}
```

## License

MIT

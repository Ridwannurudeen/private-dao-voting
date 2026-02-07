# Testing Guide for Private DAO Voting

This document provides comprehensive instructions for running the test suite.

## Test Structure

```
private-dao-voting/
├── src/
│   └── encrypted-ixs/
│       ├── mod.rs           # Arcis circuit implementation
│       └── tests.rs         # Rust unit tests for encrypted logic
├── programs/
│   └── private-dao-voting/
│       └── tests/
│           └── integration_tests.rs  # Anchor program tests
├── tests/
│   ├── e2e.test.ts          # End-to-end TypeScript tests
│   ├── mock-arcium.test.ts  # Mock encryption tests
│   └── mocks/
│       └── arcium-mock.ts   # Mock Arcium SDK for testing
└── scripts/
    └── test.sh              # Test runner script
```

## Test Categories

### 1. Unit Tests (Arcis Circuit)

These tests verify the encrypted voting logic:

| Test | Description |
|------|-------------|
| `test_initialize_voting_creates_zero_state` | Verifies initial state has zero counts |
| `test_cast_single_yes_vote` | Tests incrementing yes vote |
| `test_cast_single_no_vote` | Tests incrementing no vote |
| `test_cast_multiple_votes_mixed` | Tests mixed voting scenario |
| `test_cast_many_votes_no_overflow` | Verifies u64 prevents overflow |
| `test_finalize_and_reveal_returns_correct_tally` | Tests result revelation |

**Run with:**
```bash
cd src/encrypted-ixs
cargo test
```

### 2. Integration Tests (Anchor Program)

These tests verify on-chain logic:

| Test | Description |
|------|-------------|
| `test_initialize_proposal_success` | Creates proposal correctly |
| `test_initialize_proposal_title_too_long` | Rejects invalid title |
| `test_initialize_proposal_invalid_end_slot` | Rejects past end slot |
| `test_callback_rejects_unauthorized_caller` | Security check for callback |
| `test_voter_record_prevents_double_voting` | Double vote prevention |

**Run with:**
```bash
cd programs/private-dao-voting
cargo test
```

### 3. E2E Tests (TypeScript)

These tests verify the full flow:

| Test | Description |
|------|-------------|
| Proposal Initialization | Creates and verifies proposal accounts |
| PDA Derivation | Ensures consistent PDA generation |
| Callback Security | Verifies only MXE can call callback |
| Account State Management | Validates state transitions |
| Edge Cases | Handles boundary conditions |

**Run with:**
```bash
npm run test:e2e
# or
anchor test
```

### 4. Mock Encryption Tests

These tests verify the mock Arcium implementation:

| Test | Description |
|------|-------------|
| Key Derivation | Consistent key generation |
| Encryption/Decryption | Round-trip data integrity |
| Ciphertext Properties | Same size, different values |
| Voting State | Full voting flow simulation |

**Run with:**
```bash
npm run test:unit
```

## Running Tests

### Quick Start

```bash
# Install dependencies
npm install

# Run all tests
./scripts/test.sh all

# Or run specific categories
./scripts/test.sh unit        # Unit tests only
./scripts/test.sh integration # Rust integration tests
./scripts/test.sh e2e         # Full E2E tests
```

### Using npm scripts

```bash
# Run TypeScript unit tests
npm run test:unit

# Run E2E tests with Anchor
npm run test:e2e

# Run all tests
npm run test:all

# Watch mode for development
npm run test:watch
```

### Using Anchor directly

```bash
# Run all tests
anchor test

# Run tests without rebuilding
anchor test --skip-build

# Run tests on specific cluster
anchor test --provider.cluster devnet
```

## Test Coverage

### Arcis Circuit Coverage

| Function | Coverage |
|----------|----------|
| `initialize_voting` | ✅ Full |
| `cast_vote` | ✅ Full |
| `close_voting` | ✅ Full |
| `finalize_and_reveal` | ✅ Full |

### Anchor Program Coverage

| Instruction | Coverage |
|-------------|----------|
| `initialize_proposal` | ✅ Full |
| `initialize_encrypted_state` | ⚠️ Requires MXE mock |
| `cast_vote` | ⚠️ Requires MXE mock |
| `finalize_voting` | ⚠️ Requires MXE mock |
| `finalize_voting_callback` | ✅ Full |

### Error Handling Coverage

| Error | Tested |
|-------|--------|
| `TitleTooLong` | ✅ |
| `DescriptionTooLong` | ✅ |
| `InvalidEndSlot` | ✅ |
| `AlreadyInitialized` | ✅ |
| `NotInitialized` | ✅ |
| `VotingPeriodEnded` | ✅ |
| `VotingStillActive` | ✅ |
| `AlreadyVoted` | ✅ |
| `AlreadyFinalized` | ✅ |
| `AlreadyRevealed` | ✅ |
| `Unauthorized` | ✅ |
| `UnauthorizedCallback` | ✅ |

## Writing New Tests

### Rust Unit Test Template

```rust
#[test]
fn test_your_feature() {
    let mut ctx = ArcisTestContext::new();
    let mut state = ctx.execute(|| initialize_voting());
    
    // Test logic here
    let vote = ctx.encrypt::<u8>(1);
    ctx.execute(|| cast_vote(&mut state, vote));
    
    // Verify
    assert_eq!(ctx.decrypt::<u64>(&state.total_yes_votes), 1);
}
```

### TypeScript Test Template

```typescript
it("should test your feature", async () => {
    const proposalId = new BN(999);
    const [proposalPda] = findProposalPda(authority.publicKey, proposalId);
    const [tallyPda] = findTallyPda(proposalPda);

    // Test logic here
    await program.methods
        .initializeProposal(/* ... */)
        .accounts({ /* ... */ })
        .signers([authority])
        .rpc();

    // Verify
    const proposal = await program.account.proposal.fetch(proposalPda);
    expect(proposal.title).to.equal("Expected");
});
```

## Debugging Tests

### Verbose Output

```bash
# Rust tests with output
cargo test -- --nocapture

# TypeScript tests with debug
DEBUG=* npm run test:unit
```

### Local Validator Logs

```bash
# Start validator with verbose logging
solana-test-validator --log

# In another terminal, run tests
anchor test --skip-local-validator
```

### Common Issues

1. **"Account not found"**
   - Ensure accounts are initialized before use
   - Check PDA derivation is correct

2. **"Unauthorized callback"**
   - Callback must be called by MXE program
   - In tests, mock the MXE signer

3. **"Voting period ended"**
   - Check slot timing in tests
   - Use sufficient future end slot

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
          
      - name: Install Solana
        run: sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
        
      - name: Install Anchor
        run: npm i -g @coral-xyz/anchor-cli
        
      - name: Install deps
        run: npm install
        
      - name: Run tests
        run: ./scripts/test.sh all
```

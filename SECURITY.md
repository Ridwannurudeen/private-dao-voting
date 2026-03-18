# Security

## Responsible Disclosure

If you discover a security vulnerability in Private DAO Voting, please report it responsibly:

1. **Do NOT open a public GitHub issue.** Security vulnerabilities disclosed publicly before a fix is available put all users at risk.
2. Email the maintainers at the address listed in the repository's security advisory contact, or use GitHub's private vulnerability reporting feature.
3. Include a clear description of the vulnerability, steps to reproduce, and the potential impact.
4. Allow up to 72 hours for an initial response. We will work with you to understand the scope and coordinate a fix before any public disclosure.

## Security Audit Checklist

The following items must be verified before deploying to Solana mainnet.

### Smart Contract

- [ ] **Circuit hash verification** -- Replace `dev-mode-circuit-hash-placeholder` with the real SHA-256 hash of the compiled Arcis circuit binary (`sha256sum arcis/voting-circuit/target/arcis/voting_circuit.so`). Build without `--features dev-mode` to enforce the hash check at `init_comp_def`.
- [ ] **Remove dev-mode instructions** -- The `dev_create_proposal`, `dev_cast_vote`, `dev_init_tally`, and `dev_reveal_results` instructions bypass Arcium MXE CPI. They must be removed or gated behind a feature flag that is disabled in the mainnet build. Compile with `anchor build` (no `--features dev-mode`).
- [ ] **PDA seed collisions** -- Verify that all PDA seeds produce unique, non-colliding addresses. Confirm that `proposal_id` values cannot be reused across proposals.
- [ ] **Arithmetic overflow** -- All tally arithmetic uses `checked_add` / `checked_mul`. Verify no unchecked arithmetic exists in vote counting paths.
- [ ] **Token gate enforcement** -- Confirm that `voter_token_account.owner == voter.key()` and `voter_token_account.mint == proposal.gate_mint` are enforced in ALL vote paths (both production and dev).
- [ ] **Double-vote prevention** -- `VoteRecord` PDA is initialized with `init` constraint (fails if already exists). Verify there is no path to vote twice.
- [ ] **Callback signer validation** -- All MXE callbacks (`init_tally_callback`, `vote_callback`, `reveal_results_callback`) require the `sign_seed` PDA as a signer. Verify no callback can be invoked by an arbitrary account.
- [ ] **Quorum and threshold logic** -- Verify `threshold_bps` calculation: `yes_count * 10_000 / non_abstain >= threshold_bps`. Confirm division-by-zero is handled when `non_abstain == 0`.
- [ ] **Timestamp manipulation** -- `voting_ends_at` uses the Solana `Clock` sysvar. Validators can manipulate `unix_timestamp` by a few seconds; verify this is acceptable for your governance timeframes.
- [ ] **Account size calculations** -- Verify `INIT_SPACE` derivations match actual serialized sizes for all accounts (especially `Proposal` with its variable-length `title`, `description`, and `discussion_url` fields).
- [ ] **ProgramConfig freeze check** -- Verify the soft freeze check in `dev_cast_vote` and `dev_create_proposal` correctly reads the `is_frozen` flag from raw account data at the expected offset.
- [ ] **Authority transfer** -- Verify `transfer_authority` requires the current authority to sign. Confirm there is no path to transfer authority without the current authority's approval.
- [ ] **Upgrade authority** -- Before mainnet, transfer the Solana program upgrade authority to a multisig (e.g., Squads). A single keypair controlling upgrades is a critical risk.

### Arcium MXE / MPC Circuit

- [ ] **Circuit correctness** -- Run the full circuit test suite (`cd arcis/voting-circuit && cargo test`). Verify the circuit correctly accumulates votes and produces accurate tallies.
- [ ] **Cerberus cluster health** -- Confirm the target MXE cluster has sufficient Arx Nodes for the desired security threshold. At least 3 nodes recommended for mainnet.
- [ ] **Threshold decryption** -- Verify that `finalize_and_reveal` and `finalize_with_threshold` require the configured threshold of nodes to participate in decryption.
- [ ] **Circuit hash on-chain** -- After deploying the circuit, verify the on-chain `CompDefState.circuit_hash` matches the local binary hash.

### Frontend

- [ ] **RPC endpoint** -- Switch `NEXT_PUBLIC_SOLANA_RPC` to a production-grade RPC provider (Helius, Triton, etc.). Do not use the public devnet endpoint.
- [ ] **Network configuration** -- Set `NEXT_PUBLIC_NETWORK=mainnet` in production environment variables.
- [ ] **Gate mint** -- Update `NEXT_PUBLIC_GATE_MINT` to the mainnet governance token mint address.
- [ ] **MXE program ID** -- Set `NEXT_PUBLIC_MXE_PROGRAM_ID` to the mainnet Arcium MXE program address.
- [ ] **Faucet removal** -- Disable or remove the `/api/faucet` endpoint in production. The faucet is for devnet testing only.
- [ ] **CSP headers** -- Configure Content-Security-Policy headers to restrict script sources and prevent XSS.
- [ ] **Wallet adapter** -- Verify wallet adapter is configured for mainnet-beta cluster.

### Infrastructure

- [ ] **Domain and TLS** -- Ensure the frontend is served over HTTPS with a valid TLS certificate.
- [ ] **Rate limiting** -- Add rate limiting to API endpoints to prevent abuse.
- [ ] **Monitoring** -- Set up on-chain event monitoring for `AuthorityTransferred`, `ProgramFreezeToggled`, and unexpected `ResultsRevealed` events.
- [ ] **Incident response plan** -- Document the process for using `freeze_program` in an emergency, including who holds the authority key and how the multisig is invoked.

## Known Limitations

1. **Dev-mode instructions** -- When compiled with `--features dev-mode`, the program includes instructions that bypass MXE CPI. These are for devnet testing only and must not be present in mainnet builds.

2. **Validator timestamp drift** -- The `Clock` sysvar's `unix_timestamp` can drift by a few seconds from real-world time. Governance periods shorter than a few minutes may be unreliable.

3. **Single-circuit hash** -- The circuit hash is set at `init_comp_def` time. If the circuit needs to be updated, a new `CompDefState` must be initialized. There is currently no instruction to update the circuit hash in-place.

4. **No on-chain execution** -- Proposals track a `passed` flag but do not execute arbitrary on-chain payloads. Execution of governance decisions is done off-chain or via separate contracts.

5. **Token balance snapshot** -- Token balances are checked at vote time, not at proposal creation time. A voter could acquire tokens, vote, then transfer them to another wallet for a second vote from a different address. Mitigation: use non-transferable (soulbound) tokens or snapshot-based balance checks.

6. **ProgramConfig is optional** -- For backward compatibility, the `ProgramConfig` PDA is not required. If it does not exist, the program assumes "not frozen" and no authority checks apply. Initialize it before mainnet.

7. **Freeze does not cancel active proposals** -- `freeze_program` blocks NEW proposals and votes but does not cancel or pause already-active proposals. Voters who already cast their vote before the freeze are unaffected.

## Mainnet Deployment Steps

### 1. Build for Production

```bash
# Build WITHOUT dev-mode (enforces circuit hash, removes dev instructions)
anchor build
```

### 2. Deploy the Circuit

```bash
cd arcis/voting-circuit
arcis build
# Record the circuit hash
sha256sum target/arcis/voting_circuit.so
```

### 3. Deploy the Program

```bash
solana config set --url mainnet-beta
anchor deploy --provider.cluster mainnet
```

### 4. Initialize On-Chain State

```bash
# Initialize computation definitions with the real circuit hash
# (via CLI or script — pass the SHA-256 hash from step 2)

# Initialize ProgramConfig
# This sets the deployer as the initial authority
```

### 5. Transfer Upgrade Authority to Multisig

```bash
# Create a Squads multisig (https://squads.so)
# Transfer the Solana program upgrade authority:
solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <SQUADS_MULTISIG_ADDRESS>

# Transfer the ProgramConfig authority (via the transfer_authority instruction):
# Use the admin panel in the frontend, or invoke directly:
# transfer_authority(new_authority: <SQUADS_MULTISIG_ADDRESS>)
```

### 6. Verify Deployment

```bash
# Verify the program is deployed and the upgrade authority is the multisig
solana program show <PROGRAM_ID>

# Verify the circuit hash on-chain matches the local binary
# Fetch CompDefState account and compare circuit_hash field

# Verify ProgramConfig.authority is the multisig address
```

### 7. Post-Deployment Monitoring

- Monitor for `AuthorityTransferred` events (should not fire unexpectedly)
- Monitor for `ProgramFreezeToggled` events
- Set up alerts for large vote counts or unusual activity patterns
- Keep the multisig signers' keys secure and distributed

//! # Private DAO Voting — Solana Anchor Program
//!
//! On-chain governance engine that orchestrates confidential vote tallying
//! via Arcium MXE using the **Cerberus** MPC protocol.
//!
//! ## Security Model: Cerberus (Dishonest Majority)
//!
//! Cerberus guarantees computation correctness and privacy as long as **at
//! least one** Arx Node in the MXE cluster remains honest. Even if N-1 of N
//! nodes collude, they cannot:
//! - Learn any individual vote value
//! - Forge or manipulate the aggregate tally
//! - Bypass the threshold decryption requirement
//!
//! MAC-authenticated secret shares detect tampering — honest nodes abort if
//! cheating is detected, preventing silent corruption of results.
//!
//! ## Computation Lifecycle
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────┐
//! │  1. DEFINITION  (one-time)                                         │
//! │     init_comp_def → registers circuit bytecode on-chain            │
//! │     circuit_hash! embeds SHA-256 of compiled circuit for integrity  │
//! ├─────────────────────────────────────────────────────────────────────┤
//! │  2. COMMISSIONING                                                  │
//! │     create_proposal → queues init_tally computation to MXE mempool │
//! │     Arguments: none (creates Enc<Mxe, Tally> with zero counters)   │
//! ├─────────────────────────────────────────────────────────────────────┤
//! │  3. CALLBACK                                                       │
//! │     MXE executes → calls init_tally_callback via sign PDA signer   │
//! │     Stores encrypted tally state (128 bytes) in Tally account      │
//! ├─────────────────────────────────────────────────────────────────────┤
//! │  4. VOTE ACCUMULATION (repeated per voter)                         │
//! │     cast_vote → queues vote computation with Enc<Shared, u8> vote  │
//! │     MXE executes constant-time accumulation on Enc<Mxe, Tally>     │
//! │     vote_callback → updates Tally account with new encrypted state │
//! ├─────────────────────────────────────────────────────────────────────┤
//! │  5. REVEAL (after voting deadline)                                 │
//! │     reveal_results → queues finalize_and_reveal / with_threshold   │
//! │     MXE performs Cerberus threshold decryption on aggregate totals  │
//! │     reveal_results_callback → stores plaintext results on-chain    │
//! └─────────────────────────────────────────────────────────────────────┘
//! ```
//!
//! ## Encryption Types
//!
//! - `Enc<Shared, u8>`: Individual vote — client-encrypted via x25519 ECDH.
//!   Voter retains cryptographic control over key material.
//! - `Enc<Mxe, Tally>`: Cumulative tally — cluster-owned, decryptable only
//!   via distributed threshold decryption across Arx Nodes.
//!
//! ## Circuit Integrity
//!
//! The `build.rs` script computes the SHA-256 hash of the voting circuit at
//! build time (from the compiled `.so` binary if available, otherwise from the
//! circuit source code). During `init_comp_def`, this hash is compared against
//! the deployer-provided hash to detect tampering. If any MXE node runs a
//! modified circuit, the hash mismatch causes the transaction to fail.

use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use arcium_client::idl::arcium::cpi::{accounts::QueueComputation, queue_computation};
use arcium_client::idl::arcium::program::Arcium;
use arcium_client::idl::arcium::types::{ArgumentList, ArgumentRef, CallbackInstruction};
use arcium_client::pda::comp_def_offset;

declare_id!("71tbXM3A2j5pKHfjtu1LYgY8jfQWuoZtHecDu6F6EPJH");

// ==================== CONSTANTS ====================

/// Seeds for PDA derivation
pub const PROPOSAL_SEED: &[u8] = b"proposal";
pub const TALLY_SEED: &[u8] = b"tally";
pub const VOTE_RECORD_SEED: &[u8] = b"vote_record";
pub const SIGN_SEED: &[u8] = b"sign";
pub const COMPUTATION_OFFSET_SEED: &[u8] = b"computation_offset";
pub const DELEGATION_SEED: &[u8] = b"delegation";
pub const DAO_CONFIG_SEED: &[u8] = b"dao_config";
pub const PROPOSAL_COUNTER_SEED: &[u8] = b"proposal_counter";
pub const DEPOSIT_ESCROW_SEED: &[u8] = b"deposit_escrow";
pub const PROGRAM_CONFIG_SEED: &[u8] = b"program_config";

/// Maximum active proposals per wallet (anti-spam)
pub const MAX_ACTIVE_PROPOSALS: u8 = 3;
/// Cooldown in seconds between proposals from the same wallet
pub const PROPOSAL_COOLDOWN: i64 = 3600;

/// Privacy levels
pub const PRIVACY_FULL: u8 = 0;
pub const PRIVACY_PARTIAL: u8 = 1;
pub const PRIVACY_TRANSPARENT: u8 = 2;

/// Computation definition names (must match #[instruction] names in the Arcis circuit)
pub const INIT_TALLY_COMP: &str = "initialize_voting";
pub const VOTE_COMP: &str = "cast_vote";
pub const REVEAL_RESULT_COMP: &str = "finalize_and_reveal";
pub const REVEAL_WITH_THRESHOLD_COMP: &str = "finalize_with_threshold";
pub const LIVE_TALLY_COMP: &str = "get_live_tally";
pub const VOTE_COUNT_COMP: &str = "get_vote_count";

/// SHA-256 hash of the voting circuit, computed at build time by `build.rs`.
///
/// The build script automatically selects the best available source:
/// 1. **Compiled binary** (`arcis/voting-circuit/target/arcis/voting_circuit.so`) -- canonical
///    hash matching `circuit_hash!("voting-circuit")` in the Arcis circuit crate. Used when
///    the circuit has been built with `arcis build`. This is what the MXE cluster verifies.
/// 2. **Source code** (`arcis/voting-circuit/src/lib.rs`) -- deterministic fallback for
///    CI/dev builds without the Arcis toolchain. Same source always yields same hash.
///
/// During `init_comp_def`, this hash is compared against the deployer-provided hash
/// to detect tampered circuits. If any MXE node runs modified bytecode, the hash
/// mismatch causes the transaction to fail with `CircuitHashMismatch`.
///
/// ## Verification
///
/// ```bash
/// # Verify against compiled binary (production):
/// cd arcis/voting-circuit && arcis build
/// sha256sum target/arcis/voting_circuit.so
///
/// # Verify against source (dev/CI):
/// sha256sum arcis/voting-circuit/src/lib.rs
/// ```
///
/// ## Hash Source
///
/// The `CIRCUIT_HASH_SOURCE` env var (set by build.rs) indicates which file was hashed:
/// - `"compiled-binary"` -- from the `.so` file (production-ready)
/// - `"source-code"` -- from `lib.rs` (dev/CI fallback)
///
/// Check at build time: the build output will show which source was used.
#[cfg(not(feature = "dev-mode"))]
pub const CIRCUIT_HASH: &str = include_str!(concat!(env!("OUT_DIR"), "/circuit_hash.txt"));

#[cfg(feature = "dev-mode")]
pub const CIRCUIT_HASH: &str = "dev-mode-circuit-hash-placeholder";

fn split_ciphertext_128(data: [u8; 128]) -> [[u8; 32]; 4] {
    let mut out = [[0u8; 32]; 4];
    for i in 0..4 {
        out[i].copy_from_slice(&data[i * 32..(i + 1) * 32]);
    }
    out
}

fn build_args_for_vote(encrypted_choice: [u8; 32], tally: [u8; 128]) -> ArgumentList {
    let mut args = ArgumentList {
        args: Vec::new(),
        byte_arrays: Vec::new(),
        plaintext_numbers: Vec::new(),
        values_128_bit: Vec::new(),
        accounts: Vec::new(),
    };

    args.args
        .push(ArgumentRef::EncryptedU8(args.byte_arrays.len() as u8));
    args.byte_arrays.push(encrypted_choice);

    for chunk in split_ciphertext_128(tally) {
        args.args
            .push(ArgumentRef::EncryptedU32(args.byte_arrays.len() as u8));
        args.byte_arrays.push(chunk);
    }

    args
}

fn build_args_for_tally(tally: [u8; 128]) -> ArgumentList {
    let mut args = ArgumentList {
        args: Vec::new(),
        byte_arrays: Vec::new(),
        plaintext_numbers: Vec::new(),
        values_128_bit: Vec::new(),
        accounts: Vec::new(),
    };

    for chunk in split_ciphertext_128(tally) {
        args.args
            .push(ArgumentRef::EncryptedU32(args.byte_arrays.len() as u8));
        args.byte_arrays.push(chunk);
    }

    args
}

/// Check if voter has an active delegation. Returns error if delegation exists.
/// Derives the delegation PDA deterministically and checks on-chain state.
/// The delegation account must be passed to the instruction so we can inspect it.
/// If it exists (has data) and is owned by this program, the voter has an active
/// delegation and must revoke it before voting directly.
fn check_no_active_delegation(
    delegation_account: &AccountInfo,
    voter: &Pubkey,
    program_id: &Pubkey,
) -> Result<()> {
    // Derive the expected delegation PDA for this voter
    let (expected_pda, _) =
        Pubkey::find_program_address(&[DELEGATION_SEED, voter.as_ref()], program_id);

    // Validate the passed account matches the deterministically derived PDA
    require!(
        delegation_account.key() == expected_pda,
        VotingError::InvalidDelegationAccount
    );

    // If the account has data and is owned by this program, delegation is active
    if delegation_account.data_len() > 0 && delegation_account.owner == program_id {
        return Err(VotingError::ActiveDelegation.into());
    }

    Ok(())
}

/// Soft freeze check: if ProgramConfig PDA exists and is_frozen is true, return error.
/// If the ProgramConfig account doesn't exist (no data, wrong owner, or null), assume
/// the program is NOT frozen — maintaining backward compatibility.
fn check_not_frozen(
    program_config_account: &AccountInfo,
    program_id: &Pubkey,
) -> Result<()> {
    let (expected_pda, _) =
        Pubkey::find_program_address(&[PROGRAM_CONFIG_SEED], program_id);

    // If the account key doesn't match the expected PDA, skip the check (backward compat)
    if program_config_account.key() != expected_pda {
        return Ok(());
    }

    // If the account has no data or isn't owned by this program, config doesn't exist yet
    if program_config_account.data_len() == 0 || program_config_account.owner != program_id {
        return Ok(());
    }

    // Deserialize and check the is_frozen flag
    // Account data layout: 8-byte discriminator + ProgramConfig fields
    let data = program_config_account.try_borrow_data()?;
    if data.len() < 8 + 32 + 1 {
        // Not enough data to read authority + is_frozen — skip
        return Ok(());
    }

    // is_frozen is at offset 8 (discriminator) + 32 (authority pubkey) = 40
    let is_frozen = data[40] != 0;
    if is_frozen {
        return Err(VotingError::ProgramFrozen.into());
    }

    Ok(())
}

// ==================== PROGRAM ====================

#[program]
pub mod private_dao_voting {
    use super::*;

    /// Create a new proposal and initialize encrypted tally
    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        proposal_id: u64,
        title: String,
        description: String,
        voting_ends_at: i64,
        gate_mint: Pubkey,
        min_balance: u64,
        mxe_program_id: Pubkey,
        quorum: u64,
        threshold_bps: u16,
        privacy_level: u8,
        discussion_url: String,
        execution_delay: i64,
    ) -> Result<()> {
        // Validate V2 fields
        require!(
            threshold_bps > 0 && threshold_bps <= 10_000,
            VotingError::InvalidThreshold
        );
        require!(privacy_level <= 2, VotingError::InvalidPrivacyLevel);
        require!(execution_delay >= 0, VotingError::InvalidExecutionDelay);

        // Initialize proposal state
        let proposal = &mut ctx.accounts.proposal;
        proposal.id = proposal_id;
        proposal.authority = ctx.accounts.authority.key();
        proposal.title = title;
        proposal.description = description;
        proposal.voting_ends_at = voting_ends_at;
        proposal.is_active = true;
        proposal.is_revealed = false;
        proposal.total_votes = 0;
        proposal.gate_mint = gate_mint;
        proposal.min_balance = min_balance;
        proposal.mxe_program_id = mxe_program_id;
        proposal.quorum = quorum;
        proposal.threshold_bps = threshold_bps;
        proposal.privacy_level = privacy_level;
        proposal.passed = false;
        proposal.discussion_url = discussion_url;
        proposal.deposit_amount = 0;
        proposal.deposit_returned = false;
        proposal.execution_delay = execution_delay;
        proposal.executed = false;
        proposal.bump = ctx.bumps.proposal;

        // Queue computation to initialize encrypted tally
        let cpi_accounts = QueueComputation {
            signer: ctx.accounts.authority.to_account_info(),
            sign_seed: ctx.accounts.sign_seed.to_account_info(),
            comp: ctx.accounts.computation_account.to_account_info(),
            mxe: ctx.accounts.mxe_account.to_account_info(),
            mempool: ctx.accounts.mempool_account.to_account_info(),
            executing_pool: ctx.accounts.executing_pool.to_account_info(),
            comp_def_acc: ctx.accounts.comp_def_account.to_account_info(),
            cluster: ctx.accounts.cluster_account.to_account_info(),
            pool_account: ctx.accounts.pool_account.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            clock: ctx.accounts.clock_account.to_account_info(),
        };

        let signer_seeds: &[&[&[u8]]] = &[&[b"sign", &[ctx.bumps.sign_seed]]];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.arcium_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );

        let computation_offset = Clock::get()?.slot as u64;
        let args = ArgumentList {
            args: vec![],
            byte_arrays: vec![],
            plaintext_numbers: vec![],
            values_128_bit: vec![],
            accounts: vec![],
        };

        queue_computation(
            cpi_ctx,
            computation_offset,
            comp_def_offset(INIT_TALLY_COMP),
            args,
            proposal.mxe_program_id,
            Vec::<CallbackInstruction>::new(),
            0,
            0,
            0,
        )?;

        emit!(ProposalCreated {
            proposal_id,
            authority: ctx.accounts.authority.key(),
            voting_ends_at,
        });

        Ok(())
    }

    /// Callback from Arcium after init_tally completes
    pub fn init_tally_callback(
        ctx: Context<InitTallyCallback>,
        encrypted_tally: [u8; 128], // Encrypted VoteTally
        nonce: [u8; 16],
    ) -> Result<()> {
        let tally = &mut ctx.accounts.tally;
        tally.proposal = ctx.accounts.proposal.key();
        tally.encrypted_data = encrypted_tally;
        tally.nonce = nonce;
        tally.bump = ctx.bumps.tally;

        Ok(())
    }

    /// Cast an encrypted vote
    pub fn cast_vote(
        ctx: Context<CastVote>,
        encrypted_choice: [u8; 32],
        nonce: [u8; 16],
        voter_pubkey: [u8; 32],
    ) -> Result<()> {
        let proposal = &ctx.accounts.proposal;

        // Validate voting is still active
        require!(proposal.is_active, VotingError::VotingClosed);

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp < proposal.voting_ends_at,
            VotingError::VotingEnded
        );

        // Check no active delegation — delegators must revoke before voting directly
        check_no_active_delegation(
            &ctx.accounts.delegation_account,
            &ctx.accounts.voter.key(),
            ctx.program_id,
        )?;

        // Token gate: voter must hold the required SPL token
        let token_account = &ctx.accounts.voter_token_account;
        require!(
            token_account.owner == ctx.accounts.voter.key(),
            VotingError::InvalidTokenAccount
        );
        require!(
            token_account.mint == proposal.gate_mint,
            VotingError::InvalidTokenMint
        );
        require!(
            token_account.amount >= proposal.min_balance,
            VotingError::InsufficientTokenBalance
        );

        // Record that this voter has voted (prevents double-voting)
        let vote_record = &mut ctx.accounts.vote_record;
        vote_record.proposal = proposal.key();
        vote_record.voter = ctx.accounts.voter.key();
        vote_record.voted_at = clock.unix_timestamp;
        vote_record.encrypted_choice = encrypted_choice;
        vote_record.nonce = nonce;
        vote_record.voter_pubkey = voter_pubkey;
        vote_record.bump = ctx.bumps.vote_record;

        // Queue the vote computation
        let cpi_accounts = QueueComputation {
            signer: ctx.accounts.voter.to_account_info(),
            sign_seed: ctx.accounts.sign_seed.to_account_info(),
            comp: ctx.accounts.computation_account.to_account_info(),
            mxe: ctx.accounts.mxe_account.to_account_info(),
            mempool: ctx.accounts.mempool_account.to_account_info(),
            executing_pool: ctx.accounts.executing_pool.to_account_info(),
            comp_def_acc: ctx.accounts.comp_def_account.to_account_info(),
            cluster: ctx.accounts.cluster_account.to_account_info(),
            pool_account: ctx.accounts.pool_account.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            clock: ctx.accounts.clock_account.to_account_info(),
        };

        let signer_seeds: &[&[&[u8]]] = &[&[b"sign", &[ctx.bumps.sign_seed]]];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.arcium_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );

        let computation_offset = Clock::get()?.slot as u64;
        let args = build_args_for_vote(encrypted_choice, ctx.accounts.tally.encrypted_data);

        queue_computation(
            cpi_ctx,
            computation_offset,
            comp_def_offset(VOTE_COMP),
            args,
            proposal.mxe_program_id,
            Vec::<CallbackInstruction>::new(),
            0,
            0,
            0,
        )?;

        emit!(VoteCast {
            proposal: proposal.key(),
            voter: ctx.accounts.voter.key(),
        });

        Ok(())
    }

    /// Callback from Arcium after vote computation completes
    pub fn vote_callback(
        ctx: Context<VoteCallback>,
        new_encrypted_tally: [u8; 128],
        nonce: [u8; 16],
    ) -> Result<()> {
        // Update the encrypted tally with new value
        let tally = &mut ctx.accounts.tally;
        tally.encrypted_data = new_encrypted_tally;
        tally.nonce = nonce;

        // Increment public vote counter
        let proposal = &mut ctx.accounts.proposal;
        proposal.total_votes += 1;

        Ok(())
    }

    /// Reveal the final vote results
    pub fn reveal_results(ctx: Context<RevealResults>) -> Result<()> {
        let proposal = &ctx.accounts.proposal;

        // Only authority can reveal
        require!(
            ctx.accounts.authority.key() == proposal.authority,
            VotingError::Unauthorized
        );

        // Prevent re-reveal
        require!(!proposal.is_revealed, VotingError::AlreadyRevealed);

        // Validate voting has ended
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= proposal.voting_ends_at,
            VotingError::VotingNotEnded
        );

        // Queue reveal computation
        let cpi_accounts = QueueComputation {
            signer: ctx.accounts.authority.to_account_info(),
            sign_seed: ctx.accounts.sign_seed.to_account_info(),
            comp: ctx.accounts.computation_account.to_account_info(),
            mxe: ctx.accounts.mxe_account.to_account_info(),
            mempool: ctx.accounts.mempool_account.to_account_info(),
            executing_pool: ctx.accounts.executing_pool.to_account_info(),
            comp_def_acc: ctx.accounts.comp_def_account.to_account_info(),
            cluster: ctx.accounts.cluster_account.to_account_info(),
            pool_account: ctx.accounts.pool_account.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            clock: ctx.accounts.clock_account.to_account_info(),
        };

        let signer_seeds: &[&[&[u8]]] = &[&[b"sign", &[ctx.bumps.sign_seed]]];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.arcium_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );

        let computation_offset = Clock::get()?.slot as u64;
        let args = build_args_for_tally(ctx.accounts.tally.encrypted_data);

        queue_computation(
            cpi_ctx,
            computation_offset,
            comp_def_offset(REVEAL_RESULT_COMP),
            args,
            proposal.mxe_program_id,
            Vec::<CallbackInstruction>::new(),
            0,
            0,
            0,
        )?;

        Ok(())
    }

    /// Callback from Arcium with revealed results
    /// Only callable by the Arcium program via CPI (validated by sign PDA signer constraint)
    pub fn reveal_results_callback(
        ctx: Context<RevealResultsCallback>,
        yes_count: u64,
        no_count: u64,
        abstain_count: u64,
        total_votes: u64,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;

        // Validate vote count consistency
        let computed_total = yes_count
            .checked_add(no_count)
            .and_then(|x| x.checked_add(abstain_count))
            .ok_or(VotingError::ArithmeticOverflow)?;
        require!(
            computed_total == total_votes,
            VotingError::VoteTallyMismatch
        );

        // Validate total against on-chain vote counter to prevent fabricated counts
        require!(
            total_votes == proposal.total_votes,
            VotingError::VoteTallyMismatch
        );

        // Enforce quorum if set
        if proposal.quorum > 0 {
            require!(
                total_votes >= proposal.quorum,
                VotingError::QuorumNotReached
            );
        }

        // Check threshold for production path too
        let non_abstain = yes_count
            .checked_add(no_count)
            .ok_or(VotingError::ArithmeticOverflow)?;
        let threshold_met = if non_abstain > 0 {
            yes_count
                .checked_mul(10_000)
                .ok_or(VotingError::ArithmeticOverflow)?
                / non_abstain
                >= proposal.threshold_bps as u64
        } else {
            false
        };

        let quorum_met = proposal.quorum == 0 || total_votes >= proposal.quorum;

        proposal.is_active = false;
        proposal.is_revealed = true;
        proposal.yes_votes = yes_count;
        proposal.no_votes = no_count;
        proposal.abstain_votes = abstain_count;
        proposal.passed = quorum_met && threshold_met;

        let winner: u8 = if yes_count > no_count {
            1
        } else if no_count > yes_count {
            2
        } else {
            0
        };

        emit!(ResultsRevealed {
            proposal: proposal.key(),
            yes_votes: yes_count,
            no_votes: no_count,
            abstain_votes: abstain_count,
            total_votes,
            winner,
            passed: proposal.passed,
        });

        Ok(())
    }

    /// Initialize computation definitions (called once at deployment).
    ///
    /// Registers the Arcis circuit bytecode on-chain and stores the circuit hash
    /// for integrity verification. The `circuit_hash` parameter must match
    /// `CIRCUIT_HASH`, which is computed at build time by `build.rs` from either
    /// the compiled circuit binary (`.so`) or the circuit source code (`lib.rs`).
    ///
    /// After initialization, the MXE cluster can execute the following instructions:
    /// - `initialize_voting` -- Creates `Enc<Mxe, Tally>` with zero counters
    /// - `cast_vote` -- Accumulates `Enc<Shared, u8>` into `Enc<Mxe, Tally>`
    /// - `finalize_and_reveal` -- Threshold-decrypts aggregate totals
    /// - `finalize_with_threshold` -- Reveals + checks quorum/threshold
    /// - `get_live_tally` -- Real-time tally for Transparent mode
    /// - `get_vote_count` -- Total participation without breakdown
    pub fn init_comp_def(
        ctx: Context<InitCompDef>,
        circuit_hash: String,
        comp_def_data: Vec<u8>,
    ) -> Result<()> {
        // Verify circuit integrity: the provided hash must match the compile-time hash
        // (computed by build.rs from the circuit binary or source code).
        // This prevents deployment of tampered circuits -- if any byte of the Arcis
        // bytecode has been modified, the SHA-256 hash will differ.
        require!(
            circuit_hash == CIRCUIT_HASH,
            VotingError::CircuitHashMismatch
        );

        msg!(
            "Initializing computation definitions with circuit hash: {}",
            circuit_hash
        );
        msg!(
            "Hash source: {} (build.rs auto-detected)",
            env!("CIRCUIT_HASH_SOURCE")
        );
        msg!(
            "Bytecode size: {} bytes ({} computation definitions)",
            comp_def_data.len(),
            6 // initialize_voting, cast_vote, finalize_and_reveal, finalize_with_threshold, get_live_tally, get_vote_count
        );

        // Store circuit hash in the comp def state for on-chain verification
        let comp_def_state = &mut ctx.accounts.comp_def_state;
        comp_def_state.circuit_hash = circuit_hash;
        comp_def_state.authority = ctx.accounts.authority.key();
        comp_def_state.initialized = true;
        comp_def_state.bump = ctx.bumps.comp_def_state;

        Ok(())
    }

    /// Initialize the computation offset PDA (one-time setup)
    pub fn init_computation_offset(ctx: Context<InitComputationOffset>) -> Result<()> {
        let state = &mut ctx.accounts.computation_offset_account;
        state.bump = ctx.bumps.computation_offset_account;
        Ok(())
    }

    // ==================== DEV MODE INSTRUCTIONS ====================
    // These bypass Arcium MXE CPI for devnet testing.
    // All other logic (token gating, PDA validation, double-vote
    // prevention) remains identical to production instructions.
    // Remove before mainnet deployment.

    /// Dev mode: Create a proposal without Arcium CPI
    pub fn dev_create_proposal(
        ctx: Context<DevCreateProposal>,
        proposal_id: u64,
        title: String,
        description: String,
        voting_ends_at: i64,
        gate_mint: Pubkey,
        min_balance: u64,
        quorum: u64,
        threshold_bps: u16,
        privacy_level: u8,
        discussion_url: String,
        execution_delay: i64,
    ) -> Result<()> {
        // Soft freeze check — if ProgramConfig exists and is_frozen, block new proposals
        check_not_frozen(&ctx.accounts.program_config, ctx.program_id)?;

        // Validate V2 fields
        require!(
            threshold_bps > 0 && threshold_bps <= 10_000,
            VotingError::InvalidThreshold
        );
        require!(privacy_level <= 2, VotingError::InvalidPrivacyLevel);
        require!(execution_delay >= 0, VotingError::InvalidExecutionDelay);

        let proposal = &mut ctx.accounts.proposal;
        proposal.id = proposal_id;
        proposal.authority = ctx.accounts.authority.key();
        proposal.title = title;
        proposal.description = description;
        proposal.voting_ends_at = voting_ends_at;
        proposal.is_active = true;
        proposal.is_revealed = false;
        proposal.total_votes = 0;
        proposal.gate_mint = gate_mint;
        proposal.min_balance = min_balance;
        proposal.mxe_program_id = Pubkey::default();
        proposal.quorum = quorum;
        proposal.threshold_bps = threshold_bps;
        proposal.privacy_level = privacy_level;
        proposal.passed = false;
        proposal.discussion_url = discussion_url;
        proposal.deposit_amount = 0;
        proposal.deposit_returned = false;
        proposal.execution_delay = execution_delay;
        proposal.executed = false;
        proposal.bump = ctx.bumps.proposal;

        emit!(ProposalCreated {
            proposal_id,
            authority: ctx.accounts.authority.key(),
            voting_ends_at,
        });

        Ok(())
    }

    /// Delegate voting power to another address
    /// The delegator's token-gated vote weight is transferred to the delegate.
    /// Delegators cannot vote directly while their delegation is active.
    pub fn delegate_vote(ctx: Context<DelegateVote>) -> Result<()> {
        let delegation = &mut ctx.accounts.delegation;
        delegation.delegator = ctx.accounts.delegator.key();
        delegation.delegate = ctx.accounts.delegate.key();
        delegation.created_at = Clock::get()?.unix_timestamp;
        delegation.bump = ctx.bumps.delegation;

        emit!(VoteDelegated {
            delegator: ctx.accounts.delegator.key(),
            delegate: ctx.accounts.delegate.key(),
        });

        Ok(())
    }

    /// Revoke a previously created delegation
    pub fn revoke_delegation(_ctx: Context<RevokeDelegation>) -> Result<()> {
        // Account is closed by the close constraint
        emit!(DelegationRevoked {
            delegator: _ctx.accounts.delegation.delegator,
            delegate: _ctx.accounts.delegation.delegate,
        });

        Ok(())
    }

    /// Dev mode: Initialize tally without Arcium callback
    pub fn dev_init_tally(ctx: Context<DevInitTally>) -> Result<()> {
        let tally = &mut ctx.accounts.tally;
        tally.proposal = ctx.accounts.proposal.key();
        tally.encrypted_data = [0u8; 128];
        tally.nonce = [0u8; 16];
        tally.bump = ctx.bumps.tally;
        Ok(())
    }

    /// Dev mode: Cast vote without Arcium CPI (token gating still enforced)
    pub fn dev_cast_vote(
        ctx: Context<DevCastVote>,
        encrypted_choice: [u8; 32],
        nonce: [u8; 16],
        voter_pubkey: [u8; 32],
    ) -> Result<()> {
        // Soft freeze check — if ProgramConfig exists and is_frozen, block new votes
        check_not_frozen(&ctx.accounts.program_config, ctx.program_id)?;

        require!(ctx.accounts.proposal.is_active, VotingError::VotingClosed);

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp < ctx.accounts.proposal.voting_ends_at,
            VotingError::VotingEnded
        );

        // Check no active delegation — delegators must revoke before voting directly
        check_no_active_delegation(
            &ctx.accounts.delegation_account,
            &ctx.accounts.voter.key(),
            ctx.program_id,
        )?;

        // Token gate: voter must hold the required SPL token
        let token_account = &ctx.accounts.voter_token_account;
        require!(
            token_account.owner == ctx.accounts.voter.key(),
            VotingError::InvalidTokenAccount
        );
        require!(
            token_account.mint == ctx.accounts.proposal.gate_mint,
            VotingError::InvalidTokenMint
        );
        require!(
            token_account.amount >= ctx.accounts.proposal.min_balance,
            VotingError::InsufficientTokenBalance
        );

        // Record that this voter has voted
        let vote_record = &mut ctx.accounts.vote_record;
        vote_record.proposal = ctx.accounts.proposal.key();
        vote_record.voter = ctx.accounts.voter.key();
        vote_record.voted_at = clock.unix_timestamp;
        vote_record.encrypted_choice = encrypted_choice;
        vote_record.nonce = nonce;
        vote_record.voter_pubkey = voter_pubkey;
        vote_record.bump = ctx.bumps.vote_record;

        // Dev mode: directly update tally nonce and vote counter
        ctx.accounts.tally.nonce = nonce;
        ctx.accounts.proposal.total_votes += 1;

        emit!(VoteCast {
            proposal: ctx.accounts.proposal.key(),
            voter: ctx.accounts.voter.key(),
        });

        Ok(())
    }

    /// Dev mode: Reveal results with provided counts (simulates MXE callback)
    /// After the voting deadline, anyone can trigger reveal (permissionless).
    /// Before the deadline, only the proposal authority can reveal.
    pub fn dev_reveal_results(
        ctx: Context<DevRevealResults>,
        yes_count: u64,
        no_count: u64,
        abstain_count: u64,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;

        // Allow permissionless reveal after voting ends
        let clock = Clock::get()?;
        if clock.unix_timestamp < proposal.voting_ends_at {
            // Before deadline: only authority can reveal
            require!(
                ctx.accounts.authority.key() == proposal.authority,
                VotingError::Unauthorized
            );
        }
        // After deadline: anyone can trigger reveal

        // Prevent re-reveal
        require!(!proposal.is_revealed, VotingError::AlreadyRevealed);

        require!(
            clock.unix_timestamp >= proposal.voting_ends_at,
            VotingError::VotingNotEnded
        );

        // Checked arithmetic to prevent overflow
        let total_votes = yes_count
            .checked_add(no_count)
            .and_then(|x| x.checked_add(abstain_count))
            .ok_or(VotingError::ArithmeticOverflow)?;

        // Validate total against on-chain vote counter to prevent fabricated counts
        require!(
            total_votes == proposal.total_votes,
            VotingError::VoteTallyMismatch
        );

        // Check quorum if set
        if proposal.quorum > 0 {
            require!(
                total_votes >= proposal.quorum,
                VotingError::QuorumNotReached
            );
        }

        // Check threshold: yes_votes must be >= threshold_bps of non-abstain votes
        let non_abstain = yes_count
            .checked_add(no_count)
            .ok_or(VotingError::ArithmeticOverflow)?;
        let threshold_met = if non_abstain > 0 {
            yes_count
                .checked_mul(10_000)
                .ok_or(VotingError::ArithmeticOverflow)?
                / non_abstain
                >= proposal.threshold_bps as u64
        } else {
            false
        };

        let quorum_met = proposal.quorum == 0 || total_votes >= proposal.quorum;

        proposal.is_active = false;
        proposal.is_revealed = true;
        proposal.yes_votes = yes_count;
        proposal.no_votes = no_count;
        proposal.abstain_votes = abstain_count;
        proposal.passed = quorum_met && threshold_met;

        let winner = if yes_count > no_count {
            1u8
        } else if no_count > yes_count {
            2u8
        } else {
            0u8
        };

        emit!(ResultsRevealed {
            proposal: proposal.key(),
            yes_votes: yes_count,
            no_votes: no_count,
            abstain_votes: abstain_count,
            total_votes,
            winner,
            passed: proposal.passed,
        });

        Ok(())
    }

    /// Cancel a proposal (authority only).
    /// Can only cancel before voting ends OR if no votes have been cast.
    pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let clock = Clock::get()?;

        require!(
            ctx.accounts.authority.key() == proposal.authority,
            VotingError::Unauthorized
        );
        require!(proposal.is_active, VotingError::VotingClosed);

        // Can only cancel if voting hasn't ended OR no votes have been cast
        require!(
            clock.unix_timestamp < proposal.voting_ends_at || proposal.total_votes == 0,
            VotingError::CannotCancelAfterVotes
        );

        proposal.is_active = false;

        emit!(ProposalCancelled {
            proposal: proposal.key(),
            authority: ctx.accounts.authority.key(),
        });

        Ok(())
    }

    /// Initialize DAO configuration (one-time setup)
    pub fn init_dao_config(
        ctx: Context<InitDaoConfig>,
        deposit_mint: Pubkey,
        proposal_deposit: u64,
        treasury: Pubkey,
        slash_if_no_quorum: bool,
        governance_mint: Pubkey,
        min_proposer_balance: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.dao_config;
        config.authority = ctx.accounts.authority.key();
        config.deposit_mint = deposit_mint;
        config.proposal_deposit = proposal_deposit;
        config.treasury = treasury;
        config.slash_if_no_quorum = slash_if_no_quorum;
        config.governance_mint = governance_mint;
        config.min_proposer_balance = min_proposer_balance;
        config.bump = ctx.bumps.dao_config;
        Ok(())
    }

    /// Update DAO configuration (admin only)
    pub fn update_dao_config(
        ctx: Context<UpdateDaoConfig>,
        deposit_mint: Option<Pubkey>,
        proposal_deposit: Option<u64>,
        treasury: Option<Pubkey>,
        slash_if_no_quorum: Option<bool>,
        governance_mint: Option<Pubkey>,
        min_proposer_balance: Option<u64>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.dao_config;

        require!(
            ctx.accounts.authority.key() == config.authority,
            VotingError::Unauthorized
        );

        if let Some(v) = deposit_mint {
            config.deposit_mint = v;
        }
        if let Some(v) = proposal_deposit {
            config.proposal_deposit = v;
        }
        if let Some(v) = treasury {
            config.treasury = v;
        }
        if let Some(v) = slash_if_no_quorum {
            config.slash_if_no_quorum = v;
        }
        if let Some(v) = governance_mint {
            config.governance_mint = v;
        }
        if let Some(v) = min_proposer_balance {
            config.min_proposer_balance = v;
        }

        Ok(())
    }

    /// Community-governed proposal creation.
    /// Any wallet holding sufficient governance tokens (as defined in DaoConfig)
    /// can create a proposal. The proposer becomes the proposal authority.
    /// Requires DaoConfig to be initialized with governance_mint and min_proposer_balance.
    pub fn community_create_proposal(
        ctx: Context<CommunityCreateProposal>,
        proposal_id: u64,
        title: String,
        description: String,
        voting_ends_at: i64,
        gate_mint: Pubkey,
        min_balance: u64,
        quorum: u64,
        threshold_bps: u16,
        privacy_level: u8,
        discussion_url: String,
        execution_delay: i64,
    ) -> Result<()> {
        // Validate V2 fields
        require!(
            threshold_bps > 0 && threshold_bps <= 10_000,
            VotingError::InvalidThreshold
        );
        require!(privacy_level <= 2, VotingError::InvalidPrivacyLevel);
        require!(execution_delay >= 0, VotingError::InvalidExecutionDelay);

        // Validate title and description lengths
        require!(
            !title.is_empty() && title.len() <= 100,
            VotingError::InvalidTitleLength
        );
        require!(
            !description.is_empty() && description.len() <= 5000,
            VotingError::InvalidDescriptionLength
        );

        // Validate voting end time is in the future
        let clock = Clock::get()?;
        require!(
            voting_ends_at > clock.unix_timestamp,
            VotingError::InvalidVotingEndTime
        );

        // Token gate: proposer must hold sufficient governance tokens
        let dao_config = &ctx.accounts.dao_config;
        let token_account = &ctx.accounts.proposer_token_account;
        require!(
            token_account.owner == ctx.accounts.proposer.key(),
            VotingError::InvalidTokenAccount
        );
        require!(
            token_account.mint == dao_config.governance_mint,
            VotingError::InvalidGovernanceMint
        );
        require!(
            token_account.amount >= dao_config.min_proposer_balance,
            VotingError::InsufficientProposerBalance
        );

        // Initialize proposal state -- proposer becomes the authority
        let proposal = &mut ctx.accounts.proposal;
        proposal.id = proposal_id;
        proposal.authority = ctx.accounts.proposer.key();
        proposal.title = title;
        proposal.description = description;
        proposal.voting_ends_at = voting_ends_at;
        proposal.is_active = true;
        proposal.is_revealed = false;
        proposal.total_votes = 0;
        proposal.gate_mint = gate_mint;
        proposal.min_balance = min_balance;
        proposal.mxe_program_id = Pubkey::default();
        proposal.quorum = quorum;
        proposal.threshold_bps = threshold_bps;
        proposal.privacy_level = privacy_level;
        proposal.passed = false;
        proposal.discussion_url = discussion_url;
        proposal.deposit_amount = 0;
        proposal.deposit_returned = false;
        proposal.execution_delay = execution_delay;
        proposal.executed = false;
        proposal.bump = ctx.bumps.proposal;

        emit!(ProposalCreated {
            proposal_id,
            authority: ctx.accounts.proposer.key(),
            voting_ends_at,
        });

        Ok(())
    }

    // ==================== PROGRAM CONFIG (MAINNET READINESS) ====================

    /// Initialize the ProgramConfig PDA. Sets the caller as the initial authority.
    /// This is a one-time setup instruction — the PDA is derived from ["program_config"].
    pub fn init_program_config(ctx: Context<InitProgramConfig>) -> Result<()> {
        let config = &mut ctx.accounts.program_config;
        config.authority = ctx.accounts.authority.key();
        config.is_frozen = false;
        config.created_at = Clock::get()?.unix_timestamp;
        config.bump = ctx.bumps.program_config;

        msg!(
            "ProgramConfig initialized. Authority: {}",
            ctx.accounts.authority.key()
        );
        Ok(())
    }

    /// Transfer program authority to a new address (e.g., a Squads multisig).
    /// Only the current authority can invoke this instruction.
    pub fn transfer_authority(
        ctx: Context<TransferAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.program_config;

        require!(
            ctx.accounts.authority.key() == config.authority,
            VotingError::Unauthorized
        );

        let old_authority = config.authority;
        config.authority = new_authority;

        emit!(AuthorityTransferred {
            old_authority,
            new_authority,
        });

        msg!(
            "Authority transferred from {} to {}",
            old_authority,
            new_authority
        );
        Ok(())
    }

    /// Freeze the program — blocks new proposals and votes.
    /// Only the current program authority can invoke this.
    pub fn freeze_program(ctx: Context<FreezeProgram>) -> Result<()> {
        let config = &mut ctx.accounts.program_config;

        require!(
            ctx.accounts.authority.key() == config.authority,
            VotingError::Unauthorized
        );

        config.is_frozen = true;

        emit!(ProgramFreezeToggled {
            authority: ctx.accounts.authority.key(),
            is_frozen: true,
        });

        msg!("Program frozen by {}", ctx.accounts.authority.key());
        Ok(())
    }

    /// Unfreeze the program — re-enables proposals and votes.
    /// Only the current program authority can invoke this.
    pub fn unfreeze_program(ctx: Context<UnfreezeProgram>) -> Result<()> {
        let config = &mut ctx.accounts.program_config;

        require!(
            ctx.accounts.authority.key() == config.authority,
            VotingError::Unauthorized
        );

        config.is_frozen = false;

        emit!(ProgramFreezeToggled {
            authority: ctx.accounts.authority.key(),
            is_frozen: false,
        });

        msg!("Program unfrozen by {}", ctx.accounts.authority.key());
        Ok(())
    }
}

// ==================== ACCOUNT STRUCTURES ====================

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct CreateProposal<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [PROPOSAL_SEED, proposal_id.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    /// CHECK: Sign PDA for Arcium CPI
    #[account(
        seeds = [SIGN_SEED],
        bump
    )]
    pub sign_seed: AccountInfo<'info>,

    // Arcium accounts
    pub arcium_program: Program<'info, Arcium>,
    /// CHECK: MXE account
    pub mxe_account: AccountInfo<'info>,
    /// CHECK: Cluster account
    pub cluster_account: AccountInfo<'info>,
    /// CHECK: Fee pool
    pub pool_account: AccountInfo<'info>,
    /// CHECK: Clock account
    pub clock_account: AccountInfo<'info>,
    /// CHECK: Mempool
    pub mempool_account: AccountInfo<'info>,
    /// CHECK: Executing pool
    pub executing_pool: AccountInfo<'info>,
    /// CHECK: Computation account
    #[account(mut)]
    pub computation_account: AccountInfo<'info>,
    /// CHECK: Comp def account
    pub comp_def_account: AccountInfo<'info>,
    /// CHECK: Computation offset account
    #[account(
        mut,
        seeds = [COMPUTATION_OFFSET_SEED],
        bump = computation_offset_account.bump
    )]
    pub computation_offset_account: Account<'info, ComputationOffsetState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitTallyCallback<'info> {
    #[account(
        mut,
        constraint = proposal.authority == authority.key() @ VotingError::Unauthorized
    )]
    pub proposal: Account<'info, Proposal>,

    /// CHECK: Proposal authority — validated by constraint above
    pub authority: AccountInfo<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Tally::INIT_SPACE,
        seeds = [TALLY_SEED, proposal.key().as_ref()],
        bump
    )]
    pub tally: Account<'info, Tally>,

    /// CHECK: Sign PDA ensures this callback was invoked via Arcium CPI
    #[account(
        seeds = [SIGN_SEED],
        bump,
        signer
    )]
    pub sign_seed: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    #[account(mut)]
    pub proposal: Account<'info, Proposal>,

    #[account(
        mut,
        seeds = [TALLY_SEED, proposal.key().as_ref()],
        bump,
    )]
    pub tally: Account<'info, Tally>,

    #[account(
        constraint = voter_token_account.owner == voter.key(),
        constraint = voter_token_account.mint == proposal.gate_mint
    )]
    pub voter_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = voter,
        space = 8 + VoteRecord::INIT_SPACE,
        seeds = [VOTE_RECORD_SEED, proposal.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub vote_record: Account<'info, VoteRecord>,

    /// CHECK: Delegation PDA for the voter — derived deterministically.
    /// If this account has data and is owned by the program, the voter has
    /// an active delegation and cannot vote directly.
    pub delegation_account: AccountInfo<'info>,

    /// CHECK: Sign PDA
    #[account(seeds = [SIGN_SEED], bump)]
    pub sign_seed: AccountInfo<'info>,

    // Arcium accounts (same as CreateProposal)
    pub arcium_program: Program<'info, Arcium>,
    /// CHECK: MXE account
    pub mxe_account: AccountInfo<'info>,
    /// CHECK: Cluster account
    pub cluster_account: AccountInfo<'info>,
    /// CHECK: Fee pool
    pub pool_account: AccountInfo<'info>,
    /// CHECK: Clock account
    pub clock_account: AccountInfo<'info>,
    /// CHECK: Mempool
    pub mempool_account: AccountInfo<'info>,
    /// CHECK: Executing pool
    pub executing_pool: AccountInfo<'info>,
    /// CHECK: Computation account
    #[account(mut)]
    pub computation_account: AccountInfo<'info>,
    /// CHECK: Comp def account
    pub comp_def_account: AccountInfo<'info>,
    /// CHECK: Computation offset account
    #[account(
        mut,
        seeds = [COMPUTATION_OFFSET_SEED],
        bump = computation_offset_account.bump
    )]
    pub computation_offset_account: Account<'info, ComputationOffsetState>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VoteCallback<'info> {
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,

    #[account(
        mut,
        seeds = [TALLY_SEED, proposal.key().as_ref()],
        bump,
    )]
    pub tally: Account<'info, Tally>,

    /// CHECK: Sign PDA ensures this callback was invoked via Arcium CPI
    #[account(
        seeds = [SIGN_SEED],
        bump,
        signer
    )]
    pub sign_seed: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct RevealResults<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub proposal: Account<'info, Proposal>,

    #[account(
        seeds = [TALLY_SEED, proposal.key().as_ref()],
        bump,
    )]
    pub tally: Account<'info, Tally>,

    /// CHECK: Sign PDA
    #[account(seeds = [SIGN_SEED], bump)]
    pub sign_seed: AccountInfo<'info>,

    // Arcium accounts
    pub arcium_program: Program<'info, Arcium>,
    /// CHECK: MXE account
    pub mxe_account: AccountInfo<'info>,
    /// CHECK: Cluster account
    pub cluster_account: AccountInfo<'info>,
    /// CHECK: Fee pool
    pub pool_account: AccountInfo<'info>,
    /// CHECK: Clock account
    pub clock_account: AccountInfo<'info>,
    /// CHECK: Mempool
    pub mempool_account: AccountInfo<'info>,
    /// CHECK: Executing pool
    pub executing_pool: AccountInfo<'info>,
    /// CHECK: Computation account
    #[account(mut)]
    pub computation_account: AccountInfo<'info>,
    /// CHECK: Comp def account
    pub comp_def_account: AccountInfo<'info>,
    /// CHECK: Computation offset account
    #[account(
        mut,
        seeds = [COMPUTATION_OFFSET_SEED],
        bump = computation_offset_account.bump
    )]
    pub computation_offset_account: Account<'info, ComputationOffsetState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealResultsCallback<'info> {
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,

    /// CHECK: Sign PDA ensures this callback was invoked via Arcium CPI
    #[account(
        seeds = [SIGN_SEED],
        bump,
        signer
    )]
    pub sign_seed: AccountInfo<'info>,
}

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

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitComputationOffset<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + ComputationOffsetState::INIT_SPACE,
        seeds = [COMPUTATION_OFFSET_SEED],
        bump
    )]
    pub computation_offset_account: Account<'info, ComputationOffsetState>,

    pub system_program: Program<'info, System>,
}

// ==================== DEV MODE ACCOUNT STRUCTURES ====================

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct DevCreateProposal<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [PROPOSAL_SEED, proposal_id.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    /// CHECK: ProgramConfig PDA — optional. If it doesn't exist, freeze check is skipped.
    /// Passed as AccountInfo for backward compatibility (won't fail if account is missing).
    pub program_config: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DevInitTally<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub proposal: Account<'info, Proposal>,

    #[account(
        init,
        payer = authority,
        space = 8 + Tally::INIT_SPACE,
        seeds = [TALLY_SEED, proposal.key().as_ref()],
        bump
    )]
    pub tally: Account<'info, Tally>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DevCastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    #[account(mut)]
    pub proposal: Account<'info, Proposal>,

    #[account(
        mut,
        seeds = [TALLY_SEED, proposal.key().as_ref()],
        bump,
    )]
    pub tally: Account<'info, Tally>,

    #[account(
        constraint = voter_token_account.owner == voter.key(),
        constraint = voter_token_account.mint == proposal.gate_mint
    )]
    pub voter_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = voter,
        space = 8 + VoteRecord::INIT_SPACE,
        seeds = [VOTE_RECORD_SEED, proposal.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub vote_record: Account<'info, VoteRecord>,

    /// CHECK: Delegation PDA for the voter — derived deterministically.
    /// If this account has data and is owned by the program, the voter has
    /// an active delegation and cannot vote directly.
    pub delegation_account: AccountInfo<'info>,

    /// CHECK: ProgramConfig PDA — optional. If it doesn't exist, freeze check is skipped.
    pub program_config: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DevRevealResults<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub proposal: Account<'info, Proposal>,

    #[account(
        seeds = [TALLY_SEED, proposal.key().as_ref()],
        bump,
    )]
    pub tally: Account<'info, Tally>,
}

#[derive(Accounts)]
pub struct CancelProposal<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
}

#[derive(Accounts)]
pub struct DelegateVote<'info> {
    #[account(mut)]
    pub delegator: Signer<'info>,

    /// CHECK: The delegate address (any valid pubkey)
    pub delegate: AccountInfo<'info>,

    #[account(
        init,
        payer = delegator,
        space = 8 + Delegation::INIT_SPACE,
        seeds = [DELEGATION_SEED, delegator.key().as_ref()],
        bump
    )]
    pub delegation: Account<'info, Delegation>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeDelegation<'info> {
    #[account(mut)]
    pub delegator: Signer<'info>,

    #[account(
        mut,
        close = delegator,
        seeds = [DELEGATION_SEED, delegator.key().as_ref()],
        bump = delegation.bump,
        constraint = delegation.delegator == delegator.key()
    )]
    pub delegation: Account<'info, Delegation>,
}

#[derive(Accounts)]
pub struct InitDaoConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + DaoConfig::INIT_SPACE,
        seeds = [DAO_CONFIG_SEED],
        bump
    )]
    pub dao_config: Account<'info, DaoConfig>,

    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
pub struct UpdateDaoConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [DAO_CONFIG_SEED],
        bump = dao_config.bump,
        constraint = dao_config.authority == authority.key() @ VotingError::Unauthorized
    )]
    pub dao_config: Account<'info, DaoConfig>,
}

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct CommunityCreateProposal<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,

    #[account(
        init,
        payer = proposer,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [PROPOSAL_SEED, proposal_id.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(
        seeds = [DAO_CONFIG_SEED],
        bump = dao_config.bump
    )]
    pub dao_config: Account<'info, DaoConfig>,

    /// Proposer's governance token account
    #[account(
        constraint = proposer_token_account.owner == proposer.key() @ VotingError::InvalidTokenAccount,
        constraint = proposer_token_account.mint == dao_config.governance_mint @ VotingError::InvalidGovernanceMint
    )]
    pub proposer_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ==================== PROGRAM CONFIG ACCOUNT STRUCTURES ====================

#[derive(Accounts)]
pub struct InitProgramConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + ProgramConfig::INIT_SPACE,
        seeds = [PROGRAM_CONFIG_SEED],
        bump
    )]
    pub program_config: Account<'info, ProgramConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [PROGRAM_CONFIG_SEED],
        bump = program_config.bump,
        constraint = program_config.authority == authority.key() @ VotingError::Unauthorized
    )]
    pub program_config: Account<'info, ProgramConfig>,
}

#[derive(Accounts)]
pub struct FreezeProgram<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [PROGRAM_CONFIG_SEED],
        bump = program_config.bump,
        constraint = program_config.authority == authority.key() @ VotingError::Unauthorized
    )]
    pub program_config: Account<'info, ProgramConfig>,
}

#[derive(Accounts)]
pub struct UnfreezeProgram<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [PROGRAM_CONFIG_SEED],
        bump = program_config.bump,
        constraint = program_config.authority == authority.key() @ VotingError::Unauthorized
    )]
    pub program_config: Account<'info, ProgramConfig>,
}

// ==================== STATE ACCOUNTS ====================

#[account]
#[derive(InitSpace)]
pub struct ProgramConfig {
    /// Current program authority (can be a multisig address)
    pub authority: Pubkey,
    /// Emergency freeze flag — when true, new proposals and votes are blocked
    pub is_frozen: bool,
    /// Timestamp when this config was created
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Proposal {
    pub id: u64,
    pub authority: Pubkey,
    #[max_len(100)]
    pub title: String,
    #[max_len(5000)]
    pub description: String,
    pub voting_ends_at: i64,
    pub is_active: bool,
    pub is_revealed: bool,
    pub total_votes: u64,
    pub gate_mint: Pubkey,
    pub min_balance: u64,
    pub mxe_program_id: Pubkey,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub abstain_votes: u64,
    /// Minimum number of votes required for the result to be valid (0 = no quorum)
    pub quorum: u64,
    /// V2: Passing threshold in basis points (e.g., 5001 = simple majority, 6667 = two-thirds)
    pub threshold_bps: u16,
    /// V2: Privacy level (0 = Full, 1 = Partial, 2 = Transparent)
    pub privacy_level: u8,
    /// V2: Whether the proposal passed its threshold check
    pub passed: bool,
    /// V2: Optional discussion URL for linking to external debate forums
    #[max_len(256)]
    pub discussion_url: String,
    /// V2: Deposit amount locked by creator (returned if quorum met)
    pub deposit_amount: u64,
    /// V2: Whether the deposit has been returned or slashed
    pub deposit_returned: bool,
    /// V2: Execution delay in seconds after reveal (timelock for payload execution)
    pub execution_delay: i64,
    /// V2: Whether the on-chain action payload has been executed
    pub executed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct DaoConfig {
    pub authority: Pubkey,
    /// Token mint used for proposal deposits
    pub deposit_mint: Pubkey,
    /// Required deposit amount to create a proposal
    pub proposal_deposit: u64,
    /// Treasury address where slashed deposits go
    pub treasury: Pubkey,
    /// Whether to slash deposits when quorum is not met
    pub slash_if_no_quorum: bool,
    /// Governance token mint — proposers must hold this token to create proposals
    pub governance_mint: Pubkey,
    /// Minimum governance token balance required to create a community proposal
    pub min_proposer_balance: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ProposalCounter {
    pub authority: Pubkey,
    pub active_count: u8,
    pub last_created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Delegation {
    pub delegator: Pubkey,
    pub delegate: Pubkey,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Tally {
    pub proposal: Pubkey,
    pub encrypted_data: [u8; 128],
    pub nonce: [u8; 16],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VoteRecord {
    pub proposal: Pubkey,
    pub voter: Pubkey,
    pub voted_at: i64,
    pub encrypted_choice: [u8; 32],
    pub nonce: [u8; 16],
    pub voter_pubkey: [u8; 32],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ComputationOffsetState {
    pub bump: u8,
}

/// Stores the circuit hash and initialization state for computation definitions.
/// Created once during `init_comp_def` and used for on-chain integrity verification.
#[account]
#[derive(InitSpace)]
pub struct CompDefState {
    pub authority: Pubkey,
    /// SHA-256 hash of the compiled Arcis circuit bytecode
    #[max_len(64)]
    pub circuit_hash: String,
    /// Whether computation definitions have been initialized
    pub initialized: bool,
    pub bump: u8,
}

// ==================== EVENTS ====================

#[event]
pub struct ProposalCreated {
    pub proposal_id: u64,
    pub authority: Pubkey,
    pub voting_ends_at: i64,
}

#[event]
pub struct VoteCast {
    pub proposal: Pubkey,
    pub voter: Pubkey,
}

#[event]
pub struct VoteDelegated {
    pub delegator: Pubkey,
    pub delegate: Pubkey,
}

#[event]
pub struct DelegationRevoked {
    pub delegator: Pubkey,
    pub delegate: Pubkey,
}

#[event]
pub struct ProposalCancelled {
    pub proposal: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct ResultsRevealed {
    pub proposal: Pubkey,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub abstain_votes: u64,
    pub total_votes: u64,
    pub winner: u8,
    pub passed: bool,
}

#[event]
pub struct AuthorityTransferred {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct ProgramFreezeToggled {
    pub authority: Pubkey,
    pub is_frozen: bool,
}

// ==================== ERRORS ====================

#[error_code]
pub enum VotingError {
    #[msg("Voting has been closed")]
    VotingClosed,
    #[msg("Voting period has ended")]
    VotingEnded,
    #[msg("Voting period has not ended yet")]
    VotingNotEnded,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Already voted")]
    AlreadyVoted,
    #[msg("Invalid token account for voter")]
    InvalidTokenAccount,
    #[msg("Token mint does not match gate mint")]
    InvalidTokenMint,
    #[msg("Insufficient token balance to vote")]
    InsufficientTokenBalance,
    #[msg("Quorum not reached: not enough votes cast")]
    QuorumNotReached,
    #[msg("Cannot vote directly while delegation is active")]
    ActiveDelegation,
    #[msg("Arithmetic overflow in vote tally")]
    ArithmeticOverflow,
    #[msg("Vote tally mismatch: yes + no + abstain != total")]
    VoteTallyMismatch,
    #[msg("Invalid threshold: must be between 1 and 10000 basis points")]
    InvalidThreshold,
    #[msg("Invalid privacy level: must be 0 (Full), 1 (Partial), or 2 (Transparent)")]
    InvalidPrivacyLevel,
    #[msg("Invalid execution delay: must be non-negative")]
    InvalidExecutionDelay,
    #[msg("Threshold not met: YES votes below required percentage")]
    ThresholdNotMet,
    #[msg("Deposit already processed")]
    DepositAlreadyProcessed,
    #[msg("Results not yet revealed")]
    NotYetRevealed,
    #[msg("Circuit hash mismatch: deployed bytecode does not match expected hash")]
    CircuitHashMismatch,
    #[msg("Results already revealed")]
    AlreadyRevealed,
    #[msg("Invalid delegation account: does not match expected PDA")]
    InvalidDelegationAccount,
    #[msg("Cannot cancel proposal after votes have been cast and voting has ended")]
    CannotCancelAfterVotes,
    #[msg("Title must be between 1 and 100 characters")]
    InvalidTitleLength,
    #[msg("Description must be between 1 and 5000 characters")]
    InvalidDescriptionLength,
    #[msg("Voting end time must be in the future")]
    InvalidVotingEndTime,
    #[msg("Governance token mint does not match DaoConfig")]
    InvalidGovernanceMint,
    #[msg("Insufficient governance token balance to create proposal")]
    InsufficientProposerBalance,
    #[msg("Program is frozen: new proposals and votes are temporarily blocked")]
    ProgramFrozen,
}

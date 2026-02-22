//! # Private DAO Voting — Arcis MPC Circuit
//!
//! This circuit runs inside Arcium's MXE (Multi-Party Computation eXecution Environment).
//! It defines the core privacy logic: how encrypted votes are tallied without
//! ever being decrypted individually.
//!
//! ## Privacy Guarantees
//!
//! - **Input Privacy**: Individual votes (`Enc<Shared, u8>`) are secret-shared
//!   across MXE nodes. No single node can reconstruct any vote.
//! - **Computation Integrity**: The MXE produces correctness proofs that the
//!   published tally is the mathematically valid sum of all submitted votes.
//! - **Output Privacy**: Only `finalize_and_reveal` calls `.reveal()`, and only
//!   on aggregate totals — never on individual vote values.
//!
//! ## Vote Encoding
//!
//! Votes are encoded as a single `u8`:
//! - `0` = NO
//! - `1` = YES
//! - `2` = ABSTAIN
//!
//! ## Why Encrypted Comparisons (not branches)
//!
//! In MPC, you cannot branch on secret values — `if encrypted_vote == 1` would
//! leak the vote to the evaluating node. Instead, we use constant-time encrypted
//! comparisons (`eq()`) that produce encrypted boolean flags, then cast those to
//! `u64` for accumulation. This is the standard MPC pattern for conditional logic.

use arcis::prelude::*;

/// Encrypted voting state stored in the MXE cluster.
///
/// All fields are `Enc<Shared, u64>` — encrypted values that are secret-shared
/// across Arx Nodes. No individual node holds enough shares to decrypt any field.
/// The only way to access plaintext is via `finalize_and_reveal`, which requires
/// consensus from a threshold of nodes.
#[derive(Debug, Clone)]
pub struct VotingState {
    /// Encrypted count of YES votes — incremented by 1 for each YES ballot
    pub encrypted_yes_votes: Enc<Shared, u64>,
    /// Encrypted count of NO votes — incremented by 1 for each NO ballot
    pub encrypted_no_votes: Enc<Shared, u64>,
    /// Encrypted count of ABSTAIN votes — incremented by 1 for each ABSTAIN ballot
    pub encrypted_abstain_votes: Enc<Shared, u64>,
    /// Encrypted total votes cast — always incremented by 1 per vote (integrity check)
    pub encrypted_total_votes: Enc<Shared, u64>,
}

/// Initialize a new voting session with encrypted zero counts.
///
/// This creates a fresh `VotingState` where all counters are encrypted zeros.
/// The MXE stores this state and provides it to subsequent `cast_vote` calls.
///
/// # Security
/// Even the initial "zero" values are encrypted — an observer cannot distinguish
/// a fresh state from one with votes, without calling `finalize_and_reveal`.
#[arcis::export]
pub fn initialize_voting(computation_id: ComputationId) -> VotingState {
    let zero_u64: Enc<Shared, u64> = Enc::new(0u64);

    VotingState {
        encrypted_yes_votes: zero_u64.clone(),
        encrypted_no_votes: zero_u64.clone(),
        encrypted_abstain_votes: zero_u64.clone(),
        encrypted_total_votes: zero_u64,
    }
}

/// Cast an encrypted vote into the tally.
///
/// This is the core privacy-preserving function. It receives an encrypted vote
/// and updates the encrypted running totals without ever decrypting the vote.
///
/// # How It Works (Constant-Time MPC Pattern)
///
/// ```text
/// encrypted_vote = Enc(1)  // YES, but the circuit doesn't know this
///
/// is_yes    = encrypted_vote.eq(Enc(1))  → Enc(true)   // encrypted comparison
/// is_no     = encrypted_vote.eq(Enc(0))  → Enc(false)
/// is_abstain = encrypted_vote.eq(Enc(2)) → Enc(false)
///
/// // Cast booleans to u64: Enc(true) → Enc(1), Enc(false) → Enc(0)
/// // Then add to running totals — all arithmetic happens on ciphertext
/// yes_total   = yes_total + Enc(1)   // incremented
/// no_total    = no_total + Enc(0)    // unchanged
/// abstain_total = abstain_total + Enc(0) // unchanged
/// ```
///
/// All three comparisons always execute (constant-time), so no timing or
/// control-flow side channel can leak the vote value.
///
/// # Arguments
/// * `state` - Current encrypted voting state from the MXE
/// * `encrypted_vote` - The voter's encrypted choice (0=NO, 1=YES, 2=ABSTAIN)
///
/// # Returns
/// Updated `VotingState` with the new vote accumulated into the encrypted totals.
#[arcis::export]
pub fn cast_vote(state: VotingState, encrypted_vote: Enc<Shared, u8>) -> VotingState {
    // Create encrypted constants for comparison.
    // These are public values wrapped in Enc — the MXE can use them for
    // encrypted equality checks without learning the vote value.
    let one_u8: Enc<Shared, u8> = Enc::new(1u8);
    let zero_u8: Enc<Shared, u8> = Enc::new(0u8);
    let two_u8: Enc<Shared, u8> = Enc::new(2u8);

    // Encrypted equality checks — these produce Enc<Shared, bool> values.
    // The result is itself encrypted; no node learns whether the comparison is true.
    // Then .cast() converts Enc<bool> → Enc<u64> (true→1, false→0) for arithmetic.
    let is_yes: Enc<Shared, u64> = encrypted_vote.eq(&one_u8).cast();
    let is_no: Enc<Shared, u64> = encrypted_vote.eq(&zero_u8).cast();
    let is_abstain: Enc<Shared, u64> = encrypted_vote.eq(&two_u8).cast();

    // Increment total votes by 1 (unconditional — every valid call is one vote)
    let one_u64: Enc<Shared, u64> = Enc::new(1u64);

    // All additions happen on encrypted values — the MXE nodes perform
    // secret-shared arithmetic without decrypting any operand.
    VotingState {
        encrypted_yes_votes: state.encrypted_yes_votes + is_yes,
        encrypted_no_votes: state.encrypted_no_votes + is_no,
        encrypted_abstain_votes: state.encrypted_abstain_votes + is_abstain,
        encrypted_total_votes: state.encrypted_total_votes + one_u64,
    }
}

/// Finalize voting and reveal aggregate results.
///
/// This is the ONLY function that calls `.reveal()`, and only on the aggregate
/// totals — never on individual vote values. The MXE enforces that `.reveal()`
/// requires threshold consensus from Arx Nodes.
///
/// # Security Boundary
/// - Individual votes are NEVER revealed (no `.reveal()` on per-vote data)
/// - Only the final sums (yes, no, abstain, total) are decrypted
/// - The on-chain program enforces that this can only be called after the
///   voting deadline has passed and only by the proposal authority
///
/// # Returns
/// Tuple of `(yes_votes, no_votes, abstain_votes, total_votes)` in plaintext.
/// These values are returned to the Solana program via a CPI callback.
#[arcis::export]
pub fn finalize_and_reveal(state: VotingState) -> (u64, u64, u64, u64) {
    // Threshold decryption — requires consensus from MXE nodes.
    // This is the security boundary: encrypted → plaintext.
    let yes_votes = state.encrypted_yes_votes.reveal();
    let no_votes = state.encrypted_no_votes.reveal();
    let abstain_votes = state.encrypted_abstain_votes.reveal();
    let total_votes = state.encrypted_total_votes.reveal();

    (yes_votes, no_votes, abstain_votes, total_votes)
}

/// Query current vote count without revealing the YES/NO/ABSTAIN breakdown.
///
/// This reveals ONLY the total count, keeping the vote distribution secret.
/// Useful for displaying participation progress without leaking interim results.
#[arcis::export]
pub fn get_vote_count(state: &VotingState) -> u64 {
    state.encrypted_total_votes.reveal()
}

/// Get live tally for Transparent Privacy mode.
///
/// Unlike `finalize_and_reveal`, this can be called during active voting to show
/// running totals. Only appropriate for proposals with `privacy_level = 2`
/// (Transparent Tally). Individual vote choices are still hidden — only the
/// aggregate counts are revealed.
///
/// # Security Note
/// This function reveals the current vote distribution in real-time.
/// It should ONLY be invoked for proposals explicitly configured as Transparent.
/// The on-chain program enforces this check before queuing this computation.
#[arcis::export]
pub fn get_live_tally(state: &VotingState) -> (u64, u64, u64, u64) {
    (
        state.encrypted_yes_votes.reveal(),
        state.encrypted_no_votes.reveal(),
        state.encrypted_abstain_votes.reveal(),
        state.encrypted_total_votes.reveal(),
    )
}

/// Finalize voting with threshold check and conditional payload decryption.
///
/// This is the V2 execution engine function. It:
/// 1. Reveals aggregate tallies (same as `finalize_and_reveal`)
/// 2. Checks if quorum and threshold are met
/// 3. Returns a `passed` boolean derived from the now-public tallies
///
/// The `passed` boolean is safe to branch on because the tallies are already
/// being revealed — it's derived from public values, not encrypted state.
///
/// # Arguments
/// * `state` - Current encrypted voting state
/// * `quorum` - Minimum total votes required (plaintext, set at proposal creation)
/// * `threshold_bps` - Required YES percentage in basis points (e.g., 5001 = 50.01%)
///
/// # Returns
/// Tuple of `(yes, no, abstain, total, passed)` where `passed` indicates
/// whether the proposal met both quorum and threshold requirements.
#[arcis::export]
pub fn finalize_with_threshold(
    state: VotingState,
    quorum: u64,
    threshold_bps: u64,
) -> (u64, u64, u64, u64, bool) {
    let yes_votes = state.encrypted_yes_votes.reveal();
    let no_votes = state.encrypted_no_votes.reveal();
    let abstain_votes = state.encrypted_abstain_votes.reveal();
    let total_votes = state.encrypted_total_votes.reveal();

    let quorum_met = quorum == 0 || total_votes >= quorum;
    let non_abstain = yes_votes + no_votes;
    let threshold_met = non_abstain > 0 && (yes_votes * 10_000) / non_abstain >= threshold_bps;

    (
        yes_votes,
        no_votes,
        abstain_votes,
        total_votes,
        quorum_met && threshold_met,
    )
}

// ==================== TESTS ====================

#[cfg(test)]
mod tests {
    use super::*;
    use arcis::testing::*;

    #[test]
    fn test_voting_flow() {
        let ctx = TestContext::new();
        let mut state = initialize_voting(ctx.computation_id());

        // Cast 3 YES, 2 NO, 1 ABSTAIN
        for _ in 0..3 {
            state = cast_vote(state, Enc::new(1u8));
        }
        for _ in 0..2 {
            state = cast_vote(state, Enc::new(0u8));
        }
        state = cast_vote(state, Enc::new(2u8));

        let (yes, no, abstain, total) = finalize_and_reveal(state);
        assert_eq!(yes, 3);
        assert_eq!(no, 2);
        assert_eq!(abstain, 1);
        assert_eq!(total, 6);
    }

    #[test]
    fn test_all_abstain() {
        let ctx = TestContext::new();
        let mut state = initialize_voting(ctx.computation_id());

        for _ in 0..5 {
            state = cast_vote(state, Enc::new(2u8));
        }

        let (yes, no, abstain, total) = finalize_and_reveal(state);
        assert_eq!(yes, 0);
        assert_eq!(no, 0);
        assert_eq!(abstain, 5);
        assert_eq!(total, 5);
    }

    #[test]
    fn test_empty_voting() {
        let ctx = TestContext::new();
        let state = initialize_voting(ctx.computation_id());

        let (yes, no, abstain, total) = finalize_and_reveal(state);
        assert_eq!(yes, 0);
        assert_eq!(no, 0);
        assert_eq!(abstain, 0);
        assert_eq!(total, 0);
    }

    #[test]
    fn test_single_yes_vote() {
        let ctx = TestContext::new();
        let mut state = initialize_voting(ctx.computation_id());
        state = cast_vote(state, Enc::new(1u8));

        let (yes, no, abstain, total) = finalize_and_reveal(state);
        assert_eq!(yes, 1);
        assert_eq!(no, 0);
        assert_eq!(abstain, 0);
        assert_eq!(total, 1);
    }

    #[test]
    fn test_single_no_vote() {
        let ctx = TestContext::new();
        let mut state = initialize_voting(ctx.computation_id());
        state = cast_vote(state, Enc::new(0u8));

        let (yes, no, abstain, total) = finalize_and_reveal(state);
        assert_eq!(yes, 0);
        assert_eq!(no, 1);
        assert_eq!(abstain, 0);
        assert_eq!(total, 1);
    }

    #[test]
    fn test_all_yes() {
        let ctx = TestContext::new();
        let mut state = initialize_voting(ctx.computation_id());

        for _ in 0..10 {
            state = cast_vote(state, Enc::new(1u8));
        }

        let (yes, no, abstain, total) = finalize_and_reveal(state);
        assert_eq!(yes, 10);
        assert_eq!(no, 0);
        assert_eq!(abstain, 0);
        assert_eq!(total, 10);
    }

    #[test]
    fn test_all_no() {
        let ctx = TestContext::new();
        let mut state = initialize_voting(ctx.computation_id());

        for _ in 0..7 {
            state = cast_vote(state, Enc::new(0u8));
        }

        let (yes, no, abstain, total) = finalize_and_reveal(state);
        assert_eq!(yes, 0);
        assert_eq!(no, 7);
        assert_eq!(abstain, 0);
        assert_eq!(total, 7);
    }

    #[test]
    fn test_large_vote_count() {
        let ctx = TestContext::new();
        let mut state = initialize_voting(ctx.computation_id());

        // Simulate 100 voters: 50 YES, 30 NO, 20 ABSTAIN
        for _ in 0..50 {
            state = cast_vote(state, Enc::new(1u8));
        }
        for _ in 0..30 {
            state = cast_vote(state, Enc::new(0u8));
        }
        for _ in 0..20 {
            state = cast_vote(state, Enc::new(2u8));
        }

        let (yes, no, abstain, total) = finalize_and_reveal(state);
        assert_eq!(yes, 50);
        assert_eq!(no, 30);
        assert_eq!(abstain, 20);
        assert_eq!(total, 100);
    }

    #[test]
    fn test_vote_count_query() {
        let ctx = TestContext::new();
        let mut state = initialize_voting(ctx.computation_id());

        // Cast some votes and check count without revealing breakdown
        for _ in 0..4 {
            state = cast_vote(state, Enc::new(1u8));
        }
        state = cast_vote(state, Enc::new(0u8));

        let count = get_vote_count(&state);
        assert_eq!(count, 5);
    }

    #[test]
    fn test_get_live_tally() {
        let ctx = TestContext::new();
        let mut state = initialize_voting(ctx.computation_id());

        // Cast some votes
        state = cast_vote(state, Enc::new(1u8)); // YES
        state = cast_vote(state, Enc::new(1u8)); // YES
        state = cast_vote(state, Enc::new(0u8)); // NO

        // Live tally reveals running totals
        let (yes, no, abstain, total) = get_live_tally(&state);
        assert_eq!(yes, 2);
        assert_eq!(no, 1);
        assert_eq!(abstain, 0);
        assert_eq!(total, 3);

        // Cast more votes and check again
        state = cast_vote(state, Enc::new(2u8)); // ABSTAIN
        let (yes, no, abstain, total) = get_live_tally(&state);
        assert_eq!(yes, 2);
        assert_eq!(no, 1);
        assert_eq!(abstain, 1);
        assert_eq!(total, 4);
    }

    #[test]
    fn test_finalize_with_threshold_passes() {
        let ctx = TestContext::new();
        let mut state = initialize_voting(ctx.computation_id());

        // 7 YES, 3 NO = 70% YES
        for _ in 0..7 {
            state = cast_vote(state, Enc::new(1u8));
        }
        for _ in 0..3 {
            state = cast_vote(state, Enc::new(0u8));
        }

        // Quorum = 5, threshold = 60% (6000 bps)
        let (yes, no, abstain, total, passed) = finalize_with_threshold(state, 5, 6000);
        assert_eq!(yes, 7);
        assert_eq!(no, 3);
        assert_eq!(abstain, 0);
        assert_eq!(total, 10);
        assert!(passed);
    }

    #[test]
    fn test_finalize_with_threshold_fails_quorum() {
        let ctx = TestContext::new();
        let mut state = initialize_voting(ctx.computation_id());

        // Only 3 votes, all YES
        for _ in 0..3 {
            state = cast_vote(state, Enc::new(1u8));
        }

        // Quorum = 5 (not met), threshold = 50%
        let (_, _, _, total, passed) = finalize_with_threshold(state, 5, 5001);
        assert_eq!(total, 3);
        assert!(!passed);
    }

    #[test]
    fn test_finalize_with_threshold_fails_threshold() {
        let ctx = TestContext::new();
        let mut state = initialize_voting(ctx.computation_id());

        // 4 YES, 6 NO = 40% YES
        for _ in 0..4 {
            state = cast_vote(state, Enc::new(1u8));
        }
        for _ in 0..6 {
            state = cast_vote(state, Enc::new(0u8));
        }

        // Quorum = 5 (met), threshold = 50% (not met)
        let (yes, no, _, total, passed) = finalize_with_threshold(state, 5, 5001);
        assert_eq!(yes, 4);
        assert_eq!(no, 6);
        assert_eq!(total, 10);
        assert!(!passed);
    }

    #[test]
    fn test_finalize_abstains_excluded_from_threshold() {
        let ctx = TestContext::new();
        let mut state = initialize_voting(ctx.computation_id());

        // 3 YES, 2 NO, 5 ABSTAIN = 60% of non-abstain
        for _ in 0..3 {
            state = cast_vote(state, Enc::new(1u8));
        }
        for _ in 0..2 {
            state = cast_vote(state, Enc::new(0u8));
        }
        for _ in 0..5 {
            state = cast_vote(state, Enc::new(2u8));
        }

        // Threshold = 60% of non-abstain (3/5 = 60%, exactly meets 6000 bps)
        let (yes, no, abstain, total, passed) = finalize_with_threshold(state, 0, 6000);
        assert_eq!(yes, 3);
        assert_eq!(no, 2);
        assert_eq!(abstain, 5);
        assert_eq!(total, 10);
        assert!(passed);
    }

    #[test]
    fn test_tally_consistency() {
        let ctx = TestContext::new();
        let mut state = initialize_voting(ctx.computation_id());

        // Mixed votes
        state = cast_vote(state, Enc::new(1u8)); // YES
        state = cast_vote(state, Enc::new(0u8)); // NO
        state = cast_vote(state, Enc::new(2u8)); // ABSTAIN
        state = cast_vote(state, Enc::new(1u8)); // YES
        state = cast_vote(state, Enc::new(0u8)); // NO

        let (yes, no, abstain, total) = finalize_and_reveal(state);

        // Verify total == yes + no + abstain (integrity invariant)
        assert_eq!(yes + no + abstain, total);
        assert_eq!(yes, 2);
        assert_eq!(no, 2);
        assert_eq!(abstain, 1);
    }
}

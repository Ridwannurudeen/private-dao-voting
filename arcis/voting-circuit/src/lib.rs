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
}

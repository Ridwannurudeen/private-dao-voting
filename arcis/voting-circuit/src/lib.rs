//! Arcium MxProgram for Private DAO Voting
//!
//! This circuit performs confidential vote tallying using Arcium's MXE.
//! Individual votes remain encrypted - only the final tally is revealed.
//!
//! Vote encoding: 0 = NO, 1 = YES, 2 = ABSTAIN

use arcis::prelude::*;

/// Encrypted voting state stored in the MXE cluster
#[derive(Debug, Clone)]
pub struct VotingState {
    /// Encrypted count of YES votes
    pub encrypted_yes_votes: Enc<Shared, u64>,
    /// Encrypted count of NO votes
    pub encrypted_no_votes: Enc<Shared, u64>,
    /// Encrypted count of ABSTAIN votes
    pub encrypted_abstain_votes: Enc<Shared, u64>,
    /// Encrypted total votes cast
    pub encrypted_total_votes: Enc<Shared, u64>,
}

/// Initialize a new voting session with encrypted zero counts
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

/// Cast an encrypted vote
///
/// # Arguments
/// * `state` - Current voting state
/// * `encrypted_vote` - Encrypted vote (0 = NO, 1 = YES, 2 = ABSTAIN)
///
/// # Returns
/// Updated voting state with the new vote counted
///
/// # Vote counting logic
/// Using constant-time arithmetic to avoid branching on secret values:
///   is_yes = (vote == 1)     → 1 if YES, 0 otherwise
///   is_no  = (1 - vote) * (1 - vote / 2)  ... but MPC can't branch.
///
/// Simpler approach: encode as two bits.
///   is_yes    = vote & 1 when vote < 2, but this requires bit ops.
///
/// Cleanest for MPC: pass two encrypted flags from client.
/// But to keep the interface simple (single u8 vote), we use:
///   is_yes    = vote * (2 - vote) / 1  ... no, just compare.
///
/// Actually, the safest MPC approach with a single u8:
///   yes_inc     = (vote == 1) as u64   → encrypted comparison
///   no_inc      = (vote == 0) as u64
///   abstain_inc = (vote == 2) as u64
#[arcis::export]
pub fn cast_vote(state: VotingState, encrypted_vote: Enc<Shared, u8>) -> VotingState {
    // Encrypted comparisons — no values are revealed
    let one_u8: Enc<Shared, u8> = Enc::new(1u8);
    let zero_u8: Enc<Shared, u8> = Enc::new(0u8);
    let two_u8: Enc<Shared, u8> = Enc::new(2u8);

    // Compute encrypted boolean flags (1 or 0) for each vote type
    let is_yes: Enc<Shared, u64> = encrypted_vote.eq(&one_u8).cast();
    let is_no: Enc<Shared, u64> = encrypted_vote.eq(&zero_u8).cast();
    let is_abstain: Enc<Shared, u64> = encrypted_vote.eq(&two_u8).cast();

    let one_u64: Enc<Shared, u64> = Enc::new(1u64);

    VotingState {
        encrypted_yes_votes: state.encrypted_yes_votes + is_yes,
        encrypted_no_votes: state.encrypted_no_votes + is_no,
        encrypted_abstain_votes: state.encrypted_abstain_votes + is_abstain,
        encrypted_total_votes: state.encrypted_total_votes + one_u64,
    }
}

/// Finalize voting and reveal results
///
/// This function returns the decrypted tally.
/// Called only after the voting period has ended (enforced on-chain).
///
/// # Arguments
/// * `state` - Final voting state
///
/// # Returns
/// Tuple of (yes_votes, no_votes, abstain_votes, total_votes)
#[arcis::export]
pub fn finalize_and_reveal(state: VotingState) -> (u64, u64, u64, u64) {
    let yes_votes = state.encrypted_yes_votes.reveal();
    let no_votes = state.encrypted_no_votes.reveal();
    let abstain_votes = state.encrypted_abstain_votes.reveal();
    let total_votes = state.encrypted_total_votes.reveal();

    (yes_votes, no_votes, abstain_votes, total_votes)
}

/// Query current vote count (remains encrypted)
/// Returns the total number of votes cast (revealed) without revealing YES/NO/ABSTAIN split
#[arcis::export]
pub fn get_vote_count(state: &VotingState) -> u64 {
    state.encrypted_total_votes.reveal()
}

#[cfg(test)]
mod tests {
    use super::*;
    use arcis::testing::*;

    #[test]
    fn test_voting_flow() {
        let ctx = TestContext::new();

        // Initialize
        let mut state = initialize_voting(ctx.computation_id());

        // Cast 3 YES votes
        for _ in 0..3 {
            let vote: Enc<Shared, u8> = Enc::new(1u8);
            state = cast_vote(state, vote);
        }

        // Cast 2 NO votes
        for _ in 0..2 {
            let vote: Enc<Shared, u8> = Enc::new(0u8);
            state = cast_vote(state, vote);
        }

        // Cast 1 ABSTAIN vote
        let vote: Enc<Shared, u8> = Enc::new(2u8);
        state = cast_vote(state, vote);

        // Finalize and check results
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
            let vote: Enc<Shared, u8> = Enc::new(2u8);
            state = cast_vote(state, vote);
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

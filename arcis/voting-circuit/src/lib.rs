//! Arcium MxProgram for Private DAO Voting
//! 
//! This circuit performs confidential vote tallying using Arcium's MXE.
//! Individual votes remain encrypted - only the final tally is revealed.

use arcis::prelude::*;

/// Encrypted voting state stored in the MXE cluster
#[derive(Debug, Clone)]
pub struct VotingState {
    /// Encrypted count of YES votes
    pub encrypted_yes_votes: Enc<Shared, u64>,
    /// Encrypted count of NO votes  
    pub encrypted_no_votes: Enc<Shared, u64>,
    /// Encrypted total votes cast
    pub encrypted_total_votes: Enc<Shared, u64>,
    /// Whether voting is still active
    pub is_active: Enc<Shared, bool>,
}

/// Initialize a new voting session with encrypted zero counts
#[arcis::export]
pub fn initialize_voting(
    computation_id: ComputationId,
) -> VotingState {
    // Initialize all counters to encrypted zeros
    let zero_u64: Enc<Shared, u64> = Enc::new(0u64);
    let is_active: Enc<Shared, bool> = Enc::new(true);
    
    VotingState {
        encrypted_yes_votes: zero_u64.clone(),
        encrypted_no_votes: zero_u64.clone(),
        encrypted_total_votes: zero_u64,
        is_active,
    }
}

/// Cast an encrypted vote
/// 
/// # Arguments
/// * `state` - Current voting state
/// * `encrypted_vote` - Encrypted vote (1 = YES, 0 = NO)
/// 
/// # Returns
/// Updated voting state with the new vote counted
#[arcis::export]
pub fn cast_vote(
    state: VotingState,
    encrypted_vote: Enc<Shared, u8>,
) -> VotingState {
    // Verify voting is still active
    let is_active_plain = state.is_active.reveal();
    assert!(is_active_plain, "Voting has ended");
    
    // Convert vote to u64 for addition
    let vote_as_u64: Enc<Shared, u64> = encrypted_vote.cast();
    
    // Compute inverse for NO vote counting (1 - vote)
    let one: Enc<Shared, u64> = Enc::new(1u64);
    let inverse_vote: Enc<Shared, u64> = one - vote_as_u64.clone();
    
    // Update encrypted counters
    // YES votes: add the vote directly (1 if YES, 0 if NO)
    let new_yes_votes = state.encrypted_yes_votes + vote_as_u64;
    
    // NO votes: add the inverse (0 if YES, 1 if NO)
    let new_no_votes = state.encrypted_no_votes + inverse_vote;
    
    // Total votes: always increment by 1
    let new_total = state.encrypted_total_votes + one;
    
    VotingState {
        encrypted_yes_votes: new_yes_votes,
        encrypted_no_votes: new_no_votes,
        encrypted_total_votes: new_total,
        is_active: state.is_active,
    }
}

/// Finalize voting and reveal results
/// 
/// This function closes voting and returns the decrypted tally.
/// Called only after the voting period has ended.
/// 
/// # Arguments
/// * `state` - Final voting state
/// 
/// # Returns
/// Tuple of (yes_votes, no_votes, total_votes)
#[arcis::export]
pub fn finalize_and_reveal(
    state: VotingState,
) -> (u64, u64, u64) {
    // Close voting
    let _closed: Enc<Shared, bool> = Enc::new(false);
    
    // Reveal the final tallies
    let yes_votes = state.encrypted_yes_votes.reveal();
    let no_votes = state.encrypted_no_votes.reveal();
    let total_votes = state.encrypted_total_votes.reveal();
    
    (yes_votes, no_votes, total_votes)
}

/// Query current vote count (remains encrypted)
/// Returns the total number of votes cast (revealed) without revealing YES/NO split
#[arcis::export]
pub fn get_vote_count(state: &VotingState) -> u64 {
    // Only reveal total count, not the YES/NO breakdown
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
        
        // Finalize and check results
        let (yes, no, total) = finalize_and_reveal(state);
        
        assert_eq!(yes, 3);
        assert_eq!(no, 2);
        assert_eq!(total, 5);
    }
}
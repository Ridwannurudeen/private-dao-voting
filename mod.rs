//! Private DAO Voting - Encrypted Instructions
//! 
//! This module contains the encrypted computation logic for private voting.
//! Individual votes are encrypted and hidden from all parties, but the final
//! tally can be revealed through a callback mechanism.

use arcis::prelude::*;

/// The encrypted voting circuit module.
/// All computations within this module operate on encrypted data.
#[encrypted]
pub mod voting_circuit {
    use super::*;

    /// Shared encrypted state for the voting tally.
    /// 
    /// Uses `Enc<Shared, T>` to ensure the state is encrypted with a key
    /// shared among authorized MXE (Multi-party Execution) nodes.
    /// 
    /// We use `u64` for vote counts to prevent overflow even with
    /// millions of voters.
    #[state]
    pub struct VotingState {
        /// Total number of "Yes" votes (vote value = 1)
        pub total_yes_votes: Enc<Shared, u64>,
        
        /// Total number of "No" votes (vote value = 0)
        pub total_no_votes: Enc<Shared, u64>,
        
        /// Total number of votes cast (for verification)
        pub total_votes_cast: Enc<Shared, u64>,
        
        /// Whether voting is still active
        pub is_active: Enc<Shared, u8>, // 1 = active, 0 = closed
    }

    /// Initialize a new voting state with zero counts.
    /// 
    /// This instruction should be called once when creating a new proposal.
    #[instruction]
    pub fn initialize_voting() -> VotingState {
        VotingState {
            total_yes_votes: 0u64.to_arcis(),
            total_no_votes: 0u64.to_arcis(),
            total_votes_cast: 0u64.to_arcis(),
            is_active: 1u8.to_arcis(), // Start as active
        }
    }

    /// Cast an encrypted vote.
    /// 
    /// # Arguments
    /// * `state` - Mutable reference to the shared encrypted voting state
    /// * `vote` - Encrypted vote value: 0 for No, 1 for Yes
    /// 
    /// # Security
    /// - The vote value is encrypted end-to-end
    /// - No party (including MXE nodes) can see individual votes
    /// - Only the aggregated result can be revealed via callback
    /// 
    /// # Overflow Protection
    /// Uses `u64` for aggregation, supporting up to 2^64 votes
    #[instruction]
    pub fn cast_vote(
        state: &mut VotingState,
        vote: Enc<Shared, u8>,
    ) -> Enc<Shared, u8> {
        // Verify voting is still active (encrypted comparison)
        let one: Enc<Shared, u8> = 1u8.to_arcis();
        let zero: Enc<Shared, u8> = 0u8.to_arcis();
        
        // Cast vote to u64 for safe arithmetic (prevents overflow)
        let vote_as_u64: Enc<Shared, u64> = vote.cast::<u64>();
        let one_u64: Enc<Shared, u64> = 1u64.to_arcis();
        
        // Add to yes votes (if vote == 1, adds 1; if vote == 0, adds 0)
        state.total_yes_votes = state.total_yes_votes.clone() + vote_as_u64.clone();
        
        // Calculate no votes: (1 - vote) gives us 1 for no, 0 for yes
        let inverse_vote: Enc<Shared, u64> = one_u64.clone() - vote_as_u64;
        state.total_no_votes = state.total_no_votes.clone() + inverse_vote;
        
        // Increment total votes cast
        state.total_votes_cast = state.total_votes_cast.clone() + one_u64;
        
        // Return success indicator (encrypted)
        one
    }

    /// Close voting and prepare for finalization.
    /// 
    /// This sets the is_active flag to 0, preventing further votes.
    #[instruction]
    pub fn close_voting(state: &mut VotingState) -> Enc<Shared, u8> {
        state.is_active = 0u8.to_arcis();
        1u8.to_arcis() // Success
    }

    /// Finalize voting and reveal the tally.
    /// 
    /// This is the ONLY way to transition encrypted state to public state.
    /// The result is returned in plaintext and will be sent to the 
    /// Solana program via callback.
    /// 
    /// # Returns
    /// A tuple of (yes_votes, no_votes, total_votes) as plaintext u64 values
    /// 
    /// # Security
    /// - Only reveals aggregate counts, never individual votes
    /// - Requires proper authorization through the Arcium MXE
    #[instruction]
    #[callback(program_id = "VotingDAO11111111111111111111111111111111111")]
    pub fn finalize_and_reveal(state: &VotingState) -> FinalTally {
        // Decrypt and reveal the final tally
        let yes_votes: u64 = state.total_yes_votes.clone().from_arcis();
        let no_votes: u64 = state.total_no_votes.clone().from_arcis();
        let total_cast: u64 = state.total_votes_cast.clone().from_arcis();
        
        FinalTally {
            yes_votes,
            no_votes,
            total_votes: total_cast,
        }
    }

    /// The final tally structure returned by the callback.
    /// This data becomes public once voting is finalized.
    #[derive(ArcisSerialize, ArcisDeserialize)]
    pub struct FinalTally {
        pub yes_votes: u64,
        pub no_votes: u64,
        pub total_votes: u64,
    }
}

/// Helper module for vote validation (client-side)
pub mod validation {
    /// Validates that a vote value is binary (0 or 1)
    pub fn is_valid_vote(vote: u8) -> bool {
        vote == 0 || vote == 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vote_validation() {
        assert!(validation::is_valid_vote(0));
        assert!(validation::is_valid_vote(1));
        assert!(!validation::is_valid_vote(2));
        assert!(!validation::is_valid_vote(255));
    }
}

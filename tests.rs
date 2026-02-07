//! Unit Tests for the Voting Circuit
//!
//! These tests verify the encrypted voting logic using Arcis's
//! test utilities that simulate the MXE environment.

use arcis::testing::*;
use super::voting_circuit::*;
use super::validation;

/// Test module for voting circuit functionality
#[cfg(test)]
mod voting_circuit_tests {
    use super::*;

    // =========================================================================
    // INITIALIZATION TESTS
    // =========================================================================

    #[test]
    fn test_initialize_voting_creates_zero_state() {
        // Setup test MXE environment
        let mut ctx = ArcisTestContext::new();
        
        // Execute initialization
        let state = ctx.execute(|| initialize_voting());
        
        // Verify all counters start at zero
        assert_eq!(ctx.decrypt::<u64>(&state.total_yes_votes), 0);
        assert_eq!(ctx.decrypt::<u64>(&state.total_no_votes), 0);
        assert_eq!(ctx.decrypt::<u64>(&state.total_votes_cast), 0);
        
        // Verify voting is active
        assert_eq!(ctx.decrypt::<u8>(&state.is_active), 1);
    }

    #[test]
    fn test_initialize_voting_state_is_encrypted() {
        let mut ctx = ArcisTestContext::new();
        let state = ctx.execute(|| initialize_voting());
        
        // Verify state values are actually encrypted (not plaintext)
        assert!(ctx.is_encrypted(&state.total_yes_votes));
        assert!(ctx.is_encrypted(&state.total_no_votes));
        assert!(ctx.is_encrypted(&state.total_votes_cast));
        assert!(ctx.is_encrypted(&state.is_active));
    }

    // =========================================================================
    // CAST VOTE TESTS
    // =========================================================================

    #[test]
    fn test_cast_single_yes_vote() {
        let mut ctx = ArcisTestContext::new();
        let mut state = ctx.execute(|| initialize_voting());
        
        // Cast a YES vote (1)
        let vote = ctx.encrypt::<u8>(1);
        let result = ctx.execute(|| cast_vote(&mut state, vote));
        
        // Verify vote was counted
        assert_eq!(ctx.decrypt::<u64>(&state.total_yes_votes), 1);
        assert_eq!(ctx.decrypt::<u64>(&state.total_no_votes), 0);
        assert_eq!(ctx.decrypt::<u64>(&state.total_votes_cast), 1);
        
        // Verify success return
        assert_eq!(ctx.decrypt::<u8>(&result), 1);
    }

    #[test]
    fn test_cast_single_no_vote() {
        let mut ctx = ArcisTestContext::new();
        let mut state = ctx.execute(|| initialize_voting());
        
        // Cast a NO vote (0)
        let vote = ctx.encrypt::<u8>(0);
        let result = ctx.execute(|| cast_vote(&mut state, vote));
        
        // Verify vote was counted
        assert_eq!(ctx.decrypt::<u64>(&state.total_yes_votes), 0);
        assert_eq!(ctx.decrypt::<u64>(&state.total_no_votes), 1);
        assert_eq!(ctx.decrypt::<u64>(&state.total_votes_cast), 1);
        
        // Verify success return
        assert_eq!(ctx.decrypt::<u8>(&result), 1);
    }

    #[test]
    fn test_cast_multiple_votes_mixed() {
        let mut ctx = ArcisTestContext::new();
        let mut state = ctx.execute(|| initialize_voting());
        
        // Cast 5 YES votes
        for _ in 0..5 {
            let vote = ctx.encrypt::<u8>(1);
            ctx.execute(|| cast_vote(&mut state, vote));
        }
        
        // Cast 3 NO votes
        for _ in 0..3 {
            let vote = ctx.encrypt::<u8>(0);
            ctx.execute(|| cast_vote(&mut state, vote));
        }
        
        // Verify counts
        assert_eq!(ctx.decrypt::<u64>(&state.total_yes_votes), 5);
        assert_eq!(ctx.decrypt::<u64>(&state.total_no_votes), 3);
        assert_eq!(ctx.decrypt::<u64>(&state.total_votes_cast), 8);
    }

    #[test]
    fn test_cast_many_votes_no_overflow() {
        let mut ctx = ArcisTestContext::new();
        let mut state = ctx.execute(|| initialize_voting());
        
        // Cast 10,000 votes to ensure no overflow issues
        let vote_count = 10_000u64;
        
        for i in 0..vote_count {
            let vote_value = (i % 2) as u8; // Alternate yes/no
            let vote = ctx.encrypt::<u8>(vote_value);
            ctx.execute(|| cast_vote(&mut state, vote));
        }
        
        // Verify counts (half yes, half no)
        assert_eq!(ctx.decrypt::<u64>(&state.total_yes_votes), vote_count / 2);
        assert_eq!(ctx.decrypt::<u64>(&state.total_no_votes), vote_count / 2);
        assert_eq!(ctx.decrypt::<u64>(&state.total_votes_cast), vote_count);
    }

    #[test]
    fn test_votes_remain_encrypted_during_aggregation() {
        let mut ctx = ArcisTestContext::new();
        let mut state = ctx.execute(|| initialize_voting());
        
        // Cast several votes
        for _ in 0..10 {
            let vote = ctx.encrypt::<u8>(1);
            ctx.execute(|| cast_vote(&mut state, vote));
            
            // After each vote, state should still be encrypted
            assert!(ctx.is_encrypted(&state.total_yes_votes));
            assert!(ctx.is_encrypted(&state.total_no_votes));
        }
    }

    // =========================================================================
    // CLOSE VOTING TESTS
    // =========================================================================

    #[test]
    fn test_close_voting() {
        let mut ctx = ArcisTestContext::new();
        let mut state = ctx.execute(|| initialize_voting());
        
        // Verify voting starts active
        assert_eq!(ctx.decrypt::<u8>(&state.is_active), 1);
        
        // Close voting
        let result = ctx.execute(|| close_voting(&mut state));
        
        // Verify voting is now closed
        assert_eq!(ctx.decrypt::<u8>(&state.is_active), 0);
        assert_eq!(ctx.decrypt::<u8>(&result), 1);
    }

    // =========================================================================
    // FINALIZE AND REVEAL TESTS
    // =========================================================================

    #[test]
    fn test_finalize_and_reveal_returns_correct_tally() {
        let mut ctx = ArcisTestContext::new();
        let mut state = ctx.execute(|| initialize_voting());
        
        // Cast some votes: 7 yes, 3 no
        for _ in 0..7 {
            let vote = ctx.encrypt::<u8>(1);
            ctx.execute(|| cast_vote(&mut state, vote));
        }
        for _ in 0..3 {
            let vote = ctx.encrypt::<u8>(0);
            ctx.execute(|| cast_vote(&mut state, vote));
        }
        
        // Finalize and reveal
        let tally = ctx.execute(|| finalize_and_reveal(&state));
        
        // Verify revealed values are plaintext and correct
        assert_eq!(tally.yes_votes, 7);
        assert_eq!(tally.no_votes, 3);
        assert_eq!(tally.total_votes, 10);
    }

    #[test]
    fn test_finalize_empty_voting() {
        let mut ctx = ArcisTestContext::new();
        let state = ctx.execute(|| initialize_voting());
        
        // Finalize without any votes
        let tally = ctx.execute(|| finalize_and_reveal(&state));
        
        // All counts should be zero
        assert_eq!(tally.yes_votes, 0);
        assert_eq!(tally.no_votes, 0);
        assert_eq!(tally.total_votes, 0);
    }

    #[test]
    fn test_finalize_all_yes_votes() {
        let mut ctx = ArcisTestContext::new();
        let mut state = ctx.execute(|| initialize_voting());
        
        // Cast 100 yes votes
        for _ in 0..100 {
            let vote = ctx.encrypt::<u8>(1);
            ctx.execute(|| cast_vote(&mut state, vote));
        }
        
        let tally = ctx.execute(|| finalize_and_reveal(&state));
        
        assert_eq!(tally.yes_votes, 100);
        assert_eq!(tally.no_votes, 0);
        assert_eq!(tally.total_votes, 100);
    }

    #[test]
    fn test_finalize_all_no_votes() {
        let mut ctx = ArcisTestContext::new();
        let mut state = ctx.execute(|| initialize_voting());
        
        // Cast 100 no votes
        for _ in 0..100 {
            let vote = ctx.encrypt::<u8>(0);
            ctx.execute(|| cast_vote(&mut state, vote));
        }
        
        let tally = ctx.execute(|| finalize_and_reveal(&state));
        
        assert_eq!(tally.yes_votes, 0);
        assert_eq!(tally.no_votes, 100);
        assert_eq!(tally.total_votes, 100);
    }

    // =========================================================================
    // ENCRYPTION ISOLATION TESTS
    // =========================================================================

    #[test]
    fn test_different_voters_same_vote_different_ciphertext() {
        let mut ctx = ArcisTestContext::new();
        
        // Encrypt the same value twice (simulating two voters)
        let vote1 = ctx.encrypt::<u8>(1);
        let vote2 = ctx.encrypt::<u8>(1);
        
        // Ciphertexts should be different (due to different nonces)
        // even though the plaintext value is the same
        assert!(!ctx.ciphertexts_equal(&vote1, &vote2));
    }

    #[test]
    fn test_cannot_distinguish_yes_from_no_by_ciphertext_size() {
        let mut ctx = ArcisTestContext::new();
        
        let yes_vote = ctx.encrypt::<u8>(1);
        let no_vote = ctx.encrypt::<u8>(0);
        
        // Both ciphertexts should have the same size
        assert_eq!(ctx.ciphertext_size(&yes_vote), ctx.ciphertext_size(&no_vote));
    }
}

/// Test module for vote validation utilities
#[cfg(test)]
mod validation_tests {
    use super::*;

    #[test]
    fn test_valid_vote_zero() {
        assert!(validation::is_valid_vote(0));
    }

    #[test]
    fn test_valid_vote_one() {
        assert!(validation::is_valid_vote(1));
    }

    #[test]
    fn test_invalid_vote_two() {
        assert!(!validation::is_valid_vote(2));
    }

    #[test]
    fn test_invalid_vote_max_u8() {
        assert!(!validation::is_valid_vote(255));
    }

    #[test]
    fn test_invalid_vote_various() {
        for i in 2..=255u8 {
            assert!(!validation::is_valid_vote(i), "Vote {} should be invalid", i);
        }
    }
}

/// Test module for FinalTally serialization
#[cfg(test)]
mod serialization_tests {
    use super::*;

    #[test]
    fn test_final_tally_serialization_roundtrip() {
        let tally = FinalTally {
            yes_votes: 12345,
            no_votes: 67890,
            total_votes: 80235,
        };
        
        // Serialize
        let bytes = tally.to_arcis_bytes();
        
        // Deserialize
        let recovered = FinalTally::from_arcis_bytes(&bytes).unwrap();
        
        assert_eq!(recovered.yes_votes, tally.yes_votes);
        assert_eq!(recovered.no_votes, tally.no_votes);
        assert_eq!(recovered.total_votes, tally.total_votes);
    }

    #[test]
    fn test_final_tally_max_values() {
        let tally = FinalTally {
            yes_votes: u64::MAX / 2,
            no_votes: u64::MAX / 2,
            total_votes: u64::MAX,
        };
        
        let bytes = tally.to_arcis_bytes();
        let recovered = FinalTally::from_arcis_bytes(&bytes).unwrap();
        
        assert_eq!(recovered.yes_votes, tally.yes_votes);
        assert_eq!(recovered.no_votes, tally.no_votes);
        assert_eq!(recovered.total_votes, tally.total_votes);
    }
}

/// Stress tests for the voting circuit
#[cfg(test)]
mod stress_tests {
    use super::*;

    #[test]
    #[ignore] // Run with `cargo test -- --ignored` for stress tests
    fn stress_test_million_votes() {
        let mut ctx = ArcisTestContext::new();
        let mut state = ctx.execute(|| initialize_voting());
        
        let vote_count = 1_000_000u64;
        let yes_count = 600_000u64;
        
        // Cast votes
        for i in 0..vote_count {
            let vote_value = if i < yes_count { 1u8 } else { 0u8 };
            let vote = ctx.encrypt::<u8>(vote_value);
            ctx.execute(|| cast_vote(&mut state, vote));
            
            // Progress indicator
            if i % 100_000 == 0 {
                println!("Processed {} votes...", i);
            }
        }
        
        // Verify
        let tally = ctx.execute(|| finalize_and_reveal(&state));
        assert_eq!(tally.yes_votes, yes_count);
        assert_eq!(tally.no_votes, vote_count - yes_count);
        assert_eq!(tally.total_votes, vote_count);
    }
}

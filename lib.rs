//! Arcium Encrypted Instructions for Private DAO Voting
//!
//! This file defines the confidential computations that run inside the MXE.
//! These circuits operate on encrypted data - the MXE nodes never see plaintext.
//!
//! Location: encrypted-ixs/src/lib.rs

use arcis_imports::*;

/// Mark this module as containing encrypted circuits
#[encrypted]
mod circuits {
    use arcis_imports::*;

    // ==================== DATA STRUCTURES ====================

    /// Encrypted vote input from a voter
    /// The choice is encrypted before leaving the voter's browser
    #[derive(Clone)]
    pub struct VoteInput {
        /// 0 = No/Against, 1 = Yes/For, 2 = Abstain
        pub choice: u8,
    }

    /// Encrypted tally state stored on-chain
    /// All values remain encrypted until reveal
    #[derive(Clone)]
    pub struct VoteTally {
        /// Count of "No" votes
        pub no_count: u32,
        /// Count of "Yes" votes  
        pub yes_count: u32,
        /// Count of "Abstain" votes
        pub abstain_count: u32,
        /// Total votes cast
        pub total_votes: u32,
    }

    /// Result structure for reveal
    pub struct VoteResult {
        pub no_count: u32,
        pub yes_count: u32,
        pub abstain_count: u32,
        pub total_votes: u32,
        /// 0 = No wins, 1 = Yes wins, 2 = Tie
        pub winner: u8,
    }

    // ==================== ENCRYPTED INSTRUCTIONS ====================

    /// Initialize a new vote tally with zero counts
    /// 
    /// Called once when creating a new proposal.
    /// Returns encrypted [0, 0, 0, 0] tally.
    #[instruction]
    pub fn init_tally() -> Enc<Mxe, VoteTally> {
        // Create initial tally with all zeros
        let tally = VoteTally {
            no_count: 0,
            yes_count: 0,
            abstain_count: 0,
            total_votes: 0,
        };

        // Encrypt to MXE (cluster can decrypt collectively)
        Mxe.from_arcis(tally)
    }

    /// Cast an encrypted vote
    /// 
    /// This is the core voting instruction. It:
    /// 1. Decrypts the voter's choice (inside MPC - nodes see only shares)
    /// 2. Decrypts the current tally
    /// 3. Increments the appropriate counter
    /// 4. Re-encrypts the updated tally
    /// 
    /// Individual votes are NEVER revealed - only the final aggregate.
    #[instruction]
    pub fn vote(
        vote_input: Enc<Shared, VoteInput>,
        current_tally: Enc<Mxe, VoteTally>,
    ) -> Enc<Mxe, VoteTally> {
        // Decrypt inputs inside MPC (nodes only see secret shares)
        let vote = vote_input.to_arcis();
        let mut tally = current_tally.to_arcis();

        // Increment the appropriate counter based on choice
        // Note: Both branches execute to prevent timing side-channels
        if vote.choice == 0 {
            tally.no_count += 1;
        } else if vote.choice == 1 {
            tally.yes_count += 1;
        } else {
            tally.abstain_count += 1;
        }

        // Always increment total
        tally.total_votes += 1;

        // Re-encrypt and return
        Mxe.from_arcis(tally)
    }

    /// Reveal the final vote result
    /// 
    /// Called by the proposal authority after voting ends.
    /// This decrypts the tally and returns plaintext results.
    /// 
    /// The reveal() call makes the result public on-chain.
    #[instruction]
    pub fn reveal_result(encrypted_tally: Enc<Mxe, VoteTally>) -> VoteResult {
        // Decrypt the final tally
        let tally = encrypted_tally.to_arcis();

        // Determine winner
        let winner: u8 = if tally.yes_count > tally.no_count {
            1 // Yes wins
        } else if tally.no_count > tally.yes_count {
            0 // No wins
        } else {
            2 // Tie
        };

        // Return plaintext result (will be sent to callback)
        VoteResult {
            no_count: tally.no_count.reveal(),
            yes_count: tally.yes_count.reveal(),
            abstain_count: tally.abstain_count.reveal(),
            total_votes: tally.total_votes.reveal(),
            winner,
        }
    }

    // ==================== ADVANCED: THRESHOLD REVEAL ====================

    /// Check if voting threshold is met and conditionally reveal
    /// 
    /// This allows automatic reveal once enough votes are cast,
    /// without requiring manual intervention.
    #[instruction]
    pub fn check_threshold_and_reveal(
        encrypted_tally: Enc<Mxe, VoteTally>,
        threshold: u32,
    ) -> Option<VoteResult> {
        let tally = encrypted_tally.to_arcis();

        // Check if threshold met (comparison on encrypted value)
        if tally.total_votes >= threshold {
            // Threshold met - reveal results
            let winner: u8 = if tally.yes_count > tally.no_count {
                1
            } else if tally.no_count > tally.yes_count {
                0
            } else {
                2
            };

            Some(VoteResult {
                no_count: tally.no_count.reveal(),
                yes_count: tally.yes_count.reveal(),
                abstain_count: tally.abstain_count.reveal(),
                total_votes: tally.total_votes.reveal(),
                winner,
            })
        } else {
            // Threshold not met - return nothing
            None
        }
    }
}

// ==================== NOTES ON ARCIS ====================
//
// Key concepts used above:
//
// 1. `Enc<Owner, T>` - Encrypted wrapper type
//    - `Enc<Shared, T>` - Encrypted with shared secret (user + MXE)
//    - `Enc<Mxe, T>` - Encrypted to MXE only (cluster key)
//
// 2. `.to_arcis()` - Decrypt inside MPC (nodes see only shares)
//    - Does NOT reveal plaintext to any single party
//    - Converts ciphertext to secret-shared value
//
// 3. `Owner.from_arcis(value)` - Encrypt a value
//    - `Mxe.from_arcis(x)` encrypts to cluster key
//    - `shared_owner.from_arcis(x)` encrypts to shared secret
//
// 4. `.reveal()` - Make a value public
//    - Reconstructs plaintext from shares
//    - Result is sent to callback function
//
// 5. Conditional logic
//    - Both branches of `if` always execute
//    - This prevents timing side-channels
//    - The "wrong" branch result is discarded via MPC

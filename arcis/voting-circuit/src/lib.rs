//! # Private DAO Voting — Arcis MPC Circuit
//!
//! This circuit runs inside Arcium's MXE (Multi-Party Computation eXecution Environment)
//! using the Cerberus protocol for **dishonest majority** security: the computation
//! remains correct and private as long as at least one Arx Node is honest.
//!
//! ## Architecture
//!
//! - **Individual votes** use `Enc<Shared, u8>` — client-encrypted via x25519 ECDH,
//!   giving the voter cryptographic control over their key material.
//! - **Cumulative tally** uses `Enc<Mxe, Tally>` — owned by the MXE cluster,
//!   decryptable only via distributed threshold decryption across Arx Nodes.
//!   No single node holds enough key shares to read the tally.
//!
//! ## Privacy Guarantees
//!
//! - **Input Privacy**: Individual votes are secret-shared across MXE nodes.
//! - **Computation Integrity**: Cerberus MAC-authenticated shares detect tampering.
//! - **Output Privacy**: Only `finalize_and_reveal` / `finalize_with_threshold`
//!   call `.reveal()`, and only on aggregate totals.
//!
//! ## Vote Encoding
//!
//! - `0` = NO
//! - `1` = YES
//! - `2` = ABSTAIN
//!
//! ## Why Encrypted Comparisons (not branches)
//!
//! In MPC, branching on secret values leaks information via control flow.
//! Instead we use constant-time encrypted comparisons (`eq()`) that produce
//! encrypted boolean flags, then `cast()` to `u64` for accumulation.

/// Embeds the SHA-256 hash of the compiled circuit bytecode at compile time.
/// Used by the on-chain program to verify MPC logic integrity — if any node
/// attempts to run a modified circuit, the hash mismatch will be detected.
#[cfg(not(test))]
pub const CIRCUIT_HASH: &str = circuit_hash!("voting-circuit");

#[cfg(test)]
pub const CIRCUIT_HASH: &str = "test-mode-no-hash";

/// The core encrypted voting module. All functions marked `#[instruction]`
/// are compiled into individual MPC circuits callable from Solana via CPI.
///
/// ## Computation Lifecycle
///
/// 1. `init_comp_def` — Registers circuit bytecode + hash on-chain (one-time)
/// 2. `initialize_voting` — Creates encrypted zero state in MXE
/// 3. `cast_vote` (repeated) — Accumulates encrypted votes into tally
/// 4. `finalize_and_reveal` / `finalize_with_threshold` — Threshold decryption
/// 5. Callback delivers plaintext aggregates to the Solana program
#[encrypted]
mod circuits {
    use arcis_imports::*;

    // ==================== STATE ====================

    /// Cumulative vote tally stored encrypted in the MXE cluster.
    ///
    /// This struct is wrapped in `Enc<Mxe, Tally>` — the MXE cluster collectively
    /// owns the decryption key via Cerberus secret sharing. No individual node
    /// can decrypt the tally; threshold consensus is required for `.reveal()`.
    ///
    /// Using `Enc<Mxe, _>` instead of `Enc<Shared, _>` ensures the tally
    /// can only be decrypted by the distributed MXE cluster, not by any
    /// individual client or node.
    pub struct Tally {
        /// Count of YES votes (encrypted)
        pub yes: u64,
        /// Count of NO votes (encrypted)
        pub no: u64,
        /// Count of ABSTAIN votes (encrypted)
        pub abstain: u64,
        /// Total votes cast — integrity invariant: yes + no + abstain == total
        pub total: u64,
    }

    // ==================== INSTRUCTIONS ====================

    /// Initialize a new voting session with encrypted zero counts.
    ///
    /// Creates a fresh `Enc<Mxe, Tally>` where all counters are encrypted zeros.
    /// Even the initial state is indistinguishable from a tally with votes —
    /// an observer cannot determine participation level without `.reveal()`.
    ///
    /// Called once per proposal via `create_proposal` → MXE → `init_tally_callback`.
    #[instruction]
    pub fn initialize_voting() -> Enc<Mxe, Tally> {
        Enc::new(Tally {
            yes: 0,
            no: 0,
            abstain: 0,
            total: 0,
        })
    }

    /// Cast an encrypted vote into the tally.
    ///
    /// Core privacy-preserving function using constant-time MPC pattern:
    ///
    /// ```text
    /// encrypted_vote = Enc(1)  // YES — but the circuit doesn't know this
    ///
    /// is_yes     = encrypted_vote.eq(Enc(1))  → Enc(true)   // encrypted comparison
    /// is_no      = encrypted_vote.eq(Enc(0))  → Enc(false)
    /// is_abstain = encrypted_vote.eq(Enc(2))  → Enc(false)
    ///
    /// // cast booleans to u64: Enc(true) → Enc(1), Enc(false) → Enc(0)
    /// // add to running totals — all arithmetic on ciphertext
    /// ```
    ///
    /// All three comparisons always execute (constant-time), preventing
    /// timing or control-flow side channels from leaking the vote value.
    ///
    /// ## Arguments
    /// * `state` - Current `Enc<Mxe, Tally>` from the MXE cluster
    /// * `vote` - Voter's encrypted choice as `Enc<Shared, u8>` (0=NO, 1=YES, 2=ABSTAIN)
    ///
    /// ## Returns
    /// Updated `Enc<Mxe, Tally>` with the vote accumulated into encrypted totals.
    #[instruction]
    pub fn cast_vote(state: Enc<Mxe, Tally>, vote: Enc<Shared, u8>) -> Enc<Mxe, Tally> {
        let tally = state.to_arcis();

        // Encrypted constants for comparison — public values wrapped in Enc
        let one_u8: Enc<Shared, u8> = Enc::new(1u8);
        let zero_u8: Enc<Shared, u8> = Enc::new(0u8);
        let two_u8: Enc<Shared, u8> = Enc::new(2u8);

        // Encrypted equality checks → Enc<Shared, bool>
        // Then .cast() converts Enc<bool> → Enc<u64> (true→1, false→0)
        let is_yes: Enc<Shared, u64> = vote.eq(&one_u8).cast();
        let is_no: Enc<Shared, u64> = vote.eq(&zero_u8).cast();
        let is_abstain: Enc<Shared, u64> = vote.eq(&two_u8).cast();

        let one_u64: Enc<Shared, u64> = Enc::new(1u64);

        // All additions happen on encrypted values — MXE nodes perform
        // secret-shared arithmetic without decrypting any operand
        state.owner.from_arcis(Tally {
            yes: tally.yes + is_yes,
            no: tally.no + is_no,
            abstain: tally.abstain + is_abstain,
            total: tally.total + one_u64,
        })
    }

    /// Finalize voting and reveal aggregate results via threshold decryption.
    ///
    /// This is the primary reveal function. Only aggregate totals are decrypted —
    /// individual votes are NEVER revealed. The MXE enforces that `.reveal()`
    /// requires Cerberus threshold consensus from Arx Nodes.
    ///
    /// ## Security Boundary
    /// - Individual votes: never revealed (no `.reveal()` on per-vote data)
    /// - Aggregate totals: decrypted only here, after voting deadline
    /// - On-chain program enforces: only proposal authority can trigger this
    ///
    /// ## Returns
    /// `(yes_votes, no_votes, abstain_votes, total_votes)` in plaintext,
    /// delivered to the Solana program via `reveal_results_callback` CPI.
    #[instruction]
    pub fn finalize_and_reveal(state: Enc<Mxe, Tally>) -> (u64, u64, u64, u64) {
        let tally = state.reveal();
        (tally.yes, tally.no, tally.abstain, tally.total)
    }

    /// Query current vote count without revealing the YES/NO/ABSTAIN breakdown.
    ///
    /// Reveals ONLY the total participation count, keeping vote distribution
    /// secret. Useful for displaying progress bars without leaking interim results.
    #[instruction]
    pub fn get_vote_count(state: Enc<Mxe, Tally>) -> u64 {
        let tally = state.reveal();
        tally.total
    }

    /// Get live tally for Transparent Privacy mode (privacy_level = 2).
    ///
    /// Unlike `finalize_and_reveal`, this can be called during active voting
    /// to show running totals. Individual vote choices remain hidden — only
    /// aggregates are revealed. The on-chain program enforces that this is
    /// only invoked for proposals explicitly configured as Transparent.
    #[instruction]
    pub fn get_live_tally(state: Enc<Mxe, Tally>) -> (u64, u64, u64, u64) {
        let tally = state.reveal();
        (tally.yes, tally.no, tally.abstain, tally.total)
    }

    /// Finalize voting with quorum + threshold check.
    ///
    /// V2 execution engine: reveals aggregates AND checks governance rules.
    ///
    /// ## Arguments
    /// * `state` - Current encrypted tally
    /// * `quorum` - Minimum total votes required (plaintext, set at proposal creation)
    /// * `threshold_bps` - Required YES percentage in basis points (e.g., 6000 = 60%)
    ///
    /// ## Threshold Calculation
    /// - Abstain votes are excluded: `non_abstain = yes + no`
    /// - Passed = `(yes * 10_000) / non_abstain >= threshold_bps`
    /// - Both quorum AND threshold must be met for `passed = true`
    ///
    /// ## Returns
    /// `(yes, no, abstain, total, passed)` — the `passed` boolean is derived
    /// from now-public values (safe to branch on after reveal).
    #[instruction]
    pub fn finalize_with_threshold(
        state: Enc<Mxe, Tally>,
        quorum: u64,
        threshold_bps: u64,
    ) -> (u64, u64, u64, u64, bool) {
        let tally = state.reveal();

        let quorum_met = quorum == 0 || tally.total >= quorum;
        let non_abstain = tally.yes + tally.no;
        let threshold_met = non_abstain > 0 && (tally.yes * 10_000) / non_abstain >= threshold_bps;

        (
            tally.yes,
            tally.no,
            tally.abstain,
            tally.total,
            quorum_met && threshold_met,
        )
    }
}

// ==================== TESTS ====================

#[cfg(test)]
mod tests {
    use super::circuits::*;
    use arcis::testing::*;

    #[test]
    fn test_voting_flow() {
        let _ctx = TestContext::new();
        let mut state = initialize_voting();

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
        let _ctx = TestContext::new();
        let mut state = initialize_voting();

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
        let _ctx = TestContext::new();
        let state = initialize_voting();

        let (yes, no, abstain, total) = finalize_and_reveal(state);
        assert_eq!(yes, 0);
        assert_eq!(no, 0);
        assert_eq!(abstain, 0);
        assert_eq!(total, 0);
    }

    #[test]
    fn test_single_yes_vote() {
        let _ctx = TestContext::new();
        let mut state = initialize_voting();
        state = cast_vote(state, Enc::new(1u8));

        let (yes, no, abstain, total) = finalize_and_reveal(state);
        assert_eq!(yes, 1);
        assert_eq!(no, 0);
        assert_eq!(abstain, 0);
        assert_eq!(total, 1);
    }

    #[test]
    fn test_single_no_vote() {
        let _ctx = TestContext::new();
        let mut state = initialize_voting();
        state = cast_vote(state, Enc::new(0u8));

        let (yes, no, abstain, total) = finalize_and_reveal(state);
        assert_eq!(yes, 0);
        assert_eq!(no, 1);
        assert_eq!(abstain, 0);
        assert_eq!(total, 1);
    }

    #[test]
    fn test_all_yes() {
        let _ctx = TestContext::new();
        let mut state = initialize_voting();

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
        let _ctx = TestContext::new();
        let mut state = initialize_voting();

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
        let _ctx = TestContext::new();
        let mut state = initialize_voting();

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
        let _ctx = TestContext::new();
        let mut state = initialize_voting();

        for _ in 0..4 {
            state = cast_vote(state, Enc::new(1u8));
        }
        state = cast_vote(state, Enc::new(0u8));

        let count = get_vote_count(state);
        assert_eq!(count, 5);
    }

    #[test]
    fn test_get_live_tally() {
        let _ctx = TestContext::new();
        let mut state = initialize_voting();

        state = cast_vote(state, Enc::new(1u8)); // YES
        state = cast_vote(state, Enc::new(1u8)); // YES
        state = cast_vote(state, Enc::new(0u8)); // NO

        let (yes, no, abstain, total) = get_live_tally(state.clone());
        assert_eq!(yes, 2);
        assert_eq!(no, 1);
        assert_eq!(abstain, 0);
        assert_eq!(total, 3);

        state = cast_vote(state, Enc::new(2u8)); // ABSTAIN
        let (yes, no, abstain, total) = get_live_tally(state);
        assert_eq!(yes, 2);
        assert_eq!(no, 1);
        assert_eq!(abstain, 1);
        assert_eq!(total, 4);
    }

    #[test]
    fn test_finalize_with_threshold_passes() {
        let _ctx = TestContext::new();
        let mut state = initialize_voting();

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
        let _ctx = TestContext::new();
        let mut state = initialize_voting();

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
        let _ctx = TestContext::new();
        let mut state = initialize_voting();

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
        let _ctx = TestContext::new();
        let mut state = initialize_voting();

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
        let _ctx = TestContext::new();
        let mut state = initialize_voting();

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

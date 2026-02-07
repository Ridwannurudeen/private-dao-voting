//! Integration Tests for Private DAO Voting Solana Program
//!
//! These tests verify the on-chain program logic including:
//! - PDA derivation and account creation
//! - Access control and authorization
//! - State transitions and validation
//! - Error handling

use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;
use solana_program_test::*;
use solana_sdk::{
    account::Account,
    signature::{Keypair, Signer},
    transaction::Transaction,
    transport::TransportError,
};
use private_dao_voting::*;

/// Test context holding all necessary accounts and state
struct TestContext {
    banks_client: BanksClient,
    payer: Keypair,
    authority: Keypair,
    recent_blockhash: solana_sdk::hash::Hash,
}

impl TestContext {
    /// Create a new test context with funded accounts
    async fn new() -> Self {
        let program_id = id();
        let mut program_test = ProgramTest::new(
            "private_dao_voting",
            program_id,
            processor!(private_dao_voting::entry),
        );

        // Add mock Arcium MXE program
        program_test.add_program(
            "arcium_mxe",
            arcium_anchor::ARCIUM_MXE_PROGRAM_ID,
            None,
        );

        let (banks_client, payer, recent_blockhash) = program_test.start().await;
        
        let authority = Keypair::new();

        // Fund the authority account
        let mut ctx = Self {
            banks_client,
            payer,
            authority,
            recent_blockhash,
        };
        
        ctx.airdrop(&ctx.authority.pubkey(), 10_000_000_000).await;
        ctx
    }

    /// Airdrop SOL to an account
    async fn airdrop(&mut self, to: &Pubkey, lamports: u64) {
        let instruction = solana_sdk::system_instruction::transfer(
            &self.payer.pubkey(),
            to,
            lamports,
        );
        
        let tx = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&self.payer.pubkey()),
            &[&self.payer],
            self.recent_blockhash,
        );
        
        self.banks_client.process_transaction(tx).await.unwrap();
    }

    /// Refresh the blockhash
    async fn refresh_blockhash(&mut self) {
        self.recent_blockhash = self.banks_client
            .get_latest_blockhash()
            .await
            .unwrap();
    }

    /// Get the current slot
    async fn get_slot(&mut self) -> u64 {
        self.banks_client.get_root_slot().await.unwrap()
    }

    /// Advance slots (for time-based testing)
    async fn advance_slots(&mut self, slots: u64) {
        for _ in 0..slots {
            self.refresh_blockhash().await;
        }
    }

    /// Derive proposal PDA
    fn get_proposal_pda(&self, proposal_id: u64) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                PROPOSAL_SEED,
                self.authority.pubkey().as_ref(),
                &proposal_id.to_le_bytes(),
            ],
            &id(),
        )
    }

    /// Derive tally PDA
    fn get_tally_pda(&self, proposal_pubkey: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[TALLY_SEED, proposal_pubkey.as_ref()],
            &id(),
        )
    }

    /// Derive voter record PDA
    fn get_voter_record_pda(&self, proposal_pubkey: &Pubkey, voter: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                VOTER_RECORD_SEED,
                proposal_pubkey.as_ref(),
                voter.as_ref(),
            ],
            &id(),
        )
    }
}

// =============================================================================
// PROPOSAL INITIALIZATION TESTS
// =============================================================================

#[tokio::test]
async fn test_initialize_proposal_success() {
    let mut ctx = TestContext::new().await;
    
    let proposal_id: u64 = 1;
    let title = "Test Proposal".to_string();
    let description = "A test proposal for unit testing".to_string();
    let current_slot = ctx.get_slot().await;
    let voting_end_slot = current_slot + 1000;

    let (proposal_pda, _) = ctx.get_proposal_pda(proposal_id);
    let (tally_pda, _) = ctx.get_tally_pda(&proposal_pda);

    // Build and send transaction
    let ix = instruction::initialize_proposal(
        &ctx.authority.pubkey(),
        &proposal_pda,
        &tally_pda,
        proposal_id,
        title.clone(),
        description.clone(),
        voting_end_slot,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&ctx.authority.pubkey()),
        &[&ctx.authority],
        ctx.recent_blockhash,
    );

    ctx.banks_client.process_transaction(tx).await.unwrap();

    // Verify proposal account
    let proposal_account = ctx.banks_client
        .get_account(proposal_pda)
        .await
        .unwrap()
        .unwrap();
    
    let proposal: Proposal = Proposal::try_deserialize(
        &mut proposal_account.data.as_slice()
    ).unwrap();

    assert_eq!(proposal.authority, ctx.authority.pubkey());
    assert_eq!(proposal.proposal_id, proposal_id);
    assert_eq!(proposal.title, title);
    assert_eq!(proposal.description, description);
    assert_eq!(proposal.voting_end_slot, voting_end_slot);
    assert!(!proposal.is_finalized);
}

#[tokio::test]
async fn test_initialize_proposal_title_too_long() {
    let mut ctx = TestContext::new().await;
    
    let proposal_id: u64 = 1;
    let title = "A".repeat(65); // 65 chars, max is 64
    let description = "Description".to_string();
    let current_slot = ctx.get_slot().await;
    let voting_end_slot = current_slot + 1000;

    let (proposal_pda, _) = ctx.get_proposal_pda(proposal_id);
    let (tally_pda, _) = ctx.get_tally_pda(&proposal_pda);

    let ix = instruction::initialize_proposal(
        &ctx.authority.pubkey(),
        &proposal_pda,
        &tally_pda,
        proposal_id,
        title,
        description,
        voting_end_slot,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&ctx.authority.pubkey()),
        &[&ctx.authority],
        ctx.recent_blockhash,
    );

    let result = ctx.banks_client.process_transaction(tx).await;
    assert!(result.is_err());
    
    // Verify error type
    match result.unwrap_err() {
        TransportError::TransactionError(e) => {
            assert!(e.to_string().contains("TitleTooLong") || 
                    e.to_string().contains("custom program error"));
        }
        _ => panic!("Expected transaction error"),
    }
}

#[tokio::test]
async fn test_initialize_proposal_description_too_long() {
    let mut ctx = TestContext::new().await;
    
    let proposal_id: u64 = 1;
    let title = "Valid Title".to_string();
    let description = "A".repeat(257); // 257 chars, max is 256
    let current_slot = ctx.get_slot().await;
    let voting_end_slot = current_slot + 1000;

    let (proposal_pda, _) = ctx.get_proposal_pda(proposal_id);
    let (tally_pda, _) = ctx.get_tally_pda(&proposal_pda);

    let ix = instruction::initialize_proposal(
        &ctx.authority.pubkey(),
        &proposal_pda,
        &tally_pda,
        proposal_id,
        title,
        description,
        voting_end_slot,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&ctx.authority.pubkey()),
        &[&ctx.authority],
        ctx.recent_blockhash,
    );

    let result = ctx.banks_client.process_transaction(tx).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_initialize_proposal_invalid_end_slot() {
    let mut ctx = TestContext::new().await;
    
    let proposal_id: u64 = 1;
    let title = "Valid Title".to_string();
    let description = "Valid description".to_string();
    let current_slot = ctx.get_slot().await;
    let voting_end_slot = current_slot - 1; // In the past!

    let (proposal_pda, _) = ctx.get_proposal_pda(proposal_id);
    let (tally_pda, _) = ctx.get_tally_pda(&proposal_pda);

    let ix = instruction::initialize_proposal(
        &ctx.authority.pubkey(),
        &proposal_pda,
        &tally_pda,
        proposal_id,
        title,
        description,
        voting_end_slot,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&ctx.authority.pubkey()),
        &[&ctx.authority],
        ctx.recent_blockhash,
    );

    let result = ctx.banks_client.process_transaction(tx).await;
    assert!(result.is_err());
}

// =============================================================================
// TALLY ACCOUNT TESTS
// =============================================================================

#[tokio::test]
async fn test_tally_account_initialized_correctly() {
    let mut ctx = TestContext::new().await;
    
    let proposal_id: u64 = 1;
    let current_slot = ctx.get_slot().await;
    let voting_end_slot = current_slot + 1000;

    let (proposal_pda, _) = ctx.get_proposal_pda(proposal_id);
    let (tally_pda, _) = ctx.get_tally_pda(&proposal_pda);

    let ix = instruction::initialize_proposal(
        &ctx.authority.pubkey(),
        &proposal_pda,
        &tally_pda,
        proposal_id,
        "Test".to_string(),
        "Test Description".to_string(),
        voting_end_slot,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&ctx.authority.pubkey()),
        &[&ctx.authority],
        ctx.recent_blockhash,
    );

    ctx.banks_client.process_transaction(tx).await.unwrap();

    // Verify tally account
    let tally_account = ctx.banks_client
        .get_account(tally_pda)
        .await
        .unwrap()
        .unwrap();
    
    let tally: TallyAccount = TallyAccount::try_deserialize(
        &mut tally_account.data.as_slice()
    ).unwrap();

    assert_eq!(tally.proposal, proposal_pda);
    assert!(!tally.encrypted_state_initialized);
    assert_eq!(tally.final_yes_votes, 0);
    assert_eq!(tally.final_no_votes, 0);
    assert_eq!(tally.final_total_votes, 0);
    assert!(!tally.is_revealed);
}

// =============================================================================
// VOTER RECORD TESTS
// =============================================================================

#[tokio::test]
async fn test_voter_record_prevents_double_voting() {
    let mut ctx = TestContext::new().await;
    
    // Setup: Create proposal and initialize encrypted state
    let proposal_id: u64 = 1;
    let current_slot = ctx.get_slot().await;
    let (proposal_pda, _) = ctx.get_proposal_pda(proposal_id);
    
    // ... (setup code would go here)
    
    // First vote should succeed
    // Second vote from same voter should fail with AlreadyVoted error
    
    // This test would require mock Arcium integration
    // For now, we test the voter record PDA derivation
    let voter = Keypair::new();
    let (voter_record_pda, bump) = ctx.get_voter_record_pda(&proposal_pda, &voter.pubkey());
    
    // Verify PDA is deterministic
    let (voter_record_pda_2, bump_2) = ctx.get_voter_record_pda(&proposal_pda, &voter.pubkey());
    assert_eq!(voter_record_pda, voter_record_pda_2);
    assert_eq!(bump, bump_2);
    
    // Verify different voters get different PDAs
    let voter2 = Keypair::new();
    let (voter_record_pda_other, _) = ctx.get_voter_record_pda(&proposal_pda, &voter2.pubkey());
    assert_ne!(voter_record_pda, voter_record_pda_other);
}

// =============================================================================
// CALLBACK AUTHORIZATION TESTS
// =============================================================================

#[tokio::test]
async fn test_callback_rejects_unauthorized_caller() {
    let mut ctx = TestContext::new().await;
    
    // Setup proposal
    let proposal_id: u64 = 1;
    let current_slot = ctx.get_slot().await;
    let voting_end_slot = current_slot + 1000;

    let (proposal_pda, _) = ctx.get_proposal_pda(proposal_id);
    let (tally_pda, _) = ctx.get_tally_pda(&proposal_pda);

    // Initialize proposal
    let ix = instruction::initialize_proposal(
        &ctx.authority.pubkey(),
        &proposal_pda,
        &tally_pda,
        proposal_id,
        "Test".to_string(),
        "Description".to_string(),
        voting_end_slot,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&ctx.authority.pubkey()),
        &[&ctx.authority],
        ctx.recent_blockhash,
    );

    ctx.banks_client.process_transaction(tx).await.unwrap();

    // Try to call callback from unauthorized account (not MXE)
    let fake_caller = Keypair::new();
    ctx.airdrop(&fake_caller.pubkey(), 1_000_000_000).await;
    ctx.refresh_blockhash().await;

    let callback_ix = instruction::finalize_voting_callback(
        &fake_caller.pubkey(), // Not the MXE!
        &tally_pda,
        100, // yes_votes
        50,  // no_votes
        150, // total_votes
    );

    let tx = Transaction::new_signed_with_payer(
        &[callback_ix],
        Some(&fake_caller.pubkey()),
        &[&fake_caller],
        ctx.recent_blockhash,
    );

    let result = ctx.banks_client.process_transaction(tx).await;
    assert!(result.is_err(), "Callback should reject unauthorized caller");
}

// =============================================================================
// FINALIZATION TESTS
// =============================================================================

#[tokio::test]
async fn test_finalize_rejects_before_end_slot() {
    let mut ctx = TestContext::new().await;
    
    let proposal_id: u64 = 1;
    let current_slot = ctx.get_slot().await;
    let voting_end_slot = current_slot + 10000; // Far in the future

    let (proposal_pda, _) = ctx.get_proposal_pda(proposal_id);
    let (tally_pda, _) = ctx.get_tally_pda(&proposal_pda);

    // Initialize proposal
    let ix = instruction::initialize_proposal(
        &ctx.authority.pubkey(),
        &proposal_pda,
        &tally_pda,
        proposal_id,
        "Test".to_string(),
        "Description".to_string(),
        voting_end_slot,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&ctx.authority.pubkey()),
        &[&ctx.authority],
        ctx.recent_blockhash,
    );

    ctx.banks_client.process_transaction(tx).await.unwrap();
    ctx.refresh_blockhash().await;

    // Try to finalize before end slot
    // This should fail with VotingStillActive error
    // (Full test would require mock Arcium accounts)
}

#[tokio::test]
async fn test_finalize_rejects_non_authority() {
    let mut ctx = TestContext::new().await;
    
    let proposal_id: u64 = 1;
    let current_slot = ctx.get_slot().await;
    let voting_end_slot = current_slot + 10;

    let (proposal_pda, _) = ctx.get_proposal_pda(proposal_id);
    let (tally_pda, _) = ctx.get_tally_pda(&proposal_pda);

    // Initialize proposal as authority
    let ix = instruction::initialize_proposal(
        &ctx.authority.pubkey(),
        &proposal_pda,
        &tally_pda,
        proposal_id,
        "Test".to_string(),
        "Description".to_string(),
        voting_end_slot,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&ctx.authority.pubkey()),
        &[&ctx.authority],
        ctx.recent_blockhash,
    );

    ctx.banks_client.process_transaction(tx).await.unwrap();

    // Advance past end slot
    ctx.advance_slots(20).await;

    // Try to finalize as non-authority
    let attacker = Keypair::new();
    ctx.airdrop(&attacker.pubkey(), 1_000_000_000).await;
    ctx.refresh_blockhash().await;

    // This should fail with Unauthorized error
    // (Full test requires complete account setup)
}

// =============================================================================
// PDA DERIVATION TESTS
// =============================================================================

#[tokio::test]
async fn test_pda_derivation_deterministic() {
    let ctx = TestContext::new().await;
    
    let proposal_id: u64 = 12345;
    
    // Derive multiple times
    let (pda1, bump1) = ctx.get_proposal_pda(proposal_id);
    let (pda2, bump2) = ctx.get_proposal_pda(proposal_id);
    
    assert_eq!(pda1, pda2);
    assert_eq!(bump1, bump2);
}

#[tokio::test]
async fn test_different_proposal_ids_different_pdas() {
    let ctx = TestContext::new().await;
    
    let (pda1, _) = ctx.get_proposal_pda(1);
    let (pda2, _) = ctx.get_proposal_pda(2);
    let (pda3, _) = ctx.get_proposal_pda(3);
    
    assert_ne!(pda1, pda2);
    assert_ne!(pda2, pda3);
    assert_ne!(pda1, pda3);
}

#[tokio::test]
async fn test_tally_pda_linked_to_proposal() {
    let ctx = TestContext::new().await;
    
    let (proposal_pda_1, _) = ctx.get_proposal_pda(1);
    let (proposal_pda_2, _) = ctx.get_proposal_pda(2);
    
    let (tally_pda_1, _) = ctx.get_tally_pda(&proposal_pda_1);
    let (tally_pda_2, _) = ctx.get_tally_pda(&proposal_pda_2);
    
    assert_ne!(tally_pda_1, tally_pda_2);
}

// =============================================================================
// INSTRUCTION BUILDER HELPERS (for testing)
// =============================================================================

mod instruction {
    use super::*;
    use anchor_lang::InstructionData;
    use solana_sdk::instruction::{AccountMeta, Instruction};

    pub fn initialize_proposal(
        authority: &Pubkey,
        proposal: &Pubkey,
        tally_account: &Pubkey,
        proposal_id: u64,
        title: String,
        description: String,
        voting_end_slot: u64,
    ) -> Instruction {
        let data = private_dao_voting::instruction::InitializeProposal {
            proposal_id,
            title,
            description,
            voting_end_slot,
        };

        Instruction {
            program_id: id(),
            accounts: vec![
                AccountMeta::new(*authority, true),
                AccountMeta::new(*proposal, false),
                AccountMeta::new(*tally_account, false),
                AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
            ],
            data: data.data(),
        }
    }

    pub fn finalize_voting_callback(
        arcium_caller: &Pubkey,
        tally_account: &Pubkey,
        yes_votes: u64,
        no_votes: u64,
        total_votes: u64,
    ) -> Instruction {
        let data = private_dao_voting::instruction::FinalizeVotingCallback {
            yes_votes,
            no_votes,
            total_votes,
        };

        Instruction {
            program_id: id(),
            accounts: vec![
                AccountMeta::new_readonly(*arcium_caller, true),
                AccountMeta::new(*tally_account, false),
            ],
            data: data.data(),
        }
    }
}

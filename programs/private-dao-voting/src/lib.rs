//! Private DAO Voting - Solana Anchor Program
//!
//! This program manages the on-chain state and orchestrates
//! confidential computations via Arcium MXE.
//!
//! Location: programs/private-dao-voting/src/lib.rs

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

/// Computation definition names (must match encrypted-ixs)
pub const INIT_TALLY_COMP: &str = "init_tally";
pub const VOTE_COMP: &str = "vote";
pub const REVEAL_RESULT_COMP: &str = "reveal_result";

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
    ) -> Result<()> {
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
            None,
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
            None,
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
            None,
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
    /// Only callable by the Arcium program via CPI (validated by signer constraint)
    pub fn reveal_results_callback(
        ctx: Context<RevealResultsCallback>,
        yes_count: u64,
        no_count: u64,
        abstain_count: u64,
        total_votes: u64,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        proposal.is_active = false;
        proposal.is_revealed = true;
        proposal.yes_votes = yes_count;
        proposal.no_votes = no_count;
        proposal.abstain_votes = abstain_count;

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
        });

        Ok(())
    }

    /// Initialize computation definitions (called once at deployment)
    pub fn init_comp_def(
        _ctx: Context<InitCompDef>,
        _comp_def_data: Vec<u8>,
    ) -> Result<()> {
        // This is handled by Arcium SDK during deployment
        // Included here for completeness
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
    ) -> Result<()> {
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
        proposal.bump = ctx.bumps.proposal;

        emit!(ProposalCreated {
            proposal_id,
            authority: ctx.accounts.authority.key(),
            voting_ends_at,
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
        require!(ctx.accounts.proposal.is_active, VotingError::VotingClosed);

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp < ctx.accounts.proposal.voting_ends_at,
            VotingError::VotingEnded
        );

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
    pub fn dev_reveal_results(
        ctx: Context<DevRevealResults>,
        yes_count: u64,
        no_count: u64,
        abstain_count: u64,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;

        require!(
            ctx.accounts.authority.key() == proposal.authority,
            VotingError::Unauthorized
        );

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= proposal.voting_ends_at,
            VotingError::VotingNotEnded
        );

        proposal.is_active = false;
        proposal.is_revealed = true;
        proposal.yes_votes = yes_count;
        proposal.no_votes = no_count;
        proposal.abstain_votes = abstain_count;

        let total_votes = yes_count + no_count + abstain_count;
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
        });

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
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,

    #[account(
        init,
        payer = payer,
        space = 8 + Tally::INIT_SPACE,
        seeds = [TALLY_SEED, proposal.key().as_ref()],
        bump
    )]
    pub tally: Account<'info, Tally>,

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

    #[account(mut)]
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
        constraint = tally.proposal == proposal.key()
    )]
    pub tally: Account<'info, Tally>,

    /// Sign PDA: ensures this callback was invoked via Arcium CPI
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

    /// Sign PDA: ensures this callback was invoked via Arcium CPI
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

    #[account(mut)]
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

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DevRevealResults<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
}

// ==================== STATE ACCOUNTS ====================

#[account]
#[derive(InitSpace)]
pub struct Proposal {
    pub id: u64,
    pub authority: Pubkey,
    #[max_len(100)]
    pub title: String,
    #[max_len(500)]
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
pub struct ResultsRevealed {
    pub proposal: Pubkey,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub abstain_votes: u64,
    pub total_votes: u64,
    pub winner: u8,
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
}

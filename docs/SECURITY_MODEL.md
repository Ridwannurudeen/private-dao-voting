# Security Model

## Overview

Private DAO Voting provides confidential on-chain governance using Arcium MXE
(Multi-Party Computation eXecution Environment) with the Cerberus protocol.
This document describes the security guarantees, known limitations, and future
enhancement paths.

## Architecture

Votes are encrypted client-side using x25519 ECDH key exchange and RescueCipher,
then accumulated via MPC across the Arcium cluster. Individual votes are never
visible to any single party — the tally is computed in encrypted form and only
revealed via threshold decryption when the proposal authority triggers reveal.

## Threat Matrix

| Threat | Status | Mechanism |
|--------|--------|-----------|
| Vote content exposure | Protected | x25519 ECDH + RescueCipher + Cerberus MPC |
| Double voting | Protected | VoteRecord PDA per (proposal, voter) |
| Non-stakeholder voting | Protected | SPL token balance gating |
| Tally manipulation | Protected | MAC-authenticated secret shares in Cerberus |
| Front-running | Protected | Encrypted tally until explicit reveal |
| Callback forgery | Protected | Sign PDA signer constraint on all callbacks |
| Circuit tampering | Protected | circuit_hash! SHA-256 verification at init_comp_def |
| Quorum gaming | Protected | Configurable minimum vote count enforced in reveal |
| Threshold bypass | Protected | Basis-point threshold check with checked arithmetic |
| Vote buying | Partial | Votes encrypted, but voter can screenshot choice pre-submission |
| Social coercion | Partial | Vote is private, but participation is publicly visible on-chain |
| Sybil attacks | Delegated | Token gating (security depends on token distribution fairness) |

## Cerberus Protocol Guarantees

The Cerberus MPC protocol provides **dishonest-majority security**: computation
correctness and privacy are guaranteed as long as **at least one** Arx Node in the
MXE cluster remains honest. Even if N-1 of N nodes collude, they cannot:

- Learn any individual vote value
- Forge or manipulate the aggregate tally
- Bypass the threshold decryption requirement

MAC-authenticated secret shares detect tampering — honest nodes abort if cheating
is detected, preventing silent corruption of results.

## Encryption Types

| Type | Owner | Use | Decryption |
|------|-------|-----|------------|
| `Enc<Shared, u8>` | Voter | Individual vote choice | Only by MXE cluster during computation |
| `Enc<Mxe, Tally>` | MXE Cluster | Cumulative encrypted tally | Threshold decryption across Arx Nodes |

## Anti-Collusion Analysis

### Current State
Votes are encrypted and tallied via MPC — no validator or DAO authority sees
individual votes. However, the voter themselves knows their vote and could prove
it to a third party (e.g., by screenshotting their selection before submission).

### Comparison with MACI
MACI (Minimal Anti-Collusion Infrastructure) achieves receipt-free voting via key
rotation: voters can change their key after voting, invalidating any prior proof of
vote direction. This makes vote-buying unenforceable since the briber cannot verify
compliance.

### Future Enhancement Path
Arcium MXE could enable receipt-free voting via MPC-based key rotation — the voter
submits a key change request to the MXE, which re-encrypts their vote under the new
key without revealing the vote value. This would make Private DAO Voting the first
Solana project with MACI-equivalent anti-collusion guarantees.

### Comparison with Other Approaches

| Approach | Anti-Collusion | Privacy | Trust Model |
|----------|---------------|---------|-------------|
| MACI (Ethereum) | Strong (key rotation) | Full | Coordinator trust |
| Shutter Network | Moderate (time-lock) | Full | Threshold committee |
| Snapshot (off-chain) | None | None | Centralized |
| **Private DAO Voting** | Partial (no receipts) | Full | Dishonest-majority MPC |

## Delegation Security

Delegation is validated via PDA lookup: the delegation PDA is derived from the
delegator's public key and checked against remaining accounts. If an active
delegation exists, the delegator must revoke it before voting directly. This
prevents double-counting of voting power.

## V2 Roadmap (Security-Relevant)

- **Receipt-free voting** via MXE key rotation (MACI-equivalent)
- **Confidential execution payloads** (encrypted until vote passes)
- **Stake-to-propose deposit system** (anti-spam with slashing)
- **Privacy toggles** (Full / Partial / Transparent per proposal)

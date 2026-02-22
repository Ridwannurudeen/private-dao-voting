# Contributing to Private DAO Voting

Thanks for your interest in contributing! This project brings confidential governance to Solana using Arcium's MPC technology.

## Getting Started

1. **Fork and clone** the repository
2. Install prerequisites:
   - [Rust](https://rustup.rs/) + [Solana CLI](https://docs.solanalabs.com/cli/install) v1.18+
   - [Anchor](https://www.anchor-lang.com/docs/installation) v0.32.1
   - [Node.js](https://nodejs.org/) v18+
3. Build the project:
   ```bash
   anchor build
   cd frontend && npm install
   ```

## Project Structure

| Directory | What lives here |
|-----------|----------------|
| `arcis/voting-circuit/` | Arcis MPC circuit (Rust) — privacy logic |
| `programs/private-dao-voting/` | Anchor/Solana program — on-chain logic |
| `frontend/` | Next.js + Tailwind UI |
| `tests/` | Anchor integration tests |
| `scripts/` | Devnet setup utilities |

## Development Workflow

### Solana Program Changes

```bash
anchor build                       # compile
anchor test --skip-local-validator # run tests against devnet
```

### Frontend Changes

```bash
cd frontend
npm run dev     # start dev server at localhost:3000
npm run build   # production build (catches type errors)
npm run lint    # ESLint
```

### Arcis Circuit Changes

```bash
cd arcis/voting-circuit
cargo fmt       # format
cargo test      # run unit tests
```

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Ensure `anchor build` and `npm run build` pass before submitting
- Add tests for new on-chain instructions or circuit functions
- Follow existing code patterns and naming conventions

## Security Considerations

This is a privacy-focused project. When contributing, keep in mind:

- **Never call `.reveal()` on individual vote data** — only aggregate totals should be decrypted
- **No branching on encrypted values** in Arcis circuits — use constant-time `eq()` + `cast()` patterns
- **Token gating and PDA constraints** must remain enforced in all instruction paths
- **Validate at system boundaries** — user inputs, RPC responses, callback data

## Areas for Contribution

- Additional MPC circuit functions (e.g., weighted voting, ranked choice)
- Frontend accessibility improvements
- Test coverage for edge cases
- Documentation and examples
- Performance optimizations for large DAOs

## Questions?

Open an issue or start a discussion on GitHub.

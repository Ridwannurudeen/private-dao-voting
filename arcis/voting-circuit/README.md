# Voting Circuit

Arcis MPC circuit for confidential vote tallying.

## Build

```bash
arcis build
```

## Circuit Hash

After building, compute the circuit hash for on-chain verification:

```bash
sha256sum target/arcis/voting_circuit.so
```

Copy the hash to `programs/private-dao-voting/src/lib.rs`:

```rust
pub const CIRCUIT_HASH: &str = "<your-hash-here>";
```

### Source Hash Reference

The SHA-256 of the circuit source (`src/lib.rs`) is:

```
9f175fdae79a2f2d1da57ee9833d39dead99e1396e4ed75029d01cad8956bb71
```

This is **not** the circuit hash (which comes from the compiled `.so`), but can be
used as a reference to verify the source hasn't been modified since last build.

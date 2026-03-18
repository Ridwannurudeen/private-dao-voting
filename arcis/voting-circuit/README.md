# Voting Circuit

Arcis MPC circuit for confidential vote tallying.

## Build

```bash
arcis build
```

## Circuit Hash

The on-chain program's `CIRCUIT_HASH` constant is computed automatically at build time
by `programs/private-dao-voting/build.rs`. No manual copy-paste is needed.

The build script uses the following priority:

1. **Compiled binary** (`target/arcis/voting_circuit.so`) -- canonical hash matching
   `circuit_hash!("voting-circuit")` in this crate. Used when the circuit has been
   built with `arcis build`.
2. **Source code** (`src/lib.rs`) -- deterministic fallback for CI/dev builds without
   the Arcis toolchain. Same source always yields same hash.

### Verification

```bash
# After building, verify the compiled binary hash:
sha256sum target/arcis/voting_circuit.so

# Verify the source hash (dev/CI):
sha256sum src/lib.rs
# => 9f175fdae79a2f2d1da57ee9833d39dead99e1396e4ed75029d01cad8956bb71
```

### Source Hash Reference

The SHA-256 of the circuit source (`src/lib.rs`) is:

```
9f175fdae79a2f2d1da57ee9833d39dead99e1396e4ed75029d01cad8956bb71
```

This is the fallback hash used when no compiled `.so` exists. The on-chain program
will use this value during `init_comp_def` to verify circuit integrity.

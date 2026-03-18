//! Build script for private-dao-voting Solana program.
//!
//! Computes the SHA-256 hash of the Arcis voting circuit at build time and writes
//! it to `$OUT_DIR/circuit_hash.txt`. The on-chain program reads this via
//! `include_str!` to embed the hash as a compile-time constant.
//!
//! ## Hash Sources (in priority order)
//!
//! 1. **Compiled circuit binary** (`arcis/voting-circuit/target/arcis/voting_circuit.so`)
//!    Used when the circuit has been built with `arcis build`. This is the canonical
//!    hash that matches what `circuit_hash!("voting-circuit")` produces in the circuit
//!    crate, and what the MXE cluster verifies at runtime.
//!
//! 2. **Circuit source code** (`arcis/voting-circuit/src/lib.rs`)
//!    Fallback when no compiled binary exists (e.g., CI without Arcis toolchain).
//!    Deterministic and reproducible — same source always produces same hash.
//!    Must be replaced with the binary hash before mainnet deployment.
//!
//! ## Verification
//!
//! To manually verify the hash matches:
//!
//! ```bash
//! # If compiled binary exists (preferred):
//! sha256sum arcis/voting-circuit/target/arcis/voting_circuit.so
//!
//! # If using source hash (dev/CI):
//! sha256sum arcis/voting-circuit/src/lib.rs
//! ```

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    let out_dir = env::var("OUT_DIR").unwrap();
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();

    // Navigate from programs/private-dao-voting/ up to project root
    let project_root = Path::new(&manifest_dir)
        .parent() // programs/
        .and_then(|p| p.parent()) // project root
        .expect("Cannot find project root from CARGO_MANIFEST_DIR");

    // Priority 1: Compiled circuit binary (canonical hash)
    let compiled_binary = project_root
        .join("arcis")
        .join("voting-circuit")
        .join("target")
        .join("arcis")
        .join("voting_circuit.so");

    // Priority 2: Circuit source code (deterministic fallback)
    let circuit_source = project_root
        .join("arcis")
        .join("voting-circuit")
        .join("src")
        .join("lib.rs");

    let (hash, source_label) = if compiled_binary.exists() {
        let hash = sha256_file(&compiled_binary);
        // Re-run build script if the binary changes
        println!(
            "cargo:rerun-if-changed={}",
            compiled_binary.display()
        );
        (hash, "compiled-binary")
    } else if circuit_source.exists() {
        let hash = sha256_file(&circuit_source);
        // Re-run build script if the source changes
        println!(
            "cargo:rerun-if-changed={}",
            circuit_source.display()
        );
        (hash, "source-code")
    } else {
        panic!(
            "Cannot compute circuit hash: neither compiled binary ({}) \
             nor source ({}) found",
            compiled_binary.display(),
            circuit_source.display()
        );
    };

    // Write the hash to a file that lib.rs can include_str!
    let hash_path = PathBuf::from(&out_dir).join("circuit_hash.txt");
    fs::write(&hash_path, &hash).expect("Failed to write circuit_hash.txt");

    // Write the hash source label for diagnostics
    let label_path = PathBuf::from(&out_dir).join("circuit_hash_source.txt");
    fs::write(&label_path, source_label).expect("Failed to write circuit_hash_source.txt");

    // Emit as a cargo cfg for conditional compilation if needed
    println!("cargo:rustc-env=CIRCUIT_HASH_SOURCE={}", source_label);
}

/// Compute SHA-256 hex digest of a file.
///
/// Uses a pure-Rust implementation to avoid depending on external crates
/// in the build script (build scripts cannot use the crate's own dependencies).
fn sha256_file(path: &Path) -> String {
    let data = fs::read(path).unwrap_or_else(|e| {
        panic!("Failed to read {}: {}", path.display(), e);
    });
    sha256_digest(&data)
}

/// Pure-Rust SHA-256 implementation for build script use.
/// Follows FIPS 180-4 (no external dependencies needed).
fn sha256_digest(data: &[u8]) -> String {
    // Initial hash values (first 32 bits of fractional parts of square roots of first 8 primes)
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];

    // Round constants (first 32 bits of fractional parts of cube roots of first 64 primes)
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
        0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
        0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    // Pre-processing: pad the message
    let bit_len = (data.len() as u64) * 8;
    let mut padded = data.to_vec();
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0x00);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    // Process each 512-bit (64-byte) block
    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[4 * i],
                chunk[4 * i + 1],
                chunk[4 * i + 2],
                chunk[4 * i + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    // Produce hex digest
    h.iter()
        .map(|v| format!("{:08x}", v))
        .collect::<String>()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_empty() {
        // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        assert_eq!(
            sha256_digest(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn test_sha256_abc() {
        // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
        assert_eq!(
            sha256_digest(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn test_sha256_longer() {
        // SHA-256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")
        assert_eq!(
            sha256_digest(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }
}

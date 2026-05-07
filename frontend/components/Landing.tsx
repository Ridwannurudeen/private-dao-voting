import { useEffect, useMemo, useRef, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { ThemeToggle } from "./ThemeToggle";
import { PROGRAM_ID } from "../lib/contract";

/* =========================================================================
   Editorial-Cryptographic Landing
   No glass, no glow. Serif headline, mono ciphertext, live program proof.
   ========================================================================= */

const PROGRAM_ID_STR = PROGRAM_ID.toBase58();
const PROGRAM_ID_SHORT = `${PROGRAM_ID_STR.slice(0, 6)}…${PROGRAM_ID_STR.slice(-6)}`;
const EXPLORER_URL = `https://explorer.solana.com/address/${PROGRAM_ID_STR}?cluster=devnet`;

/* A reduced charset: hex-friendly + symbolic. Avoids ambiguous chars. */
const CIPHER_CHARS = "0123456789abcdef";

function useCipherResolve(target: string, opts?: { delayMs?: number; durationMs?: number }) {
  const [text, setText] = useState(() => obfuscate(target));
  const targetRef = useRef(target);
  const startedRef = useRef(false);

  useEffect(() => {
    targetRef.current = target;
    if (startedRef.current) return;
    startedRef.current = true;

    const delay = opts?.delayMs ?? 200;
    const duration = opts?.durationMs ?? 1800;
    const steps = 36;
    const interval = duration / steps;
    let step = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const start = () => {
      timer = setInterval(() => {
        step++;
        const progress = Math.min(1, step / steps);
        const t = targetRef.current;
        const out = t
          .split("")
          .map((ch, i) => {
            if (ch === " " || ch === "\n") return ch;
            const revealAt = Math.floor((i / Math.max(1, t.length - 1)) * steps * 0.85);
            if (step >= revealAt) return ch;
            return CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)];
          })
          .join("");
        setText(out);
        if (progress >= 1 && timer) {
          clearInterval(timer);
          setText(targetRef.current);
        }
      }, interval);
    };

    const t0 = setTimeout(start, delay);
    return () => {
      clearTimeout(t0);
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return text;
}

function obfuscate(s: string): string {
  return s
    .split("")
    .map((ch) => (ch === " " || ch === "\n" ? ch : CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)]))
    .join("");
}

const HEADLINE = "Governance the public can't read until it's decided.";

export default function Landing() {
  const headlineCipher = useCipherResolve(HEADLINE, { delayMs: 250, durationMs: 1900 });
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  const utc = useMemo(
    () =>
      now
        .toISOString()
        .replace("T", " ")
        .replace(/\..+$/, " UTC"),
    [now]
  );

  return (
    <>
      {/* ============== HEADER ============== */}
      <header className="sticky top-0 z-40" role="banner" style={{ background: "rgba(10, 10, 13, 0.88)", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--ink-3)" }}>
        <div className="max-w-6xl mx-auto h-14 flex items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <Mark />
            <div className="min-w-0 leading-tight">
              <div className="font-display text-paper-0 text-[15px] tracking-tighter">Private DAO Voting</div>
              <div className="h-meta hidden sm:block">arcium · solana · devnet</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <WalletMultiButton />
          </div>
        </div>
      </header>

      <main id="main-content" className="bg-page" role="main">
        {/* ============== HERO ============== */}
        <section className="relative">
          <div className="absolute inset-0 bg-dot-grid opacity-60 pointer-events-none" aria-hidden="true" />
          <div className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-20 sm:pt-32 pb-20 sm:pb-28">
            {/* eyebrow */}
            <div className="flex items-center gap-3 mb-10">
              <span className="seal-dot seal-dot-pulse" aria-hidden="true" />
              <span className="h-eyebrow">Token-gated governance · Solana devnet · v0.9.2</span>
            </div>

            {/* serif headline with cipher-resolve */}
            <h1 className="font-display text-paper-0 text-[40px] sm:text-[64px] lg:text-[84px] leading-[0.98] tracking-tightest max-w-5xl mb-10">
              <span className="block" style={{ wordBreak: "break-word" }}>
                <span aria-hidden="true">{headlineCipher.split(".")[0]}.</span>
                <span className="sr-only">{HEADLINE}</span>
              </span>
            </h1>

            {/* serif italic subtitle */}
            <p className="font-display italic text-paper-2 text-xl sm:text-2xl leading-snug max-w-3xl mb-12">
              Encrypted in your browser. Tallied by MPC inside Arcium. Only the aggregate ever reaches Solana.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-3 mb-16">
              <WalletMultiButton />
              <a
                href="https://www.loom.com/share/b7599bd310024a6cbef18e3b7fa0f70b"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
              >
                Watch the demo
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="7" y1="17" x2="17" y2="7" />
                  <polyline points="7 7 17 7 17 17" />
                </svg>
              </a>
              <a href="#observers" className="btn-ghost">How it works</a>
            </div>

            {/* live program proof strip */}
            <div className="panel">
              <div className="grid grid-cols-1 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x" style={{ borderColor: "var(--ink-3)" }}>
                <ProofCell label="Program">
                  <a className="font-mono text-[12px] text-paper-1 hover:text-seal" href={EXPLORER_URL} target="_blank" rel="noopener noreferrer" title={PROGRAM_ID_STR}>
                    {PROGRAM_ID_SHORT}
                  </a>
                </ProofCell>
                <ProofCell label="Network">
                  <span className="font-mono text-[12px] text-paper-1">solana · devnet</span>
                </ProofCell>
                <ProofCell label="Cluster">
                  <span className="font-mono text-[12px] text-paper-1">arcium · cerberus</span>
                </ProofCell>
                <ProofCell label="UTC">
                  <span className="font-mono text-[12px] text-paper-1">{utc}</span>
                </ProofCell>
              </div>
            </div>
          </div>
        </section>

        {/* ============== OBSERVERS PANEL ============== */}
        <section id="observers" className="border-t" style={{ borderColor: "var(--ink-3)" }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
            <div className="grid lg:grid-cols-12 gap-10 lg:gap-16">
              <div className="lg:col-span-4">
                <div className="section-label mb-3">§ 01 — Threat model</div>
                <h2 className="font-display text-paper-0 text-3xl sm:text-4xl tracking-tighter leading-tight mb-4">
                  What an observer can — and <span className="text-emphasis">cannot</span> — see.
                </h2>
                <p className="text-paper-2 text-[15px] leading-relaxed">
                  Public on-chain governance leaks more than people realize. Front-running bots, whales, and bandwagons all feed on
                  visible interim state. We removed it.
                </p>
              </div>
              <div className="lg:col-span-8 grid sm:grid-cols-2 gap-px" style={{ background: "var(--ink-3)" }}>
                <ObserverColumn
                  tone="neutral"
                  heading="Public ledger sees"
                  items={[
                    "A wallet cast a ballot",
                    "When the ballot was cast",
                    "The encrypted ciphertext",
                    "The proposal exists",
                  ]}
                />
                <ObserverColumn
                  tone="sealed"
                  heading="Stays sealed"
                  items={[
                    "How the wallet voted",
                    "The running tally",
                    "Partial / interim results",
                    "Any individual choice, ever",
                  ]}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ============== MECHANISM ============== */}
        <section className="border-t" style={{ borderColor: "var(--ink-3)" }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
            <div className="section-label mb-3">§ 02 — Mechanism</div>
            <h2 className="font-display text-paper-0 text-3xl sm:text-4xl tracking-tighter leading-tight mb-12 max-w-3xl">
              Four steps. Each one observable. None of them leak the vote.
            </h2>

            <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px" style={{ background: "var(--ink-3)" }}>
              <Step
                index="01"
                title="Encrypt"
                body="x25519 ECDH against the MXE cluster key. RescueCipher with a fresh nonce. Plaintext never leaves the browser."
              />
              <Step
                index="02"
                title="Submit"
                body="Anchor program writes the ciphertext to a per-voter PDA. Token-gated. Double-vote prevented by account uniqueness."
              />
              <Step
                index="03"
                title="Tally"
                body="Arcium MXE secret-shares votes across Arx Nodes. Tally accumulates inside MPC — no node sees plaintext."
              />
              <Step
                index="04"
                title="Reveal"
                body="After the deadline, threshold-decryption emits aggregate counts. Individual votes are never reconstructed."
              />
            </ol>
          </div>
        </section>

        {/* ============== TECHNICAL TRUTH STRIP ============== */}
        <section className="border-t" style={{ borderColor: "var(--ink-3)" }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12">
            <div className="flex flex-col sm:flex-row gap-6 sm:items-end justify-between">
              <div>
                <div className="section-label mb-3">§ 03 — Verification</div>
                <p className="font-display italic text-paper-1 text-xl sm:text-2xl leading-snug max-w-2xl">
                  Don&rsquo;t trust the marketing. Read the chain.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a href={EXPLORER_URL} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                  View program on explorer
                  <ArrowOut />
                </a>
                <a href="https://github.com/Ridwannurudeen/private-dao-voting" target="_blank" rel="noopener noreferrer" className="btn-secondary">
                  Source on GitHub
                  <ArrowOut />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ============== FOOT ============== */}
        <footer className="border-t" style={{ borderColor: "var(--ink-3)" }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10 flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
            <div className="flex items-center gap-3">
              <Mark />
              <span className="font-display text-paper-1 text-[15px] tracking-tighter">Private DAO Voting</span>
              <span className="h-meta">/ confidential governance</span>
            </div>
            <div className="h-meta">
              MIT · built on{" "}
              <a className="text-paper-1 hover:text-seal" href="https://arcium.com" target="_blank" rel="noopener noreferrer">arcium</a>
              {" · "}
              <a className="text-paper-1 hover:text-seal" href="https://solana.com" target="_blank" rel="noopener noreferrer">solana</a>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}

/* =========================================================================
   Sub-components
   ========================================================================= */

function Mark() {
  return (
    <div
      aria-hidden="true"
      className="shrink-0 flex items-center justify-center"
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        background: "var(--ink-2)",
        border: "1px solid var(--ink-4)",
        position: "relative",
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: 999, background: "var(--seal)", boxShadow: "0 0 0 2px var(--seal-soft)" }} />
    </div>
  );
}

function ProofCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4">
      <div className="h-eyebrow mb-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function ObserverColumn({
  tone,
  heading,
  items,
}: {
  tone: "neutral" | "sealed";
  heading: string;
  items: string[];
}) {
  const isSealed = tone === "sealed";
  return (
    <div
      className="p-7 sm:p-8"
      style={{
        background: isSealed ? "var(--ink-1)" : "var(--ink-1)",
      }}
    >
      <div className="flex items-center gap-2 mb-6">
        {isSealed ? (
          <span className="seal-dot" aria-hidden="true" />
        ) : (
          <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--steel)", boxShadow: "0 0 0 3px var(--steel-soft)" }} aria-hidden="true" />
        )}
        <div className="h-eyebrow">{heading}</div>
      </div>
      <ul className="space-y-3">
        {items.map((it, i) => (
          <li key={i} className="flex items-baseline gap-3">
            <span className="font-mono text-[10px] text-paper-3 mt-1 shrink-0" style={{ minWidth: 18 }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            {isSealed ? (
              <span className="font-display italic text-paper-1 text-[17px] sm:text-[18px] leading-snug">
                {it}
              </span>
            ) : (
              <span className="text-paper-1 text-[15px] leading-snug">{it}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Step({ index, title, body }: { index: string; title: string; body: string }) {
  return (
    <li className="p-7 sm:p-8" style={{ background: "var(--ink-1)" }}>
      <div className="flex items-baseline gap-3 mb-4">
        <span className="font-mono text-[11px] text-seal tracking-widest">{index}</span>
        <span className="hr-hair" style={{ width: 24 }} />
      </div>
      <div className="font-display text-paper-0 text-[22px] tracking-tighter mb-2">{title}</div>
      <p className="text-paper-2 text-[14px] leading-relaxed">{body}</p>
    </li>
  );
}

function ArrowOut() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

import { useEffect, useState } from "react";

interface Particle {
  id: number;
  x: number;
  y: number;
  char: string;
  delay: number;
}

const HEX_CHARS = "0123456789abcdef";

export function EncryptionAnimation({ active }: { active: boolean }) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (!active) { setParticles([]); return; }
    const generate = () => {
      const batch: Particle[] = Array.from({ length: 8 }, (_, i) => ({
        id: Date.now() + i,
        x: 10 + Math.random() * 80,
        y: -10,
        char: HEX_CHARS[Math.floor(Math.random() * 16)],
        delay: Math.random() * 0.5,
      }));
      setParticles((prev) => [...prev.slice(-24), ...batch]);
    };
    generate();
    const interval = setInterval(generate, 600);
    return () => clearInterval(interval);
  }, [active]);

  if (!active) return null;

  return (
    <div className="relative w-full h-32 overflow-hidden rounded-xl bg-slate-900/50 border border-cyan-500/20">
      {/* Particle field */}
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute text-cyan-400/80 font-mono text-xs animate-[encryptFall_1.2s_ease-in_forwards]"
          style={{ left: `${p.x}%`, animationDelay: `${p.delay}s` }}
        >
          {p.char}
        </span>
      ))}

      {/* Center lock icon */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center animate-pulse glow-cyan">
          <svg className="w-7 h-7 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
      </div>

      {/* Status text */}
      <div className="absolute bottom-2 inset-x-0 text-center">
        <span className="text-[10px] text-cyan-400/70 tracking-wider uppercase">Encrypting vote via MXE</span>
      </div>
    </div>
  );
}

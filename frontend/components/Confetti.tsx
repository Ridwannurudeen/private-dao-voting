import { useEffect, useState } from "react";

interface ConfettiPiece {
  id: number;
  x: number;
  color: string;
  delay: number;
  size: number;
  rotation: number;
}

const COLORS = ["#22d3ee", "#a78bfa", "#34d399", "#f472b6", "#facc15", "#60a5fa"];

export function Confetti({ active, onDone }: { active: boolean; onDone: () => void }) {
  const [pieces, setPieces] = useState<ConfettiPiece[]>([]);

  useEffect(() => {
    if (!active) return;
    const generated: ConfettiPiece[] = Array.from({ length: 40 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      delay: Math.random() * 0.8,
      size: 4 + Math.random() * 6,
      rotation: Math.random() * 360,
    }));
    setPieces(generated);
    const timer = setTimeout(() => { setPieces([]); onDone(); }, 2500);
    return () => clearTimeout(timer);
  }, [active, onDone]);

  if (pieces.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[60] pointer-events-none overflow-hidden">
      {pieces.map((p) => (
        <div
          key={p.id}
          className="absolute animate-[confettiFall_2s_ease-in_forwards]"
          style={{
            left: `${p.x}%`,
            top: "-5%",
            animationDelay: `${p.delay}s`,
          }}
        >
          <div
            style={{
              width: p.size,
              height: p.size * 1.5,
              background: p.color,
              borderRadius: "2px",
              transform: `rotate(${p.rotation}deg)`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

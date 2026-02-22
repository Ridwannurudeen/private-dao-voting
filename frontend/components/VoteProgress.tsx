import { useEffect, useState } from "react";
import { LockIcon, ShieldCheckIcon } from "./Icons";

export type VoteStep = "idle" | "encrypting" | "submitting" | "processing" | "confirmed";

interface VoteProgressProps {
  step: VoteStep;
  onComplete?: () => void;
}

const STEPS: { key: VoteStep; label: string; detail: string; pct: number }[] = [
  { key: "encrypting", label: "Encrypting", detail: "Encrypting your vote with x25519...", pct: 25 },
  { key: "submitting", label: "Submitting", detail: "Sending encrypted vote to Solana...", pct: 55 },
  { key: "processing", label: "MPC Processing", detail: "Arcium nodes processing across parties...", pct: 80 },
  { key: "confirmed", label: "Confirmed", detail: "Vote recorded!", pct: 100 },
];

export function VoteProgress({ step, onComplete }: VoteProgressProps) {
  const [animatedPct, setAnimatedPct] = useState(0);

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);
  const currentStep = currentStepIndex >= 0 ? STEPS[currentStepIndex] : null;

  useEffect(() => {
    if (!currentStep) {
      setAnimatedPct(0);
      return;
    }
    const timer = setTimeout(() => setAnimatedPct(currentStep.pct), 100);
    return () => clearTimeout(timer);
  }, [currentStep]);

  useEffect(() => {
    if (step === "confirmed" && onComplete) {
      const timer = setTimeout(onComplete, 2000);
      return () => clearTimeout(timer);
    }
  }, [step, onComplete]);

  if (step === "idle" || !currentStep) return null;

  return (
    <div className="space-y-3 mt-2">
      {/* Progress bar */}
      <div className="h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${animatedPct}%`,
            background: step === "confirmed"
              ? "linear-gradient(90deg, #10b981, #06b6d4)"
              : "linear-gradient(90deg, #7c3aed, #06b6d4)",
          }}
        />
      </div>

      {/* Step indicators */}
      <div className="flex justify-between">
        {STEPS.map((s, i) => {
          const isActive = i === currentStepIndex;
          const isDone = i < currentStepIndex;
          return (
            <div key={s.key} className="flex flex-col items-center gap-1">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300 ${
                  isDone
                    ? "bg-cyan-500/20 border border-cyan-500/50"
                    : isActive
                    ? "bg-purple-500/20 border-2 border-purple-500 animate-pulse"
                    : "bg-white/5 border border-white/10"
                }`}
              >
                {isDone ? (
                  <svg className="w-3 h-3 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : isActive ? (
                  i === 0 ? <LockIcon className="w-3 h-3 text-purple-400" /> :
                  i === 3 ? <ShieldCheckIcon className="w-3 h-3 text-green-400" /> :
                  <div className="w-2 h-2 rounded-full bg-purple-400 animate-ping" />
                ) : (
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                )}
              </div>
              <span className={`text-[9px] ${isActive ? "text-cyan-400 font-medium" : isDone ? "text-cyan-400/50" : "text-gray-600"}`}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Current step detail */}
      <div className="flex items-center justify-center gap-2">
        {step !== "confirmed" && (
          <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
        )}
        <span className={`text-xs ${step === "confirmed" ? "text-green-400 font-medium" : "text-gray-400"}`}>
          {currentStep.detail}
        </span>
      </div>
    </div>
  );
}

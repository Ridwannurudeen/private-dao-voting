import { useState, useEffect } from "react";
import {
  ArciumClient,
  ArciumStatusEvent,
  DEVELOPMENT_MODE,
  MXE_PROGRAM_ID,
  DEVNET_CLUSTER_OFFSET,
  getMempoolCapacity,
  getCircuitHash,
  CIRCUIT_INSTRUCTIONS,
  CERBERUS_INFO,
  MempoolCapacity,
} from "../lib/arcium";

interface DeveloperConsoleProps {
  arciumClient: ArciumClient | null;
}

const CAPACITY_COLORS: Record<MempoolCapacity, string> = {
  Tiny: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  Small: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  Medium: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  Large: "text-green-400 bg-green-500/10 border-green-500/20",
};

export function DeveloperConsole({ arciumClient }: DeveloperConsoleProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ArciumStatusEvent | null>(null);
  const [tab, setTab] = useState<"config" | "circuit" | "security">("config");

  useEffect(() => {
    if (!arciumClient) return;
    const unsub = arciumClient.onStatusChange((event: ArciumStatusEvent) => {
      setStatus(event);
    });
    return unsub;
  }, [arciumClient]);

  const clusterInfo = arciumClient?.getClusterInfo() ?? {
    offset: DEVNET_CLUSTER_OFFSET.toString(),
    programId: MXE_PROGRAM_ID,
    connected: false,
  };

  const capacity = getMempoolCapacity();
  const circuitHash = getCircuitHash();

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 w-10 h-10 rounded-xl bg-gray-900/90 border border-white/10 flex items-center justify-center hover:border-cyan-500/30 hover:bg-gray-800/90 transition-all group"
        title="Developer Console"
      >
        <span className="text-gray-500 group-hover:text-cyan-400 transition-colors font-mono text-sm">
          {"</>"}
        </span>
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-[72px] right-6 z-50 w-[420px] max-h-[70vh] overflow-hidden rounded-2xl border border-white/10 bg-gray-950/95 backdrop-blur-xl shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-xs font-semibold text-white">
                Developer Console
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500">
                {DEVELOPMENT_MODE ? "DEV" : "PROD"}
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-500 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-white/5">
            {(["config", "circuit", "security"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 px-3 py-2 text-[10px] uppercase tracking-wider transition-colors ${
                  tab === t
                    ? "text-cyan-400 border-b-2 border-cyan-400"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="overflow-y-auto max-h-[50vh] p-4 space-y-3">
            {tab === "config" && (
              <>
                {/* MXE Program ID */}
                <Field
                  label="MXE Program ID"
                  value={
                    DEVELOPMENT_MODE
                      ? "Not set (Dev Mode)"
                      : MXE_PROGRAM_ID ?? "—"
                  }
                  mono={!DEVELOPMENT_MODE}
                  status={DEVELOPMENT_MODE ? "warning" : "ok"}
                />

                {/* Cluster Offset */}
                <Field
                  label="Cluster Offset"
                  value={clusterInfo.offset}
                  mono
                  status="ok"
                />

                {/* Mempool Capacity */}
                <div className="space-y-1">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Mempool Capacity
                  </span>
                  <div className="flex gap-2">
                    {(["Tiny", "Small", "Medium", "Large"] as const).map(
                      (c) => (
                        <span
                          key={c}
                          className={`text-[10px] px-2 py-1 rounded-lg border ${
                            c === capacity
                              ? CAPACITY_COLORS[c]
                              : "text-gray-600 bg-white/[0.02] border-white/5"
                          }`}
                        >
                          {c}
                        </span>
                      )
                    )}
                  </div>
                </div>

                {/* Connection Status */}
                <Field
                  label="MXE Connection"
                  value={clusterInfo.connected ? "Connected" : "Disconnected"}
                  status={clusterInfo.connected ? "ok" : "error"}
                />

                {/* Computation Status */}
                {status && (
                  <div className="space-y-1">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                      Computation Status
                    </span>
                    <div className="flex items-center gap-2">
                      <StatusDot status={status.status} />
                      <span className="text-xs text-gray-300 font-mono">
                        {status.status}
                      </span>
                    </div>
                    {status.message && (
                      <p className="text-[10px] text-gray-500">
                        {status.message}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {tab === "circuit" && (
              <>
                {/* Circuit Hash */}
                <div className="space-y-1">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Circuit Hash (SHA-256)
                  </span>
                  <div className="bg-white/[0.03] border border-white/5 rounded-lg p-2">
                    <code className="text-[10px] text-cyan-400/80 font-mono break-all">
                      {circuitHash}
                    </code>
                  </div>
                  <p className="text-[9px] text-gray-600">
                    Embedded via circuit_hash! macro at compile time. Verifies
                    MPC logic hasn't been tampered with.
                  </p>
                </div>

                {/* Encryption Types */}
                <div className="space-y-2">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Encryption Types
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white/[0.03] border border-cyan-500/10 rounded-lg p-2.5">
                      <code className="text-[10px] text-cyan-400 font-mono">
                        {"Enc<Shared, u8>"}
                      </code>
                      <p className="text-[9px] text-gray-500 mt-1">
                        Individual votes. Client-encrypted via x25519 ECDH.
                      </p>
                    </div>
                    <div className="bg-white/[0.03] border border-purple-500/10 rounded-lg p-2.5">
                      <code className="text-[10px] text-purple-400 font-mono">
                        {"Enc<Mxe, Tally>"}
                      </code>
                      <p className="text-[9px] text-gray-500 mt-1">
                        Cumulative tally. Cluster-owned, threshold decryption.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Circuit Instructions */}
                <div className="space-y-1.5">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Registered Instructions ({CIRCUIT_INSTRUCTIONS.length})
                  </span>
                  <div className="space-y-1">
                    {CIRCUIT_INSTRUCTIONS.map((name) => (
                      <div
                        key={name}
                        className="flex items-center gap-2 px-2.5 py-1.5 bg-white/[0.02] rounded-lg"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                        <code className="text-[10px] text-gray-300 font-mono">
                          {name}
                        </code>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {tab === "security" && (
              <>
                {/* Cerberus Badge */}
                <div className="bg-gradient-to-br from-purple-500/10 to-cyan-500/5 border border-purple-500/20 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg
                      className="w-5 h-5 text-purple-400"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    <span className="text-sm font-semibold text-purple-300">
                      {CERBERUS_INFO.name} Protocol
                    </span>
                  </div>
                  <span className="inline-block text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/20 mb-2">
                    {CERBERUS_INFO.securityModel}
                  </span>
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    {CERBERUS_INFO.guarantee}. Even if {CERBERUS_INFO.tolerance},{" "}
                    they cannot learn individual votes or forge the tally.
                  </p>
                </div>

                {/* Security Properties */}
                <div className="space-y-2">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Security Properties
                  </span>
                  {[
                    {
                      label: "Input Privacy",
                      desc: "Individual votes secret-shared across Arx Nodes",
                      color: "text-cyan-400",
                    },
                    {
                      label: "Computation Integrity",
                      desc: CERBERUS_INFO.mechanism,
                      color: "text-purple-400",
                    },
                    {
                      label: "Output Privacy",
                      desc: "Only aggregate totals revealed via threshold decryption",
                      color: "text-emerald-400",
                    },
                    {
                      label: "Circuit Integrity",
                      desc: "circuit_hash! verifies bytecode hasn't been modified",
                      color: "text-blue-400",
                    },
                    {
                      label: "Double-Vote Prevention",
                      desc: "VoteRecord PDA enforces one vote per wallet per proposal",
                      color: "text-yellow-400",
                    },
                  ].map((prop) => (
                    <div
                      key={prop.label}
                      className="flex items-start gap-2 px-3 py-2 bg-white/[0.02] rounded-lg"
                    >
                      <span
                        className={`text-[10px] font-medium ${prop.color} shrink-0 mt-0.5`}
                      >
                        {prop.label}
                      </span>
                      <span className="text-[10px] text-gray-500">
                        {prop.desc}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Data-in-Use Privacy */}
                <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3">
                  <span className="text-[10px] text-cyan-400 font-medium uppercase tracking-wider">
                    Data-in-Use Privacy
                  </span>
                  <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                    Unlike traditional encryption (data at rest / in transit),
                    Arcium MXE provides{" "}
                    <span className="text-gray-300">data-in-use privacy</span>{" "}
                    — votes remain encrypted even during computation. The MXE
                    performs arithmetic directly on secret-shared values without
                    ever reconstructing the plaintext.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ==================== SUB-COMPONENTS ====================

function Field({
  label,
  value,
  mono = false,
  status,
}: {
  label: string;
  value: string;
  mono?: boolean;
  status?: "ok" | "warning" | "error";
}) {
  const statusColors = {
    ok: "text-green-400",
    warning: "text-yellow-400",
    error: "text-red-400",
  };

  return (
    <div className="space-y-1">
      <span className="text-[10px] text-gray-500 uppercase tracking-wider">
        {label}
      </span>
      <div className="flex items-center gap-2">
        {status && (
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              status === "ok"
                ? "bg-green-400"
                : status === "warning"
                ? "bg-yellow-400"
                : "bg-red-400"
            }`}
          />
        )}
        <span
          className={`text-xs ${
            status ? statusColors[status] : "text-gray-300"
          } ${mono ? "font-mono" : ""} truncate`}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    IDLE: "bg-gray-400",
    ENCRYPTING: "bg-yellow-400 animate-pulse",
    PENDING_SUBMISSION: "bg-yellow-400",
    SUBMITTED_TO_CLUSTER: "bg-blue-400 animate-pulse",
    PROCESSING: "bg-purple-400 animate-pulse",
    READY_TO_REVEAL: "bg-cyan-400",
    REVEALED: "bg-green-400",
    ERROR: "bg-red-400",
  };

  return (
    <span className={`w-2 h-2 rounded-full ${colors[status] || "bg-gray-400"}`} />
  );
}

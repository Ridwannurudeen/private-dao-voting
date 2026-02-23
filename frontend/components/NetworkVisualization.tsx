import { useEffect, useRef } from "react";

interface NetworkVisualizationProps {
  isConnected: boolean;
  nodeCount?: number;
}

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export function NetworkVisualization({ isConnected, nodeCount = 7 }: NetworkVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Initialize nodes
    if (nodesRef.current.length === 0) {
      nodesRef.current = Array.from({ length: nodeCount }, () => ({
        x: Math.random() * (w - 40) + 20,
        y: Math.random() * (h - 40) + 20,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        radius: 3 + Math.random() * 2,
      }));
    }

    let time = 0;

    function animate() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, w, h);
      time += 0.01;

      const nodes = nodesRef.current;

      // Update positions
      for (const node of nodes) {
        if (isConnected) {
          node.x += node.vx;
          node.y += node.vy;

          // Bounce off edges
          if (node.x < 15 || node.x > w - 15) node.vx *= -1;
          if (node.y < 15 || node.y > h - 15) node.vy *= -1;

          node.x = Math.max(15, Math.min(w - 15, node.x));
          node.y = Math.max(15, Math.min(h - 15, node.y));
        }
      }

      // Draw connections
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 120) {
            const alpha = isConnected
              ? (1 - dist / 120) * 0.4 * (0.7 + 0.3 * Math.sin(time * 2 + i + j))
              : (1 - dist / 120) * 0.1;

            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = isConnected
              ? `rgba(34, 211, 238, ${alpha})`
              : `rgba(100, 100, 120, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      // Draw nodes
      for (const node of nodes) {
        // Outer glow
        if (isConnected) {
          const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.radius * 4);
          glow.addColorStop(0, "rgba(34, 211, 238, 0.15)");
          glow.addColorStop(1, "rgba(34, 211, 238, 0)");
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius * 4, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        // Node dot
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = isConnected ? "rgba(34, 211, 238, 0.8)" : "rgba(100, 100, 120, 0.5)";
        ctx.fill();
      }

      frameRef.current = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
    };
  }, [isConnected, nodeCount]);

  return (
    <div className="glass-card-elevated overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-white">Live Arcium Network</h3>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-cyan-400 animate-pulse" : "bg-gray-600"}`} />
          <span className="text-[10px] text-gray-500">{nodeCount} nodes</span>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={288}
        height={180}
        className="w-full"
        style={{ imageRendering: "auto" }}
      />
    </div>
  );
}

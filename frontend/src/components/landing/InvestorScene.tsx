"use client";

import { Canvas } from "@react-three/fiber";
import { Environment, ScrollControls, Scroll } from "@react-three/drei";
import { Suspense, useState } from "react";
import InvestorOverlay from "./InvestorOverlay";
import InvestorDemo from "./InvestorDemo";

interface InvestorSceneProps {
  onStart: () => void;
}

export default function InvestorScene({ onStart }: InvestorSceneProps) {
  const [scrollProgress, setScrollProgress] = useState(0);

  return (
    <div
      className="fixed inset-0 w-full h-full"
      style={{
        background: scrollProgress < 0.3
          ? "radial-gradient(circle at center, #1a052b 0%, #000000 100%)"
          : "radial-gradient(circle at center, #0d0118 0%, #000000 100%)",
        transition: "background 1s ease-out",
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 8], fov: 50 }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          toneMapping: 3,
          toneMappingExposure: 1.2,
        }}
        dpr={[1, 2]}
      >
        <color attach="background" args={["#000000"]} />

        <Suspense fallback={null}>
          <Environment preset="studio" background={false} blur={0.8} />

          <ScrollControls pages={2} damping={0.15}>
            <InvestorDemo onScrollProgress={setScrollProgress} />

            <Scroll html style={{ width: "100%" }}>
              <InvestorOverlay scrollProgress={scrollProgress} onStart={onStart} />
            </Scroll>
          </ScrollControls>
        </Suspense>
      </Canvas>

      {/* CSS bloom glow */}
      <div
        className="fixed inset-0 pointer-events-none transition-opacity duration-1000"
        style={{
          opacity: scrollProgress > 0.5 ? 1 : 0,
          background: "radial-gradient(circle at center, rgba(124,58,237,0.12) 0%, transparent 50%)",
          filter: "blur(80px)",
        }}
      />

      {/* Deep vignette */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.7) 100%)",
        }}
      />

      {/* Scroll indicator */}
      <div
        className="fixed bottom-8 left-1/2 -translate-x-1/2 pointer-events-none transition-opacity duration-500"
        style={{ opacity: scrollProgress < 0.1 ? 1 : 0 }}
      >
        <div className="flex flex-col items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.3em] text-white/30 uppercase">
            Scroll
          </span>
          <div
            className="w-px h-8 animate-pulse"
            style={{
              background: "linear-gradient(to bottom, rgba(167,139,250,0.6), transparent)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

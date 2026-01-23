"use client";

import { useEffect, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

export default function TestAnimejsPage() {
  const [activeDemo, setActiveDemo] = useState<string>("svg-draw");
  const containerRef = useRef<HTMLDivElement>(null);
  const [animeModule, setAnimeModule] = useState<any>(null);
  const [status, setStatus] = useState<string>("Loading Anime.js...");

  // Dynamically import anime.js (it's ESM)
  useEffect(() => {
    import("animejs").then((mod) => {
      setAnimeModule(mod);
      setStatus("Ready");
    }).catch((err) => {
      setStatus(`Error loading: ${err.message}`);
    });
  }, []);

  // Demo 1: SVG Path Drawing
  const runSvgDrawDemo = () => {
    if (!animeModule || !containerRef.current) return;
    const { animate, svg, stagger } = animeModule;

    containerRef.current.innerHTML = `
      <svg viewBox="0 0 400 200" width="400" height="200" style="background: #1a1a2e;">
        <path
          class="draw-path"
          d="M 50 100 Q 100 50 150 100 T 250 100 T 350 100"
          fill="none"
          stroke="#00d9ff"
          stroke-width="3"
          stroke-linecap="round"
        />
        <path
          class="draw-path"
          d="M 50 150 L 350 150"
          fill="none"
          stroke="#ff6b6b"
          stroke-width="2"
        />
        <circle class="draw-path" cx="200" cy="100" r="30" fill="none" stroke="#4ecdc4" stroke-width="2"/>
      </svg>
    `;

    const drawables = svg.createDrawable(".draw-path");
    animate(drawables, {
      draw: ["0 0", "0 1"],
      ease: "inOutQuad",
      duration: 2000,
      delay: stagger(300),
    });
  };

  // Demo 2: Text Character Animation
  const runTextDemo = () => {
    if (!animeModule || !containerRef.current) return;
    const { animate, splitText, stagger, createTimeline } = animeModule;

    containerRef.current.innerHTML = `
      <div style="font-family: system-ui; font-size: 32px; color: white; text-align: center; padding: 40px; background: #1a1a2e;">
        <p class="animate-text">Stoichiometry</p>
      </div>
    `;

    const { chars } = splitText(".animate-text", { chars: true });

    animate(chars, {
      opacity: [0, 1],
      y: [20, 0],
      ease: "outExpo",
      duration: 800,
      delay: stagger(50),
    });
  };

  // Demo 3: Math Equation with KaTeX + Animation
  const runMathDemo = () => {
    if (!animeModule || !containerRef.current) return;
    const { animate, stagger } = animeModule;

    // Render KaTeX to HTML
    const latex = "2H_2 + O_2 \\rightarrow 2H_2O";
    const mathHtml = katex.renderToString(latex, {
      throwOnError: false,
      output: "html"
    });

    containerRef.current.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; min-height: 200px; background: #1a1a2e; padding: 40px;">
        <div class="math-container" style="font-size: 48px; color: white;">
          ${mathHtml}
        </div>
      </div>
    `;

    // Animate individual spans within KaTeX output
    const spans = containerRef.current.querySelectorAll(".katex-html .mord, .katex-html .mbin, .katex-html .mrel");

    animate(spans, {
      opacity: [0, 1],
      scale: [0.5, 1],
      ease: "outElastic(1, 0.5)",
      duration: 1000,
      delay: stagger(100),
    });
  };

  // Demo 4: SVG Equation Writing (more Manim-like)
  const runSvgMathDemo = () => {
    if (!animeModule || !containerRef.current) return;
    const { animate, svg, stagger } = animeModule;

    // Hand-drawn style "E = mc²" as SVG paths
    containerRef.current.innerHTML = `
      <svg viewBox="0 0 500 150" width="500" height="150" style="background: #1a1a2e;">
        <!-- E -->
        <path class="equation-path" d="M 30 30 L 30 120 M 30 30 L 80 30 M 30 75 L 70 75 M 30 120 L 80 120"
          fill="none" stroke="#00d9ff" stroke-width="4" stroke-linecap="round"/>
        <!-- = -->
        <path class="equation-path" d="M 110 55 L 160 55 M 110 95 L 160 95"
          fill="none" stroke="#00d9ff" stroke-width="4" stroke-linecap="round"/>
        <!-- m -->
        <path class="equation-path" d="M 190 120 L 190 70 Q 190 50 210 50 Q 230 50 230 70 L 230 120 M 230 70 Q 230 50 250 50 Q 270 50 270 70 L 270 120"
          fill="none" stroke="#4ecdc4" stroke-width="4" stroke-linecap="round"/>
        <!-- c -->
        <path class="equation-path" d="M 330 70 Q 300 70 300 95 Q 300 120 330 120"
          fill="none" stroke="#4ecdc4" stroke-width="4" stroke-linecap="round"/>
        <!-- ² (superscript 2) -->
        <path class="equation-path" d="M 350 30 Q 350 20 360 20 Q 370 20 370 30 Q 370 40 350 50 L 375 50"
          fill="none" stroke="#ff6b6b" stroke-width="3" stroke-linecap="round"/>
      </svg>
    `;

    const drawables = svg.createDrawable(".equation-path");
    animate(drawables, {
      draw: ["0 0", "0 1"],
      ease: "inOutQuad",
      duration: 1500,
      delay: stagger(400),
    });
  };

  // Demo 5: Morphing Shapes
  const runMorphDemo = () => {
    if (!animeModule || !containerRef.current) return;
    const { animate, svg } = animeModule;

    containerRef.current.innerHTML = `
      <svg viewBox="0 0 400 200" width="400" height="200" style="background: #1a1a2e;">
        <path
          class="morph-shape"
          d="M 100 100 L 150 50 L 200 100 L 150 150 Z"
          fill="#4ecdc4"
        />
        <path
          id="target-circle"
          d="M 100 100 A 50 50 0 1 1 100 99.9 Z"
          fill="none"
          style="display: none;"
        />
        <path
          id="target-star"
          d="M 150 50 L 165 90 L 210 90 L 175 115 L 190 155 L 150 130 L 110 155 L 125 115 L 90 90 L 135 90 Z"
          fill="none"
          style="display: none;"
        />
      </svg>
    `;

    const morphTargets = ["#target-circle", "#target-star", ".morph-shape"];
    let currentIndex = 0;

    const morphNext = () => {
      const nextIndex = (currentIndex + 1) % morphTargets.length;
      animate(".morph-shape", {
        d: svg.morphTo(morphTargets[nextIndex]),
        fill: ["#4ecdc4", "#ff6b6b", "#00d9ff"][nextIndex],
        duration: 1000,
        ease: "inOutQuad",
      });
      currentIndex = nextIndex;
    };

    // Auto-morph every 2 seconds
    morphNext();
    const interval = setInterval(morphNext, 2000);

    // Store interval for cleanup
    (containerRef.current as any)._morphInterval = interval;
  };

  // Demo 6: Staggered Diagram
  const runDiagramDemo = () => {
    if (!animeModule || !containerRef.current) return;
    const { animate, stagger, svg } = animeModule;

    containerRef.current.innerHTML = `
      <svg viewBox="0 0 500 250" width="500" height="250" style="background: #1a1a2e;">
        <!-- Boxes -->
        <rect class="diagram-box" x="50" y="100" width="80" height="50" rx="8" fill="#4ecdc4" opacity="0"/>
        <rect class="diagram-box" x="210" y="100" width="80" height="50" rx="8" fill="#00d9ff" opacity="0"/>
        <rect class="diagram-box" x="370" y="100" width="80" height="50" rx="8" fill="#ff6b6b" opacity="0"/>

        <!-- Arrows -->
        <path class="diagram-arrow" d="M 135 125 L 200 125" fill="none" stroke="white" stroke-width="2" marker-end="url(#arrowhead)"/>
        <path class="diagram-arrow" d="M 295 125 L 360 125" fill="none" stroke="white" stroke-width="2" marker-end="url(#arrowhead)"/>

        <!-- Arrow marker -->
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="white"/>
          </marker>
        </defs>

        <!-- Labels -->
        <text class="diagram-label" x="90" y="130" fill="white" text-anchor="middle" font-family="system-ui" font-size="14" opacity="0">Input</text>
        <text class="diagram-label" x="250" y="130" fill="white" text-anchor="middle" font-family="system-ui" font-size="14" opacity="0">Process</text>
        <text class="diagram-label" x="410" y="130" fill="white" text-anchor="middle" font-family="system-ui" font-size="14" opacity="0">Output</text>
      </svg>
    `;

    // Animate boxes appearing
    animate(".diagram-box", {
      opacity: [0, 1],
      scale: [0.8, 1],
      ease: "outElastic(1, 0.5)",
      duration: 800,
      delay: stagger(200),
    });

    // Animate arrows drawing
    setTimeout(() => {
      const drawables = svg.createDrawable(".diagram-arrow");
      animate(drawables, {
        draw: ["0 0", "0 1"],
        ease: "inOutQuad",
        duration: 600,
        delay: stagger(200),
      });
    }, 800);

    // Animate labels
    setTimeout(() => {
      animate(".diagram-label", {
        opacity: [0, 1],
        y: [10, 0],
        ease: "outExpo",
        duration: 500,
        delay: stagger(100),
      });
    }, 1400);
  };

  // Cleanup interval on demo change
  useEffect(() => {
    return () => {
      if (containerRef.current && (containerRef.current as any)._morphInterval) {
        clearInterval((containerRef.current as any)._morphInterval);
      }
    };
  }, [activeDemo]);

  const demos = [
    { id: "svg-draw", name: "SVG Drawing", run: runSvgDrawDemo },
    { id: "text", name: "Text Animation", run: runTextDemo },
    { id: "math-katex", name: "KaTeX + Animation", run: runMathDemo },
    { id: "svg-math", name: "SVG Equation Writing", run: runSvgMathDemo },
    { id: "morph", name: "Shape Morphing", run: runMorphDemo },
    { id: "diagram", name: "Staggered Diagram", run: runDiagramDemo },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f0f1a",
      color: "white",
      fontFamily: "system-ui, sans-serif",
      padding: 20
    }}>
      {/* Header */}
      <div style={{ marginBottom: 30 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>
          Anime.js Test Page
        </h1>
        <p style={{ color: "#888", fontSize: 14 }}>
          Testing animation capabilities for educational content
        </p>
        <p style={{
          color: status === "Ready" ? "#4ecdc4" : "#ff6b6b",
          fontSize: 12,
          marginTop: 8
        }}>
          Status: {status}
        </p>
      </div>

      {/* Demo Selector */}
      <div style={{
        display: "flex",
        gap: 10,
        marginBottom: 20,
        flexWrap: "wrap"
      }}>
        {demos.map((demo) => (
          <button
            key={demo.id}
            onClick={() => {
              setActiveDemo(demo.id);
              // Clear any running intervals
              if (containerRef.current && (containerRef.current as any)._morphInterval) {
                clearInterval((containerRef.current as any)._morphInterval);
              }
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: activeDemo === demo.id ? "2px solid #4ecdc4" : "1px solid #333",
              background: activeDemo === demo.id ? "#1a1a2e" : "transparent",
              color: activeDemo === demo.id ? "#4ecdc4" : "#888",
              cursor: "pointer",
              fontSize: 14,
              transition: "all 0.2s"
            }}
          >
            {demo.name}
          </button>
        ))}
      </div>

      {/* Run Button */}
      <button
        onClick={() => {
          const demo = demos.find(d => d.id === activeDemo);
          if (demo) demo.run();
        }}
        disabled={!animeModule}
        style={{
          padding: "12px 30px",
          borderRadius: 8,
          border: "none",
          background: animeModule ? "#4ecdc4" : "#333",
          color: animeModule ? "#000" : "#666",
          cursor: animeModule ? "pointer" : "not-allowed",
          fontSize: 16,
          fontWeight: 600,
          marginBottom: 20,
        }}
      >
        Run Animation
      </button>

      {/* Animation Container */}
      <div
        ref={containerRef}
        style={{
          background: "#1a1a2e",
          borderRadius: 12,
          minHeight: 300,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden"
        }}
      >
        <p style={{ color: "#444" }}>Click "Run Animation" to see the demo</p>
      </div>

      {/* Info */}
      <div style={{ marginTop: 20, padding: 20, background: "#1a1a2e", borderRadius: 12 }}>
        <h3 style={{ fontSize: 16, marginBottom: 10 }}>Demo Info: {demos.find(d => d.id === activeDemo)?.name}</h3>
        {activeDemo === "svg-draw" && (
          <p style={{ color: "#888", fontSize: 14 }}>
            Uses <code>svg.createDrawable()</code> to animate SVG paths being drawn.
            Great for revealing shapes, lines, and illustrations.
          </p>
        )}
        {activeDemo === "text" && (
          <p style={{ color: "#888", fontSize: 14 }}>
            Uses <code>splitText()</code> to split text into characters, then animates each one.
            Good for titles and key terms.
          </p>
        )}
        {activeDemo === "math-katex" && (
          <p style={{ color: "#888", fontSize: 14 }}>
            Combines KaTeX for LaTeX rendering with Anime.js for animating the output.
            Targets KaTeX's internal spans for staggered reveals.
          </p>
        )}
        {activeDemo === "svg-math" && (
          <p style={{ color: "#888", fontSize: 14 }}>
            Hand-crafted SVG paths for "E = mc²" with drawing animation.
            Most Manim-like but requires pre-made SVG paths.
          </p>
        )}
        {activeDemo === "morph" && (
          <p style={{ color: "#888", fontSize: 14 }}>
            Uses <code>svg.morphTo()</code> to smoothly transform between shapes.
            Great for concept transitions.
          </p>
        )}
        {activeDemo === "diagram" && (
          <p style={{ color: "#888", fontSize: 14 }}>
            Combines multiple animations: boxes scale in, arrows draw, labels fade.
            Shows how to orchestrate complex sequences.
          </p>
        )}
      </div>
    </div>
  );
}

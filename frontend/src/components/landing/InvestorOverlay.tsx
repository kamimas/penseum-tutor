"use client";

import { motion } from "framer-motion";

interface InvestorOverlayProps {
  scrollProgress: number;
  onStart: () => void;
}

// Heartbeat pulse animation - pulsing cyan dot
function HeartbeatIndicator({ opacity }: { opacity: number }) {
  return (
    <motion.div
      className="relative flex items-center justify-center"
      style={{ opacity }}
    >
      {/* Outer glow ring */}
      <motion.div
        className="absolute w-4 h-4 rounded-full"
        style={{
          background: "rgba(34, 211, 238, 0.3)",
        }}
        animate={{
          scale: [1, 1.8, 1],
          opacity: [0.6, 0, 0.6],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      {/* Inner dot */}
      <motion.div
        className="w-1.5 h-1.5 rounded-full"
        style={{
          background: "#22d3ee",
          boxShadow: "0 0 8px #22d3ee, 0 0 16px rgba(34, 211, 238, 0.5)",
        }}
        animate={{
          scale: [1, 1.2, 1],
          opacity: [1, 0.8, 1],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
    </motion.div>
  );
}

export default function InvestorOverlay({ scrollProgress, onStart }: InvestorOverlayProps) {
  // Visibility calculations
  const frictionOpacity = Math.max(0, 1 - scrollProgress * 2.5);
  const revealOpacity = Math.max(0, (scrollProgress - 0.5) * 2.5);

  // Student appears after teacher is visible (scroll 0.6 - 0.75)
  // Teacher appears at 0.5, student starts appearing at 0.6
  const studentProgress = Math.max(0, Math.min(1, (scrollProgress - 0.6) * 6.67)); // 0 at 0.6, 1 at 0.75

  const brandOpacity = Math.max(0, (scrollProgress - 0.7) * 4);
  const heartbeatOpacity = Math.max(0, (scrollProgress - 0.8) * 5);
  const buttonOpacity = Math.max(0, (scrollProgress - 0.85) * 6.67);

  return (
    <div className="w-full">
      {/* Page 1: Friction Phase */}
      <section className="h-screen w-full flex flex-col items-center justify-start pt-[30vh] relative">
        <motion.div
          className="text-center"
          style={{ opacity: frictionOpacity }}
        >
          {/* "1 Teacher" - smaller, subordinate */}
          <motion.p
            className="font-serif italic text-2xl md:text-3xl text-white/70 mb-2 tracking-tight"
            style={{ mixBlendMode: "overlay" }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.8 }}
          >
            1 Teacher.
          </motion.p>

          {/* "30 Students" - larger, dominant */}
          <motion.h1
            className="font-serif italic text-5xl md:text-7xl lg:text-8xl text-white tracking-tight"
            style={{
              mixBlendMode: "overlay",
              textShadow: "0 0 80px rgba(124, 58, 237, 0.4)",
            }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.8 }}
          >
            30 Students.
          </motion.h1>
        </motion.div>
      </section>

      {/* Page 2: Reveal Phase - INTIMATE */}
      <section className="h-screen w-full relative flex flex-col items-center justify-start pt-[25vh] px-4">
        {/* Mobile: Stacked vertical layout */}
        <div
          className="flex flex-col items-center gap-2 md:hidden"
          style={{ opacity: revealOpacity }}
        >
          <motion.span
            className="font-serif italic text-4xl text-white tracking-tight"
            style={{
              textShadow: "0 0 80px rgba(124, 58, 237, 0.4)",
            }}
          >
            1 Teacher.
          </motion.span>
          <motion.span
            className="font-serif italic text-4xl text-white tracking-tight"
            style={{
              textShadow: "0 0 80px rgba(34, 211, 238, 0.4)",
              opacity: studentProgress,
              transition: "opacity 0.5s ease-out",
            }}
          >
            1 Student.
          </motion.span>
        </div>

        {/* Desktop: Side-by-side with slide animation */}
        <div
          className="hidden md:flex absolute inset-0 justify-center items-start pt-[25vh]"
          style={{ opacity: revealOpacity }}
        >
          {/* "1 Teacher" - starts dead center, slides left to make room */}
          <motion.span
            className="font-serif italic text-7xl lg:text-8xl text-white tracking-tight whitespace-nowrap absolute"
            style={{
              textShadow: "0 0 80px rgba(124, 58, 237, 0.4)",
              transform: `translateX(${-studentProgress * 180}px)`,
              transition: "transform 0.6s ease-out",
            }}
          >
            1 Teacher.
          </motion.span>

          {/* "1 Student" - fades in at right position */}
          <motion.span
            className="font-serif italic text-7xl lg:text-8xl text-white tracking-tight whitespace-nowrap absolute"
            style={{
              textShadow: "0 0 80px rgba(34, 211, 238, 0.4)",
              opacity: studentProgress,
              transform: `translateX(${180}px)`,
              transition: "opacity 0.5s ease-out",
            }}
          >
            1 Student.
          </motion.span>
        </div>

        {/* Brand section */}
        <motion.div
          className="absolute bottom-[40%] md:bottom-[30%] left-0 right-0 flex flex-col items-center px-4"
          style={{ opacity: brandOpacity }}
        >
          {/* Penseum + Heartbeat indicator */}
          <div className="flex items-center gap-2 md:gap-3">
            <motion.span
              className="font-serif text-3xl md:text-4xl lg:text-5xl text-white tracking-tight"
              style={{
                transform: `translateX(${heartbeatOpacity > 0 ? -4 : 0}px)`,
                transition: "transform 0.5s ease-out",
                textShadow: "0 0 40px rgba(124, 58, 237, 0.3)",
              }}
            >
              Penseum
            </motion.span>

            <motion.div
              style={{
                opacity: heartbeatOpacity,
                transform: `translateX(${heartbeatOpacity > 0 ? 0 : -10}px)`,
                transition: "all 0.5s ease-out",
              }}
            >
              <HeartbeatIndicator opacity={1} />
            </motion.div>
          </div>

          {/* CTA Button */}
          <motion.button
            className="mt-6 md:mt-8 px-8 md:px-10 py-3 md:py-4 rounded-full font-mono text-xs md:text-sm tracking-[0.15em] uppercase
                       cursor-pointer transition-all duration-300"
            style={{
              opacity: buttonOpacity,
              background: "transparent",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "rgba(255, 255, 255, 0.9)",
              backdropFilter: "blur(12px)",
            }}
            whileHover={{
              borderColor: "rgba(34, 211, 238, 0.4)",
              boxShadow: "0 0 30px rgba(34, 211, 238, 0.15)",
            }}
            whileTap={{
              scale: 0.98,
            }}
            onClick={onStart}
          >
            Try Now
          </motion.button>
        </motion.div>
      </section>
    </div>
  );
}

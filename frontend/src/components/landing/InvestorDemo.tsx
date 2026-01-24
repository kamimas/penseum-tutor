"use client";

import { useRef, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useScroll } from "@react-three/drei";
import * as THREE from "three";

interface InvestorDemoProps {
  onScrollProgress?: (progress: number) => void;
}

// Metallic Torus Rings - representing the "crowd" of students
function FrictionRings({ scrollProgress }: { scrollProgress: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = 500;

  const particles = useMemo(() => {
    const data = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.5 + Math.random() * 6;

      data.push({
        position: new THREE.Vector3(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          (Math.random() - 0.5) * 2.5
        ),
        basePosition: new THREE.Vector3(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          (Math.random() - 0.5) * 2.5
        ),
        rotation: new THREE.Euler(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI
        ),
        rotationSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 0.015,
          (Math.random() - 0.5) * 0.015,
          (Math.random() - 0.5) * 0.015
        ),
        noiseOffset: Math.random() * 1000,
        scale: 0.5 + Math.random() * 0.4,
        explosionDirection: new THREE.Vector3(
          Math.cos(angle),
          Math.sin(angle),
          (Math.random() - 0.5) * 0.5
        ).normalize(),
      });
    }
    return data;
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const time = state.clock.getElapsedTime();

    // Explosion starts at 15% scroll
    const explosionProgress = Math.max(0, (scrollProgress - 0.15) * 3);

    particles.forEach((particle, i) => {
      // Subtle anxious drift
      const noiseX = Math.sin(time * 2 + particle.noiseOffset) * 0.06;
      const noiseY = Math.cos(time * 1.8 + particle.noiseOffset * 1.3) * 0.06;
      const noiseZ = Math.sin(time * 1.5 + particle.noiseOffset * 0.7) * 0.04;

      // Explosion outward
      const explosionOffset = particle.explosionDirection
        .clone()
        .multiplyScalar(explosionProgress * 12);

      dummy.position.copy(particle.basePosition);
      dummy.position.x += noiseX + explosionOffset.x;
      dummy.position.y += noiseY + explosionOffset.y;
      dummy.position.z += noiseZ + explosionOffset.z;

      // Rotation - faster during explosion
      const rotSpeed = explosionProgress > 0 ? 1.5 : 1;
      particle.rotation.x += particle.rotationSpeed.x * rotSpeed;
      particle.rotation.y += particle.rotationSpeed.y * rotSpeed;
      particle.rotation.z += particle.rotationSpeed.z * rotSpeed;
      dummy.rotation.copy(particle.rotation);

      // Fade out during explosion
      const opacity = Math.max(0, 1 - explosionProgress * 0.8);
      dummy.scale.setScalar(particle.scale * opacity);

      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  // Hide completely after explosion
  if (scrollProgress > 0.6) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <torusGeometry args={[0.25, 0.025, 16, 32]} />
      <meshStandardMaterial
        color="#4c1d95"
        roughness={0.15}
        metalness={0.9}
        emissive="#2e1065"
        emissiveIntensity={0.3}
      />
    </instancedMesh>
  );
}

// Main component
export default function InvestorDemo({ onScrollProgress }: InvestorDemoProps) {
  const scroll = useScroll();
  const [scrollProgress, setScrollProgress] = useState(0);

  useFrame(() => {
    const progress = scroll.offset;
    setScrollProgress(progress);

    if (onScrollProgress) {
      onScrollProgress(progress);
    }
  });

  return (
    <group>
      {/* Friction rings - the crowd */}
      <FrictionRings scrollProgress={scrollProgress} />

      {/* Ambient */}
      <ambientLight intensity={0.12} color="#1e1b4b" />

      {/* Phase lighting */}
      {scrollProgress < 0.4 && (
        <>
          <pointLight position={[0, 0, 5]} intensity={0.6} color="#5b21b6" />
          <pointLight position={[-4, 2, 3]} intensity={0.3} color="#06b6d4" />
          <pointLight position={[4, -2, 3]} intensity={0.3} color="#7c3aed" />
        </>
      )}

      {scrollProgress > 0.4 && (
        <>
          <pointLight position={[3, 3, 5]} intensity={1} color="#a78bfa" />
          <pointLight position={[-3, -2, 3]} intensity={0.5} color="#06b6d4" />
        </>
      )}
    </group>
  );
}

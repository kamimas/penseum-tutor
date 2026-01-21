"use client";
import {
  ShapeUtil,
  TLBaseShape,
  Rectangle2d,
  HTMLContainer,
  TLOnResizeHandler,
  resizeBox,
} from "@tldraw/tldraw";
import { useState, useEffect } from "react";

// Define the shape type with title support
export type TutorImageShape = TLBaseShape<
  "tutor-image",
  {
    w: number;
    h: number;
    url: string;
    alt: string;
    title?: string;
  }
>;

// Premium "Bento Card" Component - Apple-style design
function PremiumCardComponent({ shape }: { shape: TutorImageShape }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [shape.props.url]);

  const title = shape.props.title || shape.props.alt || "Concept";
  const hasTitle = title && title !== "Image";

  if (error) {
    return (
      <div
        style={{
          width: shape.props.w,
          height: shape.props.h,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)",
          borderRadius: 32,
          color: "#dc2626",
          fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          padding: 24,
          textAlign: "center",
          boxShadow: "0 20px 50px -12px rgba(0, 0, 0, 0.15)",
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 500 }}>Failed to load image</div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: shape.props.w,
        height: shape.props.h,
        position: "relative",
        borderRadius: 32,
        overflow: "hidden",
        background: "#ffffff",
        boxShadow: "0 20px 50px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.5)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Image Area - fills most of the card */}
      <div
        style={{
          flex: 1,
          position: "relative",
          width: "100%",
          background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
          overflow: "hidden",
        }}
      >
        {/* Loading skeleton */}
        {!loaded && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#94a3b8",
              fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                border: "3px solid #e2e8f0",
                borderTopColor: "#3b82f6",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
          </div>
        )}

        {/* The actual image */}
        <img
          src={shape.props.url}
          alt={shape.props.alt}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain", // Show full image without cropping
            opacity: loaded ? 1 : 0,
            transition: "opacity 0.4s ease-out",
          }}
          draggable={false}
        />

        {/* Glossy overlay - Apple touch */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%, rgba(0,0,0,0.02) 100%)",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Title bar at bottom - frosted glass effect */}
      {hasTitle && (
        <div
          style={{
            height: 64,
            minHeight: 64,
            background: "rgba(255, 255, 255, 0.9)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderTop: "1px solid rgba(0, 0, 0, 0.05)",
            display: "flex",
            alignItems: "center",
            paddingLeft: 24,
            paddingRight: 24,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 600,
              fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
              color: "#1e293b",
              letterSpacing: "-0.02em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </h3>
        </div>
      )}

      {/* CSS for spinner animation */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export class TutorImageShapeUtil extends ShapeUtil<TutorImageShape> {
  static override type = "tutor-image" as const;

  getDefaultProps(): TutorImageShape["props"] {
    return {
      w: 500,
      h: 420,
      url: "",
      alt: "Tutor image",
      title: "",
    };
  }

  getGeometry(shape: TutorImageShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  component(shape: TutorImageShape) {
    return (
      <HTMLContainer>
        <PremiumCardComponent shape={shape} />
      </HTMLContainer>
    );
  }

  indicator(shape: TutorImageShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={32} ry={32} />;
  }

  override canResize = () => true;

  override onResize: TLOnResizeHandler<TutorImageShape> = (shape, info) => {
    return resizeBox(shape, info);
  };
}

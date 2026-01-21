"use client";
import {
  ShapeUtil,
  Geometry2d,
  Rectangle2d,
  HTMLContainer,
  TLBaseShape,
  TLOnResizeHandler,
  resizeBox,
} from "@tldraw/tldraw";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useEffect, useRef, useState } from "react";

// Shape type definition
export type LatexShape = TLBaseShape<
  "latex",
  {
    w: number;
    h: number;
    latex: string;
    fontSize: number;
  }
>;

// Component to render LaTeX
function LatexRenderer({
  latex,
  fontSize,
  onMeasure,
}: {
  latex: string;
  fontSize: number;
  onMeasure?: (width: number, height: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const rendered = katex.renderToString(latex, {
        throwOnError: false,
        displayMode: true,
        output: "html",
      });
      setHtml(rendered);
      setError(null);
    } catch (e: any) {
      setError(e.message || "LaTeX error");
      setHtml("");
    }
  }, [latex]);

  useEffect(() => {
    if (containerRef.current && onMeasure) {
      const rect = containerRef.current.getBoundingClientRect();
      onMeasure(rect.width, rect.height);
    }
  }, [html, onMeasure]);

  if (error) {
    return (
      <div
        style={{
          color: "red",
          fontSize: fontSize,
          fontFamily: "monospace",
          padding: "8px",
        }}
      >
        {latex}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        fontSize: fontSize,
        lineHeight: 1.4,
        padding: "4px 0",
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export class LatexShapeUtil extends ShapeUtil<LatexShape> {
  static override type = "latex" as const;

  getDefaultProps(): LatexShape["props"] {
    return {
      w: 400,
      h: 60,
      latex: "x^2 + y^2 = r^2",
      fontSize: 24,
    };
  }

  getGeometry(shape: LatexShape): Geometry2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: false,
    });
  }

  override canResize = () => true;
  override isAspectRatioLocked = () => false;

  override onResize: TLOnResizeHandler<LatexShape> = (shape, info) => {
    return resizeBox(shape, info);
  };

  component(shape: LatexShape) {
    return (
      <HTMLContainer
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          pointerEvents: "all",
          overflow: "visible",
        }}
      >
        <LatexRenderer latex={shape.props.latex} fontSize={shape.props.fontSize} />
      </HTMLContainer>
    );
  }

  indicator(shape: LatexShape) {
    return (
      <rect
        width={shape.props.w}
        height={shape.props.h}
        fill="none"
        stroke="blue"
        strokeWidth={1}
      />
    );
  }
}

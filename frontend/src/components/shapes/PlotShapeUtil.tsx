"use client";
import {
  ShapeUtil,
  TLBaseShape,
  Rectangle2d,
  HTMLContainer,
  TLOnResizeHandler,
  resizeBox,
} from "@tldraw/tldraw";
import { useEffect, useRef } from "react";

// Define the shape type
export type PlotShape = TLBaseShape<
  "plot",
  {
    w: number;
    h: number;
    equation: string;
    xDomain: [number, number];
    yDomain: [number, number];
    color: string;
  }
>;

// Component to render the plot using function-plot
function PlotComponent({ shape }: { shape: PlotShape }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous plot
    containerRef.current.innerHTML = "";

    // Dynamically import function-plot (client-side only)
    import("function-plot").then((functionPlot) => {
      if (!containerRef.current) return;

      try {
        functionPlot.default({
          target: containerRef.current,
          width: shape.props.w,
          height: shape.props.h,
          yAxis: { domain: shape.props.yDomain },
          xAxis: { domain: shape.props.xDomain },
          grid: true,
          data: [
            {
              fn: shape.props.equation,
              color: shape.props.color || "#3b82f6",
            },
          ],
        });
      } catch (error) {
        console.error("Error plotting function:", error);
        if (containerRef.current) {
          containerRef.current.innerHTML = `
            <div style="
              display: flex;
              align-items: center;
              justify-content: center;
              width: 100%;
              height: 100%;
              background: #fef2f2;
              border: 2px solid #ef4444;
              border-radius: 8px;
              color: #dc2626;
              font-family: system-ui;
              padding: 16px;
              text-align: center;
            ">
              Invalid equation: ${shape.props.equation}
            </div>
          `;
        }
      }
    });
  }, [
    shape.props.equation,
    shape.props.w,
    shape.props.h,
    shape.props.xDomain,
    shape.props.yDomain,
    shape.props.color,
  ]);

  return (
    <div
      ref={containerRef}
      style={{
        width: shape.props.w,
        height: shape.props.h,
        background: "white",
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
      }}
    />
  );
}

export class PlotShapeUtil extends ShapeUtil<PlotShape> {
  static override type = "plot" as const;

  getDefaultProps(): PlotShape["props"] {
    return {
      w: 400,
      h: 300,
      equation: "x^2",
      xDomain: [-10, 10],
      yDomain: [-10, 10],
      color: "#3b82f6",
    };
  }

  getGeometry(shape: PlotShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  component(shape: PlotShape) {
    return (
      <HTMLContainer>
        <PlotComponent shape={shape} />
      </HTMLContainer>
    );
  }

  indicator(shape: PlotShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize = () => true;

  override onResize: TLOnResizeHandler<PlotShape> = (shape, info) => {
    return resizeBox(shape, info);
  };
}

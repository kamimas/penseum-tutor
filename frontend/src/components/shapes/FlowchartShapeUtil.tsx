"use client";
import {
  ShapeUtil,
  Geometry2d,
  Rectangle2d,
  HTMLContainer,
  TLBaseShape,
} from "@tldraw/tldraw";

export type FlowchartShape = TLBaseShape<
  "flowchart",
  {
    w: number;
    h: number;
    steps: string[];
  }
>;

export class FlowchartShapeUtil extends ShapeUtil<FlowchartShape> {
  static override type = "flowchart" as const;

  getDefaultProps(): FlowchartShape["props"] {
    return {
      w: 300,
      h: 400,
      steps: ["Step 1", "Step 2", "Step 3"],
    };
  }

  getGeometry(shape: FlowchartShape): Geometry2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: false,
    });
  }

  component(shape: FlowchartShape) {
    const { steps } = shape.props;

    return (
      <HTMLContainer
        style={{
          width: "100%",
          height: "100%",
          pointerEvents: "all",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {steps.map((step, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            {/* Step box */}
            <div
              style={{
                padding: "12px 24px",
                background: i === 0 ? "#e0f2fe" : i === steps.length - 1 ? "#dcfce7" : "white",
                border: "2px solid #333",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                textAlign: "center",
                minWidth: 120,
              }}
            >
              {step}
            </div>
            {/* Arrow */}
            {i < steps.length - 1 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: "4px 0",
                }}
              >
                <div style={{ width: 2, height: 20, background: "#333" }} />
                <div
                  style={{
                    width: 0,
                    height: 0,
                    borderLeft: "6px solid transparent",
                    borderRight: "6px solid transparent",
                    borderTop: "8px solid #333",
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </HTMLContainer>
    );
  }

  indicator(shape: FlowchartShape) {
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

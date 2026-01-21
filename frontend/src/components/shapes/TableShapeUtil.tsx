"use client";
import {
  ShapeUtil,
  Geometry2d,
  Rectangle2d,
  HTMLContainer,
  TLBaseShape,
} from "@tldraw/tldraw";

export type TableShape = TLBaseShape<
  "table",
  {
    w: number;
    h: number;
    headers: string[];
    rows: string[][];
  }
>;

export class TableShapeUtil extends ShapeUtil<TableShape> {
  static override type = "table" as const;

  getDefaultProps(): TableShape["props"] {
    return {
      w: 400,
      h: 200,
      headers: ["Column 1", "Column 2"],
      rows: [["Cell 1", "Cell 2"]],
    };
  }

  getGeometry(shape: TableShape): Geometry2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: false,
    });
  }

  component(shape: TableShape) {
    const { headers, rows } = shape.props;

    return (
      <HTMLContainer
        style={{
          width: "100%",
          height: "100%",
          pointerEvents: "all",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "system-ui, sans-serif",
            fontSize: 14,
          }}
        >
          <thead>
            <tr>
              {headers.map((header, i) => (
                <th
                  key={i}
                  style={{
                    border: "2px solid #333",
                    padding: "10px 16px",
                    background: "#f0f0f0",
                    fontWeight: 600,
                    textAlign: "left",
                  }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.map((cell, cellIdx) => (
                  <td
                    key={cellIdx}
                    style={{
                      border: "1px solid #666",
                      padding: "8px 16px",
                      background: "white",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </HTMLContainer>
    );
  }

  indicator(shape: TableShape) {
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

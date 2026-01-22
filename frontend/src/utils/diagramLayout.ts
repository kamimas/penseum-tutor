/**
 * Diagram Layout Utilities
 *
 * Provides layout algorithms and utilities for generating AI-friendly diagrams
 * that can be rendered as native Excalidraw elements.
 */

import * as dagre from "dagre";
import rough from "roughjs";

// ============================================
// TYPE DEFINITIONS
// ============================================

export type DiagramType =
  | "flowchart"
  | "mindmap"
  | "tree"
  | "sequence"
  | "comparison"
  | "cycle"
  | "timeline"
  | "org-chart";

export type NodeStyle =
  | "default"
  | "highlight"
  | "start"
  | "end"
  | "decision"
  | "process"
  | "data"
  | "terminal";

export type EdgeStyle = "solid" | "dashed" | "dotted";

export interface DiagramNode {
  id: string;
  label: string;
  style?: NodeStyle;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  style?: EdgeStyle;
}

// ============================================
// SIMPLIFIED AI-FRIENDLY INPUT FORMAT
// ============================================

// Node can be a simple string or object with style
export type SimpleNode = string | { label: string; style?: NodeStyle };

// Edge using indices: [from, to] or [from, to, label]
export type SimpleEdge = [number, number] | [number, number, string];

// Simplified input that AI can easily generate
export interface SimpleDiagramInput {
  type: DiagramType;
  nodes: SimpleNode[];
  // Optional: only needed for non-linear flows (branches, loops)
  // If omitted, edges are auto-generated as linear: 0->1->2->3...
  edges?: SimpleEdge[];
  direction?: "TB" | "LR" | "BT" | "RL";
}

// ============================================
// LAYOUT TYPES
// ============================================

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  style: NodeStyle;
}

export interface LayoutEdge {
  from: string;
  to: string;
  points: { x: number; y: number }[];
  label?: string;
  style: EdgeStyle;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

// ============================================
// CONSTANTS
// ============================================

const MIN_NODE_WIDTH = 100;
const CHAR_WIDTH = 10;
const NODE_PADDING = 30;
const NODE_HEIGHT = 50;
const NODE_MARGIN = 60;
const PADDING = 80;
const ROUGHNESS = 1;

function getNodeWidth(label: string): number {
  return Math.max(MIN_NODE_WIDTH, label.length * CHAR_WIDTH + NODE_PADDING);
}

// ============================================
// PARSE SIMPLIFIED INPUT
// ============================================

export function parseSimpleDiagram(input: SimpleDiagramInput): {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
} {
  // Parse nodes
  const nodes: DiagramNode[] = input.nodes.map((node, index) => {
    if (typeof node === "string") {
      const label = node;
      let style: NodeStyle = "default";

      const lowerLabel = label.toLowerCase();
      if (lowerLabel.includes("start") || lowerLabel.includes("begin")) {
        style = "start";
      } else if (lowerLabel.includes("end") || lowerLabel.includes("finish") || lowerLabel.includes("done")) {
        style = "end";
      } else if (lowerLabel.includes("?") || lowerLabel.startsWith("is ") || lowerLabel.startsWith("has ") || lowerLabel.startsWith("can ") || lowerLabel.startsWith("should ")) {
        style = "decision";
      }

      return { id: String(index), label, style };
    } else {
      return { id: String(index), label: node.label, style: node.style || "default" };
    }
  });

  // Parse edges
  let edges: DiagramEdge[];

  if (input.edges && input.edges.length > 0) {
    edges = input.edges.map((edge) => {
      const [from, to, label] = edge;
      return {
        from: String(from),
        to: String(to),
        label: label,
        style: "solid" as EdgeStyle,
      };
    });
  } else {
    // Auto-generate linear edges: 0->1->2->3...
    edges = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({
        from: String(i),
        to: String(i + 1),
        style: "solid",
      });
    }
  }

  return { nodes, edges };
}

// ============================================
// EDGE ROUTING - SMART BOUNDARY INTERSECTIONS
// ============================================

const EDGE_GAP = 6;

type NodeShape = "rectangle" | "diamond" | "ellipse";

function getNodeShape(style: NodeStyle): NodeShape {
  if (style === "decision") return "diamond";
  if (style === "start" || style === "end" || style === "terminal") return "ellipse";
  return "rectangle";
}

function intersectRectangle(
  nodeX: number, nodeY: number, nodeW: number, nodeH: number,
  targetX: number, targetY: number
): { x: number; y: number } {
  const cx = nodeX + nodeW / 2;
  const cy = nodeY + nodeH / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const halfW = nodeW / 2;
  const halfH = nodeH / 2;

  let t = Infinity;

  if (dx > 0) {
    const tRight = halfW / dx;
    if (Math.abs(dy * tRight) <= halfH) t = Math.min(t, tRight);
  }
  if (dx < 0) {
    const tLeft = -halfW / dx;
    if (Math.abs(dy * tLeft) <= halfH) t = Math.min(t, tLeft);
  }
  if (dy > 0) {
    const tBottom = halfH / dy;
    if (Math.abs(dx * tBottom) <= halfW) t = Math.min(t, tBottom);
  }
  if (dy < 0) {
    const tTop = -halfH / dy;
    if (Math.abs(dx * tTop) <= halfW) t = Math.min(t, tTop);
  }

  if (t === Infinity) return { x: cx, y: cy };

  return { x: cx + dx * t, y: cy + dy * t };
}

function intersectDiamond(
  nodeX: number, nodeY: number, nodeW: number, nodeH: number,
  targetX: number, targetY: number
): { x: number; y: number } {
  const cx = nodeX + nodeW / 2;
  const cy = nodeY + nodeH / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const halfW = nodeW / 2;
  const halfH = nodeH / 2;

  const t = 1 / (Math.abs(dx) / halfW + Math.abs(dy) / halfH);

  return { x: cx + dx * t, y: cy + dy * t };
}

function intersectEllipse(
  nodeX: number, nodeY: number, nodeW: number, nodeH: number,
  targetX: number, targetY: number
): { x: number; y: number } {
  const cx = nodeX + nodeW / 2;
  const cy = nodeY + nodeH / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const a = nodeW / 2;
  const b = nodeH / 2;

  const t = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));

  return { x: cx + dx * t, y: cy + dy * t };
}

function getNodeBoundaryPoint(
  node: LayoutNode, targetX: number, targetY: number
): { x: number; y: number } {
  const shape = getNodeShape(node.style);

  let point: { x: number; y: number };

  switch (shape) {
    case "diamond":
      point = intersectDiamond(node.x, node.y, node.width, node.height, targetX, targetY);
      break;
    case "ellipse":
      point = intersectEllipse(node.x, node.y, node.width, node.height, targetX, targetY);
      break;
    default:
      point = intersectRectangle(node.x, node.y, node.width, node.height, targetX, targetY);
  }

  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > EDGE_GAP) {
    const gapX = (dx / dist) * EDGE_GAP;
    const gapY = (dy / dist) * EDGE_GAP;
    return { x: point.x + gapX, y: point.y + gapY };
  }

  return point;
}

function computeSmartEdgePoints(
  fromNode: LayoutNode, toNode: LayoutNode
): { x: number; y: number }[] {
  const fromCenterX = fromNode.x + fromNode.width / 2;
  const fromCenterY = fromNode.y + fromNode.height / 2;
  const toCenterX = toNode.x + toNode.width / 2;
  const toCenterY = toNode.y + toNode.height / 2;

  const startPoint = getNodeBoundaryPoint(fromNode, toCenterX, toCenterY);
  const endPoint = getNodeBoundaryPoint(toNode, fromCenterX, fromCenterY);

  return [startPoint, endPoint];
}

// ============================================
// LAYOUT ALGORITHMS
// ============================================

function layoutWithDagre(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  direction: "TB" | "LR" | "BT" | "RL"
): LayoutResult {
  const g = new dagre.graphlib.Graph();

  g.setGraph({
    rankdir: direction,
    nodesep: NODE_MARGIN,
    ranksep: NODE_MARGIN * 1.5,
    marginx: PADDING,
    marginy: PADDING,
  });

  g.setDefaultEdgeLabel(() => ({}));

  const nodeMetadata: Map<string, { style: NodeStyle; width: number }> = new Map();

  nodes.forEach((node) => {
    const width = getNodeWidth(node.label);
    g.setNode(node.id, {
      label: node.label,
      width,
      height: NODE_HEIGHT,
    });
    nodeMetadata.set(node.id, { style: node.style || "default", width });
  });

  const edgeMetadata: Map<string, { label?: string; style: EdgeStyle }> = new Map();

  edges.forEach((edge) => {
    const edgeKey = `${edge.from}->${edge.to}`;
    g.setEdge(edge.from, edge.to, { label: edge.label });
    edgeMetadata.set(edgeKey, { label: edge.label, style: edge.style || "solid" });
  });

  dagre.layout(g);

  const layoutNodes: LayoutNode[] = [];
  const layoutEdges: LayoutEdge[] = [];

  g.nodes().forEach((nodeId) => {
    const node = g.node(nodeId);
    const meta = nodeMetadata.get(nodeId);
    if (node && meta) {
      layoutNodes.push({
        id: nodeId,
        x: node.x - meta.width / 2,
        y: node.y - NODE_HEIGHT / 2,
        width: meta.width,
        height: NODE_HEIGHT,
        label: node.label || nodeId,
        style: meta.style,
      });
    }
  });

  const nodeMap = new Map<string, LayoutNode>();
  layoutNodes.forEach((node) => nodeMap.set(node.id, node));

  g.edges().forEach((edgeObj) => {
    const edge = g.edge(edgeObj);
    const edgeKey = `${edgeObj.v}->${edgeObj.w}`;
    const meta = edgeMetadata.get(edgeKey);
    if (edge) {
      const fromNode = nodeMap.get(edgeObj.v);
      const toNode = nodeMap.get(edgeObj.w);

      let points: { x: number; y: number }[];
      if (fromNode && toNode) {
        points = computeSmartEdgePoints(fromNode, toNode);
      } else if (edge.points) {
        points = edge.points;
      } else {
        return;
      }

      layoutEdges.push({
        from: edgeObj.v,
        to: edgeObj.w,
        points,
        label: meta?.label,
        style: meta?.style || "solid",
      });
    }
  });

  const graphInfo = g.graph();

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: (graphInfo?.width || 400) + PADDING * 2,
    height: (graphInfo?.height || 300) + PADDING * 2,
  };
}

function layoutMindmap(nodes: DiagramNode[], edges: DiagramEdge[]): LayoutResult {
  if (nodes.length === 0) return { nodes: [], edges: [], width: 400, height: 300 };

  const layoutNodes: LayoutNode[] = [];
  const layoutEdges: LayoutEdge[] = [];

  const centerNode = nodes[0];
  const centerWidth = getNodeWidth(centerNode.label);
  const centerX = 300;
  const centerY = 250;

  layoutNodes.push({
    id: centerNode.id,
    x: centerX - centerWidth / 2,
    y: centerY - NODE_HEIGHT / 2,
    width: centerWidth,
    height: NODE_HEIGHT,
    label: centerNode.label,
    style: centerNode.style || "highlight",
  });

  const childEdges = edges.filter((e) => e.from === centerNode.id);
  const childCount = childEdges.length;

  if (childCount > 0) {
    const radius = 200;
    const angleStep = (2 * Math.PI) / childCount;
    const startAngle = -Math.PI / 2;

    childEdges.forEach((edge, i) => {
      const childNode = nodes.find((n) => n.id === edge.to);
      if (!childNode) return;

      const childWidth = getNodeWidth(childNode.label);
      const angle = startAngle + i * angleStep;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);

      layoutNodes.push({
        id: childNode.id,
        x: x - childWidth / 2,
        y: y - NODE_HEIGHT / 2,
        width: childWidth,
        height: NODE_HEIGHT,
        label: childNode.label,
        style: childNode.style || "default",
      });
    });
  }

  const nodeMap = new Map<string, LayoutNode>();
  layoutNodes.forEach((node) => nodeMap.set(node.id, node));

  childEdges.forEach((edge) => {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (fromNode && toNode) {
      layoutEdges.push({
        from: edge.from,
        to: edge.to,
        points: computeSmartEdgePoints(fromNode, toNode),
        label: edge.label,
        style: edge.style || "solid",
      });
    }
  });

  return { nodes: layoutNodes, edges: layoutEdges, width: 600, height: 500 };
}

function layoutCycle(nodes: DiagramNode[], edges: DiagramEdge[]): LayoutResult {
  const layoutNodes: LayoutNode[] = [];
  const layoutEdges: LayoutEdge[] = [];

  const centerX = 300;
  const centerY = 280;
  const radius = 180;
  const nodeCount = nodes.length;

  if (nodeCount === 0) return { nodes: [], edges: [], width: 600, height: 560 };

  nodes.forEach((node, i) => {
    const nodeWidth = getNodeWidth(node.label);
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / nodeCount;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);

    layoutNodes.push({
      id: node.id,
      x: x - nodeWidth / 2,
      y: y - NODE_HEIGHT / 2,
      width: nodeWidth,
      height: NODE_HEIGHT,
      label: node.label,
      style: node.style || "default",
    });
  });

  for (let i = 0; i < nodeCount; i++) {
    const nextI = (i + 1) % nodeCount;
    const fromNode = layoutNodes[i];
    const toNode = layoutNodes[nextI];
    layoutEdges.push({
      from: nodes[i].id,
      to: nodes[nextI].id,
      points: computeSmartEdgePoints(fromNode, toNode),
      style: "solid",
    });
  }

  return { nodes: layoutNodes, edges: layoutEdges, width: 600, height: 560 };
}

function layoutTimeline(nodes: DiagramNode[]): LayoutResult {
  const layoutNodes: LayoutNode[] = [];
  const layoutEdges: LayoutEdge[] = [];

  const startX = PADDING;
  const baseY = 150;

  let currentX = startX;
  nodes.forEach((node, i) => {
    const nodeWidth = getNodeWidth(node.label);
    layoutNodes.push({
      id: node.id,
      x: currentX,
      y: baseY,
      width: nodeWidth,
      height: NODE_HEIGHT,
      label: node.label,
      style: node.style || "default",
    });
    currentX += nodeWidth + NODE_MARGIN;
  });

  for (let i = 0; i < nodes.length - 1; i++) {
    const fromNode = layoutNodes[i];
    const toNode = layoutNodes[i + 1];
    layoutEdges.push({
      from: nodes[i].id,
      to: nodes[i + 1].id,
      points: computeSmartEdgePoints(fromNode, toNode),
      style: "solid",
    });
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: currentX + PADDING,
    height: 350,
  };
}

export function computeLayout(
  type: DiagramType,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  direction: "TB" | "LR" | "BT" | "RL"
): LayoutResult {
  switch (type) {
    case "mindmap":
      return layoutMindmap(nodes, edges);
    case "cycle":
      return layoutCycle(nodes, edges);
    case "timeline":
      return layoutTimeline(nodes);
    default:
      return layoutWithDagre(nodes, edges, direction);
  }
}

// ============================================
// ROUGH.JS PATH GENERATION FOR EXCALIDRAW
// ============================================

function opsToPoints(sets: any[]): [number, number][] {
  const points: [number, number][] = [];

  for (const set of sets) {
    for (const op of set.ops) {
      const data = op.data;
      switch (op.op) {
        case "move":
          points.push([data[0], data[1]]);
          break;
        case "bcurveTo":
          // Sample the bezier curve
          points.push([data[4], data[5]]);
          break;
        case "lineTo":
          points.push([data[0], data[1]]);
          break;
      }
    }
  }

  return points;
}

export function generateRoughRectPoints(
  x: number, y: number, w: number, h: number, seed: number
): [number, number][] {
  const generator = rough.generator();
  const borderRadius = 8;

  const drawable = generator.path(
    `M ${x + borderRadius} ${y}
     L ${x + w - borderRadius} ${y}
     Q ${x + w} ${y} ${x + w} ${y + borderRadius}
     L ${x + w} ${y + h - borderRadius}
     Q ${x + w} ${y + h} ${x + w - borderRadius} ${y + h}
     L ${x + borderRadius} ${y + h}
     Q ${x} ${y + h} ${x} ${y + h - borderRadius}
     L ${x} ${y + borderRadius}
     Q ${x} ${y} ${x + borderRadius} ${y}
     Z`,
    { roughness: ROUGHNESS, strokeWidth: 2, seed }
  );

  return opsToPoints(drawable.sets);
}

export function generateRoughDiamondPoints(
  x: number, y: number, w: number, h: number, seed: number
): [number, number][] {
  const generator = rough.generator();
  const cx = x + w / 2;
  const cy = y + h / 2;

  const points: [number, number][] = [
    [cx, y],
    [x + w, cy],
    [cx, y + h],
    [x, cy],
  ];

  const drawable = generator.polygon(points, {
    roughness: ROUGHNESS,
    strokeWidth: 2,
    seed,
  });

  return opsToPoints(drawable.sets);
}

export function generateRoughEllipsePoints(
  x: number, y: number, w: number, h: number, seed: number
): [number, number][] {
  const generator = rough.generator();
  const cx = x + w / 2;
  const cy = y + h / 2;

  const drawable = generator.ellipse(cx, cy, w, h, {
    roughness: ROUGHNESS,
    strokeWidth: 2,
    seed,
  });

  return opsToPoints(drawable.sets);
}

export function generateRoughLinePoints(
  x1: number, y1: number, x2: number, y2: number, seed: number
): [number, number][] {
  const generator = rough.generator();

  const drawable = generator.line(x1, y1, x2, y2, {
    roughness: ROUGHNESS * 0.8,
    strokeWidth: 2,
    seed,
  });

  return opsToPoints(drawable.sets);
}

// Export node shape helper
export { getNodeShape };

import { Editor, TLShapeId, createShapeId } from "@tldraw/tldraw";

// ============================================
// SPATIAL LAYOUT CONFIGURATION
// ============================================
export const SPACING = {
  FRAME_PADDING: 40,
  ITEM_GAP: 25,
  CLUSTER_GAP: 400, // Vertical distance between topic clusters
  FRAME_WIDTH: 700,
  FRAME_MIN_HEIGHT: 400,
  CONTENT_WIDTH: 600,
};

// Types for content classification
export type ContentType = 'text' | 'latex' | 'image' | 'plot' | 'table' | 'flowchart' | 'shape';

// Position result from the spatial manager
export interface SpatialPosition {
  x: number;
  y: number;
  isNewCluster: boolean;
  clusterX: number;
  clusterY: number;
  frameId: TLShapeId | null;
}

// ============================================
// SPATIAL MANAGER - Vertical Topic Frames
// ============================================
export class SpatialManager {
  private currentFrameId: TLShapeId | null = null;
  private lastShapeId: TLShapeId | null = null;
  private shapeIds: TLShapeId[] = [];

  // Track where the next cluster should go (vertical progression)
  private nextClusterY: number = 0;
  // Track current Y position within the layout (cumulative vertical position)
  private currentY: number = SPACING.FRAME_PADDING;
  // Track the current frame's content height for dynamic sizing
  private currentFrameHeight: number = SPACING.FRAME_MIN_HEIGHT;

  constructor(private editor: Editor) {}

  /**
   * DECISION ENGINE:
   * Major items (Image, Plot, Table, Flowchart) -> Start new cluster (move right)
   * Minor items (Text, LaTeX, Shape) -> Append to current cluster (stack down)
   */
  private isMajorItem(type: ContentType): boolean {
    return ['image', 'plot', 'table', 'flowchart'].includes(type);
  }

  /**
   * Get position for a new shape
   * Supports explicit coordinates or auto-positioning
   */
  getPosition(
    type: ContentType,
    estimatedHeight: number,
    options?: {
      x?: number;
      y?: number;
    }
  ): SpatialPosition {
    const { x: explicitX, y: explicitY } = options || {};

    // If absolute coordinates provided, use them directly
    if (explicitX !== undefined && explicitY !== undefined) {
      return {
        x: explicitX,
        y: explicitY,
        isNewCluster: false, // Don't affect vertical flow
        clusterX: 0,
        clusterY: 0,
        frameId: null,
      };
    }

    // Default auto behavior (vertical stacking)
    return this.getAutoPosition(type, estimatedHeight);
  }

  /**
   * Auto-positioning logic (vertical stacking)
   */
  private getAutoPosition(type: ContentType, estimatedHeight: number): SpatialPosition {
    const isMajor = this.isMajorItem(type);
    const isFirstItem = !this.currentFrameId;

    // Start a new cluster if:
    // 1. This is a major visual item (image, plot, etc.)
    // 2. OR we don't have a current frame yet (first item)
    if (isMajor || isFirstItem) {
      // Add vertical gap for a new cluster (if not the first one)
      if (this.currentFrameId) {
        this.currentY += SPACING.CLUSTER_GAP;
      }

      this.currentFrameHeight = SPACING.FRAME_MIN_HEIGHT;

      // Mark that we now have a cluster (use placeholder ID to prevent race conditions)
      this.currentFrameId = createShapeId();

      // Reserve space immediately to prevent race conditions
      const y = this.currentY;
      this.currentY += estimatedHeight + SPACING.ITEM_GAP;

      return {
        x: SPACING.FRAME_PADDING,
        y: y,
        // Only mark as new cluster for arrows if it's NOT the first item
        // (we don't want arrows pointing from nothing)
        isNewCluster: !isFirstItem,
        clusterX: 0,
        clusterY: this.nextClusterY,
        frameId: null,
      };
    } else {
      // Append to current cluster (continue stacking vertically)
      const y = this.currentY;

      // Reserve space immediately to prevent race conditions
      this.currentY += estimatedHeight + SPACING.ITEM_GAP;

      return {
        x: SPACING.FRAME_PADDING,
        y: y,
        isNewCluster: false,
        clusterX: 0,
        clusterY: this.nextClusterY,
        frameId: this.currentFrameId,
      };
    }
  }

  /**
   * Call this AFTER creating the shape to update tracking
   */
  registerShape(id: TLShapeId, height: number, isNewCluster: boolean, _topicName?: string): void {
    // Mark that we have a cluster (for positioning logic)
    if (isNewCluster) {
      this.currentFrameId = id; // Use the shape itself as the cluster marker
    }

    // Track this shape
    this.lastShapeId = id;
    this.shapeIds.push(id);
  }

  /**
   * Get the current position for camera focusing
   */
  getCurrentFocusPoint(): { x: number; y: number } {
    return {
      x: SPACING.FRAME_WIDTH / 2,
      y: this.currentY / 2,
    };
  }

  /**
   * Get the last shape ID for camera targeting
   */
  getLastShapeId(): TLShapeId | null {
    return this.lastShapeId;
  }

  /**
   * Reset the spatial manager
   */
  reset(): void {
    this.currentFrameId = null;
    this.lastShapeId = null;
    this.shapeIds = [];
    this.nextClusterY = 0;
    this.currentY = SPACING.FRAME_PADDING;
    this.currentFrameHeight = SPACING.FRAME_MIN_HEIGHT;
  }

  /**
   * Get all tracked shape IDs
   */
  getAllShapeIds(): TLShapeId[] {
    return [...this.shapeIds];
  }
}

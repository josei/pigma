/**
 * Pigma document model.
 *
 * The model mirrors the published Figma document shape closely enough that a
 * Figma importer can map onto it without lossy guessing, while remaining
 * ergonomic for interactive editing:
 *
 *  - nodes are stored as a tree rooted at a DOCUMENT node (Figma: `document`)
 *  - page nodes are CANVAS nodes (Figma: `document.children`)
 *  - every node carries a *relative* 2x3 transform, exactly like Figma's
 *    `relativeTransform` (row-major `[[a, c, tx], [b, d, ty]]`)
 *  - paints / effects / constraints / text / auto-layout fields use Figma's
 *    names and value shapes
 *  - unknown or unsupported fields survive round-trips in `raw`
 */

export type NodeType =
  | 'DOCUMENT'
  | 'CANVAS'
  | 'FRAME'
  | 'GROUP'
  | 'SECTION'
  | 'RECTANGLE'
  | 'ELLIPSE'
  | 'LINE'
  | 'POLYGON'
  | 'STAR'
  | 'VECTOR'
  | 'TEXT'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'INSTANCE'
  | 'BOOLEAN_OPERATION'
  | 'SLICE';

export const CONTAINER_TYPES: Partial<Record<NodeType, true>> = {
  DOCUMENT: true,
  CANVAS: true,
  FRAME: true,
  GROUP: true,
  SECTION: true,
  COMPONENT: true,
  COMPONENT_SET: true,
  INSTANCE: true,
  BOOLEAN_OPERATION: true,
};

export function isContainer(type: NodeType): boolean {
  return CONTAINER_TYPES[type] === true;
}

export type BlendMode =
  | 'NORMAL'
  | 'MULTIPLY'
  | 'SCREEN'
  | 'OVERLAY'
  | 'DARKEN'
  | 'LIGHTEN'
  | 'COLOR_DODGE'
  | 'COLOR_BURN'
  | 'HARD_LIGHT'
  | 'SOFT_LIGHT'
  | 'DIFFERENCE'
  | 'EXCLUSION'
  | 'HUE'
  | 'SATURATION'
  | 'COLOR'
  | 'LUMINOSITY'
  | 'PASS_THROUGH';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface RGBA extends RGB {
  a?: number;
}

export interface Vector2 {
  x: number;
  y: number;
}

/** Figma's `relativeTransform`: [[a, c, tx], [b, d, ty]]. */
export type TransformMatrix = [[number, number, number], [number, number, number]];

/** Ergonomic form of {@link TransformMatrix}: x' = a*x + c*y + tx; y' = b*x + d*y + ty. */
export interface Transform {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface ColorStop {
  position: number;
  color: RGBA;
}

export interface SolidPaint {
  type: 'SOLID';
  color: RGB;
  opacity?: number;
  visible?: boolean;
  blendMode?: BlendMode;
  /** Figma variable binding, preserved verbatim. */
  boundVariables?: Record<string, unknown>;
}

export interface GradientPaint {
  type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND';
  gradientStops: ColorStop[];
  /** Figma stores gradients in normalized "gradient space"; we keep the matrix verbatim. */
  gradientTransform?: TransformMatrix;
  opacity?: number;
  visible?: boolean;
  blendMode?: BlendMode;
}

export interface ImagePaint {
  type: 'IMAGE';
  imageRef?: string;
  /** Inline data URL, when the image bytes are available (export/import). */
  dataUrl?: string;
  scaleMode?: 'FILL' | 'FIT' | 'CROP' | 'TILE';
  imageTransform?: TransformMatrix;
  scalingFactor?: number;
  /**
   * The bitmap's intrinsic size in pixels, recorded when the image is decoded.
   * TILE needs it: the tile period *is* the natural size (times `scalingFactor`),
   * and it cannot be read from a data URL synchronously.
   */
  naturalWidth?: number;
  naturalHeight?: number;
  opacity?: number;
  visible?: boolean;
  blendMode?: BlendMode;
}

/** Paint kinds with no dedicated model (Figma may add more over time). */
export interface UnsupportedPaint {
  type: 'VIDEO' | 'PATTERN';
  opacity?: number;
  visible?: boolean;
  blendMode?: BlendMode;
  [key: string]: unknown;
}

export type Paint = SolidPaint | GradientPaint | ImagePaint | UnsupportedPaint;

export interface ShadowEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW';
  color: RGBA;
  offset: Vector2;
  radius: number;
  spread?: number;
  visible?: boolean;
  blendMode?: BlendMode;
  showShadowBehindNode?: boolean;
}

export interface BlurEffect {
  type: 'LAYER_BLUR' | 'BACKGROUND_BLUR';
  radius: number;
  visible?: boolean;
}

/** Effects with no model; the original `type` string is preserved verbatim. */
export interface UnsupportedEffect {
  type: 'UNKNOWN';
  visible?: boolean;
  [key: string]: unknown;
}

export type Effect = ShadowEffect | BlurEffect | UnsupportedEffect;

export type StrokeCap = 'NONE' | 'ROUND' | 'SQUARE' | 'ARROW_LINES' | 'ARROW_EQUILATERAL';
export type StrokeJoin = 'MITER' | 'BEVEL' | 'ROUND';
export type StrokeAlign = 'INSIDE' | 'OUTSIDE' | 'CENTER';

export type ConstraintType = 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';

export interface Constraints {
  horizontal: ConstraintType;
  vertical: ConstraintType;
}

export type LayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';

/**
 * Figma's `GridTrackSize`: a track is either a fixed pixel size or a fractional
 * (`fr`) share of what is left after the fixed tracks and gaps.
 */
export interface GridTrackSize {
  type: 'FIXED' | 'FLEX';
  /** Pixels for FIXED, the fr weight for FLEX (1 for "1fr"). */
  value: number;
}
export type LayoutAlign = 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
export type LayoutCounterAlign = 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
export type LayoutSizing = 'FIXED' | 'HUG' | 'FILL';

export interface AutoLayout {
  layoutMode: LayoutMode;
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  primaryAxisAlignItems?: LayoutAlign;
  counterAxisAlignItems?: LayoutCounterAlign;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  layoutWrap?: 'NO_WRAP' | 'WRAP';
  /** Gap between wrapped lines (Figma's `counterAxisSpacing`). */
  counterAxisSpacing?: number;
  layoutSizingHorizontal?: LayoutSizing;
  layoutSizingVertical?: LayoutSizing;
  /**
   * Grid auto layout (Figma's third flow). `layoutMode: 'GRID'` uses these; the
   * other modes ignore them. Track sizes follow Figma's `GridTrackSize`, and the
   * gaps are Figma's `gridColumnGap`/`gridRowGap`.
   */
  gridColumns?: GridTrackSize[];
  gridRows?: GridTrackSize[];
  gridColumnGap?: number;
  gridRowGap?: number;
}

export type TextAlignHorizontal = 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
export type TextAlignVertical = 'TOP' | 'CENTER' | 'BOTTOM';
export type TextAutoResize = 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE';

export interface TextStyle {
  fontFamily: string;
  fontStyle?: string;
  fontWeight?: number;
  fontSize: number;
  lineHeight?: { unit: 'PIXELS' | 'PERCENT' | 'AUTO'; value?: number };
  letterSpacing?: { unit: 'PIXELS' | 'PERCENT'; value: number };
  textAlignHorizontal?: TextAlignHorizontal;
  textAlignVertical?: TextAlignVertical;
  textCase?: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE';
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  textAutoResize?: TextAutoResize;
  paragraphSpacing?: number;
  paragraphIndent?: number;
  /** Style runs, preserved verbatim for imported documents. */
  styleRuns?: unknown[];
}

/** Where an overlay frame is anchored when it opens (Figma's overlay position). */
export type OverlayPosition =
  | 'CENTER'
  | 'TOP_LEFT'
  | 'TOP_RIGHT'
  | 'BOTTOM_LEFT'
  | 'BOTTOM_RIGHT'
  | 'CUSTOM';

export interface PrototypeAction {
  type: 'NODE' | 'BACK' | 'CLOSE' | 'URL';
  /** Overlay actions keep the current frame underneath. */
  overlay?: boolean;
  /** Overlay anchoring; defaults to centered. */
  overlayPosition?: OverlayPosition;
  /** Manual offsets, used when `overlayPosition` is CUSTOM (scene units). */
  overlayX?: number;
  overlayY?: number;
  /** Dim the frame behind the overlay (default true, like Figma). */
  overlayDim?: boolean;
  destinationId?: string | null;
  url?: string;
  /**
   * How a NODE action reaches its destination, in Figma's terms.
   *
   * The four playback honours: NAVIGATE pushes the frame, SWAP replaces it in
   * place, OVERLAY opens it over the current one, and SWAP_STATE changes the
   * instance's variant component in place (Figma's native name for what the REST
   * API calls CHANGE_TO — the destination IS expressible, as `destinationId`).
   * Figma also has SCROLL_TO; the model has no scroll offset, so it is NOT a
   * member and the importer reports it rather than mapping it onto a navigation.
   */
  navigation?: 'NAVIGATE' | 'SWAP' | 'OVERLAY' | 'SWAP_STATE';
  transition?: {
    type: string;
    duration?: number;
    easing?: string;
    direction?: string;
  };
  preserveScrollPosition?: boolean;
}

export interface PrototypeInteraction {
  trigger: {
    type: 'ON_CLICK' | 'ON_HOVER' | 'ON_PRESS' | 'ON_DRAG' | 'AFTER_TIMEOUT' | 'MOUSE_ENTER' | 'MOUSE_LEAVE' | 'MOUSE_UP' | 'MOUSE_DOWN';
    delay?: number;
  };
  actions: PrototypeAction[];
}

export interface BaseNode {
  id: string;
  name: string;
  type: NodeType;
  visible: boolean;
  locked: boolean;
  /** Size limits (M10): clamp resizes, HUG/FILL layout and constraints. */
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  opacity: number;
  blendMode?: BlendMode;
  /** Relative to the parent node's coordinate space. */
  transform: Transform;
  width: number;
  height: number;
  fills: Paint[];
  strokes: Paint[];
  strokeWeight?: number;
  strokeAlign?: StrokeAlign;
  strokeCap?: StrokeCap;
  strokeJoin?: StrokeJoin;
  dashPattern?: number[];
  effects?: Effect[];
  constraints?: Constraints;
  /** Present when the node is inside an auto-layout parent. */
  layoutAlign?: 'INHERIT' | 'STRETCH';
  layoutGrow?: number;
  /**
   * Grid placement inside a `layoutMode: 'GRID'` parent, in Figma's terms. An
   * anchor index places the child at that 0-based track instead of letting
   * auto-placement choose; spans widen the cell. Absent means auto-placed.
   */
  gridColumnAnchorIndex?: number;
  gridRowAnchorIndex?: number;
  gridColumnSpan?: number;
  gridRowSpan?: number;
  /** VECTOR / BOOLEAN_OPERATION geometry, in node-local coordinates. */
  pathData?: string;
  windingRule?: 'NONZERO' | 'EVENODD';
  /** Rounded corners; Figma allows these on rectangles, frames and components. */
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  /** Style bindings for this node (fill/text/effect). */
  styles?: NodeStyleBinding;
  /**
   * Which component property drives which field on this layer, e.g.
   * `{ visible: 'Show icon', characters: 'Label' }` (Figma's
   * `componentPropertyReferences`).
   */
  componentPropertyReferences?: Record<string, string>;
  /** Variable bindings by property name (Figma's `boundVariables`). */
  boundVariables?: Record<string, string>;
  /** Prototype links. */
  interactions?: PrototypeInteraction[];
  /**
   * Figma's "Use as mask": this node's geometry clips the siblings **above** it
   * (the ones later in the parent's child order) without hiding itself.
   */
  isMask?: boolean;
  /**
   * Dev Mode status of a top-level frame (Figma's "ready for development"): set
   * by the designer in the Inspect panel, shown as a badge in the layers list.
   */
  devStatus?: DevStatus;
  /** Unknown / unsupported Figma fields, preserved verbatim across import & export. */
  raw?: Record<string, unknown>;
}

/** Dev Mode status a designer sets on a frame (Figma's per-frame status). */
export type DevStatus = 'READY_FOR_DEVELOPMENT' | 'COMPLETED';

export type ShapeType = 'RECTANGLE' | 'ELLIPSE' | 'LINE' | 'POLYGON' | 'STAR' | 'VECTOR' | 'SLICE';
export type ContainerKind = 'FRAME' | 'GROUP' | 'SECTION' | 'BOOLEAN_OPERATION';

export interface ShapeNode extends BaseNode {
  type: ShapeType;
  pointCount?: number;
  innerRadius?: number;
}

export interface TextNode extends BaseNode {
  type: 'TEXT';
  characters: string;
  style: TextStyle;
}

export type LayoutGridPattern = 'COLUMNS' | 'ROWS' | 'GRID';

/** Figma layout grid: columns, rows or a uniform grid drawn over a frame. */
export interface LayoutGrid {
  pattern: LayoutGridPattern;
  /** Column/row width for COLUMNS/ROWS, or the cell size for GRID. */
  sectionSize: number;
  count?: number;
  gutterSize?: number;
  offset?: number;
  alignment?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
  color?: RGBA;
  visible?: boolean;
}

/** Figma's prototype scrolling setting for a frame. */
export type OverflowDirection =
  | 'NONE'
  | 'HORIZONTAL_SCROLLING'
  | 'VERTICAL_SCROLLING'
  | 'HORIZONTAL_AND_VERTICAL_SCROLLING';

export interface ChildrenMixin {
  children: SceneNode[];
  autoLayout?: AutoLayout;
  /**
   * Boolean operation kind (Figma's `booleanOperation`). Present on
   * BOOLEAN_OPERATION nodes; switching it re-runs the operation in place.
   */
  booleanOperation?: 'UNION' | 'SUBTRACT' | 'INTERSECT' | 'EXCLUDE';
  /** Prototype scrolling (Figma's `overflowDirection`). */
  overflowDirection?: OverflowDirection;
  layoutGrids?: LayoutGrid[];
  /** FRAME clipping behaviour (Figma `clipsContent`). */
  clipsContent?: boolean;
}

export interface ContainerNode extends BaseNode, ChildrenMixin {
  type: ContainerKind;
}

export interface ComponentNode extends BaseNode, ChildrenMixin {
  type: 'COMPONENT' | 'COMPONENT_SET';
  componentPropertyDefinitions?: Record<string, ComponentPropertyDefinition>;
  description?: string;
}

/**
 * Per-node override applied on top of a component's subtree inside an instance.
 * Keyed by the *component* node id so overrides survive component edits.
 */
export interface NodeOverride {
  name?: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  cornerRadius?: number;
  effects?: Effect[];
  characters?: string;
  /** Position/size overrides are world coordinates relative to the instance. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /**
   * Slot content: the children an instance supplies for this node. A component
   * edit re-materializes the subtree, and this is what makes the supplied content
   * SURVIVE that — the sync merges the override rather than replacing it.
   */
  children?: SceneNode[];
}

export interface InstanceNode extends BaseNode, ChildrenMixin {
  type: 'INSTANCE';
  componentId: string;
  /** Library this instance was inserted from (Figma keeps the link on the instance). */
  libraryId?: string;
  /** Component key inside that library. */
  libraryKey?: string;
  /** Library version the instance was inserted/updated from. */
  libraryVersion?: number;
  componentProperties?: Record<string, ComponentPropertyValue>;
  /** Per-node overrides keyed by node id inside the component subtree. */
  overrides?: Record<string, NodeOverride>;
  /** Materialized copy of the component subtree at instantiation time. */
  componentSnapshot?: SceneNode | null;
}

export interface DocumentNode extends BaseNode {
  type: 'DOCUMENT';
  children: CanvasNode[];
}

/** A saved version of the file's content (M6 version history). */
export interface VersionEntry {
  id: string;
  name: string;
  createdAt: number;
  /** Auto snapshots are pruned first when the history fills up. */
  auto: boolean;
  /** Everything a restore needs, minus the history itself. */
  snapshot: Omit<PigmaFile, 'versions'>;
}

/** A comment thread pin (M13). */
export interface CommentReply {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

export interface CommentThread {
  id: string;
  pageId: string;
  /** World-space position of the pin. */
  x: number;
  y: number;
  /** Optional layer the comment is attached to. */
  nodeId?: string | null;
  author: string;
  text: string;
  createdAt: number;
  resolved: boolean;
  replies: CommentReply[];
}

/** A named prototype flow starting at a frame (Figma's `flows`). */
export interface PrototypeFlow {
  id: string;
  name: string;
  startNodeId: string;
  description?: string;
}

export interface CanvasNode extends BaseNode, ChildrenMixin {
  type: 'CANVAS';
  backgroundColor?: RGBA;
  prototypeStartNodeId?: string | null;
  flows?: PrototypeFlow[];
}

/** Every scene node, discriminated by `type`. */
export type SceneNode = ShapeNode | TextNode | ContainerNode | ComponentNode | InstanceNode;

/** Any node in the file tree, including the DOCUMENT/CANVAS wrappers. */
export type AnyNode = DocumentNode | CanvasNode | SceneNode;

/** Nodes that own children. */
export type ParentNode = DocumentNode | CanvasNode | ContainerNode | ComponentNode | InstanceNode;

/** Children arrays are homogeneous in practice; the tree layer handles both. */
export type AnyChild = CanvasNode | SceneNode;
/** Alias for brevity: any node in the file tree. */
export type Node = AnyNode;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/**
 * Figma's component property types. `SLOT` is a property whose value is instance
 * CONTENT supplied through an override of the slot frame's children, rather than
 * a string, a boolean or a preferred component.
 */
export type ComponentPropertyType = 'VARIANT' | 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP' | 'SLOT';

/** A component property definition (Figma's `componentPropertyDefinitions`). */
export interface ComponentPropertyDefinition {
  type: ComponentPropertyType;
  defaultValue: string | boolean;
  /** Allowed values for VARIANT properties. */
  variantOptions?: string[];
  /** Preferred component ids for INSTANCE_SWAP properties. */
  preferredValues?: Array<{ type: 'COMPONENT' | 'COMPONENT_SET'; key: string }>;
  description?: string;
}

export type ComponentPropertyValue = string | boolean;

export type StyleType = 'FILL' | 'TEXT' | 'EFFECT';

/** Figma's file-level styles table entry. */
export interface StyleDefinition {
  key: string;
  name: string;
  type: StyleType;
  description?: string;
  paints?: Paint[];
  text?: TextStyle;
  effects?: Effect[];
}

/** Node -> style bindings, keyed by the property the style drives. */
export interface NodeStyleBinding {
  fill?: string;
  text?: string;
  effect?: string;
}

export interface VariableMode {
  modeId: string;
  name: string;
}

/** A variable collection with its modes (Figma's `variableCollections`). */
export interface VariableCollection {
  id: string;
  name: string;
  modes: VariableMode[];
  defaultModeId: string;
  variableIds: string[];
}

export type VariableValue = RGBA | number | string | boolean;

/** One variable with a value per mode (Figma's `variables`). */
export interface VariableDefinition {
  id: string;
  name: string;
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  variableCollectionId: string;
  valuesByMode: Record<string, VariableValue>;
  description?: string;
}

export interface PigmaFile {
  /** Format discriminator so imports can be validated. */
  schema: 'pigma/1';
  /** Figma file key / source, when imported. */
  source?: { kind: 'pigma' | 'figma'; fileKey?: string; nodeId?: string; importedAt?: number };
  name: string;
  lastModified: number;
  document: DocumentNode;
  /** Optional prototype start frame for presentation mode. */
  prototypeStartNodeId?: string | null;
  /** Raw document-level Figma metadata that has no model home. */
  meta?: Record<string, unknown>;
  /** File-level styles table, keyed by style id (Figma's `styles`). */
  styles?: Record<string, StyleDefinition>;
  /** Variable collections, keyed by collection id. */
  variableCollections?: Record<string, VariableCollection>;
  /** Variables, keyed by variable id. */
  variables?: Record<string, VariableDefinition>;
  /** Active mode per collection (what the canvas resolves bindings against). */
  activeModes?: Record<string, string>;
  /** Publication record for the file's own library (M11). */
  publishedLibrary?: {
    id: string;
    name: string;
    version: number;
    publishedAt: number;
  };
  /** Version history, newest last (M6). */
  versions?: VersionEntry[];
  /** Comment threads (M13). */
  comments?: CommentThread[];
}

/**
 * Node kinds Figma lets a designer mark with a development status.
 *
 * Figma's Dev Mode guide lists frames, components, instances and sections as
 * markable assets — not only top-level frames. The status is stored on the node
 * and badged wherever it appears, so the panel offers it for the same kinds.
 */
export function canHaveDevStatus(node: AnyNode | null | undefined): boolean {
  if (!node) return false;
  return node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE' || node.type === 'SECTION';
}

export function hasChildren(node: AnyNode): node is ParentNode {
  return Array.isArray((node as ParentNode).children);
}

export function isComponentNode(node: AnyNode): node is ComponentNode {
  return node.type === 'COMPONENT' || node.type === 'COMPONENT_SET';
}

/** Nodes that participate in the scene (everything but DOCUMENT/CANVAS wrappers). */
export function isSceneNode(node: AnyNode): node is SceneNode {
  return node.type !== 'DOCUMENT' && node.type !== 'CANVAS';
}

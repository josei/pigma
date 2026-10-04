/**
 * Figma REST API document model.
 *
 * Mirrors the published types from
 * https://developers.figma.com/docs/rest-api/file-node-types/ and
 * https://developers.figma.com/docs/rest-api/file-property-types/.
 *
 * Every node type carries an index signature: Figma adds fields over time and a
 * real importer must retain unknown data rather than drop it. The named fields
 * document the parts the converter understands.
 */

export type FigmaNodeType =
  | 'DOCUMENT'
  | 'CANVAS'
  | 'FRAME'
  | 'GROUP'
  | 'SECTION'
  | 'TRANSFORM_GROUP'
  | 'VECTOR'
  | 'BOOLEAN_OPERATION'
  | 'STAR'
  | 'LINE'
  | 'ELLIPSE'
  | 'REGULAR_POLYGON'
  | 'RECTANGLE'
  | 'TABLE'
  | 'TABLE_CELL'
  | 'TEXT'
  | 'TEXT_PATH'
  | 'SLICE'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'INSTANCE'
  | 'STICKY'
  | 'SHAPE_WITH_TEXT'
  | 'CONNECTOR'
  | 'WASHI_TAPE';

// ─── Property types ─────────────────────────────────────────────────────────

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaVector {
  x: number;
  y: number;
}

export interface FigmaRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Row-major 2x3 affine matrix: [[a, c, tx], [b, d, ty]]. */
export type FigmaTransform = [[number, number, number], [number, number, number]];

export interface FigmaColorStop {
  position: number;
  color: FigmaColor;
  boundVariables?: Record<string, unknown>;
}

export type FigmaPaintType =
  | 'SOLID'
  | 'GRADIENT_LINEAR'
  | 'GRADIENT_RADIAL'
  | 'GRADIENT_ANGULAR'
  | 'GRADIENT_DIAMOND'
  | 'IMAGE'
  | 'EMOJI'
  | 'VIDEO'
  | 'PATTERN';

export interface FigmaPaint {
  type: FigmaPaintType | string;
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  color?: FigmaColor;
  gradientHandlePositions?: FigmaVector[];
  gradientStops?: FigmaColorStop[];
  gradientTransform?: FigmaTransform;
  scaleMode?: string;
  imageTransform?: FigmaTransform;
  scalingFactor?: number;
  rotation?: number;
  imageRef?: string;
  gifRef?: string;
  filters?: Record<string, number>;
  boundVariables?: Record<string, unknown>;
  [key: string]: unknown;
}

export type FigmaEffectType =
  | 'INNER_SHADOW'
  | 'DROP_SHADOW'
  | 'LAYER_BLUR'
  | 'BACKGROUND_BLUR'
  | 'TEXTURE'
  | 'NOISE';

export interface FigmaEffect {
  type: FigmaEffectType | string;
  visible?: boolean;
  radius?: number;
  blendMode?: string;
  color?: FigmaColor;
  offset?: FigmaVector;
  spread?: number;
  showShadowBehindNode?: boolean;
  blurType?: string;
  boundVariables?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FigmaLayoutConstraint {
  vertical: 'TOP' | 'BOTTOM' | 'CENTER' | 'TOP_BOTTOM' | 'SCALE' | string;
  horizontal: 'LEFT' | 'RIGHT' | 'CENTER' | 'LEFT_RIGHT' | 'SCALE' | string;
}

export interface FigmaArcData {
  startingAngle: number;
  endingAngle: number;
  innerRadius: number;
}

export interface FigmaExportSetting {
  suffix: string;
  format: 'JPG' | 'PNG' | 'SVG' | string;
  constraint: { type: 'SCALE' | 'WIDTH' | 'HEIGHT' | string; value: number };
}

export interface FigmaLayoutGrid {
  pattern: 'COLUMNS' | 'ROWS' | 'GRID' | string;
  sectionSize?: number;
  visible?: boolean;
  color?: FigmaColor;
  alignment?: string;
  gutterSize?: number;
  offset?: number;
  count?: number;
  [key: string]: unknown;
}

export interface FigmaHyperlink {
  type: 'URL' | 'NODE' | string;
  url?: string;
  nodeID?: string;
}

export interface FigmaTypeStyle {
  fontFamily?: string;
  fontPostScriptName?: string | null;
  fontStyle?: string;
  fontWeight?: number;
  fontSize?: number;
  italic?: boolean;
  paragraphSpacing?: number;
  paragraphIndent?: number;
  listSpacing?: number;
  textCase?: string;
  textDecoration?: string;
  textAutoResize?: string;
  textTruncation?: string;
  maxLines?: number | null;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  letterSpacing?: number;
  fills?: FigmaPaint[];
  hyperlink?: FigmaHyperlink | null;
  lineHeightPx?: number;
  lineHeightPercent?: number;
  lineHeightPercentFontSize?: number;
  lineHeightUnit?: string;
  openTypeFlags?: Record<string, number>;
  [key: string]: unknown;
}

export interface FigmaComponentPropertyDefinition {
  type: 'BOOLEAN' | 'INSTANCE_SWAP' | 'TEXT' | 'VARIANT' | string;
  defaultValue: boolean | string;
  variantOptions?: string[];
  [key: string]: unknown;
}

export interface FigmaComponentProperty {
  type: 'BOOLEAN' | 'INSTANCE_SWAP' | 'TEXT' | 'VARIANT' | string;
  value: boolean | string;
  [key: string]: unknown;
}

export interface FigmaOverrides {
  id: string;
  overriddenFields: string[];
}

export interface FigmaTrigger {
  type: string;
  timeout?: number;
  delay?: number;
  [key: string]: unknown;
}

export interface FigmaAction {
  type: string;
  destinationId?: string | null;
  url?: string;
  navigation?: string;
  transition?: { type: string; duration?: number; easing?: unknown; direction?: string; matchLayers?: boolean } | null;
  preserveScrollPosition?: boolean;
  [key: string]: unknown;
}

export interface FigmaInteraction {
  trigger: FigmaTrigger | null;
  actions: FigmaAction[];
  [key: string]: unknown;
}

export interface FigmaPath {
  path: string;
  windingRule?: 'NONZERO' | 'EVENODD' | string;
  overrideID?: number;
}

// ─── Nodes ──────────────────────────────────────────────────────────────────

export interface FigmaRestNode {
  id: string;
  name: string;
  type: FigmaNodeType | string;
  visible?: boolean;
  locked?: boolean;
  rotation?: number;
  opacity?: number;
  blendMode?: string;
  children?: FigmaRestNode[];

  absoluteBoundingBox?: FigmaRectangle | null;
  absoluteRenderBounds?: FigmaRectangle | null;
  relativeTransform?: FigmaTransform;
  size?: FigmaVector;

  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  individualStrokeWeights?: { top: number; right: number; bottom: number; left: number };
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER' | string;
  strokeCap?: string;
  strokeJoin?: string;
  strokeDashes?: number[];
  strokeMiterAngle?: number;
  effects?: FigmaEffect[];
  constraints?: FigmaLayoutConstraint;
  layoutGrids?: FigmaLayoutGrid[];

  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  cornerSmoothing?: number;

  clipsContent?: boolean;
  isMask?: boolean;
  maskType?: string;
  exportSettings?: FigmaExportSetting[];

  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID' | string;
  layoutAlign?: string;
  layoutGrow?: number;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  layoutWrap?: string;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  layoutPositioning?: string;

  characters?: string;
  style?: FigmaTypeStyle;
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, FigmaTypeStyle>;
  lineTypes?: string[];
  lineIndentations?: number[];

  arcData?: FigmaArcData;
  booleanOperation?: string;

  componentId?: string;
  componentProperties?: Record<string, FigmaComponentProperty>;
  componentPropertyDefinitions?: Record<string, FigmaComponentPropertyDefinition>;
  overrides?: FigmaOverrides[];
  isExposedInstance?: boolean;
  exposedInstances?: string[];

  fillGeometry?: FigmaPath[];
  strokeGeometry?: FigmaPath[];
  fillOverrideTable?: Record<string, unknown>;

  styles?: Record<string, string>;
  backgroundColor?: FigmaColor;
  interactions?: FigmaInteraction[];
  annotations?: unknown[];
  devStatus?: unknown;

  componentPropertyReferences?: Record<string, string>;
  boundVariables?: Record<string, unknown>;
  explicitVariableModes?: Record<string, string>;

  [key: string]: unknown;
}

// ─── File-level resources ───────────────────────────────────────────────────

export interface FigmaComponent {
  key: string;
  name: string;
  description?: string;
  componentSetId?: string;
  documentationLinks?: Array<{ uri: string }>;
  remote?: boolean;
  [key: string]: unknown;
}

export interface FigmaStyle {
  key: string;
  name: string;
  description?: string;
  remote?: boolean;
  styleType: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID' | string;
  [key: string]: unknown;
}

/** Response of `GET /v1/files/:key/nodes?ids=…`. */
export interface FigmaRestNodesResponse {
  name: string;
  role?: string;
  lastModified?: string;
  editorType?: string;
  version?: string;
  nodes: Record<
    string,
    {
      document: FigmaRestNode;
      components?: Record<string, FigmaComponent>;
      componentSets?: Record<string, FigmaComponent>;
      styles?: Record<string, FigmaStyle>;
      schemaVersion?: number;
      [key: string]: unknown;
    }
  >;
  [key: string]: unknown;
}

/** Normalized, validated Figma REST source ready for conversion. */
export interface FigmaRestFile {
  kind: 'rest';
  fileKey?: string;
  name: string;
  role?: string;
  lastModified?: string;
  editorType?: string;
  thumbnailUrl?: string;
  version?: string;
  schemaVersion?: number;
  /** Root nodes: one `DOCUMENT` for a full file, one detached subtree per requested id. */
  roots: FigmaRestNode[];
  /** Every reachable node by id. */
  nodeMap: Map<string, FigmaRestNode>;
  components: Record<string, FigmaComponent>;
  componentSets: Record<string, FigmaComponent>;
  styles: Record<string, FigmaStyle>;
  /**
   * Variable tables, when the caller supplied them: Figma's file JSON has no
   * variables table (they come from `/v1/files/:key/variables/local`), so the
   * payload is attached to the parsed source before conversion.
   */
  variables?: unknown;
  /** The original response, retained verbatim. */
  raw: unknown;
}

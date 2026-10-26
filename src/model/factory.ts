import type {
  BaseNode,
  ShapeType,
  CanvasNode,
  ComponentNode,
  ContainerNode,
  DocumentNode,
  Node,
  NodeType,
  Paint,
  SceneNode,
  ShapeNode,
  TextNode,
  TextStyle,
} from './types';
import { hasChildren } from './types';
import { IDENTITY } from './matrix';
import { nextNodeId } from './ids';
import { hexToRgba } from './paint';

export const FIGMA_GRAY: Paint = { type: 'SOLID', color: hexToRgba('#d9d9d9'), opacity: 1 };
export const FIGMA_WHITE: Paint = { type: 'SOLID', color: hexToRgba('#ffffff'), opacity: 1 };
export const FIGMA_BLACK: Paint = { type: 'SOLID', color: hexToRgba('#000000'), opacity: 1 };

export const DEFAULT_FONT_FAMILY = 'Inter';
export const DEFAULT_FONT_SIZE = 14;

export function defaultTextStyle(overrides: Partial<TextStyle> = {}): TextStyle {
  return {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontStyle: 'Regular',
    fontWeight: 400,
    fontSize: DEFAULT_FONT_SIZE,
    lineHeight: { unit: 'PERCENT', value: 120 },
    letterSpacing: { unit: 'PERCENT', value: 0 },
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    textCase: 'ORIGINAL',
    textDecoration: 'NONE',
    textAutoResize: 'WIDTH_AND_HEIGHT',
    ...overrides,
  };
}

const BASE_NAME: Partial<Record<NodeType, string>> = {
  FRAME: 'Frame',
  RECTANGLE: 'Rectangle',
  ELLIPSE: 'Ellipse',
  LINE: 'Line',
  POLYGON: 'Polygon',
  STAR: 'Star',
  TEXT: 'Text',
  GROUP: 'Group',
  COMPONENT: 'Component',
  COMPONENT_SET: 'Component Set',
  INSTANCE: 'Instance',
  SECTION: 'Section',
  VECTOR: 'Vector',
  BOOLEAN_OPERATION: 'Boolean',
  CANVAS: 'Page',
  DOCUMENT: 'Document',
  SLICE: 'Slice',
};

/**
 * Figma-style auto naming: "Rectangle 1", "Rectangle 2", ... counted across the
 * whole document so names stay unique like they do in Figma.
 */
export function uniqueName(root: Node | null, type: NodeType): string {
  const base = BASE_NAME[type] ?? 'Node';
  let highest = 0;
  if (root) {
    const visit = (node: Node) => {
      const match = new RegExp(`^${base} (\\d+)$`).exec(node.name);
      if (match?.[1]) highest = Math.max(highest, Number(match[1]));
      if (hasChildren(node)) node.children.forEach(visit);
    };
    visit(root);
  }
  return `${base} ${highest + 1}`;
}

export function baseNodeProps<T extends NodeType>(
  type: T,
  name: string,
): Omit<BaseNode, 'type' | 'width' | 'height'> & { type: T } {
  return {
    id: nextNodeId(),
    name,
    type,
    visible: true,
    locked: false,
    opacity: 1,
    transform: { ...IDENTITY },
    fills: [],
    strokes: [],
  };
}

/** Generic shape factory used by the vector tool and boolean operations. */
export function createShapeNode<T extends ShapeType>(
  root: Node | null,
  type: T,
  x: number,
  y: number,
  width: number,
  height: number,
): ShapeNode {
  return {
    ...baseNodeProps(type, uniqueName(root, type)),
    width,
    height,
    transform: { ...IDENTITY, tx: x, ty: y },
    fills: [{ ...FIGMA_GRAY }],
    strokeWeight: 1,
    strokeAlign: 'INSIDE',
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
  } as ShapeNode;
}

export function createRectNode(root: Node | null, x: number, y: number, width: number, height: number): ShapeNode {
  return {
    ...baseNodeProps('RECTANGLE', uniqueName(root, 'RECTANGLE')),
    width,
    height,
    transform: { ...IDENTITY, tx: x, ty: y },
    fills: [{ ...FIGMA_GRAY }],
    strokeWeight: 1,
    strokeAlign: 'INSIDE',
    cornerRadius: 0,
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
  };
}

export function createEllipseNode(root: Node | null, x: number, y: number, width: number, height: number): ShapeNode {
  return {
    ...baseNodeProps('ELLIPSE', uniqueName(root, 'ELLIPSE')),
    width,
    height,
    transform: { ...IDENTITY, tx: x, ty: y },
    fills: [{ ...FIGMA_GRAY }],
    strokeWeight: 1,
    strokeAlign: 'INSIDE',
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
  };
}

export function createLineNode(root: Node | null, x: number, y: number, width: number): ShapeNode {
  return {
    ...baseNodeProps('LINE', uniqueName(root, 'LINE')),
    width: Math.max(width, 1),
    height: 0,
    transform: { ...IDENTITY, tx: x, ty: y },
    strokes: [{ ...FIGMA_BLACK }],
    strokeWeight: 1,
    strokeCap: 'NONE',
    strokeAlign: 'CENTER',
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
  };
}

export function createPolygonNode(root: Node | null, x: number, y: number, width: number, height: number): ShapeNode {
  return {
    ...baseNodeProps('POLYGON', uniqueName(root, 'POLYGON')),
    width,
    height,
    transform: { ...IDENTITY, tx: x, ty: y },
    fills: [{ ...FIGMA_GRAY }],
    strokeWeight: 1,
    strokeAlign: 'INSIDE',
    pointCount: 3,
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
  };
}

export function createStarNode(root: Node | null, x: number, y: number, width: number, height: number): ShapeNode {
  return {
    ...baseNodeProps('STAR', uniqueName(root, 'STAR')),
    width,
    height,
    transform: { ...IDENTITY, tx: x, ty: y },
    fills: [{ ...FIGMA_GRAY }],
    strokeWeight: 1,
    strokeAlign: 'INSIDE',
    pointCount: 5,
    innerRadius: 0.382,
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
  };
}

export function createTextNode(
  root: Node | null,
  x: number,
  y: number,
  characters: string,
  style: Partial<TextStyle> = {},
): TextNode {
  return {
    ...baseNodeProps('TEXT', uniqueName(root, 'TEXT')),
    type: 'TEXT',
    width: 100,
    height: DEFAULT_FONT_SIZE * 1.2,
    transform: { ...IDENTITY, tx: x, ty: y },
    fills: [{ ...FIGMA_BLACK }],
    characters,
    style: defaultTextStyle(style),
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
  };
}

export function createFrameNode(
  root: Node | null,
  x: number,
  y: number,
  width: number,
  height: number,
  options: Partial<ContainerNode> = {},
): ContainerNode {
  return {
    ...baseNodeProps('FRAME', uniqueName(root, 'FRAME')),
    type: 'FRAME',
    width,
    height,
    transform: { ...IDENTITY, tx: x, ty: y },
    fills: [{ ...FIGMA_WHITE }],
    strokeWeight: 1,
    strokeAlign: 'INSIDE',
    children: [],
    clipsContent: true,
    autoLayout: { layoutMode: 'NONE' },
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
    ...options,
  };
}

export function createSectionNode(root: Node | null, x: number, y: number, width: number, height: number): ContainerNode {
  return {
    ...baseNodeProps('SECTION', uniqueName(root, 'SECTION')),
    type: 'SECTION',
    width,
    height,
    transform: { ...IDENTITY, tx: x, ty: y },
    fills: [{ type: 'SOLID', color: hexToRgba('#ffffff'), opacity: 1 }],
    children: [],
    clipsContent: false,
  };
}

export function createGroupNode(children: SceneNode[]): ContainerNode {
  return {
    id: nextNodeId(),
    name: 'Group',
    type: 'GROUP',
    visible: true,
    locked: false,
    opacity: 1,
    transform: { ...IDENTITY },
    width: 0,
    height: 0,
    fills: [],
    strokes: [],
    children,
    clipsContent: false,
  };
}

export function createCanvasNode(name: string): CanvasNode {
  return {
    id: nextNodeId(),
    name,
    type: 'CANVAS',
    visible: true,
    locked: false,
    opacity: 1,
    transform: { ...IDENTITY },
    width: 0,
    height: 0,
    fills: [],
    strokes: [],
    backgroundColor: hexToRgba('#e5e5e5'),
    children: [],
  };
}

export function createDocument(name: string): DocumentNode {
  const page = createCanvasNode('Page 1');
  return {
    id: nextNodeId(),
    name,
    type: 'DOCUMENT',
    visible: true,
    locked: false,
    opacity: 1,
    transform: { ...IDENTITY },
    width: 0,
    height: 0,
    fills: [],
    strokes: [],
    children: [page],
  };
}

export function createComponentNode(root: Node | null, node: SceneNode): ComponentNode {
  const base: ComponentNode = {
    ...baseNodeProps('COMPONENT', uniqueName(root, 'COMPONENT')),
    type: 'COMPONENT',
    width: node.width,
    height: node.height,
    transform: { ...node.transform },
    fills: [...node.fills],
    strokes: [...node.strokes],
    strokeWeight: node.strokeWeight,
    children: [],
    clipsContent: true,
  };
  return base;
}

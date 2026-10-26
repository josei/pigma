import type { Paint, SceneNode, TextNode } from './types';
import { createCanvasNode, createFrameNode, createRectNode, createTextNode } from './factory';
import { hexToRgba } from './paint';
import { nextNodeId } from './ids';
import { IDENTITY } from './matrix';
import type { PigmaFile } from './types';

const INTER = 'Inter';

function solid(hex: string, opacity = 1): Paint {
  return { type: 'SOLID', color: hexToRgba(hex), opacity };
}

function linearGradient(from: string, to: string, angle: 'vertical' | 'horizontal' = 'vertical'): Paint {
  return {
    type: 'GRADIENT_LINEAR',
    gradientStops: [
      { position: 0, color: hexToRgba(from) },
      { position: 1, color: hexToRgba(to) },
    ],
    // Gradient space -> object space, ready for SVG's objectBoundingBox
    // gradientTransform (same convention the Figma importer emits).
    gradientTransform:
      angle === 'vertical'
        ? [
            [0, -1, 0],
            [1, 0, 0],
          ]
        : [
            [1, 0, 0],
            [0, 1, 0],
          ],
  };
}

function dropShadow(color: string, alpha: number, x: number, y: number, blur: number, spread = 0) {
  return {
    type: 'DROP_SHADOW' as const,
    color: { ...hexToRgba(color), a: alpha },
    offset: { x, y },
    radius: blur,
    spread,
    visible: true,
    blendMode: 'NORMAL' as const,
  };
}

interface TextOptions {
  size?: number;
  weight?: number;
  color?: string;
  align?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  lineHeight?: number;
  letterSpacing?: number;
  width?: number;
  autoResize?: 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'NONE' | 'TRUNCATE';
  name?: string;
}

function text(x: number, y: number, characters: string, options: TextOptions = {}): TextNode {
  const weight = options.weight ?? 400;
  const node = createTextNode(null, x, y, characters, {
    fontFamily: INTER,
    fontStyle: weight >= 700 ? 'Bold' : weight >= 600 ? 'Semi Bold' : weight >= 500 ? 'Medium' : 'Regular',
    fontWeight: weight,
    fontSize: options.size ?? 16,
    lineHeight: { unit: 'PERCENT', value: options.lineHeight ?? 140 },
    letterSpacing: { unit: 'PERCENT', value: options.letterSpacing ?? 0 },
    textAlignHorizontal: options.align ?? 'LEFT',
    textAlignVertical: 'TOP',
    textAutoResize: options.autoResize ?? (options.width ? 'HEIGHT' : 'WIDTH_AND_HEIGHT'),
  });
  node.fills = [solid(options.color ?? '#0d0c22')];
  node.name = options.name ?? (characters.slice(0, 24) || 'Text');
  if (options.width) node.width = options.width;
  return node;
}

/**
 * Starter document: a small, genuinely editable website design so the editor is
 * never empty on first load. Everything is a plain scene node — no special
 * cases in the renderer.
 */
export function defaultDocument(): PigmaFile {
  const page = createCanvasNode('Website');
  page.children = [hero(), features(), mobile(), componentSheet()];
  page.prototypeStartNodeId = page.children[0]?.id ?? null;

  return {
    schema: 'pigma/1',
    name: 'Pigma Starter',
    lastModified: Date.now(),
    document: {
      id: nextNodeId(),
      name: 'Document',
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
    },
    prototypeStartNodeId: page.children[0]?.id ?? null,
  };
}

function hero(): SceneNode {
  const frame = createFrameNode(null, 0, 0, 1440, 900, { name: 'Home / Hero' });
  frame.fills = [solid('#ffffff')];

  const nav = createFrameNode(null, 0, 0, 1440, 72, { name: 'Navbar' });
  nav.fills = [solid('#ffffff', 0)];
  nav.clipsContent = false;

  const logo = text(64, 26, 'Pigma', { size: 20, weight: 700, name: 'Logo' });
  const links = ['Product', 'Templates', 'Pricing', 'Docs'].map((label, index) => {
    const link = text(420 + index * 92, 30, label, { size: 15, weight: 500, color: '#4a4a68', name: label });
    return link;
  });
  const cta = createRectNode(null, 1244, 20, 132, 40);
  cta.name = 'Nav CTA';
  cta.cornerRadius = 20;
  cta.fills = [solid('#0d0c22')];
  const ctaLabel = text(1274, 30, 'Get started', { size: 14, weight: 600, color: '#ffffff', name: 'CTA label' });
  nav.children = [logo, ...links, cta, ctaLabel];

  const eyebrow = text(64, 190, 'OPEN SOURCE DESIGN EDITOR', {
    size: 13,
    weight: 600,
    color: '#0d99ff',
    letterSpacing: 12,
    name: 'Eyebrow',
  });

  const headline = text(64, 226, 'Design together,\nright in the browser', {
    size: 72,
    weight: 700,
    lineHeight: 108,
    letterSpacing: -2,
    width: 640,
    autoResize: 'HEIGHT',
    name: 'Headline',
  });

  const sub = text(
    64,
    420,
    'Pigma is an open-source, Figma-inspired editor: infinite canvas, real layers, prototypes and export — with nothing hidden behind a login.',
    { size: 19, lineHeight: 160, color: '#4a4a68', width: 520, autoResize: 'HEIGHT', name: 'Subhead' },
  );

  const primary = createRectNode(null, 64, 546, 184, 52);
  primary.name = 'Primary button';
  primary.cornerRadius = 26;
  primary.fills = [linearGradient('#0d99ff', '#007be5', 'horizontal')];
  primary.effects = [dropShadow('#0d99ff', 0.35, 0, 10, 24, -4)];
  const primaryLabel = text(100, 563, 'Start designing', { size: 16, weight: 600, color: '#ffffff', name: 'Primary label' });

  const secondary = createRectNode(null, 268, 546, 156, 52);
  secondary.name = 'Secondary button';
  secondary.cornerRadius = 26;
  secondary.fills = [solid('#ffffff')];
  secondary.strokes = [solid('#d9d9e3')];
  secondary.strokeWeight = 1;
  const secondaryLabel = text(300, 563, 'See a demo', { size: 16, weight: 600, name: 'Secondary label' });

  const card = createFrameNode(null, 760, 150, 616, 600, { name: 'Preview card' });
  card.fills = [solid('#f5f5f7')];
  card.cornerRadius = 28;

  const glow = createFrameNode(null, 120, 96, 376, 376, { name: 'Glow' });
  glow.fills = [linearGradient('#bde3ff', '#ffd6ec')];
  glow.cornerRadius = 188;
  glow.opacity = 0.9;
  glow.effects = [dropShadow('#0d99ff', 0.18, 0, 24, 64, 0)];

  const cardTitle = text(64, 300, 'Your canvas, your rules', {
    size: 32,
    weight: 700,
    width: 300,
    autoResize: 'HEIGHT',
    name: 'Card title',
  });
  const cardBody = text(64, 412, 'Vector tools, real layers, undo that works. Export SVG or JSON whenever you like.', {
    size: 15,
    lineHeight: 160,
    color: '#4a4a68',
    width: 300,
    autoResize: 'HEIGHT',
    name: 'Card body',
  });
  const swatches = ['#0d99ff', '#0d0c22', '#ff4d8d', '#bde3ff'].map((color, index) => {
    const swatch = createRectNode(null, 64 + index * 44, 540, 32, 32);
    swatch.name = `Swatch ${index + 1}`;
    swatch.cornerRadius = 8;
    swatch.fills = [solid(color)];
    return swatch;
  });
  card.children = [glow, cardTitle, cardBody, ...swatches];

  frame.children = [nav, eyebrow, headline, sub, primary, primaryLabel, secondary, secondaryLabel, card];
  return frame;
}

function features(): SceneNode {
  const frame = createFrameNode(null, 0, 980, 1440, 520, { name: 'Home / Features' });
  frame.fills = [solid('#ffffff')];

  const heading = text(64, 72, 'Everything you need to ship a design', {
    size: 40,
    weight: 700,
    letterSpacing: -1,
    width: 620,
    autoResize: 'HEIGHT',
    name: 'Features heading',
  });

  const items = [
    { title: 'Vector canvas', body: 'Infinite pan and zoom, marquee select, precise nudging and rotation.' },
    { title: 'Real layers', body: 'Reorder, rename, lock and hide — the layer tree mirrors the document.' },
    { title: 'Prototypes', body: 'Link frames together and present them full screen with one click.' },
  ];

  const cards = items.map((item, index) => {
    const card = createFrameNode(null, 64 + index * 432, 200, 400, 240, { name: item.title });
    card.fills = [solid('#f7f7fa')];
    card.cornerRadius = 20;

    const dot = createRectNode(null, 32, 32, 44, 44);
    dot.name = 'Icon';
    dot.cornerRadius = 12;
    dot.fills = [solid(index === 0 ? '#0d99ff' : index === 1 ? '#0d0c22' : '#ff4d8d')];

    const title = text(32, 100, item.title, { size: 20, weight: 600, name: 'Card title' });
    const body = text(32, 134, item.body, {
      size: 15,
      lineHeight: 160,
      color: '#4a4a68',
      width: 336,
      autoResize: 'HEIGHT',
      name: 'Card body',
    });

    card.children = [dot, title, body];
    return card;
  });

  frame.children = [heading, ...cards];
  return frame;
}

function mobile(): SceneNode {
  const frame = createFrameNode(null, 1540, 0, 390, 844, { name: 'Mobile / Home' });
  frame.fills = [solid('#0d0c22')];
  frame.cornerRadius = 32;

  const glow = createFrameNode(null, -60, -40, 300, 300, { name: 'Glow' });
  glow.fills = [linearGradient('#0d99ff', '#ff4d8d')];
  glow.cornerRadius = 150;
  glow.opacity = 0.55;

  const brand = text(32, 40, 'Pigma', { size: 22, weight: 700, color: '#ffffff', name: 'Brand' });
  const headline = text(32, 132, 'Design anywhere', {
    size: 44,
    weight: 700,
    letterSpacing: -1,
    color: '#ffffff',
    width: 300,
    autoResize: 'HEIGHT',
    name: 'Headline',
  });
  const body = text(32, 252, 'The same editor, on a smaller canvas. Pinch to zoom, drag to pan.', {
    size: 16,
    lineHeight: 160,
    color: '#b9b9d0',
    width: 320,
    autoResize: 'HEIGHT',
    name: 'Body',
  });

  const button = createRectNode(null, 32, 300, 326, 56);
  button.name = 'Open editor';
  button.cornerRadius = 28;
  button.fills = [solid('#0d99ff')];
  const buttonLabel = text(128, 318, 'Open editor', { size: 17, weight: 600, color: '#ffffff', name: 'Button label' });

  const tiles = ['Layers', 'Vector tools', 'Export'].map((label, index) => {
    const tile = createFrameNode(null, 32, 400 + index * 132, 326, 112, { name: `Feature ${index + 1}` });
    tile.fills = [solid('#1c1c3a')];
    tile.cornerRadius = 20;
    const title = text(24, 26, label, { size: 17, weight: 600, color: '#ffffff', name: 'Title' });
    const detail = text(24, 56, ['Reorder and lock', 'Precise resize', 'SVG and JSON'][index] ?? '', {
      size: 14,
      color: '#b9b9d0',
      name: 'Detail',
    });
    tile.children = [title, detail];
    return tile;
  });

  frame.children = [glow, brand, headline, body, button, buttonLabel, ...tiles];
  return frame;
}

function componentSheet(): SceneNode {
  const frame = createFrameNode(null, 1540, 940, 640, 380, { name: 'Components' });
  frame.fills = [solid('#ffffff')];
  frame.cornerRadius = 16;

  const label = text(32, 24, 'Reusable components', { size: 18, weight: 600, name: 'Section label' });

  const button = createRectNode(null, 32, 76, 200, 56);
  button.name = 'Button / Primary';
  button.cornerRadius = 28;
  button.fills = [solid('#0d0c22')];
  const buttonLabel = text(78, 96, 'Primary', { size: 16, weight: 600, color: '#ffffff', name: 'Label' });

  const chip = createRectNode(null, 32, 156, 120, 36);
  chip.name = 'Chip';
  chip.cornerRadius = 18;
  chip.fills = [solid('#e5f4ff')];
  chip.strokes = [solid('#0d99ff')];
  const chipLabel = text(56, 166, 'New', { size: 14, weight: 600, color: '#007be5', name: 'Chip label' });

  const card = createFrameNode(null, 32, 220, 300, 128, { name: 'Card' });
  card.fills = [solid('#f7f7fa')];
  card.cornerRadius = 16;
  const cardTitle = text(20, 24, 'Card title', { size: 16, weight: 600, name: 'Title' });
  const cardBody = text(20, 52, 'Compose components into frames and reuse them across pages.', {
    size: 14,
    lineHeight: 150,
    color: '#4a4a68',
    width: 260,
    autoResize: 'HEIGHT',
    name: 'Body',
  });
  card.children = [cardTitle, cardBody];

  frame.children = [label, button, buttonLabel, chip, chipLabel, card];
  return frame;
}

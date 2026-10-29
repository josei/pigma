import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cssDeclarations,
  keyframesCss,
  measurementSummary,
  measurements,
  siblingGaps,
  toCompose,
  toCss,
  toReact,
  toSwiftUI,
} from './codegen';
import { createFrameNode, createLineNode, createRectNode, createStarNode, createTextNode } from './factory';
import { setKeyEasingOp, setKeyframeOp } from './keyframes';
import { emptyFile } from './validate';
import { EFFECT_TYPES } from './effects';

function setup() {
  const file = emptyFile('Inspect');
  const page = file.document.children[0]!;
  const frame = createFrameNode(null, 100, 50, 400, 300, { name: 'Card Frame' });
  frame.cornerRadius = 16;
  const first = createRectNode(null, 24, 24, 120, 80);
  first.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.4, b: 0.9 }, opacity: 1 }];
  first.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 12, spread: 0, visible: true }];
  const second = createRectNode(null, 184, 24, 100, 80);
  const label = createTextNode(null, 24, 140, 'Hello');
  label.style = { ...label.style, fontWeight: 700, fontSize: 20 };
  frame.children = [first, second, label];
  page.children = [frame];
  return { file, frameId: frame.id, firstId: first.id, secondId: second.id, labelId: label.id };
}

describe('inspect / codegen', () => {
  it('reports size, absolute and relative position', () => {
    const { file, firstId } = setup();
    const measured = measurements(file, firstId)!;
    expect(measured.width).toBe(120);
    expect(measured.height).toBe(80);
    expect(measured.x).toBe(124);
    expect(measured.y).toBe(74);
    expect(measured.relativeX).toBe(24);
    expect(measured.relativeY).toBe(24);
    expect(measured.parentName).toBe('Card Frame');
    expect(measured.parentWidth).toBe(400);
    expect(measurements(file, 'nope')).toBeNull();
  });

  it('measures the gaps to the nearest siblings on each side', () => {
    const { file, firstId, secondId } = setup();
    const gaps = siblingGaps(file, firstId);
    // The second rect starts 40 units to the right of the first (120 wide at 24).
    expect(gaps.right).toBe(40);
    expect(gaps.left).toBeNull();
    expect(siblingGaps(file, secondId).left).toBe(40);
    expect(measurements(file, firstId)!.gaps.right).toBe(40);
  });

  it('generates CSS with the geometry, paint, radius and shadow', () => {
    const { file, firstId } = setup();
    const css = toCss(file, firstId);
    expect(css.startsWith('.rectangle-1 {')).toBe(true);
    expect(css).toContain('left: 24px;');
    expect(css).toContain('width: 120px;');
    expect(css).toContain('background: rgb(26, 102, 230);');
    // A zero spread is omitted, like Figma's own CSS output.
    expect(css).toMatch(/box-shadow: 0px 4px 12px rgba\(0, 0, 0, 0\.25\);/);
    expect(cssDeclarations(file, firstId)).toContain('position: absolute;');
  });

  it('includes corner radius and text properties', () => {
    const { file, frameId, labelId } = setup();
    expect(toCss(file, frameId)).toContain('border-radius: 16px;');
    const labelCss = toCss(file, labelId);
    expect(labelCss).toContain('font-size: 20px;');
    expect(labelCss).toContain('font-weight: 700;');
    expect(labelCss).toContain('font-family: Inter;');
  });

  it('generates a React component with the same numbers', () => {
    const { file, firstId, labelId } = setup();
    const react = toReact(file, firstId);
    expect(react).toContain('export function Rectangle1()');
    expect(react).toContain("position: 'absolute',");
    expect(react).toContain('left: 24,');
    expect(react).toContain('width: 120,');
    expect(react).toContain("background: 'rgb(26, 102, 230)',");
    expect(react).toContain('<div');

    const text = toReact(file, labelId);
    expect(text).toContain('<span');
    expect(text).toContain('Hello');
  });

  it('summarises measurements for the panel', () => {
    const { file, firstId } = setup();
    const summary = measurementSummary(measurements(file, firstId)!);
    expect(summary[0]).toBe('size    120 x 80');
    expect(summary[1]).toBe('position 124, 74');
    expect(summary.join(' ')).toContain('relative 24, 24');
    expect(summary.join(' ')).toContain('gaps');
  });

  it('returns nothing for nodes that are not inspectable', () => {
    const { file } = setup();
    expect(toCss(file, 'missing')).toBe('');
    expect(toReact(file, file.document.id)).toBe('');
    expect(cssDeclarations(file, 'missing')).toEqual([]);
  });
});

describe('mobile codegen targets (M14)', () => {
  /** A rounded, filled, stroked rectangle with a shadow, plus a bold label. */
  function scene() {
    const file = emptyFile('Mobile');
    const page = file.document.children[0]!;
    const card = createRectNode(null, 12, 20, 120, 80);
    card.cornerRadius = 8;
    card.opacity = 0.8;
    card.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 }, opacity: 1 }];
    card.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
    card.effects = [
      { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 12, spread: 0, visible: true },
    ];
    const label = createTextNode(null, 12, 120, 'Hello "Pigma"', { fontWeight: 700, fontSize: 14 });
    label.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.4, b: 0.9 }, opacity: 1 }];
    page.children = [card, label];
    return { file, cardId: card.id, labelId: label.id };
  }

  it('generates a SwiftUI view with the selection as modifiers', () => {
    const { file, cardId, labelId } = scene();
    const swift = toSwiftUI(file, cardId);

    expect(swift).toContain('struct Rectangle1View: View {');
    expect(swift).toContain('Rectangle()');
    expect(swift).toContain('.fill(Color(red: 0.85, green: 0.85, blue: 0.85))');
    expect(swift).toContain('.frame(width: 120, height: 80)');
    expect(swift).toContain('.overlay(Rectangle().stroke(Color(red: 0, green: 0, blue: 0), lineWidth: 1))');
    expect(swift).toContain('.cornerRadius(8)');
    expect(swift).toContain('.opacity(0.8)');
    expect(swift).toContain('.shadow(color: Color(red: 0, green: 0, blue: 0).opacity(0.25), radius: 12, x: 0, y: 4)');
    expect(swift).toContain('.offset(x: 12, y: 20)');

    const text = toSwiftUI(file, labelId);
    expect(text).toContain('Text("Hello \\"Pigma\\"")');
    // The design family (Inter is the app default), not the system font.
    expect(text).toContain('.font(.custom("Inter", size: 14).weight(.bold))');
    expect(text).toContain('.foregroundColor(Color(red: 0.1, green: 0.4, blue: 0.9))');
    // Nothing is emitted that the model cannot back up.
    expect(swift).not.toMatch(/undefined|NaN/);
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it('generates a Compose composable with the selection as modifiers', () => {
    const { file, cardId, labelId } = scene();
    const compose = toCompose(file, cardId);

    expect(compose).toContain('@Composable');
    expect(compose).toContain('fun Rectangle1() {');
    expect(compose).toContain('.offset(x = 12.dp, y = 20.dp)');
    expect(compose).toContain('.size(width = 120.dp, height = 80.dp)');
    expect(compose).toContain('.clip(RoundedCornerShape(8.dp))');
    expect(compose).toContain('.background(color = Color(0xFFD9D9D9), shape = RectangleShape())');
    expect(compose).toContain('.border(width = 1.dp, color = Color(0xFF000000), shape = RectangleShape())');
    expect(compose).toContain('.alpha(0.8f)');
    expect(compose).toContain('.shadow(elevation = 12.dp');

    const text = toCompose(file, labelId);
    expect(text).toContain('Text(');
    expect(text).toContain('text = "Hello \\"Pigma\\"",');
    expect(text).toContain('fontSize = 14.sp,');
    expect(text).toContain('fontWeight = FontWeight.Bold,');
    expect(text).toContain('color = Color(0xFF1A66E6),');
    // A text layer's fill is its colour, never a background.
    expect(text).not.toContain('.background(');
    expect(compose).not.toMatch(/undefined|NaN/);
  });

  it('comments what a target cannot represent instead of faking it', () => {
    const file = emptyFile('Unsupported');
    const page = file.document.children[0]!;
    const star = createStarNode(null, 0, 0, 100, 100);
    const gradient = createRectNode(null, 120, 0, 100, 100);
    gradient.fills = [{ type: 'GRADIENT_LINEAR', opacity: 1 } as never];
    const layout = createFrameNode(null, 0, 120, 200, 200);
    (layout as { layoutMode?: string }).layoutMode = 'VERTICAL';
    page.children = [star, gradient, layout];

    const swiftStar = toSwiftUI(file, star.id);
    expect(swiftStar).toContain('// Not represented: STAR geometry (5 points) has no primitive in this target');
    // No rectangle pretending to be the star.
    expect(swiftStar).not.toContain('Rectangle()');

    const composeStar = toCompose(file, star.id);
    expect(composeStar).toContain('// Not represented: STAR geometry (5 points) has no primitive in this target');
    expect(composeStar).toContain("this layer's geometry is not drawn");

    const composeGradient = toCompose(file, gradient.id);
    expect(composeGradient).toContain('// Not represented: the GRADIENT_LINEAR fill (0 stops) is not generated');
    expect(composeGradient).not.toContain('.background(color = Color(0xFF');

    const composeLayout = toCompose(file, layout.id);
    expect(composeLayout).toContain('// Not represented: auto layout (VERTICAL) is not generated');
  });

  it('does not invent a shape for a shadow when the geometry was omitted', () => {
    const file = emptyFile('Shadow');
    const page = file.document.children[0]!;
    const shadow = [
      { type: 'DROP_SHADOW' as const, color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 8, spread: 0, visible: true },
    ];
    const star = createStarNode(null, 0, 0, 100, 100);
    star.effects = shadow;
    const rect = createRectNode(null, 120, 0, 100, 100);
    rect.effects = shadow;
    page.children = [star, rect];

    // The star's geometry is omitted, so its shadow must not cast a rectangle
    // either — that was the one place the "omit rather than fake" rule leaked.
    const composeStar = toCompose(file, star.id);
    expect(composeStar).toContain('.shadow(elevation = 8.dp, ambientColor =');
    expect(composeStar).not.toContain('shape = RectangleShape(), ambientColor');
    expect(composeStar).not.toContain('RectangleShape()');

    // A rectangle does have a primitive, so its shadow names that shape.
    const composeRect = toCompose(file, rect.id);
    expect(composeRect).toContain('.shadow(elevation = 8.dp, shape = RectangleShape(), ambientColor =');
  });

  it('carries the design font family, not the system font', () => {
    const file = emptyFile('Family');
    const page = file.document.children[0]!;
    const label = createTextNode(null, 0, 0, 'Hello', { fontFamily: 'Inter', fontSize: 20, fontWeight: 700 });
    page.children = [label];

    // SwiftUI can name a family, so it does — with the weight applied after,
    // because `.custom(_:size:)` takes no weight.
    const swift = toSwiftUI(file, label.id);
    expect(swift).toContain('.font(.custom("Inter", size: 20).weight(.bold))');
    expect(swift).not.toContain('.system(');

    // Compose needs a font resource the generator cannot know, so the family is
    // named in a note rather than dropped in silence.
    const compose = toCompose(file, label.id);
    // The note names the family: "the font family is not generated" would leave
    // a developer with nothing to add to res/font.
    expect(compose).toContain('font family "Inter" is not generated');
    expect(compose).toContain('fontSize = 20.sp,');
  });

  it('emits letter spacing, line height, alignment, case and decoration', () => {
    const file = emptyFile('Typography');
    const page = file.document.children[0]!;
    const label = createTextNode(null, 0, 0, 'Hello', {
      fontFamily: 'Inter',
      fontSize: 20,
      fontWeight: 700,
      letterSpacing: { unit: 'PERCENT', value: 5 },
      lineHeight: { unit: 'PERCENT', value: 150 },
      textAlignHorizontal: 'CENTER',
      textCase: 'UPPER',
      textDecoration: 'UNDERLINE',
    });
    page.children = [label];

    const swift = toSwiftUI(file, label.id);
    expect(swift).toContain('.tracking(1)'); // 5% of 20pt
    expect(swift).toContain('.lineSpacing(6)'); // 150% of 20pt minus the default leading
    expect(swift).toContain('.multilineTextAlignment(.center)');
    expect(swift).toContain('.textCase(.uppercase)');
    expect(swift).toContain('.underline()');

    const compose = toCompose(file, label.id);
    expect(compose).toContain('text = "Hello".uppercase(),');
    expect(compose).toContain('letterSpacing = 1.sp,');
    expect(compose).toContain('lineHeight = 30.sp,');
    expect(compose).toContain('textAlign = TextAlign.Center,');
    expect(compose).toContain('textDecoration = TextDecoration.Underline,');
  });

  it('notes the fields a target cannot express instead of dropping them', () => {
    const file = emptyFile('Notes');
    const page = file.document.children[0]!;
    const video = createRectNode(null, 0, 0, 100, 100);
    video.fills = [{ type: 'VIDEO', opacity: 1 } as never];
    video.strokes = [{ type: 'GRADIENT_LINEAR', opacity: 1 } as never];
    video.blendMode = 'MULTIPLY';
    video.effects = [
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.5 },
        offset: { x: 0, y: 2 },
        radius: 4,
        spread: 0,
        visible: true,
        showShadowBehindNode: false,
      },
    ];
    page.children = [video];

    for (const [target, output] of [
      ['swift', toSwiftUI(file, video.id)],
      ['compose', toCompose(file, video.id)],
    ] as const) {
      expect(output, target).toContain('the VIDEO paint (scaleMode FILL) is not generated');
      expect(output, target).toContain('the GRADIENT_LINEAR stroke (0 stops) is not generated');
      expect(output, target).toContain('the GRADIENT_LINEAR fill (0 stops) is not generated');
      expect(output, target).toContain('showShadowBehindNode: false is not generated');
      // The blend mode is named, with wording that fits the platform.
      expect(output, target).toContain('the blend mode (MULTIPLY) is not generated');
      expect(output, target).toContain(target === 'swift' ? '.blendMode' : 'graphics layer');
    }
  });

  it('omits output entirely when there is nothing to generate', () => {
    const file = emptyFile('Empty');
    const page = file.document.children[0]!;
    expect(toSwiftUI(file, page.id)).toBe('');
    expect(toCompose(file, page.id)).toBe('');
    expect(toSwiftUI(file, 'missing')).toBe('');
    expect(toCompose(file, 'missing')).toBe('');
  });
});

describe('every "Not represented" note names what was dropped', () => {
  it('names the property and its value in both mobile targets', () => {
    const file = emptyFile('Audit');
    const page = file.document.children[0]!;
    const label = createTextNode(null, 0, 0, 'Hi', { fontFamily: 'Playfair Display', paragraphSpacing: 8 });
    label.blendMode = 'MULTIPLY';
    const star = createStarNode(null, 0, 100, 80, 80);
    star.pointCount = 7;
    const busy = createRectNode(null, 0, 200, 80, 80);
    busy.fills = [{ type: 'GRADIENT_LINEAR', opacity: 1 } as never];
    busy.strokes = [{ type: 'VIDEO', opacity: 1 } as never];
    busy.effects = [
      { type: 'LAYER_BLUR', radius: 6, visible: true },
      { type: 'INNER_SHADOW', color: { r: 0, g: 0, b: 0, a: 1 }, offset: { x: 0, y: 1 }, radius: 2, spread: 0, visible: true },
    ] as never;
    page.children = [label, star, busy];

    const notesOf = (text: string) => text.split('\n').filter((line) => line.startsWith('// Not represented'));
    const expected = [
      'the blend mode (MULTIPLY) is not generated',
      'paragraph spacing (8) is not generated',
      'STAR geometry (7 points) has no primitive',
      'the GRADIENT_LINEAR fill (0 stops) is not generated',
      'the VIDEO paint (scaleMode FILL) is not generated',
      'the VIDEO stroke (scaleMode FILL) is not generated',
      '1 INNER_SHADOW effect not generated',
      'the LAYER_BLUR (radius 6) is not generated',
    ];

    for (const output of [toSwiftUI(file, label.id), toSwiftUI(file, star.id), toSwiftUI(file, busy.id), toCompose(file, busy.id)]) {
      for (const note of notesOf(output)) {
        expect(isSpecificNote(note), `this note names nothing specific: ${note}`).toBe(true);
      }
    }

    // The exact notes, so a future reword cannot quietly lose the value again.
    const all = [
      ...notesOf(toSwiftUI(file, label.id)),
      ...notesOf(toSwiftUI(file, star.id)),
      ...notesOf(toSwiftUI(file, busy.id)),
      ...notesOf(toCompose(file, label.id)),
    ];
    for (const fragment of expected) {
      expect(all.join('\n'), `no note says "${fragment}"`).toContain(fragment);
    }
    // The Compose font-family note names the family (the defect QA found).
    expect(toCompose(file, label.id)).toContain('font family "Playfair Display" is not generated');
  });

  it('emits the blend mode in CSS and React instead of noting it', () => {
    // CSS expresses every mode Figma uses, so this target does not need a note —
    // the note is only for what a target genuinely lacks (Swift and Compose).
    const file = emptyFile('Blend');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 100, 100);
    rect.blendMode = 'MULTIPLY';
    page.children = [rect];

    expect(toCss(file, rect.id)).toContain('mix-blend-mode: multiply;');
    expect(toReact(file, rect.id)).toContain("mixBlendMode: 'multiply'");
    // A normal layer gets no declaration at all.
    const plain = createRectNode(null, 0, 0, 10, 10);
    page.children = [plain];
    expect(toCss(file, plain.id)).not.toContain('mix-blend-mode');
  });
});

/**
 * True when a "Not represented" note names the property AND a concrete value.
 *
 * The audit exists to forbid bare notes, so the predicate must not accept a
 * feature name on its own: "the FILL is not generated" says nothing a developer
 * can act on, and an ALL-CAPS word is not evidence of specificity unless it is an
 * actual model enum *and* a value accompanies it.
 */
const MODEL_ENUMS = new Set([
  // Paints
  'GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND', 'IMAGE', 'VIDEO', 'PATTERN', 'SOLID',
  // Effects
  ...EFFECT_TYPES,
  // Node types
  'VECTOR', 'BOOLEAN_OPERATION', 'POLYGON', 'STAR', 'RECTANGLE', 'ELLIPSE', 'TEXT', 'FRAME', 'INSTANCE', 'COMPONENT',
  // Blend modes and layout enums
  'MULTIPLY', 'SCREEN', 'OVERLAY', 'DARKEN', 'LIGHTEN', 'COLOR_DODGE', 'COLOR_BURN', 'HARD_LIGHT', 'SOFT_LIGHT',
  'DIFFERENCE', 'EXCLUSION', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY', 'VERTICAL', 'HORIZONTAL',
]);

function isSpecificNote(note: string): boolean {
  const body = note.replace(/^\/\/\s*Not represented:\s*/i, '');
  // A quoted name, a parenthesised value, an explicit boolean, or a counted effect.
  if (/"[^"]+"/.test(body)) return true;
  if (/\([^)]*[A-Za-z0-9][^)]*\)/.test(body)) return true;
  if (/: (true|false)\b/.test(body)) return true;
  if (/\b\d+\s+[A-Z][A-Z_]{3,}\s+effects?\b/.test(body)) return true;
  // A model enum counts only with a value beside it: "the LAYER_BLUR (radius 6)"
  // is specific, "the FILL is not generated" is not.
  const enums = [...body.matchAll(/\b([A-Z][A-Z_]{3,})\b/g)].map((match) => match[1]!);
  return enums.some((token) => MODEL_ENUMS.has(token)) && /\d/.test(body);
}

describe('the note-specificity predicate itself', () => {
  it('rejects a bare feature name and accepts a property with a value', () => {
    // The class of note the audit exists to forbid: a feature, no property, no value.
    for (const bare of [
      '// Not represented: the FILL is not generated',
      '// Not represented: the blend mode is not generated',
      '// Not represented: gradient fills are not generated',
      '// Not represented: blurs are not generated',
      '// Not represented: the design font family is not generated',
    ]) {
      expect(isSpecificNote(bare), `this bare note was accepted: ${bare}`).toBe(false);
    }

    // The real notes, one per shape of value.
    for (const specific of [
      '// Not represented: font family "Playfair Display" is not generated',
      '// Not represented: the blend mode (MULTIPLY) is not generated',
      '// Not represented: showShadowBehindNode: false is not generated',
      '// Not represented: 1 INNER_SHADOW effect not generated',
      '// Not represented: the LAYER_BLUR (radius 6) is not generated',
      '// Not represented: STAR geometry (7 points) has no primitive in this target',
      '// Not represented: auto layout (VERTICAL) is not generated',
      '// Not represented: the VIDEO paint (scaleMode FILL) is not generated',
    ]) {
      expect(isSpecificNote(specific), `this specific note was rejected: ${specific}`).toBe(true);
    }
  });
});

describe('CSS for keyframes', () => {
  /** A page with one rectangle named "Card", keyed by the given opacity keys (time, value). */
  function keyed(keys: Array<[number, number]>) {
    const file = emptyFile('Motion');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 100, 60);
    rect.name = 'Card';
    page.children = [rect];
    const withKeys = keys.reduce((next, [time, value]) => setKeyframeOp(next, rect.id, 'opacity', time, value), file);
    return { file: withKeys, id: rect.id };
  }

  it('gives a keyframe at each key time, at its percentage of the span to the last key, with the values there', () => {
    const { file, id } = keyed([
      [0, 1],
      [500, 0.4],
      [1000, 0.4],
    ]);
    const css = keyframesCss(file, id);
    expect(css).toContain('@keyframes card-motion {');
    expect(css).toContain('0% {\n    opacity: 1;');
    expect(css).toContain('50% {\n    opacity: 0.4;');
    expect(css).toContain('100% {\n    opacity: 0.4;');
  });

  it('gives an eased key an ease-in-out timing, and a rotation key a rotate transform', () => {
    const { file, id } = keyed([
      [0, 1],
      [1000, 0],
    ]);
    const eased = setKeyEasingOp(file, id, 'opacity', 0, 'EASE_IN_OUT');
    expect(keyframesCss(eased, id)).toContain('0% {\n    opacity: 1;\n    animation-timing-function: ease-in-out;');
    const turned = setKeyframeOp(file, id, 'rotation', 1000, 90);
    expect(keyframesCss(turned, id)).toContain('100% {\n    opacity: 0;\n    transform: rotate(90deg);');
  });

  it('gives an ease-in key and an ease-out key their own CSS timing functions', () => {
    const { file, id } = keyed([
      [0, 1],
      [1000, 0],
    ]);
    expect(keyframesCss(setKeyEasingOp(file, id, 'opacity', 0, 'EASE_IN'), id)).toContain('0% {\n    opacity: 1;\n    animation-timing-function: ease-in;');
    expect(keyframesCss(setKeyEasingOp(file, id, 'opacity', 0, 'EASE_OUT'), id)).toContain('0% {\n    opacity: 1;\n    animation-timing-function: ease-out;');
  });

  it('is empty for a layer with no keys, or whose keys are all at time 0', () => {
    const { file, id } = keyed([]);
    expect(keyframesCss(file, id)).toBe('');
    expect(keyframesCss(keyed([[0, 1]]).file, keyed([[0, 1]]).id)).toBe('');
  });

  it('adds the animation declaration and the @keyframes block to the copied CSS of a keyed layer', () => {
    const { file, id } = keyed([
      [0, 1],
      [1000, 0.4],
    ]);
    const css = toCss(file, id);
    expect(css).toContain('.card {');
    expect(css).toContain('  animation: card-motion 1000ms linear both;');
    expect(css).toContain('@keyframes card-motion {');
    const plain = keyed([]);
    expect(toCss(plain.file, plain.id)).not.toContain('@keyframes');
  });
});


describe('React for keyframes', () => {
  it('gives a keyed layer its animation style and a <style> element with the @keyframes, and leaves an unkeyed layer as it was', () => {
    const file = emptyFile('Motion');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 100, 60);
    rect.name = 'Card';
    page.children = [rect];
    const keyed = setKeyframeOp(setKeyframeOp(file, rect.id, 'opacity', 0, 1), rect.id, 'opacity', 1000, 0.4);
    const component = toReact(keyed, rect.id);
    expect(component).toContain("animation: 'card-motion 1000ms linear both',");
    expect(component).toContain('<style>{`@keyframes card-motion {');
    expect(component).toContain('<>');
    const plain = toReact(file, rect.id);
    expect(plain).not.toContain('<style>');
    expect(plain).not.toContain('<>');
  });
});

describe('SwiftUI for keyframes', () => {
  /** A 120 x 80 rectangle named "Card", keyed in opacity (1 at 0 ms, 0.4 at 1000 ms) and turned 90 degrees at 1000 ms. */
  function animated() {
    const file = emptyFile('Motion');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 120, 80);
    rect.name = 'Card';
    page.children = [rect];
    let keyed = setKeyframeOp(file, rect.id, 'opacity', 0, 1);
    keyed = setKeyframeOp(keyed, rect.id, 'opacity', 1000, 0.4);
    keyed = setKeyframeOp(keyed, rect.id, 'rotation', 1000, 90);
    return { file: keyed, id: rect.id };
  }

  it('animates a keyed layer with a KeyframeAnimator, a track per keyed property, and segment durations in seconds', () => {
    const { file, id } = animated();
    const swift = toSwiftUI(file, id);
    expect(swift).toContain('struct CardMotion: Equatable {');
    expect(swift).toContain('KeyframeAnimator(initialValue: CardMotion(), repeating: false) { values in');
    expect(swift).toContain('KeyframeTrack(\\.opacity) {');
    expect(swift).toContain('LinearKeyframe(1, duration: 0)');
    expect(swift).toContain('LinearKeyframe(0.4, duration: 1)');
    expect(swift).toContain('KeyframeTrack(\\.rotation) {');
    expect(swift).toContain('LinearKeyframe(90, duration: 1)');
    expect(swift).toContain('.opacity(values.opacity)');
    expect(swift).toContain('.rotationEffect(.degrees(values.rotation))');
  });

  it('sizes a stroked box to its stroke: a centred stroke grows the box by half on each side, an inside stroke leaves it, and a border-box keeps the size', () => {
    const file = emptyFile('Boxed');
    const page = file.document.children[0]!;
    const make = (align: 'CENTER' | 'INSIDE' | 'OUTSIDE') => {
      const rect = createRectNode(null, 0, 0, 100, 60);
      rect.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
      rect.strokeWeight = 10;
      rect.strokeAlign = align;
      page.children = [...page.children, rect];
      return rect.id;
    };
    const centred = toCss(file, make('CENTER'));
    expect(centred).toContain('left: -5px;');
    expect(centred).toContain('width: 110px;');
    expect(centred).toContain('height: 70px;');
    expect(centred).toContain('box-sizing: border-box;');
    const inside = toCss(file, make('INSIDE'));
    expect(inside).toContain('left: 0px;');
    expect(inside).toContain('width: 100px;');
    const outside = toCss(file, make('OUTSIDE'));
    expect(outside).toContain('left: -10px;');
    expect(outside).toContain('width: 120px;');
  });

  it('draws a line in CSS with one top border, as a box of no height: a full border would draw it twice', () => {
    const file = emptyFile('CssLine');
    const page = file.document.children[0]!;
    const line = createLineNode(null, 0, 0, 100);
    line.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    line.strokeWeight = 4;
    page.children = [line];
    const css = toCss(file, line.id);
    expect(css).toContain('border-top: 4px solid rgb(0, 0, 0);');
    expect(css).not.toMatch(/\n  border: /);
    // The stroke is centred on the line's y, so the box starts half a weight above it: 2px above a line at y 0.
    expect(css).toContain('top: -2px;');
    expect(toReact(file, line.id)).toContain('borderTop');
  });

  it('draws an arrow line in React with an SVG child for its heads, placed on the stroke\'s centre line', () => {
    const file = emptyFile('ReactArrow');
    const page = file.document.children[0]!;
    const line = createLineNode(null, 0, 0, 100);
    line.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    line.strokeWeight = 4;
    line.strokeCap = 'ARROW_EQUILATERAL';
    page.children = [line];
    const react = toReact(file, line.id);
    expect(react).toContain('<svg');
    expect(react).toContain('top: -2, overflow');
    expect(react).toContain('<path d="M 0 0 L 20 11.547 L 20 -11.547 Z M 100 0 L 80 -11.547 L 80 11.547 Z" fill="rgb(0, 0, 0)" stroke="none" />');
  });

  it('gives a dashed stroke a dashed border in CSS and React, and a StrokeStyle with its pattern and offset in SwiftUI', () => {
    const file = emptyFile('Dashed');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 120, 80);
    rect.name = 'Dashed';
    rect.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    rect.strokeWeight = 2;
    rect.dashPattern = [8, 4];
    rect.dashOffset = 3;
    page.children = [rect];
    expect(toCss(file, rect.id)).toContain('border: 2px dashed');
    expect(toReact(file, rect.id)).toContain('dashed');
    const swift = toSwiftUI(file, rect.id);
    expect(swift).toContain('.overlay(Rectangle().stroke(Color(red: 0, green: 0, blue: 0), style: StrokeStyle(lineWidth: 2, miterLimit: 4, dash: [8, 4], dashPhase: 3)))');
  });

  it('leaves an unkeyed layer as the plain SwiftUI view it was', () => {
    const file = emptyFile('Plain');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 120, 80);
    rect.name = 'Card';
    page.children = [rect];
    const swift = toSwiftUI(file, rect.id);
    expect(swift).not.toContain('KeyframeAnimator');
    expect(swift).toContain('struct CardView: View {');
  });

  const swiftcAvailable = (() => {
    try {
      execFileSync('swiftc', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!swiftcAvailable)('the generated view for a keyed layer typechecks in Swift against SwiftUI', () => {
    const { file, id } = animated();
    const dir = mkdtempSync(join(tmpdir(), 'pigma-swiftui-'));
    const source = join(dir, 'Card.swift');
    writeFileSync(source, `import SwiftUI\n\n${toSwiftUI(file, id)}`);
    const target = process.arch === 'arm64' ? 'arm64-apple-macos14' : 'x86_64-apple-macos14';
    expect(() => execFileSync('swiftc', ['-typecheck', '-target', target, source], { stdio: 'pipe' })).not.toThrow();
  });

  it('gives a stroke its cap, its join and its miter limit in the StrokeStyle, and leaves a plain line as lineWidth', () => {
    const file = emptyFile('Caps');
    const page = file.document.children[0]!;
    const round = createRectNode(null, 0, 0, 120, 80);
    round.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    round.strokeWeight = 6;
    round.strokeCap = 'ROUND';
    round.strokeJoin = 'BEVEL';
    const sharp = createRectNode(null, 0, 0, 120, 80);
    sharp.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    sharp.strokeWeight = 2;
    sharp.strokeMiterLimit = 2;
    const plain = createRectNode(null, 0, 0, 120, 80);
    plain.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    plain.strokeWeight = 2;
    page.children = [round, sharp, plain];
    expect(toSwiftUI(file, round.id)).toContain('style: StrokeStyle(lineWidth: 6, lineCap: .round, lineJoin: .bevel))');
    expect(toSwiftUI(file, sharp.id)).toContain('style: StrokeStyle(lineWidth: 2, miterLimit: 2))');
    expect(toSwiftUI(file, plain.id)).toContain('.stroke(Color(red: 0, green: 0, blue: 0), lineWidth: 2))');
  });

  it.skipIf(!swiftcAvailable)('the SwiftUI view for a stroke with a cap and a join typechecks in Swift', () => {
    const file = emptyFile('Caps');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 120, 80);
    rect.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    rect.strokeWeight = 6;
    rect.strokeCap = 'SQUARE';
    rect.strokeJoin = 'MITER';
    rect.strokeMiterLimit = 3;
    rect.dashPattern = [8, 4];
    page.children = [rect];
    const dir = mkdtempSync(join(tmpdir(), 'pigma-swiftui-caps-'));
    const source = join(dir, 'Caps.swift');
    writeFileSync(source, `import SwiftUI\n\n${toSwiftUI(file, rect.id)}`);
    const target = process.arch === 'arm64' ? 'arm64-apple-macos14' : 'x86_64-apple-macos14';
    expect(() => execFileSync('swiftc', ['-typecheck', '-target', target, source], { stdio: 'pipe' })).not.toThrow();
  });

  it('gives a linear gradient fill and a radial gradient stroke SwiftUI gradients, laid out as the canvas lays them out', () => {
    const file = emptyFile('Gradient');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 120, 80);
    rect.fills = [
      {
        type: 'GRADIENT_LINEAR',
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
        opacity: 1,
      } as never,
    ];
    rect.strokes = [
      {
        type: 'GRADIENT_RADIAL',
        gradientStops: [
          { position: 0, color: { r: 0, g: 1, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 0, a: 0.5 } },
        ],
        opacity: 1,
      } as never,
    ];
    rect.strokeWeight = 4;
    page.children = [rect];
    const swift = toSwiftUI(file, rect.id);
    expect(swift).toContain(
      '.fill(LinearGradient(gradient: Gradient(stops: [Gradient.Stop(color: Color(red: 1, green: 0, blue: 0), location: 0), Gradient.Stop(color: Color(red: 0, green: 0, blue: 1), location: 1)]), startPoint: .leading, endPoint: .trailing))',
    );
    // The radial gradient is centred, with the radius of half the shorter side (60 for an 80 tall box, so 40).
    expect(swift).toContain('.stroke(RadialGradient(gradient: Gradient(stops: [Gradient.Stop(color: Color(red: 0, green: 1, blue: 0), location: 0), Gradient.Stop(color: Color(red: 0, green: 0, blue: 0).opacity(0.5), location: 1)]), center: .center, startRadius: 0, endRadius: 40), lineWidth: 4)');
    // Drawn gradients are not gaps in SwiftUI; Compose still reports them, with the real stop count.
    expect(swift).not.toContain('// Not represented');
    expect(toCompose(file, rect.id)).toContain('the GRADIENT_LINEAR fill (2 stops) is not generated');
  });

  it('moves a gradient\'s start, end and centre by its transform, in the unit square of the box', () => {
    const file = emptyFile('Moved');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 120, 80);
    rect.fills = [
      {
        type: 'GRADIENT_LINEAR',
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
        opacity: 1,
        gradientTransform: [
          [1, 0, 0.25],
          [0, 1, 0.5],
        ],
      } as never,
    ];
    rect.strokes = [
      {
        type: 'GRADIENT_RADIAL',
        gradientStops: [
          { position: 0, color: { r: 0, g: 1, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
        ],
        opacity: 1,
        gradientTransform: [
          [1, 0, 0.25],
          [0, 1, 0.5],
        ],
      } as never,
    ];
    rect.strokeWeight = 4;
    page.children = [rect];
    const swift = toSwiftUI(file, rect.id);
    expect(swift).toContain('startPoint: UnitPoint(x: 0.25, y: 0.5), endPoint: UnitPoint(x: 1.25, y: 0.5)');
    expect(swift).toContain('center: UnitPoint(x: 0.75, y: 1)');
  });

  it('gives an angular gradient an AngularGradient that starts at the top of its box and runs clockwise', () => {
    const file = emptyFile('Angular');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 120, 80);
    rect.fills = [
      {
        type: 'GRADIENT_ANGULAR',
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
        opacity: 1,
      } as never,
    ];
    rect.strokes = [];
    page.children = [rect];
    const swift = toSwiftUI(file, rect.id);
    expect(swift).toContain(
      '.fill(AngularGradient(gradient: Gradient(stops: [Gradient.Stop(color: Color(red: 1, green: 0, blue: 0), location: 0), Gradient.Stop(color: Color(red: 0, green: 0, blue: 1), location: 1)]), center: .center, startAngle: .degrees(270), endAngle: .degrees(630)))',
    );
    expect(swift).not.toContain('// Not represented');
  });

  it('draws an equilateral arrow line\'s heads in CSS as two clipped triangles, placed on the stroke\'s centre line', () => {
    const file = emptyFile('CssArrow');
    const page = file.document.children[0]!;
    const line = createLineNode(null, 0, 0, 100);
    line.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    line.strokeWeight = 4;
    line.strokeCap = 'ARROW_EQUILATERAL';
    page.children = [line];
    const css = toCss(file, line.id);
    // Each head is five weights long, 20 units, and its base is 2 x 20 / root 3 = 23.09 across, centred half a weight above the padding.
    expect(css).toContain('.line-1::before {');
    expect(css).toContain('clip-path: polygon(0 50%, 100% 0, 100% 100%);');
    expect(css).toContain('top: -13.55px;');
    expect(css).toContain('height: 23.09px;');
    expect(css).toContain('.line-1::after {');
    expect(css).toContain('left: 80px;');
    expect(css).toContain('clip-path: polygon(0 0, 100% 50%, 0 100%);');
  });

  it('draws an arrow line\'s chevron in CSS as a V band clipped in a box of its arms plus a weight, at each end', () => {
    const file = emptyFile('CssChevron');
    const page = file.document.children[0]!;
    const line = createLineNode(null, 0, 0, 240);
    line.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    line.strokeWeight = 4;
    line.strokeCap = 'ARROW_LINES';
    page.children = [line];
    const css = toCss(file, line.id);
    // The arms are 5 weights, 20 units, so the box is 20 + 2 x 4 = 28 across and tall; its top is half a weight and half its height above
    // the line. The start's box sits a weight left of the line's start, and the end's a weight short of its right end, at 240 - 28 + 4.
    expect(css).toContain('.line-1::before {');
    expect(css).toContain('left: -4px;');
    expect(css).toContain('top: -16px;');
    expect(css).toContain('width: 28px;');
    expect(css).toContain('height: 28px;');
    expect(css).toContain('.line-1::after {');
    expect(css).toContain('left: 216px;');
    expect(css).not.toContain('ARROW_LINES');
  });

  it('writes CSS gradients the canvas\'s own way: a conic from the top for angular, an ellipse for radial, and a border image for a gradient stroke', () => {
    const file = emptyFile('CssGradients');
    const page = file.document.children[0]!;
    const stops = [
      { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
    ];
    const angular = createRectNode(null, 0, 0, 120, 80);
    angular.fills = [{ type: 'GRADIENT_ANGULAR', gradientStops: stops, opacity: 1 } as never];
    const radial = createRectNode(null, 0, 0, 120, 80);
    radial.fills = [{ type: 'GRADIENT_RADIAL', gradientStops: stops, opacity: 1 } as never];
    const framed = createRectNode(null, 0, 0, 120, 80);
    framed.strokes = [{ type: 'GRADIENT_LINEAR', gradientStops: stops, opacity: 1 } as never];
    framed.strokeWeight = 4;
    const line = createLineNode(null, 0, 0, 100);
    line.strokes = [{ type: 'GRADIENT_LINEAR', gradientStops: stops, opacity: 1 } as never];
    line.strokeWeight = 4;
    page.children = [angular, radial, framed, line];
    expect(toCss(file, angular.id)).toContain('background: conic-gradient(from 0deg at 50% 50%, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%);');
    expect(toCss(file, radial.id)).toContain('background: radial-gradient(ellipse 50% 50% at 50% 50%, ');
    const framedCss = toCss(file, framed.id);
    expect(framedCss).toContain('border: 4px solid transparent;');
    expect(framedCss).toContain('border-image: linear-gradient(90deg, ');
    // A line's border cannot take an image: it takes the colour at the middle of its ramp.
    expect(toCss(file, line.id)).toContain('border-top: 4px solid rgb(');
    expect(toCss(file, line.id)).not.toContain('linear-gradient');
  });

  it.skipIf(!swiftcAvailable)('the SwiftUI view for an angular gradient typechecks in Swift', () => {
    const file = emptyFile('AngularView');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 120, 80);
    rect.fills = [
      {
        type: 'GRADIENT_ANGULAR',
        gradientStops: [
          { position: 0, color: { r: 1, g: 1, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
        opacity: 1,
      } as never,
    ];
    rect.strokes = [
      {
        type: 'GRADIENT_ANGULAR',
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 1, b: 0, a: 1 } },
        ],
        opacity: 1,
      } as never,
    ];
    rect.strokeWeight = 4;
    page.children = [rect];
    const dir = mkdtempSync(join(tmpdir(), 'pigma-swiftui-angular-'));
    const source = join(dir, 'AngularView.swift');
    writeFileSync(source, `import SwiftUI\n\n${toSwiftUI(file, rect.id)}`);
    const target = process.arch === 'arm64' ? 'arm64-apple-macos14' : 'x86_64-apple-macos14';
    expect(() => execFileSync('swiftc', ['-typecheck', '-target', target, source], { stdio: 'pipe' })).not.toThrow();
  });

  it.skipIf(!swiftcAvailable)('the SwiftUI view for a transformed gradient typechecks in Swift', () => {
    const file = emptyFile('MovedView');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 120, 80);
    rect.fills = [
      {
        type: 'GRADIENT_LINEAR',
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
        opacity: 1,
        gradientTransform: [
          [1, 0, 0.25],
          [0, 1, 0.5],
        ],
      } as never,
    ];
    rect.strokes = [
      {
        type: 'GRADIENT_RADIAL',
        gradientStops: [
          { position: 0, color: { r: 0, g: 1, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
        ],
        opacity: 1,
        gradientTransform: [
          [1, 0, 0.25],
          [0, 1, 0.5],
        ],
      } as never,
    ];
    rect.strokeWeight = 4;
    page.children = [rect];
    const dir = mkdtempSync(join(tmpdir(), 'pigma-swiftui-moved-'));
    const source = join(dir, 'MovedView.swift');
    writeFileSync(source, `import SwiftUI\n\n${toSwiftUI(file, rect.id)}`);
    const target = process.arch === 'arm64' ? 'arm64-apple-macos14' : 'x86_64-apple-macos14';
    expect(() => execFileSync('swiftc', ['-typecheck', '-target', target, source], { stdio: 'pipe' })).not.toThrow();
  });

  it.skipIf(!swiftcAvailable)('the SwiftUI view for a gradient fill and stroke typechecks in Swift', () => {
    const file = emptyFile('GradientView');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 120, 80);
    rect.fills = [
      {
        type: 'GRADIENT_RADIAL',
        gradientStops: [
          { position: 0, color: { r: 1, g: 1, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
        opacity: 1,
      } as never,
    ];
    rect.strokes = [
      {
        type: 'GRADIENT_LINEAR',
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
        opacity: 1,
      } as never,
    ];
    rect.strokeWeight = 4;
    page.children = [rect];
    const dir = mkdtempSync(join(tmpdir(), 'pigma-swiftui-gradient-'));
    const source = join(dir, 'GradientView.swift');
    writeFileSync(source, `import SwiftUI\n\n${toSwiftUI(file, rect.id)}`);
    const target = process.arch === 'arm64' ? 'arm64-apple-macos14' : 'x86_64-apple-macos14';
    expect(() => execFileSync('swiftc', ['-typecheck', '-target', target, source], { stdio: 'pipe' })).not.toThrow();
  });

  it('draws a line as a path, with an equilateral arrow as a filled path at each end', () => {
    const file = emptyFile('Arrow');
    const page = file.document.children[0]!;
    const line = createLineNode(null, 0, 0, 100);
    line.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    line.strokeWeight = 4;
    line.strokeCap = 'ARROW_EQUILATERAL';
    page.children = [line];
    const swift = toSwiftUI(file, line.id);
    expect(swift).not.toContain('Rectangle()');
    expect(swift).toContain('ZStack(alignment: .topLeading) {');
    expect(swift).toContain('path.move(to: CGPoint(x: 0, y: 0))');
    expect(swift).toContain('path.addLine(to: CGPoint(x: 100, y: 0))');
    expect(swift).toContain('.stroke(Color(red: 0, green: 0, blue: 0), lineWidth: 4)');
    // Two heads, each a closed triangle, filled with the stroke's colour.
    expect(swift.split('path.closeSubpath()')).toHaveLength(3);
    expect(swift).toContain('.fill(Color(red: 0, green: 0, blue: 0))');
  });

  it.skipIf(!swiftcAvailable)('the SwiftUI view for a line with arrow heads and a dash typechecks in Swift', () => {
    const file = emptyFile('ArrowLine');
    const page = file.document.children[0]!;
    const line = createLineNode(null, 0, 0, 100);
    line.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    line.strokeWeight = 4;
    line.strokeCap = 'ARROW_LINES';
    line.dashPattern = [8, 4];
    page.children = [line];
    const dir = mkdtempSync(join(tmpdir(), 'pigma-swiftui-line-'));
    const source = join(dir, 'ArrowLine.swift');
    writeFileSync(source, `import SwiftUI\n\n${toSwiftUI(file, line.id)}`);
    const target = process.arch === 'arm64' ? 'arm64-apple-macos14' : 'x86_64-apple-macos14';
    expect(() => execFileSync('swiftc', ['-typecheck', '-target', target, source], { stdio: 'pipe' })).not.toThrow();
  });

  it.skipIf(!swiftcAvailable)('the SwiftUI view for a dashed stroke typechecks in Swift', () => {
    const file = emptyFile('Dashed');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 120, 80);
    rect.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    rect.strokeWeight = 2;
    rect.dashPattern = [8, 4];
    rect.dashOffset = 3;
    page.children = [rect];
    const dir = mkdtempSync(join(tmpdir(), 'pigma-swiftui-dash-'));
    const source = join(dir, 'Dashed.swift');
    writeFileSync(source, `import SwiftUI\n\n${toSwiftUI(file, rect.id)}`);
    const target = process.arch === 'arm64' ? 'arm64-apple-macos14' : 'x86_64-apple-macos14';
    expect(() => execFileSync('swiftc', ['-typecheck', '-target', target, source], { stdio: 'pipe' })).not.toThrow();
  });
});


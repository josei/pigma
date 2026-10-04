/**
 * Example plugins that ship with the editor (M15).
 *
 * They are ordinary Figma Plugin API scripts: no privileged access, no host
 * bindings — they run through the same sandbox as user scripts, which makes them
 * useful as documentation as well as demos.
 */
import type { PluginRecord } from './registry';

export const BUILTIN_PLUGINS: PluginRecord[] = [
  {
    id: 'builtin:rename-layers',
    name: 'Rename layers to a pattern',
    builtin: true,
    source: `// Renames every layer on the page, depth first, using a numbered pattern.
const prefix = 'Layer';
const start = 1;

function walk(node, visit) {
  visit(node);
  if (node.children) {
    for (const child of node.children) walk(child, visit);
  }
}

let index = start;
walk(figma.currentPage, (node) => {
  if (node.type === 'PAGE') return;
  node.name = prefix + ' ' + index;
  index += 1;
});

figma.notify('Renamed ' + (index - start) + ' layers');
`,
  },
  {
    id: 'builtin:frame-grid',
    name: 'Add a numbered grid of frames',
    builtin: true,
    source: `// Adds a rows x columns grid of frames to the right of the page content.
const columns = 3;
const rows = 2;
const size = 160;
const gap = 24;
const x0 = 40;
const y0 = 40;

let count = 0;
for (let row = 0; row < rows; row += 1) {
  for (let column = 0; column < columns; column += 1) {
    const frame = figma.createFrame();
    frame.name = 'Grid ' + (count + 1);
    frame.resize(size, size);
    frame.x = x0 + column * (size + gap);
    frame.y = y0 + row * (size + gap);
    frame.fills = [{ type: 'SOLID', color: { r: 0.98, g: 0.96, b: 0.98 }, opacity: 1 }];
    frame.cornerRadius = 12;
    figma.currentPage.appendChild(frame);
    count += 1;
  }
}

console.log('Created ' + count + ' frames (' + columns + ' x ' + rows + ')');
`,
  },
  {
    id: 'builtin:round-corners',
    name: 'Round every corner',
    builtin: true,
    source: `// Gives every rectangle, frame and component the same corner radius.
const radius = 16;
const supported = ['RECTANGLE', 'FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];

function walk(node, visit) {
  visit(node);
  if (node.children) {
    for (const child of node.children) walk(child, visit);
  }
}

let rounded = 0;
walk(figma.currentPage, (node) => {
  if (supported.indexOf(node.type) < 0) return;
  node.cornerRadius = radius;
  rounded += 1;
});

figma.notify('Rounded ' + rounded + ' layers to ' + radius + 'px');
`,
  },
];

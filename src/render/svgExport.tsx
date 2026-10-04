import { renderToStaticMarkup } from 'react-dom/server';
import type { PigmaFile, SceneNode } from '../model/types';
import { boundsOfNodes, worldTransform } from '../model/tree';
import { SceneSvg } from './SceneRenderer';

/**
 * SVG export renders the exact same component tree the canvas mounts, so the
 * exported file is pixel-identical to the on-screen scene.
 *
 * Nodes are re-rooted onto their absolute transform: a node nested in a frame
 * carries a parent-relative transform, and the viewBox is in scene coordinates,
 * so exporting a nested selection would otherwise draw it off-canvas.
 */
export function renderSvgDocument(file: PigmaFile, nodes: SceneNode[]): string {
  const bounds = boundsOfNodes(
    file.document,
    nodes.map((node) => node.id),
  ) ?? { x: 0, y: 0, width: 1, height: 1 };
  const rooted = nodes.map((node) => ({ ...node, transform: worldTransform(file.document, node.id) }));
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  const markup = renderToStaticMarkup(
    <SceneSvg
      file={file}
      nodes={rooted}
      viewBox={{ x: bounds.x, y: bounds.y, width: Math.max(bounds.width, 1), height: Math.max(bounds.height, 1) }}
      width={width}
      height={height}
    />,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}\n`;
}

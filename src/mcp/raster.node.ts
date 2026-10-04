/**
 * Node rasterizer for `get_screenshot`, backed by `@resvg/resvg-js`.
 *
 * `@resvg/resvg-js` is an optional peer: the editor must add it (and the
 * browser needs its own canvas-based rasterizer). Kept out of the package
 * barrel so browser bundles never include a native module.
 */
import { Resvg } from '@resvg/resvg-js';
import type { Rasterizer } from './raster';

export const nodeRasterizer: Rasterizer = {
  svgToPng: (svg, options) => {
    const scale = options?.scale ?? 1;
    const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: scale } });
    return new Uint8Array(resvg.render().asPng());
  },
};

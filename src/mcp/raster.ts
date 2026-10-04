/** SVG → raster conversion contract for `get_screenshot`. */
export interface Rasterizer {
  /** Convert an SVG document to PNG bytes. `scale` multiplies the pixel size. */
  svgToPng(svg: string, options?: { scale?: number }): Uint8Array;
}

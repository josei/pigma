import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';
import type { CanvasNode, SceneNode } from '../../src/model/types';

/**
 * Layer masks (Figma's "Use as mask").
 *
 * A mask clips the siblings **above** it, so markup alone proves nothing: these
 * tests rasterise the live canvas SVG in the page and sample real pixels — a
 * point inside the mask outline must show the masked layer, a point outside it
 * must not. The raster is drawn from the canvas' own SVG element, so what is
 * measured is exactly what the app paints.
 */

/** Rasterise the live canvas and expose three sample points for the two shapes. */
async function maskProbe(page: Page, ids: [string, string]) {
  return page.evaluate(async ([maskId, topId]) => {
    const svg = document.querySelector('.canvas__svg') as SVGSVGElement;
    const viewBox = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const width = Math.round(viewBox[2]!);
    const height = Math.round(viewBox[3]!);
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(clone))))}`;
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    const raster = document.createElement('canvas');
    raster.width = width;
    raster.height = height;
    const context = raster.getContext('2d')!;
    context.drawImage(image, 0, 0, width, height);
    // The raster keeps the viewBox aspect, so document -> pixel is exact.
    const at = (x: number, y: number) =>
      Array.from(context.getImageData(Math.round(x - viewBox[0]!), Math.round(y - viewBox[1]!), 1, 1).data).slice(0, 3);

    type ProbeNode = { id: string; isMask?: boolean; width: number; height: number; transform: { tx: number; ty: number } };
    const pageNode = window.__pigmaStore!.getState().file.document.children[0] as unknown as { children: ProbeNode[] };
    const children = pageNode.children;
    const box = (id: string) => {
      const node = children.find((child) => child.id === id)!;
      return { x: node.transform.tx, y: node.transform.ty, w: node.width, h: node.height };
    };
    const mask = box(maskId);
    const top = box(topId);
    const overlapLeft = Math.max(mask.x, top.x);
    const overlapRight = Math.min(mask.x + mask.w, top.x + top.w);
    const overlapTop = Math.max(mask.y, top.y);
    const overlapBottom = Math.min(mask.y + mask.h, top.y + top.h);
    return {
      clipped: !!svg.querySelector('g[mask], g[clip-path]'),
      isMask: children.find((child) => child.id === maskId)!.isMask === true,
      /** Inside the mask, outside the top shape: the mask's own fill shows. */
      maskOnly: at(mask.x + 8, mask.y + 8),
      /** Inside the top shape, outside the mask: clipped when the mask is on. */
      topOnly: at(top.x + top.w - 8, top.y + top.h - 8),
      /** Inside both: the top shape shows through the mask. */
      overlap: at((overlapLeft + overlapRight) / 2, (overlapTop + overlapBottom) / 2),
    };
  }, ids);
}

/**
 * The two-way def audit the import QA makes: every emitted `<defs>` entry must be
 * referenced, and every `url(#…)` must resolve. A mask with nothing to clip used
 * to leave a dead `clipPath` behind.
 */
async function defAudit(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.canvas__svg') as SVGSVGElement;
    const markup = svg.outerHTML;
    const defs = [...markup.matchAll(/<(?:clipPath|mask|linearGradient|radialGradient|filter|pattern)\b[^>]*\bid="([^"]+)"/g)].map(
      (match) => match[1]!,
    );
    const refs = [...markup.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]!);
    return {
      maskDefs: defs.filter((id) => id.startsWith('pigma-mask-')),
      dead: defs.filter((id) => !refs.includes(id)),
      missing: refs.filter((id) => !defs.includes(id)),
    };
  });
}

/** Two overlapping 140x140 rectangles, the first (lower) blue and the second red. */
async function twoShapes(page: Page): Promise<[string, string]> {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 140, 140, -40, -40);
  await drawShape(page, 'Rectangle', 140, 140, 40, 40);
  const ids = (await page.evaluate(() =>
    (window.__pigmaStore!.getState().file.document.children[0] as { children: Array<{ id: string }> }).children.map(
      (child: { id: string }) => child.id,
    ),
  )) as [string, string];
  await page.evaluate(
    ([lower, upper]) => {
      window.__pigmaStore!.getState().apply('Colours', (file) => {
        const canvas = file.document.children[0] as CanvasNode;
        const paint = (id: string, r: number, g: number, b: number) => (node: SceneNode): SceneNode =>
          node.id === id ? ({ ...node, fills: [{ type: 'SOLID', color: { r, g, b }, opacity: 1 }] } as SceneNode) : node;
        const toBlue = paint(lower, 0, 0, 1);
        const toRed = paint(upper, 1, 0, 0);
        return {
          ...file,
          document: {
            ...file.document,
            children: [{ ...canvas, children: canvas.children.map((child) => toRed(toBlue(child))) }, ...file.document.children.slice(1)],
          },
        };
      });
    },
    ids,
  );
  await page.waitForTimeout(300);
  return ids;
}

test('B53a Cmd/Ctrl+Alt+M masks the selection and clips the layer above it', async ({ page }) => {
  const [lower, upper] = await twoShapes(page);
  const before = await maskProbe(page, [lower, upper]);
  expect(before.clipped).toBe(false);
  expect(before.topOnly, 'the unmasked top shape should paint its corner').toEqual([255, 0, 0]);

  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), lower);
  await page.keyboard.press('Control+Alt+m');
  await page.waitForTimeout(400);

  const after = await maskProbe(page, [lower, upper]);
  expect(after.isMask, 'the shortcut did not mark the node as a mask').toBe(true);
  expect(after.clipped, 'no clipped group was rendered').toBe(true);
  // Inside the mask outline the top shape still shows...
  expect(after.overlap, 'the masked layer vanished inside the mask').toEqual([255, 0, 0]);
  // ...and outside it the top shape is clipped away.
  expect(after.topOnly, 'the layer above the mask was not clipped to it').not.toEqual([255, 0, 0]);
  // The mask itself stays visible: its own fill shows where the top shape is not.
  expect(after.maskOnly, 'the mask layer stopped painting itself').toEqual([0, 0, 255]);
  expect(upper).toBeTruthy();
});

test('B53b the layer action toggles the mask as one undoable entry', async ({ page }) => {
  const ids = await twoShapes(page);
  const [lower] = ids;
  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), lower);
  await page.waitForTimeout(200);

  // Layer row actions reveal on hover, like the rest of the panel.
  const name = await page.evaluate((id) => {
    const children = (
      window.__pigmaStore!.getState().file.document.children[0] as { children: Array<{ id: string; name: string }> }
    ).children;
    return children.find((child: { id: string }) => child.id === id)!.name;
  }, lower);
  const row = page.locator('.layer-row', { hasText: name }).first();
  await row.hover();
  const use = row.locator('[aria-label^="Use"][aria-label$="as mask"]');
  await expect(use).toBeVisible();
  await use.click();
  await page.waitForTimeout(400);
  expect((await maskProbe(page, [lower, ids[1]])).clipped).toBe(true);
  expect(await page.evaluate(() => window.__pigmaStore!.getState().past.length)).toBeGreaterThan(0);

  // The same action now offers to remove the mask.
  await row.hover();
  await expect(row.locator('[aria-label^="Remove mask"]')).toBeVisible();

  // One undo takes the whole toggle back.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  const undone = await maskProbe(page, [lower, ids[1]]);
  expect(undone.clipped).toBe(false);
  expect(undone.topOnly, 'undo did not restore the full top shape').toEqual([255, 0, 0]);

  // And the action reads as "use" again, matching the restored document.
  await row.hover();
  await expect(row.locator('[aria-label^="Use"][aria-label$="as mask"]')).toBeVisible();
});

test('B53g masking the topmost layer emits no dead clip def', async ({ page }) => {
  const [lower, upper] = await twoShapes(page);
  // The upper shape is the topmost layer: nothing sits above it.
  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), upper);
  await page.keyboard.press('Control+Alt+m');
  await page.waitForTimeout(400);

  const audit = await defAudit(page);
  expect(audit.maskDefs, `a mask with nothing to clip still emitted ${JSON.stringify(audit.maskDefs)}`).toEqual([]);
  expect(audit.dead, `dead defs: ${JSON.stringify(audit.dead)}`).toEqual([]);
  expect(audit.missing, `missing defs: ${JSON.stringify(audit.missing)}`).toEqual([]);
  // The canvas is unchanged visually: both shapes still paint their own colour.
  const probe = await maskProbe(page, [lower, upper]);
  expect(probe.maskOnly).toEqual([0, 0, 255]);
  expect(probe.topOnly).toEqual([255, 0, 0]);
});

test('B53h two masks in one parent leave no dead defs and each clips its own run', async ({ page }) => {
  const [lower, upper] = await twoShapes(page);
  // Mask both: neither has a non-mask sibling above it, so neither clips.
  await page.evaluate((ids) => window.__pigmaStore!.getState().toggleMask(ids), [lower, upper]);
  await page.waitForTimeout(400);
  const both = await defAudit(page);
  expect(both.maskDefs, `both-mask case emitted ${JSON.stringify(both.maskDefs)}`).toEqual([]);
  expect(both.dead).toEqual([]);

  // Give the lower mask a run again: it clips, the upper still clips nothing.
  await page.evaluate((ids: [string, string]) => window.__pigmaStore!.getState().toggleMask([ids[1]]), [lower, upper] as [string, string]);
  await page.waitForTimeout(400);
  const one = await defAudit(page);
  expect(one.maskDefs).toHaveLength(1);
  expect(one.dead).toEqual([]);
  expect(one.missing).toEqual([]);
  const probe = await maskProbe(page, [lower, upper]);
  expect(probe.topOnly, 'the run above the remaining mask should be clipped').not.toEqual([255, 0, 0]);
});

/**
 * A large opaque blue rectangle underneath, then two overlapping 140x140 shapes
 * above it — so a masked layer can be told apart from the backdrop.
 */
async function overBackdrop(page: Page): Promise<{ ids: [string, string, string] }> {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 320, 320, 0, 0);
  await drawShape(page, 'Rectangle', 140, 140, -40, -40);
  await drawShape(page, 'Rectangle', 140, 140, 40, 40);
  const ids = (await page.evaluate(() =>
    (window.__pigmaStore!.getState().file.document.children[0] as { children: Array<{ id: string }> }).children.map(
      (child: { id: string }) => child.id,
    ),
  )) as [string, string, string];
  await page.evaluate(([backdrop, , top]) => {
    window.__pigmaStore!.getState().apply('Colours', (file) => {
      const canvas = file.document.children[0] as CanvasNode;
      const paint = (child: SceneNode): SceneNode => {
        const colour =
          child.id === backdrop ? { r: 0, g: 0, b: 1 } : child.id === top ? { r: 1, g: 0, b: 0 } : null;
        return colour ? ({ ...child, fills: [{ type: 'SOLID', color: colour, opacity: 1 }] } as SceneNode) : child;
      };
      return {
        ...file,
        document: { ...file.document, children: [{ ...canvas, children: canvas.children.map(paint) }, ...file.document.children.slice(1)] },
      };
    });
  }, ids);
  await page.waitForTimeout(300);
  return { ids };
}

test('B53i a semi-transparent mask fill partially masks', async ({ page }) => {
  const { ids } = await overBackdrop(page);
  const [lower, upper] = [ids[1], ids[2]] as [string, string];
  await page.evaluate((id) => {
    window.__pigmaStore!.getState().apply('Half mask', (file) => {
      const canvas = file.document.children[0] as CanvasNode;
      return {
        ...file,
        document: {
          ...file.document,
          children: [
            { ...canvas, children: canvas.children.map((child) => (child.id === id ? { ...child, fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }] } as SceneNode : child)) },
            ...file.document.children.slice(1),
          ],
        },
      };
    });
  }, lower);
  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), lower);
  await page.keyboard.press('Control+Alt+m');
  await page.waitForTimeout(400);

  const probe = await maskProbe(page, [lower, upper]);
  expect(probe.clipped, 'no mask was rendered').toBe(true);
  // Half the red square over the half-painted mask over the blue: a real blend,
  // neither the fully-masked red nor the bare blue.
  const [r, , b] = probe.overlap;
  expect(Math.abs(r! - 128), `overlap red ${r} should be about half`).toBeLessThan(8);
  expect(Math.abs(b! - 63), `overlap blue ${b} should be about a quarter`).toBeLessThan(8);
  expect(probe.overlap, 'a 50% mask must not behave like a full mask').not.toEqual([255, 0, 0]);
  // Outside the mask outline nothing of the masked layer shows.
  expect(probe.topOnly).toEqual([0, 0, 255]);
});

test('B53j a gradient mask fill masks by the gradient', async ({ page }) => {
  const { ids } = await overBackdrop(page);
  const lower = ids[1];
  await page.evaluate((id) => {
    window.__pigmaStore!.getState().apply('Gradient mask', (file) => {
      const canvas = file.document.children[0] as CanvasNode;
      const paint = (child: SceneNode): SceneNode =>
        child.id === id
          ? ({
              ...child,
              fills: [
                {
                  type: 'GRADIENT_LINEAR',
                  gradientStops: [
                    { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
                    { position: 1, color: { r: 0, g: 0, b: 0, a: 0 } },
                  ],
                },
              ],
            } as SceneNode)
          : child;
      return { ...file, document: { ...file.document, children: [{ ...canvas, children: canvas.children.map(paint) }, ...file.document.children.slice(1)] } };
    });
  }, lower);
  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), lower);
  await page.keyboard.press('Control+Alt+m');
  await page.waitForTimeout(400);

  const audit = await defAudit(page);
  expect(audit.dead).toEqual([]);
  expect(audit.missing).toEqual([]);
  // Sample along the gradient inside the mask: the red square fades out.
  const ramp = await page.evaluate(async () => {
    const svg = document.querySelector('.canvas__svg') as SVGSVGElement;
    const viewBox = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const width = Math.round(viewBox[2]!);
    const height = Math.round(viewBox[3]!);
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(clone))))}`;
    });
    const raster = document.createElement('canvas');
    raster.width = width;
    raster.height = height;
    const context = raster.getContext('2d')!;
    context.drawImage(image, 0, 0, width, height);
    const pageNode = window.__pigmaStore!.getState().file.document.children[0] as unknown as {
      children: Array<{ id: string; width: number; height: number; transform: { tx: number; ty: number } }>;
    };
    const mask = pageNode.children[1]!;
    const top = pageNode.children[2]!;
    // Sample along the gradient inside the OVERLAP of mask and top shape: the
    // gradient runs over the mask's own box, and only where they overlap is
    // there a masked layer to see.
    const left = Math.max(mask.transform.tx, top.transform.tx);
    const right = Math.min(mask.transform.tx + mask.width, top.transform.tx + top.width);
    const y = Math.round((Math.max(mask.transform.ty, top.transform.ty) + Math.min(mask.transform.ty + mask.height, top.transform.ty + top.height)) / 2 - viewBox[1]!);
    const read = (x: number) => Array.from(context.getImageData(Math.round(x - viewBox[0]!), y, 1, 1).data).slice(0, 3);
    return { near: read(left + 2), mid: read((left + right) / 2), far: read(right - 2) };
  });
  // The mask's own gradient paints black, so the red ramps down to the backdrop.
  const near = ramp.near[0]!;
  const mid = ramp.mid[0]!;
  const far = ramp.far[0]!;
  expect(near, `the opaque end should show the red (${JSON.stringify(ramp.near)})`).toBeGreaterThan(far + 60);
  expect(mid, `midway should be between the ends (${JSON.stringify(ramp.mid)})`).toBeGreaterThan(far);
  expect(mid).toBeLessThan(near);
  expect(ramp.far[2]!, `the transparent end should show the backdrop (${JSON.stringify(ramp.far)})`).toBeGreaterThan(200);
});

test('B53c a mask clips only the siblings above it', async ({ page }) => {
  const [lower, upper] = await twoShapes(page);
  // Move the mask between the two: now only the top shape is above it.
  await page.evaluate(
    ([maskId, topId]) => {
      window.__pigmaStore!.getState().apply('Reorder', (file) => {
        const canvas = file.document.children[0] as CanvasNode;
        const mask = canvas.children.find((child) => child.id === maskId) as SceneNode;
        const top = canvas.children.find((child) => child.id === topId) as SceneNode;
        return {
          ...file,
          document: {
            ...file.document,
            children: [{ ...canvas, children: [top, mask] }, ...file.document.children.slice(1)],
          },
        };
      });
    },
    [lower, upper],
  );
  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), lower);
  await page.keyboard.press('Control+Alt+m');
  await page.waitForTimeout(400);

  const probe = await maskProbe(page, [lower, upper]);
  expect(probe.isMask).toBe(true);
  // The shape below the mask is not clipped: its corner keeps its colour.
  expect(probe.topOnly, 'the shape below the mask was clipped').toEqual([255, 0, 0]);
  expect(probe.maskOnly, 'the mask layer stopped painting itself').toEqual([0, 0, 255]);
});


// ---------------------------------------------------------------------------
// Cases the feature spec did not cover: masks inside containers, nested
// containers, and persistence of the flag.
// ---------------------------------------------------------------------------

/**
 * Absolute document bounds of a node, accumulated down the tree the same way the
 * renderer nests its transforms. Needed because a nested node's own `tx/ty` is
 * relative to its container.
 */
const ABS_BOUNDS = `(root, targetId) => {
  let found = null;
  const walk = (node, ox, oy) => {
    const x = ox + (node.transform?.tx ?? 0);
    const y = oy + (node.transform?.ty ?? 0);
    if (node.id === targetId) { found = { x, y, w: node.width, h: node.height }; return; }
    for (const child of node.children ?? []) walk(child, x, y);
  };
  walk(root, 0, 0);
  return found;
}`;

/**
 * Rasterise the canvas and sample points given in ABSOLUTE document space,
 * reporting the mask flag and where a clip group sits.
 */
async function nestedProbe(page: Page, ids: { mask: string; top: string; outside?: string }) {
  return page.evaluate(
    async ([maskId, topId, outsideId, absSrc]) => {
      // eslint-disable-next-line no-eval
      const abs = eval(absSrc) as (root: unknown, id: string) => { x: number; y: number; w: number; h: number } | null;
      const svg = document.querySelector('.canvas__svg') as SVGSVGElement;
      const viewBox = svg.getAttribute('viewBox')!.split(' ').map(Number);
      const width = Math.round(viewBox[2]!);
      const height = Math.round(viewBox[3]!);
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('width', String(width));
      clone.setAttribute('height', String(height));
      const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(clone))))}`;
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
      const raster = document.createElement('canvas');
      raster.width = width;
      raster.height = height;
      const context = raster.getContext('2d')!;
      context.drawImage(image, 0, 0, width, height);
      const at = (x: number, y: number) =>
        Array.from(context.getImageData(Math.round(x - viewBox[0]!), Math.round(y - viewBox[1]!), 1, 1).data).slice(0, 3);

      const file = window.__pigmaStore!.getState().file;
      const root = file.document;
      const mask = abs(root, maskId as string)!;
      const top = abs(root, topId as string)!;
      const outside = outsideId ? abs(root, outsideId as string) : null;

      const findNodeById = (
        nodes: Array<{ id?: string; isMask?: boolean; children?: unknown[] }>,
        id: string,
      ): { isMask?: boolean } | null => {
        for (const n of nodes) {
          if (n.id === id) return n;
          const hit = findNodeById((n.children ?? []) as Array<{ id?: string; isMask?: boolean; children?: unknown[] }>, id);
          if (hit) return hit;
        }
        return null;
      };
      const node = findNodeById(
        (root as unknown as { children?: Array<{ id?: string; children?: unknown[] }> }).children ?? [],
        maskId as string,
      );

      const overlapLeft = Math.max(mask.x, top.x);
      const overlapTop = Math.max(mask.y, top.y);
      const overlapRight = Math.min(mask.x + mask.w, top.x + top.w);
      const overlapBottom = Math.min(mask.y + mask.h, top.y + top.h);

      return {
        isMask: node?.isMask === true,
        clipGroups: svg.querySelectorAll('g[clip-path]').length,
        // Inside the mask, outside the top shape: the mask's own fill shows.
        maskOnly: at(mask.x + 8, mask.y + 8),
        // Inside the top shape, outside the mask: clipped away when masking works.
        topOnly: at(top.x + top.w - 8, top.y + top.h - 8),
        // Inside both: the top layer shows through.
        overlap: at((overlapLeft + overlapRight) / 2, (overlapTop + overlapBottom) / 2),
        // A sibling of the container: never clipped by a mask inside that container.
        outsideCorner: outside ? at(outside.x + 8, outside.y + 8) : null,
      };
    },
    [ids.mask, ids.top, ids.outside ?? null, ABS_BOUNDS] as [string, string, string | null, string],
  );
}

/** Paint a node solid, through the store, by id. */
async function paint(page: Page, id: string, rgb: [number, number, number]): Promise<void> {
  await page.evaluate(
    ([nodeId, colour]) => {
      window.__pigmaStore!.getState().apply('Colours', (file) => {
        const paintNode = (node: { id?: string; children?: unknown[] }): unknown => {
          if (node.id === nodeId) {
            return { ...node, fills: [{ type: 'SOLID', color: { r: (colour as number[])[0], g: (colour as number[])[1], b: (colour as number[])[2] }, opacity: 1 }] };
          }
          const children = (node.children ?? []) as Array<{ id?: string; children?: unknown[] }>;
          return { ...node, children: children.map((child) => paintNode(child)) };
        };
        return { ...file, document: paintNode(file.document as unknown as { children?: unknown[] }) as typeof file.document };
      });
    },
    [id, rgb] as [string, number[]],
  );
  await page.waitForTimeout(250);
}

/** Ids of the top-level page children, in order. */
async function pageChildIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window.__pigmaStore!.getState().file.document.children[0] as { children: Array<{ id: string }> }).children.map((c) => c.id),
  );
}

test('B53d a mask INSIDE a frame clips its sibling but nothing outside the frame', async ({ page }) => {
  await boot(page, { blank: true });
  // A container (frame) with two overlapping shapes in it, plus a page-level
  // sibling that must be left alone.
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const drag = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.mouse.move(cx + x1, cy + y1);
    await page.mouse.down();
    await page.mouse.move(cx + x2, cy + y2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };

  // Exactly three shapes: a frame holding two overlapping rectangles, plus one
  // page-level sibling. Every drag is explicit so the nesting is unambiguous.
  await tool(page, 'Frame').click();
  await drag(-200, -140, 0, 0);
  await tool(page, 'Rectangle').click();
  // Both rects are dragged ENTIRELY inside the frame: `drawShape` centres its
  // drag, so a wide one would end outside the frame and parent to the page.
  await drag(-180, -120, -100, -40);
  await tool(page, 'Rectangle').click();
  await drag(-140, -80, -60, 0);
  await tool(page, 'Rectangle').click();
  await drag(160, 120, 260, 200);

  const ids = await pageChildIds(page);
  expect(ids.length, `expected a frame and a page-level rect, got ${ids.length}`).toBeGreaterThanOrEqual(2);
  const outside = ids[ids.length - 1]!;
  const inside = await page.evaluate(() =>
    (window.__pigmaStore!.getState().file.document.children[0] as {
      children: Array<{ type: string; children?: Array<{ id: string }> }>;
    }).children.filter((c) => c.type === 'FRAME').flatMap((f) => (f.children ?? []).map((c) => c.id)),
  );
  expect(inside.length, 'the frame did not receive the two rectangles').toBeGreaterThanOrEqual(2);
  const [lower, upper] = inside as [string, string];
  await paint(page, lower, [0, 0, 255]);
  await paint(page, upper, [255, 0, 0]);
  await paint(page, outside, [255, 0, 0]);

  const before = await nestedProbe(page, { mask: lower, top: upper, outside });
  // A frame clips its OWN content, so a clip group already exists; masking must
  // ADD one rather than be the first.
  expect(before.outsideCorner, 'the page-level sibling did not paint').toEqual([255, 0, 0]);

  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), lower);
  await page.keyboard.press('Control+Alt+m');
  await page.waitForTimeout(450);

  const after = await nestedProbe(page, { mask: lower, top: upper, outside });
  expect(after.isMask, 'the nested layer was not marked as a mask').toBe(true);
  expect(after.clipGroups, 'masking did not add a clip group').toBeGreaterThan(before.clipGroups);
  expect(after.maskOnly, 'the mask stopped painting itself').toEqual([0, 0, 255]);
  expect(after.overlap, 'the masked sibling vanished inside the mask').toEqual([255, 0, 0]);
  expect(after.topOnly, 'the sibling above the mask was not clipped inside the frame').not.toEqual([255, 0, 0]);
  // The mask's container scope did not leak: the page-level sibling is untouched.
  expect(after.outsideCorner, 'the mask leaked out of its frame').toEqual([255, 0, 0]);
});

test('B53e a mask nested into a GROUP still clips only within that group', async ({ page }) => {
  await boot(page, { blank: true });
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const drag = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.mouse.move(cx + x1, cy + y1);
    await page.mouse.down();
    await page.mouse.move(cx + x2, cy + y2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };

  // Two overlapping shapes plus a page-level sibling that must stay untouched.
  await tool(page, 'Rectangle').click();
  await drag(-160, -120, -40, 0);
  await drawShape(page, 'Rectangle', 120, 120, 0, 0);
  await tool(page, 'Rectangle').click();
  await drag(160, 120, 260, 200);

  const ids = await pageChildIds(page);
  expect(ids.length, `expected three page-level shapes, got ${ids.length}`).toBe(3);
  const [lower, upper, outside] = ids as [string, string, string];
  await paint(page, lower, [0, 0, 255]);
  await paint(page, upper, [255, 0, 0]);
  await paint(page, outside, [255, 0, 0]);

  // Mask the lower shape, then GROUP the pair: the mask now lives one level
  // deeper, inside the group, and must keep clipping its sibling - and only it.
  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), lower);
  await page.keyboard.press('Control+Alt+m');
  await page.waitForTimeout(400);
  await page.evaluate((sel) => window.__pigmaStore!.getState().select(sel), [lower, upper]);
  await page.keyboard.press('Control+g');
  await page.waitForTimeout(450);

  const structure = await page.evaluate(() => {
    const canvas = window.__pigmaStore!.getState().file.document.children[0] as {
      children: Array<{ type: string; children?: Array<{ type: string; id: string; isMask?: boolean }> }>;
    };
    const group = canvas.children.find((c) => c.type === 'GROUP');
    return { groups: canvas.children.filter((c) => c.type === 'GROUP').length, kids: (group?.children ?? []).map((c) => c.type) };
  });
  expect(structure.groups, 'the group was not created').toBe(1);
  expect(structure.kids.length, `the group did not receive the pair: ${JSON.stringify(structure.kids)}`).toBe(2);

  const after = await nestedProbe(page, { mask: lower, top: upper, outside });
  expect(after.isMask, 'the mask flag was lost when grouping').toBe(true);
  expect(after.clipGroups, 'the nested mask no longer renders a clip').toBeGreaterThan(0);
  expect(after.overlap, 'the masked sibling vanished inside the group').toEqual([255, 0, 0]);
  expect(after.topOnly, 'the sibling above the nested mask was not clipped').not.toEqual([255, 0, 0]);
  expect(after.outsideCorner, 'the mask leaked out of its group').toEqual([255, 0, 0]);
});

test('B53f the mask flag and its clip survive a RELOAD', async ({ page }) => {
  const [lower, upper] = await twoShapes(page);
  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), lower);
  await page.keyboard.press('Control+Alt+m');
  await page.waitForTimeout(450);

  const before = await maskProbe(page, [lower, upper]);
  expect(before.isMask).toBe(true);
  expect(before.clipped).toBe(true);

  // Reload WITHOUT ?blank=1 - that flag boots a fresh empty document, so a
  // `page.reload()` would discard the drawing and prove nothing.
  await page.goto('/');
  await page.waitForSelector('.app');
  await page.waitForTimeout(1200);

  const after = await maskProbe(page, [lower, upper]);
  expect(after.isMask, 'isMask did not round-trip through persistence').toBe(true);
  expect(after.clipped, 'the clip was not re-rendered after the reload').toBe(true);
  // And the rendered result is the same, not merely flagged.
  expect(after.overlap, 'the masked layer does not show through after a reload').toEqual([255, 0, 0]);
  expect(after.maskOnly, 'the mask stops painting itself after a reload').toEqual([0, 0, 255]);
  expect(after.topOnly, 'the layer above the mask is no longer clipped after a reload').not.toEqual([255, 0, 0]);
});


// ---------------------------------------------------------------------------
// The alpha mechanism itself, and the mask region.
// ---------------------------------------------------------------------------

/** The emitted mask/clip elements, with the attributes that decide the result. */
async function maskElements(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.canvas__svg') as SVGSVGElement;
    return {
      masks: [...svg.querySelectorAll('mask')].map((m) => ({
        maskTypeAttr: m.getAttribute('mask-type'),
        maskTypeStyle: (m as unknown as { style: CSSStyleDeclaration }).style.maskType,
        units: m.getAttribute('maskUnits'),
        x: Number(m.getAttribute('x')),
        y: Number(m.getAttribute('y')),
        width: Number(m.getAttribute('width')),
        height: Number(m.getAttribute('height')),
      })),
      clips: svg.querySelectorAll('clipPath').length,
      clippedGroups: svg.querySelectorAll('g[clip-path]').length,
    };
  });
}

test('B53k an opaque mask uses clipPath, a non-opaque one emits mask-type="alpha"', async ({ page }) => {
  const [lower, upper] = await twoShapes(page);

  // OPAQUE mask: the cheaper, exactly equivalent clipPath - no <mask> at all.
  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), lower);
  await page.keyboard.press('Control+Alt+m');
  await page.waitForTimeout(400);
  const opaque = await maskElements(page);
  expect(opaque.masks, 'an opaque mask emitted an SVG <mask> instead of a clipPath').toHaveLength(0);
  expect(opaque.clips, 'no clipPath was emitted for the opaque mask').toBeGreaterThan(0);

  // NON-OPAQUE mask: only alpha masking can express a partial mask.
  await page.evaluate((id) => {
    window.__pigmaStore!.getState().apply('Half mask', (file) => {
      const canvas = file.document.children[0] as CanvasNode;
      const paint = (child: SceneNode): SceneNode =>
        child.id === id
          ? ({ ...child, fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0.5 }] } as SceneNode)
          : child;
      return { ...file, document: { ...file.document, children: [{ ...canvas, children: canvas.children.map(paint) }, ...file.document.children.slice(1)] } };
    });
  }, lower);
  await page.waitForTimeout(450);

  const alpha = await maskElements(page);
  expect(alpha.masks, 'a semi-transparent mask did not emit an SVG <mask>').toHaveLength(1);
  const mask = alpha.masks[0]!;
  // SVG <mask> DEFAULTS TO LUMINANCE, which would invert a dark fill. The
  // attribute AND the inline style both say alpha, so a renderer that honours
  // only one of them still resolves to alpha.
  expect(mask.maskTypeAttr, 'mask-type is not declared as an attribute').toBe('alpha');
  expect(mask.maskTypeStyle, 'mask-type is not declared in the inline style').toBe('alpha');
  expect(mask.units, 'the mask is not in user space').toBe('userSpaceOnUse');
  // The mask still clips its run - alpha masking did not disable it.
  const probe = await maskProbe(page, [lower, upper]);
  expect(probe.topOnly, 'the run above the alpha mask was not clipped').not.toEqual([255, 0, 0]);
  expect(upper).toBeTruthy();
});

test('B53l an alpha mask away from the origin keeps a region that covers its box', async ({ page }) => {
  const [lower, upper] = await twoShapes(page);

  // Offset the pair and make the mask semi-transparent, so it takes the <mask>
  // path (the clipPath path has no region). The region must cover the mask's
  // TRANSFORMED box: SVG hides everything outside it, so a region pinned near the
  // origin would blank the mask's whole run.
  await page.evaluate(
    ([a, b]) => {
      window.__pigmaStore!.getState().apply('Offset pair', (file) => {
        const canvas = file.document.children[0] as CanvasNode;
        const adjust = (child: SceneNode): SceneNode =>
          child.id === a
            ? ({ ...child, fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0.5 }], transform: { ...child.transform, tx: child.transform.tx + 60, ty: child.transform.ty + 40 } } as SceneNode)
            : child.id === b
              ? ({ ...child, transform: { ...child.transform, tx: child.transform.tx + 60, ty: child.transform.ty + 40 } } as SceneNode)
              : child;
        return { ...file, document: { ...file.document, children: [{ ...canvas, children: canvas.children.map(adjust) }, ...file.document.children.slice(1)] } };
      });
    },
    [lower, upper] as [string, string],
  );
  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), lower);
  await page.keyboard.press('Control+Alt+m');
  await page.waitForTimeout(500);

  const elements = await maskElements(page);
  expect(elements.masks, 'the offset alpha mask emitted no <mask>').toHaveLength(1);
  const emitted = elements.masks[0]!;

  // The mask's own box, in the parent's coordinate space.
  const box = await page.evaluate((id) => {
    const canvas = window.__pigmaStore!.getState().file.document.children[0] as CanvasNode;
    const node = canvas.children.find((child) => child.id === id)!;
    return { x: node.transform.tx, y: node.transform.ty, w: node.width, h: node.height };
  }, lower);

  // The region COVERS the box rather than sitting at the origin.
  expect(emitted.x, 'the region starts left of the mask').toBeLessThanOrEqual(box.x);
  expect(emitted.y, 'the region starts above the mask').toBeLessThanOrEqual(box.y);
  expect(emitted.x + emitted.width, 'the region does not reach the mask\'s right edge').toBeGreaterThanOrEqual(box.x + box.w);
  expect(emitted.y + emitted.height, 'the region does not reach the mask\'s bottom edge').toBeGreaterThanOrEqual(box.y + box.h);
  expect(emitted.x, `the region sits at the origin instead of on the mask (${emitted.x} vs box ${box.x})`).toBeGreaterThan(50);

  // And the run is still masked rather than blanked: the partial mask blends.
  const probe = await maskProbe(page, [lower, upper]);
  expect(probe.topOnly, 'the run above the offset mask was not clipped').not.toEqual([255, 0, 0]);
  const [r, , b] = probe.overlap;
  expect(r, `the run was blanked at the overlap: ${JSON.stringify(probe.overlap)}`).toBeGreaterThan(40);
  expect(b, `the backdrop is missing at the overlap: ${JSON.stringify(probe.overlap)}`).toBeGreaterThan(20);
});


// ---------------------------------------------------------------------------
// A CONTAINER mask, and a gradient carrying a paint-level opacity.
// ---------------------------------------------------------------------------

/** Absolute document box of a node, walked through its parents. */
async function absoluteBox(page: Page, id: string) {
  return page.evaluate(
    ([targetId, absSrc]) => {
      // eslint-disable-next-line no-eval
      const abs = eval(absSrc) as (root: unknown, id: string) => { x: number; y: number; w: number; h: number } | null;
      return abs(window.__pigmaStore!.getState().file.document, targetId as string);
    },
    [id, ABS_BOUNDS] as [string, string],
  );
}

/** Rasterise the canvas and sample absolute document points. */
async function samplePoints(page: Page, points: Array<[number, number]>) {
  return page.evaluate(
    async (pts) => {
      const svg = document.querySelector('.canvas__svg') as SVGSVGElement;
      const viewBox = svg.getAttribute('viewBox')!.split(' ').map(Number);
      const width = Math.round(viewBox[2]!);
      const height = Math.round(viewBox[3]!);
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('width', String(width));
      clone.setAttribute('height', String(height));
      const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(clone))))}`;
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
      const raster = document.createElement('canvas');
      raster.width = width;
      raster.height = height;
      const context = raster.getContext('2d')!;
      context.drawImage(image, 0, 0, width, height);
      return (pts as Array<[number, number]>).map(([x, y]) =>
        Array.from(context.getImageData(Math.round(x - viewBox[0]!), Math.round(y - viewBox[1]!), 1, 1).data).slice(0, 3),
      );
    },
    points,
  );
}

test('B53m a CONTAINER mask masks by its rendered content instead of blanking its run', async ({ page }) => {
  await boot(page, { blank: true });
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const drag = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.mouse.move(cx + x1, cy + y1);
    await page.mouse.down();
    await page.mouse.move(cx + x2, cy + y2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };

  // Bottom to top: a backdrop, the container that will be the mask, and the run.
  await tool(page, 'Rectangle').click();
  await drag(-200, -160, 60, 60);
  await tool(page, 'Frame').click();
  await drag(-160, -120, 20, 40);
  await drawShape(page, 'Ellipse', 60, 60, 0, 0);
  // The run is drawn CLEAR of the frame (a drag that starts inside it would
  // parent into the frame, making it a second child instead of a sibling), then
  // moved over the frame so it is masked by it.
  await tool(page, 'Rectangle').click();
  await drag(120, 60, 260, 200);

  const ids = await pageChildIds(page);
  expect(ids.length, `expected backdrop, frame and run on the page: ${JSON.stringify(ids)}`).toBe(3);
  const [backdrop, frame, run] = ids as [string, string, string];
  await paint(page, backdrop, [0, 0, 255]);
  await paint(page, run, [255, 0, 0]);

  // Move the run to cover the frame's own box.
  await page.evaluate(
    ([runId, frameId]) => {
      window.__pigmaStore!.getState().apply('Position run', (file) => {
        const canvas = file.document.children[0] as CanvasNode;
        const frameNode = canvas.children.find((child) => child.id === frameId)!;
        const move = (child: SceneNode): SceneNode =>
          child.id === runId
            ? ({
                ...child,
                width: frameNode.width + 20,
                height: frameNode.height + 20,
                transform: { ...child.transform, tx: frameNode.transform.tx - 10, ty: frameNode.transform.ty - 10 },
              } as SceneNode)
            : child;
        return { ...file, document: { ...file.document, children: [{ ...canvas, children: canvas.children.map(move) }, ...file.document.children.slice(1)] } };
      });
    },
    [run, frame] as [string, string],
  );

  // The frame's OWN fill is removed, so whatever it masks by must come from its
  // content. The ellipse inside it is the only opaque thing it renders.
  const childId = await page.evaluate(
    (frameId) => {
      let found: string | null = null;
      window.__pigmaStore!.getState().apply('Empty frame fill', (file) => {
        const walk = (node: { id?: string; children?: unknown[] }): void => {
          if (node.id === frameId) {
            (node as { fills: unknown[] }).fills = [];
            for (const child of ((node as { children?: Array<{ id: string }> }).children ?? [])) found = child.id;
          }
          for (const child of ((node.children ?? []) as Array<{ id?: string; children?: unknown[] }>)) walk(child);
        };
        walk(file.document as unknown as { children?: unknown[] });
        return file;
      });
      return found;
    },
    frame,
  );
  expect(childId, 'the frame received no child, so it has no content to mask by').not.toBeNull();
  await paint(page, childId!, [0, 0, 0]);
  await page.waitForTimeout(300);

  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), frame);
  await page.keyboard.press('Control+Alt+m');
  await page.waitForTimeout(500);

  const elements = await maskElements(page);
  // A container is never provably opaque, so it must take the alpha path.
  expect(elements.masks, 'a container mask did not emit an SVG <mask>').toHaveLength(1);

  const child = await absoluteBox(page, childId!);
  const frameBox = await absoluteBox(page, frame);
  expect(child, 'the frame\'s child has no geometry').not.toBeNull();

  // Sample inside the child (the mask has content there) and inside the frame
  // but clear of the child (no content there).
  const [throughContent, outsideContent] = await samplePoints(page, [
    [child!.x + child!.w / 2, child!.y + child!.h / 2],
    [frameBox!.x + frameBox!.w - 6, frameBox!.y + frameBox!.h - 6],
  ]);

  // The whole point of the fix: the run is NOT blanked. Where the container's
  // content is, the layer above shows through.
  expect(
    throughContent,
    `a container mask blanked its run instead of masking by its content: ${JSON.stringify(throughContent)}`,
  ).toEqual([255, 0, 0]);
  // And outside that content the run is clipped away.
  expect(outsideContent, 'the run was not clipped where the container renders nothing').not.toEqual([255, 0, 0]);
});

test('B53n a gradient mask with paint-level opacity masks AT that opacity', async ({ page }) => {
  const [lower, upper] = await twoShapes(page);
  await page.evaluate((id) => {
    window.__pigmaStore!.getState().apply('Translucent gradient mask', (file) => {
      const canvas = file.document.children[0] as CanvasNode;
      const paint = (child: SceneNode): SceneNode =>
        child.id === id
          ? ({
              ...child,
              fills: [
                {
                  // Opaque STOPS, but the paint itself is half transparent. Judging
                  // this opaque (as the earlier predicate did) would send it down
                  // the clipPath branch and the run would not be halved at all.
                  type: 'GRADIENT_LINEAR',
                  opacity: 0.5,
                  gradientStops: [
                    { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
                    { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
                  ],
                },
              ],
            } as SceneNode)
          : child;
      return { ...file, document: { ...file.document, children: [{ ...canvas, children: canvas.children.map(paint) }, ...file.document.children.slice(1)] } };
    });
  }, lower);
  await page.waitForTimeout(300);

  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), lower);
  await page.keyboard.press('Control+Alt+m');
  await page.waitForTimeout(500);

  const elements = await maskElements(page);
  expect(
    elements.masks,
    'a gradient with a paint-level opacity was judged opaque and took the clipPath branch',
  ).toHaveLength(1);

  const probe = await maskProbe(page, [lower, upper]);
  const [r] = probe.overlap;
  // The discriminating case: judged opaque (the old predicate) the mask would
  // take the clipPath branch and the run would be FULLY visible - exactly
  // [255, 0, 0]. At paint opacity 0.5 it must be visibly attenuated instead.
  expect(
    probe.overlap,
    `a paint-opacity gradient mask behaved like a full mask: ${JSON.stringify(probe.overlap)}`,
  ).not.toEqual([255, 0, 0]);
  expect(r, `the run was not attenuated at all: ${JSON.stringify(probe.overlap)}`).toBeLessThan(250);
  expect(r, `the run was masked away entirely: ${JSON.stringify(probe.overlap)}`).toBeGreaterThan(20);
  expect(probe.topOnly, 'the run outside the mask was not clipped').not.toEqual([255, 0, 0]);
});

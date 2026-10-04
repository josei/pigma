import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { activeContainer, activePage, useEditor, type Viewport } from '../store/editorStore';
import { SceneSvg } from '../render/SceneRenderer';
import { absoluteBounds, boundsOfNodes, findNode, findParent, findPath, hitTestBox, worldTransform } from '../model/tree';
import { autoLayoutOf } from '../model/autoLayout';
import { backgroundBlurRadius, hasBackgroundBlur } from '../model/effects';
import { gridBands } from '../model/constraints';
import type { LayoutGrid } from '../model/types';
import { applyToPoint, invert, transformToCss } from '../model/matrix';
import type { PigmaFile, Rect, SceneNode, Transform } from '../model/types';
import { cornerRadii } from '../render/SceneRenderer';
import { hasChildren } from '../model/types';
import { createLineNode, createSectionNode, createTextNode } from '../model/factory';
import { createsOnDrag, toolDraw } from '../model/toolDraw';
import { positionNodes, reorderByDrag, resizeFromHandle, scaleSelection, setWorldRotation } from '../model/ops';
import type { ResizeHandle } from '../model/ops';
import { computeSnap, type Guide } from '../model/snapping';
import { commentsForPage } from '../model/comments';
import { RedlineOverlay } from './RedlineOverlay';
import {
  insertAnchor,
  moveAnchor,
  pathDataFromAnchors,
  pointOnSegment,
  vectorPathOf,
  worldAnchors,
  type VectorAnchor,
  type VectorPath,
} from '../model/vector';
import { localPoint } from '../model/tree';
import { Rulers } from './Rulers';
import { Icon } from './icons';
import { decodeImageFile, imageFromDataTransfer } from './imageInput';
import { clampZoom } from '../collab/protocol';

interface Point {
  x: number;
  y: number;
}

type Interaction =
  | { kind: 'pan'; startClient: Point; startViewport: Viewport }
  | { kind: 'marquee'; start: Point; current: Point; additive: boolean }
  | {
      kind: 'move';
      startWorld: Point;
      base: PigmaFile;
      entries: Array<{ id: string; x: number; y: number }>;
      baseBounds: Rect;
      autoLayoutParentId: string | null;
    }
  | { kind: 'resize'; handle: ResizeHandle; id: string; base: PigmaFile; startWorld: Point; keepRatio: boolean }
  | { kind: 'rotate'; id: string; base: PigmaFile; center: Point; startAngle: number; startRotation: number }
  | { kind: 'scale'; handle: ResizeHandle; base: PigmaFile; ids: string[]; bounds: Rect; startWorld: Point }
  | { kind: 'draw'; start: Point; current: Point }
  | { kind: 'anchor'; id: string; index: number; base: VectorPath; startWorld: Point; inverse: Transform; path: VectorPath };

/**
 * Capture a pointer without ever throwing: a pointer can be gone by the time the
 * handler runs (fast taps, gestures cancelled by the browser), and a throw here
 * would abort the whole gesture.
 */
function capturePointer(target: EventTarget | null, pointerId: number): void {
  const element = target as Element | null;
  try {
    element?.setPointerCapture?.(pointerId);
  } catch {
    // The pointer is no longer active; the gesture continues without capture.
  }
}

const HANDLE_SIZE = 8;
const ROTATE_OFFSET = 22;

const HANDLE_POSITIONS: Array<{ handle: ResizeHandle; fx: number; fy: number }> = [
  { handle: 'nw', fx: 0, fy: 0 },
  { handle: 'n', fx: 0.5, fy: 0 },
  { handle: 'ne', fx: 1, fy: 0 },
  { handle: 'e', fx: 1, fy: 0.5 },
  { handle: 'se', fx: 1, fy: 1 },
  { handle: 's', fx: 0.5, fy: 1 },
  { handle: 'sw', fx: 0, fy: 1 },
  { handle: 'w', fx: 0, fy: 0.5 },
];

const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

/** Topmost child of `container` under the point, skipping hidden/locked nodes. */
function hitTestContainer(file: PigmaFile, containerId: string, point: Point): SceneNode | null {
  const container = findNode(file.document, containerId);
  if (!container || !hasChildren(container)) return null;
  const children = container.children as SceneNode[];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (!child || !child.visible || child.locked) continue;
    if (hitTestBox(child, worldTransform(file.document, child.id), point.x, point.y)) return child;
  }
  return null;
}

/** Deepest visible node under the point (alt/cmd-click deep select). */
function hitTestDeep(file: PigmaFile, containerId: string, point: Point): SceneNode | null {
  const container = findNode(file.document, containerId);
  if (!container || !hasChildren(container)) return null;
  const children = container.children as SceneNode[];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (!child || !child.visible || child.locked) continue;
    if (!hitTestBox(child, worldTransform(file.document, child.id), point.x, point.y)) continue;
    if (hasChildren(child)) {
      const deep = hitTestDeep(file, child.id, point);
      if (deep) return deep;
    }
    return child;
  }
  return null;
}

function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  /**
   * Live copy of the interaction. Handlers read this instead of the render
   * closure: a down -> move -> up burst inside a single frame would otherwise
   * commit the interaction captured before the move was applied.
   */
  const interactionRef = useRef<Interaction | null>(null);
  const applyInteraction = (next: Interaction | null) => {
    interactionRef.current = next;
    setInteraction(next);
  };
  /** Live touch pointers, so two fingers can pinch-zoom and pan. */
  const touchPointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; mid: { x: number; y: number }; viewport: Viewport } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** Deepest node under the pointer, used by the redline overlay. */
  const [hoverDeepId, setHoverDeepId] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [badge, setBadge] = useState<{ text: string; x: number; y: number } | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  /** In-progress pen path, in world coordinates. */
  const [pen, setPen] = useState<{ anchors: VectorAnchor[]; closed: boolean; dragging: number | null; cursor: Point | null } | null>(null);
  const selectedAnchor = useEditor((state) => state.selectedAnchor);
  const setSelectedAnchor = useEditor((state) => state.setSelectedAnchor);

  const liveFile = useEditor((state) => state.file);
  const previewFile = useEditor((state) => state.previewFile);
  const previewVersionId = useEditor((state) => state.previewVersionId);
  const compareDiff = useEditor((state) => state.compareDiff);
  const compareVersionId = useEditor((state) => state.compareVersionId);
  // While previewing a version the canvas renders that content read-only.
  const file = previewFile ?? liveFile;
  const pageId = useEditor((state) => state.pageId);
  const viewport = useEditor((state) => state.viewport);
  const tool = useEditor((state) => state.tool);
  const selection = useEditor((state) => state.selection);
  const peers = useEditor((state) => state.presence);
  const room = useEditor((state) => state.room);
  const followingId = useEditor((state) => state.followingId);
  const followPeer = useEditor((state) => state.followPeer);
  const showRedlines = useEditor((state) => state.showRedlines);

  const enteredContainerId = useEditor((state) => state.enteredContainerId);
  const pendingFit = useEditor((state) => state.pendingFit);
  const showGrid = useEditor((state) => state.showGrid);
  const showRulers = useEditor((state) => state.showRulers);
  const snapToObjects = useEditor((state) => state.snapToObjects);
  const snapToGrid = useEditor((state) => state.snapToGrid);
  const gridSize = useEditor((state) => state.gridSize);
  const zoomToFit = useEditor((state) => state.zoomToFit);
  const setCanvasSize = useEditor((state) => state.setCanvasSize);
  const setViewport = useEditor((state) => state.setViewport);
  // One rendering path for everyone on the canvas: local tabs and room peers.
  const page = activePage({ file, pageId });
  const container = activeContainer({ file, pageId, enteredContainerId } as never);

  const remotePeers = [
    ...peers.map((peer) => ({ id: peer.id, name: peer.name, color: peer.color, pageId: peer.pageId, selection: peer.selection, cursor: peer.cursor, following: false })),
    ...(room.phase === 'online'
      ? room.peers.map((peer) => ({
          id: peer.clientId,
          name: peer.nickname,
          color: peer.color,
          pageId: page.id,
          selection: peer.selection,
          cursor: peer.cursor,
          following: followingId === peer.clientId,
        }))
      : []),
  ];


  // Keep the store's canvas size in sync so zoom-to-fit works from any panel.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    setCanvasSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, [setCanvasSize]);

  // First paint after a document loads: fit the viewport to its content, so the
  // starter design and imported files are never clipped on open.
  useEffect(() => {
    const element = containerRef.current;
    if (!pendingFit || !element) return;
    if (element.clientWidth <= 0 || element.clientHeight <= 0) return;
    setCanvasSize({ width: element.clientWidth, height: element.clientHeight });
    zoomToFit();
  }, [pendingFit, setCanvasSize, zoomToFit]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceDown(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /** Zoom about the canvas centre, keeping the middle of the view fixed. */
  const zoomBy = (factor: number) => {
    const element = containerRef.current;
    const width = element?.clientWidth ?? 0;
    const height = element?.clientHeight ?? 0;
    if (width <= 0 || height <= 0) return;
    const zoom = clampZoom(viewport.zoom * factor);
    useEditor.setState({
      pendingFit: false,
      viewport: {
        zoom,
        x: width / 2 - ((width / 2 - viewport.x) / viewport.zoom) * zoom,
        y: height / 2 - ((height / 2 - viewport.y) / viewport.zoom) * zoom,
      },
    });
  };

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = containerRef.current?.getBoundingClientRect();
      const left = rect?.left ?? 0;
      const top = rect?.top ?? 0;
      return {
        x: (clientX - left - viewport.x) / viewport.zoom,
        y: (clientY - top - viewport.y) / viewport.zoom,
      };
    },
    [viewport],
  );

  // Wheel: pan (default), shift+wheel pans horizontally, cmd/ctrl+wheel zooms.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const state = useEditor.getState();
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const factor = Math.exp(-event.deltaY / 320);
        const zoom = clampZoom(state.viewport.zoom * factor);
        state.setViewport({
          zoom,
          x: px - ((px - state.viewport.x) / state.viewport.zoom) * zoom,
          y: py - ((py - state.viewport.y) / state.viewport.zoom) * zoom,
        });
        return;
      }
      if (event.shiftKey) {
        state.setViewport({ ...state.viewport, x: state.viewport.x - event.deltaY });
        return;
      }
      state.setViewport({
        ...state.viewport,
        x: state.viewport.x - event.deltaX,
        y: state.viewport.y - event.deltaY,
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const finishPen = (closed: boolean) => {
    const draft = pen;
    setPen(null);
    if (!draft || draft.anchors.length < 2) return;
    useEditor.getState().createVector({ anchors: draft.anchors, closed: closed || draft.closed }, { x: 0, y: 0 });
  };

  /** Anchor handle under a world point, for the selected vector node. */
  const anchorUnder = (point: Point): { id: string; index: number } | null => {
    const state = useEditor.getState();
    const id = state.selection[0];
    if (!id || state.selection.length !== 1) return null;
    const node = findNode(state.file.document, id);
    if (!node || (node.type !== 'VECTOR' && node.type !== 'BOOLEAN_OPERATION')) return null;
    const world = worldAnchors(state.file.document, id);
    const tolerance = 8 / viewport.zoom;
    for (let index = 0; index < world.length; index += 1) {
      const anchor = world[index];
      if (anchor && Math.hypot(anchor.x - point.x, anchor.y - point.y) <= tolerance) return { id, index };
    }
    return null;
  };

  /** Nearest segment and parameter for a click near a vector path. */
  const segmentUnder = (point: Point): { id: string; index: number; t: number } | null => {
    const state = useEditor.getState();
    const id = state.selection[0];
    if (!id) return null;
    const node = findNode(state.file.document, id);
    if (!node || (node.type !== 'VECTOR' && node.type !== 'BOOLEAN_OPERATION')) return null;
    const path = vectorPathOf(node);
    if (!path) return null;
    const matrix = worldTransform(state.file.document, id);
    const local = localPoint(matrix, point.x, point.y);
    const tolerance = 10 / viewport.zoom;
    let best: { index: number; t: number; distance: number } | null = null;
    const segments = path.closed ? path.anchors.length : path.anchors.length - 1;
    for (let index = 0; index < segments; index += 1) {
      const from = path.anchors[index];
      const to = path.anchors[(index + 1) % path.anchors.length];
      if (!from || !to) continue;
      for (let step = 0; step <= 20; step += 1) {
        const t = step / 20;
        const sample = pointOnSegment(from, to, t);
        const distance = Math.hypot(sample.x - local.x, sample.y - local.y);
        if (distance <= tolerance && (!best || distance < best.distance)) best = { index, t, distance };
      }
    }
    return best ? { id, index: best.index, t: best.t } : null;
  };

  // Enter/Escape finish the pen path (Delete is handled globally via the store).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!pen) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        finishPen(false);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setPen(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /**
   * An image dropped or pasted onto a shape fills that shape; anywhere else it
   * becomes its own image node at that point (Figma's behaviour).
   */
  const placeImageAt = (world: Point, file: File) => {
    void decodeImageFile(file, file.name || 'Image').then(
      (decoded) => {
        const store = useEditor.getState();
        const hit = hitTestContainer(store.file, container.id, world);
        const filled = hit && hit.type !== 'TEXT' && !hit.locked
          ? (store.select([hit.id]), store.applyImageFill(decoded.dataUrl, { width: decoded.width, height: decoded.height }))
          : false;
        if (!filled) store.placeImage(decoded.dataUrl, { width: decoded.width, height: decoded.height, x: world.x, y: world.y });
        store.pushToast(filled ? 'Image set as fill' : 'Placed image', 'success');
      },
      (error: unknown) => useEditor.getState().pushToast(`Could not read image: ${String(error)}`),
    );
  };

  // Paste an image from the clipboard (Ctrl/Cmd+V with an image copied).
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = imageFromDataTransfer(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      const state = useEditor.getState();
      const center = {
        x: (state.canvasSize.width / 2 - state.viewport.x) / state.viewport.zoom,
        y: (state.canvasSize.height / 2 - state.viewport.y) / state.viewport.zoom,
      };
      // Paste always creates a new layer (Figma), unlike a drop, which fills the
      // shape under the cursor.
      void decodeImageFile(file, file.name || 'Image').then(
        (decoded) => {
          useEditor.getState().placeImage(decoded.dataUrl, { width: decoded.width, height: decoded.height, x: center.x, y: center.y });
          useEditor.getState().pushToast('Pasted image', 'success');
        },
        (error: unknown) => useEditor.getState().pushToast(`Could not read image: ${String(error)}`),
      );
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const beginMove = (ids: string[], startWorld: Point) => {
    const state = useEditor.getState();
    const entries: Array<{ id: string; x: number; y: number }> = [];
    for (const id of ids) {
      const bounds = absoluteBounds(state.file.document, id);
      if (bounds) entries.push({ id, x: bounds.x, y: bounds.y });
    }
    const baseBounds = boundsOfNodes(state.file.document, ids);
    const first = ids[0];
    const parent = first ? findParent(state.file.document, first) : null;
    const layoutParent = parent && autoLayoutOf(parent) ? parent.id : null;
    state.beginTransaction();
    applyInteraction({
      kind: 'move',
      startWorld,
      base: state.file,
      entries,
      baseBounds: baseBounds ?? { x: startWorld.x, y: startWorld.y, width: 0, height: 0 },
      autoLayoutParentId: layoutParent,
    });
  };

  /** Distance and midpoint of the two active touch pointers. */
  const pinchMetrics = () => {
    const points = [...touchPointers.current.values()];
    if (points.length < 2) return null;
    const [a, b] = points as [{ x: number; y: number }, { x: number; y: number }];
    return {
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Version preview is read-only: the canvas shows a snapshot.
    if (previewFile) {
      if (event.button === 1) return;
      return;
    }
    if (event.pointerType === 'touch') {
      touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPointers.current.size === 2) {
        // A second finger turns the gesture into a pinch: drop whatever the first
        // finger started (drag, marquee, draw) so the canvas pans cleanly.
        const live = interactionRef.current;
        if (live && (live.kind === 'move' || live.kind === 'marquee' || live.kind === 'draw')) {
          useEditor.getState().cancelTransaction();
          applyInteraction(null);
        }
        const metrics = pinchMetrics();
        if (metrics) {
          pinch.current = { distance: metrics.distance, mid: metrics.mid, viewport: { ...viewport } };
          capturePointer(event.target, event.pointerId);
          return;
        }
      }
      if (touchPointers.current.size > 2) return;
    }

    if (event.button === 1 || spaceDown || tool === 'hand') {
      applyInteraction({ kind: 'pan', startClient: { x: event.clientX, y: event.clientY }, startViewport: { ...viewport } });
      capturePointer(event.target, event.pointerId);
      return;
    }
    if (event.button !== 0) return;

    const state = useEditor.getState();
    const world = toWorld(event.clientX, event.clientY);
    containerRef.current?.focus();

    if (tool === 'comment') {
      const state2 = useEditor.getState();
      const hit = hitTestContainer(state2.file, container.id, world);
      state2.addComment(world.x, world.y, 'New comment', hit ? hit.id : null);
      return;
    }

    if (toolDraw(tool).kind === 'path') {
      const draft = pen ?? { anchors: [], closed: false, dragging: null, cursor: world };
      const tolerance = 8 / viewport.zoom;
      const first = draft.anchors[0];
      if (first && draft.anchors.length > 1 && Math.hypot(first.x - world.x, first.y - world.y) <= tolerance) {
        setPen({ ...draft, closed: true, cursor: null });
        return;
      }
      const anchors = [...draft.anchors, { x: world.x, y: world.y }];
      setPen({ anchors, closed: false, dragging: anchors.length - 1, cursor: world });
      return;
    }

    if (createsOnDrag(tool)) {
      applyInteraction({ kind: 'draw', start: world, current: world });
      return;
    }

    // Anchor editing takes priority over node dragging for vector selections.
    const anchorHit = anchorUnder(world);
    if (anchorHit) {
      const node = findNode(state.file.document, anchorHit.id);
      const path = node ? vectorPathOf(node) : null;
      if (path) {
        state.beginTransaction();
        setSelectedAnchor(anchorHit.index);
        applyInteraction({
          kind: 'anchor',
          id: anchorHit.id,
          index: anchorHit.index,
          base: path,
          startWorld: world,
          path,
          // Capture the frame once: mid-drag writes keep the original frame, so
          // re-deriving local coordinates from the live matrix would drift.
          inverse: invert(worldTransform(state.file.document, anchorHit.id)),
        });
        return;
      }
    }

    const deep = event.altKey || event.metaKey;
    const hit = deep ? hitTestDeep(state.file, container.id, world) : hitTestContainer(state.file, container.id, world);
    const additive = event.shiftKey;

    if (!hit) {
      if (state.enteredContainerId) state.setEnteredContainer(null);
      if (!additive) state.clearSelection();
      applyInteraction({ kind: 'marquee', start: world, current: world, additive });
      return;
    }

    if (additive) {
      state.select([hit.id], 'toggle');
      return;
    }
    if (!state.selection.includes(hit.id)) state.select([hit.id]);
    if (hit.locked) return;

    if (event.altKey) {
      state.duplicateSelection();
      const nextSelection = useEditor.getState().selection;
      beginMove(nextSelection, world);
      return;
    }
    beginMove(useEditor.getState().selection, world);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' && touchPointers.current.has(event.pointerId)) {
      touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const gesture = pinch.current;
      const metrics = pinchMetrics();
      if (gesture && metrics) {
        // Pinch: scale around the moving midpoint and pan with it.
        const rect = containerRef.current?.getBoundingClientRect();
        const px = metrics.mid.x - (rect?.left ?? 0);
        const py = metrics.mid.y - (rect?.top ?? 0);
        const zoom = clampZoom(gesture.viewport.zoom * (metrics.distance / gesture.distance));
        const worldX = (px - gesture.viewport.x) / gesture.viewport.zoom;
        const worldY = (py - gesture.viewport.y) / gesture.viewport.zoom;
        setViewport({
          zoom,
          x: px - worldX * zoom + (metrics.mid.x - gesture.mid.x),
          y: py - worldY * zoom + (metrics.mid.y - gesture.mid.y),
        });
        return;
      }
    }
    const world = toWorld(event.clientX, event.clientY);
    // Share the pointer with sibling tabs (local-only presence).
    useEditor.getState().setLocalCursor({ x: Math.round(world.x), y: Math.round(world.y) });

    if (pen) {
      if (pen.dragging !== null) {
        // Dragging right after placing an anchor pulls its tangent handles out.
        const anchor = pen.anchors[pen.dragging];
        if (anchor) {
          const offset = { x: world.x - anchor.x, y: world.y - anchor.y };
          const anchors = pen.anchors.map((entry, index) => (index === pen.dragging ? { ...entry, out: offset, in: { x: -offset.x, y: -offset.y } } : entry));
          setPen({ ...pen, anchors, cursor: world });
        }
        return;
      }
      setPen({ ...pen, cursor: world });
      return;
    }

    if (!interaction) {
      const state = useEditor.getState();
      const hit = hitTestContainer(state.file, container.id, world);
      setHoverId(hit?.id ?? null);
      // Redlines want the innermost layer, not the top-level container.
      const deep = hit ? hitTestDeep(state.file, container.id, world) : null;
      setHoverDeepId(deep?.id ?? hit?.id ?? null);
      return;
    }

    const live = interactionRef.current;
    if (!live) return;
    switch (live.kind) {
      case 'pan': {
        setViewport({
          ...live.startViewport,
          x: live.startViewport.x + (event.clientX - live.startClient.x),
          y: live.startViewport.y + (event.clientY - live.startClient.y),
        });
        break;
      }
      case 'marquee': {
        applyInteraction({ kind: 'marquee', start: live.start, current: world, additive: live.additive });
        break;
      }
      case 'move': {
        const rawDx = world.x - live.startWorld.x;
        const rawDy = world.y - live.startWorld.y;

        // A child of an auto-layout frame reorders instead of moving freely.
        if (live.autoLayoutParentId && live.entries[0]) {
          const next = reorderByDrag(live.base, live.entries[0].id, rawDx, rawDy);
          useEditor.setState({ file: next });
          setBadge({ text: 'Reorder', x: event.clientX, y: event.clientY });
          break;
        }

        const roundedDx = Math.round(rawDx);
        const roundedDy = Math.round(rawDy);
        const proposed = {
          x: live.baseBounds.x + roundedDx,
          y: live.baseBounds.y + roundedDy,
          width: live.baseBounds.width,
          height: live.baseBounds.height,
        };
        const snap = event.metaKey || event.ctrlKey
          ? { dx: 0, dy: 0, guides: [] as Guide[] }
          : computeSnap(live.base.document, live.entries.map((entry) => entry.id), proposed, {
              threshold: 6 / viewport.zoom,
              snapToObjects,
              snapToGrid,
              gridSize,
            });
        const dx = roundedDx + snap.dx;
        const dy = roundedDy + snap.dy;
        const entries = live.entries.map((entry) => ({ id: entry.id, x: entry.x + dx, y: entry.y + dy }));
        useEditor.setState({ file: positionNodes(live.base, entries) });
        setGuides(snap.guides);
        setBadge({ text: `${dx >= 0 ? '+' : ''}${Math.round(dx)}  ${dy >= 0 ? '+' : ''}${Math.round(dy)}`, x: event.clientX, y: event.clientY });
        break;
      }
      case 'resize': {
        const dx = world.x - live.startWorld.x;
        const dy = world.y - live.startWorld.y;
        const next = resizeFromHandle(live.base, live.id, live.handle, dx, dy, {
          keepRatio: live.keepRatio || event.shiftKey,
          fromCenter: event.altKey,
        });
        useEditor.setState({ file: next });
        const node = findNode(next.document, live.id);
        if (node) setBadge({ text: `${Math.round(node.width)} × ${Math.round(node.height)}`, x: event.clientX, y: event.clientY });
        break;
      }
      case 'rotate': {
        const center = live.center;
        const angle = (Math.atan2(world.y - center.y, world.x - center.x) * 180) / Math.PI;
        let degrees = live.startRotation + (angle - live.startAngle);
        if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
        useEditor.setState({ file: setWorldRotation(live.base, live.id, degrees) });
        setBadge({ text: `${Math.round(degrees)}°`, x: event.clientX, y: event.clientY });
        break;
      }
      case 'scale': {
        const box = live.bounds;
        const dx = world.x - live.startWorld.x;
        const dy = world.y - live.startWorld.y;
        const handle = live.handle;
        const horizontal = handle.includes('e') || handle.includes('w');
        const vertical = handle.includes('n') || handle.includes('s');
        const signX = handle.includes('w') ? -1 : 1;
        const signY = handle.includes('n') ? -1 : 1;
        const scaleX = horizontal ? Math.max(0.02, (box.width + dx * signX) / box.width) : 1;
        const scaleY = vertical ? Math.max(0.02, (box.height + dy * signY) / box.height) : 1;
        const anchor = {
          x: handle.includes('w') ? box.x + box.width : box.x,
          y: handle.includes('n') ? box.y + box.height : box.y,
        };
        const next = scaleSelection(live.base, live.ids, anchor, scaleX, scaleY);
        useEditor.setState({ file: next });
        setBadge({
          text: `${Math.round(box.width * scaleX)} × ${Math.round(box.height * scaleY)}`,
          x: event.clientX,
          y: event.clientY,
        });
        break;
      }
      case 'anchor': {
        const anchor = live.base.anchors[live.index];
        if (anchor) {
          const local = applyToPoint(live.inverse, world.x, world.y);
          const moved = moveAnchor(live.base, live.index, Math.round(local.x * 100) / 100, Math.round(local.y * 100) / 100);
          useEditor.getState().setVectorPath(live.id, moved, true);
          applyInteraction({ ...live, path: moved });
          setBadge({ text: `${Math.round(local.x)}, ${Math.round(local.y)}`, x: event.clientX, y: event.clientY });
        }
        break;
      }
      case 'draw': {
        applyInteraction({ kind: 'draw', start: live.start, current: world });
        const rect = rectFromPoints(live.start, world);
        setBadge({ text: `${Math.round(rect.width)} × ${Math.round(rect.height)}`, x: event.clientX, y: event.clientY });
        break;
      }
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      touchPointers.current.delete(event.pointerId);
      if (touchPointers.current.size < 2) pinch.current = null;
    }
    const state = useEditor.getState();
    const current = interactionRef.current ?? interaction;
    setBadge(null);
    setGuides([]);
    if (pen) {
      if (pen.closed) finishPen(true);
      else setPen({ ...pen, dragging: null });
    }
    if (!current) return;

    if (current.kind === 'marquee') {
      const rect = rectFromPoints(current.start, current.current);
      if (rect.width > 1 || rect.height > 1) {
        const ids: string[] = [];
        for (const child of container.children as SceneNode[]) {
          if (!child.visible) continue;
          const bounds = absoluteBounds(state.file.document, child.id);
          if (!bounds) continue;
          const intersects =
            bounds.x < rect.x + rect.width &&
            rect.x < bounds.x + bounds.width &&
            bounds.y < rect.y + rect.height &&
            rect.y < bounds.y + bounds.height;
          if (intersects) ids.push(child.id);
        }
        state.select(ids, current.additive ? 'add' : 'replace');
      }
    }

    if (current.kind === 'anchor') {
      // Commit once: this renormalises the box and records a single history entry.
      state.setVectorPath(current.id, current.path, false);
      state.endTransaction('Move anchor');
    }

    if (current.kind === 'move' && current.autoLayoutParentId) {
      state.endTransaction('Reorder');
    }

    if (current.kind === 'move' || current.kind === 'resize' || current.kind === 'rotate' || current.kind === 'scale') {
      const labels = { move: 'Move', resize: 'Resize', rotate: 'Rotate', scale: 'Scale' } as const;
      state.endTransaction(labels[current.kind]);
    }

    if (current.kind === 'draw') {
      const rect = rectFromPoints(current.start, current.current);
      createFromDrag(rect, current.start, current.current, event.shiftKey);
    }

    applyInteraction(null);
  };

  /** Topmost frame under a point, so drawing inside a frame nests into it. */
  const frameUnder = (point: Point): string | null => {
    const state = useEditor.getState();
    const children = container.children as SceneNode[];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (!child || child.type !== 'FRAME' || !child.visible || child.locked) continue;
      if (hitTestBox(child, worldTransform(state.file.document, child.id), point.x, point.y)) return child.id;
    }
    return null;
  };

  const createFromDrag = (rect: Rect, start: Point, end: Point, square: boolean) => {
    const state = useEditor.getState();
    // Figma parents a new shape to the frame it is drawn into, not to the page.
    const parentId = (!state.enteredContainerId && frameUnder(start)) || container.id;
    const parentWorld = worldTransform(state.file.document, parentId);
    const local = applyToPoint(invert(parentWorld), rect.x, rect.y);
    let width = Math.max(1, Math.round(rect.width));
    let height = Math.max(1, Math.round(rect.height));
    if (square && tool !== 'line') {
      const size = Math.max(width, height);
      width = size;
      height = size;
    }

    const draw = toolDraw(tool);

    if (draw.kind === 'text') {
      const node = createTextNode(state.file.document, local.x, local.y, '');
      node.transform = { ...node.transform, tx: local.x, ty: local.y };
      state.addNode(node, parentId);
      state.setEditingText(node.id);
      return;
    }

    // A click without a drag never creates a shape (Figma behaviour); only the
    // text tool reacts to a plain click, by starting an empty text layer.
    if (rect.width < 3 && rect.height < 3) {
      state.setTool('select');
      return;
    }

    if (draw.kind === 'section') {
      // Sections are page-level containers in Figma, so they never nest into a frame.
      const sectionParent = container.id;
      const sectionParentWorld = worldTransform(state.file.document, sectionParent);
      const sectionLocal = applyToPoint(invert(sectionParentWorld), rect.x, rect.y);
      const section = createSectionNode(state.file.document, sectionLocal.x, sectionLocal.y, width, height);
      state.addNode(section, sectionParent);
      return;
    }

    if (draw.kind === 'line') {
      const node = createLineNode(state.file.document, local.x, local.y, Math.max(1, Math.hypot(end.x - start.x, end.y - start.y)));
      const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
      node.transform = { ...node.transform, tx: local.x, ty: local.y, ...rotationToMatrix(angle) };
      state.addNode(node, parentId);
      return;
    }

    // Every other drawing tool creates its shape through the one table.
    if (draw.kind !== 'shape') {
      state.setTool('select');
      return;
    }
    const node = draw.factory(state.file.document, local.x, local.y, width, height);
    state.addNode(node, parentId);
    // Drawing a frame selects it but does NOT enter it (Figma): entering happens
    // on double-click, and the next shape drawn over a frame nests into it via
    // frameUnder() anyway. Entering here nested every subsequent frame inside the
    // previous one.
  };

  const startResize = (handle: ResizeHandle, event: React.PointerEvent) => {
    event.stopPropagation();
    const state = useEditor.getState();
    const id = state.selection[0];
    if (!id) return;
    state.beginTransaction();
    applyInteraction({ kind: 'resize', handle, id, base: state.file, startWorld: toWorld(event.clientX, event.clientY), keepRatio: false });
  };

  const startRotate = (event: React.PointerEvent) => {
    event.stopPropagation();
    const state = useEditor.getState();
    const id = state.selection[0];
    const node = id ? findNode(state.file.document, id) : null;
    if (!id || !node) return;
    const bounds = absoluteBounds(state.file.document, id);
    if (!bounds) return;
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const world = toWorld(event.clientX, event.clientY);
    state.beginTransaction();
    applyInteraction({
      kind: 'rotate',
      id,
      base: state.file,
      center,
      startAngle: (Math.atan2(world.y - center.y, world.x - center.x) * 180) / Math.PI,
      startRotation: (Math.atan2(node.transform.b, node.transform.a) * 180) / Math.PI,
    });
  };

  const startScale = (handle: ResizeHandle, event: React.PointerEvent) => {
    event.stopPropagation();
    const state = useEditor.getState();
    const bounds = boundsOfNodes(state.file.document, state.selection);
    if (!bounds) return;
    state.beginTransaction();
    applyInteraction({
      kind: 'scale',
      handle,
      base: state.file,
      ids: [...state.selection],
      bounds,
      startWorld: toWorld(event.clientX, event.clientY),
    });
  };

  /**
   * Layout grids are editing guides: they live in the overlay, never in the
   * scene SVG, so SVG/PNG exports stay clean (Figma does the same).
   */
  const gridBandsForCanvas = useMemo(() => {
    const entries: Array<{ id: string; matrix: Transform; width: number; height: number; bands: ReturnType<typeof gridBands>; axis: 'x' | 'y'; color: string }> = [];
    const visit = (node: SceneNode, parentVisible: boolean) => {
      const visible = parentVisible && node.visible;
      if (visible && hasChildren(node) && (node.layoutGrids ?? []).length > 0) {
        const matrix = worldTransform(file.document, node.id);
        for (const grid of node.layoutGrids ?? []) {
          if (grid.visible === false) continue;
          const horizontal = grid.pattern !== 'ROWS';
          const extent = horizontal ? node.width : node.height;
          const bands = gridBands(grid, extent);
          if (bands.length === 0) continue;
          entries.push({
            id: `${node.id}-${grid.pattern}-${entries.length}`,
            matrix,
            width: node.width,
            height: node.height,
            bands,
            axis: horizontal ? 'x' : 'y',
            color: gridColor(grid),
          });
        }
      }
      if (!hasChildren(node)) return;
      for (const child of node.children as SceneNode[]) visit(child, visible);
    };
    for (const child of page.children as SceneNode[]) visit(child, true);
    return entries;
  }, [file, page]);

  /**
   * Background blur is a compositing effect: SVG has no backdrop, so nodes that
   * blur what is behind them get a CSS `backdrop-filter` layer positioned over
   * the scene. Rulers, handles and guides stay above it.
   */
  const blurLayers = useMemo(() => {
    const layers: Array<{ id: string; matrix: Transform; width: number; height: number; radius: number; blur: number }> = [];
    const visit = (node: SceneNode, parentVisible: boolean) => {
      const visible = parentVisible && node.visible && node.opacity > 0;
      if (visible && hasBackgroundBlur(node)) {
        layers.push({
          id: node.id,
          matrix: worldTransform(file.document, node.id),
          width: node.width,
          height: node.height,
          radius: cornerRadii(node)[0] ?? 0,
          blur: backgroundBlurRadius(node),
        });
      }
      if (!hasChildren(node)) return;
      for (const child of node.children as SceneNode[]) visit(child, visible);
    };
    for (const child of page.children as SceneNode[]) visit(child, true);
    return layers;
  }, [file, page]);

  const selected = useMemo(
    () => selection.map((id) => ({ id, node: findNode(file.document, id) })).filter((entry) => !!entry.node),
    [selection, file],
  );
  const singleId = selection.length === 1 ? selection[0] : null;
  const singleNode = singleId ? findNode(file.document, singleId) : null;
  const multiBounds = selection.length > 1 ? boundsOfNodes(file.document, selection) : null;

  const cursor = spaceDown || tool === 'hand' || interaction?.kind === 'pan'
    ? 'grab'
    : tool === 'select'
      ? 'default'
      : 'crosshair';

  const marqueeRect = interaction?.kind === 'marquee' ? rectFromPoints(interaction.start, interaction.current) : null;
  const drawRect = interaction?.kind === 'draw' ? rectFromPoints(interaction.start, interaction.current) : null;
  const hoverNode = hoverId ? findNode(file.document, hoverId) : null;
  // Redlines follow the selection, falling back to whatever is under the pointer.
  // Redlines follow the selection, falling back to the deepest node under the
  // pointer (the hover outline uses the top-level hit, which is too coarse here).
  const redlineTargetId = selection.length === 1 ? selection[0]! : hoverDeepId;
  const enteredNode = enteredContainerId ? findNode(file.document, enteredContainerId) : null;

  return (
    <div
      className="canvas"
      ref={containerRef}
      tabIndex={0}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && followingId) {
          event.preventDefault();
          followPeer(null);
        }
      }}
      onPointerLeave={() => {
        setHoverId(null);
        setHoverDeepId(null);
        setBadge(null);
        useEditor.getState().setLocalCursor(null);
      }}
      onDragOver={(event) => {
        if (!imageFromDataTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event) => {
        const file = imageFromDataTransfer(event.dataTransfer);
        if (!file) return;
        event.preventDefault();
        placeImageAt(toWorld(event.clientX, event.clientY), file);
      }}
      onDoubleClick={(event) => {
        const state = useEditor.getState();
        const world = toWorld(event.clientX, event.clientY);
        if (pen) {
          finishPen(false);
          return;
        }
        const segment = segmentUnder(world);
        if (segment) {
          const node = findNode(state.file.document, segment.id);
          const path = node ? vectorPathOf(node) : null;
          if (path) {
            state.setVectorPath(segment.id, insertAnchor(path, segment.index, segment.t));
            return;
          }
        }
        const hit = hitTestDeep(state.file, container.id, world);
        if (!hit) return;
        // Figma drills into the container that holds the target, so a double
        // click on a shape inside a frame makes that shape directly draggable.
        const path = findPath(state.file.document, hit.id) ?? [];
        const containerIndex = path.findIndex((node) => node.id === container.id);
        const owner = containerIndex >= 0 ? path[containerIndex + 1] : null;
        if (owner && owner.id !== hit.id && hasChildren(owner)) state.setEnteredContainer(owner.id);
        else if (hasChildren(hit)) state.setEnteredContainer(hit.id);

        if (hit.type === 'TEXT') {
          state.select([hit.id]);
          state.setEditingText(hit.id);
          return;
        }
        state.select([hit.id]);
      }}
    >
      {showGrid ? (
        <svg
          className="canvas__grid"
          viewBox={`${-viewport.x / viewport.zoom} ${-viewport.y / viewport.zoom} ${
            (containerRef.current?.clientWidth ?? 1200) / viewport.zoom
          } ${(containerRef.current?.clientHeight ?? 800) / viewport.zoom}`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          aria-hidden="true"
        >
          <defs>
            <pattern id="pigma-pixel-grid" patternUnits="userSpaceOnUse" width={gridSize} height={gridSize}>
              <path
                d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
                fill="none"
                stroke="rgba(0, 0, 0, 0.10)"
                strokeWidth={1 / viewport.zoom}
              />
            </pattern>
          </defs>
          <rect
            x={-viewport.x / viewport.zoom}
            y={-viewport.y / viewport.zoom}
            width={(containerRef.current?.clientWidth ?? 1200) / viewport.zoom}
            height={(containerRef.current?.clientHeight ?? 800) / viewport.zoom}
            fill="url(#pigma-pixel-grid)"
          />
        </svg>
      ) : null}

      <SceneSvg
        file={file}
        nodes={page.children}
        viewBox={{
          x: -viewport.x / viewport.zoom,
          y: -viewport.y / viewport.zoom,
          width: (containerRef.current?.clientWidth ?? 1200) / viewport.zoom,
          height: (containerRef.current?.clientHeight ?? 800) / viewport.zoom,
        }}
        width={containerRef.current?.clientWidth ?? 1200}
        height={containerRef.current?.clientHeight ?? 800}
        showLabels
      />

      {blurLayers.map((layer) => (
        <div
          key={`blur-${layer.id}`}
          className="canvas__backdrop-blur"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: layer.width,
            height: layer.height,
            transformOrigin: '0 0',
            transform: `matrix(${layer.matrix.a * viewport.zoom}, ${layer.matrix.b * viewport.zoom}, ${
              layer.matrix.c * viewport.zoom
            }, ${layer.matrix.d * viewport.zoom}, ${layer.matrix.tx * viewport.zoom + viewport.x}, ${
              layer.matrix.ty * viewport.zoom + viewport.y
            })`,
            backdropFilter: `blur(${layer.blur}px)`,
            WebkitBackdropFilter: `blur(${layer.blur}px)`,
            borderRadius: layer.radius * viewport.zoom,
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      ))}

      {followingId ? (
        <div className="follow-banner" role="status">
          <span className="presence__dot" style={{ background: remotePeers.find((peer) => peer.id === followingId)?.color ?? 'var(--figma-brand)' }} />
          <span>Following {remotePeers.find((peer) => peer.id === followingId)?.name ?? 'peer'}</span>
          <button type="button" className="button" aria-label="Stop following" onClick={() => followPeer(null)}>
            Stop
          </button>
          <span style={{ color: 'var(--figma-text-tertiary)' }}>Esc</span>
        </div>
      ) : null}

      <svg
        className="canvas__overlay"
        viewBox={`${-viewport.x / viewport.zoom} ${-viewport.y / viewport.zoom} ${
          (containerRef.current?.clientWidth ?? 1200) / viewport.zoom
        } ${(containerRef.current?.clientHeight ?? 800) / viewport.zoom}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {/* Dev-mode measurements (M14): canvas only, never exported. */}
        {showRedlines && redlineTargetId ? (
          <RedlineOverlay file={file} id={redlineTargetId} zoom={viewport.zoom} />
        ) : null}

        {/* Everyone else on this canvas: sibling tabs and room peers. */}
        {remotePeers
          .filter((peer) => peer.pageId === page.id)
          .map((peer) =>
            peer.selection.map((id) => {
              const points = outlinePoints(file, id);
              if (!points) return null;
              return (
                <polygon
                  key={`${peer.id}-${id}`}
                  points={points}
                  fill="none"
                  stroke={peer.color}
                  strokeWidth={(peer.following ? 2.5 : 1.5) / viewport.zoom}
                  opacity={0.9}
                />
              );
            }),
          )}

        {remotePeers
          .filter((peer) => peer.pageId === page.id && peer.cursor)
          .map((peer) => {
            const size = 14 / viewport.zoom;
            return (
              <g
                key={`cursor-${peer.id}`}
                transform={`translate(${peer.cursor!.x} ${peer.cursor!.y})`}
                // Clicking a peer's cursor follows them (M13).
                style={{ pointerEvents: 'all', cursor: 'pointer' }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  followPeer(peer.following ? null : peer.id);
                }}
              >
                <path
                  d={`M 0 0 L 0 ${size} L ${size * 0.32} ${size * 0.74} L ${size * 0.52} ${size * 0.52} Z`}
                  fill={peer.color}
                  stroke="#ffffff"
                  strokeWidth={1 / viewport.zoom}
                />
                <text
                  x={size * 0.6}
                  y={size * 0.95}
                  fontSize={size * 0.72}
                  fill="#ffffff"
                  stroke={peer.color}
                  strokeWidth={size * 0.16}
                  paintOrder="stroke"
                  style={{ fontFamily: 'Inter, sans-serif' }}
                >
                  {peer.name}
                </text>
              </g>
            );
          })}

        {hoverNode && !selection.includes(hoverNode.id) ? (
          <polygon
            points={outlinePoints(file, hoverNode.id)}
            fill="none"
            stroke="#0d99ff"
            strokeWidth={1 / viewport.zoom}
            opacity={0.5}
          />
        ) : null}

        {selected.map((entry) =>
          entry.node && selection.length > 1 ? (
            <polygon
              key={entry.id}
              points={outlinePoints(file, entry.id)}
              fill="none"
              stroke="#0d99ff"
              strokeWidth={1 / viewport.zoom}
            />
          ) : null,
        )}

        {singleId && singleNode && tool === 'select' ? (
          <g transform={transformToCss(worldTransform(file.document, singleId))}>
            <rect
              x={0}
              y={0}
              width={singleNode.width}
              height={singleNode.height}
              fill="none"
              stroke="#0d99ff"
              strokeWidth={1 / viewport.zoom}
            />
            <g transform={`translate(${singleNode.width / 2} ${-ROTATE_OFFSET / viewport.zoom})`}>
              <circle
                r={5 / viewport.zoom}
                fill="#ffffff"
                stroke="#0d99ff"
                strokeWidth={1 / viewport.zoom}
                style={{ pointerEvents: 'all', cursor: 'grab' }}
                onPointerDown={startRotate}
              />
            </g>
            {HANDLE_POSITIONS.map((position) => (
              <rect
                key={position.handle}
                x={position.fx * singleNode.width - HANDLE_SIZE / 2 / viewport.zoom}
                y={position.fy * singleNode.height - HANDLE_SIZE / 2 / viewport.zoom}
                width={HANDLE_SIZE / viewport.zoom}
                height={HANDLE_SIZE / viewport.zoom}
                fill="#ffffff"
                stroke="#0d99ff"
                strokeWidth={1 / viewport.zoom}
                style={{ pointerEvents: 'all', cursor: HANDLE_CURSOR[position.handle] }}
                onPointerDown={(event) => startResize(position.handle, event)}
              />
            ))}
          </g>
        ) : null}

        {multiBounds && tool === 'select' ? (
          <g>
            <rect
              x={multiBounds.x}
              y={multiBounds.y}
              width={multiBounds.width}
              height={multiBounds.height}
              fill="none"
              stroke="#0d99ff"
              strokeWidth={1 / viewport.zoom}
              strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`}
            />
            {HANDLE_POSITIONS.map((position) => (
              <rect
                key={position.handle}
                x={multiBounds.x + position.fx * multiBounds.width - HANDLE_SIZE / 2 / viewport.zoom}
                y={multiBounds.y + position.fy * multiBounds.height - HANDLE_SIZE / 2 / viewport.zoom}
                width={HANDLE_SIZE / viewport.zoom}
                height={HANDLE_SIZE / viewport.zoom}
                fill="#ffffff"
                stroke="#0d99ff"
                strokeWidth={1 / viewport.zoom}
                style={{ pointerEvents: 'all', cursor: HANDLE_CURSOR[position.handle] }}
                onPointerDown={(event) => startScale(position.handle, event)}
              />
            ))}
          </g>
        ) : null}

        {gridBandsForCanvas.map((entry) => (
          <g key={entry.id} transform={transformToCss(entry.matrix)}>
            {entry.bands.map((band, index) =>
              entry.axis === 'x' ? (
                <rect key={index} x={band.start} y={0} width={band.size} height={entry.height} fill={entry.color} />
              ) : (
                <rect key={index} x={0} y={band.start} width={entry.width} height={band.size} fill={entry.color} />
              ),
            )}
          </g>
        ))}

        {pen ? (
          <g>
            <path
              d={pathDataFromAnchors({ anchors: pen.anchors, closed: false }) + (pen.cursor && pen.anchors.length > 0 ? ` L ${Math.round(pen.cursor.x * 100) / 100} ${Math.round(pen.cursor.y * 100) / 100}` : '')}
              fill="none"
              stroke="#0d99ff"
              strokeWidth={1.5 / viewport.zoom}
            />
            {pen.anchors.map((anchor, index) => (
              <circle
                key={`pen-${index}`}
                cx={anchor.x}
                cy={anchor.y}
                r={4 / viewport.zoom}
                fill="#ffffff"
                stroke="#0d99ff"
                strokeWidth={1 / viewport.zoom}
              />
            ))}
            {pen.anchors.map((anchor, index) =>
              anchor.out ? (
                <line
                  key={`tangent-${index}`}
                  x1={anchor.x}
                  y1={anchor.y}
                  x2={anchor.x + anchor.out.x}
                  y2={anchor.y + anchor.out.y}
                  stroke="#0d99ff"
                  strokeWidth={1 / viewport.zoom}
                  opacity={0.7}
                />
              ) : null,
            )}
          </g>
        ) : null}

        {singleId && singleNode && (singleNode.type === 'VECTOR' || singleNode.type === 'BOOLEAN_OPERATION') && vectorPathOf(singleNode)
          ? worldAnchors(file.document, singleId).map((anchor, index) => (
              <rect
                key={`anchor-${index}`}
                x={anchor.x - 3.5 / viewport.zoom}
                y={anchor.y - 3.5 / viewport.zoom}
                width={7 / viewport.zoom}
                height={7 / viewport.zoom}
                fill={selectedAnchor === index ? '#0d99ff' : '#ffffff'}
                stroke="#0d99ff"
                strokeWidth={1 / viewport.zoom}
                style={{ pointerEvents: 'all', cursor: 'move' }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  const state = useEditor.getState();
                  const node = findNode(state.file.document, singleId);
                  const path = node ? vectorPathOf(node) : null;
                  if (!path) return;
                  state.beginTransaction();
                  setSelectedAnchor(index);
                  applyInteraction({
                    kind: 'anchor',
                    id: singleId,
                    index,
                    base: path,
                    path,
                    startWorld: toWorld(event.clientX, event.clientY),
                    inverse: invert(worldTransform(state.file.document, singleId)),
                  });
                }}
              />
            ))
          : null}

        {commentsForPage(file, page.id).map((thread, index) => {
          const size = 20 / viewport.zoom;
          const active = useEditor.getState().activeCommentId === thread.id;
          return (
            <g key={thread.id} transform={`translate(${thread.x} ${thread.y})`}>
              <path
                d={`M 0 0 L ${size * 0.42} ${-size * 0.42} L ${size * 0.42} ${-size} L ${-size * 0.42} ${-size} L ${-size * 0.42} ${-size * 0.42} Z`}
                fill={thread.resolved ? '#8a8a8a' : active ? '#0d99ff' : '#f24822'}
                stroke="#ffffff"
                strokeWidth={1 / viewport.zoom}
              />
              <circle
                cx={0}
                cy={-size * 0.7}
                r={size * 0.42}
                fill={thread.resolved ? '#8a8a8a' : active ? '#0d99ff' : '#f24822'}
                stroke="#ffffff"
                strokeWidth={1 / viewport.zoom}
                style={{ pointerEvents: 'all', cursor: 'pointer' }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  const store = useEditor.getState();
                  store.setActiveComment(store.activeCommentId === thread.id ? null : thread.id);
                  store.setLeftTab('comments');
                }}
              />
              <text
                x={0}
                y={-size * 0.58}
                textAnchor="middle"
                fontSize={size * 0.5}
                fill="#ffffff"
                style={{ pointerEvents: 'none', fontFamily: 'Inter, sans-serif' }}
              >
                {index + 1}
              </text>
            </g>
          );
        })}

        {guides.map((guide, index) =>
          guide.axis === 'x' ? (
            <line
              key={`gx${index}`}
              x1={guide.position}
              y1={guide.from - 12 / viewport.zoom}
              x2={guide.position}
              y2={guide.to + 12 / viewport.zoom}
              stroke="#f24822"
              strokeWidth={1 / viewport.zoom}
              className="canvas__guide"
            />
          ) : (
            <line
              key={`gy${index}`}
              x1={guide.from - 12 / viewport.zoom}
              y1={guide.position}
              x2={guide.to + 12 / viewport.zoom}
              y2={guide.position}
              stroke="#f24822"
              strokeWidth={1 / viewport.zoom}
              className="canvas__guide"
            />
          ),
        )}

        {compareDiff
          ? (() => {
              // Added / changed nodes exist in the previewed version, so their
              // outlines sit on what is already drawn; a removed node only exists
              // in the live document, so its outline is the ghost of where it was.
              // "Added" means present in the *live* document and not in the
              // version (the diff is version -> live), and the canvas is showing
              // the version — so an added node is drawn as a ghost at its live
              // position, a removed one is already on screen, and a changed one
              // is on screen at its version position.
              const boxes: Array<{ id: string; kind: 'added' | 'removed' | 'changed'; rect: Rect | null }> = [
                ...compareDiff.added.map((id) => ({ id, kind: 'added' as const, rect: absoluteBounds(liveFile.document, id) })),
                ...compareDiff.changed.map((id) => ({ id: id.id, kind: 'changed' as const, rect: absoluteBounds(file.document, id.id) })),
                ...compareDiff.removed.map((id) => ({ id, kind: 'removed' as const, rect: absoluteBounds(file.document, id) })),
              ];
              const stroke = { added: '#1bc47d', removed: '#f24822', changed: '#ffb020' } as const;
              return (
                <g data-testid="compare-overlay">
                  {boxes.map(({ id, kind, rect }) =>
                    rect ? (
                      <rect
                        key={`${kind}-${id}`}
                        data-compare={kind}
                        data-node-id={id}
                        x={rect.x}
                        y={rect.y}
                        width={rect.width}
                        height={rect.height}
                        fill="none"
                        stroke={stroke[kind]}
                        strokeWidth={1.5 / viewport.zoom}
                        strokeDasharray={kind === 'removed' ? `${4 / viewport.zoom} ${3 / viewport.zoom}` : undefined}
                        opacity={0.9}
                      />
                    ) : null,
                  )}
                </g>
              );
            })()
          : null}

        {marqueeRect ? (
          <rect
            className="canvas__marquee"
            x={marqueeRect.x}
            y={marqueeRect.y}
            width={marqueeRect.width}
            height={marqueeRect.height}
            fill="rgba(13, 153, 255, 0.08)"
            stroke="#0d99ff"
            strokeWidth={1 / viewport.zoom}
          />
        ) : null}

        {drawRect ? (
          <rect
            x={drawRect.x}
            y={drawRect.y}
            width={drawRect.width}
            height={drawRect.height}
            fill="none"
            stroke="#0d99ff"
            strokeWidth={1 / viewport.zoom}
          />
        ) : null}
      </svg>

      {showRulers ? (
        <Rulers
          viewport={viewport}
          width={containerRef.current?.clientWidth ?? 1200}
          height={containerRef.current?.clientHeight ?? 800}
          selection={multiBounds ?? (singleId ? absoluteBounds(file.document, singleId) : null)}
        />
      ) : null}

      {previewVersionId ? (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 16,
            transform: 'translateX(-50%)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            height: 28,
            padding: '0 10px',
            background: 'var(--figma-bg)',
            border: '1px solid var(--figma-brand)',
            borderRadius: 6,
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)',
            zIndex: 3,
          }}
        >
          <span style={{ color: 'var(--figma-text-secondary)' }}>
            {compareVersionId ? 'Comparing with a version' : 'Previewing a version'}
          </span>
          {compareVersionId ? (
            <>
              <span data-testid="compare-legend" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#1bc47d' }}>● added</span>
                <span style={{ color: '#f24822' }}>● removed</span>
                <span style={{ color: '#ffb020' }}>● changed</span>
              </span>
              <button type="button" className="button" aria-label="Exit version compare" onClick={() => useEditor.getState().compareVersion(null)}>
                Exit compare
              </button>
            </>
          ) : (
            <button type="button" className="button" aria-label="Restore previewed version" onClick={() => useEditor.getState().restoreVersion(previewVersionId)}>
              Restore
            </button>
          )}
          {compareVersionId ? null : (
            <button type="button" className="button" aria-label="Exit version preview" onClick={() => useEditor.getState().previewVersion(null)}>
              Exit
            </button>
          )}
        </div>
      ) : null}

      {enteredNode ? (
        <div
          className="canvas__breadcrumb"
          style={{
            position: 'absolute',
            left: 28,
            bottom: 16,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 24,
            padding: '0 8px',
            background: 'var(--figma-bg)',
            border: '1px solid var(--figma-border)',
            borderRadius: 6,
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
          }}
        >
          <button
            type="button"
            className="button button--ghost"
            onClick={() => useEditor.getState().setEnteredContainer(null)}
            style={{ padding: '2px 6px' }}
          >
            ← {enteredNode.name}
          </button>
        </div>
      ) : null}

      <div className="canvas__hud">
        <button
          type="button"
          className={`icon-button${showRulers ? ' icon-button--active' : ''}`}
          aria-label="Toggle rulers"
          aria-pressed={showRulers}
          data-tooltip="Rulers  ⇧R"
          onClick={() => useEditor.getState().toggleRulers()}
        >
          <Icon name="line" size={12} />
        </button>
        <button
          type="button"
          className={`icon-button${showGrid ? ' icon-button--active' : ''}`}
          aria-label="Toggle pixel grid"
          aria-pressed={showGrid}
          data-tooltip="Pixel grid  ⇧G"
          onClick={() => useEditor.getState().toggleGrid()}
        >
          <Icon name="rect" size={12} />
        </button>
        <span className="toolbar__divider" style={{ height: 14 }} />
        <button type="button" className="icon-button" aria-label="Zoom out" data-tooltip="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
          <Icon name="zoom-out" size={12} />
        </button>
        <button
          type="button"
          className="icon-button toolbar__zoom-fit"
          aria-label="Zoom to fit"
          data-tooltip="Zoom to fit  ⇧1"
          onClick={() => useEditor.getState().zoomToFit()}
        >
          {Math.round(viewport.zoom * 100)}%
        </button>
        <button type="button" className="icon-button" aria-label="Zoom in" data-tooltip="Zoom in" onClick={() => zoomBy(1.2)}>
          <Icon name="zoom-in" size={12} />
        </button>
      </div>

      {badge ? (
        <div className="canvas__tooltip" style={{ left: badge.x + 14, top: badge.y + 14, position: 'fixed' }}>
          {badge.text}
        </div>
      ) : null}

      <TextEditor />
    </div>
  );
}

function gridColor(grid: LayoutGrid): string {
  const color = grid.color ?? { r: 1, g: 0.3, b: 0.4, a: 0.1 };
  const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
  return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${color.a ?? 0.1})`;
}

function rotationToMatrix(degrees: number) {
  const rad = (degrees * Math.PI) / 180;
  return { a: Math.cos(rad), b: Math.sin(rad), c: -Math.sin(rad), d: Math.cos(rad) };
}

function outlinePoints(file: PigmaFile, id: string): string {
  const node = findNode(file.document, id);
  if (!node) return '';
  const matrix = worldTransform(file.document, id);
  return [
    applyToPoint(matrix, 0, 0),
    applyToPoint(matrix, node.width, 0),
    applyToPoint(matrix, node.width, node.height),
    applyToPoint(matrix, 0, node.height),
  ]
    .map((point) => `${point.x},${point.y}`)
    .join(' ');
}

/** In-place text editing, positioned exactly over the rendered text node. */
function TextEditor() {
  const editingTextId = useEditor((state) => state.editingTextId);
  const node = useEditor((state) => (state.editingTextId ? findNode(state.file.document, state.editingTextId) : null));
  const viewport = useEditor((state) => state.viewport);
  const setEditingText = useEditor((state) => state.setEditingText);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingTextId) {
      const element = ref.current;
      if (element) {
        element.focus();
        element.setSelectionRange(element.value.length, element.value.length);
      }
    }
  }, [editingTextId]);

  if (!editingTextId || !node || node.type !== 'TEXT') return null;
  const matrix = worldTransform(useEditor.getState().file.document, node.id);
  const style = node.style;

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={node.characters}
      spellCheck={false}
      onChange={(event) => useEditor.getState().setCharacters(node.id, event.target.value, true)}
      onBlur={() => {
        useEditor.getState().endTransaction('Edit text');
        setEditingText(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          setEditingText(null);
        }
      }}
      style={{
        position: 'absolute',
        transformOrigin: '0 0',
        transform: `matrix(${matrix.a * viewport.zoom}, ${matrix.b * viewport.zoom}, ${matrix.c * viewport.zoom}, ${
          matrix.d * viewport.zoom
        }, ${matrix.tx * viewport.zoom + viewport.x}, ${matrix.ty * viewport.zoom + viewport.y})`,
        width: Math.max(node.width, 8),
        height: Math.max(node.height, style.fontSize),
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight ?? 400,
        lineHeight: `${((style.lineHeight?.value ?? 120) / 100) * style.fontSize}px`,
        textAlign: (style.textAlignHorizontal ?? 'LEFT').toLowerCase() as 'left',
        color: 'transparent',
        caretColor: '#0d99ff',
        resize: 'none',
      }}
    />
  );
}


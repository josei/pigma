import { useEffect, useMemo, useState } from 'react';
import { SceneSvg, type SceneAnimation } from '../render/SceneRenderer';
import { contentSize, planSmartAnimate } from '../model/animate';
import { overlayBox } from '../model/overlay';
import { useEditor, type OverlayEntry } from '../store/editorStore';
import { boundsOf } from '../model/matrix';
import { findNode, worldTransform } from '../model/tree';
import { interactionsOf, planActions } from '../model/prototype';
import type { PigmaFile, PrototypeAction, SceneNode } from '../model/types';

/**
 * Presentation mode.
 *
 * Honours the whole interaction model: ON_CLICK, ON_HOVER and ON_DRAG triggers,
 * and NODE (navigate or overlay), BACK, CLOSE and URL actions. Overlays stack
 * above the current frame with a click-to-dismiss backdrop, and Escape/Backspace
 * step back through them.
 */

interface Hotspot {
  node: SceneNode;
  label: string;
  actions: PrototypeAction[];
}

function collectHotspots(file: PigmaFile, frameId: string): Hotspot[] {
  const frame = findNode(file.document, frameId);
  if (!frame || frame.type === 'DOCUMENT' || frame.type === 'CANVAS') return [];
  const hotspots: Hotspot[] = [];
  const visit = (node: SceneNode) => {
    for (const interaction of interactionsOf(node)) {
      if (interaction.actions.length === 0) continue;
      hotspots.push({ node, label: `${node.name} · ${interaction.trigger.type}`, actions: interaction.actions });
    }
    if ('children' in node && Array.isArray(node.children)) (node.children as SceneNode[]).forEach(visit);
  };
  visit(frame);
  return hotspots;
}

/** Frame scrolling (Figma's `overflowDirection`) applied in presentation mode. */
function scrollStyle(node: SceneNode): {
  horizontal: boolean;
  vertical: boolean;
  content: { width: number; height: number } | null;
} {
  const direction = (node as SceneNode & { overflowDirection?: string }).overflowDirection;
  const horizontal = direction === 'HORIZONTAL_SCROLLING' || direction === 'HORIZONTAL_AND_VERTICAL_SCROLLING';
  const vertical = direction === 'VERTICAL_SCROLLING' || direction === 'HORIZONTAL_AND_VERTICAL_SCROLLING';
  if (!horizontal && !vertical) return { horizontal: false, vertical: false, content: null };
  return { horizontal, vertical, content: contentSize(node) };
}

export function Presentation() {
  const active = useEditor((state) => state.presentation);
  const file = useEditor((state) => state.file);
  const frameId = useEditor((state) => state.presentationFrameId);
  const overlays = useEditor((state) => state.presentationOverlays);
  const navigate = useEditor((state) => state.navigatePrototype);
  const back = useEditor((state) => state.prototypeBack);
  const openOverlay = useEditor((state) => state.openOverlay);
  const closeOverlay = useEditor((state) => state.closeOverlay);
  const canGoBack = useEditor((state) => state.presentationStack.length > 0 || state.presentationOverlays.length > 0);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const state = useEditor.getState();
        if (state.presentationOverlays.length > 0) state.closeOverlay();
        else state.setPresentation(false);
      }
      if (event.key === 'ArrowLeft' || event.key === 'Backspace') useEditor.getState().prototypeBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const [animation, setAnimation] = useState<SceneAnimation | null>(null);

  useEffect(() => {
    if (!animation) return;
    const raf = requestAnimationFrame(() => {
      setAnimation((current) => (current ? { ...current, overrides: {} } : current));
    });
    const timer = window.setTimeout(() => setAnimation(null), animation.duration + 50);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [animation?.frameId, animation?.duration]);

  const base = frameId ? findNode(file.document, frameId) : null;
  const overlayNodes = useMemo(
    () =>
      overlays
        .map((entry) => ({ entry, node: findNode(file.document, entry.nodeId) }))
        .filter((pair): pair is { entry: OverlayEntry; node: SceneNode } => !!pair.node && pair.node.type !== 'DOCUMENT' && pair.node.type !== 'CANVAS'),
    [overlays, file],
  );

  /**
   * Run EVERY action of a trigger, in order. `planActions` decides the ordering
   * rule (a navigate makes its destination current for the steps after it), and
   * the store commits each navigate synchronously, so a following overlay really
   * does resolve against the destination rather than the frame it came from.
   */
  const run = (actions: PrototypeAction[]) => {
    for (const step of planActions(actions, frameId)) {
      const { action } = step;
      switch (action.type) {
        case 'NODE':
          if (!action.destinationId) continue;
          if (action.overlay) openOverlay(action.destinationId, action);
          else navigateWithTransition(action.destinationId, action);
          continue;
        case 'BACK':
          back();
          continue;
        case 'CLOSE':
          closeOverlay();
          continue;
        case 'URL':
          if (action.url) window.open(action.url, '_blank', 'noopener');
          continue;
        default:
          continue;
      }
    }
  };

  /**
   * Smart animate: layers present in both frames start at their old geometry and
   * transition into place. Overrides are cleared on the next frame so the CSS
   * transition runs, then the animation context is dropped.
   */
  const navigateWithTransition = (destinationId: string, action: PrototypeAction) => {
    const transition = action.transition;
    if (transition?.type === 'SMART_ANIMATE' && frameId && frameId !== destinationId) {
      const plan = planSmartAnimate(file, frameId, destinationId, { duration: transition.duration ?? 300 });
      if (plan.matches.length > 0) {
        setAnimation({
          frameId: destinationId,
          ids: Object.fromEntries(plan.matches.map((match) => [match.toId, true as const])),
          overrides: Object.fromEntries(plan.matches.map((match) => [match.toId, match.fromRelative])),
          transition: `transform ${plan.duration}ms ${plan.easing}`,
          duration: plan.duration,
        });
        navigate(destinationId);
        return;
      }
    }
    setAnimation(null);
    navigate(destinationId);
  };

  if (!active) return null;

  const frameBounds = (node: SceneNode) => boundsOf(worldTransform(file.document, node.id), node.width, node.height);

  /** Anchor of an overlay inside the presenting frame, in scene coordinates. */
  const overlayAnchor = (entry: OverlayEntry, frame: { width: number; height: number }, overlay: SceneNode) =>
    overlayBox(
      {
        type: 'NODE',
        overlay: true,
        overlayPosition: entry.position,
        overlayX: entry.x,
        overlayY: entry.y,
      },
      frame,
      { width: overlay.width, height: overlay.height },
    );

  const frameStyle = (node: SceneNode): React.CSSProperties => {
    const box = frameBounds(node);
    return { width: box.width, height: box.height, position: 'relative' };
  };

  /**
   * Interactive areas of one frame, positioned relative to its own origin, so the
   * same helper works for the base frame (inside the scroll content) and for every
   * overlay frame, whose contents must stay clickable too.
   */
  const renderHotspots = (frame: SceneNode) => {
    const origin = frameBounds(frame);
    return collectHotspots(file, frame.id).map((hotspot) => {
      const box = boundsOf(worldTransform(file.document, hotspot.node.id), hotspot.node.width, hotspot.node.height);
      const trigger = hotspot.label.split(' · ')[1] ?? 'ON_CLICK';
      return (
        <button
          key={`${hotspot.node.id}-${hotspot.label}`}
          type="button"
          className="present__hotspot"
          data-trigger={trigger}
          aria-label={hotspot.label}
          style={{
            left: box.x - origin.x,
            top: box.y - origin.y,
            width: box.width,
            height: box.height,
          }}
          onClick={() => {
            if (trigger === 'ON_CLICK') run(hotspot.actions);
          }}
          onMouseEnter={() => {
            if (trigger === 'ON_HOVER') run(hotspot.actions);
          }}
          onPointerDown={(event) => {
            if (trigger !== 'ON_DRAG') return;
            (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
          }}
          onPointerUp={(event) => {
            if (trigger !== 'ON_DRAG') return;
            void event;
            run(hotspot.actions);
          }}
        />
      );
    });
  };

  if (!base || base.type === 'DOCUMENT' || base.type === 'CANVAS') {
    return (
      <div className="present">
        <div className="present__toolbar">
          <button type="button" className="button" onClick={() => useEditor.getState().setPresentation(false)}>
            Close
          </button>
        </div>
        <p style={{ color: '#fff', padding: 24 }}>No start frame selected. Pick a flow or a start frame in the Prototype panel.</p>
      </div>
    );
  }

  const baseBox = frameBounds(base);
  const scroll = scrollStyle(base);
  const content = scroll.content ?? { width: baseBox.width, height: baseBox.height };

  return (
    <div className="present">
      <div className="present__toolbar">
        <button type="button" className="button" onClick={() => useEditor.getState().setPresentation(false)}>
          Close
        </button>
        <button type="button" className="button" disabled={!canGoBack} onClick={back}>
          Back
        </button>
        <span style={{ color: 'rgba(255,255,255,0.7)' }}>{base.name}</span>
        {overlayNodes.length > 0 ? (
          // Name the open overlays: the presentation shows which sheet is on top.
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>
            {overlays.length} overlay{overlays.length === 1 ? '' : 's'}: {overlayNodes.map((pair) => pair.node.name).join(', ')}
          </span>
        ) : null}
      </div>
      <div className="present__stage">
        {/* Wrapper matches the base frame exactly, so overlays can be anchored in
            the frame's own coordinate space (M12) instead of the viewport's. */}
        <div className="present__stack" style={{ position: 'relative', width: baseBox.width, height: baseBox.height }}>
        <div className="present__frame" style={frameStyle(base)} data-frame={base.name}>
          <div
            className="present__scroller"
            data-scroll={scroll.content ? 'true' : undefined}
            style={{
              position: 'absolute',
              inset: 0,
              overflowX: scroll.horizontal ? 'auto' : 'hidden',
              overflowY: scroll.vertical ? 'auto' : 'hidden',
            }}
          >
            <div style={{ position: 'relative', width: content.width, height: content.height }}>
              <SceneSvg
                file={file}
                nodes={[base]}
                viewBox={{ x: baseBox.x, y: baseBox.y, width: content.width, height: content.height }}
                width={content.width}
                height={content.height}
                animation={animation && animation.frameId === base.id ? animation : null}
              />
              {renderHotspots(base)}
            </div>
          </div>
        </div>
      {overlayNodes.map(({ entry, node: overlay }, index) => (
        <div key={overlay.id} style={{ position: 'absolute', inset: 0, zIndex: 10 + index }}>
          {entry.dim ? (
            <div
              role="presentation"
              onClick={() => closeOverlay()}
              style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }}
            />
          ) : null}
          <div
            className="present__frame"
            data-frame={overlay.name}
            data-overlay-position={entry.position}
            style={{
              position: 'absolute',
              // Anchored inside the presenting frame, in the frame's own space.
              left: overlayAnchor(entry, baseBox, overlay).x,
              top: overlayAnchor(entry, baseBox, overlay).y,
              ...frameStyle(overlay),
            }}
          >
            <SceneSvg
              file={file}
              nodes={[overlay]}
              viewBox={{ x: 0, y: 0, width: Math.max(overlay.width, 1), height: Math.max(overlay.height, 1) }}
              width={Math.max(overlay.width, 1)}
              height={Math.max(overlay.height, 1)}
            />
            {renderHotspots(overlay)}
          </div>
        </div>
      ))}
        </div>
      </div>
    </div>
  );
}

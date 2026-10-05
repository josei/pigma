import { useEffect } from 'react';
import { activeContainer, useEditor, type Tool } from '../store/editorStore';
import { findNode } from '../model/tree';
import { isContainer } from '../model/types';
import { MAX_ZOOM, MIN_ZOOM } from '../collab/protocol';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  f: 'frame',
  r: 'rect',
  o: 'ellipse',
  g: 'polygon',
  s: 'star',
  l: 'line',
  t: 'text',
  p: 'pen',
  // Figma uses C for Comment; the toolbar advertised it and nothing bound it.
  c: 'comment',
};

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

/** Figma-compatible keyboard shortcuts for the whole editor. */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useEditor.getState();
      const meta = event.metaKey || event.ctrlKey;
      const typing = isTypingTarget(event.target);

      if (event.key === 'Escape') {
        if (state.followingId) {
          // Leaving follow mode is the most local thing Escape can undo.
          state.followPeer(null);
          return;
        }
        if (state.presentation) {
          state.setPresentation(false);
          return;
        }
        if (state.editingTextId) {
          state.setEditingText(null);
          return;
        }
        if (state.tool !== 'select') {
          state.setTool('select');
          return;
        }
        state.setEnteredContainer(null);
        state.clearSelection();
        return;
      }

      if (typing) return;

      // Figma's mask shortcut: Cmd/Ctrl+Alt+M.
      if (meta && event.altKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        state.toggleMask();
        return;
      }

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        state.redo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        state.selectAll();
        return;
      }
      if (meta && event.key.toLowerCase() === 'c') {
        state.copySelection();
        return;
      }
      if (meta && event.key.toLowerCase() === 'x') {
        state.cutSelection();
        return;
      }
      if (meta && event.key.toLowerCase() === 'v') {
        state.pasteClipboard();
        return;
      }
      if (meta && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        state.duplicateSelection();
        return;
      }
      if (meta && event.key === ']') {
        event.preventDefault();
        state.reorder(event.shiftKey ? 'front' : 'forward');
        return;
      }
      if (meta && event.key === '[') {
        event.preventDefault();
        state.reorder(event.shiftKey ? 'back' : 'backward');
        return;
      }
      if (meta && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        if (event.shiftKey) state.ungroupSelection();
        else state.groupSelection();
        return;
      }
      // Figma's documented zoom shortcuts (Shift+0/1/2, plus +/- for stepping).
      if (event.shiftKey && !meta && event.code === 'Digit0') {
        event.preventDefault();
        state.zoomTo(1);
        return;
      }
      if (event.shiftKey && !meta && event.code === 'Digit1') {
        event.preventDefault();
        state.zoomToFit();
        return;
      }
      if (event.shiftKey && !meta && event.code === 'Digit2') {
        event.preventDefault();
        state.zoomToSelection();
        return;
      }
      if (meta && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        const { viewport, canvasSize } = state;
        const zoom = Math.min(MAX_ZOOM, viewport.zoom * 1.2);
        state.setViewport({
          zoom,
          x: canvasSize.width / 2 - ((canvasSize.width / 2 - viewport.x) / viewport.zoom) * zoom,
          y: canvasSize.height / 2 - ((canvasSize.height / 2 - viewport.y) / viewport.zoom) * zoom,
        });
        return;
      }
      if (meta && event.key === '-') {
        event.preventDefault();
        const { viewport, canvasSize } = state;
        const zoom = Math.max(MIN_ZOOM, viewport.zoom / 1.2);
        state.setViewport({
          zoom,
          x: canvasSize.width / 2 - ((canvasSize.width / 2 - viewport.x) / viewport.zoom) * zoom,
          y: canvasSize.height / 2 - ((canvasSize.height / 2 - viewport.y) / viewport.zoom) * zoom,
        });
        return;
      }
      if (meta && event.key === '\\') {
        event.preventDefault();
        state.setPresentation(!state.presentation);
        return;
      }

      // Figma view shortcuts: Shift+R rulers, Shift+G grid, Shift+X snap to grid.
      if (event.shiftKey && !meta && event.code === 'KeyR') {
        event.preventDefault();
        state.toggleRulers();
        return;
      }
      if (event.shiftKey && !meta && event.code === 'KeyG') {
        event.preventDefault();
        state.toggleGrid();
        return;
      }
      if (event.shiftKey && !meta && event.code === 'KeyD') {
        event.preventDefault();
        state.toggleTheme();
        return;
      }
      if (event.shiftKey && !meta && event.code === 'KeyX') {
        event.preventDefault();
        state.toggleSnapToGrid();
        return;
      }

      // Figma flips with Shift+H / Shift+V.
      if (event.shiftKey && !meta && event.code === 'KeyH' && state.selection.length > 0) {
        event.preventDefault();
        state.flip('horizontal');
        return;
      }
      if (event.shiftKey && !meta && event.code === 'KeyV' && state.selection.length > 0) {
        event.preventDefault();
        state.flip('vertical');
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        // While editing a vector, Delete removes the selected anchor instead of
        // the whole layer.
        if (state.selectedAnchor !== null && state.deleteSelectedAnchor()) return;
        state.deleteSelection();
        return;
      }

      if (event.key === 'Enter' && state.selection.length === 1) {
        const id = state.selection[0];
        const node = id ? findNode(state.file.document, id) : null;
        if (node?.type === 'TEXT') {
          event.preventDefault();
          state.setEditingText(node.id);
          return;
        }
      }

      const nudge = NUDGE[event.key];
      if (nudge && state.selection.length > 0) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        // Coalesced: a burst of nudges is one undo entry.
        state.nudgeSelection(nudge[0] * step, nudge[1] * step);
        return;
      }

      if (event.key === 'Tab' && state.selection.length === 1) {
        event.preventDefault();
        const id = state.selection[0];
        const container = activeContainer(state);
        const siblings = container.children;
        const index = siblings.findIndex((child) => child.id === id);
        const next = siblings[(index + (event.shiftKey ? -1 : 1) + siblings.length) % siblings.length];
        if (next) state.select([next.id]);
        return;
      }

      if (event.key === 'Enter' && state.selection.length === 1) {
        event.preventDefault();
        const id = state.selection[0];
        const node = id ? findNode(state.file.document, id) : null;
        if (node && isContainer(node.type)) state.setEnteredContainer(node.id);
        return;
      }

      if (!meta && !event.altKey) {
        const tool = TOOL_KEYS[event.key.toLowerCase()];
        if (tool) {
          event.preventDefault();
          state.setTool(tool);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

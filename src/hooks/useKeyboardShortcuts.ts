import type { AlignMode } from '../model/ops';
import { useEffect } from 'react';
import { activeContainer, useEditor, type Tool } from '../store/editorStore';
import { findNode, findParent } from '../model/tree';
import { isContainer } from '../model/types';
import { defaultAutoLayout } from '../model/autoLayout';
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
/** Alt+letter alignment, by physical key (Figma's): A left, H centres, D right, W top, V middles, S bottom. */
const ALIGN_KEYS: Record<string, AlignMode> = {
  KeyA: 'left',
  KeyH: 'hcenter',
  KeyD: 'right',
  KeyW: 'top',
  KeyV: 'vcenter',
  KeyS: 'bottom',
};

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useEditor.getState();
      const meta = event.metaKey || event.ctrlKey;
      const typing = isTypingTarget(event.target);

      // F6 moves focus to the tools toolbar, so the keyboard can reach it without the mouse.
      if (event.key === 'F6') {
        const toolbar = document.querySelector<HTMLElement>('.toolbar');
        const first = toolbar?.querySelector<HTMLButtonElement>('button:not([disabled])');
        if (first) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      // Keyboard box selection (Figma's Ctrl/Option+Space): while the box is open, the arrows
      // grow it, Enter selects the layers it touches, and Escape leaves without selecting.
      if (!typing && event.code === 'Space' && (meta || event.altKey)) {
        event.preventDefault();
        state.toggleKeyboardBox();
        return;
      }
      if (state.keyboardBox && !typing) {
        if (event.key === 'Escape') {
          event.preventDefault();
          state.cancelKeyboardBox();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          state.finishKeyboardBox();
          return;
        }
        const arrow = NUDGE[event.key];
        if (arrow) {
          event.preventDefault();
          const step = event.shiftKey ? 10 : 1;
          state.moveKeyboardBox(arrow[0] * step, arrow[1] * step);
          return;
        }
      }

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

      // Figma's Create component: Cmd/Ctrl+Alt+K. The context menu advertised it and
      // nothing bound it, which is the defect this fixes.
      if (meta && event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        state.createComponentFromSelection();
        return;
      }

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
      // Figma's Copy / Paste properties: Cmd/Ctrl+Alt+C / V (appearance only).
      if (meta && event.altKey && event.code === 'KeyC') {
        event.preventDefault();
        state.copyProperties();
        return;
      }
      if (meta && event.altKey && event.code === 'KeyV') {
        event.preventDefault();
        state.pasteProperties();
        return;
      }
      // Figma's Detach instance: Cmd/Ctrl+Alt+B, on the selected instance.
      if (meta && event.altKey && !event.shiftKey && event.code === 'KeyB' && state.selection.length === 1) {
        const node = findNode(state.file.document, state.selection[0]!);
        if (node?.type === 'INSTANCE') {
          event.preventDefault();
          state.detachInstance(node.id);
          return;
        }
      }
      // Figma's Export: Cmd/Ctrl+Shift+E opens the export options for the selection,
      // the same dialog the menu's "Export selection as PNG" opens.
      if (meta && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        if (state.selection.length === 0) state.pushToast('Select something to export');
        else state.setExportOptions({ open: true, scope: 'selection' });
        return;
      }
      // Figma's Flatten: Cmd/Ctrl+E.
      if (meta && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'e' && state.selection.length > 0) {
        event.preventDefault();
        state.flattenSelection();
        return;
      }
      // Figma's Frame selection: Cmd/Ctrl+Alt+G.
      if (meta && event.altKey && event.code === 'KeyG') {
        event.preventDefault();
        state.frameSelection();
        return;
      }
      // Hide / lock the selection: Cmd/Ctrl+Shift+H and Cmd/Ctrl+Shift+L.
      if (meta && event.shiftKey && (event.code === 'KeyH' || event.code === 'KeyL') && state.selection.length > 0) {
        event.preventDefault();
        if (event.code === 'KeyH') state.toggleSelectionVisible();
        else state.toggleSelectionLock();
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
      // Figma's Paste over selection (Cmd/Ctrl+Shift+V) and Paste to replace (Cmd/Ctrl+Shift+R).
      if (meta && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        state.pasteAtSelection(false);
        return;
      }
      if (meta && event.shiftKey && !event.altKey && event.code === 'KeyR') {
        event.preventDefault();
        state.pasteAtSelection(true);
        return;
      }
      if (meta && !event.shiftKey && event.key.toLowerCase() === 'v') {
        state.pasteClipboard();
        return;
      }
      // Duplicate is Cmd/Ctrl+D alone: with Shift or Alt held it is another command, or none.
      if (meta && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        state.duplicateSelection();
        return;
      }
      if (meta && event.code === 'BracketRight') {
        event.preventDefault();
        state.reorder(event.shiftKey ? 'front' : 'forward');
        return;
      }
      if (meta && event.code === 'BracketLeft') {
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
      // Quick actions: Cmd/Ctrl+/ searches the menu's commands (Figma's Quick actions).
      if (meta && !event.shiftKey && !event.altKey && (event.key === '/' || event.code === 'Slash')) {
        event.preventDefault();
        state.setQuickActionsOpen(true);
        return;
      }
      // The shortcut reference: Ctrl/Cmd+Shift+? (the key is ? with Shift, or / on some layouts).
      if (meta && event.shiftKey && (event.key === '?' || event.code === 'Slash')) {
        event.preventDefault();
        state.setShortcutsOpen(true);
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
      // Figma's pixel grid: Cmd/Ctrl+' (snap to it with Shift, below).
      if (meta && !event.altKey && !event.shiftKey && event.code === 'Quote') {
        event.preventDefault();
        state.toggleGrid();
        return;
      }
      if (meta && !event.altKey && event.shiftKey && event.code === 'Quote') {
        event.preventDefault();
        state.toggleSnapToGrid();
        return;
      }
      // Figma documents Shift+D as DEV MODE, and this used to toggle the dark theme
      // — the same key meaning different things in the two apps, with Figma's use
      // unreachable by keyboard here. The divergence is REMOVED: Dev Mode takes
      // Figma's binding, and the theme keeps its entry in the main menu with no key,
      // which is what Figma has (a theme is a preference, not a command).
      if (event.shiftKey && !meta && event.code === 'KeyD') {
        event.preventDefault();
        state.toggleDevMode();
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

      // Figma's Shift+A adds auto layout: a frame gets it directly, anything else is
      // wrapped in a frame first.
      if (event.shiftKey && !meta && !event.altKey && event.code === 'KeyA' && state.selection.length > 0) {
        event.preventDefault();
        const only = state.selection.length === 1 ? findNode(state.file.document, state.selection[0]!) : null;
        const isFrame = only !== null && (only.type === 'FRAME' || only.type === 'COMPONENT');
        const mode = (only as { autoLayout?: { layoutMode?: string } } | null)?.autoLayout?.layoutMode;
        if (isFrame && mode && mode !== 'NONE') return;
        if (!isFrame) state.frameSelection();
        useEditor.getState().setAutoLayout({ ...defaultAutoLayout('HORIZONTAL'), layoutMode: 'HORIZONTAL' });
        return;
      }

      // Figma's number keys set the selection's opacity: 1 = 10% ... 9 = 90%, 0 = 100%.
      if (!event.shiftKey && !meta && !event.altKey && /^Digit[0-9]$/.test(event.code) && state.selection.length > 0) {
        event.preventDefault();
        const digit = Number(event.code.slice(5));
        state.updateSelected({ opacity: digit === 0 ? 1 : digit / 10 }, 'Set opacity');
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

      // Figma's Shift+Enter selects the PARENT of the selection.
      if (event.key === 'Enter' && event.shiftKey && state.selection.length === 1) {
        const id = state.selection[0];
        const parent = id ? findParent(state.file.document, id) : null;
        if (parent) {
          event.preventDefault();
          state.select([parent.id]);
        }
        return;
      }

      if (event.key === 'Enter' && state.selection.length === 1) {
        // TEST FIRST, PREVENT ONLY WHEN ACTING. This used to call preventDefault()
        // before the container test, so on a plain shape the key was SWALLOWED with
        // nothing happening — worse than a dead binding, because the key is
        // consumed and nothing downstream can use it.
        const id = state.selection[0];
        const node = id ? findNode(state.file.document, id) : null;
        if (node && isContainer(node.type)) {
          event.preventDefault();
          state.setEnteredContainer(node.id);
        }
        return;
      }

      // Figma's alignment keys: Alt+A left, Alt+H horizontal centres, Alt+D right,
      // Alt+W top, Alt+V vertical centres, Alt+S bottom.
      const alignMode = event.altKey && !meta && !event.shiftKey ? ALIGN_KEYS[event.code] : undefined;
      if (alignMode && state.selection.length > 0) {
        event.preventDefault();
        state.align(alignMode);
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

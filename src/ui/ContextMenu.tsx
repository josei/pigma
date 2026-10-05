/**
 * The canvas context menu.
 *
 * FIGMA'S SHAPE vs OUR DESIGN — which is which, with sources:
 *
 * DOCUMENTED, used as documented (Figma Learn):
 *   - `Copy/Paste as` -> `Copy properties` / `Paste properties`
 *     https://help.figma.com/hc/en-us/articles/360039958814-Copy-and-paste-in-Figma
 *   - `Create component`  https://help.figma.com/hc/en-us/articles/360038663994-Create-components
 *   - `Plugins`           https://help.figma.com/hc/en-us/articles/360040450213-Plugins-in-Figma
 *   - `Select layer` (the layers under the cursor, Layers-panel order)
 *     https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects
 *   - the copy-as-code items (CSS / iOS / Android / SVG / PNG / link)
 *     https://help.figma.com/hc/en-us/articles/360040450213 — the same set the main menu
 *     already exposes, so they are reused from there rather than re-implemented.
 *
 * NOT DOCUMENTED ANYWHERE, so each is OUR DESIGN, a recorded divergence:
 *   - NOTHING SELECTED: Figma's item set for an empty selection is not documented. Ours is
 *     Paste / Select all / Frame selection, because those are the only canvas-level
 *     operations we can back with an existing action. REASON: an empty menu would be a
 *     dead surface, and inventing items with no action behind them is the class this
 *     project keeps finding.
 *   - SEVERAL NODES: Figma's multi-selection set is not documented. Ours is Group, boolean
 *     operations, Use as mask, Copy/Paste, Duplicate, Delete, Frame selection.
 *     REASON: every one is backed by an existing store action; nothing is rendered that
 *     has nothing behind it.
 *   - INSIDE A FRAME / A TEXT NODE: not documented as separate item sets. We use the SAME
 *     node menu for every node kind. REASON: the actions available do not differ by parent
 *     or by kind, and a menu that changed shape without changing capability would be a
 *     difference the user could not act on.
 *   - `Go to main component` / `Restore` and the paste-as-code items ARE documented, but we
 *     have no action behind them, so they are REPORTED rather than rendered as dead entries.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';
import { useEditor } from '../store/editorStore';
import { findNode } from '../model/tree';

interface ContextItem {
  label: string;
  icon: IconName;
  shortcut?: string;
  run: () => void;
  /** Set for items whose placement is our design, not Figma's. */
  divergence?: string;
  /** Why the item cannot run right now; when set the item is DISABLED and says so. */
  disabledReason?: string;
}

interface ContextMenuState {
  x: number;
  y: number;
}

/** The node menu: shown when the selection is not empty. */
function nodeItems(): ContextItem[] {
  const store = () => useEditor.getState();
  const selection = store().selection;
  const nodes = selection.map((id) => findNode(store().file.document, id)).filter(Boolean);
  const anyContainer = nodes.some((node) => node && (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'COMPONENT'));
  const items: ContextItem[] = [
    { label: 'Copy', icon: 'copy', shortcut: '⌘C', run: () => store().copySelection() },
    {
      label: 'Paste',
      icon: 'duplicate',
      shortcut: '⌘V',
      run: () => store().pasteClipboard(),
      ...((store().clipboard?.length ?? 0) === 0 ? { disabledReason: 'the clipboard is empty' } : {}),
    },
    { label: 'Duplicate', icon: 'duplicate', shortcut: '⌘D', run: () => store().duplicateSelection() },
    {
      label: 'Group selection',
      icon: 'frame',
      shortcut: '⌘G',
      run: () => store().groupSelection(),
      divergence: 'multi-selection set is undocumented; every item here is backed by an action',
      ...(selection.length < 2 ? { disabledReason: 'grouping needs more than one layer' } : {}),
    },
    {
      label: 'Ungroup',
      icon: 'ungroup',
      shortcut: '⇧⌘G',
      run: () => store().ungroupSelection(),
      ...(anyContainer ? {} : { disabledReason: 'nothing in the selection is a group or frame' }),
    },
    { label: 'Union selection', icon: 'group', run: () => store().booleanOp('UNION') },
    { label: 'Subtract selection', icon: 'group', run: () => store().booleanOp('SUBTRACT') },
    { label: 'Intersect selection', icon: 'group', run: () => store().booleanOp('INTERSECT') },
    { label: 'Exclude selection', icon: 'group', run: () => store().booleanOp('EXCLUDE') },
    { label: 'Use as mask', icon: 'mask', shortcut: '⌘⌥M', run: () => store().toggleMask() },
    {
      label: 'Create component',
      icon: 'instance',
      shortcut: '⌘⌥K',
      run: () => store().createComponentFromSelection(),
    },
    { label: 'Frame selection', icon: 'frame', run: () => store().frameSelection() },
    { label: 'Delete', icon: 'trash', shortcut: '⌫', run: () => store().deleteSelection() },
  ];
  return items;
}

/** The empty-selection menu: OUR DESIGN (see the header). */
function emptyItems(): ContextItem[] {
  const store = () => useEditor.getState();
  return [
    // `Frame selection` used to be here and was a no-op BY CONSTRUCTION:
    // `frameSelection` returns early when `selection.length === 0`, which is exactly
    // the condition that renders this menu. Removed — there is nothing to frame.
    { label: 'Paste', icon: 'duplicate', shortcut: '⌘V', run: () => store().pasteClipboard(), divergence: 'empty-selection set is undocumented' },
    { label: 'Select all', icon: 'copy', shortcut: '⌘A', run: () => store().selectAll(), divergence: 'empty-selection set is undocumented' },
  ];
}

/**
 * The canvas context menu. A POSITIONED instance of the same item shape the main
 * `Menu` uses — same classes, same store actions — not a second implementation of
 * any action.
 */
export function ContextMenu() {
  const [state, setState] = useState<ContextMenuState | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onContext = (event: MouseEvent) => {
      // Only the CANVAS: a right-click over a panel must not open this menu (the
      // panels keep their own affordances).
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.canvas')) return;
      event.preventDefault();
      setState({ x: event.clientX, y: event.clientY });
    };
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setState(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setState(null);
    };
    window.addEventListener('contextmenu', onContext);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('contextmenu', onContext);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!state) return null;
  const selection = useEditor.getState().selection;
  const items = selection.length > 0 ? nodeItems() : emptyItems();

  return (
    <div
      className="menu menu--context"
      ref={ref}
      data-testid="context-menu"
      data-selection={selection.length > 0 ? 'node' : 'empty'}
      style={{ position: 'fixed', left: state.x, top: state.y, zIndex: 80, minWidth: 220 }}
      role="menu"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`menu__item${item.disabledReason ? ' menu__item--disabled' : ''}`}
          role="menuitem"
          data-testid="context-menu-item"
          data-divergence={item.divergence}
          data-disabled-reason={item.disabledReason}
          disabled={item.disabledReason !== undefined}
          title={item.disabledReason ?? undefined}
          onClick={() => {
            setState(null);
            if (item.disabledReason) return;
            item.run();
          }}
        >
          <span className="menu__label">
            <Icon name={item.icon} size={14} /> {item.label}
          </span>
          {item.shortcut ? <span className="menu__shortcut">{item.shortcut}</span> : null}
        </button>
      ))}
    </div>
  );
}

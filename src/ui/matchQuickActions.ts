import type { IconName } from './icons';
import type { MenuItem } from './Menu';
import type { PigmaFile } from '../model/types';
import { descendants } from '../model/tree';

/** Most results the Quick actions list shows at once. */
export const QUICK_ACTION_LIMIT = 12;

/**
 * The Quick actions matches for a query (Figma's Quick actions, Cmd/Ctrl+/): every word typed must appear in the
 * entry's label, ignoring case, and the entries keep the menu's order. An empty query matches nothing, so the
 * list only shows once something is typed.
 */
export function matchQuickActions(items: MenuItem[], query: string, limit = QUICK_ACTION_LIMIT): MenuItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return items.filter((item) => {
    const label = item.label.toLowerCase();
    return words.every((word) => label.includes(word));
  }).slice(0, limit);
}

/** The icon a layer's entry shows: its kind, or a rectangle for a shape. */
const LAYER_ICONS: Record<string, IconName> = {
  TEXT: 'text',
  FRAME: 'frame',
  SECTION: 'section',
  GROUP: 'group',
  COMPONENT: 'component',
  INSTANCE: 'instance',
};

/**
 * The layer and page entries of the open document, for the same matching as the menu's commands. Each layer on the
 * current page is an entry that selects it; each page is an entry that opens it. Typing a layer's name finds it.
 */
export function documentQuickActions(
  file: PigmaFile,
  pageId: string,
  actions: { selectLayer: (id: string) => void; openPage: (id: string) => void },
): MenuItem[] {
  const page = file.document.children.find((entry) => entry.id === pageId);
  const layers: MenuItem[] = page
    ? descendants(page).map((node) => ({
        label: `Layer: ${node.name}`,
        icon: LAYER_ICONS[node.type] ?? 'rect',
        run: () => actions.selectLayer(node.id),
      }))
    : [];
  const pages: MenuItem[] = file.document.children.map((entry) => ({
    label: `Page: ${entry.name}`,
    icon: 'file',
    run: () => actions.openPage(entry.id),
  }));
  return [...layers, ...pages];
}

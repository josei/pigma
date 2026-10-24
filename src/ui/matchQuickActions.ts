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
 * The layer and page entries of the open document, for the same matching as the menu's commands. Each layer on any
 * page is an entry that selects it, on its page: the current page's layers come first, then the other pages', whose
 * labels name their page. Each page is an entry that opens it. Typing a layer's name finds it.
 */
export function documentQuickActions(
  file: PigmaFile,
  pageId: string,
  actions: { selectLayer: (id: string, onPage: string) => void; openPage: (id: string) => void },
): MenuItem[] {
  const current = file.document.children.find((entry) => entry.id === pageId);
  const others = file.document.children.filter((entry) => entry.id !== pageId);
  const layersOn = (page: (typeof others)[number], suffix: string): MenuItem[] =>
    descendants(page).map((node) => ({
      label: `Layer: ${node.name}${suffix}`,
      icon: LAYER_ICONS[node.type] ?? 'rect',
      run: () => actions.selectLayer(node.id, page.id),
    }));
  const layers: MenuItem[] = [
    ...(current ? layersOn(current, '') : []),
    ...others.flatMap((page) => layersOn(page, ` (${page.name})`)),
  ];
  const pages: MenuItem[] = file.document.children.map((entry) => ({
    label: `Page: ${entry.name}`,
    icon: 'file',
    run: () => actions.openPage(entry.id),
  }));
  return [...layers, ...pages];
}

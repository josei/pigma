import type { MenuItem } from './Menu';

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

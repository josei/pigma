import { Icon, type IconName } from './icons';
import { useEditor, type LeftTab } from '../store/editorStore';
import { useIsMobile } from './useIsMobile';

interface RailEntry {
  tab: LeftTab;
  icon: IconName;
  label: string;
}

const ENTRIES: RailEntry[] = [
  { tab: 'file', icon: 'file', label: 'File' },
  { tab: 'layers', icon: 'layers', label: 'Layers' },
  { tab: 'assets', icon: 'assets', label: 'Assets' },
  { tab: 'comments', icon: 'menu', label: 'Comments' },
  { tab: 'tools', icon: 'tools', label: 'Tools' },
  { tab: 'plugins', icon: 'instance', label: 'Plugins' },
  { tab: 'rooms', icon: 'share', label: 'Rooms' },
];

/** Left nav rail: brand mark plus the panel switcher. */
export function Rail() {
  const leftTab = useEditor((state) => state.leftTab);
  const setLeftTab = useEditor((state) => state.setLeftTab);
  const mobileDrawer = useEditor((state) => state.mobileDrawer);
  const setMobileDrawer = useEditor((state) => state.setMobileDrawer);
  const isMobile = useIsMobile();

  return (
    <nav className="app__rail" aria-label="Panels">
      <span className="rail__logo" data-tooltip="Pigma">
        <Icon name="pig" size={22} />
      </span>
      {ENTRIES.map((entry) => (
        <button
          key={entry.tab}
          type="button"
          className={`rail__button${leftTab === entry.tab ? ' rail__button--active' : ''}`}
          data-tooltip={entry.label}
          aria-label={entry.label}
          aria-pressed={leftTab === entry.tab}
          onClick={() => {
            // On a phone the panel is a drawer: tapping the tab opens it, tapping
            // the active tab again closes it.
            const opening = mobileDrawer !== 'left' || leftTab !== entry.tab;
            setLeftTab(entry.tab);
            if (isMobile) setMobileDrawer(opening ? 'left' : null);
          }}
        >
          <Icon name={entry.icon} />
        </button>
      ))}
    </nav>
  );
}

import { useEditor, type Tool } from '../store/editorStore';
import type { IconName } from './icons';
import { ToolButton } from './ToolButton';
import { useIsMobile } from './useIsMobile';

const TOOLS: Array<{ tool: Tool; icon: IconName; label: string; shortcut: string }> = [
  { tool: 'select', icon: 'cursor', label: 'Move', shortcut: 'V' },
  { tool: 'frame', icon: 'frame', label: 'Frame', shortcut: 'F' },
  { tool: 'rect', icon: 'rect', label: 'Rectangle', shortcut: 'R' },
  { tool: 'ellipse', icon: 'ellipse', label: 'Ellipse', shortcut: 'O' },
  { tool: 'polygon', icon: 'polygon', label: 'Polygon', shortcut: 'G' },
  { tool: 'star', icon: 'star', label: 'Star', shortcut: 'S' },
  { tool: 'line', icon: 'line', label: 'Line', shortcut: 'L' },
  { tool: 'text', icon: 'text', label: 'Text', shortcut: 'T' },
  { tool: 'section', icon: 'section', label: 'Section', shortcut: '' },
  { tool: 'pen', icon: 'pen', label: 'Pen', shortcut: 'P' },
  { tool: 'comment', icon: 'menu', label: 'Comment', shortcut: 'C' },
  { tool: 'hand', icon: 'hand', label: 'Hand tool', shortcut: 'H' },
];

/** Figma UI3 bottom toolbar: floating, white, 14px radius, blue active tool. */
export function Toolbar() {
  const peers = useEditor((state) => state.presence);
  const setMobileDrawer = useEditor((state) => state.setMobileDrawer);
  const isMobile = useIsMobile();
  const tool = useEditor((state) => state.tool);
  const setTool = useEditor((state) => state.setTool);
  const devMode = useEditor((state) => state.devMode);
  const toggleDevMode = useEditor((state) => state.toggleDevMode);
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      <div className="toolbar__group">
        <ToolButton
          icon="menu"
          label="Main menu"
          onClick={() => window.dispatchEvent(new CustomEvent('pigma:toggle-menu'))}
        />
      </div>
      <span className="toolbar__divider" />
      <div className="toolbar__group">
        {TOOLS.map((entry) => (
          <ToolButton
            key={entry.tool}
            icon={entry.icon}
            label={entry.label}
            shortcut={entry.shortcut}
            active={tool === entry.tool}
            onClick={() => setTool(entry.tool)}
          />
        ))}
      </div>
      <span className="toolbar__divider" />
      <div className="toolbar__group">
        {/* The </> workspace switch: Dev Mode. */}
        <ToolButton
          icon="code"
          label="Toggle dev mode"
          shortcut=""
          active={devMode}
          onClick={() => toggleDevMode()}
        />
      </div>
      {isMobile ? (
        <>
          <span className="toolbar__divider" />
          <div className="toolbar__group">
            {/* Phones have no right panel; the drawer is opened from here. */}
            <ToolButton icon="sliders" label="Design" onClick={() => setMobileDrawer('right')} />
          </div>
        </>
      ) : null}
      <span className="toolbar__divider" />
      <div className="toolbar__group">
        <ToolButton
          icon="component"
          label="Create component"
          onClick={() => useEditor.getState().createComponentFromSelection()}
        />
        <ToolButton icon="play" label="Present" shortcut="⌘\" onClick={() => useEditor.getState().setPresentation(true)} />
      </div>
      {peers.length > 0 ? (
        <>
          <span className="toolbar__divider" />
          {/* Local-only presence: other tabs of this browser. */}
          <div
            className="toolbar__group presence"
            aria-label={`${peers.length} other tab${peers.length === 1 ? '' : 's'} editing`}
            data-tooltip="Other tabs of this browser (local only — no server collaboration)"
          >
            {peers.slice(0, 4).map((peer) => (
              <span key={peer.id} className="presence__dot" style={{ background: peer.color }} title={peer.name} />
            ))}
            <span className="presence__count">{peers.length + 1} tabs</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

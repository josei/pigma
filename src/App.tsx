import { useEffect } from 'react';
import { Rail } from './ui/Rail';
import { LeftPanel } from './ui/LeftPanel';
import { Canvas } from './ui/Canvas';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { Toolbar } from './ui/Toolbar';
import { Menu } from './ui/Menu';
import { ContextMenu } from './ui/ContextMenu';
import { Toasts } from './ui/Toasts';
import { ExportPngDialog } from './ui/ExportPngDialog';
import { ShareLinkDialog } from './ui/ShareLinkDialog';
import { PanelResizer } from './ui/PanelResizer';
import { useIsMobile } from './ui/useIsMobile';
import { Presentation } from './ui/Presentation';
import { useFileActionEvents } from './ui/FileActions';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useEditor } from './store/editorStore';
import { whenFontsReady } from './render/textMetrics';

export function App() {
  useKeyboardShortcuts();
  useFileActionEvents();
  const presentation = useEditor((state) => state.presentation);
  const mobileDrawer = useEditor((state) => state.mobileDrawer);
  const setMobileDrawer = useEditor((state) => state.setMobileDrawer);
  const isMobile = useIsMobile();

  // Text metrics change once webfonts land; re-measure so auto-sized text fits.
  useEffect(() => {
    whenFontsReady(() => useEditor.getState().syncTextSizes());
  }, []);

  // On a phone the panels have no room in the layout, so the panel drawer starts
  // open (the user closes it, and it stays closed until they ask for it again).
  useEffect(() => {
    if (isMobile && useEditor.getState().mobileDrawer === null) setMobileDrawer('left');
  }, [isMobile, setMobileDrawer]);

  return (
    <div className="app">
      <Rail />
      {isMobile && mobileDrawer ? (
        <div
          className="drawer-scrim"
          data-testid="drawer-scrim"
          role="presentation"
          aria-hidden="true"
          onClick={() => setMobileDrawer(null)}
        />
      ) : null}
      <LeftPanel />
      <PanelResizer side="left" />
      <div className="app__canvas">
        <Canvas />
      </div>
      <PanelResizer side="right" />
      <PropertiesPanel />
      <Toolbar />
      <Menu />
      <ContextMenu />
      <Toasts />
      <ExportPngDialog />
      <ShareLinkDialog />
      {presentation ? <Presentation /> : null}
    </div>
  );
}

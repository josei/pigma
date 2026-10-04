import { useEffect } from 'react';
import { loadDecompressors, parseFigFile, parseFigmaRest, toPigmaFile } from '../figma';
import { useEditor } from '../store/editorStore';
import { safeFileName } from '../model/serialize';
import { PIGMA_ACCEPT, PIGMA_MIME, pigmaFileName } from '../model/format';
import { isRecord } from '../model/guards';
import { decodeImageFile } from './imageInput';
import { renderScenePng, renderSceneVectorPdf } from '../render/rasterExport';
import { toCss } from '../model/codegen';
import { copyText } from './clipboard';

export type FileAction =
  | 'import-json'
  | 'import-figma-json'
  | 'import-fig'
  | 'export-json'
  | 'export-svg'
  | 'place-image'
  | 'copy-svg'
  | 'copy-css'
  | 'export-png-1x'
  | 'export-png-2x'
  | 'export-png-3x'
  | 'export-pdf'
  | 'export-png-options'
  | 'export-selection-svg'
  | 'export-selection-png-options'
  | 'open-file'
  | 'save-file'
  | 'save-file-as'
  | 'copy-png';

const ACCEPT: Record<'json' | 'fig' | 'image', string> = {
  // Native `.pigma` first, legacy JSON still accepted: the schema decides.
  json: PIGMA_ACCEPT,
  fig: '.fig,.deck,.jam,application/octet-stream',
  image: 'image/*',
};

function pickFile(kind: 'json' | 'fig' | 'image', onLoad: (file: File) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPT[kind];
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (file) onLoad(file);
  });
  input.click();
}

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function download(name: string, mime: string, contents: string): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function reportToMessages(report: { warnings: string[]; unsupported: Array<{ feature: string }> }): string {
  const parts: string[] = [];
  if (report.unsupported.length > 0) {
    const features = [...new Set(report.unsupported.map((item) => item.feature))].slice(0, 4);
    parts.push(`${report.unsupported.length} unsupported item(s): ${features.join(', ')}`);
  }
  if (report.warnings.length > 0) parts.push(report.warnings[0] ?? '');
  return parts.filter(Boolean).join(' · ');
}

/** Import a Figma REST payload (file or nodes endpoint) or a Pigma document. */
function importJsonText(text: string): void {
  const store = useEditor.getState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    store.pushToast(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const looksLikePigma = isRecord(parsed) && isRecord(parsed.document) && typeof parsed.schema === 'string';
  if (looksLikePigma) {
    const result = store.importJsonText(text);
    for (const warning of result.warnings.slice(0, 1)) store.pushToast(warning, 'success');
    return;
  }
  try {
    const source = parseFigmaRest(parsed);
    const { file, report } = toPigmaFile(source);
    store.loadFile(file, 'Import Figma JSON');
    const summary = reportToMessages(report);
    store.pushToast(`Imported ${file.name} from Figma${summary ? ` — ${summary}` : ''}`, 'success');
  } catch (error) {
    store.pushToast(`Figma import failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function importFigFile(file: File): Promise<void> {
  const store = useEditor.getState();
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const decompress = await loadDecompressors();
    const source = parseFigFile(buffer, decompress);
    const { file: pigma, report } = toPigmaFile(source);
    store.loadFile(pigma, 'Import .fig');
    const summary = reportToMessages(report);
    store.pushToast(`Imported ${pigma.name}${summary ? ` — ${summary}` : ''}`, 'success');
  } catch (error) {
    store.pushToast(`.fig import failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function runFileAction(action: FileAction): void {
  const store = useEditor.getState();
  switch (action) {
    case 'import-json':
    case 'import-figma-json':
      pickFile('json', (file) => {
        void file.text().then(importJsonText);
      });
      return;
    case 'import-fig':
      pickFile('fig', (file) => {
        void importFigFile(file);
      });
      return;
    case 'open-file':
      void store.openFromDisk();
      return;
    case 'save-file':
      void store.saveToDisk();
      return;
    case 'save-file-as':
      void store.saveToDisk({ as: true });
      return;
    case 'export-json': {
      // The native format: `.pigma` with its own media type, so the file is not
      // mistaken for arbitrary JSON. The schema tag inside is the authority.
      const json = store.exportJsonString();
      download(pigmaFileName(store.file.name), PIGMA_MIME, json);
      store.pushToast('Exported JSON', 'success');
      return;
    }
    case 'copy-svg': {
      const svg = store.exportSvgString();
      if (!svg) {
        store.pushToast('Select a layer or draw something to copy as SVG');
        return;
      }
      void copyText(svg).then((ok) =>
        useEditor.getState().pushToast(ok ? 'SVG copied to the clipboard' : 'Could not write to the clipboard', ok ? 'success' : 'error'),
      );
      return;
    }
    case 'copy-css': {
      const state = useEditor.getState();
      const id = state.selection[0];
      if (!id) {
        store.pushToast('Select a layer to copy its CSS');
        return;
      }
      const css = toCss(state.file, id);
      if (!css) {
        store.pushToast('That layer has no CSS to copy');
        return;
      }
      void copyText(css).then((ok) =>
        useEditor.getState().pushToast(ok ? 'CSS copied to the clipboard' : 'Could not write to the clipboard', ok ? 'success' : 'error'),
      );
      return;
    }
    case 'place-image':
      pickFile('image', (file) => {
        void decodeImageFile(file, file.name).then(
          (decoded) => {
            useEditor.getState().placeImage(decoded.dataUrl, { width: decoded.width, height: decoded.height });
            useEditor.getState().pushToast(`Placed ${decoded.name}`, 'success');
          },
          (error: unknown) => store.pushToast(`Could not place image: ${String(error)}`),
        );
      });
      return;
    case 'export-png-options': {
      store.setPngOptions({ open: true });
      return;
    }
    case 'export-selection-png-options': {
      if (store.selection.length === 0) {
        store.pushToast('Select something to export');
        return;
      }
      store.setPngOptions({ open: true, scope: 'selection' });
      return;
    }
    case 'export-png-1x':
    case 'export-png-2x':
    case 'export-png-3x': {
      exportPng(action === 'export-png-1x' ? 1 : action === 'export-png-2x' ? 2 : 3, false);
      return;
    }
    case 'export-pdf': {
      const scene = store.exportScene();
      if (!scene) {
        store.pushToast('Nothing to export on this page');
        return;
      }
      try {
        const { blob, warnings } = renderSceneVectorPdf(store.file, scene.nodeIds, {
          viewBox: scene.viewBox,
          title: scene.name,
          background: '#ffffff',
        });
        downloadBlob(safeFileName(scene.name, 'pdf'), blob);
        useEditor
          .getState()
          .pushToast(
            warnings.length > 0 ? `Exported vector PDF · ${warnings[0]}` : 'Exported vector PDF',
            warnings.length > 0 ? undefined : 'success',
          );
      } catch (error: unknown) {
        useEditor.getState().pushToast(`PDF export failed: ${String(error)}`);
      }
      return;
    }
    case 'export-selection-svg': {
      const selection = store.selection;
      if (selection.length === 0) {
        store.pushToast('Select something to export');
        return;
      }
      const svg = store.exportSvgString(selection);
      if (!svg) {
        store.pushToast('Nothing to export in the selection');
        return;
      }
      download(safeFileName(`${store.file.name}-selection`, 'svg'), 'image/svg+xml', svg);
      store.pushToast(`Exported selection SVG (${selection.length} layer${selection.length === 1 ? '' : 's'})`, 'success');
      return;
    }
    case 'copy-png': {
      const ids = store.selection.length > 0 ? [...store.selection] : undefined;
      const scene = store.exportScene(ids);
      if (!scene) {
        store.pushToast('Nothing to copy');
        return;
      }
      const png = renderScenePng({
        svg: scene.svg,
        viewBox: scene.viewBox,
        backgroundBlurs: scene.backgroundBlurs,
        scale: store.pngOptions.scale,
        // A clipboard bitmap is for quick pasting: skip the webfont round trip.
        embedFont: false,
        ...(store.pngOptions.transparent ? {} : { background: '#ffffff' }),
      });
      void (async () => {
        try {
          if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
            throw new Error('the clipboard API is unavailable');
          }
          // A promise-valued item lets the browser start the write immediately
          // instead of waiting for the blob and then issuing a second call.
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
          useEditor.getState().pushToast('Copied PNG to the clipboard', 'success');
        } catch (error: unknown) {
          useEditor.getState().pushToast(`Could not copy the image: ${String(error)}`);
        }
      })();
      return;
    }
    case 'export-svg': {
      const svg = store.exportSvgString();
      if (!svg) {
        store.pushToast('Nothing to export on this page');
        return;
      }
      download(safeFileName(store.file.name, 'svg'), 'image/svg+xml', svg);
      store.pushToast('Exported SVG', 'success');
    }
  }
}

/** Bridges window events (raised by the menu and the left panel) to file actions. */
/**
 * Ids for the requested scope: the selection, or every layer on the active page.
 * The page case is explicit because `exportScene()` falls back to the selection
 * when one exists.
 */
function scopeIds(scope: 'selection' | 'page'): string[] | undefined {
  const store = useEditor.getState();
  if (scope === 'selection') return store.selection.length > 0 ? [...store.selection] : undefined;
  const page = store.file.document.children.find((child) => child.id === store.pageId);
  return page ? page.children.map((child) => child.id) : undefined;
}

/** PNG export shared by the quick menu entries and the options dialog. */
function exportPng(scale: number, transparent: boolean, scope: 'selection' | 'page' = 'page'): void {
  const store = useEditor.getState();
  const ids = scopeIds(scope);
  if (scope === 'selection' && !ids) {
    store.pushToast('Select something to export');
    return;
  }
  const scene = store.exportScene(ids);
  if (!scene) {
    store.pushToast(ids ? 'Nothing to export in the selection' : 'Nothing to export on this page');
    return;
  }
  void renderScenePng({
    svg: scene.svg,
    viewBox: scene.viewBox,
    backgroundBlurs: scene.backgroundBlurs,
    scale,
    // No background colour leaves the PNG transparent.
    ...(transparent ? {} : { background: '#ffffff' }),
  }).then(
    (blob) => {
      downloadBlob(safeFileName(`${store.file.name}-${scale}x`, 'png'), blob);
      useEditor
        .getState()
        .pushToast(
          `Exported ${ids ? 'selection' : 'page'} PNG at ${scale}x (${Math.round(scene.viewBox.width * scale)}x${Math.round(scene.viewBox.height * scale)})${transparent ? ', transparent' : ''}`,
          'success',
        );
    },
    (error: unknown) => useEditor.getState().pushToast(`PNG export failed: ${String(error)}`),
  );
}

export function useFileActionEvents(): void {
  useEffect(() => {
    const bindings: Array<[string, FileAction]> = [
      ['pigma:export-json', 'export-json'],
      ['pigma:open-file', 'open-file'],
      ['pigma:save-file', 'save-file'],
      ['pigma:save-file-as', 'save-file-as'],
      ['pigma:import-json', 'import-json'],
      ['pigma:import-fig', 'import-fig'],
      ['pigma:import-figma-json', 'import-figma-json'],
      ['pigma:export-svg', 'export-svg'],
      ['pigma:place-image', 'place-image'],
      ['pigma:export-png-options', 'export-png-options'],
      ['pigma:export-selection-png-options', 'export-selection-png-options'],
      ['pigma:export-png-1x', 'export-png-1x'],
      ['pigma:export-png-2x', 'export-png-2x'],
      ['pigma:export-png-3x', 'export-png-3x'],
      ['pigma:export-pdf', 'export-pdf'],
      ['pigma:export-selection-svg', 'export-selection-svg'],
      ['pigma:copy-png', 'copy-png'],
      ['pigma:copy-svg', 'copy-svg'],
      ['pigma:copy-css', 'copy-css'],
    ];
    const unbind = bindings.map(([event, action]) => {
      const listener = () => runFileAction(action);
      window.addEventListener(event, listener);
      return () => window.removeEventListener(event, listener);
    });
    // The options dialog exports with the chosen scale and background.
    const custom = (event: Event) => {
      const detail = (event as CustomEvent<{ scale?: number; transparent?: boolean; scope?: 'selection' | 'page' }>).detail ?? {};
      exportPng(detail.scale ?? 2, detail.transparent === true, detail.scope ?? 'page');
    };
    window.addEventListener('pigma:export-png', custom);
    return () => {
      unbind.forEach((off) => off());
      window.removeEventListener('pigma:export-png', custom);
    };
  }, []);
}

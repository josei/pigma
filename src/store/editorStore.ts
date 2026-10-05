import { create } from 'zustand';
import type {
  AutoLayout,
  CanvasNode,
  ComponentNode,
  Node,
  ParentNode,
  PigmaFile,
  PrototypeInteraction,
  Rect,
  SceneNode,
  TextNode,
  TextStyle,
} from '../model/types';
import { hasChildren, isComponentNode } from '../model/types';
import { absoluteBounds, boundsOfNodes, findNode, insertChild, parentAndIndex, removeNode, updateNode } from '../model/tree';
import {
  alignNodes,
  applyNodePatch,
  applyNodePatchToAll,
  cloneSubtree,
  distributeNodes,
  duplicateNodes,
  frameSelection as frameSelectionOp,
  groupNodes,
  instantiateClipboard,
  positionNodes,
  reorderNodes,
  setAutoLayout as setAutoLayoutOp,
  resizeFromHandle,
  setWorldRotation,
  translateWorld,
  ungroupNodes,
  type AlignMode,
  type NodePatch,
  type ReorderMode,
  type ResizeHandle,
} from '../model/ops';
import { createCanvasNode } from '../model/factory';
import { nextNodeId } from '../model/ids';
import { parseFile, serializeFile } from '../model/serialize';
import { syncTextSizes as syncTextSizesOp } from '../model/textSync';
import { renderSvgDocument } from '../render/svgExport';
import { defaultDocument } from '../model/starter';
import { emptyFile } from '../model/validate';
import { settleDocument } from '../model/settle';
import { validatePigmaFile } from '../model/validate';
import { defaultLayoutGrid } from '../model/constraints';
import { flipNodes, type FlipAxis } from '../model/flip';
import { booleanLabel, booleanNodes, booleanOperandsOf, setBooleanMode as setBooleanModeOp, type BooleanMode } from '../model/boolean';
import type { PresenceCursor, PresencePeer } from './presence';
import type { DocumentSummary } from './documentLibrary';
import { clearRoomTouched, createDocument, markDirty, markRoomTouched, persistNow } from './persistence';
import { openFileFromDisk, saveFileToDisk, supportsFileSystemAccess, writeToHandle, type FileHandleLike } from './fileSystem';
import { parseKeyText } from '../collab/share';
import { readMcpEnvironment, type McpAdvertisement } from '../config/mcpAvailability';
import { MIN_ZOOM, clampViewport, clampZoom } from '../collab/protocol';
import {
  EMPTY_CONVERGENCE,
  applyLocalOps,
  diffFiles,
  applyRemoteOps,
  localStamp,
  mergeSnapshot,
  type ConvergenceState,
  type EditOp,
  type Stamp,
} from '../collab/merge';
import {
  EMPTY_ROOM,
  createRoomClient,
  defaultRelayBase,
  followCursorViewport,
  type RoomClient,
  type RoomState,
} from '../collab/client';
import { getPluginEngine } from '../plugins/browserLoader';
import { BUILTIN_PLUGINS } from '../plugins/builtins';
import {
  isRunnable,
  newPlugin,
  normalizePluginName,
  upsertPlugin,
  type PluginRecord,
} from '../plugins/registry';
import { overlayDims } from '../model/overlay';
import {
  importLibraryStyle as importLibraryStyleOp,
  importLibraryVariables as importLibraryVariablesOp,
  instantiateFromLibrary,
  publishLibrary as publishLibraryOp,
  libraryLinkForComponent,
  updateInstancesFromLibrary,
  upsertLibrary,
  type Library,
} from '../model/library';
import {
  addComment as addCommentOp,
  addReply as addReplyOp,
  deleteComment as deleteCommentOp,
  moveComment as moveCommentOp,
  setCommentResolved as setCommentResolvedOp,
} from '../model/comments';
import {
  deleteVersion as deleteVersionOp,
  renameVersion as renameVersionOp,
  saveAutoVersion,
  saveVersion as saveVersionOp,
  shouldAutoSnapshot,
  versionContent,
  versionsOf,
} from '../model/versions';
import { diffDocuments, type DocumentDiff } from '../model/versionDiff';
import {
  addFlow as addFlowOp,
  addInteraction as addInteractionOp,
  defaultInteraction,
  removeFlow as removeFlowOp,
  removeInteraction as removeInteractionOp,
  renameFlow as renameFlowOp,
  updateInteraction as updateInteractionOp,
  type PrototypeActionKind,
} from '../model/prototype';
import {
  addComponentProperty as addComponentPropertyOp,
  createComponentSet as createComponentSetOp,
  setInstanceProperty as setInstancePropertyOp,
  setInstanceVariant as setInstanceVariantOp,
  swapInstanceComponent,
} from '../model/variants';
import type { ComponentPropertyValue, DevStatus, OverlayPosition, PrototypeAction } from '../model/types';
import {
  addMode as addModeOp,
  addVariable as addVariableOp,
  bindVariable as bindVariableOp,
  collectionsOf,
  createCollection as createCollectionOp,
  deleteVariable as deleteVariableOp,
  renameVariable as renameVariableOp,
  setActiveMode as setActiveModeOp,
  setVariableValue as setVariableValueOp,
  type VariableType,
} from '../model/variables';
import type { VariableValue } from '../model/types';
import {
  applyStyle as applyStyleOp,
  createStyleFromNode,
  deleteStyle as deleteStyleOp,
  detachStyle,
  renameStyle as renameStyleOp,
  stylesOf,
  updateStylePayload,
  type StyleType,
} from '../model/styles';
import { removeAnchor, vectorNodeFromPath, vectorPathOf, writeVectorPath, type VectorPath } from '../model/vector';
import { backgroundBlurRadius, hasBackgroundBlur } from '../model/effects';
import type { BackgroundBlurRegion } from '../render/rasterExport';
import {
  addEffectToNodes,
  removeEffectAt,
  toggleEffectAt,
  updateEffectAt,
  type EffectKind,
} from '../model/effects';
import type { BlurEffect, ChildrenMixin, ImagePaint, LayoutGrid, ShadowEffect } from '../model/types';
import {
  fitImageBox,
  imageDataUrlOf,
  placeImage as placeImageOp,
  replaceImage as replaceImageBytesOp,
  setImageCrop as setImageCropOp,
  setImageScaleMode as setImageScaleModeOp,
  withImageFill,
  type ImageCrop,
} from '../model/image';
import { instanceAncestryOf, syncInstances, withOverride } from '../model/instances';
import { documentProblems } from '../model/invariants';
import type { NodeOverride } from '../model/types';

export type Tool =
  | 'select'
  | 'hand'
  | 'frame'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'text'
  | 'section'
  | 'pen'
  | 'comment';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface HistoryEntry {
  file: PigmaFile;
  selection: string[];
  pageId: string;
  label: string;
}

export interface Toast {
  id: string;
  message: string;
  kind: 'error' | 'success';
}

export type LeftTab = 'file' | 'layers' | 'assets' | 'tools' | 'comments' | 'plugins' | 'rooms';
export type RightTab = 'design' | 'prototype' | 'inspect';
export type ThemeName = 'light' | 'dark';

/** Side panel sizing (M9). */
export const PANEL_WIDTH_DEFAULT = 240;
export const PANEL_WIDTH_MIN = 180;
export const PANEL_WIDTH_MAX = 560;

/** Never let the panels squeeze the canvas below a usable width. */
export function panelWidthLimit(): number {
  if (typeof window === 'undefined') return PANEL_WIDTH_MAX;
  return Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, Math.round(window.innerWidth - 600)));
}

export interface EditorState {
  file: PigmaFile;
  pageId: string;
  selection: string[];
  tool: Tool;
  viewport: Viewport;
  canvasSize: { width: number; height: number };
  /** True until the first zoom-to-fit after loading a document. */
  pendingFit: boolean;
  /** Index of the vector anchor being edited, or null. */
  selectedAnchor: number | null;
  /** Container the user drilled into (double-click), or null for the page. */
  enteredContainerId: string | null;
  editingTextId: string | null;
  clipboard: SceneNode[] | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  transaction: HistoryEntry | null;
  leftTab: LeftTab;
  rightTab: RightTab;
  /**
   * Dev Mode: the `</>` workspace. The right panel shows only Inspect and the
   * design-only controls are hidden, so a developer sees the handoff surface.
   */
  devMode: boolean;
  /** Canvas aids: pixel grid, rulers, and what dragging snaps to. */
  showGrid: boolean;
  showRulers: boolean;
  /**
   * Draw GREEN outlines around masks on the canvas. Figma gates this behind
   * `View > Mask outlines` and draws it green so it cannot be confused with the
   * purple selection outline; ours lives in the main menu with the other view
   * toggles, for the same reason.
   */
  showMaskOutlines: boolean;
  snapToObjects: boolean;
  snapToGrid: boolean;
  gridSize: number;
  presentation: boolean;
  presentationFrameId: string | null;
  presentationStack: string[];
  /** Overlay frames stacked above the presented frame. */
  /** Open overlay frames, with the placement options they were opened with. */
  presentationOverlays: OverlayEntry[];
  /** Version being previewed (the canvas shows its content read-only). */
  previewVersionId: string | null;
  /** The version being compared against the open document, if any. */
  compareVersionId: string | null;
  /** What differs between that version and the open document (read-only). */
  compareDiff: DocumentDiff | null;
  /** File shown while previewing; null means "the live document". */
  previewFile: PigmaFile | null;
  /** Edits since the newest version, used to pace auto snapshots. */
  editsSinceVersion: number;
  /** Comment thread whose popover is open, if any. */
  activeCommentId: string | null;
  theme: ThemeName;
  /** Locally published libraries (M11), newest last. */
  libraries: Library[];
  /** Side panel widths, persisted with the document. */
  panelWidths: { left: number; right: number };
  /** Which side panel is open as a drawer on narrow screens. */
  mobileDrawer: 'left' | 'right' | null;
  /** The `#open=` link this document came from, if any. */
  linkedSource: { url: string; name: string | null } | null;
  /** The "Copy link to this document" dialog. */
  shareLinkOpen: boolean;
  /**
   * True once the user has changed a linked document. Until then the document
   * stays "loaded from a link": on screen, but not written to the library.
   */
  linkedDirty: boolean;
  /**
   * Where MCP can be reached, as reported by the environment: the desktop
   * shell's loopback endpoint and/or what this page's own server advertises.
   * Both are null on the hosted site, which is what gates the MCP panel.
   */
  mcpEnvironment: {
    desktop: McpAdvertisement | null;
    advertised: McpAdvertisement | null;
    desktopToken: string | null;
  };
  /** PNG export options (M16): scale and transparent background. */
  pngOptions: { open: boolean; scale: number; transparent: boolean; scope: 'selection' | 'page' };
  /** Dev-mode measurement overlays (M14). */
  showRedlines: boolean;
  /** Installed plugins: built-ins plus the user's own (M15). */
  plugins: PluginRecord[];
  /** Documents in the local library (P5). */
  documents: DocumentSummary[];
  /** Id of the document currently open, when it came from the library. */
  activeDocumentId: string | null;
  /** Retained handle for "save back to the file the user picked" (P5). */
  fileHandle: FileHandleLike | null;
  /** Rooms client state (M13): offline until a room is joined. */
  room: RoomState;
  /** Peer being followed, if any (their cursor drives the viewport). */
  followingId: string | null;
  /** Whether this browser can open/save real files. */
  fileAccessSupported: boolean;
  /** Plugin console transcript, newest last. */
  pluginConsole: PluginConsoleEntry[];
  /** Id of the plugin currently running, if any. */
  pluginRunning: string | null;
  /** Other tabs of this browser (M13, local only). */
  presence: PresencePeer[];
  /** This tab's pointer position in world coordinates, shared with siblings. */
  localCursor: PresenceCursor | null;
  toasts: Toast[];

  setTool: (tool: Tool) => void;
  setViewport: (viewport: Viewport) => void;
  /** Share this tab's viewport with the room, so a peer can follow it. */
  shareViewport: () => void;
  /** Read where MCP is reachable (desktop shell, server advertisement). */
  loadMcpEnvironment: () => Promise<void>;
  setCanvasSize: (size: { width: number; height: number }) => void;
  zoomToFit: (rect?: Rect | null) => void;
  zoomToRect: (rect: Rect | null) => void;
  zoomTo: (zoom: number) => void;
  zoomToSelection: () => void;
  select: (ids: string[], mode?: 'replace' | 'add' | 'toggle') => void;
  selectAll: () => void;
  clearSelection: () => void;
  setEnteredContainer: (id: string | null) => void;

  beginTransaction: () => void;
  /** Abort the in-flight gesture, reverting to its starting state (no history). */
  cancelTransaction: () => void;
  endTransaction: (label: string) => void;
  undo: () => void;
  redo: () => void;

  apply: (
    label: string,
    mutator: (file: PigmaFile) => PigmaFile,
    options?: { coalesceKey?: string },
  ) => void;
  /**
   * Arrow-key nudge. A burst within {@link BURST_WINDOW_MS} is exactly one
   * history entry, so one undo returns the selection to where the burst started.
   */
  nudgeSelection: (dx: number, dy: number) => void;
  addNode: (node: SceneNode, parentId?: string) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  copySelection: () => void;
  cutSelection: () => void;
  pasteClipboard: () => void;
  updateSelected: (patch: NodePatch, label?: string) => void;
  /** Drop an image into the document, or fill the selection with it. */
  placeImage: (dataUrl: string, options: { width: number; height: number; x?: number; y?: number }) => void;
  applyImageFill: (dataUrl: string, size?: { width: number; height: number }) => boolean;
  /** Image fill editing (M2): scale mode, crop and replace. */
  setImageScaleMode: (mode: NonNullable<ImagePaint['scaleMode']>) => void;
  setImageCrop: (crop: ImageCrop) => void;
  replaceSelectedImage: (dataUrl: string, size?: { width: number; height: number }) => void;
  replaceImageBytes: (id: string, dataUrl: string) => void;
  addLayoutGrid: (pattern: 'COLUMNS' | 'ROWS' | 'GRID') => void;
  updateLayoutGrid: (index: number, patch: Partial<LayoutGrid>) => void;
  removeLayoutGrid: (index: number) => void;
  addEffect: (kind: EffectKind) => void;
  updateEffect: (index: number, patch: Partial<ShadowEffect> & Partial<BlurEffect>) => void;
  removeEffect: (index: number) => void;
  toggleEffect: (index: number) => void;
  setAutoLayout: (patch: Partial<AutoLayout>) => void;
  clearAutoLayout: () => void;
  resetOverrides: (instanceId: string) => void;
  updateSelectedTextStyle: (patch: Partial<TextStyle>, label?: string) => void;
  moveSelection: (dx: number, dy: number, transient?: boolean) => void;
  moveSelectionTo: (entries: Array<{ id: string; x: number; y: number }>, transient?: boolean) => void;
  syncTextSizes: () => void;
  resizeSelection: (
    id: string,
    handle: ResizeHandle,
    dx: number,
    dy: number,
    options?: { fromCenter?: boolean; keepRatio?: boolean; transient?: boolean },
  ) => void;
  rotateSelection: (id: string, degrees: number, transient?: boolean) => void;
  flip: (axis: FlipAxis) => void;
  booleanOp: (mode: BooleanMode) => void;
  /** Switch an existing boolean node to another operation, in place. */
  setBooleanMode: (mode: BooleanMode) => void;
  createComponentSet: () => void;
  setInstanceVariant: (instanceId: string, property: string, value: string) => void;
  /** Apply a SWAP_STATE action: point the instance at another variant component. */
  swapInstanceState: (instanceId: string, componentId: string) => void;
  setInstanceProperty: (instanceId: string, name: string, value: ComponentPropertyValue) => void;
  /**
   * Put content into a slot, or clear it back to the component's default.
   *
   * The content is CLONED from the given nodes, so using a selection as slot
   * content leaves the originals where they are (Figma moves them instead).
   * `slotNodeId` is the component node the slot property is bound to.
   */
  setSlotContent: (instanceId: string, slotNodeId: string, contentIds: string[] | null) => void;
  addComponentProperty: (componentId: string, type: 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP', name: string, defaultValue: ComponentPropertyValue) => void;
  addVariableCollection: () => void;
  addVariable: (collectionId: string, type: VariableType) => void;
  setVariableValue: (variableId: string, value: VariableValue) => void;
  renameVariable: (variableId: string, name: string) => void;
  deleteVariable: (variableId: string) => void;
  addMode: (collectionId: string) => void;
  setActiveMode: (collectionId: string, modeId: string) => void;
  bindVariable: (property: string, variableId: string | null) => void;
  createStyle: (type: StyleType) => void;
  applyStyle: (styleId: string) => void;
  detachStyle: () => void;
  renameStyle: (styleId: string, name: string) => void;
  deleteStyle: (styleId: string) => void;
  updateStyleFromSelection: (styleId: string) => void;
  createVector: (path: VectorPath, offset: { x: number; y: number }) => void;
  setVectorPath: (id: string, path: VectorPath, transient?: boolean) => void;
  setSelectedAnchor: (index: number | null) => void;
  /** Remove the selected anchor (Delete while editing a vector). */
  deleteSelectedAnchor: () => boolean;
  reorder: (mode: ReorderMode) => void;
  align: (mode: AlignMode) => void;
  distribute: (axis: 'horizontal' | 'vertical') => void;
  toggleVisible: (id: string) => void;
  toggleLock: (id: string) => void;
  renameNode: (id: string, name: string) => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  frameSelection: () => void;
  setEditingText: (id: string | null) => void;
  setCharacters: (id: string, characters: string, transient?: boolean) => void;
  createComponentFromSelection: () => void;
  insertInstance: (componentId: string) => void;
  detachInstance: (id: string) => void;
  setInteraction: (nodeId: string, interaction: PrototypeInteraction | null) => void;
  /** Publish the file's components/styles/variables as a local library. */
  publishLibrary: (name?: string) => void;
  deleteLibrary: (libraryId: string) => void;
  /** Insert a library component as a linked instance at the viewport centre. */
  insertFromLibrary: (libraryId: string, componentKey: string) => void;
  /** Refresh every instance linked to a library, or one of them. */
  updateLibraryInstances: (libraryId: string, instanceId?: string) => void;
  /** Copy a published style / the published variables into this file. */
  importLibraryStyle: (libraryId: string, styleKey: string) => void;
  importLibraryVariables: (libraryId: string) => void;
  setLibraries: (libraries: Library[]) => void;
  /** File System Access (P5): open a real file, or save back to the retained one. */
  openFromDisk: () => Promise<void>;
  saveToDisk: (options?: { as?: boolean }) => Promise<void>;
  setFileHandle: (handle: FileHandleLike | null) => void;
  /** Rooms (M13): join with a nickname, leave, follow a peer. */
  joinRoom: (options: {
    nickname: string;
    roomId: string;
    token?: string;
    base?: string;
    /** Room key from a share link. Present means an end-to-end encrypted room. */
    key?: string;
    /** Joining without a key requires this explicit opt-in. */
    allowPlaintext?: boolean;
  }) => void;
  leaveRoom: () => void;
  followPeer: (clientId: string | null) => void;
  setRoomState: (room: RoomState) => void;
  setPanelWidth: (side: 'left' | 'right', width: number) => void;
  /** Open/close a panel drawer (mobile layout); passing the open side closes it. */
  setMobileDrawer: (drawer: 'left' | 'right' | null) => void;
  /** PNG export options dialog. */
  setPngOptions: (patch: Partial<{ open: boolean; scale: number; transparent: boolean; scope: 'selection' | 'page' }>) => void;
  setRedlines: (on: boolean) => void;
  /** Run a plugin against the open document; the whole run is one undo entry. */
  runPlugin: (id: string) => Promise<void>;
  /** Create or update a user plugin (built-ins are forked on edit). */
  savePlugin: (input: { id?: string; name: string; source: string }) => string;
  deletePlugin: (id: string) => void;
  clearPluginConsole: () => void;
  appendPluginConsole: (entry: Omit<PluginConsoleEntry, 'id' | 'at'>) => void;
  /** Publish this tab's pointer position (world coordinates) to sibling tabs. */
  setLocalCursor: (cursor: PresenceCursor | null) => void;
  setPresence: (peers: PresencePeer[]) => void;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
  addComment: (x: number, y: number, text: string, nodeId?: string | null) => void;
  replyToComment: (commentId: string, text: string) => void;
  setCommentResolved: (commentId: string, resolved: boolean) => void;
  deleteComment: (commentId: string) => void;
  moveComment: (commentId: string, x: number, y: number) => void;
  setActiveComment: (commentId: string | null) => void;
  saveVersion: (name?: string) => void;
  renameVersion: (versionId: string, name: string) => void;
  deleteVersion: (versionId: string) => void;
  previewVersion: (versionId: string | null) => void;
  /**
   * Compare a version against the open document: highlights added, removed and
   * changed layers. Read-only — it never touches the document or the history.
   */
  compareVersion: (versionId: string | null) => void;
  restoreVersion: (versionId: string) => void;
  addInteraction: (
    nodeId: string,
    destinationId?: string,
    kind?: PrototypeActionKind,
    transition?: PrototypeAction['transition'],
  ) => void;
  updateInteraction: (nodeId: string, index: number, patch: Partial<PrototypeInteraction>) => void;
  removeInteraction: (nodeId: string, index: number) => void;
  addFlow: (startNodeId: string, name?: string) => void;
  renameFlow: (flowId: string, name: string) => void;
  removeFlow: (flowId: string) => void;
  openOverlay: (nodeId: string, action?: PrototypeAction | null) => void;
  closeOverlay: () => void;
  setPrototypeStart: (nodeId: string | null) => void;

  setPage: (pageId: string) => void;
  addPage: () => void;
  renamePage: (pageId: string, name: string) => void;
  deletePage: (pageId: string) => void;

  newFile: () => void;
  loadStarterDocument: () => void;
  loadFile: (file: PigmaFile, label?: string) => void;
  /**
   * Show a document that came from a `#open=` link. Loaded clean: the local
   * document is untouched until the user edits or saves.
   */
  loadLinkedDocument: (file: PigmaFile, source: { url: string; name?: string | null }) => void;
  /** Keep a linked document as the user's own (an explicit save). */
  keepLinkedDocument: () => void;
  /** Open or close the "Copy link to this document" dialog. */
  setShareLinkOpen: (open: boolean) => void;
  importJsonText: (text: string) => { ok: boolean; errors: string[]; warnings: string[] };
  exportJsonString: () => string;
  exportSvgString: (ids?: string[]) => string;
  /** Everything the raster/PDF exporters need for the current selection or page. */
  exportScene: (ids?: string[]) => ExportScene | null;

  setLeftTab: (tab: LeftTab) => void;
  setRightTab: (tab: RightTab) => void;
  /** Enter or leave Dev Mode (the `</>` workspace). */
  toggleDevMode: () => void;
  /** Set (or clear) a frame's development status. */
  setDevStatus: (nodeId: string, status: DevStatus | null) => void;
  /**
   * Figma's "Use as mask" / "Remove mask": the node's geometry clips the siblings
   * above it. One history entry for the whole toggle.
   */
  toggleMask: (ids?: string[]) => void;
  toggleGrid: () => void;
  toggleRulers: () => void;
  toggleMaskOutlines: () => void;
  toggleSnapToObjects: () => void;
  toggleSnapToGrid: () => void;
  setPresentation: (on: boolean, frameId?: string | null) => void;
  navigatePrototype: (nodeId: string) => void;
  /** Replace the presented frame in place (Figma's SWAP navigation). */
  swapPrototype: (nodeId: string) => void;
  prototypeBack: () => void;
  pushToast: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: string) => void;
}

/** An overlay opened during a presentation (M12). */
export interface OverlayEntry {
  nodeId: string;
  position: OverlayPosition;
  x: number;
  y: number;
  dim: boolean;
}

export interface ExportScene {
  svg: string;
  viewBox: { x: number; y: number; width: number; height: number };
  backgroundBlurs: BackgroundBlurRegion[];
  name: string;
  /** Nodes the scene contains, so other exporters (PDF) draw the same set. */
  nodeIds: string[];
}

const HISTORY_LIMIT = 200;
/** Rooms cursor messages are throttled to this interval. */
const ROOM_CURSOR_INTERVAL_MS = 60;

/**
 * The coalescing rule for rapid repeats of one action.
 *
 * Consecutive changes carrying the same `coalesceKey` are one history entry while
 * each lands within this window of the previous one, so a burst of arrow-key
 * nudges is a single undo step that returns the selection to where the burst
 * began. A pause longer than the window, a different action, or an undo/redo
 * closes the burst and the next nudge starts a new entry.
 */
export const BURST_WINDOW_MS = 500;

/** The action currently coalescing, and when its last change landed. */
let burst: { key: string; at: number } | null = null;

/**
 * Bumped every time a burst closes. The burst key uses this instead of the
 * selection's ids, so building and comparing the key is O(1) — a select-all on a
 * large document must not allocate a string of ten thousand ids on every edit —
 * and, being a counter rather than a hash, two different selections can never
 * collide into one burst.
 */
let selectionRevision = 0;

/** The selection ids a move applies to (unlocked layers only). */
function movableIds(state: EditorState): string[] {
  return state.selection.filter((id) => {
    const node = findNode(state.file.document, id);
    return !!node && !node.locked;
  });
}

/** When the last cursor update went to the room. */
let lastRoomCursorAt = 0;
/** Viewports change far less often than cursors; share them at most this often. */
const ROOM_VIEWPORT_INTERVAL_MS = 150;
let lastRoomViewportAt = 0;

/** The one room socket this tab holds, if any. */
let roomClient: RoomClient | null = null;

/**
 * Convergence bookkeeping (M13).
 *
 * `lastSyncedFile` is the document the room last agreed on, so a local change can
 * be diffed into node-scoped ops. `lastRoomSeq` is the newest sequence seen from
 * the relay and `localEditCounter` counts this client's own edits: together they
 * stamp local writes, which is what lets a remote batch or snapshot compare
 * against them (see src/collab/merge.ts).
 */
let lastSyncedFile: PigmaFile | null = null;
let lastRoomSeq = 0;
let localEditCounter = 0;
let convergence: ConvergenceState = EMPTY_CONVERGENCE;

/** Reset the room-sync bookkeeping when a room is joined or left. */
function resetRoomSync(file: PigmaFile): void {
  lastSyncedFile = file;
  lastRoomSeq = 0;
  localEditCounter = 0;
  convergence = EMPTY_CONVERGENCE;
}

/** The stamp this client's next edit will carry. */
function nextLocalStamp(): Stamp {
  localEditCounter += 1;
  return localStamp({ lastSeenSeq: lastRoomSeq, localCounter: localEditCounter, clientId: roomClientId });
}

/** This tab's relay identity, reused across reconnects in the same session. */
let roomClientId = '';

/**
 * Publish local edits to the room. Called from the store subscription: the diff
 * against the last agreed document becomes node-scoped ops, so a remote client
 * only ever sees the nodes that actually changed.
 */
export function syncLocalEditsToRoom(): void {
  if (!roomClient || !roomClient.connected || lastSyncedFile === null) return;
  const file = useEditor.getState().file;
  if (file === lastSyncedFile) return;
  const ops = diffFiles(lastSyncedFile, file);
  if (ops.length === 0) {
    lastSyncedFile = file;
    return;
  }
  convergence = applyLocalOps(lastSyncedFile, file, nextLocalStamp(), convergence);
  lastSyncedFile = file;
  roomClient.sendOps(ops);
}

/** Close and forget the room client (used by join and leave). */
function leaveRoomClient(): void {
  roomClient?.disconnect();
  roomClient = null;
}
/** Plugin console keeps the last N lines; a chatty script cannot grow it forever. */
const PLUGIN_CONSOLE_LIMIT = 300;

/** A single plugin console line. */
export interface PluginConsoleEntry {
  id: string;
  at: number;
  kind: 'info' | 'log' | 'warning' | 'error' | 'success';
  text: string;
}

/** Plugin completion values are shown as compact JSON. */
function formatPluginOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
const initialFile = defaultDocument();

/** The page currently being edited (falls back to the first page). */
export function activePage(state: Pick<EditorState, 'file' | 'pageId'>): CanvasNode {
  const page = state.file.document.children.find((child) => child.id === state.pageId);
  if (page) return page;
  // A validated file always has at least one page; emptyFile() guarantees it too.
  return state.file.document.children[0] as CanvasNode;
}

export function selectedNodes(state: EditorState): SceneNode[] {
  const out: SceneNode[] = [];
  for (const id of state.selection) {
    const node = findNode(state.file.document, id);
    if (node && node.type !== 'DOCUMENT' && node.type !== 'CANVAS') out.push(node);
  }
  return out;
}

/** Container that receives newly drawn nodes: the entered container, else the page. */
export function activeContainer(state: EditorState): ParentNode {
  if (state.enteredContainerId) {
    const entered = findNode(state.file.document, state.enteredContainerId);
    if (entered && hasChildren(entered) && entered.type !== 'DOCUMENT' && entered.type !== 'CANVAS') return entered;
  }
  return activePage(state);
}

/** Reference-equality over every own key: exact, and immune to new file fields. */
function sameFile(a: PigmaFile, b: PigmaFile): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a as unknown as Record<string, unknown>)[key] !== (b as unknown as Record<string, unknown>)[key]) return false;
  }
  return true;
}

function snapshot(state: EditorState, label: string): HistoryEntry {
  return { file: state.file, selection: state.selection, pageId: state.pageId, label };
}

/**
 * Page to open after loading a file: the first one with content, so imported
 * documents do not open on an empty canvas page.
 */
function firstPageId(file: PigmaFile): string {
  const pages = file.document.children;
  const withContent = pages.find((page) => page.children.length > 0);
  return (withContent ?? pages[0] as CanvasNode).id;
}

function countInstances(node: Node, componentId: string): number {
  let count = node.type === 'INSTANCE' && node.componentId === componentId ? 1 : 0;
  if (hasChildren(node)) for (const child of node.children) count += countInstances(child, componentId);
  return count;
}

let toastCounter = 0;

export const useEditor = create<EditorState>((set, get) => ({
  file: initialFile,
  pageId: firstPageId(initialFile),
  selection: [],
  tool: 'select',
  viewport: { x: 0, y: 0, zoom: 1 },
  canvasSize: { width: 1200, height: 800 },
  pendingFit: true,
  selectedAnchor: null,
  enteredContainerId: null,
  editingTextId: null,
  clipboard: null,
  past: [],
  future: [],
  transaction: null,
  leftTab: 'layers',
  rightTab: 'design',
  devMode: false,
  showGrid: false,
  showRulers: true,
  showMaskOutlines: false,
  snapToObjects: true,
  snapToGrid: false,
  gridSize: 8,
  presentation: false,
  presentationFrameId: null,
  presentationStack: [],
  presentationOverlays: [],
  previewVersionId: null,
  compareVersionId: null,
  compareDiff: null,
  previewFile: null,
  editsSinceVersion: 0,
  activeCommentId: null,
  theme: 'light',
  libraries: [],
  panelWidths: { left: PANEL_WIDTH_DEFAULT, right: PANEL_WIDTH_DEFAULT },
  mobileDrawer: null,
  linkedSource: null,
  shareLinkOpen: false,
  linkedDirty: false,
  mcpEnvironment: { desktop: null, advertised: null, desktopToken: null },
  // Figma's export dialog starts at 1x; the menu also offers fixed 1x/2x/3x.
  pngOptions: { open: false, scale: 1, transparent: false, scope: 'page' },
  showRedlines: false,
  plugins: BUILTIN_PLUGINS,
  documents: [],
  activeDocumentId: null,
  fileHandle: null,
  fileAccessSupported: supportsFileSystemAccess(),
  room: EMPTY_ROOM,
  followingId: null,
  pluginConsole: [],
  pluginRunning: null,
  presence: [],
  localCursor: null,
  toasts: [],

  setTool: (tool) => set({ tool, editingTextId: null }),

  setViewport: (viewport) => set({ viewport }),

  setCanvasSize: (canvasSize) => set({ canvasSize }),

  zoomToRect: (rect) => {
    const state = get();
    const { width, height } = state.canvasSize;
    if (!rect || rect.width <= 0 || rect.height <= 0 || width <= 0 || height <= 0) {
      set({ viewport: { x: 0, y: 0, zoom: 1 }, pendingFit: false });
      return;
    }
    const padding = 96;
    const zoom = Math.min(
      4,
      Math.max(MIN_ZOOM, Math.min((width - padding) / rect.width, (height - padding) / rect.height)),
    );
    set({
      pendingFit: false,
      viewport: {
        zoom,
        x: width / 2 - (rect.x + rect.width / 2) * zoom,
        y: height / 2 - (rect.y + rect.height / 2) * zoom,
      },
    });
  },

  zoomToFit: (rect) => {
    const state = get();
    get().zoomToRect(rect ?? boundsOfPage(state));
  },

  zoomToSelection: () => {
    const state = get();
    const bounds = state.selection.length > 0 ? boundsOfNodes(state.file.document, state.selection) : null;
    get().zoomToRect(bounds ?? boundsOfPage(state));
  },

  zoomTo: (zoom) => {
    const state = get();
    const { width, height } = state.canvasSize;
    const clamped = clampZoom(zoom);
    const selectionBounds = state.selection.length > 0 ? boundsOfNodes(state.file.document, state.selection) : null;
    // Keep whatever the user is looking at centred: the selection, else the view.
    const focus = selectionBounds
      ? { x: selectionBounds.x + selectionBounds.width / 2, y: selectionBounds.y + selectionBounds.height / 2 }
      : {
          x: (width / 2 - state.viewport.x) / state.viewport.zoom,
          y: (height / 2 - state.viewport.y) / state.viewport.zoom,
        };
    set({
      pendingFit: false,
      viewport: { zoom: clamped, x: width / 2 - focus.x * clamped, y: height / 2 - focus.y * clamped },
    });
  },

  select: (ids, mode = 'replace') => {
    closeBurst();
    const current = get().selection;
    if (mode === 'replace') {
      set({ selection: ids });
      if (current.join() !== ids.join()) roomClient?.sendSelection(ids);
      return;
    }
    const next = new Set(current);
    for (const id of ids) {
      if (mode === 'toggle' && next.has(id)) next.delete(id);
      else next.add(id);
    }
    set({ selection: [...next] });
  },

  selectAll: () => {
    closeBurst();
    set({ selection: activeContainer(get()).children.map((child) => child.id) });
  },

  clearSelection: () => {
    closeBurst();
    set({ selection: [], editingTextId: null });
  },

  setEnteredContainer: (id) => set({ enteredContainerId: id }),

  beginTransaction: () => {
    // A gesture is its own unit of history: nothing before it can coalesce into it.
    closeBurst();
    const state = get();
    if (state.transaction) return;
    set({ transaction: snapshot(state, '') });
  },

  cancelTransaction: () => {
    closeBurst();
    const state = get();
    const tx = state.transaction;
    if (!tx) return;
    set({ transaction: null, ...restore(tx) });
  },

  endTransaction: (label) => {
    closeBurst();
    const state = get();
    const tx = state.transaction;
    if (!tx) return;
    if (tx.file.document === state.file.document) {
      set({ transaction: null });
      return;
    }
    set({
      transaction: null,
      past: [...state.past, { ...tx, label }].slice(-HISTORY_LIMIT),
      future: [],
    });
  },

  undo: () => {
    const state = get();
    // An undo closes any burst: the next nudge starts a fresh entry.
    closeBurst();
    const entry = state.past[state.past.length - 1];
    if (!entry) return;
    set({
      past: state.past.slice(0, -1),
      future: [...state.future, snapshot(state, entry.label)],
      ...restore(entry),
    });
  },

  redo: () => {
    closeBurst();
    const state = get();
    const entry = state.future[state.future.length - 1];
    if (!entry) return;
    set({
      future: state.future.slice(0, -1),
      past: [...state.past, snapshot(state, entry.label)],
      ...restore(entry),
    });
  },

  apply: (label, mutator, options) => {
    const state = get();
    const produced = mutator(state.file);
    if (produced === state.file) return;
    const next = settleDocument(produced);
    // A linked document becomes the user's own the moment they change it: from
    // here it is saved like any other document.
    if (state.linkedSource && !state.linkedDirty) set({ linkedDirty: true });
    // A no-op is only a no-op if *nothing* changed. Every file-level field is
    // compared, not a hand-maintained list: updates are immutable with structural
    // sharing, so an untouched field keeps its identity, and a new field can never
    // be silently dropped again.
    if (sameFile(state.file, next)) return;
    const file = { ...next, lastModified: Date.now() };
    // Inside a transaction (drag, scrub, text edit) every change belongs to the
    // gesture: endTransaction records the single entry for the whole thing.
    if (state.transaction) {
      set({ file });
      return;
    }
    const edits = state.editsSinceVersion + 1;
    // A rapid burst of the same action (arrow-key nudges) is ONE undo entry: the
    // entry already on the stack is the state from before the burst, so nothing
    // is pushed while the burst continues. Anything else — another action, a
    // pause longer than the window, or an undo/redo — closes the burst.
    const coalesceKey = options?.coalesceKey;
    const now = Date.now();
    // The key is the action, the document and the selection revision: a burst
    // belongs to the selection it moves in the document it moves it in, so a load
    // or a selection change starts a new burst by construction. It is O(1) — the
    // ids themselves are never part of it, and a counter cannot collide.
    const key = coalesceKey === undefined ? null : currentBurstKey(coalesceKey);
    const continuesBurst =
      key !== null && burst !== null && burst.key === key && now - burst.at <= BURST_WINDOW_MS && state.past.length > 0;
    burst = key === null ? null : { key, at: now };
    if (continuesBurst) {
      // The history stays as it is; the auto-version pass is skipped too, or it
      // would split the burst into uneven entries.
      set({ file, future: [], editsSinceVersion: edits });
      return;
    }
    if (shouldAutoSnapshot(edits)) {
      const auto = saveAutoVersion(file, 'Auto save');
      set({
        file: auto.file,
        past: [...state.past, snapshot(state, label)].slice(-HISTORY_LIMIT),
        future: [],
        editsSinceVersion: 0,
      });
      return;
    }
    set({
      file,
      past: [...state.past, snapshot(state, label)].slice(-HISTORY_LIMIT),
      future: [],
      editsSinceVersion: edits,
    });
  },

  addNode: (node, parentId) => {
    const parent = parentId ?? activeContainer(get()).id;
    get().apply(`Create ${node.name}`, (file) => {
      const container = findNode(file.document, parent);
      if (!container || !hasChildren(container)) return file;
      return { ...file, document: insertChild(file.document, parent, node) };
    });
    set({ selection: [node.id], tool: 'select' });
  },

  deleteSelection: () => {
    const state = get();
    const ids = state.selection.filter((id) => {
      const node = findNode(state.file.document, id);
      return !!node && !node.locked;
    });
    if (ids.length === 0) return;
    get().apply('Delete', (file) => {
      let document = file.document;
      for (const id of ids) document = removeNode(document, id).root;
      return { ...file, document };
    });
    set({ selection: [], editingTextId: null });
  },

  duplicateSelection: () => {
    const state = get();
    if (state.selection.length === 0) return;
    const result = duplicateNodes(state.file, state.selection);
    if (result.file === state.file) return;
    get().apply('Duplicate', () => result.file);
    set({ selection: result.newIds.filter((id) => !!findNode(result.file.document, id)) });
  },

  copySelection: () => {
    const nodes = selectedNodes(get());
    if (nodes.length === 0) return;
    set({ clipboard: nodes.map((node) => structuredClone(node)) });
  },

  cutSelection: () => {
    get().copySelection();
    get().deleteSelection();
  },

  pasteClipboard: () => {
    const state = get();
    const payload = state.clipboard;
    if (!payload || payload.length === 0) return;
    const parent = activeContainer(state).id;
    const result = instantiateClipboard(state.file, payload, parent);
    get().apply('Paste', () => result.file);
    set({ selection: result.newIds.filter((id) => !!findNode(result.file.document, id)) });
  },

  updateSelected: (patch, label = 'Change properties') => {
    const state = get();
    if (state.selection.length === 0) return;
    const ids = state.selection;
    get().apply(label, (file) => {
      // A node inside an instance records an override instead of changing the
      // component, so sibling instances and the master stay untouched.
      const direct: string[] = [];
      const overridden: Array<{ id: string; instanceId: string; componentNodeId: string }> = [];
      for (const id of ids) {
        const ancestry = instanceAncestryOf(file.document, id);
        if (ancestry && ancestry.instance.id !== id) {
          overridden.push({ id, instanceId: ancestry.instance.id, componentNodeId: ancestry.componentNodeId });
        } else {
          direct.push(id);
        }
      }
      let next = direct.length > 0 ? applyNodePatchToAll(file, direct, patch) : file;
      for (const entry of overridden) {
        const patched = applyNodePatch(next, entry.id, patch);
        const node = findNode(patched.document, entry.id);
        if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') continue;
        const override: NodeOverride = {
          name: node.name,
          visible: node.visible,
          locked: node.locked,
          opacity: node.opacity,
          fills: node.fills,
          strokes: node.strokes,
          strokeWeight: node.strokeWeight,
          effects: node.effects,
          x: node.transform.tx,
          y: node.transform.ty,
          width: node.width,
          height: node.height,
          ...(node.type === 'TEXT' ? { characters: node.characters } : {}),
          ...(node.cornerRadius !== undefined ? { cornerRadius: node.cornerRadius } : {}),
        };
        next = { ...patched, document: withOverride(patched.document, entry.instanceId, entry.componentNodeId, override) };
      }
      return next;
    });
  },

  placeImage: (dataUrl, options) => {
    const state = get();
    const { width: canvasWidth, height: canvasHeight } = state.canvasSize;
    const center = {
      x: options.x ?? (canvasWidth / 2 - state.viewport.x) / state.viewport.zoom,
      y: options.y ?? (canvasHeight / 2 - state.viewport.y) / state.viewport.zoom,
    };
    const box = fitImageBox(options.width, options.height, center);
    const parentId = activeContainer(state).id;
    const result = placeImageOp(state.file, parentId, dataUrl, box, 'FILL', {
      width: options.width,
      height: options.height,
    });
    get().apply('Place image', () => result.file);
    set({ selection: [result.node.id] });
  },

  applyImageFill: (dataUrl, size) => {
    const state = get();
    const ids = state.selection.filter((id) => {
      const node = findNode(state.file.document, id);
      return !!node && node.type !== 'DOCUMENT' && node.type !== 'CANVAS' && !node.locked;
    });
    if (ids.length === 0) return false;
    get().apply('Use image as fill', (file) => withImageFill(file, ids, dataUrl, 'FILL', size));
    return true;
  },

  setImageScaleMode: (mode) => {
    const ids = get().selection;
    if (ids.length === 0) return;
    get().apply('Set image scale mode', (file) => setImageScaleModeOp(file, ids, mode));
  },

  setImageCrop: (crop) => {
    const ids = get().selection;
    if (ids.length === 0) return;
    get().apply('Crop image', (file) => setImageCropOp(file, ids, crop));
  },

  replaceSelectedImage: (dataUrl, size) => {
    const state = get();
    const ids = state.selection.filter((id) => {
      const node = findNode(state.file.document, id);
      return !!node && imageDataUrlOf(node) !== null;
    });
    if (ids.length === 0) return;
    get().apply('Replace image', (file) => ids.reduce((next, id) => replaceImageBytesOp(next, id, dataUrl, size), file));
    get().pushToast('Image replaced');
  },

  replaceImageBytes: (id, dataUrl) => {
    get().apply('Replace image', (file) => {
      const node = findNode(file.document, id);
      if (!node || !imageDataUrlOf(node)) return file;
      return replaceImageBytesOp(file, id, dataUrl);
    });
  },

  addLayoutGrid: (pattern) => {
    const ids = get().selection;
    if (ids.length === 0) return;
    get().apply(`Add ${pattern.toLowerCase()} grid`, (file) =>
      editLayoutGrids(file, ids, (grids) => [...grids, defaultLayoutGrid(pattern)]),
    );
  },

  updateLayoutGrid: (index, patch) => {
    const ids = get().selection;
    if (ids.length === 0) return;
    get().apply('Change grid', (file) =>
      editLayoutGrids(file, ids, (grids) =>
        grids.map((grid, position) => (position === index ? { ...grid, ...patch } : grid)),
      ),
    );
  },

  removeLayoutGrid: (index) => {
    const ids = get().selection;
    if (ids.length === 0) return;
    get().apply('Remove grid', (file) =>
      editLayoutGrids(file, ids, (grids) => grids.filter((_, position) => position !== index)),
    );
  },

  addEffect: (kind) => {
    const ids = get().selection;
    if (ids.length === 0) return;
    get().apply(`Add ${kind.toLowerCase().replace('_', ' ')}`, (file) => addEffectToNodes(file, ids, kind));
  },

  updateEffect: (index, patch) => {
    const ids = get().selection;
    if (ids.length === 0) return;
    get().apply('Change effect', (file) => updateEffectAt(file, ids, index, patch));
  },

  removeEffect: (index) => {
    const ids = get().selection;
    if (ids.length === 0) return;
    get().apply('Remove effect', (file) => removeEffectAt(file, ids, index));
  },

  toggleEffect: (index) => {
    const ids = get().selection;
    if (ids.length === 0) return;
    get().apply('Toggle effect', (file) => toggleEffectAt(file, ids, index));
  },

  setAutoLayout: (patch) => {
    const state = get();
    if (state.selection.length === 0) return;
    const ids = state.selection;
    get().apply('Auto layout', (file) => setAutoLayoutOp(file, ids, patch));
  },

  clearAutoLayout: () => {
    const state = get();
    const ids = state.selection;
    get().apply('Remove auto layout', (file) => setAutoLayoutOp(file, ids, { layoutMode: 'NONE' }));
  },

  resetOverrides: (instanceId) => {
    get().apply('Reset instance', (file) => ({
      ...file,
      document: updateNode(file.document, instanceId, (node) =>
        node.type === 'INSTANCE' ? ({ ...node, overrides: {} } as Node) : node,
      ),
    }));
  },

  updateSelectedTextStyle: (patch, label = 'Change text style') => {
    const state = get();
    const ids = state.selection.filter((id) => findNode(state.file.document, id)?.type === 'TEXT');
    if (ids.length === 0) return;
    get().apply(label, (file) => {
      let document = file.document;
      for (const id of ids) {
        document = updateNode(document, id, (node) =>
          node.type === 'TEXT' ? ({ ...node, style: { ...node.style, ...patch } } as TextNode) : node,
        );
      }
      return settleDocument(syncTextSizesOp({ ...file, document }));
    });
  },

  nudgeSelection: (dx, dy) => {
    // Arrow keys and shift+arrow share one burst key, so holding an arrow key
    // (or tapping it quickly) is a single undo entry, not one per keypress.
    get().apply('Nudge', () => settleDocument(translateWorld(get().file, movableIds(get()), dx, dy)), {
      coalesceKey: 'nudge',
    });
  },

  moveSelection: (dx, dy, transient = false) => {
    const state = get();
    const ids = state.selection.filter((id) => {
      const node = findNode(state.file.document, id);
      return !!node && !node.locked;
    });
    if (ids.length === 0) return;
    const next = settleDocument(translateWorld(state.file, ids, dx, dy));
    if (next.document === state.file.document) return;
    if (transient) {
      set({ file: next });
      return;
    }
    get().apply('Move', () => next);
  },

  resizeSelection: (id, handle, dx, dy, options = {}) => {
    const { transient, ...resizeOptions } = options;
    const next = settleDocument(resizeFromHandle(get().file, id, handle, dx, dy, resizeOptions));
    if (next.document === get().file.document) return;
    if (transient) {
      set({ file: next });
      return;
    }
    get().apply('Resize', () => next);
  },

  rotateSelection: (id, degrees, transient = false) => {
    const next = settleDocument(setWorldRotation(get().file, id, degrees));
    if (next.document === get().file.document) return;
    if (transient) {
      set({ file: next });
      return;
    }
    get().apply('Rotate', () => next);
  },

  moveSelectionTo: (entries, transient = false) => {
    const state = get();
    const movable = entries.filter((entry) => {
      const node = findNode(state.file.document, entry.id);
      return !!node && !node.locked;
    });
    if (movable.length === 0) return;
    const next = settleDocument(positionNodes(state.file, movable));
    if (next.document === state.file.document) return;
    if (transient) {
      set({ file: next });
      return;
    }
    get().apply('Move', () => next);
  },

  syncTextSizes: () => {
    const state = get();
    const next = syncTextSizesOp(state.file);
    if (next.document !== state.file.document) set({ file: next });
  },

  createVector: (path, offset) => {
    const state = get();
    const parentId = activeContainer(state).id;
    const node = vectorNodeFromPath(state.file.document, path, offset);
    state.addNode(node, parentId);
  },

  setSelectedAnchor: (index) => set({ selectedAnchor: index }),

  deleteSelectedAnchor: () => {
    const state = get();
    const index = state.selectedAnchor;
    const id = state.selection[0];
    if (index === null || !id) return false;
    const node = findNode(state.file.document, id);
    const path = node ? vectorPathOf(node) : null;
    if (!path) return false;
    const next = removeAnchor(path, index);
    if (next === path) return false;
    state.setVectorPath(id, next);
    set({ selectedAnchor: null });
    return true;
  },

  setVectorPath: (id, path, transient = false) => {
    const next = writeVectorPath(get().file, id, path, !transient);
    if (next.document === get().file.document) return;
    if (transient) {
      set({ file: next });
      return;
    }
    get().apply('Edit vector', () => next);
  },

  addVariableCollection: () => {
    const result = createCollectionOp(get().file, '');
    get().apply('Add variable collection', () => result.file);
  },

  addVariable: (collectionId, type) => {
    const result = addVariableOp(get().file, collectionId, type);
    if (!result.variableId) return;
    get().apply(`Add ${type.toLowerCase()} variable`, () => result.file);
  },

  setVariableValue: (variableId, value) => {
    const state = get();
    const definition = (state.file.variables ?? {})[variableId];
    if (!definition) return;
    const collection = collectionsOf(state.file)[definition.variableCollectionId];
    if (!collection) return;
    const mode = state.file.activeModes?.[collection.id] ?? collection.defaultModeId;
    get().apply('Set variable value', (file) => setVariableValueOp(file, variableId, mode, value));
  },

  renameVariable: (variableId, name) => {
    get().apply('Rename variable', (file) => renameVariableOp(file, variableId, name));
  },

  deleteVariable: (variableId) => {
    get().apply('Delete variable', (file) => deleteVariableOp(file, variableId));
  },

  addMode: (collectionId) => {
    get().apply('Add mode', (file) => addModeOp(file, collectionId));
  },

  setActiveMode: (collectionId, modeId) => {
    // A mode switch is a view-level change: no history entry, but it repaints.
    set({ file: setActiveModeOp(get().file, collectionId, modeId) });
  },

  bindVariable: (property, variableId) => {
    const state = get();
    const ids = state.selection;
    if (ids.length === 0) return;
    get().apply(variableId ? 'Bind variable' : 'Unbind variable', (file) => {
      let next = file;
      for (const id of ids) next = bindVariableOp(next, id, property, variableId);
      return next;
    });
  },

  createStyle: (type) => {
    const state = get();
    const id = state.selection[0];
    if (!id) return;
    const result = createStyleFromNode(state.file, id, type);
    if (!result.styleId) {
      get().pushToast(`Select a layer with a ${type.toLowerCase()} to create that style`);
      return;
    }
    const definition = stylesOf(result.file)[result.styleId];
    get().apply(`Create ${definition ? definition.name : 'style'}`, () => result.file);
    get().pushToast(`Created ${definition ? definition.name : 'style'}`, 'success');
  },

  applyStyle: (styleId) => {
    const ids = get().selection;
    if (ids.length === 0) return;
    const definition = stylesOf(get().file)[styleId];
    get().apply(`Apply ${definition ? definition.name : 'style'}`, (file) => applyStyleOp(file, styleId, ids));
  },

  detachStyle: () => {
    const ids = get().selection;
    if (ids.length === 0) return;
    get().apply('Detach style', (file) => detachStyle(file, ids));
  },

  renameStyle: (styleId, name) => {
    get().apply('Rename style', (file) => renameStyleOp(file, styleId, name));
  },

  deleteStyle: (styleId) => {
    get().apply('Delete style', (file) => deleteStyleOp(file, styleId));
  },

  updateStyleFromSelection: (styleId) => {
    const id = get().selection[0];
    if (!id) return;
    get().apply('Update style', (file) => updateStylePayload(file, styleId, id));
  },

  createComponentSet: () => {
    const state = get();
    const components = state.selection.filter((id) => {
      const node = findNode(state.file.document, id);
      return !!node && node.type === 'COMPONENT';
    });
    if (components.length < 2) {
      get().pushToast('Select two or more components to make a component set');
      return;
    }
    const result = createComponentSetOp(state.file, components);
    if (!result.setId) {
      get().pushToast('Could not build a component set from that selection');
      return;
    }
    get().apply('Create component set', () => result.file);
    set({ selection: [result.setId] });
  },

  swapInstanceState: (instanceId, componentId) => {
    get().apply('Swap variant state', (file) => swapInstanceComponent(file, instanceId, componentId));
  },

  setInstanceVariant: (instanceId, property, value) => {
    const next = setInstanceVariantOp(get().file, instanceId, property, value);
    if (next === get().file) return;
    get().apply(`Set ${property}`, () => next);
  },

  setSlotContent: (instanceId, slotNodeId, contentIds) => {
    const state = get();
    const instance = findNode(state.file.document, instanceId);
    if (!instance || instance.type !== 'INSTANCE') return;
    const content = (contentIds ?? [])
      .map((id) => findNode(state.file.document, id))
      .filter((node): node is SceneNode => !!node && node.type !== 'DOCUMENT' && node.type !== 'CANVAS')
      // The instance itself, or anything inside it, cannot become its own slot
      // content: cloning it there would nest the instance inside itself.
      .filter((node) => node.id !== instanceId && instanceAncestryOf(state.file.document, node.id)?.instance.id !== instanceId)
      .map((node) => cloneSubtree(node).node);
    get().apply(content.length > 0 ? 'Set slot content' : 'Reset slot content', (file) => {
      const document = updateNode(file.document, instanceId, (node) => {
        if (node.type !== 'INSTANCE') return node;
        const overrides = { ...(node.overrides ?? {}) };
        const existing = overrides[slotNodeId] ?? {};
        if (content.length > 0) {
          overrides[slotNodeId] = { ...existing, children: content };
        } else {
          const { children: _dropped, ...rest } = existing as { children?: SceneNode[] };
          if (Object.keys(rest).length > 0) overrides[slotNodeId] = rest;
          else delete overrides[slotNodeId];
        }
        return { ...node, overrides } as SceneNode;
      });
      return { ...file, document: syncInstances(document) };
    });
  },

  setInstanceProperty: (instanceId, name, value) => {
    const next = setInstancePropertyOp(get().file, instanceId, name, value);
    if (next === get().file) return;
    get().apply(`Set ${name}`, () => next);
  },

  addComponentProperty: (componentId, type, name, defaultValue) => {
    const next = addComponentPropertyOp(get().file, componentId, type, name, defaultValue);
    if (next === get().file) return;
    get().apply(`Add ${type.toLowerCase()} property`, () => next);
  },

  booleanOp: (mode) => {
    const state = get();
    if (state.selection.length < 2) {
      get().pushToast('Select two or more shapes to combine');
      return;
    }
    const { usable, skipped } = booleanOperandsOf(state.file, state.selection);
    if (usable.length < 2) {
      get().pushToast('Boolean operations need two shapes with an outline (text and lines cannot be combined)');
      return;
    }
    const result = booleanNodes(state.file, usable, mode);
    if (!result.nodeId) {
      get().pushToast(`${booleanLabel(mode)} could not be applied`);
      return;
    }
    get().apply(booleanLabel(mode), () => result.file);
    set({ selection: [result.nodeId] });
    if (result.empty) {
      get().pushToast(`${booleanLabel(mode)} produced an empty result (the shapes do not overlap)`);
    } else if (skipped.length > 0) {
      get().pushToast(`${booleanLabel(mode)}: ${skipped.length} layer(s) skipped (no outline)`);
    }
  },

  setBooleanMode: (mode) => {
    const state = get();
    const target = state.selection.length === 1 ? findNode(state.file.document, state.selection[0]!) : null;
    if (!target || target.type !== 'BOOLEAN_OPERATION') return;
    get().apply(booleanLabel(mode), (file) => setBooleanModeOp(file, target.id, mode));
  },

  flip: (axis) => {
    const ids = get().selection;
    if (ids.length === 0) return;
    get().apply(axis === 'horizontal' ? 'Flip horizontal' : 'Flip vertical', (file) => flipNodes(file, ids, axis));
  },

  reorder: (mode) => {
    const state = get();
    if (state.selection.length === 0) return;
    const labels: Record<ReorderMode, string> = {
      front: 'Bring to front',
      forward: 'Bring forward',
      backward: 'Send backward',
      back: 'Send to back',
    };
    const ids = state.selection;
    get().apply(labels[mode], (file) => reorderNodes(file, ids, mode));
  },

  align: (mode) => {
    const state = get();
    if (state.selection.length === 0) return;
    const ids = state.selection;
    get().apply(`Align ${mode}`, (file) => alignNodes(file, ids, mode));
  },

  distribute: (axis) => {
    const state = get();
    if (state.selection.length < 3) return;
    const ids = state.selection;
    get().apply(`Distribute ${axis}`, (file) => distributeNodes(file, ids, axis));
  },

  toggleVisible: (id) => {
    const node = findNode(get().file.document, id);
    if (!node) return;
    get().apply(node.visible ? 'Hide' : 'Show', (file) => applyNodePatchToAll(file, [id], { visible: !node.visible }));
  },

  toggleLock: (id) => {
    const state = get();
    const node = findNode(state.file.document, id);
    if (!node) return;
    const locked = !node.locked;
    get().apply(locked ? 'Lock' : 'Unlock', (file) => applyNodePatchToAll(file, [id], { locked }));
    if (locked) set({ selection: state.selection.filter((selected) => selected !== id) });
  },

  renameNode: (id, name) => {
    const node = findNode(get().file.document, id);
    if (!node || node.name === name || name.trim() === '') return;
    get().apply('Rename', (file) => applyNodePatchToAll(file, [id], { name }));
  },

  groupSelection: () => {
    const state = get();
    if (state.selection.length < 2) return;
    const result = groupNodes(state.file, state.selection);
    if (!result.groupId) return;
    get().apply('Group', () => result.file);
    set({ selection: [result.groupId] });
  },

  ungroupSelection: () => {
    const state = get();
    const groupIds = state.selection.filter((id) => {
      const node = findNode(state.file.document, id);
      return !!node && hasChildren(node) && node.type !== 'CANVAS' && node.type !== 'DOCUMENT';
    });
    if (groupIds.length === 0) return;
    const result = ungroupNodes(state.file, groupIds);
    get().apply('Ungroup', () => result.file);
    set({ selection: result.newIds.filter((id) => !!findNode(result.file.document, id)) });
  },

  frameSelection: () => {
    const state = get();
    if (state.selection.length === 0) return;
    const result = frameSelectionOp(state.file, state.selection);
    if (!result.frameId) return;
    get().apply('Frame selection', () => result.file);
    set({ selection: [result.frameId] });
  },

  setEditingText: (id) => set({ editingTextId: id }),

  setCharacters: (id, characters, transient = false) => {
    const patched = applyNodePatchToAll(get().file, [id], { characters });
    if (patched.document === get().file.document) return;
    const next = settleDocument(syncTextSizesOp(patched));
    if (transient) {
      set({ file: next });
      return;
    }
    get().apply('Edit text', () => next);
  },

  createComponentFromSelection: () => {
    const state = get();
    const node = selectedNodes(state)[0];
    if (!node || hasChildren(node)) {
      get().pushToast('Select a single shape to create a component');
      return;
    }
    const componentId = nextNodeId();
    const result = get().apply('Create component', (file) => {
      const parent = parentAndIndex(file.document, node.id);
      if (!parent) return file;
      // The component adopts the node's box; the node becomes its only child.
      const component: ComponentNode = {
        id: componentId,
        name: node.name,
        type: 'COMPONENT',
        visible: node.visible,
        locked: false,
        opacity: node.opacity,
        transform: { ...node.transform },
        width: node.width,
        height: node.height,
        fills: [...node.fills],
        strokes: [...node.strokes],
        strokeWeight: node.strokeWeight,
        children: [],
        clipsContent: true,
      };
      const inner: SceneNode = {
        ...node,
        transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      } as SceneNode;
      const without = removeNode(file.document, node.id).root;
      return { ...file, document: insertChild(without, parent.parent.id, { ...component, children: [inner] }, parent.index) };
    });
    void result;
    if (!findNode(get().file.document, componentId)) return;
    set({ selection: [componentId] });
  },

  insertInstance: (componentId) => {
    const state = get();
    const component = findNode(state.file.document, componentId);
    if (!component || !isComponentNode(component)) return;
    const parent = activeContainer(state);
    const instanceId = nextNodeId();
    const offset = 48 * (countInstances(state.file.document, componentId) + 1);
    // A component that is published links its instances to that library, so
    // editing and republishing the master makes them report as out of date and
    // updatable, exactly like an instance inserted from the Assets panel.
    const link = libraryLinkForComponent(state.libraries, componentId);
    get().apply('Insert instance', (file) => {
      const source = findNode(file.document, componentId);
      if (!source || !isComponentNode(source)) return file;
      const instance: SceneNode = {
        ...source,
        id: instanceId,
        type: 'INSTANCE',
        componentId,
        ...(link ? { libraryId: link.libraryId, libraryKey: link.libraryKey, libraryVersion: link.libraryVersion } : {}),
        transform: { a: 1, b: 0, c: 0, d: 1, tx: source.transform.tx + offset, ty: source.transform.ty + offset },
        children: (source.children as SceneNode[]).map((child) => cloneSubtree(child).node),
        componentSnapshot: structuredClone(source),
      } as SceneNode;
      return { ...file, document: insertChild(file.document, parent.id, instance) };
    });
    set({ selection: [instanceId] });
  },

  detachInstance: (id) => {
    const node = findNode(get().file.document, id);
    if (!node || node.type !== 'INSTANCE') return;
    get().apply('Detach instance', (file) => {
      const instance = findNode(file.document, id);
      if (!instance || instance.type !== 'INSTANCE') return file;
      const { componentId: _componentId, overrides: _overrides, componentSnapshot: _snapshot, ...rest } = instance;
      return { ...file, document: updateNode(file.document, id, () => ({ ...rest, type: 'FRAME' }) as SceneNode) };
    });
  },

  setInteraction: (nodeId, interaction) => {
    const node = findNode(get().file.document, nodeId);
    if (!node) return;
    get().apply(interaction ? 'Add prototype link' : 'Remove prototype link', (file) => ({
      ...file,
      document: updateNode(file.document, nodeId, (target) => {
        const existing = target.interactions ?? [];
        const interactions = interaction
          ? [...existing.filter((entry) => entry.trigger.type !== interaction.trigger.type), interaction]
          : [];
        return { ...target, interactions } as Node;
      }),
    }));
  },

  publishLibrary: (name) => {
    const state = get();
    const result = publishLibraryOp(state.file, {
      libraryId: state.file.publishedLibrary?.id ?? null,
      name: name?.trim() || state.file.publishedLibrary?.name || state.file.name,
      version: state.file.publishedLibrary ? state.file.publishedLibrary.version + 1 : 1,
    });
    // The publication record lives on the file, so it participates in undo.
    get().apply('Publish library', () => result.file);
    set({ libraries: upsertLibrary(state.libraries, result.library) });
    const counts = result.library.components.length;
    get().pushToast(
      `Published “${result.library.name}” v${result.library.version} · ${counts} component${counts === 1 ? '' : 's'}`,
    );
  },

  deleteLibrary: (libraryId) => {
    const library = get().libraries.find((entry) => entry.id === libraryId);
    set({ libraries: get().libraries.filter((entry) => entry.id !== libraryId) });
    if (library) get().pushToast(`Removed library “${library.name}”`);
  },

  insertFromLibrary: (libraryId, componentKey) => {
    const state = get();
    const library = state.libraries.find((entry) => entry.id === libraryId);
    if (!library) {
      get().pushToast('That library is no longer available');
      return;
    }
    const { width: canvasWidth, height: canvasHeight } = state.canvasSize;
    const x = (canvasWidth / 2 - state.viewport.x) / state.viewport.zoom;
    const y = (canvasHeight / 2 - state.viewport.y) / state.viewport.zoom;
    const result = instantiateFromLibrary(state.file, library, componentKey, { parentId: activeContainer(state).id, x, y });
    if (!result.instanceId) {
      get().pushToast('Could not insert that component');
      return;
    }
    get().apply('Insert library component', () => result.file);
    set({ selection: [result.instanceId] });
  },

  updateLibraryInstances: (libraryId, instanceId) => {
    const state = get();
    const library = state.libraries.find((entry) => entry.id === libraryId);
    if (!library) return;
    const result = updateInstancesFromLibrary(state.file, library, instanceId ? { instanceId } : {});
    if (result.updated === 0) {
      get().pushToast('No instances of that library to update');
      return;
    }
    get().apply('Update library instances', () => result.file);
    get().pushToast(`Updated ${result.updated} instance${result.updated === 1 ? '' : 's'} from “${library.name}”`);
  },

  importLibraryStyle: (libraryId, styleKey) => {
    const state = get();
    const library = state.libraries.find((entry) => entry.id === libraryId);
    if (!library) return;
    const result = importLibraryStyleOp(state.file, library, styleKey);
    if (!result.styleId) {
      get().pushToast('Could not import that style');
      return;
    }
    get().apply('Import style', () => result.file);
    get().pushToast('Style added to this file');
  },

  importLibraryVariables: (libraryId) => {
    const state = get();
    const library = state.libraries.find((entry) => entry.id === libraryId);
    if (!library) return;
    const result = importLibraryVariablesOp(state.file, library);
    if (result.imported === 0) {
      get().pushToast('Those variables are already in this file');
      return;
    }
    get().apply('Import variables', () => result.file);
    get().pushToast(`Imported ${result.imported} variable${result.imported === 1 ? '' : 's'}`);
  },

  setLibraries: (libraries) => set({ libraries }),

  setFileHandle: (handle) => set({ fileHandle: handle }),

  setRoomState: (room) => set({ room }),

  joinRoom: (options) => {
    const base = options.base?.trim() || defaultRelayBase(window.location);
    const rawKey = options.key?.trim() ?? '';
    // A malformed key is an error, never a silent plaintext join.
    if (rawKey !== '' && parseKeyText(rawKey) === null) {
      set({ room: { ...EMPTY_ROOM, phase: 'error', roomId: options.roomId, base, error: 'That key is not a valid room key' } });
      get().pushToast('That room key is not valid — paste the whole share link, or clear it');
      return;
    }
    // One socket at a time: a new join replaces the previous room.
    leaveRoomClient();
    set({ followingId: null });
    resetRoomSync(get().file);
    roomClientId = nextNodeId();
    roomClient = createRoomClient({
      onState: (room) => {
        const wasOnline = get().room.phase === 'online';
        set({ room });
        // Publish the document once the room is up, so a latecomer can catch up.
        // In an E2E room the client encrypts it before it leaves the browser.
        if (!wasOnline && room.phase === 'online' && roomClient) {
          void roomClient.sendSnapshot(get().file, lastRoomSeq);
        }
      },
      onOps: (batch) => {
        // Remote edits merge into the open document without becoming local undo
        // entries: undo reverses your own edits, not someone else's.
        lastRoomSeq = Math.max(lastRoomSeq, batch.seq);
        const applied = applyRemoteOps(get().file, { seq: batch.seq, clientId: batch.clientId, ops: batch.ops as EditOp[] }, convergence);
        convergence = applied.state;
        if (applied.file === get().file) return;
        lastSyncedFile = applied.file;
        markRoomTouched();
        set({ file: applied.file });
      },
      onSnapshot: (snapshot) => {
        lastRoomSeq = Math.max(lastRoomSeq, snapshot.seq);
        // A tab that has not changed anything since joining adopts the room's
        // document when it is a *different* document (unrelated node ids). Ops
        // are matched by id, so without this a peer's edits could never apply.
        // Only the snapshot offered on joining counts: a peer's later publish is
        // the room's own document and must not flip everyone's ids.
        const offered = snapshot.clientId === null && lastSyncedFile === get().file;
        const adopted = adoptRoomDocument(get().file, snapshot.file, offered);
        if (adopted) {
          convergence = EMPTY_CONVERGENCE;
          lastSyncedFile = adopted;
          markRoomTouched();
          set({
            file: adopted,
            pageId: firstPageId(adopted),
            selection: [],
            editingTextId: null,
            enteredContainerId: null,
            past: [],
            future: [],
            transaction: null,
          });
          return;
        }
        const applied = mergeSnapshot(
          get().file,
          { file: snapshot.file, seq: snapshot.seq, ...(snapshot.clientId ? { clientId: snapshot.clientId } : {}) },
          convergence,
        );
        convergence = applied.state;
        lastSyncedFile = applied.file;
        if (applied.file !== get().file) markRoomTouched();
        set({ file: applied.file });
      },
      onCursor: (clientId, cursor) => {
        const following = get().followingId;
        if (!following || following !== clientId) return;
        // Follow mirrors the peer's viewport when they share one, and otherwise
        // keeps their pointer centred at the viewer's zoom.
        const peer = get().room.peers.find((entry) => entry.clientId === clientId);
        if (peer?.viewport) {
          set({ viewport: clampViewport(peer.viewport) });
          return;
        }
        set({ viewport: followCursorViewport(cursor, get().canvasSize, get().viewport) });
      },
      onViewport: (clientId, viewport) => {
        // The reducer already stored it; follow mode mirrors it directly.
        if (get().followingId !== clientId) return;
        set({ viewport: clampViewport(viewport) });
      },
    });
    roomClient.connect({
      base,
      roomId: options.roomId,
      ...(options.token ? { token: options.token } : {}),
      nickname: options.nickname,
      clientId: roomClientId,
      // The key comes from the share link's fragment; plaintext is only ever
      // joined when the user opts in, never as a silent fallback.
      ...(rawKey !== '' ? { key: rawKey } : {}),
      // A key always means an encrypted join; plaintext needs an explicit opt-in
      // *and* no key.
      allowPlaintext: rawKey === '' && options.allowPlaintext === true,
    });
  },

  leaveRoom: () => {
    // Flush before forgetting the room: changes that only arrived from it are
    // still this document's work.
    void persistNow();
    clearRoomTouched();
    leaveRoomClient();
    resetRoomSync(get().file);
    set({ room: EMPTY_ROOM, followingId: null });
  },

  followPeer: (clientId) => {
    const state = get();
    if (clientId === null) {
      set({ followingId: null });
      return;
    }
    const peer = state.room.peers.find((entry) => entry.clientId === clientId);
    if (!peer) return;
    set({ followingId: clientId });
    // Jump to them immediately: their viewport when shared, else their pointer.
    if (peer.viewport) {
      set({ viewport: clampViewport(peer.viewport) });
      return;
    }
    if (peer.cursor) set({ viewport: followCursorViewport(peer.cursor, state.canvasSize, state.viewport) });
  },

  openFromDisk: async () => {
    const state = get();
    if (!state.fileAccessSupported) {
      // No picker: fall back to the upload input the importer already uses.
      window.dispatchEvent(new CustomEvent('pigma:import-json'));
      return;
    }
    try {
      const opened = await openFileFromDisk();
      if (!opened) return;
      const id = await createDocument(opened.file.name, opened.file);
      set({ fileHandle: opened.handle, activeDocumentId: id });
      get().pushToast(`Opened “${opened.file.name}” · autosaving to ${opened.handle.name}`, 'success');
    } catch (error) {
      get().pushToast(`Could not open that file: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  saveToDisk: async (options) => {
    const state = get();
    const as = options?.as ?? false;
    if (state.fileHandle && !as) {
      try {
        await writeToHandle(state.fileHandle, state.file);
        get().pushToast(`Saved to ${state.fileHandle.name}`, 'success');
      } catch (error) {
        get().pushToast(`Could not save: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (!state.fileAccessSupported) {
      window.dispatchEvent(new CustomEvent('pigma:export-json'));
      return;
    }
    try {
      const handle = await saveFileToDisk(state.file, globalThis, state.file.name);
      if (!handle) return;
      set({ fileHandle: handle });
      get().pushToast(`Saved to ${handle.name} · autosaving from now on`, 'success');
    } catch (error) {
      get().pushToast(`Could not save: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  shareViewport: () => {
    if (!roomClient || !roomClient.connected) return;
    const now = Date.now();
    if (now - lastRoomViewportAt < ROOM_VIEWPORT_INTERVAL_MS) return;
    lastRoomViewportAt = now;
    roomClient.sendViewport(get().viewport);
  },

  setLocalCursor: (cursor) => {
    const current = get().localCursor;
    if (current === cursor) return;
    if (current && cursor && current.x === cursor.x && current.y === cursor.y) return;
    set({ localCursor: cursor });
    // Share it with the room, throttled: pointer moves are frequent.
    const now = Date.now();
    if (now - lastRoomCursorAt >= ROOM_CURSOR_INTERVAL_MS) {
      lastRoomCursorAt = now;
      roomClient?.sendCursor(cursor);
    }
  },

  setPresence: (peers) => set({ presence: peers }),

  setRedlines: (on) => set({ showRedlines: on }),

  appendPluginConsole: (entry) => {
    const line: PluginConsoleEntry = { ...entry, id: nextNodeId(), at: Date.now() };
    // Keep the transcript bounded: a chatty plugin must not grow it forever.
    set({ pluginConsole: [...get().pluginConsole, line].slice(-PLUGIN_CONSOLE_LIMIT) });
  },

  clearPluginConsole: () => set({ pluginConsole: [] }),

  savePlugin: (input) => {
    const state = get();
    const existing = input.id ? state.plugins.find((plugin) => plugin.id === input.id) : undefined;
    if (existing?.builtin) {
      // Editing a built-in forks it, so the shipped source stays intact.
      const fork = newPlugin(`${existing.name} (edited)`, input.source);
      set({ plugins: upsertPlugin(state.plugins, fork) });
      return fork.id;
    }
    if (existing) {
      const next: PluginRecord = { ...existing, name: normalizePluginName(input.name, existing.name), source: input.source };
      set({ plugins: upsertPlugin(state.plugins, next) });
      return next.id;
    }
    const created = newPlugin(input.name, input.source);
    set({ plugins: upsertPlugin(state.plugins, created) });
    return created.id;
  },

  deletePlugin: (id) => {
    const plugin = get().plugins.find((entry) => entry.id === id);
    if (!plugin || plugin.builtin) return;
    set({ plugins: get().plugins.filter((entry) => entry.id !== id) });
    get().pushToast(`Removed “${plugin.name}”`);
  },

  runPlugin: async (id) => {
    const state = get();
    const plugin = state.plugins.find((entry) => entry.id === id);
    if (!plugin) return;
    if (!isRunnable(plugin)) {
      get().appendPluginConsole({ kind: 'error', text: `${plugin.name}: the plugin has no source to run` });
      return;
    }
    if (state.pluginRunning) return;
    set({ pluginRunning: id });
    get().appendPluginConsole({ kind: 'info', text: `▶ ${plugin.name}` });
    const startedAt = Date.now();
    try {
      const result = await getPluginEngine().run(plugin.source, state.file, {
        timeoutMs: 4000,
        memoryLimitMb: 48,
      });
      // The SAME invariant check the MCP write path runs, before the store sees
      // anything: a script cannot commit opacity 42 or a negative size in-app
      // either. Validating first means a refusal leaves the document AND the
      // undo history untouched, and it surfaces the way every other plugin
      // failure does — a console line and a toast — rather than throwing at a
      // user who is looking at a panel.
      const problems = documentProblems(result.file);
      if (problems.length > 0) {
        const shown = problems.slice(0, 3).join('; ');
        const more = problems.length > 3 ? ` (+${problems.length - 3} more)` : '';
        throw new Error(`the document it produced is invalid: ${shown}${more}`);
      }
      // Everything the script changed lands as ONE undo entry.
      get().apply(`Run plugin: ${plugin.name}`, () => result.file);
      for (const line of result.logs) get().appendPluginConsole({ kind: 'log', text: line });
      for (const warning of result.warnings) get().appendPluginConsole({ kind: 'warning', text: warning });
      if (result.output !== null && result.output !== undefined && result.output !== '') {
        get().appendPluginConsole({ kind: 'log', text: `↩ ${formatPluginOutput(result.output)}` });
      }
      get().appendPluginConsole({
        kind: 'success',
        text: `✔ ${plugin.name} finished in ${Date.now() - startedAt} ms${result.closed ? ' (closed the plugin)' : ''}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      get().appendPluginConsole({ kind: 'error', text: `✖ ${plugin.name}: ${message}` });
      get().pushToast(`Plugin failed: ${message}`);
    } finally {
      set({ pluginRunning: null });
    }
  },

  setPngOptions: (patch) => {
    const current = get().pngOptions;
    const next = { ...current, ...patch };
    // Scales are whole numbers from 1x to 4x; anything else is ignored.
    if (patch.scale !== undefined) next.scale = Math.min(4, Math.max(1, Math.round(patch.scale)));
    if (
      next.open === current.open &&
      next.scale === current.scale &&
      next.transparent === current.transparent &&
      next.scope === current.scope
    ) {
      return;
    }
    set({ pngOptions: next });
  },

  setMobileDrawer: (drawer) => {
    set({ mobileDrawer: get().mobileDrawer === drawer ? null : drawer });
  },

  loadMcpEnvironment: async () => {
    // Asked once at boot: the desktop shell's report and the server's
    // advertisement. Neither is required, and neither blocks the editor.
    const environment = await readMcpEnvironment();
    set({ mcpEnvironment: environment });
  },

  setPanelWidth: (side, width) => {
    const clamped = Math.round(Math.min(panelWidthLimit(), Math.max(PANEL_WIDTH_MIN, width)));
    if (get().panelWidths[side] === clamped) return;
    set({ panelWidths: { ...get().panelWidths, [side]: clamped } });
  },

  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
  },

  toggleTheme: () => {
    const next: ThemeName = get().theme === 'dark' ? 'light' : 'dark';
    set({ theme: next });
    applyTheme(next);
  },

  addComment: (x, y, text, nodeId) => {
    const state = get();
    const result = addCommentOp(state.file, { pageId: state.pageId, x, y, text, nodeId });
    if (!result.commentId) return;
    get().apply('Add comment', () => result.file);
    // Show the new thread straight away.
    set({ activeCommentId: result.commentId, tool: 'select', leftTab: 'comments' });
  },

  replyToComment: (commentId, text) => {
    const next = addReplyOp(get().file, commentId, text);
    if (next === get().file) return;
    get().apply('Reply to comment', () => next);
  },

  setCommentResolved: (commentId, resolved) => {
    get().apply(resolved ? 'Resolve comment' : 'Reopen comment', (file) => setCommentResolvedOp(file, commentId, resolved));
  },

  deleteComment: (commentId) => {
    get().apply('Delete comment', (file) => deleteCommentOp(file, commentId));
    if (get().activeCommentId === commentId) set({ activeCommentId: null });
  },

  moveComment: (commentId, x, y) => {
    get().apply('Move comment', (file) => moveCommentOp(file, commentId, x, y));
  },

  setActiveComment: (commentId) => set({ activeCommentId: commentId }),

  saveVersion: (name) => {
    const state = get();
    const result = saveVersionOp(state.file, name);
    // Saving a version is a file-level change: it must persist and be undoable.
    get().apply('Save version', () => result.file);
    set({ editsSinceVersion: 0 });
    const saved = versionsOf(result.file).find((entry) => entry.id === result.versionId);
    get().pushToast(`Saved ${saved ? saved.name : 'version'}`, 'success');
  },

  renameVersion: (versionId, name) => {
    get().apply('Rename version', (file) => renameVersionOp(file, versionId, name));
  },

  deleteVersion: (versionId) => {
    get().apply('Delete version', (file) => deleteVersionOp(file, versionId));
    if (get().previewVersionId === versionId) set({ previewVersionId: null, previewFile: null });
  },

  previewVersion: (versionId) => {
    closeBurst();
    const state = get();
    if (!versionId) {
      set({ previewVersionId: null, previewFile: null, compareVersionId: null, compareDiff: null });
      return;
    }
    const content = versionContent(state.file, versionId);
    if (!content) return;
    // Preview and compare share one read-only path: the canvas renders the
    // version's content, and the diff is computed once here for the highlights.
    set({
      previewVersionId: versionId,
      previewFile: content,
      selection: [],
      editingTextId: null,
      compareVersionId: null,
      compareDiff: null,
    });
  },

  compareVersion: (versionId) => {
    closeBurst();
    const state = get();
    if (!versionId) {
      // Leaving compare restores the live document's view; nothing was mutated.
      set({ compareVersionId: null, compareDiff: null, previewVersionId: null, previewFile: null });
      return;
    }
    const content = versionContent(state.file, versionId);
    if (!content) return;
    // Read-only: this sets view state only, so it never adds a history entry.
    set({
      compareVersionId: versionId,
      previewVersionId: versionId,
      previewFile: content,
      compareDiff: diffDocuments(content, state.file),
      selection: [],
      editingTextId: null,
    });
  },

  restoreVersion: (versionId) => {
    closeBurst();
    const state = get();
    const content = versionContent(state.file, versionId);
    if (!content) return;
    const entry = versionsOf(state.file).find((candidate) => candidate.id === versionId);
    // Diff-free restore: the whole content is replaced and recorded as one entry,
    // so undo brings the previous state straight back.
    get().apply(`Restore ${entry ? entry.name : 'version'}`, () => content);
    set({
      previewVersionId: null,
      compareVersionId: null,
      compareDiff: null,
      previewFile: null,
      selection: [],
      pageId: content.document.children[0]!.id,
      editsSinceVersion: 0,
    });
    get().pushToast(`Restored ${entry ? entry.name : 'version'}`, 'success');
  },

  addInteraction: (nodeId, destinationId, kind, transition) => {
    get().apply('Add interaction', (file) =>
      addInteractionOp(file, nodeId, defaultInteraction(destinationId, kind, transition)),
    );
  },

  updateInteraction: (nodeId, index, patch) => {
    get().apply('Change interaction', (file) => updateInteractionOp(file, nodeId, index, patch));
  },

  removeInteraction: (nodeId, index) => {
    get().apply('Remove interaction', (file) => removeInteractionOp(file, nodeId, index));
  },

  addFlow: (startNodeId, name) => {
    const pageId = get().pageId;
    const result = addFlowOp(get().file, pageId, startNodeId, name);
    if (!result.flowId) {
      get().pushToast('Flows start at a frame or component');
      return;
    }
    get().apply('Add flow', () => result.file);
  },

  renameFlow: (flowId, name) => {
    const pageId = get().pageId;
    get().apply('Rename flow', (file) => renameFlowOp(file, pageId, flowId, name));
  },

  removeFlow: (flowId) => {
    const pageId = get().pageId;
    get().apply('Remove flow', (file) => removeFlowOp(file, pageId, flowId));
  },

  openOverlay: (nodeId, action) => {
    const state = get();
    const entry: OverlayEntry = {
      nodeId,
      position: action?.overlayPosition ?? 'CENTER',
      x: action?.overlayX ?? 0,
      y: action?.overlayY ?? 0,
      dim: action ? overlayDims(action) : true,
    };
    set({ presentationOverlays: [...state.presentationOverlays, entry] });
  },

  closeOverlay: () => {
    const state = get();
    if (state.presentationOverlays.length === 0) {
      set({ presentation: false, presentationFrameId: null, presentationStack: [] });
      return;
    }
    set({ presentationOverlays: state.presentationOverlays.slice(0, -1) });
  },

  setPrototypeStart: (nodeId) => {
    const pageId = get().pageId;
    get().apply('Set prototype start', (file) => ({
      ...file,
      document: {
        ...file.document,
        children: file.document.children.map((page) =>
          page.id === pageId ? { ...page, prototypeStartNodeId: nodeId } : page,
        ),
      },
    }));
  },

  setPage: (pageId) => {
    if (!get().file.document.children.some((page) => page.id === pageId)) return;
    set({ pageId, selection: [], enteredContainerId: null, editingTextId: null });
  },

  addPage: () => {
    const page = createCanvasNode(`Page ${get().file.document.children.length + 1}`);
    get().apply('Add page', (file) => ({
      ...file,
      document: { ...file.document, children: [...file.document.children, page] },
    }));
    set({ pageId: page.id, selection: [] });
  },

  renamePage: (pageId, name) => {
    if (name.trim() === '') return;
    get().apply('Rename page', (file) => ({
      ...file,
      document: {
        ...file.document,
        children: file.document.children.map((page) => (page.id === pageId ? { ...page, name } : page)),
      },
    }));
  },

  deletePage: (pageId) => {
    if (get().file.document.children.length <= 1) {
      get().pushToast('A file needs at least one page');
      return;
    }
    get().apply('Delete page', (file) => ({
      ...file,
      document: { ...file.document, children: file.document.children.filter((page) => page.id !== pageId) },
    }));
    if (get().pageId === pageId) set({ pageId: firstPageId(get().file), selection: [] });
  },

  newFile: () => {
    closeBurst();
    loadDocument(emptyFile('Untitled'), set, get);
  },

  loadStarterDocument: () => {
    closeBurst();
    loadDocument(defaultDocument(), set, get);
  },

  setShareLinkOpen: (open) => set({ shareLinkOpen: open }),

  keepLinkedDocument: () => {
    // The user's explicit choice to keep a linked document: it becomes theirs,
    // so the next save writes it to the library like any other document.
    if (!get().linkedSource) return;
    set({ linkedDirty: true });
    markDirty();
    get().pushToast('Kept in your library — this document is yours now', 'success');
  },

  loadLinkedDocument: (file, source) => {
    const state = get();
    const settled = settleDocument(file);
    // A clean load: the document is on screen, but it is not the user's local
    // document yet. Undo can still put their own document back, and nothing is
    // written to the library (or the crash marker) until they edit or save.
    set({
      file: settled,
      pageId: firstPageId(settled),
      selection: [],
      past: [...state.past, snapshot(state, 'Open from link')].slice(-HISTORY_LIMIT),
      future: [],
      transaction: null,
      enteredContainerId: null,
      editingTextId: null,
      presentation: false,
      presentationFrameId: null,
      linkedSource: { url: source.url, name: source.name ?? null },
      linkedDirty: false,
      // The link's document is not the user's local document or their file: a
      // later save must create a new record rather than overwrite either.
      activeDocumentId: null,
      fileHandle: null,
    });
  },

  loadFile: (file, label = 'Import document') => {
    closeBurst();
    const state = get();
    // Importing replaces the open document: save it, then forget the room.
    void persistNow();
    clearRoomTouched();
    set({
      file,
      pageId: firstPageId(file),
      selection: [],
      past: [...state.past, snapshot(state, label)].slice(-HISTORY_LIMIT),
      future: [],
      transaction: null,
      enteredContainerId: null,
      editingTextId: null,
      presentation: false,
      presentationFrameId: null,
    });
  },

  importJsonText: (text) => {
    const result = parseFile(text);
    if (!result.ok || !result.file) {
      get().pushToast(result.errors[0] ?? 'Import failed', 'error');
      return { ok: false, errors: result.errors, warnings: result.warnings };
    }
    get().loadFile(result.file, 'Import JSON');
    get().pushToast(`Imported ${result.file.name}`, 'success');
    return { ok: true, errors: [], warnings: result.warnings };
  },

  exportJsonString: () => serializeFile(get().file),

  exportScene: (ids) => {
    const state = get();
    const page = activePage(state);
    const targetIds =
      ids && ids.length > 0 ? ids : state.selection.length > 0 ? state.selection : page.children.map((child) => child.id);
    const nodes: SceneNode[] = [];
    for (const id of targetIds) {
      const node = findNode(state.file.document, id);
      if (node && node.type !== 'DOCUMENT' && node.type !== 'CANVAS') nodes.push(node);
    }
    if (nodes.length === 0) return null;
    const bounds = boundsOfNodes(state.file.document, nodes.map((node) => node.id));
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;

    const blurs: BackgroundBlurRegion[] = [];
    const collect = (node: SceneNode, parentVisible: boolean) => {
      const visible = parentVisible && node.visible && node.opacity > 0;
      if (visible && hasBackgroundBlur(node)) {
        const box = absoluteBounds(state.file.document, node.id);
        if (box) {
          blurs.push({
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            radius: backgroundBlurRadius(node),
            cornerRadius: node.cornerRadius ?? 0,
          });
        }
      }
      if (!hasChildren(node)) return;
      for (const child of node.children as SceneNode[]) collect(child, visible);
    };
    for (const node of nodes) collect(node, true);

    return {
      svg: renderSvgDocument(state.file, nodes),
      viewBox: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      backgroundBlurs: blurs,
      name: state.file.name,
      nodeIds: nodes.map((node) => node.id),
    };
  },

  exportSvgString: (ids) => {
    const state = get();
    const page = activePage(state);
    const targetIds =
      ids && ids.length > 0 ? ids : state.selection.length > 0 ? state.selection : page.children.map((child) => child.id);
    const nodes: SceneNode[] = [];
    for (const id of targetIds) {
      const node = findNode(state.file.document, id);
      if (node && node.type !== 'DOCUMENT' && node.type !== 'CANVAS') nodes.push(node);
    }
    if (nodes.length === 0) return '';
    return renderSvgDocument(state.file, nodes);
  },

  setLeftTab: (leftTab) => set({ leftTab }),
  setRightTab: (rightTab) => set({ rightTab }),

  toggleDevMode: () => {
    const next = !get().devMode;
    // Entering Dev Mode is a workspace switch: Inspect is the surface a developer
    // needs, so the panel follows.
    set(next ? { devMode: true, rightTab: 'inspect' } : { devMode: false, rightTab: 'design' });
  },

  toggleMask: (ids) => {
    const state = get();
    const targets = (ids ?? state.selection).filter((id) => {
      const node = findNode(state.file.document, id);
      // A mask must be a shape with an outline; a container clips through
      // `clipsContent` instead.
      return !!node && node.type !== 'DOCUMENT' && node.type !== 'CANVAS' && !node.locked;
    });
    if (targets.length === 0) return;
    const anyUnmasked = targets.some((id) => !(findNode(state.file.document, id) as { isMask?: boolean } | null)?.isMask);
    get().apply(anyUnmasked ? 'Use as mask' : 'Remove mask', (file) => {
      let document = file.document;
      for (const id of targets) {
        document = updateNode(document, id, (node) => {
          if (anyUnmasked) return { ...node, isMask: true } as SceneNode;
          const { isMask: _dropped, ...rest } = node as SceneNode & { isMask?: boolean };
          return rest as SceneNode;
        });
      }
      return { ...file, document };
    });
  },

  setDevStatus: (nodeId, status) => {
    get().apply(status === null ? 'Clear development status' : 'Set development status', (file) => {
      const document = updateNode(file.document, nodeId, (node) => {
        if (status === null) {
          // Clearing removes the field rather than storing a "none" value.
          const { devStatus: _dropped, ...rest } = node as SceneNode & { devStatus?: unknown };
          return rest as SceneNode;
        }
        return { ...node, devStatus: status } as SceneNode;
      });
      return { ...file, document };
    });
  },
  toggleGrid: () => set({ showGrid: !get().showGrid }),
  toggleRulers: () => set({ showRulers: !get().showRulers }),
  toggleMaskOutlines: () => set({ showMaskOutlines: !get().showMaskOutlines }),
  toggleSnapToObjects: () => set({ snapToObjects: !get().snapToObjects }),
  toggleSnapToGrid: () => set({ snapToGrid: !get().snapToGrid }),

  setPresentation: (on, frameId) => {
    const state = get();
    const page = activePage(state);
    const start = frameId ?? state.presentationFrameId ?? page.prototypeStartNodeId ?? null;
    set({
      presentation: on,
      presentationFrameId: on ? start : null,
      presentationStack: [],
      presentationOverlays: [],
    });
  },

  swapPrototype: (nodeId) => {
    // Figma's SWAP replaces the presented frame IN PLACE: the stack does not
    // grow, so Back returns to whatever preceded the frame that was swapped out
    // rather than to the frame itself.
    set({ presentationFrameId: nodeId, presentationOverlays: [] });
  },

  navigatePrototype: (nodeId) => {
    const state = get();
    set({
      presentationFrameId: nodeId,
      presentationOverlays: [],
      presentationStack: state.presentationFrameId
        ? [...state.presentationStack, state.presentationFrameId]
        : state.presentationStack,
    });
  },

  prototypeBack: () => {
    const state = get();
    if (state.presentationOverlays.length > 0) {
      set({ presentationOverlays: state.presentationOverlays.slice(0, -1) });
      return;
    }
    const previous = state.presentationStack[state.presentationStack.length - 1];
    if (!previous) return;
    set({ presentationFrameId: previous, presentationStack: state.presentationStack.slice(0, -1), presentationOverlays: [] });
  },

  pushToast: (message, kind = 'error') => {
    toastCounter += 1;
    const toast: Toast = { id: `toast-${toastCounter}`, message, kind };
    set({ toasts: [...get().toasts, toast] });
    setTimeout(() => get().dismissToast(toast.id), 4000);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
}));

/**
 * The room's document, when an untouched tab should adopt it: only a valid file
 * that is a *different* document from the local one (a different root id), so
 * two tabs that booted separately end up sharing node ids and ops line up. A tab
 * with local work keeps merging instead — nothing a user made is discarded.
 */
export function adoptRoomDocument(local: PigmaFile, incoming: unknown, untouched: boolean): PigmaFile | null {
  if (!untouched) return null;
  const result = validatePigmaFile(incoming);
  if (!result.ok || !result.file) return null;
  const candidate = result.file;
  if (candidate.document.id === local.document.id) return null;
  const localPage = local.document.children[0];
  const roomPage = candidate.document.children[0];
  if (localPage && roomPage && localPage.id === roomPage.id) return null;
  return settleDocument(candidate);
}

/**
 * Replace the whole document (new file / template / import) and reset every
 * piece of per-document state. `newFile` starts blank; the starter design is a
 * separate, explicit action.
 */
/** Close any open burst: the next coalescing action starts a fresh entry. */
export function closeBurst(): void {
  burst = null;
  // A closed burst is a finished one: the next coalescing action gets a key of
  // its own, whatever the selection was.
  selectionRevision += 1;
}

/**
 * The key a coalescing change would use right now. O(1) to build: the action,
 * the document and the selection revision — never the selected ids.
 */
export function currentBurstKey(action: string): string {
  return `${action}:${useEditor.getState().file.document.id}:${selectionRevision}`;
}

function loadDocument(
  file: PigmaFile,
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState,
): void {
  const state = get();
  // A different document is about to be open.
  closeBurst();
  void persistNow();
  clearRoomTouched();
  const settled = settleDocument(file);
  set({
    file: settled,
    pageId: firstPageId(settled),
    selection: [],
    past: [...state.past, snapshot(state, 'Load document')].slice(-HISTORY_LIMIT),
    future: [],
    transaction: null,
    enteredContainerId: null,
    editingTextId: null,
    presentation: false,
    presentationFrameId: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    pendingFit: true,
  });
}

/** Apply a layout-grid list transform to every eligible selected container. */
function editLayoutGrids(
  file: PigmaFile,
  ids: Iterable<string>,
  transform: (grids: LayoutGrid[]) => LayoutGrid[],
): PigmaFile {
  let document = file.document;
  for (const id of ids) {
    document = updateNode(document, id, (target) => {
      if (target.type === 'DOCUMENT' || !hasChildren(target)) return target;
      const container = target as typeof target & ChildrenMixin;
      return { ...container, layoutGrids: transform(container.layoutGrids ?? []) } as Node;
    });
  }
  return { ...file, document };
}

/** Reflect the theme on the document so the token overrides apply. */
function applyTheme(theme: ThemeName): void {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}

function restore(entry: HistoryEntry): Partial<EditorState> {
  const pages = entry.file.document.children;
  const pageId = pages.some((page) => page.id === entry.pageId) ? entry.pageId : (pages[0] as CanvasNode).id;
  return {
    file: entry.file,
    selection: entry.selection.filter((id) => !!findNode(entry.file.document, id)),
    pageId,
    editingTextId: null,
    enteredContainerId: null,
  };
}

function boundsOfPage(state: EditorState): Rect | null {
  const page = activePage(state);
  return boundsOfNodes(state.file.document, page.children.map((child) => child.id));
}

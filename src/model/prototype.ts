import type {
  CanvasNode,
  Node,
  PigmaFile,
  PrototypeAction,
  PrototypeFlow,
  PrototypeInteraction,
  SceneNode,
} from './types';
import { findNode, updateNode } from './tree';
import { nextNodeId } from './ids';

/**
 * Prototyping (M12).
 *
 * A node owns a list of interactions, each with a trigger and one or more
 * actions — Figma's model. Triggers: ON_CLICK / ON_HOVER / ON_DRAG (plus the
 * pointer variants the importer can carry). Actions: NODE (navigate or, with
 * `overlay`, open an overlay), BACK, CLOSE and URL.
 *
 * Flows live on the page (`page.flows`), each naming a start frame, so a file
 * can hold several presentable journeys.
 */

export const TRIGGERS = ['ON_CLICK', 'ON_HOVER', 'ON_DRAG'] as const;
export type PrototypeTrigger = (typeof TRIGGERS)[number];

export function triggerLabel(trigger: PrototypeTrigger | string): string {
  switch (trigger) {
    case 'ON_CLICK':
      return 'On click';
    case 'ON_HOVER':
      return 'On hover';
    case 'ON_DRAG':
      return 'On drag';
    default:
      return trigger;
  }
}

export function actionLabel(action: PrototypeAction): string {
  switch (action.type) {
    case 'BACK':
      return 'Back';
    case 'CLOSE':
      return 'Close';
    case 'URL':
      return 'Open URL';
    case 'NODE':
      return action.overlay ? 'Open overlay' : 'Navigate to';
    default:
      return action.type;
  }
}

export function interactionsOf(node: Node): PrototypeInteraction[] {
  if (node.type === 'DOCUMENT' || node.type === 'CANVAS') return [];
  return node.interactions ?? [];
}

function withInteractions(file: PigmaFile, nodeId: string, transform: (list: PrototypeInteraction[]) => PrototypeInteraction[]): PigmaFile {
  const node = findNode(file.document, nodeId);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') return file;
  return {
    ...file,
    document: updateNode(file.document, nodeId, (target) => ({ ...target, interactions: transform(interactionsOf(target)) }) as SceneNode),
  };
}

export function addInteraction(file: PigmaFile, nodeId: string, interaction: PrototypeInteraction): PigmaFile {
  return withInteractions(file, nodeId, (list) => [...list, interaction]);
}

export function updateInteraction(
  file: PigmaFile,
  nodeId: string,
  index: number,
  patch: Partial<PrototypeInteraction>,
): PigmaFile {
  return withInteractions(file, nodeId, (list) =>
    list.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
  );
}

export function removeInteraction(file: PigmaFile, nodeId: string, index: number): PigmaFile {
  return withInteractions(file, nodeId, (list) => list.filter((_, position) => position !== index));
}

/**
 * The action kinds the Prototype panel offers, in panel order.
 *
 * `SWAP_STATE` is the variant swap: the destination is a variant COMPONENT, and
 * playback changes the instance in place. Without it here a swap could only be
 * imported, never authored.
 */
export type PrototypeActionKind = 'NAVIGATE' | 'OVERLAY' | 'SWAP_STATE' | 'BACK' | 'CLOSE' | 'URL';

/** Build the action for a kind, so the quick-link row and the editor agree. */
export function actionOfKind(
  kind: PrototypeActionKind,
  destinationId?: string | null,
  url?: string,
): PrototypeAction {
  switch (kind) {
    case 'OVERLAY':
      return { type: 'NODE', destinationId: destinationId ?? null, overlay: true, navigation: 'OVERLAY' };
    case 'SWAP_STATE':
      return { type: 'NODE', destinationId: destinationId ?? null, navigation: 'SWAP_STATE' };
    case 'BACK':
      return { type: 'BACK' };
    case 'CLOSE':
      return { type: 'CLOSE' };
    case 'URL':
      return { type: 'URL', url: url ?? 'https://' };
    default:
      return { type: 'NODE', destinationId: destinationId ?? null, navigation: 'NAVIGATE' };
  }
}

/**
 * One step of a trigger's action list: the action, and the frame it applies to.
 *
 * A trigger's actions run IN ORDER, and a navigate makes its destination the
 * current frame for the actions after it — Figma's model, and the only coherent
 * one, since the origin is no longer on screen. So a navigate-then-overlay opens
 * the overlay ON THE DESTINATION. `frameId` is the frame the action resolves
 * against when the plan is built; `null` means the plan cannot know it (a BACK
 * moves to a frame only the run-time stack knows), and such a step resolves
 * against whatever frame is current when it runs.
 */
export interface PrototypeStep {
  action: PrototypeAction;
  frameId: string | null;
}

/** Resolve a trigger's actions into the steps playback runs, in order. */
export function planActions(actions: PrototypeAction[], startFrameId: string | null): PrototypeStep[] {
  const steps: PrototypeStep[] = [];
  let current = startFrameId;
  for (const action of actions) {
    if (action.type === 'NODE') {
      if (!action.destinationId) continue;
      steps.push({ action, frameId: current });
      if (!action.overlay) current = action.destinationId;
      continue;
    }
    // BACK leaves the frame to the stack, so later steps resolve at run time.
    steps.push({ action, frameId: action.type === 'BACK' ? null : current });
    if (action.type === 'BACK') current = null;
  }
  return steps;
}

export function defaultInteraction(
  destinationId?: string,
  kind: PrototypeActionKind = 'NAVIGATE',
  transition?: PrototypeAction['transition'],
): PrototypeInteraction {
  const action = actionOfKind(kind, destinationId ?? null);
  return {
    trigger: { type: 'ON_CLICK' },
    actions: [transition ? { ...action, transition } : action],
  };
}

/** Frames (and components) that can be a destination. */
/**
 * Where a prototype action can point.
 *
 * Frames and standalone components, PLUS the variants of the page's component
 * sets — a swap target IS a variant, and a variant lives inside a set, so
 * offering only the page's direct children left it unchoosable. Each variant
 * carries its set's name as `group`, so the picker can keep the list readable
 * instead of dumping every component into one flat list.
 */
export function prototypeDestinations(file: PigmaFile, pageId: string): Array<{ id: string; name: string; group?: string }> {
  const page = file.document.children.find((child) => child.id === pageId);
  if (!page) return [];
  const out: Array<{ id: string; name: string; group?: string }> = [];
  for (const child of page.children as SceneNode[]) {
    if (child.type === 'FRAME' || child.type === 'COMPONENT') {
      out.push({ id: child.id, name: child.name });
      continue;
    }
    if (child.type !== 'COMPONENT_SET') continue;
    for (const variant of child.children as SceneNode[]) {
      if (variant.type === 'COMPONENT') out.push({ id: variant.id, name: variant.name, group: child.name });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

export function flowsOf(page: CanvasNode): PrototypeFlow[] {
  return page.flows ?? [];
}

export function addFlow(file: PigmaFile, pageId: string, startNodeId: string, name?: string): { file: PigmaFile; flowId: string | null } {
  const page = file.document.children.find((child) => child.id === pageId);
  const start = findNode(file.document, startNodeId);
  if (!page || !start || (start.type !== 'FRAME' && start.type !== 'COMPONENT')) return { file, flowId: null };
  const flows = flowsOf(page);
  const flow: PrototypeFlow = {
    id: nextNodeId(),
    name: name?.trim() || `Flow ${flows.length + 1}`,
    startNodeId,
  };
  return {
    file: {
      ...file,
      document: {
        ...file.document,
        children: file.document.children.map((child) => (child.id === pageId ? { ...child, flows: [...flows, flow] } : child)),
      },
    },
    flowId: flow.id,
  };
}

export function renameFlow(file: PigmaFile, pageId: string, flowId: string, name: string): PigmaFile {
  if (name.trim() === '') return file;
  return {
    ...file,
    document: {
      ...file.document,
      children: file.document.children.map((child) =>
        child.id === pageId
          ? { ...child, flows: flowsOf(child).map((flow) => (flow.id === flowId ? { ...flow, name: name.trim() } : flow)) }
          : child,
      ),
    },
  };
}

export function removeFlow(file: PigmaFile, pageId: string, flowId: string): PigmaFile {
  return {
    ...file,
    document: {
      ...file.document,
      children: file.document.children.map((child) =>
        child.id === pageId ? { ...child, flows: flowsOf(child).filter((flow) => flow.id !== flowId) } : child,
      ),
    },
  };
}

/** Every node id that a flow can reach (used to warn about dead ends). */
export function reachableFrom(file: PigmaFile, startNodeId: string): string[] {
  const seen = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = findNode(file.document, id);
    if (!node) continue;
    const visit = (current: Node) => {
      for (const interaction of interactionsOf(current)) {
        for (const action of interaction.actions) {
          if (action.type === 'NODE' && action.destinationId && !seen.has(action.destinationId)) queue.push(action.destinationId);
        }
      }
      if ('children' in current && Array.isArray(current.children)) current.children.forEach(visit);
    };
    visit(node);
  }
  return [...seen];
}

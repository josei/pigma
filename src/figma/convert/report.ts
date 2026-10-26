/** Structured report of everything a Figma import could not map losslessly. */
import type { PigmaFile } from '../../model/types';

export interface UnsupportedItem {
  /** Id of the node the limitation applies to, when node-scoped. */
  nodeId?: string;
  /** Dotted path within the imported tree, e.g. `pages.0.children.2`. */
  path: string;
  /** Stable feature key, e.g. `nodeType:STICKY`, `paint:VIDEO`, `autoLayout:GRID`. */
  feature: string;
  detail?: string;
}

export interface ImportReport {
  sourceKind: 'rest' | 'native';
  /** Features that could not be represented in the Pigma model. Never silent. */
  unsupported: UnsupportedItem[];
  /** Non-fatal notes (approximations, skipped deleted nodes, …). */
  warnings: string[];
  counts: {
    pages: number;
    nodes: number;
    byType: Record<string, number>;
  };
  /** Always true: every imported node keeps its original source object in `raw`. */
  rawPreserved: true;
}

/** Accumulates unsupported items and warnings while converting. */
export class ReportBuilder {
  readonly unsupported: UnsupportedItem[] = [];
  readonly warnings: string[] = [];
  private readonly byType: Record<string, number> = {};

  addUnsupported(item: UnsupportedItem): void {
    this.unsupported.push(item);
  }

  warn(message: string): void {
    this.warnings.push(message);
  }

  countType(type: string): void {
    this.byType[type] = (this.byType[type] ?? 0) + 1;
  }

  finish(sourceKind: 'rest' | 'native', pages: number, nodes: number): ImportReport {
    return {
      sourceKind,
      unsupported: this.unsupported,
      warnings: this.warnings,
      counts: { pages, nodes, byType: { ...this.byType } },
      rawPreserved: true,
    };
  }
}

/** Result of converting a Figma source into the Pigma editor model. */
export interface FigmaImportResult {
  file: PigmaFile;
  report: ImportReport;
}

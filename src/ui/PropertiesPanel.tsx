import { useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { selectedNodes, useEditor } from '../store/editorStore';
import type { AlignMode, ReorderMode } from '../model/ops';
import { firstVisibleFill, paintToCssBackground, rgbaToHex, hexToRgba, type GradientSpec } from '../model/paint';
import { gradientSpec } from '../model/paint';
import type { BlendMode, ContainerNode, OverlayPosition, Paint, SceneNode, TextNode, TextStyle } from '../model/types';
import { OVERLAY_POSITIONS } from '../model/overlay';
import { limitsOf } from '../model/sizing';
import { cropOf, imageFillsOf } from '../model/image';
import { decodeImageFile } from './imageInput';
import { hasChildren } from '../model/types';
import { defaultAutoLayout } from '../model/autoLayout';
import { EFFECT_TYPES, effectLabel, isBlur, isShadow, type EffectKind } from '../model/effects';
import { CONSTRAINT_TYPES, constraintLabel } from '../model/constraints';
import { VariableBind } from './VariablesPanel';
import { InspectPanel } from './InspectPanel';
import { BOOLEAN_MODES, booleanLabel } from '../model/boolean';
import { cornerRadii } from '../render/SceneRenderer';
import { useIsMobile } from './useIsMobile';
import {
  TRIGGERS,
  flowsOf,
  interactionsOf,
  prototypeDestinations,
  triggerLabel,
} from '../model/prototype';
import type { PrototypeAction } from '../model/types';
import type { PrototypeActionKind } from '../model/prototype';
import {
  componentLibrary,
  componentPropertiesOf,
  componentSetOf,
  describeVariant,
  findVariant,
  parseVariantName,
  resolvedProperties,
  variantOptions,
  variantsOf,
} from '../model/variants';
import type { ComponentNode, ComponentPropertyValue, InstanceNode } from '../model/types';
import { staleLibraryInstances } from '../model/library';
import type { AutoLayout, Constraints, GridTrackSize, LayoutGrid } from '../model/types';
import type { Effect } from '../model/types';
import { absoluteBounds, findNode } from '../model/tree';
import { roundTo as round } from '../model/matrix';

/** Numeric field with Figma-style drag-to-scrub and keyboard commit. */
function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  icon,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  step?: number;
  icon?: IconName;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  // `draft` is only set while the user is typing/scrubbing; otherwise the field
  // displays the store value directly, so it can never lag a render behind.
  const [draft, setDraft] = useState<string | null>(null);
  const scrubbing = useRef<{ x: number; start: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const display = draft ?? String(round(value));

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      setDraft(null);
      return;
    }
    const clamped = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, parsed));
    onCommit(clamped);
    setDraft(null);
  };

  // The scrub handle fills the field, so the field must establish the
  // containing block itself (never rely on a stylesheet for this).
  return (
    <label
      className="input input--numeric input--scrub"
      style={{ position: 'relative' }}
      onPointerDown={(event) => {
        // Drag the field chrome (label/prefix) to scrub; typing in the input is
        // left completely alone.
        if (event.target === inputRef.current) return;
        scrubbing.current = { x: event.clientX, start: value };
        useEditor.getState().beginTransaction();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const state = scrubbing.current;
        if (!state) return;
        const delta = (event.clientX - state.x) * (event.shiftKey ? 10 : 1) * step;
        const next = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, state.start + delta));
        onCommit(round(next));
      }}
      onPointerUp={() => {
        if (!scrubbing.current) return;
        scrubbing.current = null;
        useEditor.getState().endTransaction(`Set ${label}`);
      }}
      onPointerCancel={() => {
        if (!scrubbing.current) return;
        scrubbing.current = null;
        useEditor.getState().endTransaction(`Set ${label}`);
      }}
    >
      {icon ? <Icon name={icon} size={12} /> : <span className="prop-row__label">{label}</span>}
      <input
        ref={inputRef}
        value={display}
        inputMode="decimal"
        aria-label={label}
        // Figma selects the value on focus, so typing replaces instead of appending.
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(display)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(display);
          if (event.key === 'Escape') setDraft(null);
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const delta = (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? step * 10 : step);
            commit(String(round(value + delta)));
          }
        }}
      />
      {suffix ? <span className="prop-row__label">{suffix}</span> : null}
      {/* Decorative: the scrub gesture lives on the wrapper, so the value input
          stays clickable and typeable. */}
      <span className="input__scrub-handle" aria-hidden="true" style={{ pointerEvents: 'none' }} />
    </label>
  );
}

function PaintRow({
  label,
  paint,
  onChange,
  variableProperty,
}: {
  label: string;
  paint: Paint | null;
  onChange: (paint: Paint | null) => void;
  variableProperty?: string;
}) {
  const color = paint?.type === 'SOLID' ? paint.color : { r: 0, g: 0, b: 0 };
  const alpha = paint?.type === 'SOLID' ? paint.opacity ?? 1 : 1;
  const hasPaint = !!paint && paint.visible !== false;
  const gradient = paint && paint.type !== 'SOLID' ? gradientSpec(paint, 'preview') : null;

  return (
    <>
      <div className="prop-row">
        <span className="prop-row__label">{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
        <button
          type="button"
          className={`color-swatch${hasPaint ? '' : ' color-swatch--empty'}`}
          data-tooltip={hasPaint ? 'Toggle visibility' : 'Add'}
          onClick={() => onChange(paint ? { ...paint, visible: paint.visible === false } : { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 })}
        >
          <span className="color-swatch__fill" style={{ background: hasPaint ? paintToCssBackground(paint) : 'transparent' }} />
        </button>
        {paint?.type === 'SOLID' ? (
          <input
            className="input"
            type="color"
            aria-label={`${label} colour`}
            value={rgbaToHex(color)}
            onChange={(event) => onChange({ ...paint, color: hexToRgba(event.target.value) })}
            style={{ width: 28, padding: 0, border: 'none', background: 'transparent' }}
          />
        ) : null}
        {gradient ? <GradientSummary spec={gradient} /> : null}
        <input
          className="input input--numeric"
          style={{ width: 56 }}
          aria-label={`${label} opacity`}
          value={`${Math.round(alpha * 100)}%`}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value.replace('%', ''), 10);
            if (!Number.isFinite(parsed) || !paint) return;
            onChange({ ...paint, opacity: Math.min(1, Math.max(0, parsed / 100)) });
          }}
        />
        <button
          type="button"
          className="icon-button"
          data-tooltip={paint ? 'Remove' : 'Add solid fill'}
          aria-label={`${paint ? 'Remove' : 'Add'} ${label}`}
          onClick={() =>
            onChange(paint ? null : { type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 })
          }
        >
          <Icon name={paint ? 'minus' : 'plus'} size={14} />
        </button>
        </div>
      </div>
      {/* The bind control is a sibling row: sharing the paint row squeezed the
          colour input to zero width. */}
      {variableProperty ? (
        <div className="prop-row">
          <span className="prop-row__label">{label} var</span>
          <VariableBind property={variableProperty} label={label} />
        </div>
      ) : null}
    </>
  );
}

function GradientSummary({ spec }: { spec: GradientSpec }) {
  return (
    <span className="prop-row__label" style={{ whiteSpace: 'nowrap' }}>
      {spec.kind.toLowerCase()} · {spec.stops.length} stops
    </span>
  );
}

const ALIGNMENTS: Array<{ mode: AlignMode; icon: IconName; label: string }> = [
  { mode: 'left', icon: 'align-left', label: 'Align left' },
  { mode: 'hcenter', icon: 'align-hcenter', label: 'Align horizontal centres' },
  { mode: 'right', icon: 'align-right', label: 'Align right' },
  { mode: 'top', icon: 'align-top', label: 'Align top' },
  { mode: 'vcenter', icon: 'align-vcenter', label: 'Align vertical centres' },
  { mode: 'bottom', icon: 'align-bottom', label: 'Align bottom' },
];

function AlignmentSection() {
  const selection = useEditor((state) => state.selection);
  const align = useEditor((state) => state.align);
  const distribute = useEditor((state) => state.distribute);
  return (
    <div className="section">
      <div className="section__header">
        <span>Alignment</span>
      </div>
      <div className="section__body">
        <div className="align-grid">
          {ALIGNMENTS.map((entry) => (
            <button
              key={entry.mode}
              type="button"
              className="icon-button"
              data-tooltip={entry.label}
              aria-label={entry.label}
              disabled={selection.length === 0}
              onClick={() => align(entry.mode)}
            >
              <Icon name={entry.icon} />
            </button>
          ))}
          <button
            type="button"
            className="icon-button"
            data-tooltip="Distribute horizontally"
            aria-label="Distribute horizontally"
            disabled={selection.length < 3}
            onClick={() => distribute('horizontal')}
          >
            <Icon name="distribute-h" />
          </button>
          <button
            type="button"
            className="icon-button"
            data-tooltip="Distribute vertically"
            aria-label="Distribute vertically"
            disabled={selection.length < 3}
            onClick={() => distribute('vertical')}
          >
            <Icon name="distribute-v" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: IconName }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="prop-row">
      <span className="prop-row__label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`segmented__option${option.value === value ? ' segmented__option--active' : ''}`}
            aria-pressed={option.value === value}
            // Icon-only options carry no text: the label is the accessible name
            // and the tooltip, so nothing can wrap or overflow the button.
            {...(option.icon ? { 'aria-label': option.label, 'data-tooltip': option.label } : {})}
            onClick={() => onChange(option.value)}
          >
            {option.icon ? <Icon name={option.icon} size={14} /> : option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TransformSection({ node }: { node: SceneNode }) {
  const file = useEditor((state) => state.file);
  const updateSelected = useEditor((state) => state.updateSelected);
  const bounds = absoluteBounds(file.document, node.id);
  const rotation = Math.round((Math.atan2(node.transform.b, node.transform.a) * 180) / Math.PI);

  return (
    <div className="section">
      <div className="section__header">
        <span>Position</span>
      </div>
      <div className="section__body">
        <div className="prop-grid prop-grid--2">
          <NumberField label="X" value={bounds?.x ?? 0} onCommit={(x) => updateSelected({ x }, 'Set X')} />
          <NumberField label="Y" value={bounds?.y ?? 0} onCommit={(y) => updateSelected({ y }, 'Set Y')} />
        </div>
        <div className="prop-grid prop-grid--2">
          <NumberField label="W" value={node.width} min={1} onCommit={(width) => updateSelected({ width }, 'Set width')} />
          <NumberField
            label="H"
            value={node.height}
            min={node.type === 'LINE' ? 0 : 1}
            onCommit={(height) => updateSelected({ height }, 'Set height')}
          />
        </div>
        <div className="prop-grid prop-grid--2">
          <NumberField
            label="Rotation"
            value={rotation}
            suffix="°"
            onCommit={(value) => updateSelected({ rotation: value }, 'Set rotation')}
          />
          <NumberField
            label="Opacity"
            value={Math.round(node.opacity * 100)}
            min={0}
            max={100}
            suffix="%"
            onCommit={(value) => updateSelected({ opacity: value / 100 }, 'Set opacity')}
          />
        </div>
        <div className="prop-row">
          <span className="prop-row__label">Opacity var</span>
          <VariableBind property="opacity" label="Opacity" />
        </div>
        <div className="prop-grid prop-grid--2">
          <button
            type="button"
            className="segmented__option"
            aria-label="Flip horizontal"
            data-tooltip="Flip horizontal  ⇧H"
            onClick={() => useEditor.getState().flip('horizontal')}
          >
            <Icon name="flip-h" size={14} />
          </button>
          <button
            type="button"
            className="segmented__option"
            aria-label="Flip vertical"
            data-tooltip="Flip vertical  ⇧V"
            onClick={() => useEditor.getState().flip('vertical')}
          >
            <Icon name="flip-v" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Figma's blend modes, in panel order. PASS_THROUGH only applies to containers. */
const BLEND_MODE_OPTIONS: Array<{ value: BlendMode; label: string }> = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'MULTIPLY', label: 'Multiply' },
  { value: 'SCREEN', label: 'Screen' },
  { value: 'OVERLAY', label: 'Overlay' },
  { value: 'DARKEN', label: 'Darken' },
  { value: 'LIGHTEN', label: 'Lighten' },
  { value: 'COLOR_DODGE', label: 'Color dodge' },
  { value: 'COLOR_BURN', label: 'Color burn' },
  { value: 'HARD_LIGHT', label: 'Hard light' },
  { value: 'SOFT_LIGHT', label: 'Soft light' },
  { value: 'DIFFERENCE', label: 'Difference' },
  { value: 'EXCLUSION', label: 'Exclusion' },
  { value: 'HUE', label: 'Hue' },
  { value: 'SATURATION', label: 'Saturation' },
  { value: 'COLOR', label: 'Color' },
  { value: 'LUMINOSITY', label: 'Luminosity' },
];

function blendModeOptions(node: SceneNode) {
  const isContainer =
    node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' || node.type === 'INSTANCE';
  return isContainer
    ? [{ value: 'PASS_THROUGH' as BlendMode, label: 'Pass through' }, ...BLEND_MODE_OPTIONS]
    : BLEND_MODE_OPTIONS;
}

function AppearanceSection({ node }: { node: SceneNode }) {
  const updateSelected = useEditor((state) => state.updateSelected);
  const fill = firstVisibleFill(node.fills);
  const stroke = firstVisibleFill(node.strokes);
  const radii = (node as { cornerRadius?: number }).cornerRadius ?? 0;
  const blendMode: BlendMode = node.blendMode ?? 'NORMAL';
  const corners = cornerRadii(node);
  const [individualCorners, setIndividualCorners] = useState(!!node.rectangleCornerRadii);
  const imageFill = node.fills.some((paint) => paint.type === 'IMAGE');

  return (
    <div className="section">
      <div className="section__header">
        <span>Appearance</span>
      </div>
      <div className="section__body">
        <PaintRow
          label="Fill"
          paint={fill}
          variableProperty="fill"
          onChange={(paint) => updateSelected({ fills: paint ? [paint] : [] }, 'Set fill')}
        />
        <PaintRow
          label="Stroke"
          paint={stroke}
          variableProperty="stroke"
          onChange={(paint) => updateSelected({ strokes: paint ? [paint] : [] }, 'Set stroke')}
        />
        {node.strokes.length > 0 ? (
          <>
            <div className="prop-stack">
              <NumberField
                label="Weight"
                value={node.strokeWeight ?? 1}
                min={0}
                onCommit={(value) => updateSelected({ strokeWeight: value }, 'Set stroke weight')}
              />
              <Segmented
                label="Align"
                value={node.strokeAlign ?? 'CENTER'}
                options={[
                  { value: 'INSIDE', label: 'In' },
                  { value: 'CENTER', label: 'Mid' },
                  { value: 'OUTSIDE', label: 'Out' },
                ]}
                onChange={(value) => updateSelected({ strokeAlign: value }, 'Set stroke align')}
              />
            </div>
            <DashRow dash={node.dashPattern ?? []} onChange={(pattern) => updateSelected({ dashPattern: pattern }, 'Set dash pattern')} />
          </>
        ) : null}
        {node.type === 'POLYGON' || node.type === 'STAR' ? (
          // Polygon and star are editable after creation, like every other shape:
          // the side/point count, the corner radius and (for a star) how deep the
          // inner points reach. All three are node fields, so they persist with
          // the document and survive export/import.
          <div className="prop-grid prop-grid--2">
            <NumberField
              label={node.type === 'STAR' ? 'Points' : 'Sides'}
              value={node.pointCount ?? (node.type === 'STAR' ? 5 : 3)}
              min={3}
              max={60}
              onCommit={(value) => updateSelected({ pointCount: Math.round(value) }, 'Set point count')}
            />
            <NumberField
              label="Radius"
              value={node.cornerRadius ?? 0}
              min={0}
              onCommit={(value) => updateSelected({ cornerRadius: value }, 'Set corner radius')}
            />
            {node.type === 'STAR' ? (
              <NumberField
                label="Inner radius"
                value={Math.round((node.innerRadius ?? 0.382) * 100)}
                min={1}
                max={100}
                onCommit={(value) => updateSelected({ innerRadius: Math.min(1, Math.max(0.01, value / 100)) }, 'Set inner radius')}
              />
            ) : null}
          </div>
        ) : null}
        {node.type === 'RECTANGLE' || node.type === 'FRAME' || node.type === 'COMPONENT' ? (
          individualCorners ? (
            <div className="prop-grid prop-grid--2">
              {(['Top left', 'Top right', 'Bottom right', 'Bottom left'] as const).map((label, index) => (
                <NumberField
                  key={label}
                  label={label}
                  value={corners[index]!}
                  min={0}
                  onCommit={(value) => {
                    const next = [...corners] as [number, number, number, number];
                    next[index] = value;
                    updateSelected({ rectangleCornerRadii: next }, 'Set corner radius');
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="prop-grid prop-grid--2">
              <NumberField
                label="Radius"
                value={radii}
                min={0}
                onCommit={(value) =>
                  // A uniform radius replaces the per-corner values.
                  updateSelected({ cornerRadius: value, rectangleCornerRadii: undefined }, 'Set corner radius')
                }
              />
            </div>
          )
        ) : null}
        {node.type === 'RECTANGLE' || node.type === 'FRAME' || node.type === 'COMPONENT' ? (
          <div className="prop-row">
            <label className="prop-row__label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                aria-label="Independent corners"
                checked={individualCorners}
                onChange={(event) => {
                  const next = event.target.checked;
                  setIndividualCorners(next);
                  if (next) {
                    // Seed the four corners from the current uniform radius.
                    if (!node.rectangleCornerRadii) updateSelected({ rectangleCornerRadii: corners }, 'Set corner radius');
                  } else {
                    // Back to one radius: drop the per-corner values so it applies.
                    updateSelected({ rectangleCornerRadii: undefined }, 'Set corner radius');
                  }
                }}
              />
              Independent corners
            </label>
          </div>
        ) : null}
        {imageFill ? <ImageFillControls /> : null}
        <div className="prop-row">
          <span className="prop-row__label">Blend</span>
          <select
            className="input"
            aria-label="Blend mode"
            value={blendMode}
            onChange={(event) => updateSelected({ blendMode: event.target.value as BlendMode }, 'Set blend mode')}
          >
            {blendModeOptions(node).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

/**
 * Image editing (M2): scale mode, crop controls for CROP and a replace action.
 * Everything acts on the selected node's image fill.
 */
function ImageFillControls() {
  const selection = useEditor((state) => state.selection);
  const file = useEditor((state) => state.file);
  const setImageScaleMode = useEditor((state) => state.setImageScaleMode);
  const setImageCrop = useEditor((state) => state.setImageCrop);
  const replaceSelectedImage = useEditor((state) => state.replaceSelectedImage);
  const pushToast = useEditor((state) => state.pushToast);
  const node = selection.length === 1 ? findNode(file.document, selection[0]!) : null;
  const paint = node ? imageFillsOf(node)[0]?.paint : undefined;
  if (!paint) return null;
  const mode = paint.scaleMode ?? 'FILL';
  const crop = cropOf(paint);

  return (
    <>
      <div className="prop-row">
        <span className="prop-row__label">Image</span>
        <select
          className="input"
          aria-label="Image scale mode"
          value={mode}
          onChange={(event) => setImageScaleMode(event.target.value as 'FILL' | 'FIT' | 'CROP' | 'TILE')}
        >
          <option value="FILL">Fill</option>
          <option value="FIT">Fit</option>
          <option value="CROP">Crop</option>
          <option value="TILE">Tile</option>
        </select>
        <button
          type="button"
          className="button"
          aria-label="Replace image"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = () => {
              const picked = input.files?.[0];
              if (!picked) return;
              void decodeImageFile(picked)
                .then((decoded) => replaceSelectedImage(decoded.dataUrl, { width: decoded.width, height: decoded.height }))
                .catch((error: unknown) => pushToast(`Could not read that image: ${String(error)}`));
            };
            input.click();
          }}
        >
          Replace
        </button>
      </div>
      {mode === 'CROP' ? (
        <>
          <div className="prop-grid prop-grid--3">
            <NumberField label="Zoom" value={Math.round(crop.scale * 100)} suffix="%" min={10} onCommit={(value) => setImageCrop({ ...crop, scale: Math.max(0.1, value / 100) })} />
            <NumberField label="Crop X" value={Math.round(crop.offsetX * 100)} suffix="%" onCommit={(value) => setImageCrop({ ...crop, offsetX: value / 100 })} />
            <NumberField label="Crop Y" value={Math.round(crop.offsetY * 100)} suffix="%" onCommit={(value) => setImageCrop({ ...crop, offsetY: value / 100 })} />
          </div>
          <button type="button" className="button" aria-label="Reset crop" onClick={() => setImageCrop({ scale: 1, offsetX: 0, offsetY: 0 })}>
            Reset crop
          </button>
        </>
      ) : null}
    </>
  );
}

/**
 * Number field that accepts an empty value: `unbounded` is what an empty field
 * means for the caller (1 for a minimum, 0 for a maximum).
 */
function OptionalNumberField({
  label,
  value,
  unbounded,
  onCommit,
}: {
  label: string;
  value: number;
  unbounded: number;
  onCommit: (value: number | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? (value === unbounded ? '' : String(Math.round(value)));
  return (
    <label className="prop-row" style={{ gap: 4 }}>
      <span className="prop-row__label">{label}</span>
      <input
        className="input"
        aria-label={label}
        placeholder="Auto"
        value={display}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft === null) return;
          const trimmed = draft.trim();
          onCommit(trimmed === '' ? undefined : Number.parseFloat(trimmed));
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          (event.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

function TextSection({ node }: { node: TextNode }) {
  const updateStyle = useEditor((state) => state.updateSelectedTextStyle);
  const style = node.style;
  return (
    <div className="section">
      <div className="section__header">
        <span>Text</span>
      </div>
      <div className="section__body">
        <div className="prop-row">
          <span className="prop-row__label">Family</span>
          <select
            className="input"
            aria-label="Font family"
            value={FONT_FAMILIES.some((font) => font.value === style.fontFamily) ? style.fontFamily : 'custom'}
            onChange={(event) => {
              if (event.target.value === 'custom') return;
              updateStyle({ fontFamily: event.target.value });
            }}
          >
            {FONT_FAMILIES.map((font) => (
              <option key={font.value} value={font.value}>{font.label}</option>
            ))}
            {FONT_FAMILIES.some((font) => font.value === style.fontFamily) ? null : (
              <option value="custom">{style.fontFamily}</option>
            )}
          </select>
        </div>
        <Segmented
          label="Style"
          value={fontStyleOf(style)}
          options={[
            { value: 'REGULAR', label: 'Reg' },
            { value: 'ITALIC', label: 'Italic' },
            { value: 'BOLD', label: 'Bold' },
            { value: 'BOLD_ITALIC', label: 'B+I' },
          ]}
          onChange={(value) => updateStyle(stylePatchFor(value))}
        />
        <div className="prop-grid prop-grid--2">
          <NumberField
            label="Size"
            value={style.fontSize}
            min={1}
            onCommit={(value) => updateStyle({ fontSize: value })}
          />
          <NumberField
            label="Weight"
            value={style.fontWeight ?? 400}
            step={100}
            min={100}
            max={900}
            onCommit={(value) => updateStyle({ fontWeight: value })}
          />
        </div>
        <div className="prop-stack">
          <NumberField
            label="Line height"
            value={style.lineHeight?.value ?? 120}
            suffix="%"
            min={10}
            onCommit={(value) => updateStyle({ lineHeight: { unit: 'PERCENT', value } })}
          />
          <NumberField
            label="Letter"
            value={style.letterSpacing?.value ?? 0}
            suffix="%"
            onCommit={(value) => updateStyle({ letterSpacing: { unit: 'PERCENT', value } })}
          />
        </div>
        <Segmented
          label="Align"
          value={style.textAlignHorizontal ?? 'LEFT'}
          options={[
            { value: 'LEFT', label: 'L' },
            { value: 'CENTER', label: 'C' },
            { value: 'RIGHT', label: 'R' },
            { value: 'JUSTIFIED', label: 'J' },
          ]}
          onChange={(value) => updateStyle({ textAlignHorizontal: value })}
        />
        <Segmented
          label="Vertical"
          value={style.textAlignVertical ?? 'TOP'}
          options={[
            { value: 'TOP', label: 'Top' },
            { value: 'CENTER', label: 'Mid' },
            { value: 'BOTTOM', label: 'Bot' },
          ]}
          onChange={(value) => updateStyle({ textAlignVertical: value })}
        />
        <Segmented
          label="Case"
          value={style.textCase ?? 'ORIGINAL'}
          options={[
            { value: 'ORIGINAL', label: 'Aa' },
            { value: 'UPPER', label: 'AA' },
            { value: 'LOWER', label: 'aa' },
            { value: 'TITLE', label: 'Ab' },
          ]}
          onChange={(value) => updateStyle({ textCase: value })}
        />
        <Segmented
          label="Decorate"
          value={style.textDecoration ?? 'NONE'}
          options={[
            { value: 'NONE', label: 'None' },
            { value: 'UNDERLINE', label: 'U̲' },
            { value: 'STRIKETHROUGH', label: 'S̶' },
          ]}
          onChange={(value) => updateStyle({ textDecoration: value })}
        />
        <Segmented
          label="Auto size"
          value={style.textAutoResize ?? 'WIDTH_AND_HEIGHT'}
          options={[
            { value: 'WIDTH_AND_HEIGHT', label: 'Auto' },
            { value: 'HEIGHT', label: 'Height' },
            { value: 'NONE', label: 'Fixed' },
            { value: 'TRUNCATE', label: 'Clip' },
          ]}
          onChange={(value) => updateStyle({ textAutoResize: value })}
        />
      </div>
    </div>
  );
}

/**
 * Font families offered by the picker: the bundled Inter plus the system stacks
 * every platform ships, so a design never depends on a webfont to render.
 */
const FONT_FAMILIES: Array<{ value: string; label: string }> = [
  { value: 'Inter', label: 'Inter' },
  { value: '-apple-system', label: 'System UI' },
  { value: 'Helvetica Neue', label: 'Helvetica Neue' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'monospace', label: 'Monospace' },
];

type FontStyleChoice = 'REGULAR' | 'ITALIC' | 'BOLD' | 'BOLD_ITALIC';

/** Current face, derived from the weight and style the model stores. */
function fontStyleOf(style: TextStyle): FontStyleChoice {
  const italic = style.fontStyle?.toLowerCase().includes('italic') ?? false;
  const bold = (style.fontWeight ?? 400) >= 700;
  if (bold && italic) return 'BOLD_ITALIC';
  if (bold) return 'BOLD';
  if (italic) return 'ITALIC';
  return 'REGULAR';
}

function stylePatchFor(choice: FontStyleChoice): { fontWeight: number; fontStyle: string } {
  return {
    fontWeight: choice === 'BOLD' || choice === 'BOLD_ITALIC' ? 700 : 400,
    fontStyle: choice === 'ITALIC' || choice === 'BOLD_ITALIC' ? 'italic' : 'normal',
  };
}

const ORDER_COMMANDS: Array<{ mode: ReorderMode; label: string; tooltip: string }> = [
  { mode: 'front', label: 'Front', tooltip: 'Bring to front  ⌘⇧]' },
  { mode: 'forward', label: 'Up', tooltip: 'Bring forward  ⌘]' },
  { mode: 'backward', label: 'Down', tooltip: 'Send backward  ⌘[' },
  { mode: 'back', label: 'Back', tooltip: 'Send to back  ⌘⇧[' },
];

/**
 * Min/max sizing (M10): an empty field means "no limit". Values clamp resizes,
 * HUG/FILL auto-layout and constraints, so the node can never leave its range.
 */
function SizeLimitsSection({ node }: { node: SceneNode }) {
  const updateSelected = useEditor((state) => state.updateSelected);
  const limits = limitsOf(node);
  const commit = (patch: { minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number }) =>
    updateSelected(patch, 'Set size limits');
  const fields: Array<{ label: string; value: number; key: 'minWidth' | 'minHeight' | 'maxWidth' | 'maxHeight'; unbounded: number }> = [
    { label: 'Min W', value: node.minWidth ?? limits.minWidth, key: 'minWidth', unbounded: 1 },
    { label: 'Max W', value: node.maxWidth ?? 0, key: 'maxWidth', unbounded: 0 },
    { label: 'Min H', value: node.minHeight ?? limits.minHeight, key: 'minHeight', unbounded: 1 },
    { label: 'Max H', value: node.maxHeight ?? 0, key: 'maxHeight', unbounded: 0 },
  ];
  return (
    <div className="section">
      <div className="section__header">
        <span>Size limits</span>
      </div>
      <div className="section__body">
        <div className="prop-grid prop-grid--2">
          {fields.map((field) => (
            <OptionalNumberField
              key={field.key}
              label={field.label}
              value={field.value}
              unbounded={field.unbounded}
              onCommit={(value) => commit({ [field.key]: value } as never)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function LayoutSection({ node }: { node: SceneNode }) {
  return (
    <div className="section">
      <div className="section__header">
        <span>Layer</span>
      </div>
      <div className="section__body">
        {/* Four commands, not a mode switch: no option is ever "selected". */}
        <div className="segmented" role="group" aria-label="Order">
          {ORDER_COMMANDS.map((command) => (
            <button
              key={command.mode}
              type="button"
              className="segmented__option"
              data-tooltip={command.tooltip}
              onClick={() => useEditor.getState().reorder(command.mode)}
            >
              {command.label}
            </button>
          ))}
        </div>
        <div className="prop-row">
          <span className="prop-row__label">Visible</span>
          <input
            type="checkbox"
            checked={node.visible}
            aria-label="Visible"
            onChange={() => useEditor.getState().toggleVisible(node.id)}
          />
          <span className="prop-row__label">Visible var</span>
          <VariableBind property="visible" label="Visible" />
          <span className="prop-row__label">Locked</span>
          <input
            type="checkbox"
            checked={node.locked}
            aria-label="Locked"
            onChange={() => useEditor.getState().toggleLock(node.id)}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Constraint options are glyph buttons: the text labels ("Left / Top",
 * "Right / Bottom") are too long for a 240px panel and wrapped out of the
 * button, so the glyph carries the meaning and the label stays as its
 * accessible name and tooltip.
 */
const CONSTRAINT_GLYPHS: Record<Constraints['horizontal'], IconName> = {
  MIN: 'constraint-left',
  CENTER: 'constraint-center',
  MAX: 'constraint-right',
  STRETCH: 'constraint-stretch',
  SCALE: 'constraint-scale',
};

const CONSTRAINT_OPTIONS_HORIZONTAL = CONSTRAINT_TYPES.map((type) => ({
  value: type,
  label: constraintLabel(type),
  icon: CONSTRAINT_GLYPHS[type],
}));

const CONSTRAINT_OPTIONS_VERTICAL = CONSTRAINT_TYPES.map((type) => ({
  value: type,
  label: constraintLabel(type).replace('Left / Top', 'Top').replace('Right / Bottom', 'Bottom'),
  icon:
    type === 'MIN'
      ? ('constraint-top' as IconName)
      : type === 'CENTER'
        ? ('constraint-middle' as IconName)
        : type === 'MAX'
          ? ('constraint-bottom' as IconName)
          : CONSTRAINT_GLYPHS[type],
}));

/** How children follow a resize, plus the layout grids drawn over a frame. */
function ConstraintsSection({ node }: { node: SceneNode }) {
  const updateSelected = useEditor((state) => state.updateSelected);
  const addLayoutGrid = useEditor((state) => state.addLayoutGrid);
  const updateLayoutGrid = useEditor((state) => state.updateLayoutGrid);
  const removeLayoutGrid = useEditor((state) => state.removeLayoutGrid);
  const constraints: Constraints = node.constraints ?? { horizontal: 'MIN', vertical: 'MIN' };
  const grids: LayoutGrid[] = hasChildren(node) ? (node.layoutGrids ?? []) : [];

  return (
    <div className="section">
      <div className="section__header">
        <span>Constraints</span>
      </div>
      <div className="section__body">
        {/* One axis per row: side by side the labels and the five segments
            could not both fit in a 240px panel. */}
        <Segmented
          label="Horizontal"
          value={constraints.horizontal}
          options={CONSTRAINT_OPTIONS_HORIZONTAL}
          onChange={(value) => updateSelected({ constraints: { ...constraints, horizontal: value } }, 'Set horizontal constraint')}
        />
        <Segmented
          label="Vertical"
          value={constraints.vertical}
          options={CONSTRAINT_OPTIONS_VERTICAL}
          onChange={(value) => updateSelected({ constraints: { ...constraints, vertical: value } }, 'Set vertical constraint')}
        />
        {hasChildren(node) ? (
          <>
            {grids.map((grid, index) => (
              <div key={`${grid.pattern}-${index}`} className="prop-row" style={{ flexWrap: 'wrap' }}>
                <span className="prop-row__label" style={{ minWidth: 60 }}>
                  {grid.pattern.toLowerCase()}
                </span>
                {grid.pattern !== 'GRID' ? (
                  <>
                    <NumberField
                      label={`${grid.pattern} count`}
                      value={grid.count ?? 1}
                      min={1}
                      onCommit={(count) => updateLayoutGrid(index, { count })}
                    />
                    <NumberField
                      label={`${grid.pattern} gutter`}
                      value={grid.gutterSize ?? 0}
                      min={0}
                      onCommit={(gutterSize) => updateLayoutGrid(index, { gutterSize })}
                    />
                    <NumberField
                      label={`${grid.pattern} section`}
                      value={grid.sectionSize}
                      min={1}
                      onCommit={(sectionSize) => updateLayoutGrid(index, { sectionSize })}
                    />
                  </>
                ) : (
                  <NumberField
                    label="GRID size"
                    value={grid.sectionSize}
                    min={1}
                    onCommit={(sectionSize) => updateLayoutGrid(index, { sectionSize })}
                  />
                )}
                <button
                  type="button"
                  className="icon-button"
                  data-tooltip="Remove grid"
                  aria-label={`Remove ${grid.pattern} grid`}
                  onClick={() => removeLayoutGrid(index)}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            ))}
            <div className="prop-grid prop-grid--4">
              {(['COLUMNS', 'ROWS', 'GRID'] as const).map((pattern) => (
                <button
                  key={pattern}
                  type="button"
                  className="segmented__option"
                  aria-label={`Add ${pattern} grid`}
                  data-tooltip={`Add ${pattern.toLowerCase()} grid`}
                  onClick={() => addLayoutGrid(pattern)}
                >
                  {pattern === 'COLUMNS' ? 'Cols' : pattern === 'ROWS' ? 'Rows' : 'Grid'}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Effects editor: one row per effect with live controls. */
function EffectsSection({ node }: { node: SceneNode }) {
  const addEffect = useEditor((state) => state.addEffect);
  const updateEffect = useEditor((state) => state.updateEffect);
  const removeEffect = useEditor((state) => state.removeEffect);
  const toggleEffect = useEditor((state) => state.toggleEffect);
  const effects: Effect[] = node.effects ?? [];

  return (
    <div className="section">
      <div className="section__header">
        <span>Effects</span>
      </div>
      <div className="section__body">
        {effects.map((effect, index) => {
          const hidden = effect.visible === false;
          return (
            <div key={`${effect.type}-${index}`} className="prop-row" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                className="icon-button"
                data-tooltip={hidden ? 'Show effect' : 'Hide effect'}
                aria-label={hidden ? 'Show effect' : 'Hide effect'}
                aria-pressed={!hidden}
                onClick={() => toggleEffect(index)}
              >
                <Icon name={hidden ? 'eye-off' : 'eye'} size={13} />
              </button>
              <span className="prop-row__label" style={{ minWidth: 84 }}>
                {effectLabel(effect.type as EffectKind)}
              </span>
              {isShadow(effect) ? (
                <>
                  <input
                    className="input"
                    type="color"
                    aria-label={`${effectLabel(effect.type as EffectKind)} colour`}
                    value={rgbaToHex(effect.color)}
                    style={{ width: 24, padding: 0, border: 'none', background: 'transparent' }}
                    onChange={(event) =>
                      updateEffect(index, { color: { ...hexToRgba(event.target.value), a: effect.color.a ?? 1 } })
                    }
                  />
                  <NumberField label={`${effect.type} X`} value={effect.offset.x} onCommit={(x) => updateEffect(index, { offset: { ...effect.offset, x } })} />
                  <NumberField label={`${effect.type} Y`} value={effect.offset.y} onCommit={(y) => updateEffect(index, { offset: { ...effect.offset, y } })} />
                  <NumberField label={`${effect.type} blur`} value={effect.radius} min={0} onCommit={(radius) => updateEffect(index, { radius })} />
                  <NumberField label={`${effect.type} spread`} value={effect.spread ?? 0} onCommit={(spread) => updateEffect(index, { spread })} />
                </>
              ) : null}
              {isBlur(effect) ? (
                <NumberField label={`${effect.type} radius`} value={effect.radius} min={0} onCommit={(radius) => updateEffect(index, { radius })} />
              ) : null}
              <button
                type="button"
                className="icon-button"
                data-tooltip="Remove effect"
                aria-label={`Remove ${effectLabel(effect.type as EffectKind)}`}
                onClick={() => removeEffect(index)}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          );
        })}
        <div className="prop-grid prop-grid--4">
          {EFFECT_TYPES.map((kind) => (
            <button
              key={kind}
              type="button"
              className="segmented__option"
              data-tooltip={`Add ${effectLabel(kind)}`}
              aria-label={`Add ${effectLabel(kind)}`}
              onClick={() => addEffect(kind)}
            >
              {effectLabel(kind).replace(' shadow', '').replace(' blur', '')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const ALIGN_OPTIONS: Array<{ value: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'; label: string }> = [
  { value: 'MIN', label: 'Start' },
  { value: 'CENTER', label: 'Center' },
  { value: 'MAX', label: 'End' },
  { value: 'SPACE_BETWEEN', label: 'Space' },
];

const COUNTER_ALIGN_OPTIONS: Array<{ value: 'MIN' | 'CENTER' | 'MAX'; label: string }> = [
  { value: 'MIN', label: 'Start' },
  { value: 'CENTER', label: 'Center' },
  { value: 'MAX', label: 'End' },
];

const SIZING_OPTIONS: Array<{ value: 'FIXED' | 'AUTO'; label: string }> = [
  { value: 'FIXED', label: 'Fixed' },
  { value: 'AUTO', label: 'Hug' },
];

/**
 * Grid track editor: one row per column and per row, each a fixed size or an
 * `fr` share, plus the two gaps. This is Figma's `gridColumns`/`gridRows`, and it
 * is deliberately its own control — the Constraints section's layout GUIDES draw
 * over a frame without moving anything.
 */
function GridTracks({ layout, onChange }: { layout: AutoLayout; onChange: (patch: Partial<AutoLayout>) => void }) {
  const track = (list: GridTrackSize[] | undefined, index: number): GridTrackSize => list?.[index] ?? { type: 'FLEX', value: 1 };
  const edit = (key: 'gridColumns' | 'gridRows', list: GridTrackSize[] | undefined, index: number, patch: Partial<GridTrackSize>) => {
    const next = [...(list ?? [])];
    while (next.length <= index) next.push({ type: 'FLEX', value: 1 });
    next[index] = { ...next[index]!, ...patch };
    onChange({ [key]: next });
  };
  const remove = (key: 'gridColumns' | 'gridRows', list: GridTrackSize[] | undefined, index: number) => {
    const next = [...(list ?? [])];
    next.splice(index, 1);
    onChange({ [key]: next.length > 0 ? next : undefined });
  };
  const rows: Array<{ key: 'gridColumns' | 'gridRows'; label: string; gapKey: 'gridColumnGap' | 'gridRowGap'; gapLabel: string }> = [
    { key: 'gridColumns', label: 'Columns', gapKey: 'gridColumnGap', gapLabel: 'Column gap' },
    { key: 'gridRows', label: 'Rows', gapKey: 'gridRowGap', gapLabel: 'Row gap' },
  ];
  return (
    <div className="prop-stack" data-testid="grid-tracks">
      {rows.map(({ key, label, gapKey, gapLabel }) => {
        const list = layout[key];
        const count = Math.max(1, list?.length ?? 1);
        return (
          <div key={key}>
            <div className="prop-row">
              <span className="prop-row__label">{label}</span>
              <span className="prop-row__value">{count}</span>
              <button
                type="button"
                className="icon-button"
                data-tooltip={`Add a ${label.toLowerCase().replace(/s$/, '')} track`}
                aria-label={`Add ${label.toLowerCase().replace(/s$/, '')} track`}
                onClick={() => onChange({ [key]: [...(list ?? [{ type: 'FLEX' as const, value: 1 }]), { type: 'FLEX' as const, value: 1 }] })}
              >
                <Icon name="plus" size={12} />
              </button>
            </div>
            {Array.from({ length: count }, (_, index) => {
              const value = track(list, index);
              return (
                <div className="prop-row" key={`${key}-${index}`}>
                  <button
                    type="button"
                    className="segmented__option"
                    aria-label={`${label} track ${index + 1} sizing`}
                    data-tooltip={value.type === 'FIXED' ? 'Fixed size — click for a fraction' : 'Fraction of the space — click for a fixed size'}
                    onClick={() => edit(key, list, index, { type: value.type === 'FIXED' ? 'FLEX' : 'FIXED' })}
                  >
                    {value.type === 'FIXED' ? 'px' : 'fr'}
                  </button>
                  <NumberField
                    label={`${label} track ${index + 1}`}
                    value={value.value}
                    min={value.type === 'FIXED' ? 0 : 1}
                    onCommit={(next) => edit(key, list, index, { value: next })}
                  />
                  {count > 1 ? (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${label.toLowerCase().replace(/s$/, '')} track ${index + 1}`}
                      onClick={() => remove(key, list, index)}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  ) : null}
                </div>
              );
            })}
            <NumberField label={gapLabel} value={layout[gapKey] ?? 0} min={0} onCommit={(next) => onChange({ [gapKey]: next })} />
          </div>
        );
      })}
    </div>
  );
}

/** Real auto-layout controls; every change reflows the frame immediately. */
function AutoLayoutSection({ node }: { node: SceneNode }) {
  const setAutoLayout = useEditor((state) => state.setAutoLayout);
  const clearAutoLayout = useEditor((state) => state.clearAutoLayout);
  if (!hasChildren(node)) return null;
  const layout = node.autoLayout ?? { layoutMode: 'NONE' as const };
  const active = layout.layoutMode !== 'NONE';

  return (
    <div className="section">
      <div className="section__header">
        <span>Auto layout</span>
      </div>
      <div className="section__body">
        <Segmented
          label="Direction"
          value={layout.layoutMode}
          options={[
            { value: 'NONE', label: 'None' },
            { value: 'HORIZONTAL', label: 'Row' },
            { value: 'VERTICAL', label: 'Column' },
            { value: 'GRID', label: 'Grid' },
          ]}
          onChange={(value) =>
            value === 'NONE'
              ? clearAutoLayout()
              : setAutoLayout({ ...defaultAutoLayout(value), ...layout, layoutMode: value })
          }
        />
        {layout.layoutMode === 'GRID' ? (
          // Grid TRACKS, not the layout GUIDES in the Constraints section: this
          // decides where children go, a guide is only drawn over them.
          <GridTracks layout={layout} onChange={setAutoLayout} />
        ) : null}
        {active && layout.layoutMode !== 'GRID' ? (
          <>
            <div className="prop-stack">
              <NumberField
                label="Gap"
                value={layout.itemSpacing ?? 0}
                min={0}
                onCommit={(value) => setAutoLayout({ itemSpacing: value })}
              />
              <Segmented
                label="Alignment"
                value={layout.primaryAxisAlignItems ?? 'MIN'}
                options={ALIGN_OPTIONS}
                onChange={(value) => setAutoLayout({ primaryAxisAlignItems: value })}
              />
            </div>
            <div className="prop-stack">
              <Segmented
                label="Counter align"
                value={layout.counterAxisAlignItems ?? 'MIN'}
                options={COUNTER_ALIGN_OPTIONS}
                onChange={(value) => setAutoLayout({ counterAxisAlignItems: value })}
              />
              <Segmented
                label="Width"
                value={layout.primaryAxisSizingMode === 'FIXED' ? 'FIXED' : 'AUTO'}
                options={SIZING_OPTIONS}
                onChange={(value) =>
                  setAutoLayout(
                    layout.layoutMode === 'HORIZONTAL'
                      ? { primaryAxisSizingMode: value }
                      : { counterAxisSizingMode: value },
                  )
                }
              />
            </div>
            <div className="prop-stack">
              <Segmented
                label="Height"
                value={layout.counterAxisSizingMode === 'FIXED' ? 'FIXED' : 'AUTO'}
                options={SIZING_OPTIONS}
                onChange={(value) =>
                  setAutoLayout(
                    layout.layoutMode === 'HORIZONTAL'
                      ? { counterAxisSizingMode: value }
                      : { primaryAxisSizingMode: value },
                  )
                }
              />
            </div>
            <div className="prop-stack">
              <Segmented
                label="Wrap"
                value={layout.layoutWrap === 'WRAP' ? 'WRAP' : 'NO_WRAP'}
                options={[
                  { value: 'NO_WRAP', label: 'No wrap' },
                  { value: 'WRAP', label: 'Wrap' },
                ]}
                onChange={(value) => setAutoLayout({ layoutWrap: value })}
              />
              {layout.layoutWrap === 'WRAP' ? (
                <NumberField
                  label="Line gap"
                  value={layout.counterAxisSpacing ?? 0}
                  min={0}
                  onCommit={(value) => setAutoLayout({ counterAxisSpacing: value })}
                />
              ) : null}
            </div>
            <div className="prop-grid prop-grid--4">
              <NumberField label="Pad T" value={layout.paddingTop ?? 0} min={0} onCommit={(value) => setAutoLayout({ paddingTop: value })} />
              <NumberField label="Pad R" value={layout.paddingRight ?? 0} min={0} onCommit={(value) => setAutoLayout({ paddingRight: value })} />
              <NumberField label="Pad B" value={layout.paddingBottom ?? 0} min={0} onCommit={(value) => setAutoLayout({ paddingBottom: value })} />
              <NumberField label="Pad L" value={layout.paddingLeft ?? 0} min={0} onCommit={(value) => setAutoLayout({ paddingLeft: value })} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Variants + component properties.
 *
 * For a component set: the variant matrix and its properties. For an instance:
 * a switch per variant property plus BOOLEAN/TEXT/INSTANCE_SWAP controls, all of
 * which propagate to the instance's children through the normal instance sync.
 */
function VariantsSection({ node }: { node: SceneNode }) {
  const file = useEditor((state) => state.file);
  const selection = useEditor((state) => state.selection);
  const createComponentSet = useEditor((state) => state.createComponentSet);
  const setInstanceVariant = useEditor((state) => state.setInstanceVariant);
  const setInstanceProperty = useEditor((state) => state.setInstanceProperty);
  const addComponentProperty = useEditor((state) => state.addComponentProperty);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');

  const isSet = node.type === 'COMPONENT_SET';
  const isComponent = node.type === 'COMPONENT';
  const isInstance = node.type === 'INSTANCE';
  const componentCount = selection.filter((id) => {
    const target = findNode(file.document, id);
    return !!target && target.type === 'COMPONENT';
  }).length;

  if (!isSet && !isComponent && !isInstance) {
    return (
      <div className="section">
        <div className="section__header">
          <span>Variants</span>
        </div>
        <div className="section__body">
          <button type="button" className="button" disabled={componentCount < 2} onClick={createComponentSet}>
            Create component set
          </button>
          <p style={{ margin: '6px 0 0', color: 'var(--figma-text-secondary)' }}>
            {componentCount < 2 ? 'Select two or more components.' : `${componentCount} components selected.`}
          </p>
        </div>
      </div>
    );
  }

  const set: ComponentNode | null = isSet
    ? (node as ComponentNode)
    : isInstance
      ? componentSetOf(file, (node as InstanceNode).componentId)
      : componentSetOf(file, node.id);
  const options = set ? variantOptions(set) : {};
  const definitions = set ? componentPropertiesOf(set) : componentPropertiesOf(node as ComponentNode);
  const values: Record<string, ComponentPropertyValue> = isInstance
    ? resolvedProperties(file, node as InstanceNode)
    : Object.fromEntries(
        Object.entries(definitions).map(([name, definition]) => [name, definition.defaultValue]),
      );
  const currentVariant = isInstance
    ? parseVariantName(findNode(file.document, (node as InstanceNode).componentId)?.name ?? '')
    : parseVariantName(node.name);

  const nonVariant = Object.entries(definitions).filter(([, definition]) => definition.type !== 'VARIANT');

  return (
    <div className="section">
      <div className="section__header">
        <span>{isInstance ? 'Instance properties' : isSet ? 'Variants' : 'Component properties'}</span>
      </div>
      <div className="section__body">
        {componentCount >= 2 ? (
          <button type="button" className="button" onClick={createComponentSet}>
            Create component set
          </button>
        ) : null}
        {isSet ? (
          <p style={{ margin: '0 0 6px', color: 'var(--figma-text-secondary)' }}>
            {variantsOf(node as ComponentNode).map(describeVariant).join('  |  ')}
          </p>
        ) : null}
        {Object.entries(options).map(([property, choices]) => (
          <Segmented
            key={property}
            label={property}
            value={currentVariant[property] ?? choices[0] ?? ''}
            options={choices.map((choice) => ({ value: choice, label: choice }))}
            onChange={(value) => {
              if (isInstance) {
                setInstanceVariant(node.id, property, value);
                return;
              }
              const target = set ? findVariant(set, { ...currentVariant, [property]: value }) : null;
              if (target) useEditor.getState().select([target.id]);
            }}
          />
        ))}
        {nonVariant.map(([name, definition]) => (
          <div key={name} className="prop-row">
            <span className="prop-row__label" style={{ minWidth: 90 }} title={name}>{name}</span>
            {definition.type === 'BOOLEAN' ? (
              <input
                type="checkbox"
                aria-label={name}
                checked={values[name] === true}
                disabled={!isInstance}
                onChange={(event) => setInstanceProperty(node.id, name, event.target.checked)}
              />
            ) : null}
            {definition.type === 'TEXT' ? (
              <input
                className="input"
                aria-label={name}
                value={typeof values[name] === 'string' ? (values[name] as string) : ''}
                disabled={!isInstance}
                onChange={(event) => setInstanceProperty(node.id, name, event.target.value)}
              />
            ) : null}
            {definition.type === 'INSTANCE_SWAP' ? (
              <select
                className="input"
                aria-label={name}
                value={typeof values[name] === 'string' ? (values[name] as string) : ''}
                disabled={!isInstance}
                onChange={(event) => setInstanceProperty(node.id, name, event.target.value)}
              >
                <option value="">None</option>
                {componentLibrary(file).map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                ))}
              </select>
            ) : null}
          </div>
        ))}
        {!isInstance ? (
          <>
            <div className="prop-row">
              <input
                className="input"
                aria-label="New property name"
                placeholder="Property name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
              <input
                className="input"
                aria-label="New property value"
                placeholder="Default"
                value={newValue}
                onChange={(event) => setNewValue(event.target.value)}
              />
            </div>
            <div className="prop-grid prop-grid--4">
              {(['BOOLEAN', 'TEXT', 'INSTANCE_SWAP'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  className="segmented__option"
                  aria-label={`Add ${type.toLowerCase()} property`}
                  data-tooltip={`Add a ${type.toLowerCase()} property`}
                  disabled={newName.trim() === ''}
                  onClick={() => {
                    const fallback: ComponentPropertyValue = type === 'BOOLEAN' ? true : '';
                    addComponentProperty(node.id, type, newName.trim(), newValue.trim() || fallback);
                    setNewName('');
                    setNewValue('');
                  }}
                >
                  +{type.slice(0, 4)}
                </button>
              ))}
            </div>
          </>
        ) : null}
        {isInstance && Object.keys(definitions).length === 0 ? (
          <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>
            The main component has no properties yet.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Dash presets: Figma stores the pattern in stroke-weight units. */
const DASH_PRESETS: Array<{ value: string; label: string; pattern: number[] }> = [
  { value: 'solid', label: 'Solid', pattern: [] },
  { value: 'dashed', label: 'Dashed', pattern: [8, 4] },
  { value: 'dotted', label: 'Dotted', pattern: [2, 4] },
  { value: 'dash-dot', label: 'Dash dot', pattern: [8, 4, 2, 4] },
];

/** Stroke dash pattern: presets plus a free-form pattern. */
function DashRow({ dash, onChange }: { dash: number[]; onChange: (pattern: number[]) => void }) {
  const preset = DASH_PRESETS.find((entry) => entry.pattern.join(',') === dash.join(','))?.value ?? 'custom';
  const [custom, setCustom] = useState(dash.join(' '));
  return (
    <>
      <div className="prop-row">
        <span className="prop-row__label">Dash</span>
        <select
          className="input"
          aria-label="Dash pattern"
          value={preset}
          onChange={(event) => {
            if (event.target.value === 'custom') {
              onChange(custom.split(/[^0-9.]+/).map(Number).filter((value) => Number.isFinite(value) && value > 0));
              return;
            }
            onChange(DASH_PRESETS.find((entry) => entry.value === event.target.value)?.pattern ?? []);
          }}
        >
          {DASH_PRESETS.map((entry) => (
            <option key={entry.value} value={entry.value}>{entry.label}</option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </div>
      {preset === 'custom' ? (
        <div className="prop-row">
          <span className="prop-row__label">Pattern</span>
          <input
            className="input"
            aria-label="Dash values"
            placeholder="8 4"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            onBlur={() => onChange(custom.split(/[^0-9.]+/).map(Number).filter((value) => Number.isFinite(value) && value > 0))}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              onChange(custom.split(/[^0-9.]+/).map(Number).filter((value) => Number.isFinite(value) && value > 0));
            }}
          />
        </div>
      ) : null}
    </>
  );
}

/** Prototype action kinds, in panel order (Figma's list). */
const ACTION_KINDS: Array<{ value: PrototypeActionKind; label: string }> = [
  { value: 'NAVIGATE', label: 'Navigate to' },
  { value: 'OVERLAY', label: 'Open overlay' },
  { value: 'BACK', label: 'Back' },
  { value: 'CLOSE', label: 'Close' },
  { value: 'URL', label: 'Open URL' },
];

/**
 * Union / subtract / intersect / exclude. On two or more shapes the operation
 * creates a boolean layer; with a single boolean layer selected the same buttons
 * switch its operation in place, like Figma's boolean group.
 */
function BooleanSection() {
  const selection = useEditor((state) => state.selection);
  const file = useEditor((state) => state.file);
  const booleanOp = useEditor((state) => state.booleanOp);
  const setBooleanMode = useEditor((state) => state.setBooleanMode);

  const selected = selection.length === 1 ? findNode(file.document, selection[0]!) : null;
  const boolean = selected && selected.type === 'BOOLEAN_OPERATION' ? (selected as ContainerNode) : null;
  const currentMode = boolean?.booleanOperation ?? null;
  const creates = selection.length >= 2;

  return (
    <div className="section">
      <div className="section__header">
        <span>Boolean</span>
        {boolean ? <span style={{ color: 'var(--figma-text-tertiary)' }}>{boolean.children.length} layers</span> : null}
      </div>
      <div className="section__body">
        <div className="prop-grid prop-grid--4">
          {BOOLEAN_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`segmented__option${currentMode === mode ? ' segmented__option--active' : ''}`}
              aria-label={booleanLabel(mode)}
              aria-pressed={currentMode === mode}
              data-tooltip={boolean ? `Switch to ${booleanLabel(mode)}` : `${booleanLabel(mode)} the selection`}
              disabled={!creates && !boolean}
              onClick={() => (boolean ? setBooleanMode(mode) : booleanOp(mode))}
            >
              {booleanLabel(mode)}
            </button>
          ))}
        </div>
        {boolean ? (
          <p style={{ margin: '6px 0 0', color: 'var(--figma-text-secondary)' }}>
            Click another operation to re-run it on this layer.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ComponentSection({ node }: { node: SceneNode }) {
  const state = useEditor();
  const file = useEditor((editor) => editor.file);
  const libraries = useEditor((editor) => editor.libraries);
  const isComponent = node.type === 'COMPONENT' || node.type === 'COMPONENT_SET';
  // A linked instance whose library has moved on: offer the update right where
  // the instance is selected, with the same control the Assets panel shows.
  const stale =
    node.type === 'INSTANCE'
      ? (staleLibraryInstances(file, libraries).find((entry) => entry.instanceId === node.id) ?? null)
      : null;
  return (
    <div className="section">
      <div className="section__header">
        <span>Component</span>
      </div>
      <div className="section__body">
        {isComponent ? (
          <button type="button" className="button" onClick={() => state.insertInstance(node.id)}>
            Insert instance
          </button>
        ) : null}
        {node.type === 'INSTANCE' ? (
          <>
            <p style={{ color: 'var(--figma-text-secondary)', margin: '0 0 6px' }}>
              Instance of {node.name}
            </p>
            <p style={{ color: 'var(--figma-text-secondary)', margin: '0 0 6px' }}>
              {Object.keys(node.overrides ?? {}).length} overridden layer(s)
            </p>
            <button type="button" className="button" onClick={() => state.resetOverrides(node.id)}>
              Reset overrides
            </button>
            <button type="button" className="button" onClick={() => state.detachInstance(node.id)}>
              Detach instance
            </button>
          </>
        ) : null}
        {!isComponent && node.type !== 'INSTANCE' ? (
          <button type="button" className="button" onClick={() => state.createComponentFromSelection()}>
            Create component
          </button>
        ) : null}
        {stale ? (
          <div data-testid="instance-out-of-date">
            <p style={{ color: 'var(--figma-brand)', margin: '0 0 6px' }}>
              Out of date: v{stale.publishedVersion} → v{stale.currentVersion}
            </p>
            <button
              type="button"
              className="button"
              aria-label="Update instance from library"
              onClick={() => state.updateLibraryInstances(stale.libraryId, stale.instanceId)}
            >
              Update instance
            </button>
            <button
              type="button"
              className="button"
              aria-label="Update all out-of-date instances"
              onClick={() => state.updateLibraryInstances(stale.libraryId)}
            >
              Update all
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function PropertiesPanel() {
  const panelWidth = useEditor((state) => state.panelWidths.right);
  const drawer = useEditor((state) => state.mobileDrawer);
  const setMobileDrawer = useEditor((state) => state.setMobileDrawer);
  const isMobile = useIsMobile();
  const nodes = useEditor((state) => selectedNodes(state));
  const rightTab = useEditor((state) => state.rightTab);
  const setRightTab = useEditor((state) => state.setRightTab);
  const devMode = useEditor((state) => state.devMode);
  const page = useEditor((state) => state.file.document.children.find((child) => child.id === state.pageId));
  const node = nodes[0];

  return (
    <aside
      className={`app__right${isMobile && drawer === 'right' ? ' app__right--open' : ''}`}
      data-drawer={isMobile ? 'right' : undefined}
      data-drawer-state={isMobile ? (drawer === 'right' ? 'open' : 'closed') : undefined}
      aria-hidden={isMobile && drawer !== 'right' ? true : undefined}
      style={isMobile ? undefined : { width: panelWidth }}
    >
      {isMobile ? (
        <div className="drawer__handle">
          <span className="drawer__title">Design</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Close design panel"
            onClick={() => setMobileDrawer(null)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}
      {/* Dev Mode is a workspace: the design and prototype surfaces are hidden,
          because a developer is reading the handoff, not editing the design. */}
      <div className="tabs" data-testid="right-tabs" data-dev-mode={devMode ? 'true' : 'false'}>
        {devMode ? null : (
          <>
            <button
              type="button"
              className={`tab${rightTab === 'design' ? ' tab--active' : ''}`}
              onClick={() => setRightTab('design')}
            >
              Design
            </button>
            <button
              type="button"
              className={`tab${rightTab === 'prototype' ? ' tab--active' : ''}`}
              onClick={() => setRightTab('prototype')}
            >
              Prototype
            </button>
          </>
        )}
        <button
          type="button"
          className={`tab${rightTab === 'inspect' ? ' tab--active' : ''}`}
          onClick={() => setRightTab('inspect')}
        >
          Inspect
        </button>
        {devMode ? (
          <span className="tab tab--dev" data-testid="dev-mode-badge">
            Dev mode
          </span>
        ) : null}
      </div>
      <div className="panel__scroll">
        {devMode || rightTab === 'inspect' ? (
          <InspectPanel />
        ) : rightTab === 'prototype' ? (
          <PrototypeSection node={node ?? null} />
        ) : node ? (
          <>
            {nodes.length > 1 ? (
              <div className="section">
                <div className="section__body">
                  <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>{nodes.length} layers selected</p>
                </div>
              </div>
            ) : null}
            <TransformSection node={node} />
            <AppearanceSection node={node} />
            {node.type === 'TEXT' ? <TextSection node={node} /> : null}
            <BooleanSection />
            <EffectsSection node={node} />
            <ConstraintsSection node={node} />
            <AutoLayoutSection node={node} />
            <SizeLimitsSection node={node} />
            <AlignmentSection />
            <LayoutSection node={node} />
            <VariantsSection node={node} />
            <ComponentSection node={node} />
          </>
        ) : (
          <EmptySelection pageName={page?.name ?? 'Page'} />
        )}
      </div>
    </aside>
  );
}

function EmptySelection({ pageName }: { pageName: string }): ReactNode {
  return (
    <>
      <div className="section">
        <div className="section__header">
          <span>{pageName}</span>
        </div>
        <div className="section__body">
          <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>
            Nothing selected. Pick a layer on the canvas or in the layers list.
          </p>
        </div>
      </div>
      <AlignmentSection />
    </>
  );
}

function PrototypeSection({ node }: { node: SceneNode | null }) {
  const file = useEditor((state) => state.file);
  const pageId = useEditor((state) => state.pageId);
  const selection = useEditor((state) => state.selection);
  const addInteraction = useEditor((state) => state.addInteraction);
  const updateInteraction = useEditor((state) => state.updateInteraction);
  const removeInteraction = useEditor((state) => state.removeInteraction);
  const addFlow = useEditor((state) => state.addFlow);
  const renameFlow = useEditor((state) => state.renameFlow);
  const removeFlow = useEditor((state) => state.removeFlow);
  const setPrototypeStart = useEditor((state) => state.setPrototypeStart);
  const setPresentation = useEditor((state) => state.setPresentation);
  const updateSelected = useEditor((state) => state.updateSelected);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [quickTarget, setQuickTarget] = useState('');
  const [quickKind, setQuickKind] = useState<PrototypeActionKind>('NAVIGATE');
  const [quickSmart, setQuickSmart] = useState(false);
  const [quickDuration, setQuickDuration] = useState(300);
  const [quickUrl, setQuickUrl] = useState('https://');

  const page = file.document.children.find((child) => child.id === pageId);
  const destinations = prototypeDestinations(file, pageId);
  const flows = page ? flowsOf(page) : [];
  const interactions = node ? interactionsOf(node) : [];

  return (
    <>
      <div className="section">
        <div className="section__header">
          <span>Interactions</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Add interaction"
            data-tooltip="Add an interaction"
            disabled={selection.length !== 1}
            onClick={() => node && addInteraction(node.id, destinations[0]?.id)}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
        <div className="section__body">
          {!node ? (
            <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>Select a layer to add prototype links.</p>
          ) : null}
          {node && interactions.length === 0 ? (
            <>
              {/* Quick link: trigger, action kind and target, then one button. */}
              <div className="prop-row">
                <span className="prop-row__label" style={{ minWidth: 60 }}>On click</span>
                <select
                  className="input"
                  aria-label="Action kind"
                  value={quickKind}
                  onChange={(event) => setQuickKind(event.target.value as PrototypeActionKind)}
                >
                  {ACTION_KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value}>{kind.label}</option>
                  ))}
                </select>
              </div>
              {quickKind === 'NAVIGATE' || quickKind === 'OVERLAY' ? (
                <div className="prop-row">
                  <span className="prop-row__label" style={{ minWidth: 60 }}>Target</span>
                  <select
                    className="input"
                    aria-label="Navigate to"
                    value={quickTarget}
                    onChange={(event) => setQuickTarget(event.target.value)}
                  >
                    <option value="">No action</option>
                    {destinations.map((destination) => (
                      <option key={destination.id} value={destination.id}>{destination.name}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              {quickKind === 'NAVIGATE' ? (
                <div className="prop-row">
                  <label className="prop-row__label" style={{ minWidth: 60, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      aria-label="Smart animate 0"
                      checked={quickSmart}
                      onChange={(event) => setQuickSmart(event.target.checked)}
                    />
                    Smart animate
                  </label>
                  {quickSmart ? (
                    <input
                      className="input"
                      type="number"
                      aria-label="Smart animate duration 0"
                      value={quickDuration}
                      onChange={(event) => setQuickDuration(Number(event.target.value) || 0)}
                    />
                  ) : null}
                </div>
              ) : null}
              {quickKind === 'URL' ? (
                <div className="prop-row">
                  <span className="prop-row__label" style={{ minWidth: 60 }}>URL</span>
                  <input
                    className="input"
                    aria-label="Action URL"
                    value={quickUrl}
                    onChange={(event) => setQuickUrl(event.target.value)}
                  />
                </div>
              ) : null}
              <button
                type="button"
                className="button"
                disabled={quickKind === 'NAVIGATE' || quickKind === 'OVERLAY' ? quickTarget === '' : quickKind === 'URL' ? quickUrl.trim() === '' : false}
                onClick={() => {
                  // Smart animate is offered here too, not only after the link
                  // exists: a layer that matches by name animates between frames.
                  addInteraction(
                    node.id,
                    quickTarget,
                    quickKind,
                    quickSmart && quickKind === 'NAVIGATE'
                      ? { type: 'SMART_ANIMATE', duration: quickDuration }
                      : undefined,
                  );
                  setQuickTarget('');
                  setQuickKind('NAVIGATE');
                  setQuickSmart(false);
                }}
              >
                Apply link
              </button>
              <p style={{ margin: '6px 0 0', color: 'var(--figma-text-secondary)' }}>
                No interactions on this layer yet.
              </p>
            </>
          ) : null}
          {node
            ? interactions.map((interaction, index) => {
                const action = interaction.actions[0] ?? { type: 'NODE' as const, destinationId: null };
                return (
                  <div key={`${interaction.trigger.type}-${index}`} style={{ marginBottom: 6 }}>
                    <div className="prop-row">
                      <select
                        className="input"
                        aria-label={`Trigger ${index}`}
                        value={interaction.trigger.type}
                        onChange={(event) =>
                          updateInteraction(node.id, index, { trigger: { type: event.target.value as 'ON_CLICK' } })
                        }
                      >
                        {TRIGGERS.map((trigger) => (
                          <option key={trigger} value={trigger}>{triggerLabel(trigger)}</option>
                        ))}
                      </select>
                      <select
                        className="input"
                        aria-label={`Action ${index}`}
                        value={action.type === 'NODE' ? (action.overlay ? 'OVERLAY' : 'NAVIGATE') : action.type}
                        onChange={(event) => {
                          const value = event.target.value;
                          const next: PrototypeAction =
                            value === 'NAVIGATE'
                              ? { type: 'NODE', destinationId: action.destinationId ?? destinations[0]?.id ?? null, navigation: 'NAVIGATE' }
                              : value === 'OVERLAY'
                                ? { type: 'NODE', destinationId: action.destinationId ?? destinations[0]?.id ?? null, overlay: true, navigation: 'OVERLAY' }
                                : value === 'BACK'
                                  ? { type: 'BACK' }
                                  : value === 'CLOSE'
                                    ? { type: 'CLOSE' }
                                    : { type: 'URL', url: action.url ?? 'https://' };
                          updateInteraction(node.id, index, { actions: [next] });
                        }}
                      >
                        <option value="NAVIGATE">Navigate to</option>
                        <option value="OVERLAY">Open overlay</option>
                        <option value="BACK">Back</option>
                        <option value="CLOSE">Close</option>
                        <option value="URL">Open URL</option>
                      </select>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove interaction ${index}`}
                        data-tooltip="Remove interaction"
                        onClick={() => removeInteraction(node.id, index)}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                    {action.type === 'NODE' ? (
                      <div className="prop-row">
                        <span className="prop-row__label" style={{ minWidth: 60 }}>Target</span>
                        <select
                          className="input"
                          aria-label={`Destination ${index}`}
                          value={action.destinationId ?? ''}
                          onChange={(event) =>
                            updateInteraction(node.id, index, {
                              actions: [{ ...action, destinationId: event.target.value || null }],
                            })
                          }
                        >
                          <option value="">None</option>
                          {destinations.map((destination) => (
                            <option key={destination.id} value={destination.id}>{destination.name}</option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    {action.type === 'NODE' && action.overlay ? (
                      <>
                        <div className="prop-row">
                          <span className="prop-row__label" style={{ minWidth: 60 }}>Position</span>
                          <select
                            className="input"
                            aria-label={`Overlay position ${index}`}
                            value={action.overlayPosition ?? 'CENTER'}
                            onChange={(event) =>
                              updateInteraction(node.id, index, {
                                actions: [{ ...action, overlayPosition: event.target.value as OverlayPosition }],
                              })
                            }
                          >
                            {OVERLAY_POSITIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </div>
                        {(action.overlayPosition ?? 'CENTER') === 'CUSTOM' ? (
                          <div className="prop-grid prop-grid--2">
                            <NumberField
                              label="X"
                              value={action.overlayX ?? 0}
                              onCommit={(value) => updateInteraction(node.id, index, { actions: [{ ...action, overlayX: value }] })}
                            />
                            <NumberField
                              label="Y"
                              value={action.overlayY ?? 0}
                              onCommit={(value) => updateInteraction(node.id, index, { actions: [{ ...action, overlayY: value }] })}
                            />
                          </div>
                        ) : null}
                        <div className="prop-row">
                          <label className="prop-row__label" style={{ minWidth: 60, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              type="checkbox"
                              aria-label={`Dim background ${index}`}
                              checked={action.overlayDim !== false}
                              onChange={(event) =>
                                updateInteraction(node.id, index, { actions: [{ ...action, overlayDim: event.target.checked }] })
                              }
                            />
                            Dim background
                          </label>
                        </div>
                      </>
                    ) : null}
                    {action.type === 'NODE' && !action.overlay ? (
                      <div className="prop-row">
                        <label className="prop-row__label" style={{ minWidth: 60, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="checkbox"
                            aria-label={`Smart animate ${index}`}
                            checked={action.transition?.type === 'SMART_ANIMATE'}
                            onChange={(event) =>
                              updateInteraction(node.id, index, {
                                actions: [
                                  {
                                    ...action,
                                    transition: event.target.checked
                                      ? { type: 'SMART_ANIMATE', duration: action.transition?.duration ?? 300 }
                                      : undefined,
                                  },
                                ],
                              })
                            }
                          />
                          Smart animate
                        </label>
                        {action.transition?.type === 'SMART_ANIMATE' ? (
                          <input
                            className="input"
                            type="number"
                            min={0}
                            step={50}
                            aria-label={`Smart animate duration ${index}`}
                            value={action.transition.duration ?? 300}
                            onChange={(event) =>
                              updateInteraction(node.id, index, {
                                actions: [{ ...action, transition: { type: 'SMART_ANIMATE', duration: Number(event.target.value) || 0 } }],
                              })
                            }
                          />
                        ) : null}
                      </div>
                    ) : null}
                    {action.type === 'URL' ? (
                      <div className="prop-row">
                        <span className="prop-row__label" style={{ minWidth: 60 }}>URL</span>
                        <input
                          className="input"
                          aria-label={`URL ${index}`}
                          value={action.url ?? ''}
                          onChange={(event) => updateInteraction(node.id, index, { actions: [{ type: 'URL', url: event.target.value }] })}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })
            : null}
        </div>
      </div>

      <div className="section">
        <div className="section__header">
          <span>Scroll</span>
        </div>
        <div className="section__body">
          {node && (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' || node.type === 'INSTANCE') ? (
            <div className="prop-row">
              <span className="prop-row__label" style={{ minWidth: 60 }}>Overflow</span>
              <select
                className="input"
                aria-label="Frame scrolling"
                value={(node as SceneNode & { overflowDirection?: string }).overflowDirection ?? 'NONE'}
                onChange={(event) =>
                  updateSelected({ overflowDirection: event.target.value as 'NONE' })
                }
              >
                <option value="NONE">No scrolling</option>
                <option value="HORIZONTAL_SCROLLING">Horizontal</option>
                <option value="VERTICAL_SCROLLING">Vertical</option>
                <option value="HORIZONTAL_AND_VERTICAL_SCROLLING">Both</option>
              </select>
            </div>
          ) : (
            <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>
              Select a frame to let it scroll in presentation mode.
            </p>
          )}
        </div>
      </div>

      <div className="section">
        <div className="section__header">
          <span>Flows</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Add flow"
            data-tooltip="Add a flow starting at the selection"
            disabled={selection.length !== 1}
            onClick={() => selection[0] && addFlow(selection[0])}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
        <div className="section__body">
          {flows.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>No flows on this page yet.</p>
          ) : null}
          {flows.map((flow) => {
            const start = destinations.find((destination) => destination.id === flow.startNodeId);
            return (
              <div key={flow.id} className="prop-row">
                <span className="layer-row__icon">
                  <Icon name="play" size={12} />
                </span>
                {renaming === flow.id ? (
                  <input
                    className="layer-row__rename-input"
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => {
                      renameFlow(flow.id, draft);
                      setRenaming(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        renameFlow(flow.id, draft);
                        setRenaming(null);
                      }
                      if (event.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <span
                    className="layer-row__name"
                    aria-label={`Flow ${flow.name}`}
                    onDoubleClick={() => {
                      setRenaming(flow.id);
                      setDraft(flow.name);
                    }}
                  >
                    {flow.name}
                    {start ? ` → ${start.name}` : ''}
                  </span>
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Present ${flow.name}`}
                  data-tooltip="Present this flow"
                  onClick={() => setPresentation(true, flow.startNodeId)}
                >
                  <Icon name="present" size={13} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove flow ${flow.name}`}
                  data-tooltip="Remove flow"
                  onClick={() => removeFlow(flow.id)}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="section">
        <div className="section__header">
          <span>Presentation</span>
        </div>
        <div className="section__body">
          <div className="prop-row">
            <span className="prop-row__label">Start frame</span>
            <select
              className="input"
              aria-label="Prototype start frame"
              value={page?.prototypeStartNodeId ?? ''}
              onChange={(event) => setPrototypeStart(event.target.value || null)}
            >
              <option value="">None</option>
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>{destination.name}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="button"
            disabled={!page?.prototypeStartNodeId}
            onClick={() => setPresentation(true)}
          >
            Present
          </button>
          {!page?.prototypeStartNodeId ? (
            <p style={{ margin: '6px 0 0', color: 'var(--figma-text-secondary)' }}>Choose a start frame first.</p>
          ) : null}
        </div>
      </div>
    </>
  );
}

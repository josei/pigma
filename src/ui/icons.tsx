/**
 * Pigma icon set — owner: UI shell agent (see docs/UI_CONTRACT.md).
 *
 * 16x16 viewBox, stroke-based, inherits `currentColor`. Every glyph must stay
 * legible at 16px. `pig` is the Pigma brand mark and is the only glyph allowed
 * to carry a hard-coded colour (pink #FF4D8D, per the contract).
 */

export type IconName =
  | 'cursor'
  | 'hand'
  | 'frame'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'code'
  | 'mask'
  | 'line'
  | 'text'
  | 'pen'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'eye'
  | 'eye-off'
  | 'lock'
  | 'unlock'
  | 'plus'
  | 'minus'
  | 'close'
  | 'check'
  | 'duplicate'
  | 'trash'
  | 'copy'
  | 'paste'
  | 'group'
  | 'ungroup'
  | 'component'
  | 'instance'
  | 'align-left'
  | 'align-hcenter'
  | 'align-right'
  | 'align-top'
  | 'align-vcenter'
  | 'align-bottom'
  | 'distribute-h'
  | 'distribute-v'
  | 'flip-h'
  | 'section'
  | 'flip-v'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit'
  | 'play'
  | 'present'
  | 'share'
  | 'link'
  | 'menu'
  | 'file'
  | 'layers'
  | 'assets'
  | 'sliders'
  | 'constraint-left'
  | 'constraint-center'
  | 'constraint-right'
  | 'constraint-top'
  | 'constraint-middle'
  | 'constraint-bottom'
  | 'constraint-stretch'
  | 'constraint-scale'
  | 'tools'
  | 'variables'
  | 'pig';

/** Brand pink for the Pigma mark. */
const BRAND_PINK = '#FF4D8D';

const GLYPHS: Record<IconName, JSX.Element> = {
  // --- tools ---------------------------------------------------------------
  cursor: <path d="M3.5 2.5v10l2.7-2.7 2 3.7 1.8-.9-2-3.6 3.5-.3z" />,
  hand: (
    <path d="M5.5 9.5V6a1 1 0 0 1 2 0v3M7.5 8.5V4.5a1 1 0 0 1 2 0v4M9.5 8.5V5.5a1 1 0 0 1 2 0V11c0 1.9-1.6 3.5-3.5 3.5h-.6C5.5 14.5 4 13 4 11V9.5" />
  ),
  frame: <path d="M4.5 1.5v13M11.5 1.5v13M1.5 4.5h13M1.5 11.5h13" />,
  rect: <rect x="2.5" y="3.5" width="11" height="9" rx="1" />,
  ellipse: <ellipse cx="8" cy="8" rx="5.5" ry="4.5" />,
  // Polygon and star are their own glyphs: the layer list uses them to tell the
  // node types apart, so mapping them onto the ellipse icon would hide the type.
  polygon: <path d="M8 2.2 14 6.6 11.7 13.6H4.3L2 6.6Z" />,
  star: <path d="M8 1.8 9.9 6.2 14.6 6.6 11 9.7 12.1 14.3 8 11.9 3.9 14.3 5 9.7 1.4 6.6 6.1 6.2Z" />,
  code: <path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4" />,
  mask: <path d="M6.5 3.5a4 4 0 1 0 0 8 4 4 0 1 0 0-8ZM9.5 6.5a4 4 0 1 1 0 8 4 4 0 1 1 0-8Z" />,
  line: <path d="M3 13 13 3" />,
  text: <path d="M4 4h8M8 4v8M6.5 12h3" />,
  pen: <path d="M8 1.5 12.5 6.5 8 14.5 3.5 6.5ZM3.5 6.5h9" />,

  // --- chevrons ------------------------------------------------------------
  'chevron-down': <path d="M4 6.5 8 10.5 12 6.5" />,
  'chevron-right': <path d="M6.5 4 10.5 8 6.5 12" />,
  'chevron-left': <path d="M9.5 4 5.5 8 9.5 12" />,

  // --- visibility / lock ---------------------------------------------------
  eye: (
    <>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.75" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.75" />
      <path d="M2.5 2.5 13.5 13.5" />
    </>
  ),
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
  unlock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-.9" />
    </>
  ),

  // --- primitives ----------------------------------------------------------
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  minus: <path d="M3.5 8h9" />,
  close: <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" />,
  check: <path d="M3 8.5 6.5 12 13 4.5" />,

  // --- editing -------------------------------------------------------------
  duplicate: (
    <>
      <rect x="5.5" y="2.5" width="8" height="8" rx="1" />
      <path d="M10.5 10.5v2a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h2" />
    </>
  ),
  trash: (
    <>
      <path d="M2.5 4.5h11" />
      <path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
      <path d="M4 4.5l.8 9a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.8-9" />
    </>
  ),
  copy: (
    <>
      <rect x="2.5" y="2.5" width="8" height="8" rx="1" />
      <path d="M13.5 5.5v7a1 1 0 0 1-1 1h-7" />
    </>
  ),
  paste: (
    <>
      <path d="M6.5 3.5H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1.5" />
      <rect x="6" y="2" width="4" height="3" rx="1" />
    </>
  ),
  group: <path d="M2.5 5.5v-3h3M13.5 5.5v-3h-3M2.5 10.5v3h3M13.5 10.5v3h-3" />,
  ungroup: (
    <>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </>
  ),
  component: (
    <path d="M8 1.5 11 4.5 8 7.5 5 4.5ZM8 8.5 11 11.5 8 14.5 5 11.5ZM1.5 8 4.5 5 7.5 8 4.5 11ZM8.5 8 11.5 5 14.5 8 11.5 11Z" />
  ),
  // Instances use the same motif *outlined* rather than filled, so the two read
  // apart in the layer tree at 14px (Figma does the same).
  instance: (
    <>
      <path d="M8 2.6 10.4 5 8 7.4 5.6 5Z" />
      <path d="M8 8.6 10.4 11 8 13.4 5.6 11Z" />
      <path d="M2.6 8 5 5.6 7.4 8 5 10.4Z" />
      <path d="M8.6 8 11 5.6 13.4 8 11 10.4Z" />
    </>
  ),

  // --- alignment -----------------------------------------------------------
  'align-left': (
    <>
      <path d="M2.5 2v12" />
      <rect x="4.5" y="3.5" width="9" height="3" rx=".5" />
      <rect x="4.5" y="9.5" width="6" height="3" rx=".5" />
    </>
  ),
  'align-hcenter': (
    <>
      <path d="M8 2v12" />
      <rect x="3.5" y="3.5" width="9" height="3" rx=".5" />
      <rect x="5" y="9.5" width="6" height="3" rx=".5" />
    </>
  ),
  'align-right': (
    <>
      <path d="M13.5 2v12" />
      <rect x="2.5" y="3.5" width="9" height="3" rx=".5" />
      <rect x="5.5" y="9.5" width="6" height="3" rx=".5" />
    </>
  ),
  'align-top': (
    <>
      <path d="M2 2.5h12" />
      <rect x="3.5" y="4.5" width="3" height="9" rx=".5" />
      <rect x="9.5" y="4.5" width="3" height="6" rx=".5" />
    </>
  ),
  'align-vcenter': (
    <>
      <path d="M2 8h12" />
      <rect x="3.5" y="3.5" width="3" height="9" rx=".5" />
      <rect x="9.5" y="5" width="3" height="6" rx=".5" />
    </>
  ),
  'align-bottom': (
    <>
      <path d="M2 13.5h12" />
      <rect x="3.5" y="2.5" width="3" height="9" rx=".5" />
      <rect x="9.5" y="5.5" width="3" height="6" rx=".5" />
    </>
  ),
  'distribute-h': (
    <>
      <path d="M2.5 2v12M13.5 2v12" />
      <rect x="5.5" y="5" width="5" height="6" rx=".5" />
    </>
  ),
  'distribute-v': (
    <>
      <path d="M2 2.5h12M2 13.5h12" />
      <rect x="5" y="5.5" width="6" height="5" rx=".5" />
    </>
  ),
  // A section: a dashed frame with a corner label tick (Figma's section mark).
  section: (
    <>
      <path d="M1.5 3.5h13v9h-13z" strokeDasharray="2 1.6" />
      <path d="M1.5 3.5h5" />
      <path d="M4 1.8v3.4" />
    </>
  ),
  'flip-h': (
    <>
      <path d="M8 1.5v13" strokeDasharray="2 2" />
      <path d="M6.5 4.5 2.5 8l4 3.5ZM9.5 4.5 13.5 8l-4 3.5Z" />
    </>
  ),
  'flip-v': (
    <>
      <path d="M1.5 8h13" strokeDasharray="2 2" />
      <path d="M4.5 6.5 8 2.5l3.5 4ZM4.5 9.5 8 13.5l3.5-4Z" />
    </>
  ),

  // --- view ----------------------------------------------------------------
  'zoom-in': (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14M7 5v4M5 7h4" />
    </>
  ),
  'zoom-out': (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14M5 7h4" />
    </>
  ),
  fit: <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />,
  play: <path d="M4.5 2.5 13 8l-8.5 5.5Z" />,
  present: (
    <>
      <rect x="1.5" y="2.5" width="13" height="9" rx="1" />
      <path d="M8 11.5v2M5.5 13.5h5" />
      <path d="M6.5 5.5 10 7l-3.5 1.5Z" />
    </>
  ),
  share: (
    <>
      <path d="M8 1.5v9M5 4.5 8 1.5l3 3" />
      <path d="M3.5 8v5.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8" />
    </>
  ),
  link: (
    <>
      <path d="M6.5 9.5 9.5 6.5" />
      <path d="M7.5 4.5 9 3a2.5 2.5 0 0 1 3.5 3.5L11 8" />
      <path d="M8.5 11.5 7 13a2.5 2.5 0 0 1-3.5-3.5L5 8" />
    </>
  ),
  menu: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />,

  // --- rail tabs -----------------------------------------------------------
  file: (
    <>
      <path d="M4 1.5h5l3.5 3.5v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z" />
      <path d="M9 1.5V5h3.5" />
    </>
  ),
  layers: (
    <>
      <path d="M8 1.5 14 5 8 8.5 2 5Z" />
      <path d="M2 8 8 11.5 14 8" />
      <path d="M2 11 8 14.5 14 11" />
    </>
  ),
  assets: (
    <>
      <rect x="2.5" y="2.5" width="5" height="5" rx="1" />
      <circle cx="11" cy="5" r="2.5" />
      <path d="M5 9.5 7.5 14h-5Z" />
      <rect x="8.5" y="9" width="5" height="5" rx="1" />
    </>
  ),
  tools: (
    <>
      <path d="M2.5 4.5h11M2.5 11.5h11" />
      <circle cx="6" cy="4.5" r="1.75" />
      <circle cx="10" cy="11.5" r="1.75" />
    </>
  ),
  variables: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <circle cx="5.75" cy="5.75" r="1.25" />
      <circle cx="10.25" cy="10.25" r="1.25" />
      <path d="M6.75 6.75 9.25 9.25" />
    </>
  ),

  // --- brand ---------------------------------------------------------------
  'constraint-left': (
    <>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
      <path d="M2.5 2.5v11" />
    </>
  ),
  'constraint-center': (
    <>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
      <path d="M8 2.5v2M8 11.5v2" />
    </>
  ),
  'constraint-right': (
    <>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
      <path d="M13.5 2.5v11" />
    </>
  ),
  'constraint-top': (
    <>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
      <path d="M2.5 2.5h11" />
    </>
  ),
  'constraint-middle': (
    <>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
      <path d="M2.5 8h2M11.5 8h2" />
    </>
  ),
  'constraint-bottom': (
    <>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
      <path d="M2.5 13.5h11" />
    </>
  ),
  'constraint-stretch': (
    <>
      <rect x="5.5" y="4.5" width="5" height="7" rx="1" />
      <path d="M2.5 2.5v11M13.5 2.5v11" />
    </>
  ),
  'constraint-scale': (
    <>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
      <path d="M2.5 2.5 5.5 5.5M13.5 2.5 10.5 5.5M2.5 13.5 5.5 10.5M13.5 13.5 10.5 10.5" />
    </>
  ),
  sliders: <path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h9M6.5 3v3M10 6.5v3M5 10v3" />,
  pig: (
    <>
      <path d="M3.6 4.9 3.2 1.9 6 3.4Z" fill={BRAND_PINK} stroke="none" />
      <path d="M12.4 4.9 12.8 1.9 10 3.4Z" fill={BRAND_PINK} stroke="none" />
      <circle cx="8" cy="8.5" r="4.75" fill={BRAND_PINK} stroke="none" />
      <ellipse cx="8" cy="10.2" rx="2.1" ry="1.5" fill="#fff" stroke="none" />
      <circle cx="7.2" cy="10.2" r=".42" fill={BRAND_PINK} stroke="none" />
      <circle cx="8.8" cy="10.2" r=".42" fill={BRAND_PINK} stroke="none" />
      <circle cx="6.1" cy="7.2" r=".55" fill="#fff" stroke="none" />
      <circle cx="9.9" cy="7.2" r=".55" fill="#fff" stroke="none" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
}

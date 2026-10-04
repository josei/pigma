# Pigma UI contract (frozen)

Owner of `src/styles.css` and `src/ui/icons.tsx`: **UI shell agent**.
Owner of everything else in `src/ui/**`, `src/render/**`, `src/store/**`, `src/model/**`: **editor agent**.

Do not rename classes/tokens below without telling the editor agent; components are written against them.

## Design tokens (Figma UI3 light theme, official values)

```css
:root {
  --figma-bg: #ffffff;
  --figma-bg-secondary: #f5f5f5;
  --figma-bg-tertiary: #e6e6e6;
  --figma-border: #e6e6e6;
  --figma-border-strong: #d9d9d9;
  --figma-text: #000000;
  --figma-text-secondary: rgba(0, 0, 0, 0.5);
  --figma-text-tertiary: rgba(0, 0, 0, 0.3);
  --figma-brand: #0d99ff;
  --figma-brand-hover: #007be5;
  --figma-selected-bg: #e5f4ff;
  --figma-selected-border: #0d99ff;
  --figma-onselected-border: #bde3ff;
  --canvas-bg: #e5e5e5;
  --toolbar-radius: 14px;
  --panel-width: 240px;
  --rail-width: 56px;
}
```

Base font: `Inter, -apple-system, "Segoe UI", sans-serif`, 11px, `-webkit-font-smoothing: antialiased`.
Density: 24px control height, 8px panel padding, 4px row gap, 6px radius on controls.

## Required structure / classes

Layout shell
- `.app`, `.app__rail`, `.app__left`, `.app__canvas`, `.app__right`

Left rail (56px)
- `.rail__logo` (Pigma pig mark), `.rail__button`, `.rail__button--active`

Panels
- `.panel`, `.panel__scroll`
- `.panel-header`, `.panel-header__title`, `.panel-header__subtitle`, `.panel-header__chevron`
- `.section`, `.section__header`, `.section__body`
- `.page-row`, `.page-row--active`, `.page-row__name`

Layers tree
- `.layers`, `.layer-row`, `.layer-row--selected`, `.layer-row--hidden`
- `.layer-row__indent`, `.layer-row__chevron`, `.layer-row__icon`, `.layer-row__name`, `.layer-row__rename-input`, `.layer-row__actions`, `.layer-row__action`

Tabs (right panel)
- `.tabs`, `.tab`, `.tab--active`

Properties
- `.prop-row`, `.prop-row__label`, `.prop-grid`, `.prop-grid--2`, `.prop-grid--4`
- `.input`, `.input--numeric`, `.input--scrub` (drag-to-scrub numeric field)
- `.color-swatch`, `.color-swatch__fill`, `.color-swatch__label`, `.color-swatch--empty`
- `.segmented`, `.segmented__option`, `.segmented__option--active`
- `.align-grid`, `.icon-button`, `.icon-button--active`

Bottom floating toolbar (white, thin gray stroke, subtle shadow, 14px radius)
- `.toolbar`, `.toolbar__group`, `.toolbar__divider`, `.toolbar__button`, `.toolbar__button--active`

Canvas overlays
- `.canvas`, `.canvas__svg`, `.canvas__overlay`, `.canvas__marquee`, `.canvas__hud`
- `.canvas__tooltip` (cursor-following size badge while dragging)
- `.text-editor` (textarea overlaid on a text node while editing)

Menus / modals / toasts
- `.menu`, `.menu__item`, `.menu__item--disabled`, `.menu__separator`, `.menu__shortcut`, `.menu__label`
- `.modal`, `.modal__backdrop`, `.modal__card`, `.modal__title`, `.modal__body`, `.modal__actions`
- `.button`, `.button--primary`, `.button--ghost`, `.button--danger`
- `.toast`, `.toast--error`, `.toast--success`

Presentation mode
- `.present`, `.present__stage`, `.present__frame`, `.present__toolbar`, `.present__hotspot`

Tooltips: `[data-tooltip]` renders a dark rounded bubble on hover/focus via `::after` (`content: attr(data-tooltip)`), 4px offset, no animation delay longer than 400ms. Must not intercept pointer events.

Scrollbars: 8px, thumb `rgba(0,0,0,0.2)`, no track.

## Canvas internals owned by the editor agent

These are rendered by `src/ui/Canvas.tsx` / `src/ui/Rulers.tsx` and styled inline
(no stylesheet dependency), so the UI agent can restyle them later without
breaking markup:

- `.canvas__grid` — pixel-grid SVG layer (pattern-based, behind the scene)
- `.canvas__rulers` — ruler overlay SVG (top/left 20px strips + selection extent)
- `.canvas__guide` — smart-guide lines drawn during a drag (Figma red `#f24822`)

## Icon contract (`src/ui/icons.tsx`)

```tsx
export type IconName =
  | 'cursor' | 'hand' | 'frame' | 'rect' | 'ellipse' | 'line' | 'text' | 'pen'
  | 'chevron-down' | 'chevron-right' | 'chevron-left'
  | 'eye' | 'eye-off' | 'lock' | 'unlock'
  | 'plus' | 'minus' | 'close' | 'check'
  | 'duplicate' | 'trash' | 'copy' | 'paste' | 'group' | 'ungroup' | 'component'
  | 'align-left' | 'align-hcenter' | 'align-right' | 'align-top' | 'align-vcenter' | 'align-bottom'
  | 'distribute-h' | 'distribute-v' | 'flip-h' | 'flip-v'
  | 'zoom-in' | 'zoom-out' | 'fit' | 'play' | 'present' | 'share' | 'link' | 'menu'
  | 'file' | 'layers' | 'assets' | 'tools' | 'variables' | 'pig';

export function Icon(props: { name: IconName; size?: number; className?: string }): JSX.Element;
```

- 16x16 viewBox, `stroke="currentColor"`, `strokeWidth={1}`, `fill="none"`, `strokeLinecap="round"`, `strokeLinejoin="round"`.
- Icons must be legible at 16px and inherit color (no hard-coded colors).
- `pig` is the Pigma brand mark (may be filled, pink `#FF4D8D`), used at 20px in `.rail__logo`.

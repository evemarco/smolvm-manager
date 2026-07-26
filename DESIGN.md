# SmolVM Manager Design System

## 1. Atmosphere & Identity

A dense, quiet operations console. Dark slate surfaces keep infrastructure data legible, while cyan marks the single interactive accent and machine state colors remain semantic.

## 2. Color

| Role                | Existing token family         | Usage                            |
| ------------------- | ----------------------------- | -------------------------------- |
| Primary surface     | `slate-950`                   | Page and terminal backgrounds    |
| Secondary surface   | `slate-900`                   | Cards and panels                 |
| Interactive surface | `slate-800` / `slate-700`     | Secondary controls and hover     |
| Primary text        | `white` / `slate-200`         | Headings and log output          |
| Secondary text      | `slate-400` / `slate-500`     | Labels and metadata              |
| Accent              | `cyan-500` / `cyan-400`       | Primary actions, links, focus    |
| Success             | `emerald-500` / `emerald-300` | Running and connected states     |
| Warning             | `amber-500` / `amber-300`     | Paused, offline, degraded states |
| Error               | `red-500` / `red-300`         | Failed operations                |

No decorative accent is introduced outside this palette.

## 3. Typography

- Primary: Inter with the existing system fallback stack.
- Mono: the browser monospace stack for logs, terminal output, identifiers, and payloads.
- Page title: `text-2xl` to `text-3xl`, semibold.
- Section title: `text-lg` to `text-xl`, medium or semibold.
- Body: `text-sm`; metadata and log output may use `text-xs`.

## 4. Spacing & Layout

- Base unit: 4px through Tailwind's spacing scale.
- Main content widths: `max-w-7xl` for dashboards, `max-w-5xl` for focused operational pages.
- Page gutters: `px-4`, `sm:px-6`, `lg:px-10`.
- Operational sections use vertical stacks with `gap-4` or `gap-6`.
- Long logs own their scroll region and must wrap or scroll without widening primary content.

## 5. Components

### Operational panel

- Structure: heading, concise description, optional controls, bounded content body.
- States: loading, empty, populated, error.
- Surface: `slate-900` with a subtle white border.
- Accessibility: semantic heading, visible focus, keyboard-reachable controls.

### Action button

- Variants: primary cyan, secondary slate, destructive red.
- States: default, hover, active, focus, disabled/loading.
- Labels remain one line and pair with the existing Lucide icon family.

### Log output

- Structure: semantic list or `pre`, timestamp/source metadata, message, optional details.
- Mono text, bounded horizontal overflow, long unbroken strings remain contained.
- Error entries use red only for status emphasis, not for the whole payload.

### Status badge

- Semantic emerald, amber, red, or neutral slate variants.
- Text always accompanies color.

## 6. Motion & Interaction

- Motion is limited to meaningful hover, active, loading, and panel-state feedback.
- Existing transitions use short Tailwind defaults and only opacity or transform where animated.
- `prefers-reduced-motion` disables nonessential motion globally.

## 7. Depth & Surface

Mixed strategy: subtle borders define routine panels; shadows are reserved for overlays and modal elevation. Backdrop blur is limited to navigation and modal scrims.

## 8. Accessibility Constraints & Accepted Debt

- Target WCAG 2.2 AA with visible focus and complete keyboard navigation.
- Status never relies on color alone.
- Diagnostic payloads use `overflow-wrap` or bounded scrolling at 375px.
- Accepted debt: the extracted legacy palette remains expressed through Tailwind utility families rather than dedicated CSS custom properties.

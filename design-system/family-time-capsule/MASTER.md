# Family Time Capsule design system

> The local design search returned an unrelated marketing-page pattern twice. This
> project-specific fallback therefore follows the skill's verified high-priority UX
> rules and the product's existing archival direction instead of that unverified match.

## Product posture

- Private, self-hosted family archive; never present it as an AI SaaS dashboard.
- Photo- and memory-first. AI status is supportive metadata, never the visual hero.
- Warm, quiet, durable, and legible enough for parents and grandparents.
- Mobile-first for capture and review; desktop-efficient for editing, backup, and books.

## Visual language

- Keep the existing warm paper/stone palette and restrained terracotta accent.
- Use semantic CSS variables only; do not introduce raw per-component colors.
- Body text is at least 16px with 1.5 line height. Metadata may be 13–14px, never below 12px.
- Prefer system fonts for offline reliability and long-term self-hosting. Do not add remote font requests.
- Cards separate related memories with borders and subtle shadows; avoid glassmorphism, neon gradients,
  marketing carousels, testimonials, gamification, and decorative dashboards.
- Use one consistent inline SVG icon style. Icons are never the only accessible name.

## Interaction

- Every interactive target is at least 44×44px with at least 8px separation where targets cluster.
- Keyboard focus is always visible and must not be obscured by sticky navigation.
- Hover is an enhancement only; every action works with keyboard and touch.
- State changes show pending, success, error, and retry feedback near the triggering control.
- Motion is optional, under 250ms, and disabled under `prefers-reduced-motion: reduce`.
- Avoid layout-shifting hover transforms and auto-advancing content.

## Responsive layout

- Verify 375px, 768px, 1024px, and 1440px widths.
- No horizontal page scrolling. Tables collapse to labelled cards or remain in a clearly labelled
  horizontally scrollable region with keyboard access.
- Primary mobile navigation has at most five destinations; secondary areas live in an accessible menu.
- Respect `env(safe-area-inset-*)` in standalone PWA mode.
- Lists paginate or use cursor-based “load more”; never send the complete archive to a client component.

## Forms and feedback

- Every field has a persistent visible label; placeholders are examples, not labels.
- Instructions precede controls. Validation errors are tied to fields with `aria-describedby` and
  a concise summary when several fields fail.
- Destructive actions name the exact target, require an explicit confirmation, and explain recovery.
- Uploads expose file-level progress/status, validation failures, duplicate detection, and safe retry.
- Long jobs expose queued/processing/failed/completed states without leaking provider stacks or secrets.

## Archive-specific components

- Original media and derivative/AI content are visually distinct. Originals receive an “original”
  provenance label; AI suggestions receive “AI generated · unconfirmed”.
- Fact, transcript, and story states use both text and shape/icon—not color alone.
- Source tracing is a first-class button or link labelled “View sources”.
- Visibility is shown in plain language near contributions, stories, search results, and share links.
- Empty states explain the safe next action without implying data was lost.

## Accessibility and delivery gates

- WCAG AA text contrast (4.5:1; 3:1 for large text and UI boundaries).
- Semantic landmarks, one page heading, logical heading order, labelled media controls, useful alt text,
  and empty alt text for purely decorative images.
- Full keyboard operation, visible focus, dialog focus trap/restore, and announced async status (`aria-live`).
- Native controls are preferred. Custom widgets require documented keyboard behavior.
- Before release: run the UI skill's pro checklist, Playwright keyboard/accessibility smoke, and responsive
  browser checks at the four canonical widths.

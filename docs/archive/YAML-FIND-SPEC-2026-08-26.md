# YAML Preview Find Spec - 2026-08-26

STATUS: agreed in chat 2026-08-26, built same day.

Ctrl+F find inside Clip Gen's "generated from fields" YAML preview box.

## Behavior

- Trigger: Ctrl+F (or Cmd+F) while the mouse is OVER the preview box, or after clicking
  into it. Ctrl+F anywhere else does nothing. Ctrl+F with the bar already open just
  re-focuses and selects the query.
- The bar floats TOP-RIGHT of the preview box: query input, match count (n/N, 0/0 when
  nothing matches), prev arrow, next arrow, close.
- Enter = next match, Shift+Enter = previous, Esc = close. Prev/next wrap around.
- Case-insensitive, plain text (no regex).
- All matches highlight (dim amber); the current one is solid amber and scrolled into view.
- The query is remembered while the panel lives: reopening the bar restores the last search.
- The preview text is now SELECTABLE (house `.vd-copy` class; body is user-select: none).

## Implementation

- `YamlPreview` component in RenderPanel.tsx wraps the existing `<pre>`; the bar and the
  highlight spans live inside it. Window keydown listener gated by hover ref + focus-within.
- Prev/next glyphs: lucide ChevronUp/ChevronDown, added to the ui/icons.tsx vocabulary
  (chrome actions per that file's rule; no collision - SkipBack/Forward stay transport).
- No schema, main-process, or persistence changes.

# UI cards + cleanup — 2026-09-01

Checklist only. The chat behind it is the design authority — each item gets built
from the user's exact words in that session, not from this list.

## App-wide (vi-dancer)
1. Grey helper text dies everywhere. Tooltips (title) carry the context instead.
2. House dropdown built once in @koan/shared, swapped in for every native select.
   Rounded panel, roomy rows, check on the current pick.
3. Empty gen panels float their citizens (clips / scores / voices / sheets),
   double-click opens one. ＋ new stays. Nothing exists yet = today's message.

## Clip Gen (RenderPanel)
4. Bordered cards, each its own space: Takes, Model, Prompt, Beats. Ref card dropped.
5. Takes card = preview player + take grid. S-B and ⑂ edit cards same size as take
   cards — one grid, one card size.
6. Takes right-click gains "load this take's recipe" — fills the whole form.
7. Model card: row 1 model · via · mode. Row 2 duration · resolution · aspect ·
   audio. Natural widths, no stretching. Lora picker moves in.
8. Prompt card: ref chips float above the prompt — @name + type, tilted, gentle
   float (queue-bubble feel), grouped by type (image / video / audio).
   Double-click a chip opens that ref's editor. Link button stays. Fields fold
   stays (scene · characters · production notes). Generated preview stays.
9. Beats card: beat names on the timeline bigger. Timeline 25% taller. Long field
   labels shrink to one word + tooltip. Beat ref keeps its spot, wears the same
   chip grammar as prompt refs, double-click opens its editor. Beat name field
   compact, not full width.

## Score Gen + Voice Gen
10. Same card split through their own grammar.

## Video Editor + Timeline
11. Cleanup rules only: tooltips, house dropdown, packed widths. No card relayout.

## Image editor
12. Quick sweep so its elements match the new UI. Nothing else touched —
    "pretty much perfect".

## Co-Director
13. Queued chats play one at a time, one message each — never batched into one.

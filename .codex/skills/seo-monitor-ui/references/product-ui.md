# SEO Monitor visual reference

Use this reference when implementing or reviewing a dashboard page in this repository.

## Existing language

- Shell: dark navy sidebar, light gray application background.
- Brand/action color: emerald/green; destructive or ignore actions use red sparingly.
- Surfaces: white with subtle slate/gray borders and light shadows.
- Typography: system sans-serif; strong labels and headings, compact secondary text.
- Components: modest rounded corners, explicit borders, visible hover/focus states.
- Existing shared classes in `app/globals.css`: `btn-primary`, `btn-secondary`, `btn-danger`, `btn-ghost`, `table-th`, `table-td`, `card`, and status badges. Reuse them when they fit; do not force them where a page already has a coherent local pattern.

## Review questions

1. Can a user identify the record and its current state without opening it?
2. Is the most common action obvious, and are dangerous actions visually distinct?
3. Can repetitive work be completed through selection and batch actions?
4. Does each table row remain scannable without unnecessary second lines?
5. Are ignored records removed from the active queue?
6. Are dates unambiguous and scores explainable?
7. Does the detail view add evidence or reasoning rather than duplicate the list?
8. Does the page still work at narrow widths, keyboard-only, browser zoom, and reduced motion?

## Avoid

- Generic SaaS landing-page styling inside the admin dashboard.
- Excessive pill filters, status chips, nested cards, gradients, glass effects, or decorative animations.
- Icon-only actions without an accessible name.
- Redundant tabs whose contents can be handled by a status label, search, or history view.
- Treating `0`, `—`, `未找到`, and `下降` as interchangeable states.

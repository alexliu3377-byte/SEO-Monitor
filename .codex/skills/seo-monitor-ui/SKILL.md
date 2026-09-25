---
name: seo-monitor-ui
description: Design, review, or implement UI changes in the 奇心内容发布系统 / SEO Monitor dashboard while preserving its compact data-first visual language and established interaction conventions.
---

# SEO Monitor UI

Use this skill for interface work in this repository. It supplements general UI guidance with decisions already confirmed for this product.

## Start from the product

1. Inspect the existing page and at least one adjacent mature page before changing the design.
2. Reuse the established Next.js, React, Tailwind, navy-sidebar, emerald-accent, white-surface visual language. Improve inconsistency locally; do not introduce a separate design system or redesign unrelated navigation.
3. Identify the user's main decision or action on the page. Put that information first and remove controls that do not help that decision.
4. For broad redesigns or uncertain interaction choices, use the installed `ui-ux-pro-max` skill as design evidence. Project rules here take precedence when generic recommendations conflict.

## Product rules

- This is a working admin system, so favor clarity, density, scanning speed, and predictable controls over decorative whitespace.
- Avoid card-within-card layouts, oversized headings, repeated explanations, and excessive tabs. A filter should exist only when it represents a useful recurring task.
- Hide dismissed or ignored records from normal work queues. Show them only through an explicit history/audit view when one is genuinely required.
- Keep primary actions visually obvious. Use emerald for the constructive primary action, neutral styling for viewing/canceling, and restrained red styling for destructive or ignore actions.
- Preserve semantic HTML, keyboard focus, loading/disabled feedback, useful empty states, and existing reduced-motion behavior.
- Use subtle motion only to explain state changes. Do not add ornamental animation to dense tables or routine navigation.

## Dense data tables

- Lead with the identifying content users are looking for, such as the candidate keyword. Scores and secondary metrics should not occupy the first meaningful column.
- Support row selection, select-all for the current result set, and batch actions when users routinely process multiple records.
- Keep ordinary rows to one visual line where practical. Put secondary detail in columns, tooltips, or the detail view instead of stacking two text rows in every row.
- Keep the action column on the right and use explicit labels such as `查看`, `加入采集`, `已布局`, and `忽略`. Keep action order consistent between the table and detail dialog.
- Desktop rows and buttons may be compact; preserve the project's coarse-pointer 44px touch targets through responsive styles.
- Long text may truncate only when the complete value remains available through a title, tooltip, expansion, or detail view.

## Dates, scores, and evidence

- Use an unambiguous local date format. Prefer `YYYY/MM/DD HH:mm` when time matters and `YYYY/MM/DD` otherwise; avoid bare `09/24` values.
- A displayed score must have a nearby explanation or detail breakdown showing the inputs and calculation. Never present an unexplained number as authoritative.
- Keep M and PC ranking evidence visibly separate. One device's decline must not visually erase or offset the other device's confirmed result.
- Distinguish `下降` from `未找到/超出抓取范围`; absence of evidence is not proof of a decline.

## Detail views

- Match the modal/drawer conventions already used elsewhere: clear title and context, compact summary, evidence below, and actions in a consistent footer.
- The detail view should explain why the record exists and how its status/score was derived, rather than repeat every table cell.
- Support backdrop/close behavior without losing an in-progress mutation, and keep dialog labels accessible.

For concrete visual tokens and review questions, read [references/product-ui.md](references/product-ui.md).

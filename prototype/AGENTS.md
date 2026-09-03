# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## SpeechOptimizer Design Context

- Primary visual source: `design-reference.png`, selected as direction 1 on 2026-08-31.
- Secondary reference: `reference-removebgvideo-home.png`, captured from `https://removebgvideo.com/` on 2026-08-31.
- Preserve the light, tool-first workspace and the direct record-or-upload entry point.
- Borrow only the secondary reference's strong upload hierarchy, nearby trust copy, and scan-friendly constraint facts.
- Do not copy its affiliate banner, dark purple marketing hero, long SEO page, or promotional navigation into the product workspace.
- Keep objective speech evidence and actionable next-take cues ahead of broad scores or personality claims.
- Selected product direction: transcript-first evidence workspace (visual option 2), confirmed 2026-09-03.
- Keep the existing product name `SpeechOptimizer`; do not replace it with `speech..`.
- Do not assume a production domain. Before launch, choose a short SEO keyword and a closely matched domain while retaining `SpeechOptimizer` as the product name.

# Decisions and assumptions

- The required `FORCE_Dashboard_PRD.docx` was not present in `D:\fedfront` or `C:\Users\Admin\.codex\attachments`; the supplied frontend spec is the behavior source until the PRD becomes available.
- Use `Screenshot 2026-11-15 144608.png` as the Intelligent Dashboard reference because the requested `design/reference.png` path is absent.
- Use “Flooring Optimised for Renewable Clean Energy” as the configurable brand expansion, matching the provided reference. Keep it in one exported constant.
- Use Inter via `next/font`; no original font or logo file was supplied.
- Mock values are fixture data supplied by `createMockEngine`; UI formatting is allowed, calculations are not.
- Overview cards show the direct yesterday value from `getTodayVsYesterday()` without deriving a percent or trend arrow; the contract does not provide precomputed change values and UI calculations are forbidden.
- Keep the Real engine option explicit, but render an integration notice until the data-layer `createDashboardEngine()` module exists.

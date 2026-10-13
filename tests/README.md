Run the regression checks with Node.js 22 or later:

```powershell
node tests/run-tests.cjs
node tests/browser-smoke.cjs
node tests/access.test.mjs
node tests/corporate-browser.cjs
```

The browser checks use Microsoft Edge in headless mode, a temporary browser profile, and a local HTTP server. They do not read or change your normal browser's Staff Planner data. Set `EDGE_PATH` to another Chromium executable if needed. Screenshots are written to the temporary directory printed at the end.

The checks cover encrypted persistence, staff retention, paused rows and hidden workdays, extra tasks, automatic scheduling, renaming, backups, full day copies, undo/redo, templates, mobile layout, password changes, production autosave (validation, failures, typing during saves, and date changes), every page, and offline navigation. Corporate browser checks use a mock API, including production autosave. No packages or build step are required for these tests.

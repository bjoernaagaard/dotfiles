# pi-parseview

A consolidated [Pi](https://github.com/earendil-works/pi-mono) package for local documents, diagrams, and rendered previews. It targets the **Pi 0.80.8 extension API**.

## Capabilities

1. **Parse documents once** into an integrity-checked local cache.
2. **Retrieve bounded evidence** with page/line reads, spatial search, and selected-page screenshots.
3. **Render Mermaid diagrams** as inline ASCII, SVG, or HTML.
4. **Preview content** as HTML, PNG, or PDF.

### LLM-callable tools

| Tool                  | Purpose                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| `parse_document`      | Parse a local document and return bounded content plus a reusable `documentId` |
| `query_document`      | Read bounded page/line windows or search a cached document                     |
| `screenshot_document` | Render selected cached pages to PNG, optionally returning inline images        |
| `render_diagram`      | Canonical Mermaid renderer for ASCII, SVG, or HTML; supports an explicit path  |
| `preview_content`     | Render Markdown, LaTeX, or code as HTML, PNG, or PDF                           |

These tools are registered at startup but activated lazily from explicit intent. Document query and screenshot tools are loaded additively after a successful parse, preserving tools owned by Pi and other extensions. Deferred tools rely on their descriptions and the focused temporary intent guidance rather than active-only prompt metadata.

`mermaid` remains registered but inactive as a compatibility alias for stored calls. New model-visible guidance and normal activation expose only `render_diagram`.

### Commands

| Command                                         | Purpose                                                  |
| ----------------------------------------------- | -------------------------------------------------------- |
| `/parse <path> [--pages N-M] [--no-ocr]`        | Compatibility command for document parsing               |
| `/parseview-doctor`                             | Diagnose LiteParse, converters, OCR, cache, and Chromium |
| `/parseview-cache [status\|clear]`              | Inspect or clear the document cache                      |
| `/diagram [--svg\|--html] <code>`               | Render Mermaid                                           |
| `/preview [--browser\|--pdf] <content-or-file>` | Render content                                           |
| `/preview-browser <content-or-file>`            | Open an HTML preview                                     |
| `/preview-pdf <content-or-file>`                | Export and open a PDF                                    |
| `/preview-clear-cache`                          | Clear only preview artifacts                             |

## Footer status

ParseView publishes one small `parseview` status segment with parser and browser availability via `ctx.ui.setStatus`. It never replaces Pi's footer, and optional consumers such as `pi-statusline` pick it up automatically; without one, Pi's built-in footer still displays it.

## Document workflow

Use `parse_document` once, then reuse its `documentId`:

1. `parse_document({ path, ocrMode: "auto" })`
2. `query_document({ action: "search", documentId, phrase })`
3. `query_document({ action: "read", documentId, page })`
4. Call `screenshot_document` only when layout, a chart, or a table needs visual inspection.

Use `ocrMode: "auto"` when composition is uncertain, `"on"` for scans, and `"off"` for known born-digital files. Search first to locate evidence, then request the smallest useful page or line window; follow `continuationStartLine` or the full-output recovery path when a result is bounded. For screenshots, select the smallest useful page set and start at 150 DPI. `preview_content` reports an artifact path; browser HTML needs no Chromium, while terminal PNG and PDF do.

The public `parse_document` schema is strict and modern-only. When resuming stored calls, its compatibility preparation maps legacy arguments before validation:

- `pages` maps to `targetPages`.
- `useOcr: true` maps to `ocrMode: "on"`.
- `useOcr: false` maps to `ocrMode: "off"`.
- Modern fields win if both forms are present.
- Legacy fields are removed only when their stored values have the accepted legacy types. Malformed legacy values remain in the prepared call so the strict schema rejects them instead of silently parsing with defaults.
- Existing calls still receive bounded inline output; legacy `file`, `pages`, and `pagesParsed` detail fields are retained.

One leading `@` is normalized from document and output file paths, matching Pi's built-in path tools.

Hard tool failures throw, so Pi records them as failed tool results rather than successful results containing error text.

## Supported local files

| Kind          | Extensions                                                                           | Optional system dependency                             |
| ------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| PDF           | `.pdf`                                                                               | LiteParse native package                               |
| Office text   | `.doc`, `.docx`, `.docm`, `.dot`, `.dotm`, `.dotx`, `.odt`, `.ott`, `.rtf`, `.pages` | LibreOffice                                            |
| Presentations | `.ppt`, `.pptx`, `.pptm`, `.pot`, `.potm`, `.potx`, `.odp`, `.otp`, `.key`           | LibreOffice                                            |
| Spreadsheets  | `.xls`, `.xlsx`, `.xlsm`, `.xlsb`, `.ods`, `.ots`, `.csv`, `.tsv`, `.numbers`        | LibreOffice                                            |
| Images        | `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.tiff`, `.tif`, `.webp`, `.svg`            | ImageMagick; some SVG/PDF conversions need Ghostscript |
| Plain text    | `.txt`, `.md`, `.markdown`, `.log`                                                   | None                                                   |

URLs are rejected. Document inputs must resolve to regular local files within configured size limits.

## Requirements

- Pi **0.80.8**
- Node.js **22.19.0 or newer**
- A platform supported by `@llamaindex/liteparse` 2.6.0
- Chrome, Chromium, Brave, or Edge for PNG/PDF content previews
- Optional converters listed above for non-PDF formats
- Optional Tesseract data or an OCR server for OCR languages/workflows that need them

## Install

From npm:

```bash
pi install npm:@juvio15/pi-parseview
```

From this checkout:

```bash
pi install /absolute/path/to/pi-parseview
# or test without installation
pi -e /absolute/path/to/pi-parseview/index.ts
```

The package ships one extension and ordinary top-level reference documentation in [`REFERENCE.md`](REFERENCE.md). Tool descriptions and focused explicit-intent guidance carry the operational workflow; `/parseview-doctor` and `/parseview-cache` provide dependency and cache recovery.

## Configuration

### Preview and diagram settings

Use Pi settings globally at `~/.pi/agent/settings.json`, or per project at `.pi/settings.json`:

```json
{
  "pi-parseview": {
    "defaultFormat": "browser",
    "fontSize": 16,
    "puppeteerExecutablePath": "/path/to/chrome",
    "diagramDefaultFormat": "ascii",
    "cacheTtl": 300
  }
}
```

`ocrEnabled` from older pi-parseview settings is still tolerated when reading settings, but the consolidated document parser uses `ocrMode` in `parseview.json` instead.

### Document parser settings

The primary file is `~/.pi/agent/parseview.json` (or the active Pi agent directory in rebranded installations):

```json
{
  "ocrMode": "auto",
  "ocrLanguage": "eng",
  "maxInputBytes": 104857600,
  "maxPages": 100,
  "defaultDpi": 150,
  "maxDpi": 300,
  "maxScreenshots": 4,
  "maxOutputBytes": 20480,
  "maxDocumentCacheBytes": 524288000,
  "maxTotalCacheBytes": 5368709120,
  "passwordEnv": "PARSEVIEW_DOCUMENT_PASSWORD",
  "ocrServerHeadersEnv": "PARSEVIEW_OCR_HEADERS"
}
```

If `parseview.json` is absent, the extension reads the standalone extension's legacy `liteparse.json`. `parseview.json` always wins when both exist. Relative paths are resolved from the selected config file.

Secrets are referenced by environment-variable name. Secret values are fingerprinted for cache invalidation but excluded from serialization, tool details, and manifests.

## Caches and safety

- Documents: `~/.pi/agent/cache/parseview/documents`
- Previews: `~/.pi/agent/cache/parseview/previews`

The two clear commands cannot delete each other's data. Both commands ask for confirmation.

The document cache provides:

- source/config/version/secret-fingerprint cache keys
- atomic replacement and SHA-256 artifact validation
- corrupt-entry purging and symlink-safe deletion
- per-document and total quotas with LRU eviction
- source-hash revalidation before screenshots
- bounded tool output using Pi's 50 KB / 2,000-line ceiling for parse, query, screenshot manifests, and inline diagrams
- strictly advancing continuation queries for complete-line truncation, or byte-identical full-output temporary files when safe continuation is impossible (including service-bounded reads and oversized first lines)
- per-file mutation queue coverage for complete explicit preview/diagram output mutation windows

Native LiteParse operations do not accept `AbortSignal`. Pi cancellation is checked before native work, after it completes, and before persistence; native CPU work already in progress cannot be interrupted in-process.

## Pi 0.80.8 compatibility

This package uses a current synchronous extension factory, `ExtensionAPI`, `ExtensionCommandContext`, `StringEnum`, current tool execution/render signatures, UI mode guards, and session cleanup hooks. Document services initialize lazily on first use, so a transient native/configuration failure does not prevent extension registration and can be retried. It does not use SDK session construction, model registry reads, provider authentication, or model catalog APIs, so 0.80.8's `ModelRuntime` breaking changes require no provider/auth migration here.

Core Pi packages are peers and are not bundled into the npm tarball.

## Development

```bash
npm install
npm test
npm run check
npm run lint
npm run pack -- --dry-run
```

Current tests cover dynamic activation and dependency cleanup, registration/reload behavior, strict schema compatibility, path normalization, queued output mutations, config and secret validation, source classification, OCR resolution, parsing/query/screenshots with fakes, cache integrity/quotas/symlink safety, hard failure signaling, output truncation/recovery, renderers, and preview contracts.

## Project structure

```text
pi-parseview/
├── index.ts
├── src/
│   ├── autotrigger/
│   ├── diagram/
│   ├── document/          # parse/query/screenshot service, cache, config, tools
│   ├── mermaid/
│   ├── parser/            # compatibility bridge
│   ├── preview/
│   ├── browser.ts
│   ├── cache.ts           # preview-only cache
│   └── config.ts          # Pi settings
├── REFERENCE.md         # supported inputs, limits, dependencies, cache behavior
└── tests/
```

## License

MIT

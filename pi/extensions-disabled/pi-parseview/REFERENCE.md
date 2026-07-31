# ParseView reference

## Supported local inputs

| Input        | Extensions                                                                 | Additional dependency                                  |
| ------------ | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| PDF          | `pdf`                                                                      | `@llamaindex/liteparse` native package                 |
| Office       | `doc`, `docx`, `docm`, `dot`, `dotm`, `dotx`, `odt`, `ott`, `rtf`, `pages` | LibreOffice                                            |
| Presentation | `ppt`, `pptx`, `pptm`, `pot`, `potm`, `potx`, `odp`, `otp`, `key`          | LibreOffice                                            |
| Spreadsheet  | `xls`, `xlsx`, `xlsm`, `xlsb`, `ods`, `ots`, `csv`, `tsv`, `numbers`       | LibreOffice                                            |
| Image        | `jpg`, `jpeg`, `png`, `gif`, `bmp`, `tiff`, `tif`, `webp`, `svg`           | ImageMagick; some SVG/PDF conversions need Ghostscript |
| Plain text   | `txt`, `md`, `markdown`, `log`                                             | None                                                   |

Inputs must be local regular files. URL inputs are rejected.

## Default document limits

- Input size: `100 MiB`
- Pages per parse: `100`
- DPI: `150` default, `300` maximum
- Screenshots per call: `4`
- Search results: `20`
- Service preview: `20 KiB`
- Document cache: `500 MiB` per document, `5 GiB` total
- Pi inline tool ceiling: `50 KB` or `2,000` lines

Call-level limits may narrow these defaults. Configuration can lower or raise service defaults within validation rules.

When a line read reaches only Pi's complete-line limit, `query_document` returns a strictly advancing `startLine`. When the service byte ceiling cuts a read, or an oversized first line prevents safe advancement, the result instead provides a byte-identical full-output temporary file.

## Configuration and secrets

The primary document configuration is `~/.pi/agent/parseview.json`, or the active Pi agent directory in rebranded installations. Relative paths resolve from the selected configuration file.

When `parseview.json` is absent, ParseView reads legacy `liteparse.json`; `parseview.json` wins when both exist. Legacy `ocrEnabled: true` maps to `ocrMode: "auto"`, and `false` maps to `"off"`.

Optional secret-bearing settings contain environment-variable names rather than values:

- `passwordEnv`: document password
- `ocrServerHeadersEnv`: JSON object of OCR HTTP headers

Secret values contribute a fingerprint to cache invalidation. Serialized configuration, manifests, and tool details contain the fingerprint and environment-variable names, not the values.

Other optional settings include `ocrServerUrl`, `tessdataPath`, `ocrLanguage`, `ocrFailureFatal`, and `ocrHedgeDelaysMs`.

## Cache and diagnostics

Document artifacts default to `~/.pi/agent/cache/parseview/documents`; rendered previews are written to temporary files or explicit output paths.

The document cache uses source, parser version, parse settings, and the secret fingerprint in its key. Writes are atomic; artifact hashes are validated; corrupt entries are purged; total quota uses least-recently-accessed eviction. Screenshots revalidate the source hash before rendering.

- `/parseview-doctor`: native package, converters, OCR, cache, and Chromium diagnostics
- `/parseview-cache status`: document entry count and bytes
- `/parseview-cache clear`: confirmed deletion of document artifacts

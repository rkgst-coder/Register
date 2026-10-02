# vendor/ — third-party libraries served from this site

Register used to load these from cdnjs at runtime, with no integrity check, into the same page that holds the sync token and the unlocked private data. They are now copied here, byte for byte, from the npm packages, so nothing third-party is fetched at runtime.

| File | Package | Licence | npm tarball integrity (from the registry) |
|---|---|---|---|
| pdf-3.11.174.min.js, pdf.worker-3.11.174.min.js | pdfjs-dist 3.11.174 (`build/`) | Apache-2.0 | sha512-TdTZPf1trZ8/UFu5Cx/GXB7GZM30LT+wWUNfsi6Bq8ePLnb+woNKtDymI2mxZYBpMbonNFqKmiz684DIfnd8dA== |
| pdf-lib-1.17.1.min.js | pdf-lib 1.17.1 (`dist/pdf-lib.min.js`) | MIT | sha512-V/mpyJAoTsN4cnP31vc0wfNA1+p20evqqnap0KLoRUN0Yk/p3wN52DOEsL4oBFcLdb76hlpKPtzJIgo67j/XLw== |
| xlsx.full-0.18.5.min.js | xlsx 0.18.5 (`dist/xlsx.full.min.js`) | Apache-2.0 | sha512-dmg3LCjBPHZnQp5/F/+nnTa+miPJxUXB6vtk42YjBBKayDNagxGEeIdWApkYPOf3Z3pm3k62Knjzp7lMeTEtFQ== |

SHA-384 of each file as stored here:

```
pdf-3.11.174.min.js sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e
pdf-lib-1.17.1.min.js sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI
pdf.worker-3.11.174.min.js sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2
xlsx.full-0.18.5.min.js sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw
```

To update one: download the new npm tarball, check it against `npm view <pkg>@<ver> dist.integrity`, copy the file in under a new versioned name, change the URL constant near the top of the document code in `index.html` (`PDFJS_URL`, `PDFJS_WORKER`, `PDFLIB_URL`, `XLSX_URL`), and bump `CACHE` in `sw.js`.

Known: SheetJS 0.18.5 is the last version published to npm. Later fixes (prototype pollution in 0.19.3, ReDoS in 0.20.2 — from memory, please verify) are only on SheetJS's own CDN. The library is only used to read an Excel file you choose to import for Dates, so the exposure is a crafted file you open yourself.

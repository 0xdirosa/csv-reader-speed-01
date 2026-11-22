# csv-reader-speed-01

Fast drop-in for make.fun's csv-reader 1.0.0 (`csv-reader-speed-01-run-20261121`).

`solve.js` exports `run(input)` returning exactly csv-reader 1.0.0's
`{columns, rows, errors}` for every `{text, header}`, including its
broken-row policy (BOM, stray CR, unterminated quotes, quote junk,
short/long rows, multi-line quoted fields). `main.ts` is the kit's
driver: it reads `/input/cases.json` and writes `/output/answers.json`.

Speed: slice/`indexOf`-based parser. Single-line, quote-free records
take a `slice`+`split(',')` fast path; all other records use an
`indexOf`-driven field parser (no per-character string building).
Practice set: 6/6 identical to the reference; 6,092-case differential
fuzz vs the reference: 0 mismatches. Local benchmark (practice set,
Node, `--no-incremental-marking`): ~2.4–2.8x faster than the house
baseline by wall time.

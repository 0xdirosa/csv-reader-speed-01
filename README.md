# csv-reader-speed-01

Fast drop-in for make.fun's csv-reader 1.0.0 (`csv-reader-speed-01-run-20261121`).

`solve.js` exports `run(input)` returning exactly csv-reader 1.0.0's
`{columns, rows, errors}` for every `{text, header}`, including its
broken-row policy (BOM, stray CR, unterminated quotes, quote junk,
short/long rows, multi-line quoted fields). `main.ts` is the kit's
driver: it reads `/input/cases.json` and writes `/output/answers.json`.

Speed: inline single-pass parser, no per-field object allocation.
Single-line, quote-free records take a `slice`+`split(',')` fast path;
quoted records use an `indexOf`-driven inline field parser (rare
stray-CR / unterminated-quote / quote-junk paths are out-of-line).
Practice set: 6/6 identical to the reference; 10,124-case differential
fuzz vs the reference (2 seeds): 0 mismatches. Local benchmark
(practice set, in-process CPU, interleaved reps, Node): median
~103 ms vs house baseline ~658 ms, ~6.4x; v1 was ~171 ms, ~3.8x.

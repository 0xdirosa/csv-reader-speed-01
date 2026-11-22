// Fast drop-in for csv-reader 1.0.0 (make.fun csv-reader-speed-01).
// Semantics are csv-reader's exactly; see vendor reference in the kit.
// Strategy: most records are single-line, quote-free, stray-CR-free.
// Those take a C-speed slice+split fast path. Anything with a quote,
// a stray CR, or a multi-line quoted field falls back to an
// indexOf-driven parser (slice between delimiters, never per-char
// string building on the common path).
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;
  let recordLine = 1;
  let recordRow = null;

  // Unquoted field starting at pos, initial value `value`.
  // Returns {value, ended, added} where ended is 'comma' | 'line break' | 'end'
  // and added counts characters kept after `value` (for quote_junk).
  function readUnquoted(value) {
    let added = 0;
    while (pos < n) {
      const iComma = text.indexOf(',', pos);
      const iLF = text.indexOf('\n', pos);
      let end = n;
      let kind = 0; // 0 end, 1 comma, 2 LF
      if (iComma !== -1 && iComma < end) { end = iComma; kind = 1; }
      if (iLF !== -1 && iLF < end) { end = iLF; kind = 2; }
      // CR, if any, must lie before `end`; check only that segment.
      if (end > pos) {
        const seg = text.slice(pos, end);
        const cr = seg.indexOf('\r');
        if (cr !== -1) {
          const crPos = pos + cr;
          if (text.charCodeAt(crPos + 1) === 10) {
            if (cr > 0) { value += seg.slice(0, cr); added += cr; }
            pos = crPos + 2;
            line++;
            return { value, ended: 'line break', added };
          }
          if (cr > 0) { value += seg.slice(0, cr); added += cr; }
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          pos = crPos + 1;
          continue;
        }
      }
      if (kind === 0) {
        if (end > pos) { value += text.slice(pos, end); added += end - pos; }
        pos = n;
        return { value, ended: 'end', added };
      }
      if (kind === 1) {
        if (end > pos) { value += text.slice(pos, end); added += end - pos; }
        pos = end + 1;
        return { value, ended: 'comma', added };
      }
      if (end > pos) { value += text.slice(pos, end); added += end - pos; }
      pos = end + 1;
      line++;
      return { value, ended: 'line break', added };
    }
    return { value, ended: 'end', added };
  }

  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    while (pos < n) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      if (q > pos) {
        const seg = text.slice(pos, q);
        if (seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1) {
          value += seg;
        } else {
          // Segment holds line breaks: CRLF / lone CR -> LF, LF stays LF.
          let s = 0;
          let outStart = 0;
          while (s < seg.length) {
            const br = seg.indexOf('\r', s);
            const bl = seg.indexOf('\n', s);
            let b = -1;
            let isCR = false;
            if (br !== -1 && (bl === -1 || br < bl)) { b = br; isCR = true; }
            else if (bl !== -1) { b = bl; isCR = false; }
            else break;
            value += seg.slice(outStart, b);
            value += '\n';
            line++;
            if (isCR && seg.charCodeAt(b + 1) === 10) { s = b + 2; outStart = b + 2; }
            else { s = b + 1; outStart = b + 1; }
          }
          if (outStart < seg.length) value += seg.slice(outStart);
        }
      }
      pos = q;
      if (text.charCodeAt(q + 1) === 34) {
        value += '"';
        pos = q + 2;
        continue;
      }
      pos = q + 1;
      // closed
      if (pos >= n) return { value, ended: 'end' };
      const c = text.charCodeAt(pos);
      if (c === 44) { pos += 1; return { value, ended: 'comma' }; }
      if (c === 10) { pos += 1; line += 1; return { value, ended: 'line break' }; }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; return { value, ended: 'line break' }; }
      const junk = readUnquoted(value);
      if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return junk;
    }
    // Ran off the end without a closing quote.
    pos = open + 1;
    line = openLine;
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    return readUnquoted('"');
  }

  while (true) {
    while (pos < n) {
      const ch = text.charCodeAt(pos);
      if (ch === 10) { pos += 1; line += 1; }
      else if (ch === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;
    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: single-line record, no quote, no stray CR.
    const lf = text.indexOf('\n', pos);
    const lineEnd = lf === -1 ? n : lf;
    let contentEnd = lineEnd;
    if (lf !== -1 && contentEnd > pos && text.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1;
    const lineStr = text.slice(pos, contentEnd);
    if (lineStr.indexOf('"') === -1 && lineStr.indexOf('\r') === -1) {
      {
        const fields = lineStr.split(',');
        pos = lf === -1 ? n : lf + 1;
        if (lf !== -1) line += 1;
        if (width < 0) width = fields.length;
        if (header && columns === null) { columns = fields; continue; }
        if (fields.length < width) {
          errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
          while (fields.length < width) fields.push('');
        } else if (fields.length > width) {
          errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
        }
        rows.push(fields);
        continue;
      }
    }

    // Slow path: quoted / stray-CR / multi-line record.
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === 'comma');
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

// v2: inline single-pass parser, no per-field object allocation.
// Rare paths (stray CR, unterminated quote, quote junk, multiline quoted)
// are out-of-line; the common clean field is slice + indexOf only.
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

  // Convert line breaks inside a quoted segment to LF, counting lines.
  // seg: the raw segment; returns converted string.
  function convertBreaks(seg) {
    let out = '';
    let s = 0;
    let outStart = 0;
    while (s < seg.length) {
      const br = seg.indexOf('\r', s);
      const bl = seg.indexOf('\n', s);
      let b = -1; let isCR = false;
      if (br !== -1 && (bl === -1 || br < bl)) { b = br; isCR = true; }
      else if (bl !== -1) { b = bl; }
      else break;
      out += seg.slice(outStart, b);
      out += '\n';
      line++;
      if (isCR && seg.charCodeAt(b + 1) === 10) { s = b + 2; outStart = b + 2; }
      else { s = b + 1; outStart = b + 1; }
    }
    if (outStart < seg.length) out += seg.slice(outStart);
    return out;
  }

  while (true) {
    // Skip blank lines (a line left with no characters is no record).
    while (pos < n) {
      const ch = text.charCodeAt(pos);
      if (ch === 10) { pos += 1; line += 1; }
      else if (ch === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;
    const recordLine = line;
    const recordRow = (header && columns === null) ? null : rows.length;

    // Fast path: single-line record, no quote, no stray CR.
    const lf = text.indexOf('\n', pos);
    const lineEnd = lf === -1 ? n : lf;
    let contentEnd = lineEnd;
    if (lf !== -1 && contentEnd > pos && text.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1;
    const lineStr = text.slice(pos, contentEnd);
    if (lineStr.indexOf('"') === -1 && lineStr.indexOf('\r') === -1) {
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

    // Slow path: record with quotes / stray CR / multiline quoted field.
    const fields = [];
    let ended = 1; // 1 comma (enter loop), 0 end, 2 line break
    let firstField = true;
    let firstQuoted = false;
    while (ended === 1) {
      let value;
      // Field at EOF after a trailing comma: empty field, record ends.
      if (pos >= n) { fields.push(''); ended = 0; break; }
      // --- one field ---
      if (text.charCodeAt(pos) === 34) {
        if (firstField) firstQuoted = true;
        const open = pos;
        const openLine = line;
        value = '';
        pos += 1;
        let closed = false;
        let unterminated = false;
        while (pos < n) {
          const q = text.indexOf('"', pos);
          if (q === -1) { unterminated = true; break; }
          if (q > pos) {
            const seg = text.slice(pos, q);
            if (seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1) value += seg;
            else value += convertBreaks(seg);
          }
          if (text.charCodeAt(q + 1) === 34) { value += '"'; pos = q + 2; continue; }
          pos = q + 1;
          closed = true;
          break;
        }
        if (unterminated || !closed) {
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          pos = open + 1;
          line = openLine;
          value = '"';
          // fall through to unquoted continuation below
        } else {
          // closed: check terminator
          if (pos >= n) { ended = 0; fields.push(value); break; }
          const c = text.charCodeAt(pos);
          if (c === 44) { pos += 1; ended = 1; fields.push(value); continue; }
          if (c === 10) { pos += 1; line += 1; ended = 2; fields.push(value); break; }
          if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; ended = 2; fields.push(value); break; }
          // quote junk: unquoted continuation, track added chars
          const before = value.length;
          // unquoted continuation (inline, rare)
          ended = -1;
          while (pos < n) {
            const iComma = text.indexOf(',', pos);
            const iLF = text.indexOf('\n', pos);
            let end = n; let kind = 0;
            if (iComma !== -1 && iComma < end) { end = iComma; kind = 1; }
            if (iLF !== -1 && iLF < end) { end = iLF; kind = 2; }
            if (end > pos) {
              const seg = text.slice(pos, end);
              const cr = seg.indexOf('\r');
              if (cr !== -1) {
                const crPos = pos + cr;
                if (text.charCodeAt(crPos + 1) === 10) {
                  if (cr > 0) value += seg.slice(0, cr);
                  pos = crPos + 2; line++; ended = 2; break;
                }
                if (cr > 0) value += seg.slice(0, cr);
                errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
                pos = crPos + 1; continue;
              }
              value += seg;
            }
            if (kind === 0) { pos = n; ended = 0; }
            else if (kind === 1) { pos = end + 1; ended = 1; }
            else { pos = end + 1; line++; ended = 2; }
            break;
          }
          if (ended === -1) ended = 0;
          if (value.length > before) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
          fields.push(value);
          if (ended !== 1) break;
          continue;
        }
      }
      // --- unquoted field (value may already be '"' after unterminated) ---
      if (value === undefined) value = '';
      // value holds initial content for the unterminated case; otherwise ''
      ended = -1;
      while (pos < n) {
        const iComma = text.indexOf(',', pos);
        const iLF = text.indexOf('\n', pos);
        let end = n; let kind = 0;
        if (iComma !== -1 && iComma < end) { end = iComma; kind = 1; }
        if (iLF !== -1 && iLF < end) { end = iLF; kind = 2; }
        if (end > pos) {
          const seg = text.slice(pos, end);
          const cr = seg.indexOf('\r');
          if (cr !== -1) {
            const crPos = pos + cr;
            if (text.charCodeAt(crPos + 1) === 10) {
              if (cr > 0) value += seg.slice(0, cr);
              pos = crPos + 2; line++; ended = 2; break;
            }
            if (cr > 0) value += seg.slice(0, cr);
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            pos = crPos + 1; continue;
          }
          value += seg;
        }
        if (kind === 0) { pos = n; ended = 0; }
        else if (kind === 1) { pos = end + 1; ended = 1; }
        else { pos = end + 1; line++; ended = 2; }
        break;
      }
      if (ended === -1) ended = 0;
      fields.push(value);
      firstField = false;
    }
    if (fields.length === 1 && fields[0] === '' && !firstQuoted) continue;
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

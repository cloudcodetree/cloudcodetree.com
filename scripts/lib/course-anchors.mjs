// Named regions in companion source files, marked by comment lines:
//
//   # ANCHOR: product
//   class Product(BaseModel): ...
//   # ANCHOR_END: product
//
// The leader may be #, //, --, <!-- or /*. A name is unique in its file, regions
// may nest, and marker lines never appear in extracted text. Shared by the sync
// script (which reads companion files) and the remark plugin's tests.

export const ANCHOR_RE = /^\s*(#|\/\/|--|<!--|\/\*)\s*ANCHOR(_END)?:\s*([a-z0-9-]+)/;

export class CourseAnchorError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CourseAnchorError';
  }
}

/** Every anchor in the file as name -> {start, end} (1-based marker lines). Validates the whole file. */
export function listAnchors(text, where) {
  const anchors = new Map();
  const open = new Map();
  const problems = [];
  text.split('\n').forEach((line, i) => {
    const m = ANCHOR_RE.exec(line);
    if (!m) return;
    const [, , end, name] = m;
    const n = i + 1;
    if (!end) {
      if (anchors.has(name) || open.has(name)) problems.push(`${where}:${n} duplicate anchor '${name}'`);
      else open.set(name, n);
    } else if (!open.has(name)) {
      problems.push(`${where}:${n} ANCHOR_END '${name}' has no ANCHOR`);
    } else {
      anchors.set(name, { start: open.get(name), end: n });
      open.delete(name);
    }
  });
  for (const [name, n] of open) problems.push(`${where}:${n} ANCHOR '${name}' is never closed`);
  if (problems.length) throw new CourseAnchorError(problems.join('\n'));
  return anchors;
}

function dedent(lines) {
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)[0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut));
}

/** The text of one anchor (or the whole file when name is null), marker lines stripped, dedented. */
export function extractAnchor(text, name, where) {
  const anchors = listAnchors(text, where);
  let lines = text.split('\n');
  if (name !== null) {
    const region = anchors.get(name);
    if (!region) throw new CourseAnchorError(`${where} has no anchor '${name}'`);
    lines = lines.slice(region.start, region.end - 1);
  }
  lines = dedent(lines.filter((l) => !ANCHOR_RE.test(l)));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return lines.join('\n');
}

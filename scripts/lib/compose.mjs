/**
 * n8n Code nodes can't import local files, so the logic lives in n8n/src/*.js
 * (unit-tested) and is inlined into each Code node at build time. To keep
 * each node readable, only the top-level declarations a node actually uses
 * (and what those use, transitively) are included.
 *
 * Tests load the same composed code through loadAll(), so what is tested is
 * exactly what runs in n8n.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../n8n/src");

export const MODULES = ["shared", "response", "royalty-facts", "prompt", "guardrails", "render-email", "validate-request", "nodes"];

const DECL = /^(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|class\s+)([A-Za-z_$][\w$]*)/;

/** Splits a module into top-level declarations, each with its leading comment. */
function parseModule(name) {
  const lines = readFileSync(path.join(SRC_DIR, `${name}.js`), "utf8").replace(/\r\n/g, "\n").split("\n");
  const starts = [];
  lines.forEach((line, i) => {
    const m = line.match(DECL);
    if (m) starts.push({ index: i, name: m[1] });
  });
  return starts.map((start, k) => {
    // Pull the comment block directly above the declaration into this chunk.
    let from = start.index;
    while (from > 0 && /^(\s*\*|\s*\/\*\*|\s*\/\/)/.test(lines[from - 1])) from--;
    const prevEnd = k > 0 ? starts[k - 1].index : -1;
    if (from <= prevEnd) from = start.index;
    let to = k + 1 < starts.length ? starts[k + 1].index : lines.length;
    // Leave the next declaration's leading comment to it.
    while (to - 1 > start.index && /^(\s*\*|\s*\/\*\*|\s*\/\/|\s*$)/.test(lines[to - 1])) to--;
    const code = lines
      .slice(from, to)
      .join("\n")
      .replace(/^export\s+/m, "")
      .trimEnd();
    return { module: name, name: start.name, code };
  });
}

let cache;
function allChunks() {
  if (!cache) cache = MODULES.flatMap(parseModule);
  return cache;
}

function referencedNames(text, names) {
  const found = new Set();
  for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) if (names.has(m[0])) found.add(m[0]);
  return found;
}

/** Minimal source for a Code node whose body is `entry`. */
export function composeNodeCode(entry) {
  const chunks = allChunks();
  const byName = new Map(chunks.map((c) => [c.name, c]));
  const names = new Set(byName.keys());
  const needed = new Set();
  const queue = [...referencedNames(entry, names)];
  while (queue.length) {
    const name = queue.pop();
    if (needed.has(name)) continue;
    needed.add(name);
    for (const dep of referencedNames(byName.get(name).code, names)) if (!needed.has(dep)) queue.push(dep);
  }
  const body = chunks.filter((c) => needed.has(c.name)).map((c) => c.code);
  const header = "// Generated from n8n/src/*.js by scripts/build-workflows.mjs. Edit the source files, not this node.";
  return [header, ...body, "", "// ---- node entry ----", entry.trim()].join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

/** Every declaration, evaluated together (for tests and scripts). */
export function loadAll() {
  const chunks = allChunks();
  const source = `${chunks.map((c) => c.code).join("\n\n")}\nreturn { ${chunks.map((c) => c.name).join(", ")} };`;
  return new Function(source)();
}

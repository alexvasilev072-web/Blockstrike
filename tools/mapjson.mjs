// Записва карта като четим JSON: по един оп на ред, числовите масиви в един ред.
import fs from 'node:fs';
export function writeMap(path, m) {
  const { ops, ...rest } = m;
  let out = JSON.stringify({ ...rest, ops: '__OPS__' }, null, 1);
  out = out.replace(/\[\s*(-?\d+(?:,\s*-?\d+)*)\s*\]/g, (_, a) => '[' + a.replace(/\s+/g, ' ') + ']');
  const lines = ops.map(o => '  ' + JSON.stringify(o).replace(/,/g, ', ')).join(',\n');
  fs.writeFileSync(path, out.replace('"__OPS__"', '[\n' + lines + '\n ]') + '\n');
}

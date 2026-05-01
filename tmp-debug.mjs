import { promises as fs } from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const directory = path.join(root, 'user_contents', 'work', '2026-04-29-test');
const entry = { src: 'image/ゴミ箱.png', thumbnail: 'image/ゴミ箱.png' };
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
function isExternalPath(value) { return /^(https?:|data:|mailto:|tel:|#|\/)/.test(value); }
async function normalizeAssetPath(value, workId, directory) {
  if (!value || isExternalPath(value) || value.startsWith('assets/') || value.startsWith('works/') || value.startsWith('games/')) return value || '';
  const source = path.join(directory, value);
  console.log({ value, source, exists: await exists(source) });
  if (!(await exists(source))) return value;
  const normalized = value.split(/[\\/]+/).filter(Boolean).join('/');
  return `works/${workId}/${normalized}`;
}
console.log(await normalizeAssetPath(entry.src, '2026-04-29-test', directory));

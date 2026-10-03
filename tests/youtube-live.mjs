import fs from 'node:fs/promises';
import path from 'node:path';
import electron from 'electron';
import { createRequire } from 'node:module';
const { createDownloader } = createRequire(import.meta.url)('../electron/youtube.cjs');
const root = path.resolve('test-output', `youtube-live-${Date.now()}`);
await fs.mkdir(path.join(root, 'audio'), { recursive: true });
const download = createDownloader({ root, tools: path.resolve('tools/runtime'), runtime: electron, progress: update => console.log(update.message, update.percent == null ? '' : `${update.percent}%`) });
const timer = setTimeout(() => download.cancel(), 120000);
try {
  const result = await download.download(process.argv[2] || 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  if (!result.song) throw new Error('Live-Test abgebrochen');
  console.log('LIVE PASS:', result.song.title, path.join(root, 'audio', result.song.file));
} finally { clearTimeout(timer); }

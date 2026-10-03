import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static'), ffprobe = require('ffprobe-static').path;
if (!['win32', 'linux'].includes(process.platform) || process.arch !== 'x64') throw new Error('Die Download-Werkzeuge werden aktuell für Windows und Linux x64 vorbereitet.');
const root = path.resolve('tools/runtime'), suffix = process.platform === 'win32' ? '.exe' : '';
await fs.mkdir(root, { recursive: true });
await Promise.all([
  fs.copyFile(ffmpeg, path.join(root, `ffmpeg${suffix}`)),
  fs.copyFile(ffprobe, path.join(root, `ffprobe${suffix}`))
]);
const manifestPath = path.join(root, 'manifest.json');
let manifest;
try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch {}
const ytFile = path.join(root, `yt-dlp${suffix}`);
let valid = false;
if (manifest?.platform === process.platform && manifest?.arch === process.arch) {
  try { valid = createHash('sha256').update(await fs.readFile(ytFile)).digest('hex') === manifest.sha256; } catch {}
}
if (!valid || process.argv.includes('--update')) {
  const api = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', { headers: { 'User-Agent': 'GigMan-build' } });
  if (!api.ok) throw new Error(`yt-dlp-Release nicht erreichbar: HTTP ${api.status}`);
  const release = await api.json(), assetName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp_linux';
  const asset = release.assets.find(a => a.name === assetName), checksums = release.assets.find(a => a.name === 'SHA2-256SUMS');
  if (!asset || !checksums) throw new Error('yt-dlp-Release enthält nicht alle benötigten Dateien.');
  console.log(`Lade yt-dlp ${release.tag_name} für ${process.platform} …`);
  const [binaryResponse, checksumResponse] = await Promise.all([fetch(asset.browser_download_url), fetch(checksums.browser_download_url)]);
  if (!binaryResponse.ok || !checksumResponse.ok) throw new Error('Download der offiziellen yt-dlp-Dateien fehlgeschlagen.');
  const binary = Buffer.from(await binaryResponse.arrayBuffer()), sums = await checksumResponse.text();
  const expected = sums.split('\n').find(line => line.trim().endsWith(` ${assetName}`))?.split(/\s+/)[0];
  const actual = createHash('sha256').update(binary).digest('hex');
  if (!expected || actual !== expected) throw new Error('Die yt-dlp-Prüfsumme stimmt nicht überein.');
  await fs.writeFile(ytFile, binary);
  manifest = { platform: process.platform, arch: process.arch, version: release.tag_name, sha256: actual, source: asset.browser_download_url };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}
if (process.platform !== 'win32') await Promise.all(['yt-dlp', 'ffmpeg', 'ffprobe'].map(name => fs.chmod(path.join(root, name), 0o755)));
await fs.writeFile(path.join(root, 'NOTICE.txt'), 'yt-dlp: Unlicense, https://github.com/yt-dlp/yt-dlp (standalone runtime includes additional third-party licenses).\nFFmpeg/FFprobe: GPL/LGPL and codec licenses; builds and corresponding source: https://github.com/eugeneware/ffmpeg-static/releases and https://github.com/ffmpeg/ffmpeg\n');
for (const name of ['ffmpeg-static', 'ffprobe-static']) {
  for (const license of ['LICENSE', 'LICENSE.txt', 'COPYING']) {
    try { await fs.copyFile(path.join('node_modules', name, license), path.join(root, `${name}-${license}`)); } catch {}
  }
}
console.log(`Download-Werkzeuge bereit: ${root}`);

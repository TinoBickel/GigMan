const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

function normalizeYouTubeUrl(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw new Error('Bitte eine gültige YouTube-Video-URL eingeben.'); }
  const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'];
  if (!['https:', 'http:'].includes(url.protocol) || !hosts.includes(url.hostname) || url.username || url.password || url.port) throw new Error('Es werden nur YouTube-Video-URLs unterstützt.');
  let id;
  if (url.hostname.endsWith('youtu.be')) id = url.pathname.slice(1);
  else if (url.pathname === '/watch') id = url.searchParams.get('v');
  else id = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)\/?$/)?.[1];
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id || '')) throw new Error('Bitte ein einzelnes YouTube-Video angeben, keine Kanal- oder Playlist-URL.');
  return `https://www.youtube.com/watch?v=${id}`;
}

function runCommand(executable, args, { signal, env, onLine = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, detached: process.platform !== 'win32', env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let stderr = '', pending = '', settled = false, killer;
    const finish = (error) => {
      if (settled) return; settled = true; signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => {
      if (process.platform === 'win32' && child.pid) {
        killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill(); } }
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', chunk => {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/); pending = lines.pop();
      lines.forEach(line => onLine(line));
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-6000); });
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (pending) onLine(pending);
      if (signal?.aborted) finish(Object.assign(new Error('Download abgebrochen.'), { code: 'CANCELLED' }));
      else if (code !== 0) finish(new Error(stderr.trim() || `Download-Werkzeug beendet mit Code ${code}.`));
      else finish();
    });
  });
}

function createDownloader({ root, tools, runtime, progress, execute = runCommand }) {
  let controller = null;
  let done, finishDownload;
  const send = update => progress?.(update);
  return {
    async cancel() { controller?.abort(); if (done) await done; },
    async download(input) {
      const url = normalizeYouTubeUrl(input);
      if (controller) throw new Error('Es läuft bereits ein YouTube-Import.');
      controller = new AbortController(); const signal = controller.signal;
      done = new Promise(resolve => { finishDownload = resolve; });
      const suffix = process.platform === 'win32' ? '.exe' : '';
      const yt = path.join(tools, `yt-dlp${suffix}`);
      let directory, title = 'YouTube-Song', phase = 'download', timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller?.abort(); }, 15 * 60 * 1000);
      try {
        for (const file of [yt, path.join(tools, `ffmpeg${suffix}`), path.join(tools, `ffprobe${suffix}`)]) {
          try { await fs.access(file); } catch { throw Object.assign(new Error('Die Download-Werkzeuge fehlen. Im Projekt bitte „npm run setup:tools“ ausführen oder das aktuelle GigMan-Paket verwenden.'), { code: 'TOOLS_MISSING' }); }
        }
        directory = await fs.mkdtemp(path.join(root, 'download-'));
        const id = randomUUID(), target = path.join(directory, `${id}.%(ext)s`);
        const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
        send({ phase: 'prepare', message: 'Video wird geladen …', percent: null });
        await execute(yt, [
          '--ignore-config', '--no-playlist', '--no-cache-dir', '--no-color', '--newline', '--no-simulate',
          '--socket-timeout', '20', '--retries', '2', '--fragment-retries', '2',
          '--max-filesize', '500M', '--match-filter', '!is_live & duration <= 14400',
          '--js-runtimes', `node:${runtime}`, '--ffmpeg-location', tools,
          '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0',
          '--print', 'before_dl:GIGMAN_TITLE:%(title)j', '--print', 'after_move:GIGMAN_DONE',
          '--progress', '--progress-template', 'download:GIGMAN_PROGRESS:%(progress._percent_str)s',
          '-o', target, '--', url
        ], { signal, env, onLine(line) {
          if (line.startsWith('GIGMAN_TITLE:')) {
            try { title = String(JSON.parse(line.slice(13))).slice(0, 180); } catch {}
            send({ phase: 'download', message: `Lade „${title}“ …`, percent: null });
          } else if (line.startsWith('GIGMAN_PROGRESS:')) {
            const value = Number.parseFloat(line.slice(16));
            if (value >= 100) { phase = 'convert'; send({ phase, message: 'Audio wird in MP3 umgewandelt …', percent: null }); }
            else send({ phase: 'download', message: `Lade „${title}“ …`, percent: Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null });
          } else if (line.includes('[ExtractAudio]')) {
            phase = 'convert'; send({ phase, message: 'Audio wird in MP3 umgewandelt …', percent: null });
          }
        } });
        if (signal.aborted) return { canceled: true };
        const mp3 = path.join(directory, `${id}.mp3`);
        const stat = await fs.stat(mp3);
        if (!stat.size) throw new Error('Die erzeugte MP3 ist leer.');
        await fs.copyFile(mp3, path.join(root, 'audio', `${id}.mp3`));
        send({ phase: 'done', message: 'MP3 zur Bibliothek hinzugefügt.', percent: 100 });
        return { song: { id, title, file: `${id}.mp3`, sections: [], gap: 0, duration: 0, sourceUrl: url } };
      } catch (error) {
        if (timedOut) throw new Error('Der Download hat zu lange gedauert. Bitte Verbindung prüfen und erneut versuchen.');
        if (signal.aborted) return { canceled: true };
        if (error.code === 'TOOLS_MISSING') throw error;
        if (/sign in|bot|private|unavailable|age.restricted|members.only|login/i.test(error.message)) throw new Error('YouTube stellt dieses Video ohne Anmeldung nicht bereit. Bitte ein öffentlich zugängliches Video verwenden.');
        if (/ENOSPC|no space left/i.test(error.message)) throw new Error('Nicht genügend Speicherplatz für den MP3-Import.');
        if (/timed out|unable to download|connection|resolve|HTTP Error|network/i.test(error.message)) throw new Error('YouTube-Download fehlgeschlagen. Bitte Verbindung und Video-URL prüfen; YouTube kann Downloads zeitweise blockieren.');
        throw new Error(phase === 'convert' ? 'Die MP3-Umwandlung ist fehlgeschlagen.' : 'Dieses Video konnte nicht als MP3 importiert werden. Bitte eine andere URL versuchen.');
      } finally {
        clearTimeout(timeout);
        if (directory && path.resolve(directory).startsWith(path.resolve(root) + path.sep) && path.basename(directory).startsWith('download-')) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
        controller = null;
        finishDownload(); done = null;
      }
    }
  };
}
module.exports = { normalizeYouTubeUrl, runCommand, createDownloader };

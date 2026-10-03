import './style.css';
import './interactions.css';
import './compact.css';
import './song-settings.css';
import './song-transport.css';
import { AudioEngine } from './audio.js';
import { clamp, time, ranges, playlist, moveSong, validateSection, dragSection, songSettings } from './domain.js';

const icons = {
  play: '<path d="m8 5 11 7-11 7z"/>', pause: '<path d="M8 5v14M16 5v14"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', folder: '<path d="M3 7h7l2 2h9v11H3zM3 7V4h7l2 3"/>', loop: '<path d="m17 2 4 4-4 4M21 6H7a4 4 0 0 0-4 4m4 12-4-4 4-4M3 18h14a4 4 0 0 0 4-4"/>',
  music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  grip: '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/>', next: '<path d="m5 5 10 7-10 7zM19 5v14"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', guitar: '<path d="m14 10 7-7M17 3l4 4M10 9c-5-3-9 3-6 7s8 5 10 0c1-3-1-6-4-7ZM8 13l3 3"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.music}</svg>`;
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = document.querySelector('#app'), engine = new AudioEngine();
let state, activeId, selectedSong, selectedSection, mode = 'song', busy = false, locked = false;
let playing = false, paused = false, queue = [], queueIndex = 0, resumeAt = null, gapTimer, gapUntil = 0, run = 0;
let previewSong = null, suppressClickUntil = 0;
let playbackScope = null;
let downloadActive = false, downloadTask = null;
let saveTimer, savePending = false, saveError = false;
let titleEditor = null;
let archiveTask = null;
let archiveStatus = '';
const waves = new Map(), failures = new Set();
const current = () => state.setlists.find(s => s.id === activeId);
const songById = id => current()?.songs.find(s => s.id === id);
function notify(message) {
  const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(notify.timer); notify.timer = setTimeout(() => el.classList.remove('show'), 5000);
}
function persist() {
  savePending = true; clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await window.gigman.save(state); savePending = false; saveError = false; document.querySelector('#saved').textContent = 'Lokal gespeichert'; }
    catch { saveError = true; document.querySelector('#saved').textContent = 'Speichern fehlgeschlagen'; notify('Speichern fehlgeschlagen. Bitte freien Speicherplatz und Zugriffsrechte prüfen.'); }
  }, 250);
}
function render() {
  titleEditor?.finish(true);
  const list = current(), songs = list?.songs || [], sectionCount = songs.reduce((n, s) => n + s.sections.length, 0);
  songs.forEach(song => Object.assign(song, songSettings(song)));
  app.innerHTML = `<aside class="sidebar"><a class="brand">${icon('guitar')}<span>Gig<span class="accent">Man</span><small>YOUR PRACTICE STUDIO</small></span></a>
    <div class="nav-label">DEINE BIBLIOTHEK <span>${state.setlists.length}</span></div>
    <button class="new-list" data-action="new">${icon('plus')} Neue Setliste</button>
    <nav>${state.setlists.map(l => `<button class="list-link ${l.id === activeId ? 'active' : ''}" data-action="list" data-id="${l.id}">${icon('music')}<span>${esc(l.name)}<small>${l.songs.length} Songs</small></span>${l.id === activeId ? '<i></i>' : ''}</button>`).join('')}</nav>
    <div class="archive-tools"><button data-action="save-as" ${busy || !state.setlists.length ? 'disabled' : ''}>Speichern unter …</button><button data-action="load-archive" ${busy ? 'disabled' : ''}>Laden …</button><small>${archiveStatus || 'Portable Sicherung inklusive MP3s'}</small></div><div class="sidebar-bottom"><span class="local-dot"></span> Offline. Auf deiner Bühne.<small>MP3s & Markierungen bleiben lokal.</small></div></aside>
    <main><header class="topbar"><div class="setlist-summary"><h1 title="${esc(list?.name || 'Willkommen')}">${esc(list?.name || 'Dein Gig beginnt hier.')}</h1><p>${list ? `${songs.length} Songs <span>·</span> ${sectionCount} Übungssektionen <span>·</span> ${time(songs.reduce((n, s) => n + s.duration, 0))} Gesamtlänge` : 'Deine Songs. Deine Übungsstellen.'}</p></div><div class="mode-switch"><button data-action="mode-song" class="${mode === 'song' ? 'selected' : ''}" title="Setliste mit den Einstellungen jedes Songs abspielen">${icon('music')} Song Mode</button><button data-action="mode-loop" class="${mode === 'loop' ? 'selected' : ''}" title="Ausgewählte Sektion wiederholen">${icon('loop')} Loop Mode</button></div><div class="setlist-player"><div class="setlist-buttons"><button class="play-button" data-action="setlist-start" title="Ganze Setliste starten / fortsetzen" aria-label="Setliste starten" ${!songs.length ? 'disabled' : ''}>${icon('play')}</button><button class="square" data-action="setlist-pause" title="Setliste pausieren" aria-label="Setliste pausieren" ${!(playing && playbackScope === 'setlist') ? 'disabled' : ''}>${icon('pause')}</button><button class="square" data-action="setlist-stop" title="Setliste stoppen" aria-label="Setliste stoppen" ${!((playing || paused) && playbackScope === 'setlist') ? 'disabled' : ''}>${icon('stop')}</button></div><small id="play-status">${playing || paused ? esc(songById(selectedSong)?.title || '') : 'Setliste abspielen'}</small></div><div class="topbar-actions">${list ? `<button data-action="rename" title="Setliste umbenennen">Umbenennen</button><button data-action="youtube" ${busy ? 'disabled' : ''}>${icon('plus')} YouTube → MP3</button><button class="primary" data-action="import-folder" ${busy ? 'disabled' : ''}>${icon('folder')} ${busy ? 'Bitte warten …' : 'Ordner importieren'}</button>` : `<button class="primary" data-action="new">${icon('plus')} Neue Setliste</button>`}<button class="quiet" data-action="help" title="Tastaturkürzel" aria-label="Tastaturkürzel"><kbd>?</kbd></button></div></header>
    <div class="content">
    ${songs.length ? `<div class="song-list">${songs.map((song, i) => songRow(song, i)).join('')}</div><button class="add-song" data-action="import-files" ${busy ? 'disabled' : ''}>${icon('plus')} MP3-Dateien hinzufügen</button>` : `<div class="empty"><div class="empty-icon">${icon('music')}</div><h2>${list ? 'Platz für deine nächste Show.' : 'Mehr spielen. Weniger suchen.'}</h2><p>${list ? 'Importiere einen Ordner mit MP3s. Markiere deine Solos<br>und bring die Songs in deine Reihenfolge.' : 'Erstelle deine erste Setliste und importiere die Songs<br>direkt aus einem Ordner auf deinem Rechner.'}</p><button class="primary" data-action="${list ? 'import-folder' : 'new'}">${icon(list ? 'folder' : 'plus')}${list ? 'MP3-Ordner wählen' : 'Setliste erstellen'}</button><div class="empty-steps"><span>01 <b>Songs importieren</b></span><span>02 <b>Sektionen markieren</b></span><span>03 <b>Gig vorbereiten</b></span></div></div>`}
    <div class="content-foot"><span>${icon('clock')} Wechselpausen gelten zwischen Songs.</span><span id="saved">${saveError ? 'Speichern fehlgeschlagen' : 'Lokal gespeichert'}</span>${list ? '<button class="text-danger" data-action="delete-list">Setliste löschen</button>' : ''}</div></div></main>
    <dialog id="dialog"></dialog><div id="toast" role="status"></div>`;
  requestAnimationFrame(drawWaves);
}
function songRow(song, i) {
  const chosen = selectedSong === song.id;
  return `<article class="song-row ${chosen ? 'chosen' : ''} ${failures.has(song.id) ? 'failed' : ''}" data-song="${song.id}">
    <div class="song-info"><button class="drag-handle" draggable="true" data-id="${song.id}" title="Song ziehen, um die Reihenfolge zu ändern" aria-label="${esc(song.title)} verschieben">${icon('grip')}</button><span class="song-number">${String(i + 1).padStart(2, '0')}</span>
    <div class="song-title"><button data-action="select-song" data-id="${song.id}" title="Song auswählen · Doppelklick zum Umbenennen">${esc(song.title)}</button><small>${failures.has(song.id) ? 'MP3 nicht lesbar' : `${time(song.duration)} · ${song.sections.length ? `${song.sections.length} Sektionen` : 'Ganzer Song'}`}</small>
    <label class="gap">${icon('clock')}<input aria-label="Wechselpause für ${esc(song.title)}" class="gap-input" data-id="${song.id}" type="number" min="0" max="600" value="${song.gap}"> s Wechselpause</label></div></div>
    <div class="wave-area"><div class="wave" data-id="${song.id}"><canvas></canvas>${song.sections.map((s, j) => `<button class="region color-${j % 4} ${chosen && selectedSection === s.id ? 'selected-region' : ''}" data-action="section" data-song="${song.id}" data-id="${s.id}" style="left:${s.start / song.duration * 100}%;width:${(s.end - s.start) / song.duration * 100}%" title="${esc(s.name)} · ${s.start.toFixed(2)}–${s.end.toFixed(2)} s · Ziehen: verschieben · Ränder: Größe ändern"><span class="region-label">${esc(s.name)}</span><span class="region-handle handle-start" data-edge="start" title="Start verschieben"></span><span class="region-handle handle-end" data-edge="end" title="Ende verschieben"></span></button>`).join('')}<div class="playhead" hidden></div></div>
    <div class="wave-times"><span>0:00</span><span>${waves.has(song.id) ? time(song.duration) : failures.has(song.id) ? 'Datei prüfen' : 'Waveform wird geladen …'}</span></div></div>
    <div class="row-actions"><button class="square" data-action="new-section" data-id="${song.id}" title="Sektion mit Zeitangaben hinzufügen">${icon('plus')}</button><button class="square" data-action="delete-song" data-id="${song.id}" title="Song aus Setliste entfernen">${icon('trash')}</button></div><div class="song-controls">
      <div class="song-buttons"><button class="song-start" data-action="song-start" data-id="${song.id}" title="Song starten / fortsetzen" aria-label="${esc(song.title)} starten">${icon('play')}</button><button data-action="song-pause" data-id="${song.id}" title="Song pausieren" aria-label="${esc(song.title)} pausieren" ${!(playing && queue[queueIndex]?.songId === song.id) ? 'disabled' : ''}>${icon('pause')}</button><button data-action="song-stop" data-id="${song.id}" title="Song stoppen" aria-label="${esc(song.title)} stoppen" ${!((playing || paused) && queue[queueIndex]?.songId === song.id) ? 'disabled' : ''}>${icon('stop')}</button></div>
      <label>Abspielen <select class="song-play-mode" data-id="${song.id}" aria-label="Abspielumfang für ${esc(song.title)}"><option value="full" ${song.playMode === 'full' ? 'selected' : ''}>Komplett</option><option value="loops" ${song.playMode === 'loops' ? 'selected' : ''}>Loops</option></select></label>
      <label>Vorzählen <select class="song-count" data-id="${song.id}" aria-label="Vorzählen für ${esc(song.title)}">${[0,2,4,8].map(n => `<option value="${n}" ${song.count === n ? 'selected' : ''}>${n ? n + ' Schläge' : 'Aus'}</option>`).join('')}</select><input class="song-bpm" data-id="${song.id}" aria-label="BPM für ${esc(song.title)}" type="number" min="30" max="240" value="${song.bpm}"><span>BPM</span></label>
      <label>Lautstärke <input class="song-volume" data-id="${song.id}" aria-label="Lautstärke für ${esc(song.title)}" type="range" min="0" max="1" step="0.01" value="${song.volume}"></label>
      <label>Tempo <input class="song-tempo" data-id="${song.id}" aria-label="Tempo für ${esc(song.title)}" type="range" min="0.5" max="1.25" step="0.05" value="${song.tempo}"><output>${Math.round(song.tempo * 100)}%</output></label>
      <label>Tonhöhe <div class="stepper"><button data-action="pitch-down" data-id="${song.id}" aria-label="${esc(song.title)}: Halbton tiefer">−</button><output>${song.pitch > 0 ? '+' : ''}${song.pitch} HT</output><button data-action="pitch-up" data-id="${song.id}" aria-label="${esc(song.title)}: Halbton höher">+</button></div></label>
    </div></article>`;
}
function editSongTitle(button) {
  titleEditor?.finish(true);
  const song = songById(button.dataset.id); if (!song) return;
  const input = document.createElement('input'); input.className = 'song-name-editor';
  input.value = song.title; input.maxLength = 180; input.setAttribute('aria-label', 'Songname bearbeiten');
  button.replaceWith(input);
  const editor = { finish(save) {
    if (titleEditor !== editor) return;
    titleEditor = null;
    const name = input.value.trim();
    if (save && name && name !== song.title) { song.title = name; persist(); }
    button.textContent = song.title; input.replaceWith(button);
  } };
  titleEditor = editor;
  input.addEventListener('blur', () => editor.finish(true));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editor.finish(e.key === 'Enter'); button.focus(); }
  });
  input.focus(); input.select();
}
function drawWaves() {
  document.querySelectorAll('.wave').forEach(el => {
    const canvas = el.querySelector('canvas'), rect = el.getBoundingClientRect(), dpr = devicePixelRatio;
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.fillStyle = '#627477';
    const peaks = waves.get(el.dataset.id);
    if (!peaks) { ctx.fillStyle = '#2c3538'; ctx.fillRect(0, rect.height / 2, rect.width, 1); return; }
    const bars = Math.floor(rect.width / 3);
    for (let i = 0; i < bars; i++) { const h = Math.max(2, peaks[Math.floor(i / bars * peaks.length)] * rect.height * 0.85); ctx.fillRect(i * 3, (rect.height - h) / 2, 1.8, h); }
  });
}
async function hydrate() {
  const list = current(); if (!list) return;
  for (const song of list.songs) {
    if (waves.has(song.id) || failures.has(song.id)) continue;
    try { const result = await engine.decode(song); const changed = song.duration !== result.buffer.duration; song.duration = result.buffer.duration; waves.set(song.id, result.peaks); if (changed) persist(); }
    catch (error) { console.error('MP3 laden:', error); failures.add(song.id); }
    if (current()?.id === list.id && !document.querySelector('#dialog')?.open) render();
  }
}
function dialog(title, body, onSubmit, submit = 'Speichern') {
  const el = document.querySelector('#dialog');
  el.innerHTML = `<form><div class="dialog-heading"><h2>${title}</h2><button type="button" data-action="close-dialog" aria-label="Schließen">×</button></div>${body}<p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" data-action="close-dialog">Abbrechen</button><button class="primary" type="submit">${submit}</button></div></form>`;
  el.querySelector('form').onsubmit = async e => {
    e.preventDefault(); try { await onSubmit(new FormData(e.target)); } catch (error) { el.querySelector('.form-error').textContent = error.message; }
  };
  el.showModal();
}
function youtubeDialog() {
  if (busy || !current()) return;
  const list = current();
  dialog('YouTube als MP3 importieren', `<p class="dialog-sub">Das Audio wird heruntergeladen, in MP3 umgewandelt und zu „${esc(list.name)}“ hinzugefügt.</p><label>Video-URL<input name="url" type="url" required placeholder="https://www.youtube.com/watch?v=…" autofocus></label><p class="youtube-hint">Einzelne öffentliche Videos · keine Playlists</p><div class="download-progress" hidden><span id="download-status" role="status"></span><progress id="download-meter" max="100"></progress></div>`, async data => {
    if (downloadActive) return;
    const el = document.querySelector('#dialog'), url = data.get('url').trim();
    busy = true; downloadActive = true;
    el.querySelector('[type="submit"]').disabled = true; el.querySelector('[name="url"]').disabled = true;
    el.querySelector('.form-error').textContent = ''; el.querySelector('.download-progress').hidden = false;
    el.querySelector('#download-status').textContent = 'Download wird vorbereitet …';
    const off = window.gigman.onDownloadProgress(update => {
      if (!el.isConnected) return;
      el.querySelector('#download-status').textContent = update.message;
      const meter = el.querySelector('#download-meter');
      if (update.percent == null) meter.removeAttribute('value'); else meter.value = update.percent;
    });
    let success = false;
    try {
      downloadTask = window.gigman.downloadYouTube(url);
      const result = await downloadTask;
      downloadActive = false; busy = false;
      if (result.canceled) { render(); notify('YouTube-Import abgebrochen.'); success = true; return; }
      list.songs.push(result.song); selectedSong = result.song.id; selectedSection = null;
      persist(); render(); notify('YouTube-Audio als MP3 importiert.'); success = true;
    } catch (error) {
      el.querySelector('.form-error').textContent = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    } finally {
      off(); downloadActive = false; downloadTask = null; busy = false;
      if (el.isConnected) { el.querySelector('[type="submit"]').disabled = false; el.querySelector('[name="url"]').disabled = false; el.querySelector('.download-progress').hidden = true; }
    }
    if (success) await hydrate();
  }, 'Als MP3 importieren');
  document.querySelector('#dialog').oncancel = event => { if (downloadActive) { event.preventDefault(); window.gigman.cancelYouTube(); } };
}
function sectionDialog(song, section, start = 0, end = Math.min(10, song.duration)) {
  if (!song.duration) return notify('Die Waveform muss zuerst geladen werden.');
  if (section) { start = section.start; end = section.end; }
  dialog(section ? 'Übungssektion bearbeiten' : 'Neue Übungssektion', `<p class="dialog-sub">${esc(song.title)}</p><label>Name<input name="name" required maxlength="80" value="${esc(section?.name || `Solo ${song.sections.length + 1}`)}"></label><div class="form-grid"><label>Start in Sekunden<input name="start" type="number" required min="0" step="0.01" value="${start.toFixed(2)}"></label><label>Ende in Sekunden<input name="end" type="number" required min="0" step="0.01" value="${end.toFixed(2)}"></label></div><p class="dialog-sub">Songlänge: ${time(song.duration)} (${song.duration.toFixed(2)} Sekunden)</p>${section ? `<button type="button" class="text-danger" data-action="delete-section" data-song="${song.id}" data-id="${section.id}">Sektion löschen</button>` : ''}`, data => {
    const a = Number(data.get('start')), b = Number(data.get('end')), name = data.get('name').trim();
    if (!name || !validateSection(a, b, song.duration)) throw new Error('Bitte Namen und einen gültigen Bereich von mindestens 0,1 Sekunden innerhalb des Songs angeben.');
    stop();
    const value = { id: section?.id || crypto.randomUUID(), name, start: a, end: b };
    if (section) Object.assign(section, value); else song.sections.push(value);
    selectedSong = song.id; selectedSection = value.id; persist(); render();
  });
}
function stop(reset = true) {
  run++; engine.stop(); clearTimeout(gapTimer); gapUntil = 0; playing = false;
  if (reset) { paused = false; resumeAt = null; previewSong = null; playbackScope = null; }
}
async function startItem(countIn = false) {
  const item = queue[queueIndex], song = songById(item?.songId);
  if (!item || !song) { stop(); render(); return; }
  const token = ++run;
  playing = true; paused = false; selectedSong = song.id; selectedSection = item.id;
  const start = resumeAt ?? item.start; resumeAt = null; render();
  const settings = songSettings(song);
  try { await engine.play(song, start, item.end, settings, mode === 'loop' && !previewSong && item.id !== 'full', countIn ? settings.count : 0, () => advance(token), item.start); }
  catch { if (token === run) { stop(); render(); notify(`„${song.title}“ konnte nicht abgespielt werden. Bitte MP3 prüfen.`); } }
}
function advance(token) {
  if (token !== run) return;
  if (previewSong) { stop(); render(); return; }
  const previous = queue[queueIndex]; queueIndex++;
  if (queueIndex >= queue.length) { const finishedSetlist = playbackScope === 'setlist'; stop(); render(); if (finishedSetlist) notify('Setliste geschafft. Bereit für die Bühne.'); return; }
  const gap = queue[queueIndex].songId !== previous.songId ? songById(previous.songId).gap : 0;
  if (gap > 0) {
    engine.stop(); gapUntil = Date.now() + gap * 1000;
    gapTimer = setTimeout(() => { gapUntil = 0; if (token === run) startItem(true); }, gap * 1000);
  } else startItem(queue[queueIndex].songId !== previous.songId);
}
async function preview(song, position = 0) {
  if (!song?.duration || failures.has(song.id)) return notify('Die Audiodatei muss zuerst geladen werden.');
  stop(); playbackScope = 'preview'; previewSong = song.id; selectedSong = song.id; selectedSection = null;
  queue = [{ id: 'preview', name: 'Song anhören', songId: song.id, start: 0, end: song.duration }];
  queueIndex = 0; resumeAt = clamp(position, 0, song.duration - 0.01); await startItem(0);
}
async function togglePlay() {
  if (playing) {
    if (gapUntil) { stop(); render(); return; }
    resumeAt = engine.position(); stop(false); paused = true; render(); return;
  }
  if (!current()?.songs.length) return;
  if (paused) { await startItem(0); return; }
  if (mode === 'loop') await startSong(songById(selectedSong));
  else await startSetlist();
}
async function startSetlist() {
  if (paused && playbackScope === 'setlist') return startItem(false);
  if (!current()?.songs.length) return;
  await hydrate(); stop(); mode = 'song'; playbackScope = 'setlist';
  queue = playlist(current().songs); queueIndex = 0; await startItem(true);
}
async function startSong(song) {
  if (!song?.duration || failures.has(song.id)) return notify('Die Audiodatei muss zuerst geladen werden.');
  if (paused && playbackScope !== 'setlist' && queue[queueIndex]?.songId === song.id) return startItem(false);
  const section = song.sections.find(s => s.id === selectedSection) || song.sections[0];
  stop(); playbackScope = 'song'; selectedSong = song.id;
  queue = mode === 'loop' && section ? [{ ...section, songId: song.id }] : ranges(song).map(item => ({ ...item, songId: song.id }));
  queueIndex = 0; await startItem(true);
}
function updatePlaybackButtons() {
  document.querySelector('[data-action="setlist-pause"]').disabled = !(playing && playbackScope === 'setlist');
  document.querySelector('[data-action="setlist-stop"]').disabled = !((playing || paused) && playbackScope === 'setlist');
  document.querySelectorAll('[data-action="song-pause"], [data-action="song-stop"]').forEach(button => {
    button.disabled = !(queue[queueIndex]?.songId === button.dataset.id && (playing || (paused && button.dataset.action === 'song-stop')));
  });
}
async function importAudio(folder) {
  if (busy || !current()) return;
  stop(); busy = true; const list = current(); render();
  try {
    const result = await window.gigman[folder ? 'importFolder' : 'importFiles']();
    if (result) { list.songs.push(...result.songs); persist(); notify(`${result.songs.length} MP3s kopiert.${result.errors.length ? ` Nicht importiert: ${result.errors.join(', ')}` : ''}`); }
  } catch { notify('Import fehlgeschlagen. Verzeichnis und freien Speicherplatz prüfen.'); }
  busy = false; render(); await hydrate();
}
function archiveError(error) { return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
async function loadArchive() {
  if (busy) return;
  let message;
  stop(); busy = true; archiveStatus = 'Sicherung wird geladen …'; render();
  archiveTask = (async () => {
    try {
      const restored = await window.gigman.importArchive();
      if (!restored) return;
      for (const list of restored.setlists) {
        const base = list.name; let suffix = 1;
        while (state.setlists.some(existing => existing.name === list.name)) list.name = base.slice(0, 80) + ' (Import ' + suffix++ + ')';
        state.setlists.push(list);
      }
      activeId = restored.setlists[0].id; selectedSong = current().songs[0]?.id; selectedSection = null;
      persist(); await window.gigman.save(state); savePending = false; saveError = false;
      message = restored.setlists.length + ' Setliste(n) aus der Sicherung geladen.';
    } catch (error) { message = archiveError(error); }
    finally { busy = false; archiveStatus = ''; render(); }
  })();
  await archiveTask; archiveTask = null; await hydrate(); if (message) notify(message);
}
function saveAs() {
  if (busy || !state.setlists.length) return;
  titleEditor?.finish(true);
  dialog('Speichern unter', '<p>Die Sicherung enthält die MP3s, Songreihenfolge, Sektionen und alle Song-Einstellungen. Sie kann später auf einem anderen Rechner geladen werden.</p><label>Umfang<select name="scope"><option value="current">Aktuelle Setliste</option><option value="all">Alle Setlisten</option></select></label>', async data => {
    const library = { version: 1, setlists: data.get('scope') === 'all' ? state.setlists : [current()] };
    stop(); busy = true; archiveStatus = 'Sicherung wird gespeichert …'; render();
    archiveTask = (async () => {
      let message;
      try { const result = await window.gigman.exportArchive(library); if (result) message = result.setlists + ' Setliste(n) mit ' + result.songs + ' Songs gesichert.'; }
      catch (error) { message = archiveError(error); }
      finally { busy = false; archiveStatus = ''; render(); if (message) notify(message); }
    })();
    await archiveTask; archiveTask = null;
  }, 'Speichern unter …');
}
const actions = {
  'save-as': saveAs, 'load-archive': loadArchive,
  new: () => dialog('Neue Setliste', '<label>Name der Setliste<input name="name" placeholder="Zum Beispiel: Club-Gig · Oktober" required maxlength="100" autofocus></label><label class="checkbox"><input type="checkbox" name="import" checked> Anschließend MP3-Ordner importieren</label>', async data => {
    const name = data.get('name').trim(); if (!name) throw new Error('Bitte einen Namen eingeben.');
    stop(); const list = { id: crypto.randomUUID(), name, songs: [] }; state.setlists.push(list); activeId = list.id; selectedSong = null; selectedSection = null; persist(); render(); if (data.has('import')) await importAudio(true);
  }, 'Setliste erstellen'),
  list: async el => { if (busy) return; stop(); activeId = el.dataset.id; selectedSong = current().songs[0]?.id; selectedSection = null; engine.clearExcept(current().songs.map(s => s.id)); render(); await hydrate(); },
  rename: () => dialog('Setliste umbenennen', `<label>Name<input name="name" required maxlength="100" value="${esc(current().name)}"></label>`, data => { const name = data.get('name').trim(); if (!name) throw new Error('Bitte einen Namen eingeben.'); current().name = name; persist(); render(); }),
  'import-folder': () => importAudio(true), 'import-files': () => importAudio(false),
  youtube: () => youtubeDialog(),
  preview: el => preview(songById(el.dataset.id)),
  'song-start': el => startSong(songById(el.dataset.id)),
  'song-pause': () => togglePlay(),
  'song-stop': () => { stop(); render(); },
  'setlist-start': startSetlist,
  'setlist-pause': () => togglePlay(),
  'setlist-stop': () => { stop(); render(); },
  'mode-song': () => { stop(); mode = 'song'; render(); }, 'mode-loop': () => { stop(); mode = 'loop'; render(); },
  'select-song': el => {
    stop(); selectedSong = el.dataset.id; selectedSection = null;
    document.querySelectorAll('.song-row').forEach(row => row.classList.toggle('chosen', row.dataset.song === selectedSong));
    document.querySelectorAll('.selected-region').forEach(region => region.classList.remove('selected-region'));
    document.querySelector('#play-status').textContent = 'Ganzer Song';
    updatePlaybackButtons();
  },
  section: el => {
    stop(); selectedSong = el.dataset.song; selectedSection = el.dataset.id;
    document.querySelectorAll('.selected-region').forEach(region => region.classList.remove('selected-region'));
    document.querySelectorAll('.song-row').forEach(row => row.classList.toggle('chosen', row.dataset.song === selectedSong));
    el.classList.add('selected-region');
    document.querySelector('#play-status').textContent = songById(selectedSong).sections.find(s => s.id === selectedSection).name;
    updatePlaybackButtons();
  },
  'new-section': el => sectionDialog(songById(el.dataset.id)),
  'delete-section': el => { const song = songById(el.dataset.song); stop(); song.sections = song.sections.filter(s => s.id !== el.dataset.id); selectedSection = null; persist(); render(); },
  'delete-song': el => dialog('Song entfernen?', '<p>Der Song und seine Markierungen werden aus dieser Setliste entfernt. Die importierte MP3 bleibt in der lokalen Bibliothek.</p>', () => { stop(); current().songs = current().songs.filter(s => s.id !== el.dataset.id); if (selectedSong === el.dataset.id) { selectedSong = null; selectedSection = null; } persist(); render(); }, 'Entfernen'),
  'delete-list': () => dialog('Setliste löschen?', `<p>„${esc(current().name)}“ und ihre Übungsmarkierungen werden entfernt. Importierte Audiodateien bleiben lokal erhalten.</p>`, () => { stop(); state.setlists = state.setlists.filter(l => l.id !== activeId); activeId = state.setlists[0]?.id; selectedSong = null; selectedSection = null; persist(); render(); }, 'Setliste löschen'),
  'close-dialog': async () => { if (downloadActive) { document.querySelector('#download-status').textContent = 'Download wird abgebrochen …'; await window.gigman.cancelYouTube(); } else document.querySelector('#dialog').close(); },
  play: togglePlay, stop: () => { stop(); render(); },
  next: () => { if (!playing && !paused) return; if (previewSong) { stop(); render(); return; } engine.stop(); clearTimeout(gapTimer); gapUntil = 0; resumeAt = null; if (mode === 'loop') startItem(0); else { queueIndex++; startItem(true); } },
  'pitch-down': el => songSetting(el.dataset.id, 'pitch', clamp(songById(el.dataset.id).pitch - 1, -12, 12)),
  'pitch-up': el => songSetting(el.dataset.id, 'pitch', clamp(songById(el.dataset.id).pitch + 1, -12, 12)),
  help: () => dialog('Mit Gitarre in der Hand', '<div class="shortcuts"><p><kbd>Leertaste</kbd> Abspielen / Pause</p><p><kbd>Esc</kbd> Stop</p><p><kbd>N</kbd> Nächste Sektion</p><p><kbd>L</kbd> Song / Loop Mode wechseln</p><p><kbd>− / +</kbd> Tempo ändern</p></div><p>P: ausgewählten Song komplett ohne Loop anhören.<br>Symboltasten im Song: diesen Song starten, pausieren oder stoppen.<br>Transporttasten oben: ganze Setliste steuern.<br>Klick in die freie Waveform: ab dieser Stelle anhören.<br>Bereich ziehen: Sektion anlegen.<br>Sektion in der Mitte ziehen: verschieben. Randgriffe: Größe ändern.<br>Doppelklick auf Sektion: Namen und genaue Zeiten bearbeiten.<br>Rechtsklick auf Sektion → Löschen: Sektion entfernen.<br>Song am Griff links ziehen: Reihenfolge ändern.</p>', () => document.querySelector('#dialog').close(), 'Verstanden')
};
function songSetting(id, key, value) {
  const song = songById(id); if (!song) return;
  const active = (playing || paused) && queue[queueIndex]?.songId === id;
  const position = playing && !gapUntil ? engine.position() : resumeAt;
  song[key] = value; persist();
  if (key === 'volume') { if (active) engine.setVolume(value); return; }
  if (key === 'count' || key === 'bpm') { render(); return; }
  if (key === 'playMode') {
    if ((playing || paused) && !previewSong && mode === 'song') stop();
    render(); return;
  }
  if (active && playing && !gapUntil) {
    resumeAt = engine.countRemaining(engine.bpm) ? queue[queueIndex].start : position;
    startItem(0);
  } else render();
}
app.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]'); if (!el || el.disabled || locked || performance.now() < suppressClickUntil) return;
  locked = true; try { await actions[el.dataset.action]?.(el); } catch (error) { notify(error.message || 'Aktion fehlgeschlagen'); } finally { locked = false; }
});
app.addEventListener('dblclick', e => {
  const title = e.target.closest('[data-action="select-song"]');
  if (title) { editSongTitle(title); return; }
  const el = e.target.closest('.region'); if (el) { const song = songById(el.dataset.song); sectionDialog(song, song.sections.find(s => s.id === el.dataset.id)); }
});
app.addEventListener('change', e => {
  const el = e.target;
  if (el.classList.contains('song-tempo')) { songSetting(el.dataset.id, 'tempo', clamp(Number(el.value), 0.5, 1.25)); return; }
  if (el.classList.contains('song-play-mode')) { songSetting(el.dataset.id, 'playMode', el.value === 'full' ? 'full' : 'loops'); return; }
  if (el.classList.contains('gap-input')) { songById(el.dataset.id).gap = clamp(Number(el.value) || 0, 0, 600); el.value = songById(el.dataset.id).gap; persist(); }
  for (const [key, limits] of Object.entries({ bpm: [30, 240], count: [0, 8], volume: [0, 1] })) {
    if (el.classList.contains(`song-${key}`)) songSetting(el.dataset.id, key, clamp(Number(el.value) || 0, ...limits));
  }
});
app.addEventListener('input', e => { if (e.target.classList.contains('song-volume')) songSetting(e.target.dataset.id, 'volume', Number(e.target.value)); if (e.target.classList.contains('song-tempo')) e.target.nextElementSibling.textContent = `${Math.round(Number(e.target.value) * 100)}%`; });
app.addEventListener('contextmenu', e => {
  const region = e.target.closest('.region'); if (!region) return;
  e.preventDefault(); document.querySelector('.section-menu')?.remove();
  const menu = document.createElement('div'); menu.className = 'section-menu'; menu.setAttribute('role', 'menu');
  menu.innerHTML = `<button role="menuitem" data-action="delete-section" data-song="${region.dataset.song}" data-id="${region.dataset.id}">${icon('trash')} Löschen</button>`;
  menu.style.left = `${Math.min(e.clientX, innerWidth - 155)}px`; menu.style.top = `${Math.min(e.clientY, innerHeight - 55)}px`;
  app.append(menu); menu.querySelector('button').focus();
});
document.addEventListener('pointerdown', e => { if (!e.target.closest('.section-menu')) document.querySelector('.section-menu')?.remove(); });
let dragged;
app.addEventListener('dragstart', e => { const el = e.target.closest('.drag-handle'); if (!el) return; dragged = el.dataset.id; e.dataTransfer.setData('text/plain', dragged); e.dataTransfer.effectAllowed = 'move'; });
app.addEventListener('dragover', e => { const row = e.target.closest('.song-row'); if (row && dragged) { e.preventDefault(); row.classList.add('drop-target'); } });
app.addEventListener('dragleave', e => e.target.closest('.song-row')?.classList.remove('drop-target'));
app.addEventListener('drop', e => { const row = e.target.closest('.song-row'); if (row && dragged) { e.preventDefault(); stop(); current().songs = moveSong(current().songs, dragged, row.dataset.song); persist(); render(); } dragged = null; });
app.addEventListener('dragend', () => { dragged = null; document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target')); });
let selection, regionDrag;
app.addEventListener('pointerdown', e => {
  const wave = e.target.closest('.wave'); if (!wave || e.button !== 0 || locked) return;
  const song = songById(wave.dataset.id); if (!song.duration) return;
  const rect = wave.getBoundingClientRect(), x = clamp(e.clientX - rect.left, 0, rect.width);
  const region = e.target.closest('.region');
  if (region) {
    const section = song.sections.find(s => s.id === region.dataset.id);
    regionDrag = { song, section, region, wave, rect, x, original: { ...section }, edge: e.target.closest('[data-edge]')?.dataset.edge || 'move', pointer: e.pointerId, moved: false, restartLoop: false };
    region.setPointerCapture(e.pointerId); return;
  }
  const marker = document.createElement('div'); marker.className = 'draft-region'; wave.append(marker); wave.setPointerCapture(e.pointerId);
  selection = { song, wave, rect, x, marker, pointer: e.pointerId };
});
app.addEventListener('pointermove', e => {
  if (regionDrag) {
    const s = regionDrag, delta = (e.clientX - s.rect.left - s.x) / s.rect.width * s.song.duration;
    if (!s.moved && Math.abs(e.clientX - s.rect.left - s.x) < 4) return;
    if (!s.moved) {
      s.restartLoop = playing && !previewSong && mode === 'loop' && queue[queueIndex]?.id === s.section.id;
      if (!previewSong && (playing || paused)) stop();
      s.moved = true; s.region.classList.add('dragging-region');
    }
    Object.assign(s.section, dragSection(s.original, delta, s.edge, s.song.duration));
    s.region.style.left = `${s.section.start / s.song.duration * 100}%`;
    s.region.style.width = `${(s.section.end - s.section.start) / s.song.duration * 100}%`;
    s.region.title = `${s.section.name} · ${s.section.start.toFixed(2)}–${s.section.end.toFixed(2)} s`;
    return;
  }
  if (!selection) return; const s = selection, x = clamp(e.clientX - s.rect.left, 0, s.rect.width);
  s.marker.style.left = `${Math.min(s.x, x)}px`; s.marker.style.width = `${Math.abs(x - s.x)}px`;
});
app.addEventListener('pointerup', async e => {
  if (regionDrag) {
    const s = regionDrag; regionDrag = null;
    if (s.region.hasPointerCapture(e.pointerId)) s.region.releasePointerCapture(e.pointerId);
    if (!s.moved) return;
    suppressClickUntil = performance.now() + 200;
    selectedSong = s.song.id; selectedSection = s.section.id; persist(); render();
    if (s.restartLoop) { playbackScope = 'song'; queue = [{ ...s.section, songId: s.song.id }]; queueIndex = 0; await startItem(0); }
    return;
  }
  if (!selection) return; const s = selection; selection = null; s.marker.remove();
  const x = clamp(e.clientX - s.rect.left, 0, s.rect.width);
  if (s.wave.hasPointerCapture(e.pointerId)) s.wave.releasePointerCapture(e.pointerId);
  if (Math.abs(x - s.x) < 5) { await preview(s.song, x / s.rect.width * s.song.duration); return; }
  sectionDialog(s.song, null, Math.min(s.x, x) / s.rect.width * s.song.duration, Math.max(s.x, x) / s.rect.width * s.song.duration);
});
app.addEventListener('pointercancel', () => {
  selection?.marker.remove(); selection = null;
  if (regionDrag) { Object.assign(regionDrag.section, regionDrag.original); regionDrag = null; render(); }
});
document.addEventListener('keydown', async e => {
  if (e.key === 'Escape' && document.querySelector('.section-menu')) { document.querySelector('.section-menu').remove(); e.preventDefault(); return; }
  if (e.target.closest('input,select,textarea') || document.querySelector('#dialog')?.open || e.ctrlKey || e.altKey || e.metaKey || locked) return;
  const key = e.key.toLowerCase();
  if (key === 'p' && !e.repeat) { e.preventDefault(); await preview(songById(selectedSong)); return; }
  const action = { ' ': 'play', escape: 'stop', n: 'next', l: mode === 'song' ? 'mode-loop' : 'mode-song', '?': 'help' }[key];
  if (action && !e.repeat) { e.preventDefault(); locked = true; try { await actions[action](); } finally { locked = false; } }
  if (['-', '+', '='].includes(key) && songById(selectedSong)) { e.preventDefault(); const song = songById(selectedSong); songSetting(song.id, 'tempo', clamp(Math.round((song.tempo + (key === '-' ? -0.05 : 0.05)) * 100) / 100, 0.5, 1.25)); }
});
window.addEventListener('resize', drawWaves);
window.addEventListener('resize', () => document.querySelector('.section-menu')?.remove());
document.addEventListener('scroll', () => document.querySelector('.section-menu')?.remove(), true);
window.gigman?.onClosing(async () => {
  titleEditor?.finish(true);
  if (archiveTask) await archiveTask;
  if (downloadActive) await window.gigman.cancelYouTube();
  if (downloadTask) await downloadTask.catch(() => {});
  clearTimeout(saveTimer);
  if (!state || (!savePending && !saveError)) return;
  try { await window.gigman.save(state); savePending = false; saveError = false; }
  catch (error) { notify('Schließen angehalten: Die Bibliothek konnte nicht gespeichert werden. Bitte Speicherplatz prüfen und erneut schließen.'); throw error; }
});
function tick() {
  const status = document.querySelector('#play-status');
  if (playing && status) {
    if (gapUntil) status.textContent = `Gitarrenwechsel · noch ${Math.max(0, Math.ceil((gapUntil - Date.now()) / 1000))} s`;
    else { const count = engine.countRemaining(engine.bpm); status.textContent = count ? `Vorzählen · ${count}` : `${songById(queue[queueIndex]?.songId)?.title || ''} · ${queue[queueIndex]?.name || ''} · ${time(engine.position())}${mode === 'loop' && !previewSong ? ' · Loop' : ''}`; }
  }
  document.querySelectorAll('.playhead').forEach(head => {
    const song = songById(head.parentElement.dataset.id); head.hidden = !playing || !!gapUntil || song?.id !== selectedSong;
    if (!head.hidden && song?.duration) head.style.left = `${engine.position() / song.duration * 100}%`;
  });
  requestAnimationFrame(tick);
}
async function boot() {
  if (!window.gigman) { app.innerHTML = '<div class="boot-error"><h1>GigMan ist eine Desktop-App.</h1><p>Starte sie im Projektverzeichnis mit <code>npm start</code>.</p></div>'; return; }
  try {
    state = await window.gigman.load();
    if (state.version !== 1 || !Array.isArray(state.setlists)) throw new Error('Unbekanntes Bibliotheksformat');
    state.settings = { tempo: 1, pitch: 0, count: 4, bpm: 100, volume: 0.8, ...state.settings };
    let migrated = false;
    for (const list of state.setlists) for (const song of list.songs) {
      if (song.tempo == null || song.pitch == null || song.playMode == null || song.count == null || song.bpm == null || song.volume == null) { Object.assign(song, songSettings(song, state.settings)); migrated = true; }
    }
    activeId = state.setlists[0]?.id; selectedSong = current()?.songs[0]?.id;
    engine.setVolume(state.settings.volume); render(); tick(); await hydrate();
    if (migrated) persist();
  } catch (error) { app.innerHTML = `<div class="boot-error"><h1>Bibliothek konnte nicht geladen werden.</h1><p>${esc(error.message)}</p><p>Die gespeicherte Datei wird nicht überschrieben.</p></div>`; }
}
boot();

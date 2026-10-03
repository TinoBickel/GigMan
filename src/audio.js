import { SoundTouchNode } from '@soundtouchjs/audio-worklet';
import processorUrl from '@soundtouchjs/audio-worklet/processor?url';
export class AudioEngine {
  constructor() { this.cache = new Map(); this.token = 0; this.volume = 0.8; }
  async init() {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain(); this.gain.gain.value = this.volume; this.gain.connect(this.context.destination);
      this.ready = SoundTouchNode.register(this.context, processorUrl);
    }
    await this.ready;
    if (this.context.state === 'suspended') await this.context.resume();
  }
  async decode(song) {
    await this.init();
    if (!this.cache.has(song.id)) {
      const promise = (async () => {
        const response = await fetch(`gigman://app/audio/${song.file}`);
        if (!response.ok) throw new Error('Audiodatei fehlt');
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        const data = buffer.getChannelData(0), peaks = [];
        for (let i = 0; i < 1100; i++) {
          const start = Math.floor(i * data.length / 1100), end = Math.floor((i + 1) * data.length / 1100);
          let peak = 0; for (let j = start; j < end; j++) peak = Math.max(peak, Math.abs(data[j]));
          peaks.push(peak);
        }
        // Keep only two decoded tracks; the UI stores lightweight waveform peaks separately.
        while (this.cache.size > 2) this.cache.delete(this.cache.keys().next().value);
        return { buffer, peaks };
      })();
      this.cache.set(song.id, promise);
      promise.catch(() => this.cache.delete(song.id));
    }
    return this.cache.get(song.id);
  }
  stop() {
    this.token++;
    if (this.source) { this.source.onended = null; try { this.source.stop(); } catch {} this.source.disconnect(); this.source = null; }
    this.processor?.disconnect(); this.processor = null;
    for (const node of this.clicks || []) { try { node.stop(); } catch {} }
    this.clicks = [];
  }
  async play(song, start, end, settings, loop, count, ended, rangeStart = start) {
    this.stop(); const token = this.token;
    const { buffer } = await this.decode(song);
    if (token !== this.token) return;
    this.processor = new SoundTouchNode({ context: this.context });
    this.processor.playbackRate.value = settings.tempo;
    this.processor.pitchSemitones.value = settings.pitch;
    this.processor.connect(this.gain);
    this.source = this.context.createBufferSource(); this.source.buffer = buffer;
    this.source.playbackRate.value = settings.tempo; this.source.connect(this.processor);
    this.source.loop = loop; this.source.loopStart = rangeStart; this.source.loopEnd = end;
    const now = this.context.currentTime + 0.06;
    const lead = count * 60 / settings.bpm;
    this.clicks = [];
    for (let i = 0; i < count; i++) {
      const osc = this.context.createOscillator(), gain = this.context.createGain(), when = now + i * 60 / settings.bpm;
      osc.frequency.value = i === 0 ? 1200 : 800; gain.gain.setValueAtTime(0.18, when); gain.gain.exponentialRampToValueAtTime(0.001, when + 0.075);
      osc.connect(gain); gain.connect(this.gain); osc.start(when); osc.stop(when + 0.08); this.clicks.push(osc);
    }
    this.anchor = now + lead; this.start = start; this.rangeStart = rangeStart; this.end = end; this.tempo = settings.tempo; this.loop = loop;
    this.source.onended = () => { if (token === this.token) ended(); };
    if (loop) this.source.start(this.anchor, start); else this.source.start(this.anchor, start, end - start);
  }
  position() {
    if (!this.source) return this.start || 0;
    const elapsed = Math.max(0, this.context.currentTime - this.anchor) * this.tempo;
    if (this.loop && this.start + elapsed >= this.end) return this.rangeStart + (this.start + elapsed - this.end) % (this.end - this.rangeStart);
    return this.start + Math.min(elapsed, this.end - this.start);
  }
  countRemaining(bpm) { return this.source ? Math.max(0, Math.ceil((this.anchor - this.context.currentTime) * bpm / 60)) : 0; }
  setVolume(value) { this.volume = value; if (this.gain) this.gain.gain.value = value; }
  clearExcept(ids) { for (const id of this.cache.keys()) if (!ids.includes(id)) this.cache.delete(id); }
}

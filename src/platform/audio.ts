import type { SoundName } from '../game/game';

/** Tiny procedural sound engine — no audio files to ship or license. */
export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private last = new Map<SoundName, number>();
  private noise: AudioBuffer | null = null;

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  play(name: SoundName) {
    if (!this.enabled || !this.ctx || !this.noise) return;
    const now = this.ctx.currentTime;
    const gap: Partial<Record<SoundName, number>> = { shot: 0.05, rifle: 0.06, hit: 0.08, groan: 0.6, place: 0.04 };
    const prev = this.last.get(name) ?? -1;
    if (now - prev < (gap[name] ?? 0.1)) return;
    this.last.set(name, now);
    const c = this.ctx;
    const out = c.createGain();
    out.connect(c.destination);

    const tone = (type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, now + delay);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), now + delay + dur);
      g.gain.setValueAtTime(vol, now + delay);
      g.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);
      o.connect(g).connect(out);
      o.start(now + delay);
      o.stop(now + delay + dur + 0.02);
    };
    const burst = (dur: number, vol: number, freq: number, q = 1) => {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(vol, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(f).connect(g).connect(out);
      src.start(now);
      src.stop(now + dur);
    };

    switch (name) {
      case 'shot': burst(0.08, 0.18, 1800, 0.8); break;
      case 'rifle': burst(0.14, 0.25, 900, 0.6); tone('square', 140, 60, 0.06, 0.05); break;
      case 'hit': tone('sawtooth', 220, 90, 0.12, 0.08); break;
      case 'groan': tone('sawtooth', 95 + Math.random() * 30, 60, 0.7, 0.05); break;
      case 'die': tone('triangle', 300, 70, 0.5, 0.15); break;
      case 'place': tone('square', 520, 380, 0.05, 0.05); break;
      case 'click': tone('sine', 880, 700, 0.04, 0.06); break;
      case 'build': burst(0.12, 0.2, 300, 1.5); tone('sine', 180, 120, 0.15, 0.12); break;
      case 'coin': tone('square', 988, 988, 0.08, 0.06); tone('square', 1319, 1319, 0.22, 0.06, 0.08); break;
      case 'error': tone('square', 160, 120, 0.15, 0.06); break;
      case 'boom': burst(0.9, 0.5, 120, 0.7); tone('sine', 90, 30, 0.8, 0.35); break;
      case 'horn': tone('sawtooth', 110, 104, 1.3, 0.09); tone('sawtooth', 165, 156, 1.3, 0.06); break;
      case 'dawn': [523, 659, 784].forEach((f, i) => tone('triangle', f, f, 0.4, 0.07, i * 0.12)); break;
    }
  }
}

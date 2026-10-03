import type { SoundName } from '../game/game';

/** Tiny procedural sound engine — no audio files to ship or license. */
export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private last = new Map<SoundName, number>();
  private noise: AudioBuffer | null = null;

  get context(): AudioContext | null { return this.ctx; }

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

/**
 * Procedural soundtrack. Day: a slow, melancholy pad progression with sparse
 * plucked notes. Night: a low drone and a heartbeat that quickens as the horde
 * grows. Crossfades with the day/night cycle; nothing to license or ship.
 */
export class Music {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dayBus!: GainNode;
  private nightBus!: GainNode;
  private nextChord = 0;
  private nextPluck = 0;
  private nextBeat = 0;
  private chord = 0;
  private mood: 'day' | 'night' = 'day';
  private threat = 0;
  private on = true;

  constructor(private sfx: Sfx) {}

  get enabled() { return this.on; }
  set enabled(v: boolean) {
    this.on = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v ? 0.16 : 0, this.ctx.currentTime, 0.3);
  }

  setMood(mood: 'day' | 'night', zombies: number) {
    this.threat = zombies;
    if (!this.ctx) this.start();
    if (!this.ctx || mood === this.mood) return;
    this.mood = mood;
    const t = this.ctx.currentTime;
    this.dayBus.gain.setTargetAtTime(mood === 'day' ? 1 : 0.2, t, 2.5);
    this.nightBus.gain.setTargetAtTime(mood === 'night' ? 1 : 0, t, 2.5);
  }

  private start() {
    const c = this.sfx.context;
    if (!c) return; // waits for the first tap to unlock audio
    this.ctx = c;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    this.master = c.createGain();
    this.master.gain.value = 0;
    this.master.gain.setTargetAtTime(this.on ? 0.16 : 0, c.currentTime, 1.5);
    this.master.connect(lp).connect(c.destination);
    this.dayBus = c.createGain();
    this.nightBus = c.createGain();
    this.dayBus.gain.value = this.mood === 'day' ? 1 : 0.2;
    this.nightBus.gain.value = this.mood === 'night' ? 1 : 0;
    this.dayBus.connect(this.master);
    this.nightBus.connect(this.master);

    // night drone: two detuned saws through a slowly breathing filter
    const droneF = c.createBiquadFilter();
    droneF.type = 'lowpass';
    droneF.frequency.value = 220;
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(droneF.frequency);
    const dg = c.createGain();
    dg.gain.value = 0.35;
    for (const f of [55, 55.4, 82.4]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(droneF);
      o.start();
    }
    droneF.connect(dg).connect(this.nightBus);
    lfo.start();

    this.nextChord = this.nextPluck = this.nextBeat = c.currentTime + 0.2;
    setInterval(() => this.tick(), 200);
  }

  private tick() {
    const c = this.ctx;
    if (!c || c.state !== 'running' || !this.on) return;
    const now = c.currentTime;
    const ahead = now + 0.6;
    if (this.nextChord < now) this.nextChord = now;
    if (this.nextPluck < now) this.nextPluck = now;
    if (this.nextBeat < now) this.nextBeat = now;
    // A minor – F – C – G, voiced low and soft
    const CHORDS = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 261.6, 329.6], [196, 246.9, 293.7]];
    while (this.nextChord < ahead) {
      const notes = CHORDS[this.chord % CHORDS.length];
      for (const f of notes) this.pad(f, this.nextChord, 4.4);
      this.pad(notes[0] / 2, this.nextChord, 4.4, 0.6);
      this.chord++;
      this.nextChord += 4;
    }
    // A minor pentatonic plucks, sparse
    const SCALE = [440, 523.3, 587.3, 659.3, 784, 880];
    while (this.nextPluck < ahead) {
      if (Math.random() < 0.55) this.pluck(SCALE[Math.floor(Math.random() * SCALE.length)], this.nextPluck);
      this.nextPluck += 0.75 + Math.random() * 1.5;
    }
    // night heartbeat: 58 bpm calm, up to ~120 bpm when the horde is large
    const bpm = 58 + Math.min(62, this.threat * 0.8);
    while (this.nextBeat < ahead) {
      if (this.mood === 'night') { this.thump(this.nextBeat, 1); this.thump(this.nextBeat + 0.18, 0.6); }
      this.nextBeat += 60 / bpm;
    }
  }

  private pad(f: number, t: number, dur: number, vol = 1) {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07 * vol, t + 1.4);
    g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(this.dayBus);
    for (const det of [-6, 6]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  private pluck(f: number, t: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g).connect(this.dayBus);
    o.start(t);
    o.stop(t + 1.7);
  }

  private thump(t: number, vol: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.14);
    g.gain.setValueAtTime(0.55 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.nightBus);
    o.start(t);
    o.stop(t + 0.25);
  }
}

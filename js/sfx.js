class SoundEngine {
  constructor() {
    this._ctx = null;
    this._master = null;
    this._muted = false;
    this._noiseBuffer = null;
  }

  _ensureContext() {
    if (this._muted) return null;
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this._ctx) {
      try {
        this._ctx = new AudioCtx();
        this._master = this._ctx.createGain();
        this._master.gain.value = 0.32;
        this._master.connect(this._ctx.destination);
      } catch {
        return null;
      }
    }

    if (this._ctx.state === 'suspended') {
      this._ctx.resume().catch(() => {});
    }

    return this._ctx;
  }

  _getNoiseBuffer(ctx) {
    if (this._noiseBuffer && this._noiseBuffer.sampleRate === ctx.sampleRate) {
      return this._noiseBuffer;
    }
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this._noiseBuffer = buffer;
    return buffer;
  }

  _tone({
    type = 'sine',
    freq = 440,
    endFreq = null,
    duration = 0.12,
    gain = 0.3,
    delay = 0,
    attack = 0.008,
  }) {
    const ctx = this._ensureContext();
    if (!ctx || !this._master) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), now);
    if (endFreq !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    }

    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(gain, now + Math.min(attack, duration * 0.4));
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(g);
    g.connect(this._master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  _noise({
    duration = 0.14,
    gain = 0.25,
    filterType = 'bandpass',
    freq = 1200,
    endFreq = null,
    q = 1.2,
    delay = 0,
  }) {
    const ctx = this._ensureContext();
    if (!ctx || !this._master) return;

    const now = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this._getNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(Math.max(40, freq), now);
    if (endFreq !== null) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), now + duration);
    }
    filter.Q.value = q;

    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    src.connect(filter);
    filter.connect(g);
    g.connect(this._master);

    src.start(now);
    src.stop(now + duration + 0.02);
  }

  unlock() {
    const ctx = this._ensureContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  setMuted(muted) {
    this._muted = Boolean(muted);
    if (this._master && this._ctx) {
      this._master.gain.setValueAtTime(this._muted ? 0 : 0.32, this._ctx.currentTime);
    }
  }

  isMuted() {
    return this._muted;
  }

  playTick() {
    this._tone({ type: 'triangle', freq: 720, endFreq: 520, duration: 0.055, gain: 0.22 });
  }

  playWarning() {
    this._tone({ type: 'square', freq: 880, endFreq: 940, duration: 0.09, gain: 0.22 });
    this._tone({ type: 'square', freq: 1175, endFreq: 1175, duration: 0.11, gain: 0.2, delay: 0.1 });
  }

  playDrawStart() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this._tone({ type: 'triangle', freq: f, duration: 0.13, gain: 0.24, delay: i * 0.065 });
    });
  }

  playFinish() {
    this._tone({ type: 'sawtooth', freq: 659.25, endFreq: 659.25, duration: 0.18, gain: 0.22 });
    this._tone({ type: 'sawtooth', freq: 880, endFreq: 987.77, duration: 0.34, gain: 0.24, delay: 0.16 });
    this._tone({ type: 'triangle', freq: 1318.5, duration: 0.38, gain: 0.2, delay: 0.16 });
  }

  playJump() {
    this._tone({ type: 'sine', freq: 240, endFreq: 560, duration: 0.11, gain: 0.24 });
    this._tone({ type: 'triangle', freq: 340, endFreq: 680, duration: 0.08, gain: 0.12, delay: 0.02 });
  }

  playHit(heavy = false) {
    if (heavy) {
      this._tone({ type: 'sawtooth', freq: 185, endFreq: 48, duration: 0.2, gain: 0.42 });
      this._tone({ type: 'square', freq: 420, endFreq: 110, duration: 0.12, gain: 0.22 });
      this._noise({ duration: 0.18, gain: 0.34, filterType: 'lowpass', freq: 2400, endFreq: 350 });
    } else {
      this._tone({ type: 'triangle', freq: 260, endFreq: 95, duration: 0.09, gain: 0.32 });
      this._noise({ duration: 0.075, gain: 0.22, filterType: 'bandpass', freq: 1800, endFreq: 700 });
    }
  }

  playSpecial(element = 'none') {
    switch (element) {
      case 'fire':
        this._noise({ duration: 0.28, gain: 0.34, filterType: 'bandpass', freq: 900, endFreq: 260, q: 0.9 });
        this._tone({ type: 'sawtooth', freq: 280, endFreq: 90, duration: 0.24, gain: 0.25 });
        break;
      case 'lightning':
        this._tone({ type: 'sawtooth', freq: 1400, endFreq: 220, duration: 0.14, gain: 0.26 });
        this._tone({ type: 'square', freq: 980, endFreq: 180, duration: 0.12, gain: 0.18, delay: 0.04 });
        this._noise({ duration: 0.16, gain: 0.24, filterType: 'highpass', freq: 2600 });
        break;
      case 'ice':
        this._tone({ type: 'sine', freq: 1320, endFreq: 2100, duration: 0.16, gain: 0.24 });
        this._tone({ type: 'triangle', freq: 1760, endFreq: 1100, duration: 0.2, gain: 0.18, delay: 0.05 });
        break;
      case 'star':
        [784, 987.77, 1174.66, 1567.98].forEach((f, i) => {
          this._tone({ type: 'sine', freq: f, duration: 0.11, gain: 0.22, delay: i * 0.04 });
        });
        break;
      default:
        this._tone({ type: 'sawtooth', freq: 340, endFreq: 780, duration: 0.15, gain: 0.24 });
        this._noise({ duration: 0.12, gain: 0.18, filterType: 'bandpass', freq: 1500, endFreq: 2600 });
        break;
    }
  }

  playShield() {
    this._tone({ type: 'sine', freq: 620, endFreq: 420, duration: 0.08, gain: 0.24 });
    this._tone({ type: 'triangle', freq: 960, endFreq: 740, duration: 0.07, gain: 0.16 });
  }

  playGrab() {
    this._tone({ type: 'triangle', freq: 300, endFreq: 480, duration: 0.07, gain: 0.24 });
    this._tone({ type: 'sine', freq: 520, endFreq: 380, duration: 0.09, gain: 0.2, delay: 0.055 });
  }

  playKO() {
    this._tone({ type: 'sawtooth', freq: 520, endFreq: 68, duration: 0.42, gain: 0.36 });
    this._noise({ duration: 0.38, gain: 0.36, filterType: 'lowpass', freq: 2200, endFreq: 180 });
    this._tone({ type: 'triangle', freq: 980, endFreq: 1480, duration: 0.22, gain: 0.2, delay: 0.08 });
  }

  playItem() {
    this._tone({ type: 'triangle', freq: 587.33, duration: 0.08, gain: 0.26 });
    this._tone({ type: 'triangle', freq: 880, duration: 0.11, gain: 0.26, delay: 0.065 });
    this._tone({ type: 'sine', freq: 1174.66, duration: 0.14, gain: 0.22, delay: 0.13 });
  }

  playStamp() {
    this._tone({ type: 'sine', freq: 540, endFreq: 840, duration: 0.09, gain: 0.22 });
    this._tone({ type: 'triangle', freq: 840, endFreq: 1020, duration: 0.09, gain: 0.18, delay: 0.05 });
  }

  playWin() {
    const melody = [
      { f: 523.25, d: 0.13, t: 0.0 },
      { f: 659.25, d: 0.13, t: 0.11 },
      { f: 783.99, d: 0.13, t: 0.22 },
      { f: 1046.5, d: 0.32, t: 0.34 },
      { f: 783.99, d: 0.12, t: 0.56 },
      { f: 1046.5, d: 0.45, t: 0.68 },
    ];
    for (const n of melody) {
      this._tone({ type: 'triangle', freq: n.f, duration: n.d, gain: 0.28, delay: n.t });
      this._tone({ type: 'sine', freq: n.f * 0.5, duration: n.d, gain: 0.14, delay: n.t });
    }
  }
}

export const sfx = new SoundEngine();

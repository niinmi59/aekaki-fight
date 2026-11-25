import { AVATAR_COLORS } from './shared.js';
import { buildCharacterSprite, drawFighter } from './character-renderer.js';
import { getStageConfig, drawStage } from './stages.js';
import { computeCPUInput } from './ai.js';
import { sfx } from './sfx.js';

const FIXED_DT = 1 / 60;
const SNAPSHOT_INTERVAL = 1 / 25;
const INPUT_SEND_INTERVAL = 1 / 30;
const HUD_INTERVAL = 1 / 15;
const MAX_ACTIVE_ITEMS = 2;

const ITEM_TYPES = [
  { type: 'hammer', label: 'ハンマー', color: '#ef4444', emoji: '🔨' },
  { type: 'bomb', label: '爆弾', color: '#1f2937', emoji: '💣' },
  { type: 'heal', label: '回復キノコ', color: '#22c55e', emoji: '🍄' },
  { type: 'giant', label: '巨大化キノコ', color: '#f59e0b', emoji: '⭐' },
];

const TEAM_COLORS = {
  A: '#ef4444',
  B: '#3b82f6',
};

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function normalizeStats(rawStats) {
  const s = rawStats || {};
  const sp = s.specialMove || {};
  return {
    attack: clamp(Number(s.attack) || 55, 25, 100),
    defense: clamp(Number(s.defense) || 55, 25, 100),
    speed: clamp(Number(s.speed) || 55, 25, 100),
    jump: clamp(Number(s.jump) || 55, 25, 100),
    weight: clamp(Number(s.weight) || 55, 25, 100),
    reach: clamp(Number(s.reach) || 55, 25, 100),
    grabPower: clamp(Number(s.grabPower) || 55, 25, 100),
    airJumps: clamp(Math.round(Number(s.airJumps) || 1), 1, 3),
    scale: clamp(Number(s.scale) || 1.0, 0.78, 1.32),
    aspectRatio: clamp(Number(s.aspectRatio) || 0.85, 0.45, 1.8),
    specialMove: {
      id: sp.id || 'ink_wave',
      name: sp.name || 'インクウェーブ',
      category: sp.category || 'バランス',
      element: sp.element || 'none',
      color: sp.color || '#3b82f6',
      description: sp.description || '',
      power: clamp(Number(sp.power) || 14, 8, 30),
      cooldown: clamp(Number(sp.cooldown) || 4.0, 2.2, 7.5),
    },
  };
}

function createEmptyInput() {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    jumpPressed: false,
    attackPressed: false,
    strongPressed: false,
    specialPressed: false,
    guard: false,
    grabPressed: false,
  };
}

export class BattleEngine {
  constructor(canvasEl, config = {}) {
    this.canvas = canvasEl;
    this.ctx = canvasEl ? canvasEl.getContext('2d') : null;
    this.config = config;

    this.stageId = config.stageId || 'notebook';
    this.stage = getStageConfig(this.stageId);
    this.mode = config.mode === 'time' ? 'time' : 'stock';
    this.stockCount = Math.max(1, Number(config.stockCount) || 3);
    this.timeLimit = Math.max(30, Number(config.timeLimit) || 120);
    this.teamMode = Boolean(config.teamMode);
    this.isHost = config.isHost !== undefined ? Boolean(config.isHost) : true;
    this.localPlayerId = config.localPlayerId || null;

    this.onStateBroadcast = typeof config.onStateBroadcast === 'function' ? config.onStateBroadcast : () => {};
    this.onEventBroadcast = typeof config.onEventBroadcast === 'function' ? config.onEventBroadcast : () => {};
    this.onLocalInput = typeof config.onLocalInput === 'function' ? config.onLocalInput : () => {};
    this.onHUDUpdate = typeof config.onHUDUpdate === 'function' ? config.onHUDUpdate : () => {};
    this.onBattleEnd = typeof config.onBattleEnd === 'function' ? config.onBattleEnd : () => {};

    // Ensure logical canvas dimensions
    if (this.canvas) {
      this.canvas.width = this.stage.width;
      this.canvas.height = this.stage.height;
    }

    // Match state
    this.phase = 'countdown'; // 'countdown' | 'playing' | 'finished'
    this.matchElapsed = 0;
    this.timeLeft = this.timeLimit;
    this.countdownTimer = 2.8;
    this.lastCountdownDigit = 4;
    this.endDelayTimer = 0;
    this.battleEndEmitted = false;
    this.banner = '3';
    this.bannerTimer = 0;

    // Combat & visual juice
    this.hitstopTimer = 0;
    this.shakeTimer = 0;
    this.shakeIntensity = 0;
    this.nextEntityId = 1;

    // Entities
    this.fighters = [];
    this.fighterMap = new Map();
    this.projectiles = [];
    this.items = [];
    this.particles = [];
    this.popTexts = [];
    this.koBeams = [];
    this.lightningBolts = [];
    this.slashArcs = [];

    this.itemSpawnTimer = 8.5 + Math.random() * 4.5;

    // Input state
    this.keys = new Set();
    this.virtualKeys = new Set();
    this.pendingLocalEdges = {
      jumpPressed: false,
      attackPressed: false,
      strongPressed: false,
      specialPressed: false,
      upSpecialPressed: false,
      grabPressed: false,
    };
    this.lastDownTapTime = -10;
    this.doubleDownDrop = false;
    this.inputSeq = 0;
    this.remoteInputs = new Map();

    // Loop timers
    this._running = false;
    this._destroyed = false;
    this._rafId = null;
    this._lastFrameTime = 0;
    this._accumulator = 0;
    this._snapshotTimer = 0;
    this._inputSendTimer = 0;
    this._hudTimer = 0;
    this._renderTime = 0;

    this._initFighters(config.players || []);
    this._bindEvents();

    if (config.autoStart !== false) {
      this.start();
    }
  }

  _initFighters(players) {
    const spawns = this.stage.spawnPoints;
    const list = players.length > 0 ? players : [];

    list.forEach((p, idx) => {
      const stats = normalizeStats(p.stats);
      const spawn = spawns[idx % spawns.length] || { x: 400 + idx * 140, y: 380 };
      const scale = stats.scale;
      const ratioFactor = clamp(Math.sqrt(stats.aspectRatio), 0.78, 1.24);
      const baseWidth = Math.round(clamp(56 * scale * ratioFactor, 40, 88));
      const baseHeight = Math.round(clamp(78 * scale / Math.sqrt(ratioFactor), 54, 108));

      let sprite = null;
      try {
        sprite = buildCharacterSprite(p.strokes || [], stats);
      } catch {
        sprite = null;
      }

      const color = p.color || AVATAR_COLORS[idx % AVATAR_COLORS.length];
      const maxAirJumps = Math.max(2, (stats.airJumps || 1) + 1);
      const fighter = {
        id: p.id || `p_${idx + 1}`,
        slot: idx,
        name: p.name || `P${idx + 1}`,
        color,
        team: p.team || (idx % 2 === 0 ? 'A' : 'B'),
        isCPU: Boolean(p.isCPU),
        cpuLevel: p.cpuLevel || 'normal',
        strokes: p.strokes || [],
        stats,
        sprite,

        // Position: x = horizontal center, y = bottom (feet)
        x: spawn.x,
        y: spawn.y,
        prevY: spawn.y,
        vx: 0,
        vy: 0,
        baseWidth,
        baseHeight,
        width: baseWidth,
        height: baseHeight,
        facing: spawn.x < this.stage.width / 2 ? 1 : -1,

        // Physics & platform flags
        onGround: false,
        onPassThrough: false,
        dropThroughTimer: 0,
        maxAirJumps,
        jumpsRemaining: maxAirJumps,
        upSpecialUsed: false,
        upSpecialLockout: 0,
        ledgeSide: 0, // -1 = left ledge, 1 = right ledge, 0 = none
        ledgeTimer: 0,
        ledgeRegrabCooldown: 0,

        // Action & animation state
        animState: 'idle',
        animTime: 0,
        action: null, // 'attack' | 'strong' | 'special' | 'grab' | 'throw' | 'dizzy'
        actionTimer: 0,
        actionDuration: 0,
        actionHitSet: new Set(),
        actionSubPhase: 0,
        comboCount: 0,
        comboResetTimer: 0,
        chargeRatio: 0,

        // Combat status
        damage: 0,
        stocks: this.mode === 'stock' ? this.stockCount : 99,
        maxStocks: this.mode === 'stock' ? this.stockCount : 0,
        isOut: false,
        respawnTimer: 0,
        respawnPlatTimer: 0,
        invulnTimer: 1.5,
        hitstunTimer: 0,
        hitFlash: 0,
        shieldActive: false,
        shieldHp: 100,
        specialCooldown: 0,

        // Item / status effects
        hammerTimer: 0,
        hammerSwingTimer: 0,
        giantTimer: 0,
        slowTimer: 0,

        // Grab target tracking
        grabbedTargetId: null,
        grabbedById: null,

        // Scoring
        kos: 0,
        falls: 0,
        damageDealt: 0,
        lastHitBy: null,
        lastHitTime: -99,

        // Client-side interpolation target
        netTarget: null,
      };

      this.fighters.push(fighter);
      this.fighterMap.set(fighter.id, fighter);
    });
  }

  _bindEvents() {
    this._onKeyDown = (e) => {
      if (this._destroyed) return;
      const tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) {
        return;
      }

      if (
        e.code === 'Space' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown' ||
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight'
      ) {
        e.preventDefault();
      }

      sfx.unlock();

      if (e.repeat) return;
      this.keys.add(e.code);

      if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'Space') {
        this.pendingLocalEdges.jumpPressed = true;
      }
      if (e.code === 'KeyJ' || e.code === 'KeyZ') {
        this.pendingLocalEdges.attackPressed = true;
      }
      if (e.code === 'KeyK' || e.code === 'KeyX') {
        this.pendingLocalEdges.strongPressed = true;
      }
      if (e.code === 'KeyL' || e.code === 'KeyC') {
        this.pendingLocalEdges.specialPressed = true;
        if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) {
          this.pendingLocalEdges.upSpecialPressed = true;
        }
      }
      if (e.code === 'KeyU' || e.code === 'KeyE' || e.code === 'KeyV') {
        this.pendingLocalEdges.grabPressed = true;
      }
      if (e.code === 'KeyS' || e.code === 'ArrowDown') {
        const now = performance.now() * 0.001;
        if (now - this.lastDownTapTime < 0.28) {
          this.doubleDownDrop = true;
        }
        this.lastDownTapTime = now;
      }
    };

    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
    };

    this._onBlur = () => {
      this.keys.clear();
      this.virtualKeys.clear();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKeyDown, { passive: false });
      window.addEventListener('keyup', this._onKeyUp);
      window.addEventListener('blur', this._onBlur);
    }
  }

  triggerVirtualInput(action, pressed) {
    if (this._destroyed) return;
    sfx.unlock();
    const key = String(action || '').toLowerCase();
    if (pressed) {
      const wasDown = this.virtualKeys.has(key);
      this.virtualKeys.add(key);
      if (!wasDown) {
        if (key === 'jump' || key === 'up') this.pendingLocalEdges.jumpPressed = true;
        if (key === 'attack') this.pendingLocalEdges.attackPressed = true;
        if (key === 'strong') this.pendingLocalEdges.strongPressed = true;
        if (key === 'special') {
          this.pendingLocalEdges.specialPressed = true;
          if (this.virtualKeys.has('up') || this.keys.has('KeyW') || this.keys.has('ArrowUp')) {
            this.pendingLocalEdges.upSpecialPressed = true;
          }
        }
        if (key === 'up_special' || key === 'recovery') {
          this.pendingLocalEdges.specialPressed = true;
          this.pendingLocalEdges.upSpecialPressed = true;
        }
        if (key === 'grab') this.pendingLocalEdges.grabPressed = true;
        if (key === 'down') {
          const now = performance.now() * 0.001;
          if (now - this.lastDownTapTime < 0.28) {
            this.doubleDownDrop = true;
          }
          this.lastDownTapTime = now;
        }
      }
    } else {
      this.virtualKeys.delete(key);
    }
  }

  _sampleLocalInput(consumeEdges = true) {
    const k = this.keys;
    const v = this.virtualKeys;

    const left = k.has('KeyA') || k.has('ArrowLeft') || v.has('left');
    const right = k.has('KeyD') || k.has('ArrowRight') || v.has('right');
    const up =
      k.has('KeyW') ||
      k.has('ArrowUp') ||
      v.has('up') ||
      v.has('up_special') ||
      v.has('recovery');
    const down = k.has('KeyS') || k.has('ArrowDown') || v.has('down');
    const jump = k.has('KeyW') || k.has('ArrowUp') || k.has('Space') || v.has('jump');
    const explicitGuard = k.has('ShiftLeft') || k.has('ShiftRight') || v.has('guard');
    const guard = explicitGuard || (down && !jump && !this.doubleDownDrop);

    const input = {
      left,
      right,
      up,
      down,
      jump,
      guard,
      dropDown: this.doubleDownDrop,
      jumpPressed: this.pendingLocalEdges.jumpPressed,
      attackPressed: this.pendingLocalEdges.attackPressed,
      strongPressed: this.pendingLocalEdges.strongPressed,
      specialPressed: this.pendingLocalEdges.specialPressed,
      upSpecialPressed: this.pendingLocalEdges.upSpecialPressed,
      grabPressed: this.pendingLocalEdges.grabPressed,
    };

    if (consumeEdges) {
      this.pendingLocalEdges.jumpPressed = false;
      this.pendingLocalEdges.attackPressed = false;
      this.pendingLocalEdges.strongPressed = false;
      this.pendingLocalEdges.specialPressed = false;
      this.pendingLocalEdges.upSpecialPressed = false;
      this.pendingLocalEdges.grabPressed = false;
      this.doubleDownDrop = false;
    }

    return input;
  }

  setRemoteInput(playerId, input) {
    if (!playerId || !input) return;
    let slot = this.remoteInputs.get(playerId);
    if (!slot) {
      slot = {
        seq: -1,
        state: createEmptyInput(),
        edges: {
          jumpPressed: false,
          attackPressed: false,
          strongPressed: false,
          specialPressed: false,
          upSpecialPressed: false,
          grabPressed: false,
          dropDown: false,
        },
      };
      this.remoteInputs.set(playerId, slot);
    }

    if (typeof input.seq === 'number' && input.seq <= slot.seq) {
      return;
    }
    if (typeof input.seq === 'number') {
      slot.seq = input.seq;
    }

    slot.state.left = Boolean(input.left);
    slot.state.right = Boolean(input.right);
    slot.state.up = Boolean(input.up);
    slot.state.down = Boolean(input.down);
    slot.state.jump = Boolean(input.jump);
    slot.state.guard = Boolean(input.guard);

    if (input.jumpPressed) slot.edges.jumpPressed = true;
    if (input.attackPressed) slot.edges.attackPressed = true;
    if (input.strongPressed) slot.edges.strongPressed = true;
    if (input.specialPressed) slot.edges.specialPressed = true;
    if (input.upSpecialPressed) slot.edges.upSpecialPressed = true;
    if (input.grabPressed) slot.edges.grabPressed = true;
    if (input.dropDown) slot.edges.dropDown = true;
  }

  _consumeRemoteInput(playerId) {
    const slot = this.remoteInputs.get(playerId);
    if (!slot) return createEmptyInput();

    const out = {
      left: slot.state.left,
      right: slot.state.right,
      up: slot.state.up,
      down: slot.state.down,
      jump: slot.state.jump,
      guard: slot.state.guard,
      jumpPressed: slot.edges.jumpPressed,
      attackPressed: slot.edges.attackPressed,
      strongPressed: slot.edges.strongPressed,
      specialPressed: slot.edges.specialPressed,
      upSpecialPressed: slot.edges.upSpecialPressed,
      grabPressed: slot.edges.grabPressed,
      dropDown: slot.edges.dropDown,
    };

    slot.edges.jumpPressed = false;
    slot.edges.attackPressed = false;
    slot.edges.strongPressed = false;
    slot.edges.specialPressed = false;
    slot.edges.upSpecialPressed = false;
    slot.edges.grabPressed = false;
    slot.edges.dropDown = false;
    return out;
  }

  start() {
    if (this._running || this._destroyed) return;
    this._running = true;
    this._lastFrameTime = performance.now();
    this._emitHUD();

    const loop = (now) => {
      if (!this._running || this._destroyed) return;
      const rawDt = Math.min(0.08, Math.max(0, (now - this._lastFrameTime) / 1000));
      this._lastFrameTime = now;
      this._renderTime += rawDt;

      this._accumulator += rawDt;
      while (this._accumulator >= FIXED_DT) {
        this._step(FIXED_DT);
        this._accumulator -= FIXED_DT;
      }

      this._render();
      this._rafId = requestAnimationFrame(loop);
    };

    this._rafId = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  destroy() {
    this._destroyed = true;
    this.stop();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
      window.removeEventListener('blur', this._onBlur);
    }
  }

  promoteToHost() {
    if (this.isHost) return;
    this.isHost = true;
    this._snapshotTimer = 0;
    if (this.phase === 'finished' && this.endDelayTimer <= 0 && !this.battleEndEmitted) {
      this.endDelayTimer = 0.8;
    }
    for (const f of this.fighters) {
      if (f.netTarget) {
        f.x = f.netTarget.x;
        f.y = f.netTarget.y;
        f.vx = f.netTarget.vx;
        f.vy = f.netTarget.vy;
        f.netTarget = null;
      }
    }
    this._emitHUD();
  }

  _isInsaneBoss(f) {
    return Boolean(f && f.isCPU && f.cpuLevel === 'insane');
  }

  _getEffectiveSpecialCooldown(f) {
    const base = f.stats.specialMove.cooldown || 4.0;
    return this._isInsaneBoss(f) ? base * 0.72 : base;
  }

  handlePlayerDisconnect(playerId) {
    const f = this.fighterMap.get(playerId);
    if (!f) return;
    f.isCPU = true;
    if (!f.cpuLevel) f.cpuLevel = 'normal';
    this.remoteInputs.delete(playerId);
    this._emitHUD();
  }

  _step(dt) {
    // Update screen shake & visual FX even during hitstop
    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    }
    this._updateEffects(dt);

    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      return;
    }

    if (this.isHost) {
      this._stepHost(dt);
    } else {
      this._stepClient(dt);
    }

    this._hudTimer += dt;
    if (this._hudTimer >= HUD_INTERVAL) {
      this._hudTimer = 0;
      this._emitHUD();
    }
  }

  _stepHost(dt) {
    // Phase transitions
    if (this.phase === 'countdown') {
      this.countdownTimer -= dt;
      const digit = Math.ceil(this.countdownTimer);
      if (this.countdownTimer <= 0.45) {
        if (this.banner !== 'GO!') {
          this.banner = 'GO!';
          sfx.playDrawStart();
          this._broadcastEvent({ type: 'sfx', sound: 'go' });
          this._emitHUD();
        }
      } else if (digit !== this.lastCountdownDigit && digit >= 1 && digit <= 3) {
        this.lastCountdownDigit = digit;
        this.banner = String(digit);
        sfx.playTick();
        this._broadcastEvent({ type: 'sfx', sound: 'tick' });
        this._emitHUD();
      }
      if (this.countdownTimer <= 0) {
        this.phase = 'playing';
        this.banner = '';
        this._emitHUD();
      }
      // Gentle idle animation while counting down
      for (const f of this.fighters) {
        f.animTime += dt;
        this._applyPhysicsStep(f, createEmptyInput(), dt, false);
      }
    } else if (this.phase === 'playing') {
      this.matchElapsed += dt;
      if (this.mode === 'time') {
        const prevSec = Math.ceil(this.timeLeft);
        this.timeLeft = Math.max(0, this.timeLeft - dt);
        const curSec = Math.ceil(this.timeLeft);
        if (curSec !== prevSec && curSec <= 5 && curSec > 0) {
          sfx.playWarning();
          this._broadcastEvent({ type: 'sfx', sound: 'warning' });
        }
        if (this.timeLeft <= 0) {
          this._triggerMatchEnd();
        }
      } else {
        this.timeLeft = Math.max(0, this.timeLimit - this.matchElapsed);
      }

      if (this.bannerTimer > 0) {
        this.bannerTimer = Math.max(0, this.bannerTimer - dt);
        if (this.bannerTimer <= 0) this.banner = '';
      }

      // Gather inputs & update fighters
      const battleStateForAI = {
        stage: this.stage,
        fighters: this.fighters,
        items: this.items,
        projectiles: this.projectiles,
        teamMode: this.teamMode,
      };

      for (const f of this.fighters) {
        let input;
        if (f.isCPU) {
          input = computeCPUInput(f, battleStateForAI, dt);
        } else if (f.id === this.localPlayerId) {
          input = this._sampleLocalInput(true);
        } else {
          input = this._consumeRemoteInput(f.id);
        }

        this._updateFighterHost(f, input, dt);
      }

      this._updateProjectilesHost(dt);
      this._updateItemsHost(dt);
      this._checkWinConditionHost();
    } else if (this.phase === 'finished') {
      this.endDelayTimer -= dt;
      for (const f of this.fighters) {
        f.animTime += dt;
      }
      if (this.endDelayTimer <= 0 && !this.battleEndEmitted) {
        this.battleEndEmitted = true;
        const result = this._buildMatchResult();
        this.onBattleEnd(result);
      }
    }

    // Broadcast authoritative snapshot at ~25Hz
    this._snapshotTimer += dt;
    if (this._snapshotTimer >= SNAPSHOT_INTERVAL) {
      this._snapshotTimer = 0;
      this.onStateBroadcast(this._createSnapshot());
    }
  }

  _stepClient(dt) {
    // Capture local input and send to host at ~30Hz (or immediately on edge press)
    const hasEdge =
      this.pendingLocalEdges.jumpPressed ||
      this.pendingLocalEdges.attackPressed ||
      this.pendingLocalEdges.strongPressed ||
      this.pendingLocalEdges.specialPressed ||
      this.pendingLocalEdges.upSpecialPressed ||
      this.pendingLocalEdges.grabPressed ||
      this.doubleDownDrop;

    const localInput = this._sampleLocalInput(true);
    this._inputSendTimer += dt;
    if (hasEdge || this._inputSendTimer >= INPUT_SEND_INTERVAL) {
      this._inputSendTimer = 0;
      this.inputSeq += 1;
      this.onLocalInput({ ...localInput, seq: this.inputSeq });
    }

    // Local prediction for crisp feel on local fighter + smooth lerp for remote fighters
    for (const f of this.fighters) {
      f.animTime += dt;
      if (f.hitFlash > 0) f.hitFlash = Math.max(0, f.hitFlash - dt);

      if (f.id === this.localPlayerId && !f.isCPU && this.phase === 'playing' && !f.isOut && f.respawnTimer <= 0) {
        // Predict movement & jumping locally
        if (f.hitstunTimer <= 0 && !f.action && !f.grabbedById) {
          this._applyPhysicsStep(f, localInput, dt, true);
        } else {
          this._applyPhysicsStep(f, createEmptyInput(), dt, false);
        }
        // Soft reconciliation toward latest host state
        if (f.netTarget) {
          const errX = f.netTarget.x - f.x;
          const errY = f.netTarget.y - f.y;
          const dist = Math.hypot(errX, errY);
          if (dist > 115 || f.hitstunTimer > 0) {
            f.x = f.netTarget.x;
            f.y = f.netTarget.y;
            f.vx = f.netTarget.vx;
            f.vy = f.netTarget.vy;
          } else if (dist > 6) {
            f.x += errX * 0.28;
            f.y += errY * 0.28;
          }
        }
      } else if (f.netTarget) {
        const errX = f.netTarget.x - f.x;
        const errY = f.netTarget.y - f.y;
        const dist = Math.hypot(errX, errY);
        if (dist > 180) {
          f.x = f.netTarget.x;
          f.y = f.netTarget.y;
        } else {
          f.x += errX * 0.36;
          f.y += errY * 0.36;
        }
        f.vx = f.netTarget.vx;
        f.vy = f.netTarget.vy;
      }
    }

    // Extrapolate client projectiles gently between snapshots
    for (const proj of this.projectiles) {
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      if (proj.gravity) proj.vy += proj.gravity * dt;
      proj.age = (proj.age || 0) + dt;
    }
  }

  _updateFighterHost(f, input, dt) {
    if (f.isOut) return;

    f.animTime += dt;
    if (f.hitFlash > 0) f.hitFlash = Math.max(0, f.hitFlash - dt);
    if (f.invulnTimer > 0) f.invulnTimer = Math.max(0, f.invulnTimer - dt);
    if (f.specialCooldown > 0) f.specialCooldown = Math.max(0, f.specialCooldown - dt);
    if (f.ledgeRegrabCooldown > 0) f.ledgeRegrabCooldown = Math.max(0, f.ledgeRegrabCooldown - dt);
    if (f.upSpecialLockout > 0) f.upSpecialLockout = Math.max(0, f.upSpecialLockout - dt);
    if (f.comboResetTimer > 0) {
      f.comboResetTimer = Math.max(0, f.comboResetTimer - dt);
      if (f.comboResetTimer <= 0) f.comboCount = 0;
    }
    if (f.slowTimer > 0) {
      f.slowTimer = Math.max(0, f.slowTimer - dt);
      if (Math.random() < 0.25) {
        this._spawnParticle(f.x + (Math.random() - 0.5) * f.width, f.y - Math.random() * f.height, 0, -25, '#38bdf8', 4, 0.35);
      }
    }
    if (f.giantTimer > 0) {
      f.giantTimer = Math.max(0, f.giantTimer - dt);
    }
    const sizeMult = f.giantTimer > 0 ? 1.45 : 1.0;
    f.width = Math.round(f.baseWidth * sizeMult);
    f.height = Math.round(f.baseHeight * sizeMult);

    // Respawn countdown
    if (f.respawnTimer > 0) {
      f.respawnTimer = Math.max(0, f.respawnTimer - dt);
      if (f.respawnTimer <= 0) {
        const offset = ((f.slot % 4) - 1.5) * 90;
        f.x = this.stage.width * 0.5 + offset;
        f.y = 185;
        f.prevY = f.y;
        f.vx = 0;
        f.vy = 0;
        f.damage = 0;
        f.hitstunTimer = 0;
        f.action = null;
        f.shieldHp = 100;
        f.shieldActive = false;
        f.hammerTimer = 0;
        f.giantTimer = 0;
        f.slowTimer = 0;
        f.invulnTimer = 2.4;
        f.respawnPlatTimer = 2.2;
        f.jumpsRemaining = f.maxAirJumps;
        f.upSpecialUsed = false;
        f.upSpecialLockout = 0;
        f.ledgeSide = 0;
        f.ledgeTimer = 0;
        f.ledgeRegrabCooldown = 0;
        f.animState = 'idle';
      }
      return;
    }

    // Floating invulnerable respawn platform
    if (f.respawnPlatTimer > 0) {
      f.respawnPlatTimer = Math.max(0, f.respawnPlatTimer - dt);
      f.vx = 0;
      f.vy = 0;
      f.onGround = true;
      f.animState = 'idle';
      if (
        input.left ||
        input.right ||
        input.jumpPressed ||
        input.attackPressed ||
        input.strongPressed ||
        input.specialPressed ||
        input.grabPressed ||
        input.down
      ) {
        f.respawnPlatTimer = 0;
      } else {
        return;
      }
    }

    // Ledge Grab (崖つかまり) hanging state
    if (f.ledgeSide !== 0) {
      this._updateLedgeHang(f, input, dt);
      return;
    }

    // Being grabbed by someone else
    if (f.grabbedById) {
      const grabber = this.fighterMap.get(f.grabbedById);
      if (!grabber || grabber.action !== 'throw') {
        f.grabbedById = null;
      } else {
        f.x = grabber.x + grabber.facing * (grabber.width * 0.55 + 18);
        f.y = grabber.y - 10;
        f.vx = 0;
        f.vy = 0;
        f.animState = 'hurt';
        return;
      }
    }

    // Hammer powerup auto-swing!
    if (f.hammerTimer > 0) {
      f.hammerTimer = Math.max(0, f.hammerTimer - dt);
      f.hammerSwingTimer -= dt;
      f.shieldActive = false;
      if (f.hammerSwingTimer <= 0) {
        f.hammerSwingTimer = 0.25;
        const reach = 74 + (f.giantTimer > 0 ? 30 : 0);
        this._checkMeleeHitbox(f, {
          rangeX: reach,
          rangeY: f.height * 1.15,
          damage: 16,
          baseKb: 440,
          kbScale: 6.4,
          angle: 0.65,
          heavy: true,
          popText: 'BONK!',
          hitSet: new Set(),
        });
      }
    }

    // Hitstun check
    if (f.hitstunTimer > 0) {
      f.hitstunTimer = Math.max(0, f.hitstunTimer - dt);
      f.shieldActive = false;
      f.action = null;
      f.chargeRatio = 0;
      f.animState = 'hurt';
      this._applyPhysicsStep(f, createEmptyInput(), dt, false);

      // Launch smoke trail on high velocity
      if (Math.hypot(f.vx, f.vy) > 420 && Math.random() < 0.6) {
        this._spawnParticle(
          f.x,
          f.y - f.height * 0.5,
          -f.vx * 0.08 + (Math.random() - 0.5) * 35,
          -f.vy * 0.08 + (Math.random() - 0.5) * 35,
          '#e2e8f0',
          6 + Math.random() * 5,
          0.35
        );
      }

      this._checkBlastZone(f);
      return;
    }

    // Dizzy (shield broken)
    if (f.action === 'dizzy') {
      f.actionTimer += dt;
      f.shieldActive = false;
      f.animState = 'dizzy';
      this._applyPhysicsStep(f, createEmptyInput(), dt, false);
      if (Math.random() < 0.2) {
        this._spawnParticle(
          f.x + Math.cos(f.animTime * 8) * 24,
          f.y - f.height - 10,
          0,
          -20,
          '#facc15',
          5,
          0.3
        );
      }
      if (f.actionTimer >= f.actionDuration) {
        f.action = null;
        f.shieldHp = 60;
      }
      this._checkBlastZone(f);
      return;
    }

    // Active combat action execution
    if (f.action) {
      this._updateActiveAction(f, input, dt);
      this._checkBlastZone(f);
      return;
    }

    // Guard / Shield handling
    const isBoss = this._isInsaneBoss(f);
    const canGuard = f.onGround && f.hammerTimer <= 0 && f.shieldHp > 8;
    if (input.guard && canGuard) {
      f.shieldActive = true;
      f.shieldHp = Math.max(0, f.shieldHp - (isBoss ? 10 : 14) * dt);
      f.animState = 'guard';
      this._applyPhysicsStep(f, createEmptyInput(), dt, false);
      if (f.shieldHp <= 0) {
        this._triggerShieldBreak(f);
      }
      this._checkBlastZone(f);
      return;
    } else {
      f.shieldActive = false;
      f.shieldHp = Math.min(100, f.shieldHp + (isBoss ? 32 : 20) * dt);
    }

    // Trigger new combat actions (disabled while swinging hammer)
    if (f.hammerTimer <= 0) {
      // Universal Up+Special Recovery Boost (↑ + L/C): usable once per airtime, independent of special cooldown!
      if ((input.upSpecialPressed || (input.specialPressed && input.up)) && !f.upSpecialUsed && f.upSpecialLockout <= 0) {
        this._startUpSpecialRecovery(f, input);
        this._checkBlastZone(f);
        return;
      }
      if (input.specialPressed && f.specialCooldown <= 0) {
        this._startSpecialMove(f, input);
        this._checkBlastZone(f);
        return;
      }
      if (input.grabPressed) {
        this._startGrab(f);
        this._checkBlastZone(f);
        return;
      }
      if (input.strongPressed) {
        this._startStrongAttack(f);
        this._checkBlastZone(f);
        return;
      }
      if (input.attackPressed) {
        this._startNormalAttack(f);
        this._checkBlastZone(f);
        return;
      }
    }

    // Standard movement & jumping
    this._applyPhysicsStep(f, input, dt, true);

    // Determine locomotion animState
    if (!f.onGround) {
      f.animState = f.vy < 40 ? 'jump' : 'fall';
    } else if (Math.abs(f.vx) > 25) {
      f.animState = 'walk';
    } else {
      f.animState = 'idle';
    }

    this._checkBlastZone(f);
  }

  _getMainPlatform() {
    return this.stage.platforms.find((p) => !p.passThrough) || this.stage.platforms[0];
  }

  _updateLedgeHang(f, input, dt) {
    const mainPlat = this._getMainPlatform();
    const cornerX = f.ledgeSide === -1 ? mainPlat.x : mainPlat.x + mainPlat.w;
    const inwardDir = -f.ledgeSide; // left ledge (-1) -> inward +1; right ledge (+1) -> inward -1

    f.ledgeTimer += dt;
    f.x = cornerX + f.ledgeSide * 14;
    f.y = mainPlat.y + f.height * 0.62;
    f.prevY = f.y;
    f.vx = 0;
    f.vy = 0;
    f.facing = inwardDir;
    f.onGround = false;
    f.shieldActive = false;
    f.animState = 'ledge';

    const pressInward = (inwardDir > 0 && input.right) || (inwardDir < 0 && input.left);
    const wantJump = input.jumpPressed || (f.ledgeTimer > 0.14 && input.up);
    const wantClimb =
      f.ledgeTimer >= 1.8 ||
      (f.ledgeTimer > 0.12 && (pressInward || input.attackPressed || input.strongPressed || input.specialPressed));
    const wantDrop = f.ledgeTimer > 0.16 && input.down;

    if (wantJump) {
      f.ledgeSide = 0;
      f.ledgeTimer = 0;
      f.ledgeRegrabCooldown = 0.45;
      f.x = cornerX + inwardDir * 24;
      f.y = mainPlat.y - 4;
      f.prevY = f.y;
      f.vx = inwardDir * 195;
      f.vy = -500;
      f.invulnTimer = Math.max(f.invulnTimer, 0.25);
      f.animState = 'jump';
      f.animTime = 0;
      this._spawnDust(cornerX, mainPlat.y, 6, '#bae6fd');
      sfx.playJump();
      this._broadcastEvent({ type: 'sfx', sound: 'jump', x: cornerX, y: mainPlat.y });
    } else if (wantClimb) {
      f.ledgeSide = 0;
      f.ledgeTimer = 0;
      f.ledgeRegrabCooldown = 0.45;
      f.x = cornerX + inwardDir * 44;
      f.y = mainPlat.y;
      f.prevY = f.y;
      f.vx = inwardDir * 115;
      f.vy = 0;
      f.onGround = true;
      f.invulnTimer = Math.max(f.invulnTimer, 0.28);
      f.animState = 'walk';
      f.animTime = 0;
      this._spawnDust(f.x, f.y, 6);
    } else if (wantDrop) {
      f.ledgeSide = 0;
      f.ledgeTimer = 0;
      f.ledgeRegrabCooldown = 0.5;
      f.vy = 90;
      f.animState = 'fall';
    }
  }

  _tryLedgeGrab(f, input) {
    if (!this.isHost) return false;
    if (f.onGround || f.ledgeSide !== 0 || f.ledgeRegrabCooldown > 0) return false;
    if (f.hitstunTimer > 0 || f.action === 'dizzy' || f.grabbedById) return false;
    if (input && input.down) return false;
    if (f.vy < -140) return false;

    const mainPlat = this._getMainPlatform();
    if (!mainPlat) return false;

    const handY = f.y - f.height * 0.65;
    const grabRadius = 46;

    // Check left corner
    const distLeft = Math.hypot(f.x - mainPlat.x, handY - mainPlat.y);
    if (distLeft <= grabRadius && f.x <= mainPlat.x + 26) {
      this._snapToLedge(f, -1, mainPlat);
      return true;
    }

    // Check right corner
    const rightX = mainPlat.x + mainPlat.w;
    const distRight = Math.hypot(f.x - rightX, handY - mainPlat.y);
    if (distRight <= grabRadius && f.x >= rightX - 26) {
      this._snapToLedge(f, 1, mainPlat);
      return true;
    }

    return false;
  }

  _snapToLedge(f, side, mainPlat) {
    const cornerX = side === -1 ? mainPlat.x : mainPlat.x + mainPlat.w;
    f.ledgeSide = side;
    f.ledgeTimer = 0;
    f.x = cornerX + side * 14;
    f.y = mainPlat.y + f.height * 0.62;
    f.prevY = f.y;
    f.vx = 0;
    f.vy = 0;
    f.facing = -side;
    f.onGround = false;
    f.action = null;
    f.chargeRatio = 0;
    f.jumpsRemaining = f.maxAirJumps;
    f.upSpecialUsed = false;
    f.invulnTimer = Math.max(f.invulnTimer, 0.65);
    f.animState = 'ledge';
    f.animTime = 0;

    sfx.playGrab();
    this._spawnBurst(cornerX, mainPlat.y, '#facc15', 10);
    this._spawnPopText(cornerX, mainPlat.y - 26, 'LEDGE!', '#f59e0b');
    this._broadcastEvent({
      type: 'ledge_grab',
      fighterId: f.id,
      x: cornerX,
      y: mainPlat.y,
    });
  }

  _startUpSpecialRecovery(f, input) {
    const mainPlat = this._getMainPlatform();
    const stageCenterX = mainPlat ? mainPlat.x + mainPlat.w * 0.5 : this.stage.width * 0.5;
    let dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir === 0 && mainPlat && (f.x < mainPlat.x || f.x > mainPlat.x + mainPlat.w)) {
      dir = f.x < stageCenterX ? 1 : -1;
    }
    if (dir !== 0) f.facing = dir;

    const wingBonus = (f.stats.airJumps || 1) >= 2 ? 75 : 0;
    const bossAgility = this._isInsaneBoss(f) ? 1.06 : 1.0;

    f.action = 'up_special';
    f.actionTimer = 0;
    f.actionDuration = 0.44;
    f.actionHitSet = new Set();
    f.actionSubPhase = 0;
    f.upSpecialUsed = true;
    f.upSpecialLockout = 0.25;
    f.onGround = false;
    f.onPassThrough = false;
    f.animState = 'recovery';
    f.animTime = 0;

    f.vy = -(640 + f.stats.jump * 1.9 + wingBonus) * bossAgility;
    f.vx = (dir !== 0 ? dir : f.facing * 0.45) * (285 + f.stats.speed * 1.05) * bossAgility;

    sfx.playSpecial('star');
    this._spawnBurst(f.x, f.y - f.height * 0.3, '#38bdf8', 14);
    this._spawnPopText(f.x, f.y - f.height - 10, '復帰ジャンプ!', '#0284c7');
    this._broadcastEvent({
      type: 'up_special',
      fighterId: f.id,
      x: f.x,
      y: f.y - f.height * 0.4,
      color: '#38bdf8',
    });
  }

  _applyPhysicsStep(f, input, dt, allowControl) {
    const slowMult = f.slowTimer > 0 ? 0.65 : 1.0;
    const bossAgility = this._isInsaneBoss(f) ? 1.08 : 1.0;

    // Deliberate, controllable Smash-like ground speed (~228..327 px/s instead of 450..600 px/s!)
    const maxGroundSpeed = (185 + f.stats.speed * 1.45) * slowMult * bossAgility;
    const mainPlat = this._getMainPlatform();
    const offStageLeft = mainPlat && f.x < mainPlat.x;
    const offStageRight = mainPlat && f.x > mainPlat.x + mainPlat.w;
    const moveDir = allowControl ? (input.right ? 1 : 0) - (input.left ? 1 : 0) : 0;
    const steeringInwardOffstage =
      !f.onGround && ((offStageLeft && moveDir > 0) || (offStageRight && moveDir < 0));

    const maxAirSpeed = maxGroundSpeed * (steeringInwardOffstage ? 1.2 : 0.96);
    const groundAccel = maxGroundSpeed * 12.5;
    const airAccel = steeringInwardOffstage ? 1680 : 1420;
    const jumpVel = -(510 + f.stats.jump * 2.2) * (f.slowTimer > 0 ? 0.88 : 1.0) * bossAgility;
    const gravity = 1180 + (f.stats.weight - 50) * 3.2;

    if (f.dropThroughTimer > 0) {
      f.dropThroughTimer = Math.max(0, f.dropThroughTimer - dt);
    }

    // Horizontal movement
    if (allowControl) {
      if (moveDir !== 0) {
        f.facing = moveDir;
        const maxSpd = f.onGround ? maxGroundSpeed : maxAirSpeed;
        let accel = f.onGround ? groundAccel : airAccel;
        // Extra crisp turn-around braking on ground
        if (f.onGround && f.vx !== 0 && Math.sign(f.vx) !== moveDir) {
          accel *= 2.2;
        }
        const alreadyFasterSameDir = Math.sign(f.vx) === moveDir && Math.abs(f.vx) >= maxSpd;
        if (!alreadyFasterSameDir) {
          f.vx += moveDir * accel * dt;
          if (Math.sign(f.vx) === moveDir && Math.abs(f.vx) > maxSpd) {
            f.vx = moveDir * maxSpd;
          }
        } else {
          // Already moving faster than normal cap (e.g. knockback or dash): gently bleed back toward maxSpd
          const bleed = (f.onGround ? 1500 : 420) * dt;
          f.vx = moveDir * Math.max(maxSpd, Math.abs(f.vx) - bleed);
        }
      } else {
        // High ground stopping friction so releasing Left/Right stops crisply without sliding off ledges!
        const friction = f.onGround ? 2900 : 380;
        if (Math.abs(f.vx) <= friction * dt) {
          f.vx = 0;
        } else {
          f.vx -= Math.sign(f.vx) * friction * dt;
        }
      }

      // Drop through pass-through platforms (down + jump or double-tap down)
      if (f.onGround && f.onPassThrough && ((input.down && input.jumpPressed) || input.dropDown)) {
        f.dropThroughTimer = 0.24;
        f.onGround = false;
        f.onPassThrough = false;
        f.y += 4;
        f.vy = Math.max(f.vy, 140);
      } else if (input.jumpPressed) {
        if (f.onGround) {
          f.vy = jumpVel;
          f.onGround = false;
          f.onPassThrough = false;
          f.animState = 'jump';
          f.animTime = 0;
          this._spawnDust(f.x, f.y, 5);
          if (this.isHost) {
            sfx.playJump();
            this._broadcastEvent({ type: 'sfx', sound: 'jump', x: f.x, y: f.y });
          }
        } else if (f.jumpsRemaining > 0) {
          f.jumpsRemaining -= 1;
          f.vy = jumpVel * 0.94;
          // Give immediate inward air nudge on double jump when steering back to stage!
          if (moveDir !== 0) {
            f.vx = moveDir * Math.max(Math.abs(f.vx), maxAirSpeed * 0.85);
          }
          f.animState = 'jump';
          f.animTime = 0;
          this._spawnDust(f.x, f.y, 6, '#bae6fd');
          if (this.isHost) {
            sfx.playJump();
            this._broadcastEvent({ type: 'sfx', sound: 'jump', x: f.x, y: f.y });
          }
        }
      }

      // Fast fall when pressing down in air
      if (!f.onGround && input.down && f.vy > 0) {
        f.vy = Math.min(780, f.vy + gravity * 0.65 * dt);
      }
    } else {
      // Passive drag (during hitstun / actions / guard)
      const drag = f.onGround ? (f.hitstunTimer > 0 ? 580 : 1850) : 185;
      if (Math.abs(f.vx) <= drag * dt) f.vx = 0;
      else f.vx -= Math.sign(f.vx) * drag * dt;
    }

    // Floatier gravity & fall cap for fair off-stage recovery
    const maxFall = allowControl && input.down ? 780 : 640;
    f.vy = Math.min(maxFall, f.vy + gravity * dt);

    // Integrate position
    const wasGroundedMain = f.onGround && !f.onPassThrough;
    f.prevY = f.y;
    f.x += f.vx * dt;
    f.y += f.vy * dt;

    // Ledge-edge safety forgiveness: if player released movement keys while stopping near cliff, never slide off!
    if (wasGroundedMain && allowControl && moveDir === 0 && f.hitstunTimer <= 0 && mainPlat) {
      if (f.x < mainPlat.x + 8) {
        f.x = mainPlat.x + 8;
        f.vx = 0;
      } else if (f.x > mainPlat.x + mainPlat.w - 8) {
        f.x = mainPlat.x + mainPlat.w - 8;
        f.vx = 0;
      }
    }

    // Platform collisions
    const wasOnGround = f.onGround;
    f.onGround = false;
    f.onPassThrough = false;

    const halfW = f.width * 0.36;
    for (const p of this.stage.platforms) {
      if (f.x + halfW <= p.x || f.x - halfW >= p.x + p.w) continue;

      if (p.passThrough) {
        if (f.dropThroughTimer > 0) continue;
        if (f.vy >= 0 && f.prevY <= p.y + 8 && f.y >= p.y) {
          f.y = p.y;
          f.vy = 0;
          f.onGround = true;
          f.onPassThrough = true;
          f.jumpsRemaining = f.maxAirJumps;
          f.upSpecialUsed = false;
          if (!wasOnGround) this._spawnDust(f.x, f.y, 4);
          break;
        }
      } else {
        // Solid main platform: top landing + gentle side/bottom push
        if (f.vy >= 0 && f.prevY <= p.y + 14 && f.y >= p.y) {
          f.y = p.y;
          f.vy = 0;
          f.onGround = true;
          f.onPassThrough = false;
          f.jumpsRemaining = f.maxAirJumps;
          f.upSpecialUsed = false;
          if (!wasOnGround) this._spawnDust(f.x, f.y, 6);
          break;
        } else if (f.vy < 0 && f.prevY - f.height >= p.y + p.h - 10 && f.y - f.height <= p.y + p.h) {
          f.y = p.y + p.h + f.height;
          f.vy = 60;
        }
      }
    }

    // Automatic Ledge Grab (崖つかまり) when airborne near main stage corners!
    if (!f.onGround && allowControl) {
      this._tryLedgeGrab(f, input);
    }
  }

  _startNormalAttack(f) {
    f.action = 'attack';
    f.actionTimer = 0;
    f.actionDuration = 0.24;
    f.actionHitSet = new Set();
    f.comboCount = (f.comboCount % 2) + 1;
    f.comboResetTimer = 0.55;
    f.animState = 'attack';
    f.animTime = 0;
    f.vx = f.facing * Math.max(Math.abs(f.vx), 160);

    const reach = 58 + f.stats.reach * 0.58 + (f.giantTimer > 0 ? 28 : 0);
    this._spawnSlashArc(f.x + f.facing * (reach * 0.45), f.y - f.height * 0.52, f.facing, reach * 0.6, f.color, false);
  }

  _startStrongAttack(f) {
    f.action = 'strong';
    f.actionTimer = 0;
    f.actionDuration = 0.48;
    f.actionHitSet = new Set();
    f.actionSubPhase = 0;
    f.chargeRatio = 0.2;
    f.animState = 'strong';
    f.animTime = 0;
    f.vx *= 0.25;
  }

  _startGrab(f) {
    f.action = 'grab';
    f.actionTimer = 0;
    f.actionDuration = 0.3;
    f.actionHitSet = new Set();
    f.animState = 'grab';
    f.animTime = 0;
    f.vx = f.facing * 120;
  }

  _startSpecialMove(f, input) {
    const sp = f.stats.specialMove;
    f.action = 'special';
    f.actionTimer = 0;
    f.actionHitSet = new Set();
    f.actionSubPhase = 0;
    f.animState = 'special';
    f.animTime = 0;
    f.specialCooldown = this._getEffectiveSpecialCooldown(f);

    if (input.left && !input.right) f.facing = -1;
    else if (input.right && !input.left) f.facing = 1;

    sfx.playSpecial(sp.element || 'none');
    this._broadcastEvent({
      type: 'special',
      fighterId: f.id,
      specialId: sp.id,
      element: sp.element || 'none',
      color: sp.color || f.color,
      x: f.x,
      y: f.y - f.height * 0.5,
      facing: f.facing,
    });

    this._spawnBurst(f.x, f.y - f.height * 0.5, sp.color || f.color, 10);

    switch (sp.id) {
      case 'slash':
        f.actionDuration = 0.36;
        f.vx = f.facing * 410;
        break;
      case 'strike':
        f.actionDuration = 0.44;
        f.vx = f.facing * 320;
        f.vy = -210;
        break;
      case 'fire':
      case 'ice':
      case 'star':
      case 'ink_wave':
        f.actionDuration = 0.32;
        f.vx *= 0.3;
        break;
      case 'lightning':
        f.actionDuration = 0.38;
        f.vx *= 0.2;
        break;
      case 'wing_dash':
        f.actionDuration = 0.42;
        f.vx = f.facing * 470;
        f.vy = -560;
        f.onGround = false;
        break;
      case 'quake':
        f.actionDuration = 0.55;
        f.vx *= 0.2;
        if (!f.onGround) {
          f.vy = 660;
        }
        break;
      case 'rapid':
        f.actionDuration = 0.44;
        f.vx = f.facing * 540;
        break;
      default:
        f.actionDuration = 0.34;
        break;
    }
  }

  _updateActiveAction(f, input, dt) {
    f.actionTimer += dt;
    const attackMult = 0.72 + (f.stats.attack / 100) * 0.62;
    const reachPx = 56 + f.stats.reach * 0.6 + (f.giantTimer > 0 ? 30 : 0);

    if (f.action === 'attack') {
      f.animState = 'attack';
      this._applyPhysicsStep(f, createEmptyInput(), dt, false);
      if (f.actionTimer >= 0.04 && f.actionTimer <= 0.16) {
        const dmg = Math.round((f.comboCount === 2 ? 9 : 7) * attackMult);
        this._checkMeleeHitbox(f, {
          rangeX: reachPx,
          rangeY: f.height * 0.95,
          damage: dmg,
          baseKb: f.comboCount === 2 ? 250 : 200,
          kbScale: f.comboCount === 2 ? 3.5 : 2.8,
          angle: 0.52,
          heavy: false,
          popText: f.comboCount === 2 ? 'POW!' : 'HIT!',
          hitSet: f.actionHitSet,
        });
      }
    } else if (f.action === 'strong') {
      f.animState = 'strong';
      this._applyPhysicsStep(f, createEmptyInput(), dt, false);
      if (f.actionTimer < 0.16) {
        f.chargeRatio = clamp(f.actionTimer / 0.16, 0, 1);
      } else {
        f.chargeRatio = 0;
        if (f.actionSubPhase === 0) {
          f.actionSubPhase = 1;
          f.vx = f.facing * 240;
          this._spawnSlashArc(f.x + f.facing * (reachPx * 0.52), f.y - f.height * 0.52, f.facing, reachPx * 0.78, '#f59e0b', true);
        }
        if (f.actionTimer <= 0.31) {
          const dmg = Math.round(16 * attackMult);
          this._checkMeleeHitbox(f, {
            rangeX: reachPx * 1.15,
            rangeY: f.height * 1.05,
            damage: dmg,
            baseKb: 350,
            kbScale: 6.3,
            angle: 0.66,
            heavy: true,
            popText: 'SMASH!',
            hitSet: f.actionHitSet,
          });
        }
      }
    } else if (f.action === 'grab') {
      f.animState = 'grab';
      this._applyPhysicsStep(f, createEmptyInput(), dt, false);
      if (f.actionTimer >= 0.04 && f.actionTimer <= 0.17) {
        const grabReach = 54 + f.stats.grabPower * 0.5 + f.stats.reach * 0.25 + (f.giantTimer > 0 ? 24 : 0);
        for (const target of this.fighters) {
          if (!this._canHit(f, target)) continue;
          const dx = (target.x - f.x) * f.facing;
          const dy = Math.abs((target.y - target.height * 0.5) - (f.y - f.height * 0.5));
          if (dx >= -14 && dx <= grabReach && dy <= f.height * 0.75) {
            // Grab succeeds — bypasses shield!
            target.shieldActive = false;
            target.action = null;
            target.grabbedById = f.id;
            f.grabbedTargetId = target.id;
            f.action = 'throw';
            f.actionTimer = 0;
            f.actionDuration = 0.22;
            f.actionSubPhase = 0;
            f.animState = 'grab';
            sfx.playGrab();
            this._broadcastEvent({ type: 'grab', x: target.x, y: target.y - target.height * 0.5 });
            this._spawnPopText(target.x, target.y - target.height - 8, 'GRAB!', '#8b5cf6');
            break;
          }
        }
      }
    } else if (f.action === 'throw') {
      f.animState = 'attack';
      this._applyPhysicsStep(f, createEmptyInput(), dt, false);
      if (f.actionSubPhase === 0 && f.actionTimer >= 0.11) {
        f.actionSubPhase = 1;
        const target = this.fighterMap.get(f.grabbedTargetId);
        if (target && !target.isOut) {
          target.grabbedById = null;
          const dmg = Math.round(9 + f.stats.grabPower * 0.08);
          this._applyDamageAndKnockback(f, target, {
            damage: dmg,
            baseKb: 315 + f.stats.grabPower * 1.4,
            kbScale: 4.5,
            dir: f.facing,
            angle: 0.68,
            heavy: true,
            bypassShield: true,
            popText: 'THROW!',
          });
        }
        f.grabbedTargetId = null;
      }
    } else if (f.action === 'up_special') {
      f.animState = 'recovery';
      // Allow horizontal steering during Up-B recovery arc!
      const moveDir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      if (moveDir !== 0) {
        f.facing = moveDir;
        f.vx += moveDir * 1150 * dt;
        const cap = 340;
        if (Math.abs(f.vx) > cap) f.vx = Math.sign(f.vx) * cap;
      }
      f.prevY = f.y;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += 1020 * dt;
      // Glowing cyan-gold rising trail
      if (Math.random() < 0.78) {
        this._spawnParticle(
          f.x + (Math.random() - 0.5) * 26,
          f.y - f.height * 0.25,
          -f.vx * 0.15,
          65,
          Math.random() < 0.5 ? '#38bdf8' : '#facc15',
          5.5,
          0.32
        );
      }
      // Rising hitbox during first half of boost
      if (f.actionTimer >= 0.04 && f.actionTimer <= 0.28) {
        this._checkMeleeHitbox(f, {
          rangeX: f.width * 0.9,
          rangeY: f.height * 1.15,
          bothSides: true,
          damage: 9,
          baseKb: 220,
          kbScale: 3.0,
          angle: 1.05,
          heavy: false,
          popText: 'UP-B!',
          hitSet: f.actionHitSet,
        });
      }
      // Check landing on platforms or grabbing ledge mid-recovery!
      if (f.vy >= 0) {
        const halfW = f.width * 0.36;
        for (const p of this.stage.platforms) {
          if (f.x + halfW <= p.x || f.x - halfW >= p.x + p.w) continue;
          if (f.prevY <= p.y + 12 && f.y >= p.y) {
            f.y = p.y;
            f.vy = 0;
            f.onGround = true;
            f.onPassThrough = Boolean(p.passThrough);
            f.jumpsRemaining = f.maxAirJumps;
            f.upSpecialUsed = false;
            f.action = null;
            this._spawnDust(f.x, f.y, 6);
            break;
          }
        }
      }
      if (f.action === 'up_special' && f.actionTimer > 0.12) {
        this._tryLedgeGrab(f, input);
      }
    } else if (f.action === 'special') {
      f.animState = 'special';
      this._updateSpecialAction(f, dt, attackMult, reachPx);
      if (f.stats.specialMove.id === 'wing_dash' && f.actionTimer > 0.15) {
        this._tryLedgeGrab(f, input);
      }
    }

    if (f.action && f.actionTimer >= f.actionDuration) {
      if (f.grabbedTargetId) {
        const t = this.fighterMap.get(f.grabbedTargetId);
        if (t) t.grabbedById = null;
        f.grabbedTargetId = null;
      }
      f.action = null;
      f.chargeRatio = 0;
    }
  }

  _updateSpecialAction(f, dt, attackMult, reachPx) {
    const sp = f.stats.specialMove;
    const spColor = sp.color || f.color;
    const baseDmg = Math.round((sp.power || 14) * (0.78 + f.stats.attack / 150));

    switch (sp.id) {
      case 'slash': {
        this._applyPhysicsStep(f, createEmptyInput(), dt, false);
        if (f.actionSubPhase === 0 && f.actionTimer >= 0.08) {
          f.actionSubPhase = 1;
          this._spawnSlashArc(f.x + f.facing * (reachPx * 0.6), f.y - f.height * 0.5, f.facing, reachPx * 0.95, spColor, true);
          this._spawnProjectile({
            ownerId: f.id,
            team: f.team,
            kind: 'slash',
            x: f.x + f.facing * 42,
            y: f.y - f.height * 0.52,
            vx: f.facing * 540,
            vy: 0,
            radius: 28,
            damage: Math.round(baseDmg * 0.85),
            baseKb: 290,
            kbScale: 4.8,
            color: spColor,
            life: 0.42,
            pierce: true,
          });
        }
        if (f.actionTimer >= 0.06 && f.actionTimer <= 0.24) {
          this._checkMeleeHitbox(f, {
            rangeX: reachPx * 1.35,
            rangeY: f.height * 1.15,
            damage: baseDmg,
            baseKb: 310,
            kbScale: 5.1,
            angle: 0.62,
            heavy: true,
            popText: 'SLASH!',
            hitSet: f.actionHitSet,
          });
        }
        break;
      }

      case 'strike': {
        this._applyPhysicsStep(f, createEmptyInput(), dt, false);
        if (f.actionTimer >= 0.14 && f.actionTimer <= 0.34) {
          if (f.actionSubPhase === 0) {
            f.actionSubPhase = 1;
            f.vy = Math.max(f.vy, 380);
            this._triggerShake(0.18, 7);
            this._spawnBurst(f.x + f.facing * 45, f.y - 20, spColor, 14);
          }
          this._checkMeleeHitbox(f, {
            rangeX: reachPx * 1.25,
            rangeY: f.height * 1.2,
            damage: Math.round(baseDmg * 1.15),
            baseKb: 380,
            kbScale: 6.4,
            angle: 0.72,
            heavy: true,
            popText: 'CRASH!',
            hitSet: f.actionHitSet,
          });
        }
        break;
      }

      case 'fire': {
        this._applyPhysicsStep(f, createEmptyInput(), dt, false);
        if (f.actionSubPhase === 0 && f.actionTimer >= 0.1) {
          f.actionSubPhase = 1;
          this._spawnProjectile({
            ownerId: f.id,
            team: f.team,
            kind: 'fire',
            x: f.x + f.facing * 40,
            y: f.y - f.height * 0.55,
            vx: f.facing * 590,
            vy: -20,
            radius: 22,
            damage: baseDmg,
            baseKb: 320,
            kbScale: 5.4,
            color: '#f97316',
            life: 1.35,
            explosive: true,
            explodeRadius: 96,
          });
        }
        break;
      }

      case 'ice': {
        this._applyPhysicsStep(f, createEmptyInput(), dt, false);
        if (f.actionSubPhase === 0 && f.actionTimer >= 0.09) {
          f.actionSubPhase = 1;
          this._spawnProjectile({
            ownerId: f.id,
            team: f.team,
            kind: 'ice',
            x: f.x + f.facing * 40,
            y: f.y - f.height * 0.55,
            vx: f.facing * 670,
            vy: 0,
            radius: 19,
            damage: Math.round(baseDmg * 0.9),
            baseKb: 240,
            kbScale: 3.8,
            color: '#38bdf8',
            life: 1.25,
            applySlow: 2.5,
          });
        }
        break;
      }

      case 'lightning': {
        this._applyPhysicsStep(f, createEmptyInput(), dt, false);
        if (f.actionSubPhase === 0 && f.actionTimer >= 0.12) {
          f.actionSubPhase = 1;
          // Target nearest enemy in front within 310px, otherwise strike 180px ahead
          let strikeX = f.x + f.facing * 185;
          let strikeY = f.y;
          let bestDist = 310;
          for (const target of this.fighters) {
            if (!this._canHit(f, target)) continue;
            const dx = (target.x - f.x) * f.facing;
            if (dx > 15 && dx < bestDist) {
              bestDist = dx;
              strikeX = target.x;
              strikeY = target.y;
            }
          }
          this._spawnLightningBolt(strikeX, Math.max(20, strikeY - 340), strikeX, strikeY + 12, '#facc15');
          this._broadcastEvent({
            type: 'lightning',
            x: strikeX,
            y1: Math.max(20, strikeY - 340),
            y2: strikeY + 12,
          });
          this._triggerShake(0.18, 8);

          for (const target of this.fighters) {
            if (!this._canHit(f, target)) continue;
            const dx = Math.abs(target.x - strikeX);
            const dy = Math.abs((target.y - target.height * 0.5) - (strikeY - 40));
            if (dx < 68 && dy < 150) {
              this._applyDamageAndKnockback(f, target, {
                damage: Math.round(baseDmg * 1.05),
                baseKb: 310,
                kbScale: 5.1,
                dir: target.x >= f.x ? 1 : -1,
                angle: 1.05,
                heavy: true,
                extraHitstun: 0.18,
                popText: 'ZAP!',
              });
            }
          }
        }
        break;
      }

      case 'star': {
        this._applyPhysicsStep(f, createEmptyInput(), dt, false);
        if (f.actionSubPhase === 0 && f.actionTimer >= 0.09) {
          f.actionSubPhase = 1;
          const angles = [-0.32, 0.0, 0.28];
          for (const a of angles) {
            this._spawnProjectile({
              ownerId: f.id,
              team: f.team,
              kind: 'star',
              x: f.x + f.facing * 32,
              y: f.y - f.height * 0.55,
              vx: f.facing * Math.cos(a) * 510,
              vy: Math.sin(a) * 510 - 110,
              gravity: 820,
              bounces: 3,
              radius: 15,
              damage: Math.max(6, Math.round(baseDmg * 0.52)),
              baseKb: 220,
              kbScale: 3.4,
              color: '#facc15',
              life: 1.65,
            });
          }
        }
        break;
      }

      case 'wing_dash': {
        // High-lift recovery dash with active flying body hitbox
        f.prevY = f.y;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vy += 980 * dt;
        f.vx *= Math.pow(0.25, dt);
        if (Math.random() < 0.7) {
          this._spawnParticle(f.x - f.facing * 16, f.y - f.height * 0.4, -f.vx * 0.2, 40, spColor, 6, 0.35);
        }
        this._checkMeleeHitbox(f, {
          rangeX: f.width * 0.95,
          rangeY: f.height * 1.15,
          bothSides: true,
          damage: baseDmg,
          baseKb: 310,
          kbScale: 4.9,
          angle: 0.85,
          heavy: true,
          popText: 'DASH!',
          hitSet: f.actionHitSet,
        });
        break;
      }

      case 'quake': {
        this._applyPhysicsStep(f, createEmptyInput(), dt, false);
        if (f.actionSubPhase === 0 && (f.onGround || f.actionTimer >= 0.28)) {
          f.actionSubPhase = 1;
          this._triggerShake(0.25, 11);
          this._spawnBurst(f.x, f.y - 6, '#f59e0b', 20);
          // Dual shockwaves left & right
          for (const dir of [-1, 1]) {
            this._spawnProjectile({
              ownerId: f.id,
              team: f.team,
              kind: 'quake',
              x: f.x + dir * 32,
              y: f.y - 16,
              vx: dir * 440,
              vy: 0,
              radius: 26,
              damage: Math.round(baseDmg * 0.95),
              baseKb: 340,
              kbScale: 5.3,
              color: '#d97706',
              life: 0.45,
              pierce: true,
            });
          }
          this._checkMeleeHitbox(f, {
            rangeX: 135,
            rangeY: 110,
            bothSides: true,
            damage: Math.round(baseDmg * 1.05),
            baseKb: 360,
            kbScale: 5.8,
            angle: 1.15,
            heavy: true,
            popText: 'QUAKE!',
            hitSet: f.actionHitSet,
          });
        }
        break;
      }

      case 'rapid': {
        this._applyPhysicsStep(f, createEmptyInput(), dt, false);
        if (f.actionTimer < 0.32) {
          f.vx = f.facing * 470;
          if (Math.random() < 0.65) {
            this._spawnParticle(f.x - f.facing * 20, f.y - f.height * 0.5, -f.facing * 80, (Math.random() - 0.5) * 40, spColor, 5, 0.22);
          }
        }
        const hitTick = Math.floor(f.actionTimer / 0.11);
        if (hitTick > f.actionSubPhase && hitTick <= 3) {
          f.actionSubPhase = hitTick;
          const isFinal = hitTick === 3;
          this._spawnSlashArc(f.x + f.facing * 44, f.y - f.height * 0.5, f.facing, 56, spColor, isFinal);
          this._checkMeleeHitbox(f, {
            rangeX: reachPx * 1.05,
            rangeY: f.height,
            damage: Math.max(4, Math.round(baseDmg * (isFinal ? 0.55 : 0.35))),
            baseKb: isFinal ? 330 : 120,
            kbScale: isFinal ? 5.2 : 1.1,
            angle: isFinal ? 0.65 : 0.35,
            heavy: isFinal,
            popText: isFinal ? 'FINISH!' : 'RUSH!',
            hitSet: new Set(),
          });
        }
        break;
      }

      case 'ink_wave':
      default: {
        this._applyPhysicsStep(f, createEmptyInput(), dt, false);
        if (f.actionSubPhase === 0 && f.actionTimer >= 0.09) {
          f.actionSubPhase = 1;
          this._spawnProjectile({
            ownerId: f.id,
            team: f.team,
            kind: 'ink_wave',
            x: f.x + f.facing * 38,
            y: f.y - f.height * 0.52,
            vx: f.facing * 560,
            vy: 0,
            radius: 24,
            damage: baseDmg,
            baseKb: 295,
            kbScale: 4.8,
            color: spColor,
            life: 1.15,
            pierce: true,
          });
        }
        break;
      }
    }
  }

  _canHit(attacker, target) {
    if (!target || target.id === attacker.id) return false;
    if (target.isOut || target.respawnTimer > 0 || target.invulnTimer > 0) return false;
    if (this.teamMode && target.team && attacker.team && target.team === attacker.team) return false;
    return true;
  }

  _checkMeleeHitbox(attacker, opts) {
    const {
      rangeX = 80,
      rangeY = 80,
      bothSides = false,
      damage = 8,
      baseKb = 220,
      kbScale = 3.5,
      angle = 0.58,
      heavy = false,
      popText = 'POW!',
      hitSet,
    } = opts;

    const acy = attacker.y - attacker.height * 0.5;
    for (const target of this.fighters) {
      if (!this._canHit(attacker, target)) continue;
      if (hitSet && hitSet.has(target.id)) continue;

      const tcy = target.y - target.height * 0.5;
      const rawDx = target.x - attacker.x;
      const directionalDx = rawDx * attacker.facing;
      const inX = bothSides
        ? Math.abs(rawDx) <= rangeX + target.width * 0.4
        : directionalDx >= -18 && directionalDx <= rangeX + target.width * 0.4;
      const inY = Math.abs(tcy - acy) <= (rangeY + target.height) * 0.55;

      if (inX && inY) {
        if (hitSet) hitSet.add(target.id);
        const dir = bothSides ? (rawDx >= 0 ? 1 : -1) : attacker.facing;
        this._applyDamageAndKnockback(attacker, target, {
          damage,
          baseKb,
          kbScale,
          dir,
          angle,
          heavy,
          popText,
        });
      }
    }
  }

  _applyDamageAndKnockback(attacker, target, opts) {
    const {
      damage = 8,
      baseKb = 220,
      kbScale = 3.5,
      dir = 1,
      angle = 0.58,
      heavy = false,
      bypassShield = false,
      extraHitstun = 0,
      applySlow = 0,
      popText = 'POW!',
    } = opts;

    const hitX = (attacker.x + target.x) * 0.5;
    const hitY = target.y - target.height * 0.55;

    // Check shield block
    if (target.shieldActive && !bypassShield) {
      const shieldDrain = damage * 2.5 + (heavy ? 12 : 4);
      target.shieldHp = Math.max(0, target.shieldHp - shieldDrain);
      target.vx = dir * (heavy ? 160 : 95);
      sfx.playShield();
      this._spawnBurst(hitX, hitY, '#38bdf8', 8);
      this._spawnPopText(hitX, hitY - 26, 'GUARD!', '#0284c7');
      this._broadcastEvent({
        type: 'shield_block',
        x: hitX,
        y: hitY,
      });
      if (target.shieldHp <= 0) {
        this._triggerShieldBreak(target);
      }
      return;
    }

    const giantAtkMult = attacker.giantTimer > 0 ? 1.32 : 1.0;
    const bossAtkMult = this._isInsaneBoss(attacker) ? 1.14 : 1.0;
    const defMult = 1.22 - (target.stats.defense / 100) * 0.44;
    const finalDmg = Math.max(1, Math.round(damage * giantAtkMult * bossAtkMult * defMult));

    target.damage = Math.min(999, target.damage + finalDmg);
    attacker.damageDealt += finalDmg;
    target.lastHitBy = attacker.id;
    target.lastHitTime = this.matchElapsed;

    // Smash knockback formula (recoverable off-stage arcs at 0-75%, thrilling KOs at 100%+)
    const weightFactor = (0.68 + (target.stats.weight / 100) * 0.66) * (target.giantTimer > 0 ? 1.65 : 1.0);
    const dmgCurve =
      target.damage <= 75
        ? target.damage * 0.82
        : 75 * 0.82 + (target.damage - 75) * 1.28;
    const kbMag =
      ((baseKb * 0.84 + dmgCurve * kbScale) *
        (0.9 + attacker.stats.attack / 220) *
        giantAtkMult *
        bossAtkMult) /
      weightFactor;

    target.vx = Math.cos(angle) * kbMag * (dir || 1);
    target.vy = -Math.sin(angle) * kbMag;
    target.onGround = false;
    target.ledgeSide = 0;
    target.ledgeTimer = 0;
    target.action = null;
    target.grabbedTargetId = null;
    target.chargeRatio = 0;
    target.hitFlash = 0.24;
    target.hitstunTimer = clamp(0.12 + kbMag / 1950 + extraHitstun, 0.14, 0.68);
    if (applySlow > 0) {
      target.slowTimer = Math.max(target.slowTimer, applySlow);
    }

    const isHeavyHit = heavy || kbMag > 540;
    sfx.playHit(isHeavyHit);
    if (isHeavyHit) {
      this.hitstopTimer = Math.max(this.hitstopTimer, 0.068);
      this._triggerShake(0.2, clamp(kbMag / 75, 5, 15));
    } else {
      this.hitstopTimer = Math.max(this.hitstopTimer, 0.025);
      this._triggerShake(0.08, 3.5);
    }

    const burstColor = isHeavyHit ? '#f97316' : attacker.color;
    this._spawnBurst(hitX, hitY, burstColor, isHeavyHit ? 16 : 9);
    this._spawnPopText(hitX, hitY - 22, popText, isHeavyHit ? '#ef4444' : '#1f2937');

    this._broadcastEvent({
      type: 'hit',
      x: hitX,
      y: hitY,
      heavy: isHeavyHit,
      color: burstColor,
      popText,
      shake: isHeavyHit ? clamp(kbMag / 75, 5, 15) : 3.5,
    });
  }

  _triggerShieldBreak(target) {
    target.shieldActive = false;
    target.shieldHp = 0;
    target.action = 'dizzy';
    target.actionTimer = 0;
    target.actionDuration = 2.2;
    target.vy = -340;
    target.onGround = false;
    sfx.playHit(true);
    this._spawnBurst(target.x, target.y - target.height * 0.5, '#facc15', 16);
    this._spawnPopText(target.x, target.y - target.height - 14, 'BREAK!', '#eab308');
    this._broadcastEvent({
      type: 'shield_break',
      x: target.x,
      y: target.y - target.height * 0.5,
    });
  }

  _spawnProjectile(cfg) {
    this.projectiles.push({
      id: this.nextEntityId++,
      ownerId: cfg.ownerId,
      team: cfg.team || 'A',
      kind: cfg.kind || 'ink_wave',
      x: cfg.x,
      y: cfg.y,
      vx: cfg.vx || 0,
      vy: cfg.vy || 0,
      gravity: cfg.gravity || 0,
      bounces: cfg.bounces || 0,
      radius: cfg.radius || 18,
      damage: cfg.damage || 10,
      baseKb: cfg.baseKb || 260,
      kbScale: cfg.kbScale || 4.0,
      color: cfg.color || '#3b82f6',
      life: cfg.life || 1.2,
      age: 0,
      pierce: Boolean(cfg.pierce),
      explosive: Boolean(cfg.explosive),
      explodeRadius: cfg.explodeRadius || 95,
      applySlow: cfg.applySlow || 0,
      hitIds: new Set(),
    });
  }

  _updateProjectilesHost(dt) {
    const bz = this.stage.blastZone;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      p.life -= dt;
      if (p.gravity) p.vy += p.gravity * dt;

      const prevY = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Trail particles
      if (Math.random() < 0.55) {
        this._spawnParticle(
          p.x + (Math.random() - 0.5) * 8,
          p.y + (Math.random() - 0.5) * 8,
          -p.vx * 0.08,
          -p.vy * 0.08 - 20,
          p.color,
          p.kind === 'fire' || p.kind === 'bomb' ? 6 : 4,
          0.26
        );
      }

      // Platform bounce for bouncing projectiles (stars & bombs)
      if (p.bounces > 0 && p.vy > 0) {
        for (const plat of this.stage.platforms) {
          if (p.x >= plat.x && p.x <= plat.x + plat.w && prevY <= plat.y + 4 && p.y >= plat.y - p.radius * 0.5) {
            p.y = plat.y - p.radius * 0.5;
            p.vy = -Math.abs(p.vy) * 0.68;
            p.vx *= 0.88;
            p.bounces -= 1;
            break;
          }
        }
      }

      const owner = this.fighterMap.get(p.ownerId);
      let consumed = false;

      if (owner) {
        for (const target of this.fighters) {
          if (!this._canHit(owner, target)) continue;
          if (p.hitIds.has(target.id)) continue;

          const tcx = target.x;
          const tcy = target.y - target.height * 0.5;
          const dist = Math.hypot(p.x - tcx, p.y - tcy);
          if (dist <= p.radius + Math.max(target.width, target.height) * 0.42) {
            if (p.explosive) {
              this._explodeProjectile(p, owner);
              consumed = true;
              break;
            } else {
              p.hitIds.add(target.id);
              const pop = p.kind === 'ice' ? 'FREEZE!' : p.kind === 'star' ? 'STAR!' : 'ZING!';
              this._applyDamageAndKnockback(owner, target, {
                damage: p.damage,
                baseKb: p.baseKb,
                kbScale: p.kbScale,
                dir: p.vx >= 0 ? 1 : -1,
                angle: 0.58,
                heavy: p.kind === 'fire' || p.kind === 'quake',
                applySlow: p.applySlow,
                popText: pop,
              });
              if (!p.pierce) {
                consumed = true;
                break;
              }
            }
          }
        }
      }

      if (consumed) {
        this.projectiles.splice(i, 1);
        continue;
      }

      if (p.life <= 0) {
        if (p.explosive && owner) {
          this._explodeProjectile(p, owner);
        }
        this.projectiles.splice(i, 1);
        continue;
      }

      if (p.x < bz.left || p.x > bz.right || p.y < bz.top || p.y > bz.bottom) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  _explodeProjectile(p, owner) {
    this._triggerShake(0.24, 12);
    this._spawnBurst(p.x, p.y, '#f97316', 24);
    this._spawnBurst(p.x, p.y, '#facc15', 14);
    this._spawnPopText(p.x, p.y - 20, 'BOOM!', '#ef4444');
    sfx.playHit(true);

    this._broadcastEvent({
      type: 'hit',
      x: p.x,
      y: p.y,
      heavy: true,
      color: '#f97316',
      popText: 'BOOM!',
      shake: 12,
    });

    for (const target of this.fighters) {
      if (target.isOut || target.respawnTimer > 0 || target.invulnTimer > 0) continue;
      if (p.kind === 'fire' && !this._canHit(owner, target)) continue;
      // Bomb can also miss teammates in teamMode
      if (this.teamMode && target.id !== owner.id && target.team === owner.team) continue;
      if (target.id === owner.id && p.age < 0.25) continue;

      const tcy = target.y - target.height * 0.5;
      const dist = Math.hypot(target.x - p.x, tcy - p.y);
      if (dist <= p.explodeRadius + target.width * 0.4) {
        const dir = target.x >= p.x ? 1 : -1;
        this._applyDamageAndKnockback(owner, target, {
          damage: p.damage,
          baseKb: p.baseKb,
          kbScale: p.kbScale,
          dir,
          angle: 0.78,
          heavy: true,
          popText: 'BOOM!',
        });
      }
    }
  }

  _updateItemsHost(dt) {
    this.itemSpawnTimer -= dt;
    if (this.itemSpawnTimer <= 0) {
      this.itemSpawnTimer = 11 + Math.random() * 4;
      if (this.items.length < MAX_ACTIVE_ITEMS) {
        this._spawnRandomItem();
      }
    }

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.age += dt;
      if (item.age > 24) {
        this.items.splice(i, 1);
        continue;
      }

      // Check fighter pickup
      for (const f of this.fighters) {
        if (f.isOut || f.respawnTimer > 0) continue;
        const fcy = f.y - f.height * 0.5;
        const dist = Math.hypot(f.x - item.x, fcy - item.y);
        if (dist <= Math.max(f.width, f.height) * 0.58 + 24) {
          this._pickupItem(f, item);
          this.items.splice(i, 1);
          break;
        }
      }
    }
  }

  _spawnRandomItem() {
    const plats = this.stage.platforms;
    const plat = plats[Math.floor(Math.random() * plats.length)];
    const def = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
    const x = plat.x + 48 + Math.random() * Math.max(20, plat.w - 96);
    const y = plat.y - 26;

    const item = {
      id: this.nextEntityId++,
      type: def.type,
      label: def.label,
      color: def.color,
      emoji: def.emoji,
      x,
      y,
      age: 0,
    };
    this.items.push(item);
    this._spawnBurst(x, y, def.color, 10);
    this._spawnPopText(x, y - 24, `${def.label}出現！`, def.color);
    sfx.playItem();
    this._broadcastEvent({
      type: 'item_spawn',
      itemType: def.type,
      label: def.label,
      x,
      y,
      color: def.color,
    });
  }

  _pickupItem(f, item) {
    sfx.playItem();
    this._spawnBurst(item.x, item.y, item.color, 14);

    let popText = item.label;
    switch (item.type) {
      case 'hammer':
        f.hammerTimer = 6.0;
        f.hammerSwingTimer = 0.05;
        f.action = null;
        popText = 'ハンマー！';
        break;
      case 'bomb':
        popText = 'ボム投擲！';
        this._spawnProjectile({
          ownerId: f.id,
          team: f.team,
          kind: 'bomb',
          x: f.x + f.facing * 32,
          y: f.y - f.height * 0.6,
          vx: f.facing * 470,
          vy: -310,
          gravity: 1120,
          bounces: 2,
          radius: 18,
          damage: 22,
          baseKb: 420,
          kbScale: 6.4,
          color: '#1f2937',
          life: 1.45,
          explosive: true,
          explodeRadius: 138,
        });
        break;
      case 'heal':
        f.damage = Math.max(0, f.damage - 35);
        popText = '回復 -35%!';
        this._spawnBurst(f.x, f.y - f.height * 0.5, '#22c55e', 16);
        break;
      case 'giant':
        f.giantTimer = 8.0;
        popText = '巨大化！';
        this._spawnBurst(f.x, f.y - f.height * 0.5, '#f59e0b', 18);
        break;
    }

    this._spawnPopText(f.x, f.y - f.height - 16, popText, item.color);
    this._broadcastEvent({
      type: 'item_pickup',
      fighterId: f.id,
      itemType: item.type,
      popText,
      x: f.x,
      y: f.y - f.height * 0.5,
      color: item.color,
    });
  }

  _checkBlastZone(f) {
    const bz = this.stage.blastZone;
    if (f.x < bz.left || f.x > bz.right || f.y < bz.top || f.y > bz.bottom) {
      this._triggerKO(f);
    }
  }

  _triggerKO(victim) {
    const beamX = clamp(victim.x, 20, this.stage.width - 20);
    const beamY = clamp(victim.y, 20, this.stage.height - 20);
    const angle = Math.atan2(this.stage.height * 0.5 - beamY, this.stage.width * 0.5 - beamX);

    victim.falls += 1;
    if (victim.lastHitBy && this.matchElapsed - victim.lastHitTime <= 5.0) {
      const killer = this.fighterMap.get(victim.lastHitBy);
      if (killer && killer.id !== victim.id && !(this.teamMode && killer.team === victim.team)) {
        killer.kos += 1;
      }
    }

    if (this.mode === 'stock') {
      victim.stocks = Math.max(0, victim.stocks - 1);
      if (victim.stocks <= 0) {
        victim.isOut = true;
      }
    }

    victim.damage = 0;
    victim.vx = 0;
    victim.vy = 0;
    victim.action = null;
    victim.ledgeSide = 0;
    victim.ledgeTimer = 0;
    victim.upSpecialUsed = false;
    victim.hammerTimer = 0;
    victim.giantTimer = 0;
    victim.slowTimer = 0;
    victim.hitstunTimer = 0;
    victim.respawnTimer = victim.isOut ? 0 : 1.45;

    sfx.playKO();
    this._triggerShake(0.32, 15);
    this._spawnKOBeam(beamX, beamY, angle, victim.color);
    this._spawnBurst(beamX, beamY, victim.color, 26);
    this._spawnPopText(
      clamp(beamX, 120, this.stage.width - 120),
      clamp(beamY, 90, this.stage.height - 90),
      'KO!!',
      victim.color
    );

    this._broadcastEvent({
      type: 'ko',
      victimId: victim.id,
      x: beamX,
      y: beamY,
      angle,
      color: victim.color,
    });
    this._emitHUD();
  }

  _checkWinConditionHost() {
    if (this.phase !== 'playing') return;
    if (this.mode !== 'stock') return;
    if (this.fighters.length <= 1) return;

    const alive = this.fighters.filter((f) => !f.isOut);
    if (this.teamMode) {
      const aliveTeams = new Set(alive.map((f) => f.team));
      if (aliveTeams.size <= 1) {
        this._triggerMatchEnd();
      }
    } else {
      if (alive.length <= 1) {
        this._triggerMatchEnd();
      }
    }
  }

  _triggerMatchEnd() {
    if (this.phase === 'finished') return;
    this.phase = 'finished';
    this.banner = 'GAME SET!';
    this.endDelayTimer = 1.9;
    sfx.playFinish();
    this._broadcastEvent({ type: 'sfx', sound: 'finish' });
    this._emitHUD();
  }

  _buildMatchResult() {
    const sorted = [...this.fighters].sort((a, b) => {
      if (this.mode === 'stock') {
        if (a.isOut !== b.isOut) return a.isOut ? 1 : -1;
        if (b.stocks !== a.stocks) return b.stocks - a.stocks;
        if (b.kos !== a.kos) return b.kos - a.kos;
        if (b.damageDealt !== a.damageDealt) return b.damageDealt - a.damageDealt;
        return a.falls - b.falls;
      } else {
        const scoreA = a.kos - a.falls;
        const scoreB = b.kos - b.falls;
        if (scoreB !== scoreA) return scoreB - scoreA;
        if (b.kos !== a.kos) return b.kos - a.kos;
        return b.damageDealt - a.damageDealt;
      }
    });

    let winningTeam = null;
    let winnerIds = [];

    if (this.teamMode && sorted.length > 0) {
      const teamStats = new Map();
      for (const f of this.fighters) {
        const cur = teamStats.get(f.team) || { alive: 0, stocks: 0, score: 0, damage: 0 };
        if (!f.isOut) cur.alive += 1;
        cur.stocks += this.mode === 'stock' ? f.stocks : 0;
        cur.score += f.kos - f.falls;
        cur.damage += f.damageDealt;
        teamStats.set(f.team, cur);
      }
      const teams = [...teamStats.entries()].sort((a, b) => {
        if (this.mode === 'stock') {
          if (b[1].alive !== a[1].alive) return b[1].alive - a[1].alive;
          if (b[1].stocks !== a[1].stocks) return b[1].stocks - a[1].stocks;
        }
        if (b[1].score !== a[1].score) return b[1].score - a[1].score;
        return b[1].damage - a[1].damage;
      });
      winningTeam = teams[0][0];
      winnerIds = this.fighters.filter((f) => f.team === winningTeam).map((f) => f.id);
    } else if (sorted.length > 0) {
      winnerIds = [sorted[0].id];
    }

    const rankings = sorted.map((f, idx) => ({
      id: f.id,
      name: f.name,
      color: f.color,
      team: f.team,
      rank: idx + 1,
      kos: f.kos,
      falls: f.falls,
      damageDealt: Math.round(f.damageDealt),
      stocksLeft: this.mode === 'stock' ? f.stocks : 0,
    }));

    return { winnerIds, winningTeam, rankings };
  }

  _createSnapshot() {
    return {
      t: Number(this.matchElapsed.toFixed(2)),
      tl: Number(this.timeLeft.toFixed(2)),
      ph: this.phase,
      bn: this.banner,
      f: this.fighters.map((f) => ({
        id: f.id,
        x: Math.round(f.x * 10) / 10,
        y: Math.round(f.y * 10) / 10,
        vx: Math.round(f.vx),
        vy: Math.round(f.vy),
        fc: f.facing,
        as: f.animState,
        at: Number(f.animTime.toFixed(2)),
        og: f.onGround ? 1 : 0,
        sa: f.shieldActive ? 1 : 0,
        sh: Math.round(f.shieldHp),
        hf: Number(f.hitFlash.toFixed(2)),
        gt: Number(f.giantTimer.toFixed(2)),
        it: Number(f.invulnTimer.toFixed(2)),
        ht: Number(f.hammerTimer.toFixed(2)),
        st: Number(f.slowTimer.toFixed(2)),
        cr: Number(f.chargeRatio.toFixed(2)),
        d: Math.round(f.damage),
        sk: f.stocks,
        sc: Number(f.specialCooldown.toFixed(2)),
        out: f.isOut ? 1 : 0,
        rt: Number(f.respawnTimer.toFixed(2)),
        rp: Number(f.respawnPlatTimer.toFixed(2)),
        ko: f.kos,
        fl: f.falls,
        dd: Math.round(f.damageDealt),
        jr: f.jumpsRemaining,
        hs: Number(f.hitstunTimer.toFixed(2)),
        ac: f.action || '',
        cpu: f.isCPU ? 1 : 0,
        cl: f.cpuLevel || 'normal',
        ls: f.ledgeSide || 0,
        us: f.upSpecialUsed ? 1 : 0,
      })),
      p: this.projectiles.map((p) => ({
        id: p.id,
        kind: p.kind,
        x: Math.round(p.x),
        y: Math.round(p.y),
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        gravity: p.gravity || 0,
        radius: p.radius,
        color: p.color,
        age: Number((p.age || 0).toFixed(2)),
      })),
      im: this.items.map((im) => ({
        id: im.id,
        type: im.type,
        label: im.label,
        color: im.color,
        emoji: im.emoji,
        x: Math.round(im.x),
        y: Math.round(im.y),
        age: Number((im.age || 0).toFixed(2)),
      })),
    };
  }

  applyHostSnapshot(snapshot) {
    if (!snapshot || this.isHost) return;
    this.matchElapsed = snapshot.t ?? this.matchElapsed;
    this.timeLeft = snapshot.tl ?? this.timeLeft;
    this.phase = snapshot.ph || this.phase;
    this.banner = snapshot.bn ?? '';

    if (Array.isArray(snapshot.f)) {
      for (const sf of snapshot.f) {
        const f = this.fighterMap.get(sf.id);
        if (!f) continue;

        f.netTarget = { x: sf.x, y: sf.y, vx: sf.vx, vy: sf.vy };
        if (sf.id !== this.localPlayerId || sf.hs > 0 || sf.rt > 0 || sf.rp > 0 || sf.out) {
          f.facing = sf.fc;
          f.animState = sf.as;
        } else if (sf.ac) {
          f.animState = sf.as;
        }
        f.onGround = Boolean(sf.og);
        f.shieldActive = Boolean(sf.sa);
        f.shieldHp = sf.sh;
        f.hitFlash = sf.hf;
        f.giantTimer = sf.gt;
        f.invulnTimer = sf.it;
        f.hammerTimer = sf.ht;
        f.slowTimer = sf.st;
        f.chargeRatio = sf.cr;
        f.damage = sf.d;
        f.stocks = sf.sk;
        f.specialCooldown = sf.sc;
        f.isOut = Boolean(sf.out);
        f.respawnTimer = sf.rt;
        f.respawnPlatTimer = sf.rp;
        f.kos = sf.ko;
        f.falls = sf.fl;
        f.damageDealt = sf.dd;
        f.jumpsRemaining = sf.jr;
        f.hitstunTimer = sf.hs;
        f.action = sf.ac || null;
        f.isCPU = Boolean(sf.cpu);
        if (sf.cl) f.cpuLevel = sf.cl;
        f.ledgeSide = sf.ls || 0;
        f.upSpecialUsed = Boolean(sf.us);

        const sizeMult = f.giantTimer > 0 ? 1.45 : 1.0;
        f.width = Math.round(f.baseWidth * sizeMult);
        f.height = Math.round(f.baseHeight * sizeMult);
      }
    }

    if (Array.isArray(snapshot.p)) {
      this.projectiles = snapshot.p.map((p) => ({ ...p }));
    }
    if (Array.isArray(snapshot.im)) {
      this.items = snapshot.im.map((im) => ({ ...im }));
    }
  }

  applyHostEvent(event) {
    if (!event || this.isHost) return;
    switch (event.type) {
      case 'hit':
        sfx.playHit(Boolean(event.heavy));
        this._spawnBurst(event.x, event.y, event.color || '#f97316', event.heavy ? 16 : 9);
        if (event.popText) {
          this._spawnPopText(event.x, event.y - 22, event.popText, event.heavy ? '#ef4444' : '#1f2937');
        }
        if (event.heavy) {
          this.hitstopTimer = Math.max(this.hitstopTimer, 0.06);
        }
        this._triggerShake(event.heavy ? 0.18 : 0.08, event.shake || 5);
        break;
      case 'ko':
        sfx.playKO();
        this._triggerShake(0.3, 14);
        this._spawnKOBeam(event.x, event.y, event.angle || 0, event.color || '#ef4444');
        this._spawnBurst(event.x, event.y, event.color || '#ef4444', 24);
        this._spawnPopText(
          clamp(event.x, 120, this.stage.width - 120),
          clamp(event.y, 90, this.stage.height - 90),
          'KO!!',
          event.color || '#ef4444'
        );
        break;
      case 'item_spawn':
        sfx.playItem();
        this._spawnBurst(event.x, event.y, event.color || '#f59e0b', 10);
        this._spawnPopText(event.x, event.y - 24, `${event.label || 'アイテム'}出現！`, event.color || '#f59e0b');
        break;
      case 'item_pickup':
        sfx.playItem();
        this._spawnBurst(event.x, event.y, event.color || '#22c55e', 14);
        if (event.popText) {
          this._spawnPopText(event.x, event.y - 24, event.popText, event.color || '#22c55e');
        }
        break;
      case 'special':
        sfx.playSpecial(event.element || 'none');
        this._spawnBurst(event.x, event.y, event.color || '#3b82f6', 10);
        if (event.specialId === 'slash') {
          this._spawnSlashArc(event.x + (event.facing || 1) * 45, event.y, event.facing || 1, 70, event.color || '#3b82f6', true);
        }
        break;
      case 'lightning':
        this._spawnLightningBolt(event.x, event.y1, event.x, event.y2, '#facc15');
        this._triggerShake(0.18, 8);
        break;
      case 'shield_block':
        sfx.playShield();
        this._spawnBurst(event.x, event.y, '#38bdf8', 8);
        this._spawnPopText(event.x, event.y - 24, 'GUARD!', '#0284c7');
        break;
      case 'shield_break':
        sfx.playHit(true);
        this._spawnBurst(event.x, event.y, '#facc15', 16);
        this._spawnPopText(event.x, event.y - 24, 'BREAK!', '#eab308');
        break;
      case 'grab':
        sfx.playGrab();
        this._spawnPopText(event.x, event.y - 20, 'GRAB!', '#8b5cf6');
        break;
      case 'ledge_grab':
        sfx.playGrab();
        this._spawnBurst(event.x, event.y, '#facc15', 10);
        this._spawnPopText(event.x, event.y - 26, 'LEDGE!', '#f59e0b');
        break;
      case 'up_special':
        sfx.playSpecial('star');
        this._spawnBurst(event.x, event.y, event.color || '#38bdf8', 14);
        this._spawnPopText(event.x, event.y - 40, '復帰ジャンプ!', '#0284c7');
        break;
      case 'sfx':
        if (event.sound === 'jump') {
          sfx.playJump();
          if (typeof event.x === 'number') this._spawnDust(event.x, event.y, 4);
        } else if (event.sound === 'tick') sfx.playTick();
        else if (event.sound === 'go') sfx.playDrawStart();
        else if (event.sound === 'warning') sfx.playWarning();
        else if (event.sound === 'finish') sfx.playFinish();
        break;
    }
  }

  _broadcastEvent(event) {
    if (this.isHost) {
      this.onEventBroadcast(event);
    }
  }

  _emitHUD() {
    this.onHUDUpdate({
      timeLeft: Math.ceil(this.timeLeft),
      fighters: this.fighters.map((f) => ({
        id: f.id,
        name: f.name,
        color: f.color,
        team: f.team,
        damage: Math.round(f.damage),
        stocks: this.mode === 'stock' ? f.stocks : 0,
        maxStocks: this.mode === 'stock' ? f.maxStocks : 0,
        specialCdRatio: clamp(1 - f.specialCooldown / this._getEffectiveSpecialCooldown(f), 0, 1),
        isOut: f.isOut,
        isCPU: f.isCPU,
        cpuLevel: f.cpuLevel || 'normal',
        kos: f.kos,
      })),
      banner: this.banner,
    });
  }

  // --- Visual Effects Helpers ---
  _triggerShake(duration, intensity) {
    this.shakeTimer = Math.max(this.shakeTimer, duration);
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
  }

  _spawnParticle(x, y, vx, vy, color, size, life) {
    if (this.particles.length > 260) this.particles.shift();
    this.particles.push({ x, y, vx, vy, color, size, life, maxLife: life });
  }

  _spawnBurst(x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const spd = 90 + Math.random() * 290;
      this._spawnParticle(
        x,
        y,
        Math.cos(a) * spd,
        Math.sin(a) * spd - 40,
        color,
        4 + Math.random() * 6,
        0.26 + Math.random() * 0.25
      );
    }
  }

  _spawnDust(x, y, count = 5, color = '#d6d3d1') {
    for (let i = 0; i < count; i++) {
      this._spawnParticle(
        x + (Math.random() - 0.5) * 24,
        y - 2,
        (Math.random() - 0.5) * 120,
        -25 - Math.random() * 65,
        color,
        5 + Math.random() * 5,
        0.28 + Math.random() * 0.18
      );
    }
  }

  _spawnPopText(x, y, text, color = '#ef4444') {
    this.popTexts.push({
      x,
      y,
      text,
      color,
      life: 0.72,
      maxLife: 0.72,
    });
  }

  _spawnKOBeam(x, y, angle, color) {
    this.koBeams.push({ x, y, angle, color, life: 0.55, maxLife: 0.55 });
  }

  _spawnLightningBolt(x1, y1, x2, y2, color) {
    const pts = [{ x: x1, y: y1 }];
    const steps = 8;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      pts.push({
        x: x1 + (x2 - x1) * t + (Math.random() - 0.5) * 44,
        y: y1 + (y2 - y1) * t,
      });
    }
    pts.push({ x: x2, y: y2 });
    this.lightningBolts.push({ pts, color, life: 0.28, maxLife: 0.28 });
  }

  _spawnSlashArc(x, y, facing, radius, color, heavy) {
    this.slashArcs.push({
      x,
      y,
      facing,
      radius,
      color,
      heavy,
      life: heavy ? 0.22 : 0.15,
      maxLife: heavy ? 0.22 : 0.15,
    });
  }

  _updateEffects(dt) {
    // Emit menacing red-gold ember sparks around 'insane' (バカ強い) CPU bosses
    if (this.phase === 'playing' || this.phase === 'countdown') {
      for (const f of this.fighters) {
        if (!this._isInsaneBoss(f) || f.isOut || f.respawnTimer > 0) continue;
        if (Math.random() < 0.42) {
          const emberColor = Math.random() < 0.5 ? '#ef4444' : Math.random() < 0.65 ? '#f97316' : '#facc15';
          this._spawnParticle(
            f.x + (Math.random() - 0.5) * (f.width * 1.15),
            f.y - Math.random() * (f.height * 0.85),
            (Math.random() - 0.5) * 45,
            -95 - Math.random() * 110,
            emberColor,
            3 + Math.random() * 3.5,
            0.35 + Math.random() * 0.28
          );
        }
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 420 * dt;
    }

    for (let i = this.popTexts.length - 1; i >= 0; i--) {
      const pt = this.popTexts[i];
      pt.life -= dt;
      pt.y -= 42 * dt;
      if (pt.life <= 0) this.popTexts.splice(i, 1);
    }

    for (let i = this.koBeams.length - 1; i >= 0; i--) {
      this.koBeams[i].life -= dt;
      if (this.koBeams[i].life <= 0) this.koBeams.splice(i, 1);
    }

    for (let i = this.lightningBolts.length - 1; i >= 0; i--) {
      this.lightningBolts[i].life -= dt;
      if (this.lightningBolts[i].life <= 0) this.lightningBolts.splice(i, 1);
    }

    for (let i = this.slashArcs.length - 1; i >= 0; i--) {
      this.slashArcs[i].life -= dt;
      if (this.slashArcs[i].life <= 0) this.slashArcs.splice(i, 1);
    }
  }

  // --- Rendering ---
  _render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.stage.width;
    const h = this.stage.height;

    ctx.save();
    // Apply camera screen shake
    if (this.shakeTimer > 0) {
      const mag = this.shakeIntensity * (this.shakeTimer / 0.25);
      const ox = (Math.random() - 0.5) * 2 * Math.min(mag, 16);
      const oy = (Math.random() - 0.5) * 2 * Math.min(mag, 16);
      ctx.translate(ox, oy);
    }

    // 1. Stage background & platforms
    drawStage(ctx, this.stageId, w, h, this._renderTime);

    // 2. KO beams behind fighters
    this._renderKOBeams(ctx);

    // 3. Items
    this._renderItems(ctx);

    // 4. Fighters & respawn platforms
    for (const f of this.fighters) {
      if (f.isOut || f.respawnTimer > 0) continue;

      if (f.respawnPlatTimer > 0) {
        this._renderRespawnPlatform(ctx, f);
      }

      // Airborne projected shadow onto platform below (grounded shadow is drawn by drawFighter)
      if (!f.onGround) {
        this._renderFighterShadow(ctx, f);
      }

      // Fiery red-gold boss aura behind 'insane' (バカ強い) CPU fighters
      if (this._isInsaneBoss(f)) {
        this._renderInsaneBossAura(ctx, f);
      }

      const teamColor = this.teamMode ? TEAM_COLORS[f.team] || f.color : null;
      const state = {
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        facing: f.facing,
        animState: f.animState,
        animTime: f.animTime,
        vx: f.vx,
        vy: f.vy,
        onGround: f.onGround,
        shieldActive: f.shieldActive,
        shieldHp: f.shieldHp,
        hitFlash: f.hitFlash,
        giantTimer: f.giantTimer,
        invulnTimer: f.invulnTimer,
        chargeRatio: f.chargeRatio,
        color: f.color,
        name: f.name,
        teamColor,
        isLocal: f.id === this.localPlayerId,
        hasHammer: f.hammerTimer > 0,
      };

      if (f.sprite) {
        drawFighter(ctx, f.sprite, state);
      } else {
        this._renderFallbackFighter(ctx, f);
      }

      // Cute ledge-grab spark/grip badge on the grabbed corner
      if (f.ledgeSide !== 0) {
        const mainPlat = this._getMainPlatform();
        if (mainPlat) {
          const cx = f.ledgeSide === -1 ? mainPlat.x : mainPlat.x + mainPlat.w;
          const cy = mainPlat.y;
          ctx.save();
          const pulse = 1 + Math.sin(this._renderTime * 18) * 0.2;
          ctx.fillStyle = '#fef08a';
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.arc(cx, cy, 9 * pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#1f2937';
          ctx.beginPath();
          ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // Ice slow visual ring
      if (f.slowTimer > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.ellipse(f.x, f.y - f.height * 0.5, f.width * 0.6, f.height * 0.56, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 5. Offscreen fighter magnifying arrows when near blast zones
    this._renderOffscreenIndicators(ctx);

    // 6. Slash arcs, lightning bolts, projectiles, particles, comic pop text
    this._renderSlashArcs(ctx);
    this._renderLightningBolts(ctx);
    this._renderProjectiles(ctx);
    this._renderParticles(ctx);
    this._renderPopTexts(ctx);

    // 7. Center match banner (3, 2, 1, GO!, GAME SET!)
    if (this.banner) {
      this._renderBanner(ctx, w, h, this.banner);
    }

    ctx.restore();
  }

  _renderInsaneBossAura(ctx, f) {
    const t = this._renderTime;
    const cx = f.x;
    const cy = f.y - f.height * 0.5;
    const rx = f.width * 0.68;
    const ry = f.height * 0.62;
    const pulse = 1 + Math.sin(t * 14) * 0.07;

    ctx.save();
    // Glowing fiery radial backdrop
    const grad = ctx.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.2, cx, cy, Math.max(rx, ry) * 1.25 * pulse);
    grad.addColorStop(0, 'rgba(250, 204, 21, 0.34)');
    grad.addColorStop(0.55, 'rgba(239, 68, 68, 0.24)');
    grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 1.32 * pulse, ry * 1.28 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();

    // Flickering spiky flame wisps around silhouette
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const spikes = 12;
    for (let i = 0; i <= spikes; i++) {
      const a = (i / spikes) * Math.PI * 2 + t * 2.4;
      const jitter = 1 + Math.sin(t * 18 + i * 2.1) * 0.14;
      const radX = rx * (i % 2 === 0 ? 1.08 : 0.88) * jitter;
      const radY = ry * (i % 2 === 0 ? 1.12 : 0.9) * jitter;
      const px = cx + Math.cos(a) * radX;
      const py = cy + Math.sin(a) * radY;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    // Inner golden dashed energy ring
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.92 * pulse, ry * 0.92 * pulse, -t * 1.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _renderFighterShadow(ctx, f) {
    let shadowY = null;
    for (const p of this.stage.platforms) {
      if (f.x >= p.x && f.x <= p.x + p.w && p.y >= f.y - 2) {
        if (shadowY === null || p.y < shadowY) shadowY = p.y;
      }
    }
    if (shadowY === null) return;
    const dist = shadowY - f.y;
    if (dist > 220) return;
    const factor = clamp(1 - dist / 220, 0.25, 1);
    ctx.save();
    ctx.fillStyle = `rgba(15, 23, 42, ${0.18 * factor})`;
    ctx.beginPath();
    ctx.ellipse(f.x, shadowY + 2, f.width * 0.42 * factor, 5 * factor, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _renderRespawnPlatform(ctx, f) {
    ctx.save();
    const pulse = 0.75 + Math.sin(this._renderTime * 10) * 0.25;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * pulse})`;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(f.x - 42, f.y + 4);
    ctx.lineTo(f.x + 42, f.y + 4);
    ctx.lineTo(f.x + 26, f.y + 18);
    ctx.lineTo(f.x - 26, f.y + 18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  _renderFallbackFighter(ctx, f) {
    ctx.save();
    ctx.fillStyle = f.hitFlash > 0 ? '#ffffff' : f.color;
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(f.x - f.width / 2, f.y - f.height, f.width, f.height, 12);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  _renderItems(ctx) {
    for (const item of this.items) {
      const bob = Math.sin(this._renderTime * 5 + item.id) * 5;
      const iy = item.y + bob;
      ctx.save();
      // Glowing hand-drawn bubble
      ctx.beginPath();
      ctx.arc(item.x, iy, 23, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = item.color;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(item.x, iy, 28 + Math.sin(this._renderTime * 7) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Emoji / icon
      ctx.font = '24px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.emoji || '⭐', item.x, iy + 1);

      // Small label
      ctx.font = 'bold 12px "Rounded Mplus 1c", sans-serif';
      ctx.fillStyle = '#1f2937';
      ctx.fillText(item.label, item.x, iy + 36);
      ctx.restore();
    }
  }

  _renderProjectiles(ctx) {
    for (const p of this.projectiles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.kind === 'star') {
        ctx.rotate((p.age || 0) * 11);
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? p.radius : p.radius * 0.45;
          const a = (i * Math.PI) / 5;
          if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'bomb') {
        ctx.fillStyle = '#1f2937';
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Lit fuse spark
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(4, -p.radius);
        ctx.lineTo(12, -p.radius - 10);
        ctx.stroke();
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(13, -p.radius - 11, 5 + Math.sin(this._renderTime * 30) * 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'slash' || p.kind === 'ink_wave') {
        const dir = p.vx >= 0 ? 1 : -1;
        ctx.scale(dir, 1);
        ctx.fillStyle = p.color;
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, -Math.PI * 0.48, Math.PI * 0.48);
        ctx.quadraticCurveTo(p.radius * 0.25, 0, 0, -p.radius);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'ice') {
        const dir = p.vx >= 0 ? 1 : -1;
        ctx.scale(dir, 1);
        ctx.fillStyle = '#bae6fd';
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(p.radius * 1.25, 0);
        ctx.lineTo(-p.radius * 0.5, -p.radius * 0.65);
        ctx.lineTo(-p.radius, 0);
        ctx.lineTo(-p.radius * 0.5, p.radius * 0.65);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'quake') {
        ctx.fillStyle = '#f59e0b';
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(-p.radius, 12);
        ctx.lineTo(0, -p.radius);
        ctx.lineTo(p.radius, 12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // Fireball / generic orb
        ctx.fillStyle = p.color;
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(0, 0, p.radius * 0.52, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  _renderSlashArcs(ctx) {
    for (const s of this.slashArcs) {
      const t = s.life / s.maxLife;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(s.facing, 1);
      ctx.globalAlpha = t;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.heavy ? 9 * t + 3 : 5 * t + 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, s.radius, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, s.radius + 4, -Math.PI * 0.36, Math.PI * 0.36);
      ctx.stroke();
      ctx.restore();
    }
  }

  _renderLightningBolts(ctx) {
    for (const b of this.lightningBolts) {
      const alpha = b.life / b.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 10;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      b.pts.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();

      ctx.strokeStyle = b.color || '#facc15';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.restore();
    }
  }

  _renderKOBeams(ctx) {
    for (const beam of this.koBeams) {
      const t = beam.life / beam.maxLife;
      ctx.save();
      ctx.translate(beam.x, beam.y);
      ctx.rotate(beam.angle);
      ctx.globalAlpha = t * 0.85;

      const grad = ctx.createLinearGradient(0, 0, 520, 0);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.25, beam.color);
      grad.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.fillStyle = grad;
      const spread = 120 * t + 28;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(540, -spread);
      ctx.lineTo(540, spread);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  _renderParticles(ctx) {
    for (const p of this.particles) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * alpha), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  _renderPopTexts(ctx) {
    for (const pt of this.popTexts) {
      const t = pt.life / pt.maxLife;
      const scale = t > 0.78 ? 1 + (1 - t) * 1.4 : 1;
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = clamp(t * 1.4, 0, 1);
      ctx.font = '900 26px "Comic Sans MS", "Rounded Mplus 1c", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(pt.text, 0, 0);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#1f2937';
      ctx.strokeText(pt.text, 0, 0);
      ctx.fillStyle = pt.color;
      ctx.fillText(pt.text, 0, 0);
      ctx.restore();
    }
  }

  _renderOffscreenIndicators(ctx) {
    const w = this.stage.width;
    const h = this.stage.height;
    const bz = this.stage.blastZone;
    for (const f of this.fighters) {
      if (f.isOut || f.respawnTimer > 0) continue;
      const fcy = f.y - f.height * 0.5;
      if (f.x >= 0 && f.x <= w && fcy >= 0 && fcy <= h) continue;

      const pad = 42;
      const ix = clamp(f.x, pad, w - pad);
      const iy = clamp(fcy, pad, h - pad);
      const angle = Math.atan2(fcy - iy, f.x - ix);

      // Measure danger closeness to blast zone
      const nearBlast =
        f.x < bz.left + 85 ||
        f.x > bz.right - 85 ||
        f.y < bz.top + 85 ||
        f.y > bz.bottom - 95;

      ctx.save();
      // Directional pointer arrow pointing toward offscreen fighter
      ctx.save();
      ctx.translate(ix + Math.cos(angle) * 32, iy + Math.sin(angle) * 32);
      ctx.rotate(angle);
      ctx.fillStyle = nearBlast ? '#ef4444' : f.color;
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-6, -8);
      ctx.lineTo(-6, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Pulsing danger halo when near blast zone
      if (nearBlast) {
        ctx.beginPath();
        ctx.arc(ix, iy, 31 + Math.sin(this._renderTime * 22) * 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Magnifying-glass bubble
      ctx.beginPath();
      ctx.arc(ix, iy, 27, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 253, 247, 0.94)';
      ctx.fill();
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 4;
      ctx.stroke();

      // Compact name + damage% inside bubble
      const shortName = (f.name || 'P').slice(0, 5);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 10px "Rounded Mplus 1c", sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText(shortName, ix, iy - 8);

      ctx.font = '900 14px "Comic Sans MS", sans-serif';
      ctx.fillStyle = f.damage >= 100 ? '#ef4444' : '#1f2937';
      ctx.fillText(`${Math.round(f.damage)}%`, ix, iy + 8);
      ctx.restore();
    }
  }

  _renderBanner(ctx, w, h, text) {
    ctx.save();
    const pulse = 1 + Math.sin(this._renderTime * 10) * 0.05;
    ctx.translate(w * 0.5, h * 0.4);
    ctx.scale(pulse, pulse);
    ctx.font = '900 84px "Comic Sans MS", "Rounded Mplus 1c", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#1f2937';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = text === 'GO!' ? '#22c55e' : text === 'GAME SET!' ? '#ef4444' : '#facc15';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

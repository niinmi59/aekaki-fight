// 60秒ファイター！ — PeerJS WebRTC マルチプレイ通信＆ホスト引き継ぎマネージャー
import {
  MAX_PLAYERS,
  createDefaultPlayer,
  generateRoomCode,
  AVATAR_COLORS,
} from './shared.js';

const PEER_PREFIX_ROOM = 'fighter60s-r-';
const PEER_PREFIX_CLIENT = 'fighter60s-p-';

const HEARTBEAT_INTERVAL_MS = 3000;
const HEARTBEAT_TIMEOUT_MS = 9000;
const CONNECT_TIMEOUT_MS = 12000;
const MAX_CREATE_RETRIES = 3;
const MIGRATION_RECONNECT_ATTEMPTS = 3;
const MIGRATION_HOST_GRACE_MS = 6500;

const PEER_CONFIG = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  },
};

const VALID_CPU_LEVELS = new Set(['easy', 'normal', 'hard', 'expert', 'insane']);
const DEFAULT_CPU_LEVEL = 'normal';

const DEFAULT_SETTINGS = {
  battleMode: 'ffa', // 'ffa' | '1v1' | '2v2'
  ruleMode: 'stock', // 'stock' | 'time'
  stockCount: 3,
  timeLimit: 120,
  stageId: 'notebook',
  themeId: 'random',
  cpuLevel: DEFAULT_CPU_LEVEL,
};

function normalizeCpuLevel(level, fallback = DEFAULT_CPU_LEVEL) {
  if (typeof level === 'string' && VALID_CPU_LEVELS.has(level)) {
    return level;
  }
  return VALID_CPU_LEVELS.has(fallback) ? fallback : DEFAULT_CPU_LEVEL;
}

function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj);
    } catch {
      // Fallback to JSON clone
    }
  }
  return JSON.parse(JSON.stringify(obj));
}

function randomId(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function sanitizeName(name, fallback = 'プレイヤー') {
  const cleaned = String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 16);
  return cleaned || fallback;
}

function normalizeRoomCode(code) {
  const halfWidth = String(code ?? '')
    .trim()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(halfWidth)) return null;
  return halfWidth;
}

function mapPeerError(err) {
  const type = err?.type || err?.code || '';
  switch (type) {
    case 'peer-unavailable':
      return '部屋が見つかりませんでした。部屋コードを確認してください。';
    case 'unavailable-id':
      return '部屋コードがすでに使用されています。もう一度お試しください。';
    case 'browser-incompatible':
      return 'このブラウザはオンライン対戦（WebRTC）に対応していません。';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return '通信サーバーへの接続に失敗しました。ネットワーク環境を確認してください。';
    case 'webrtc':
      return 'P2P通信の確立に失敗しました。ネットワーク環境を確認してください。';
    default:
      return err?.message || '通信エラーが発生しました。';
  }
}

export class NetworkManager {
  constructor(callbacks = {}) {
    this._cb = { ...callbacks };

    this._peer = null;
    this._peerId = null;
    this._roomCode = null;
    this._localPlayerId = null;
    this._isHost = false;

    this._players = [];
    this._settings = { ...DEFAULT_SETTINGS };
    this._phase = 'LOBBY';
    this._currentTheme = null;
    this._peerDirectory = {}; // { [playerId]: { peerId, joinOrder } }
    this._hostId = null;

    this._nextJoinOrder = 1;
    this._cpuCounter = 0;

    // Host-side active connections: playerId -> { conn, peerId, lastSeen }
    this._connections = new Map();
    // Connections arriving before we finish promoting ourselves to host
    this._earlyMigrationQueue = [];

    // Client-side connection to current host
    this._hostConn = null;
    this._hostLastSeen = 0;

    this._heartbeatTimer = null;
    this._migrationGraceTimer = null;
    this._reconnectPeerTimer = null;
    this._peerReconnectAttempts = 0;

    this._migrating = false;
    this._destroyed = false;
    this._disconnectedPlayerIds = new Set();

    this._unloadHandler = null;
  }

  // =========================================================================
  // Public Getters
  // =========================================================================

  isHost() {
    return this._isHost;
  }

  getRoomCode() {
    return this._roomCode;
  }

  getLocalPlayerId() {
    return this._localPlayerId;
  }

  getPlayers() {
    return deepClone(this._players);
  }

  getSettings() {
    return deepClone(this._settings);
  }

  // =========================================================================
  // Room Creation & Joining
  // =========================================================================

  async createRoom(playerProfile = {}) {
    this._ensurePeerJS();
    this._cleanup(false);
    this._destroyed = false;

    let openedPeer = null;
    let chosenRoomCode = null;
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_CREATE_RETRIES; attempt++) {
      const code = generateRoomCode();
      const peerId = `${PEER_PREFIX_ROOM}${code}`;
      try {
        openedPeer = await this._openPeer(peerId);
        chosenRoomCode = code;
        break;
      } catch (err) {
        lastError = err;
        const errType = err?.type || err?.code;
        if (errType === 'unavailable-id' && attempt < MAX_CREATE_RETRIES) {
          continue;
        }
        const message = mapPeerError(err);
        this._emit('onError', message);
        throw new Error(message);
      }
    }

    if (!openedPeer || !chosenRoomCode) {
      const message = mapPeerError(lastError);
      this._emit('onError', message);
      throw new Error(message);
    }

    this._peer = openedPeer;
    this._peerId = openedPeer.id;
    this._roomCode = chosenRoomCode;
    this._isHost = true;
    this._localPlayerId = `p_${randomId(8)}`;
    this._hostId = this._localPlayerId;
    this._nextJoinOrder = 1;
    this._cpuCounter = 0;
    this._phase = 'LOBBY';
    this._currentTheme = null;
    this._settings = { ...DEFAULT_SETTINGS };
    this._disconnectedPlayerIds.clear();

    const joinOrder = this._nextJoinOrder++;
    const hostPlayer = createDefaultPlayer({
      id: this._localPlayerId,
      peerId: this._peerId,
      slot: 0,
      name: sanitizeName(playerProfile?.name, 'ホスト'),
      color: playerProfile?.color || AVATAR_COLORS[0],
      team: 'A',
      isHost: true,
      isCPU: false,
      connected: true,
      ready: true,
      drawDone: false,
      strokes: [],
      stats: null,
      joinOrder,
    });

    this._players = [hostPlayer];
    this._peerDirectory = {
      [this._localPlayerId]: { peerId: this._peerId, joinOrder },
    };

    this._attachPeerListeners(this._peer);
    this._attachUnloadHandler();
    this._startHeartbeat();

    this._emit('onRoomReady', {
      roomCode: this._roomCode,
      peerId: this._peerId,
      isHost: true,
      players: this.getPlayers(),
      settings: this.getSettings(),
    });

    return {
      roomCode: this._roomCode,
      peerId: this._peerId,
      localPlayerId: this._localPlayerId,
    };
  }

  async joinRoom(roomCode, playerProfile = {}) {
    this._ensurePeerJS();

    const cleanCode = normalizeRoomCode(roomCode);
    if (!cleanCode) {
      const msg = '部屋コードは6桁の数字で入力してください';
      this._emit('onError', msg);
      throw new Error(msg);
    }

    this._cleanup(false);
    this._destroyed = false;

    const localPlayerId = `p_${randomId(8)}`;
    const clientPeerId = `${PEER_PREFIX_CLIENT}${randomId(10)}`;
    const targetRoomPeerId = `${PEER_PREFIX_ROOM}${cleanCode}`;

    const profile = {
      name: sanitizeName(playerProfile?.name, 'プレイヤー'),
      color: playerProfile?.color || AVATAR_COLORS[1],
    };

    let peer;
    try {
      peer = await this._openPeer(clientPeerId);
    } catch (err) {
      const msg = mapPeerError(err);
      this._emit('onError', msg);
      throw new Error(msg);
    }

    this._peer = peer;
    this._peerId = peer.id;

    try {
      const accepted = await new Promise((resolve, reject) => {
        let settled = false;

        const finishResolve = (val) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          peer.off('error', onStartupPeerError);
          resolve(val);
        };

        const finishReject = (message) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          peer.off('error', onStartupPeerError);
          reject(new Error(message));
        };

        const onStartupPeerError = (err) => {
          if (err?.type === 'peer-unavailable') {
            finishReject('部屋が見つかりませんでした。部屋コードを確認してください。');
          } else {
            finishReject(mapPeerError(err));
          }
        };

        peer.on('error', onStartupPeerError);

        const timer = setTimeout(() => {
          finishReject('部屋への接続がタイムアウトしました。部屋コードを確認してください。');
        }, CONNECT_TIMEOUT_MS);

        const conn = peer.connect(targetRoomPeerId, {
          reliable: true,
          metadata: {
            kind: 'join',
            playerId: localPlayerId,
            profile,
          },
        });

        if (!conn) {
          finishReject('接続の初期化に失敗しました。');
          return;
        }

        const onData = (msg) => {
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'join_accept') {
            conn.off('data', onData);
            conn.off('close', onEarlyClose);
            conn.off('error', onEarlyError);
            finishResolve({ conn, msg });
          } else if (msg.type === 'join_reject') {
            conn.off('data', onData);
            conn.off('close', onEarlyClose);
            conn.off('error', onEarlyError);
            try {
              conn.close();
            } catch {
              // ignore
            }
            finishReject(msg.reason || '入室できませんでした');
          }
        };

        const onEarlyClose = () => {
          finishReject('部屋への接続が切断されました。満員または開始済みの可能性があります。');
        };

        const onEarlyError = (err) => {
          finishReject(mapPeerError(err));
        };

        conn.on('open', () => {
          this._send(conn, {
            type: 'join_request',
            playerId: localPlayerId,
            profile,
          });
        });

        conn.on('data', onData);
        conn.on('close', onEarlyClose);
        conn.on('error', onEarlyError);
      });

      const { conn, msg } = accepted;

      this._isHost = false;
      this._roomCode = cleanCode;
      this._localPlayerId = msg.playerId || localPlayerId;
      this._hostConn = conn;
      this._hostLastSeen = Date.now();
      this._disconnectedPlayerIds.clear();

      this._applyRoomState(msg.state || {}, false);

      this._attachPeerListeners(this._peer);
      this._attachHostConnListeners(conn);
      this._attachUnloadHandler();
      this._startHeartbeat();

      this._emit('onRoomReady', {
        roomCode: this._roomCode,
        peerId: this._peerId,
        isHost: false,
        players: this.getPlayers(),
        settings: this.getSettings(),
      });

      return {
        roomCode: this._roomCode,
        peerId: this._peerId,
        localPlayerId: this._localPlayerId,
      };
    } catch (err) {
      this._cleanup(false);
      const message = err?.message || '部屋への参加に失敗しました。';
      this._emit('onError', message);
      throw new Error(message);
    }
  }

  disconnect() {
    // Notify peers politely so they react immediately without waiting for heartbeat timeout
    try {
      if (this._localPlayerId) {
        const leaveMsg = { type: 'leave', playerId: this._localPlayerId };
        if (this._isHost) {
          this._broadcast(leaveMsg);
        } else if (this._hostConn && this._hostConn.open) {
          this._send(this._hostConn, leaveMsg);
        }
      }
    } catch {
      // ignore send failures during disconnect
    }
    this._cleanup(true);
  }

  // =========================================================================
  // Lobby Management Methods
  // =========================================================================

  updateSettings(partialSettings = {}) {
    if (!this._isHost || !partialSettings || typeof partialSettings !== 'object') return;
    const { applyToExistingCPUs, ...rest } = partialSettings;
    const nextSettings = { ...rest };

    if ('cpuLevel' in nextSettings) {
      if (typeof nextSettings.cpuLevel === 'string' && VALID_CPU_LEVELS.has(nextSettings.cpuLevel)) {
        // valid cpuLevel
      } else {
        delete nextSettings.cpuLevel;
      }
    }

    this._settings = {
      ...this._settings,
      ...nextSettings,
    };

    let cpuPlayersUpdated = false;
    if (
      applyToExistingCPUs &&
      typeof nextSettings.cpuLevel === 'string' &&
      VALID_CPU_LEVELS.has(nextSettings.cpuLevel)
    ) {
      for (const p of this._players) {
        if (p.isCPU) {
          p.cpuLevel = nextSettings.cpuLevel;
          cpuPlayersUpdated = true;
        }
      }
    }

    if (this._settings.battleMode === '2v2') {
      this._ensureValidTeams();
    }
    this._broadcastRoomSync();
    this._emit('onSettingsUpdate', this.getSettings());
    if (cpuPlayersUpdated) {
      this._emit('onPlayersUpdate', this.getPlayers());
    }
  }

  addCPU(cpuLevel) {
    if (!this._isHost) return null;
    if (this._players.length >= MAX_PLAYERS) {
      this._emit('onNotification', '部屋が満員です（最大4人）', 'warn');
      return null;
    }

    const slot = this._findAvailableSlot();
    if (slot === -1) return null;

    const usedCpuNums = new Set(
      this._players
        .filter((p) => p.isCPU)
        .map((p) => {
          const m = String(p.name).match(/CPU\s*(\d+)/i);
          return m ? Number(m[1]) : 0;
        }),
    );
    let cpuNum = 1;
    while (usedCpuNums.has(cpuNum)) cpuNum++;

    this._cpuCounter++;
    const cpuId = `cpu_${this._cpuCounter}_${randomId(4)}`;
    const team = this._pickBalancedTeam();
    const color = this._pickNextColor();
    const resolvedCpuLevel = normalizeCpuLevel(cpuLevel, this._settings.cpuLevel || DEFAULT_CPU_LEVEL);

    const cpu = createDefaultPlayer({
      id: cpuId,
      peerId: null,
      slot,
      name: `CPU ${cpuNum}`,
      color,
      team,
      isHost: false,
      isCPU: true,
      cpuLevel: resolvedCpuLevel,
      connected: true,
      ready: true,
      drawDone: false,
      strokes: [],
      stats: null,
      joinOrder: 900 + this._cpuCounter,
    });

    this._players.push(cpu);
    this._broadcastRoomSync();
    this._emit('onPlayersUpdate', this.getPlayers());
    return deepClone(cpu);
  }

  setCPULevel(playerId, cpuLevel) {
    if (!this._isHost || !playerId) return false;
    if (typeof cpuLevel !== 'string' || !VALID_CPU_LEVELS.has(cpuLevel)) return false;

    const player = this._players.find((p) => p.id === playerId && p.isCPU);
    if (!player) return false;

    player.cpuLevel = cpuLevel;
    this._broadcastRoomSync();
    this._emit('onPlayersUpdate', this.getPlayers());
    return true;
  }

  removeCPU(cpuId) {
    if (!this._isHost || !cpuId) return false;
    const idx = this._players.findIndex((p) => p.id === cpuId && p.isCPU);
    if (idx === -1) return false;
    this._players.splice(idx, 1);
    this._broadcastRoomSync();
    this._emit('onPlayersUpdate', this.getPlayers());
    return true;
  }

  toggleTeam(playerId) {
    const targetId = playerId || this._localPlayerId;
    if (!targetId) return;

    if (this._isHost) {
      const player = this._players.find((p) => p.id === targetId);
      if (!player) return;
      player.team = player.team === 'A' ? 'B' : 'A';
      this._broadcastRoomSync();
      this._emit('onPlayersUpdate', this.getPlayers());
    } else if (this._hostConn && this._hostConn.open) {
      this._send(this._hostConn, {
        type: 'client_toggle_team',
        playerId: this._localPlayerId,
        targetPlayerId: targetId,
      });
    }
  }

  setReady(ready) {
    const flag = Boolean(ready);
    const localPlayer = this._players.find((p) => p.id === this._localPlayerId);
    if (localPlayer) {
      localPlayer.ready = flag;
    }

    if (this._isHost) {
      this._broadcastRoomSync();
      this._emit('onPlayersUpdate', this.getPlayers());
    } else if (this._hostConn && this._hostConn.open) {
      this._send(this._hostConn, {
        type: 'client_ready',
        playerId: this._localPlayerId,
        ready: flag,
      });
      this._emit('onPlayersUpdate', this.getPlayers());
    }
  }

  // =========================================================================
  // Phase & Drawing Sync Methods
  // =========================================================================

  startDrawing(theme) {
    if (!this._isHost) return;

    // Remove disconnected humans before starting a new drawing round
    this._pruneDisconnectedPlayers();

    for (const p of this._players) {
      p.drawDone = false;
      p.strokes = [];
      p.stats = null;
    }

    this._phase = 'DRAW';
    this._currentTheme = theme || null;

    const payload = {
      theme: this._currentTheme,
      startTime: Date.now(),
      duration: 60,
    };

    this._broadcastRoomSync();
    this._broadcast({
      type: 'phase_change',
      phase: 'DRAW',
      payload,
    });

    this._emit('onPlayersUpdate', this.getPlayers());
    this._emit('onPhaseChange', 'DRAW', payload);
  }

  sendDrawChunk(strokeMeta, points) {
    if (!strokeMeta || !Array.isArray(points) || points.length === 0) return;
    this._sendDrawEvent({
      type: 'chunk',
      strokeMeta,
      points,
    });
  }

  sendDrawEnd(strokeId) {
    if (!strokeId) return;
    this._sendDrawEvent({
      type: 'end',
      strokeId,
    });
  }

  sendDrawUndo(strokeId) {
    this._sendDrawEvent({
      type: 'undo',
      strokeId,
    });
  }

  sendDrawClear() {
    this._sendDrawEvent({
      type: 'clear',
    });
  }

  sendDrawDone(finalStrokes = []) {
    const strokes = Array.isArray(finalStrokes) ? finalStrokes : [];
    const localPlayer = this._players.find((p) => p.id === this._localPlayerId);
    if (localPlayer) {
      localPlayer.drawDone = true;
      localPlayer.strokes = strokes;
    }

    const msg = {
      type: 'draw_done',
      playerId: this._localPlayerId,
      strokes,
    };

    if (this._isHost) {
      this._broadcast(msg);
      this._broadcastRoomSync();
      this._emit('onPlayersUpdate', this.getPlayers());
      this._emit('onPlayerDrawDone', this._localPlayerId, strokes);
    } else if (this._hostConn && this._hostConn.open) {
      this._send(this._hostConn, msg);
      this._emit('onPlayersUpdate', this.getPlayers());
    }
  }

  broadcastStats(playersWithStats = []) {
    if (!this._isHost) return;

    this._phase = 'STATS';
    const byId = new Map(playersWithStats.map((p) => [p.id, p]));
    const internalById = new Map(this._players.map((p) => [p.id, p]));
    for (const p of this._players) {
      const updated = byId.get(p.id);
      if (updated) {
        p.strokes = updated.strokes ?? p.strokes;
        p.stats = updated.stats ?? p.stats;
        if (p.isCPU) {
          p.cpuLevel = normalizeCpuLevel(updated.cpuLevel ?? p.cpuLevel, this._settings.cpuLevel);
        }
        p.drawDone = true;
      }
    }

    const payloadPlayers = deepClone(playersWithStats).map((p) => {
      const canonical = internalById.get(p.id);
      if (p.isCPU || canonical?.isCPU) {
        p.cpuLevel = normalizeCpuLevel(
          p.cpuLevel ?? canonical?.cpuLevel,
          this._settings.cpuLevel,
        );
      }
      return p;
    });
    this._broadcast({
      type: 'stats_ready',
      players: payloadPlayers,
    });
    this._broadcastRoomSync();
    this._emit('onPlayersUpdate', this.getPlayers());
  }

  broadcastStartBattle(battleConfig = {}) {
    if (!this._isHost) return;
    this._phase = 'BATTLE';
    this._broadcast({
      type: 'battle_start',
      battleConfig,
    });
    this._broadcastRoomSync();
  }

  // =========================================================================
  // Battle Real-Time Sync Methods
  // =========================================================================

  sendBattleSnapshot(snapshot) {
    if (!this._isHost || !snapshot) return;
    this._broadcast({
      type: 'battle_snapshot',
      snapshot,
    });
  }

  sendBattleEvent(event) {
    if (!this._isHost || !event) return;
    this._broadcast({
      type: 'battle_event',
      event,
    });
  }

  sendClientInput(input) {
    if (this._isHost || !input) return;
    if (this._hostConn && this._hostConn.open) {
      this._send(this._hostConn, {
        type: 'client_input',
        playerId: this._localPlayerId,
        input,
      });
    }
  }

  broadcastBattleEnd(result) {
    if (!this._isHost) return;
    this._phase = 'RESULT';
    this._broadcast({
      type: 'battle_end',
      result,
    });
    this._broadcastRoomSync();
  }

  // =========================================================================
  // Post-Match Transitions
  // =========================================================================

  requestReturnToLobby() {
    if (this._isHost) {
      this._pruneDisconnectedPlayers();
      for (const p of this._players) {
        p.drawDone = false;
        p.ready = Boolean(p.isHost || p.isCPU);
      }
      this._phase = 'LOBBY';
      this._currentTheme = null;
      this._broadcastRoomSync();
      this._broadcast({
        type: 'phase_change',
        phase: 'LOBBY',
        payload: {},
      });
      this._emit('onPlayersUpdate', this.getPlayers());
      this._emit('onPhaseChange', 'LOBBY', {});
    } else if (this._hostConn && this._hostConn.open) {
      this._send(this._hostConn, {
        type: 'request_return_lobby',
        playerId: this._localPlayerId,
      });
    }
  }

  requestRematch(sameCharacters = false) {
    const keepChars = Boolean(sameCharacters);
    if (this._isHost) {
      this._pruneDisconnectedPlayers();
      if (!keepChars) {
        for (const p of this._players) {
          p.drawDone = false;
          p.strokes = [];
          p.stats = null;
        }
      }
      const nextPhase = keepChars ? 'STATS' : 'DRAW';
      this._phase = nextPhase;
      const payload = {
        rematch: true,
        sameCharacters: keepChars,
        theme: this._currentTheme,
        startTime: Date.now(),
        duration: 60,
        players: this.getPlayers(),
      };
      this._broadcastRoomSync();
      this._broadcast({
        type: 'phase_change',
        phase: nextPhase,
        payload,
      });
      this._emit('onPlayersUpdate', this.getPlayers());
      this._emit('onPhaseChange', nextPhase, payload);
    } else if (this._hostConn && this._hostConn.open) {
      this._send(this._hostConn, {
        type: 'request_rematch',
        playerId: this._localPlayerId,
        sameCharacters: keepChars,
      });
    }
  }

  // =========================================================================
  // Chat & Stamps
  // =========================================================================

  sendChat(text) {
    const cleaned = String(text ?? '').trim().slice(0, 200);
    if (!cleaned || !this._localPlayerId) return;

    const me = this._players.find((p) => p.id === this._localPlayerId);
    const message = {
      playerId: this._localPlayerId,
      name: me?.name || 'プレイヤー',
      color: me?.color || AVATAR_COLORS[0],
      text: cleaned,
      isSystem: false,
      timestamp: Date.now(),
    };

    // Display locally immediately; host never echoes back to sender
    this._emit('onChatMessage', message);

    if (this._isHost) {
      this._broadcast({ type: 'chat', message });
    } else if (this._hostConn && this._hostConn.open) {
      this._send(this._hostConn, { type: 'chat', message });
    }
  }

  sendStamp(stampId) {
    if (!stampId || !this._localPlayerId) return;

    const me = this._players.find((p) => p.id === this._localPlayerId);
    const stamp = {
      playerId: this._localPlayerId,
      name: me?.name || 'プレイヤー',
      color: me?.color || AVATAR_COLORS[0],
      stampId,
    };

    this._emit('onStamp', stamp);

    if (this._isHost) {
      this._broadcast({ type: 'stamp', stamp });
    } else if (this._hostConn && this._hostConn.open) {
      this._send(this._hostConn, { type: 'stamp', stamp });
    }
  }

  // =========================================================================
  // Internal: PeerJS Lifecycle & Incoming Connections
  // =========================================================================

  _ensurePeerJS() {
    if (typeof window === 'undefined' || typeof window.Peer !== 'function') {
      const msg = 'PeerJSの読み込みに失敗しました。ページを再読み込みしてください。';
      this._emit('onError', msg);
      throw new Error(msg);
    }
  }

  _openPeer(peerId) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let peer;

      try {
        peer = new window.Peer(peerId, PEER_CONFIG);
      } catch (err) {
        reject(err);
        return;
      }

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          peer.destroy();
        } catch {
          // ignore
        }
        reject({ type: 'network', message: '通信サーバーへの接続がタイムアウトしました。' });
      }, CONNECT_TIMEOUT_MS);

      const onOpen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.off('error', onError);
        resolve(peer);
      };

      const onError = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.off('open', onOpen);
        try {
          peer.destroy();
        } catch {
          // ignore
        }
        reject(err);
      };

      peer.once('open', onOpen);
      peer.once('error', onError);
    });
  }

  _attachPeerListeners(peer) {
    peer.on('connection', (conn) => {
      if (this._destroyed || this._peer !== peer) return;
      this._handleIncomingConnection(conn);
    });

    peer.on('disconnected', () => {
      if (this._destroyed || this._peer !== peer || peer.destroyed) return;
      // PeerJS signaling websocket occasionally disconnects while WebRTC channels remain open.
      // Reconnect quietly with backoff so new joins and host migration stay functional.
      if (this._peerReconnectAttempts >= 5) return;
      this._peerReconnectAttempts++;
      clearTimeout(this._reconnectPeerTimer);
      this._reconnectPeerTimer = setTimeout(() => {
        if (this._destroyed || this._peer !== peer || peer.destroyed) return;
        try {
          peer.reconnect();
        } catch {
          // ignore
        }
      }, 1500 * this._peerReconnectAttempts);
    });

    peer.on('open', () => {
      this._peerReconnectAttempts = 0;
    });

    peer.on('error', (err) => {
      if (this._destroyed || this._peer !== peer) return;
      const type = err?.type || '';
      // Ignore expected transient errors during migration or peer lookups
      if (type === 'peer-unavailable' && this._migrating) return;
      if (type === 'disconnected' || type === 'network' || type === 'socket-error') {
        this._emit('onNotification', 'シグナリングサーバーと再接続中...', 'warn');
        return;
      }
      this._emit('onError', mapPeerError(err));
    });
  }

  _handleIncomingConnection(conn) {
    if (!conn) return;

    let handshakeDone = false;

    const handleHandshakeMessage = (msg) => {
      if (handshakeDone || !msg || typeof msg !== 'object') return;

      if (msg.type === 'join_request') {
        handshakeDone = true;
        conn.off('data', handleHandshakeMessage);
        this._processJoinRequest(conn, msg);
      } else if (msg.type === 'migrate_hello') {
        handshakeDone = true;
        conn.off('data', handleHandshakeMessage);
        this._processMigrateHello(conn, msg);
      }
    };

    conn.on('data', handleHandshakeMessage);

    // Fallback: if PeerJS metadata already includes join/migrate info and conn opens
    // before the peer sends its explicit handshake message, wait briefly for the message first.
    conn.on('error', () => {
      // Handled once registered or ignored if failed before handshake
    });
  }

  _processJoinRequest(conn, msg) {
    if (!this._isHost) {
      this._send(conn, {
        type: 'join_reject',
        reason: 'この接続先はホストではありません',
      });
      setTimeout(() => {
        try {
          conn.close();
        } catch {
          // ignore
        }
      }, 150);
      return;
    }

    if (this._phase !== 'LOBBY') {
      this._send(conn, {
        type: 'join_reject',
        reason: 'すでに対戦が開始されています',
      });
      setTimeout(() => {
        try {
          conn.close();
        } catch {
          // ignore
        }
      }, 150);
      return;
    }

    if (this._players.length >= MAX_PLAYERS) {
      this._send(conn, {
        type: 'join_reject',
        reason: '部屋が満員です',
      });
      setTimeout(() => {
        try {
          conn.close();
        } catch {
          // ignore
        }
      }, 150);
      return;
    }

    const slot = this._findAvailableSlot();
    if (slot === -1) {
      this._send(conn, {
        type: 'join_reject',
        reason: '部屋が満員です',
      });
      setTimeout(() => {
        try {
          conn.close();
        } catch {
          // ignore
        }
      }, 150);
      return;
    }

    const profile = msg.profile || conn.metadata?.profile || {};
    const playerId = msg.playerId || conn.metadata?.playerId || `p_${randomId(8)}`;
    const joinOrder = this._nextJoinOrder++;

    const newPlayer = createDefaultPlayer({
      id: playerId,
      peerId: conn.peer,
      slot,
      name: sanitizeName(profile.name, `プレイヤー${slot + 1}`),
      color: profile.color || this._pickNextColor(),
      team: this._pickBalancedTeam(),
      isHost: false,
      isCPU: false,
      connected: true,
      ready: false,
      drawDone: false,
      strokes: [],
      stats: null,
      joinOrder,
    });

    this._players.push(newPlayer);
    this._peerDirectory[playerId] = {
      peerId: conn.peer,
      joinOrder,
    };
    this._disconnectedPlayerIds.delete(playerId);

    this._registerClientConnection(playerId, conn);

    this._send(conn, {
      type: 'join_accept',
      playerId,
      roomCode: this._roomCode,
      state: this._buildRoomState(),
    });

    // Notify other peers of the new roster
    this._broadcast(
      {
        type: 'room_sync',
        ...this._buildRoomState(),
      },
      playerId,
    );

    this._emit('onPlayersUpdate', this.getPlayers());
    this._emit('onNotification', `${newPlayer.name}が参加しました`, 'info');
  }

  _processMigrateHello(conn, msg) {
    const playerId = msg.playerId || conn.metadata?.playerId;
    if (!playerId) return;

    if (!this._isHost) {
      // Another peer detected host disconnect earlier than us!
      // Queue it and check if we should promote ourselves.
      this._earlyMigrationQueue.push({ conn, msg });
      if (!this._migrating) {
        if (!this._hostConn || !this._hostConn.open) {
          this._handleHostLost('early-migrate-hello');
        } else {
          // Probe current host; if unresponsive within 1.5s, trigger migration
          this._send(this._hostConn, { type: 'ping', ts: Date.now() });
          const checkTime = Date.now();
          setTimeout(() => {
            if (!this._destroyed && !this._isHost && !this._migrating && this._hostLastSeen < checkTime) {
              this._handleHostLost('peer-migration-probe-timeout');
            }
          }, 1500);
        }
      }
      return;
    }

    const player = this._players.find((p) => p.id === playerId && !p.isCPU);
    if (!player) {
      this._send(conn, {
        type: 'join_reject',
        reason: 'ルーム情報が見つかりません',
      });
      setTimeout(() => {
        try {
          conn.close();
        } catch {
          // ignore
        }
      }, 150);
      return;
    }

    player.connected = true;
    player.peerId = conn.peer || msg.peerId || player.peerId;
    this._peerDirectory[playerId] = {
      peerId: player.peerId,
      joinOrder: this._getJoinOrder(player),
    };
    this._disconnectedPlayerIds.delete(playerId);

    this._registerClientConnection(playerId, conn);

    this._send(conn, {
      type: 'migrate_ack',
      state: this._buildRoomState(),
    });

    this._broadcastRoomSync();
    this._emit('onPlayersUpdate', this.getPlayers());
  }

  _registerClientConnection(playerId, conn) {
    const prev = this._connections.get(playerId);
    if (prev && prev.conn && prev.conn !== conn) {
      try {
        prev.conn.close();
      } catch {
        // ignore
      }
    }

    const entry = {
      conn,
      peerId: conn.peer,
      lastSeen: Date.now(),
    };
    this._connections.set(playerId, entry);

    conn.on('data', (msg) => {
      if (this._destroyed || !this._isHost) return;
      const current = this._connections.get(playerId);
      if (!current || current.conn !== conn) return;
      current.lastSeen = Date.now();
      this._handleMessageFromClient(playerId, msg);
    });

    conn.on('close', () => {
      if (this._destroyed || !this._isHost) return;
      const current = this._connections.get(playerId);
      if (!current || current.conn !== conn) return;
      this._handleClientDisconnect(playerId, 'close');
    });

    conn.on('error', () => {
      if (this._destroyed || !this._isHost) return;
      const current = this._connections.get(playerId);
      if (!current || current.conn !== conn) return;
      this._handleClientDisconnect(playerId, 'error');
    });
  }

  _attachHostConnListeners(conn) {
    conn.on('data', (msg) => {
      if (this._destroyed || this._isHost || this._hostConn !== conn) return;
      this._hostLastSeen = Date.now();
      this._handleMessageFromHost(msg);
    });

    conn.on('close', () => {
      if (this._destroyed || this._isHost || this._hostConn !== conn) return;
      this._handleHostLost('close');
    });

    conn.on('error', () => {
      if (this._destroyed || this._isHost || this._hostConn !== conn) return;
      this._handleHostLost('error');
    });
  }

  // =========================================================================
  // Internal: Message Routing (Host Side)
  // =========================================================================

  _handleMessageFromClient(senderId, msg) {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'ping': {
        const entry = this._connections.get(senderId);
        if (entry) {
          this._send(entry.conn, { type: 'pong', ts: msg.ts });
        }
        break;
      }

      case 'pong':
        // lastSeen already updated
        break;

      case 'leave':
        this._handleClientDisconnect(senderId, 'leave');
        break;

      case 'client_ready': {
        const player = this._players.find((p) => p.id === senderId);
        if (!player) return;
        player.ready = Boolean(msg.ready);
        this._broadcastRoomSync();
        this._emit('onPlayersUpdate', this.getPlayers());
        break;
      }

      case 'client_toggle_team': {
        // Clients may only toggle their own team
        const targetId = msg.targetPlayerId === senderId ? senderId : null;
        if (!targetId) return;
        const player = this._players.find((p) => p.id === targetId);
        if (!player) return;
        player.team = player.team === 'A' ? 'B' : 'A';
        this._broadcastRoomSync();
        this._emit('onPlayersUpdate', this.getPlayers());
        break;
      }

      case 'draw_event': {
        if (!msg.event) return;
        this._broadcast(
          {
            type: 'draw_event',
            playerId: senderId,
            event: msg.event,
          },
          senderId,
        );
        this._emit('onDrawEvent', senderId, msg.event);
        break;
      }

      case 'draw_done': {
        const strokes = Array.isArray(msg.strokes) ? msg.strokes : [];
        const player = this._players.find((p) => p.id === senderId);
        if (player) {
          player.drawDone = true;
          player.strokes = strokes;
        }
        this._broadcast(
          {
            type: 'draw_done',
            playerId: senderId,
            strokes,
          },
          senderId,
        );
        this._broadcastRoomSync();
        this._emit('onPlayersUpdate', this.getPlayers());
        this._emit('onPlayerDrawDone', senderId, strokes);
        break;
      }

      case 'client_input': {
        if (!msg.input) return;
        this._emit('onClientInput', senderId, msg.input);
        break;
      }

      case 'chat': {
        const text = String(msg.message?.text ?? '').trim().slice(0, 200);
        if (!text) return;
        const player = this._players.find((p) => p.id === senderId);
        const canonical = {
          playerId: senderId,
          name: player?.name || msg.message?.name || 'プレイヤー',
          color: player?.color || msg.message?.color || AVATAR_COLORS[0],
          text,
          isSystem: false,
          timestamp: Date.now(),
        };
        this._broadcast({ type: 'chat', message: canonical }, senderId);
        this._emit('onChatMessage', canonical);
        break;
      }

      case 'stamp': {
        const stampId = msg.stamp?.stampId;
        if (!stampId) return;
        const player = this._players.find((p) => p.id === senderId);
        const canonical = {
          playerId: senderId,
          name: player?.name || msg.stamp?.name || 'プレイヤー',
          color: player?.color || msg.stamp?.color || AVATAR_COLORS[0],
          stampId,
        };
        this._broadcast({ type: 'stamp', stamp: canonical }, senderId);
        this._emit('onStamp', canonical);
        break;
      }

      case 'request_return_lobby': {
        const player = this._players.find((p) => p.id === senderId);
        this._emit(
          'onNotification',
          `${player?.name || 'プレイヤー'}がロビーへ戻ることを希望しています`,
          'info',
        );
        break;
      }

      case 'request_rematch': {
        const player = this._players.find((p) => p.id === senderId);
        this._emit(
          'onNotification',
          `${player?.name || 'プレイヤー'}が再戦を希望しています！`,
          'info',
        );
        break;
      }

      default:
        break;
    }
  }

  // =========================================================================
  // Internal: Message Routing (Client Side)
  // =========================================================================

  _handleMessageFromHost(msg) {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'ping':
        this._send(this._hostConn, { type: 'pong', ts: msg.ts });
        break;

      case 'pong':
        // hostLastSeen already updated
        break;

      case 'leave':
        // Host voluntarily left -> immediately start migration
        this._handleHostLost('host-leave');
        break;

      case 'room_sync': {
        this._applyRoomState(msg, true);
        break;
      }

      case 'player_disconnected': {
        const { playerId, name } = msg;
        if (playerId && !this._disconnectedPlayerIds.has(playerId)) {
          this._disconnectedPlayerIds.add(playerId);
          const displayName = name || 'プレイヤー';
          this._emit('onNotification', `${displayName}が退出しました`, 'warn');
          this._emit('onPlayerDisconnected', { playerId, name: displayName });
        }
        break;
      }

      case 'phase_change': {
        this._phase = msg.phase || this._phase;
        if (msg.payload?.theme !== undefined) {
          this._currentTheme = msg.payload.theme;
        }
        this._emit('onPhaseChange', this._phase, msg.payload || {});
        break;
      }

      case 'draw_event': {
        if (msg.playerId && msg.playerId !== this._localPlayerId && msg.event) {
          this._emit('onDrawEvent', msg.playerId, msg.event);
        }
        break;
      }

      case 'draw_done': {
        const { playerId, strokes } = msg;
        if (playerId && playerId !== this._localPlayerId) {
          const target = this._players.find((p) => p.id === playerId);
          if (target) {
            target.drawDone = true;
            target.strokes = Array.isArray(strokes) ? strokes : [];
          }
          this._emit('onPlayerDrawDone', playerId, Array.isArray(strokes) ? strokes : []);
          this._emit('onPlayersUpdate', this.getPlayers());
        }
        break;
      }

      case 'stats_ready': {
        this._phase = 'STATS';
        const playersWithStats = Array.isArray(msg.players) ? msg.players : [];
        const byId = new Map(playersWithStats.map((p) => [p.id, p]));
        const internalById = new Map(this._players.map((p) => [p.id, p]));
        for (const p of this._players) {
          const updated = byId.get(p.id);
          if (updated) {
            p.strokes = updated.strokes ?? p.strokes;
            p.stats = updated.stats ?? p.stats;
            if (p.isCPU) {
              p.cpuLevel = normalizeCpuLevel(updated.cpuLevel ?? p.cpuLevel, this._settings.cpuLevel);
            }
            p.drawDone = true;
          }
        }
        const normalizedStatsPlayers = deepClone(playersWithStats).map((p) => {
          const existing = internalById.get(p.id);
          if (p.isCPU || existing?.isCPU) {
            p.cpuLevel = normalizeCpuLevel(
              p.cpuLevel ?? existing?.cpuLevel,
              this._settings.cpuLevel,
            );
          }
          return p;
        });
        this._emit('onPlayersUpdate', this.getPlayers());
        this._emit('onStatsReceived', normalizedStatsPlayers);
        break;
      }

      case 'battle_start': {
        this._phase = 'BATTLE';
        this._emit('onBattleStart', msg.battleConfig || {});
        break;
      }

      case 'battle_snapshot': {
        if (msg.snapshot) {
          this._emit('onBattleSnapshot', msg.snapshot);
        }
        break;
      }

      case 'battle_event': {
        if (msg.event) {
          this._emit('onBattleEvent', msg.event);
        }
        break;
      }

      case 'battle_end': {
        this._phase = 'RESULT';
        this._emit('onPhaseChange', 'RESULT', msg.result || {});
        break;
      }

      case 'chat': {
        if (msg.message && msg.message.playerId !== this._localPlayerId) {
          this._emit('onChatMessage', msg.message);
        }
        break;
      }

      case 'stamp': {
        if (msg.stamp && msg.stamp.playerId !== this._localPlayerId) {
          this._emit('onStamp', msg.stamp);
        }
        break;
      }

      default:
        break;
    }
  }

  // =========================================================================
  // Internal: Disconnect Detection & Host Migration (ホスト引き継ぎ)
  // =========================================================================

  _startHeartbeat() {
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = setInterval(() => {
      if (this._destroyed) return;
      const now = Date.now();

      if (this._isHost) {
        const timedOutIds = [];
        for (const [playerId, entry] of this._connections.entries()) {
          if (now - entry.lastSeen > HEARTBEAT_TIMEOUT_MS) {
            timedOutIds.push(playerId);
          } else {
            this._send(entry.conn, { type: 'ping', ts: now });
          }
        }
        for (const playerId of timedOutIds) {
          this._handleClientDisconnect(playerId, 'heartbeat-timeout');
        }
      } else if (!this._migrating && this._hostConn) {
        if (now - this._hostLastSeen > HEARTBEAT_TIMEOUT_MS) {
          this._handleHostLost('heartbeat-timeout');
        } else {
          this._send(this._hostConn, { type: 'ping', ts: now });
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  _handleClientDisconnect(playerId, _reason) {
    if (!this._isHost || !playerId) return;
    if (this._disconnectedPlayerIds.has(playerId)) return;
    this._disconnectedPlayerIds.add(playerId);

    const entry = this._connections.get(playerId);
    if (entry) {
      this._connections.delete(playerId);
      try {
        if (entry.conn && entry.conn.open) entry.conn.close();
      } catch {
        // ignore
      }
    }

    const idx = this._players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;

    const player = this._players[idx];
    const playerName = player.name || 'プレイヤー';

    if (this._phase === 'LOBBY') {
      this._players.splice(idx, 1);
      delete this._peerDirectory[playerId];
    } else {
      player.connected = false;
      player.isHost = false;
      if (this._phase === 'DRAW') {
        player.drawDone = true;
      }
    }

    this._broadcast({
      type: 'player_disconnected',
      playerId,
      name: playerName,
    });
    this._broadcastRoomSync();

    this._emit('onNotification', `${playerName}が退出しました`, 'warn');
    this._emit('onPlayerDisconnected', { playerId, name: playerName });
    this._emit('onPlayersUpdate', this.getPlayers());
  }

  async _handleHostLost(_reason) {
    if (this._isHost || this._migrating || this._destroyed) return;
    this._migrating = true;

    const oldConn = this._hostConn;
    this._hostConn = null;
    if (oldConn) {
      try {
        oldConn.close();
      } catch {
        // ignore
      }
    }

    const oldHostId = this._hostId || this._players.find((p) => p.isHost)?.id || null;
    const oldHost = this._players.find((p) => p.id === oldHostId);
    const oldHostName = oldHost?.name || 'ホスト';

    if (oldHost) {
      if (this._phase === 'LOBBY') {
        this._players = this._players.filter((p) => p.id !== oldHostId);
        delete this._peerDirectory[oldHostId];
      } else {
        oldHost.connected = false;
        oldHost.isHost = false;
        if (this._phase === 'DRAW') {
          oldHost.drawDone = true;
        }
      }
    }

    if (oldHostId && !this._disconnectedPlayerIds.has(oldHostId)) {
      this._disconnectedPlayerIds.add(oldHostId);
      this._emit('onPlayerDisconnected', { playerId: oldHostId, name: oldHostName });
    }

    await this._runHostElection(oldHostId);
  }

  async _runHostElection(excludedHostId = null) {
    if (this._destroyed) return;

    // Deterministic election: remaining connected human players sorted by joinOrder ascending
    const candidates = this._players
      .filter((p) => !p.isCPU && p.id !== excludedHostId && p.connected !== false)
      .sort((a, b) => {
        const orderA = this._getJoinOrder(a);
        const orderB = this._getJoinOrder(b);
        if (orderA !== orderB) return orderA - orderB;
        if ((a.slot ?? 99) !== (b.slot ?? 99)) return (a.slot ?? 99) - (b.slot ?? 99);
        return String(a.id).localeCompare(String(b.id));
      });

    if (candidates.length === 0) {
      this._migrating = false;
      this._emit('onError', 'ホストとの接続が切れました。');
      return;
    }

    const newHost = candidates[0];
    for (const p of this._players) {
      p.isHost = p.id === newHost.id;
    }
    this._hostId = newHost.id;

    this._emit(
      'onNotification',
      `ホストが退出しました。${newHost.name}が新しいホストになります！`,
      'warn',
    );

    if (newHost.id === this._localPlayerId) {
      this._promoteSelfToHost(candidates.slice(1));
    } else {
      await this._connectToNewHost(newHost, candidates.slice(1));
    }
  }

  _promoteSelfToHost(expectedOtherHumans = []) {
    this._isHost = true;
    this._migrating = false;
    this._hostId = this._localPlayerId;
    this._connections.clear();

    const me = this._players.find((p) => p.id === this._localPlayerId);
    if (me) {
      me.isHost = true;
      me.connected = true;
      me.ready = true;
      me.peerId = this._peerId;
      this._peerDirectory[me.id] = {
        peerId: this._peerId,
        joinOrder: this._getJoinOrder(me),
      };
    }

    // Ensure _nextJoinOrder stays strictly above existing players
    let maxOrder = 0;
    for (const p of this._players) {
      if (!p.isCPU) {
        maxOrder = Math.max(maxOrder, this._getJoinOrder(p));
      }
    }
    this._nextJoinOrder = Math.max(this._nextJoinOrder, maxOrder + 1);

    // Drain any migrate_hello connections that arrived while we were detecting host loss
    const queued = this._earlyMigrationQueue.splice(0);
    for (const item of queued) {
      this._processMigrateHello(item.conn, item.msg);
    }

    // If other human peers exist, give them a grace window to connect to our existing peer.id
    clearTimeout(this._migrationGraceTimer);
    if (expectedOtherHumans.length > 0) {
      const expectedIds = expectedOtherHumans.map((p) => p.id);
      this._migrationGraceTimer = setTimeout(() => {
        if (this._destroyed || !this._isHost) return;
        for (const pid of expectedIds) {
          if (!this._connections.has(pid)) {
            this._handleClientDisconnect(pid, 'migration-grace-timeout');
          }
        }
      }, MIGRATION_HOST_GRACE_MS);
    }

    this._emit('onPlayersUpdate', this.getPlayers());
    this._emit('onHostMigrated', {
      newHostId: this._localPlayerId,
      isLocalNewHost: true,
      players: this.getPlayers(),
    });
  }

  async _connectToNewHost(newHost, remainingFallbackCandidates = []) {
    const targetPeerId = this._peerDirectory[newHost.id]?.peerId || newHost.peerId;
    const localPlayer = this._players.find((p) => p.id === this._localPlayerId);

    const retryDelays = [350, 1000, 1800];
    let connectedResult = null;

    if (targetPeerId && this._peer && !this._peer.destroyed) {
      for (let attempt = 0; attempt < MIGRATION_RECONNECT_ATTEMPTS; attempt++) {
        if (this._destroyed) return;
        await this._delay(retryDelays[attempt] ?? 1200);
        if (this._destroyed) return;

        try {
          connectedResult = await this._attemptMigrateConnection(targetPeerId, localPlayer);
          break;
        } catch {
          // Retry with backoff
        }
      }
    }

    if (this._destroyed) return;

    if (connectedResult) {
      const { conn, state } = connectedResult;
      this._isHost = false;
      this._hostConn = conn;
      this._hostLastSeen = Date.now();
      this._migrating = false;

      if (state) {
        this._applyRoomState(state, false);
      }

      this._attachHostConnListeners(conn);

      this._emit('onPlayersUpdate', this.getPlayers());
      this._emit('onSettingsUpdate', this.getSettings());
      this._emit('onHostMigrated', {
        newHostId: newHost.id,
        isLocalNewHost: false,
        players: this.getPlayers(),
      });
      return;
    }

    // New host was also unreachable (e.g., closed tab simultaneously) -> cascade to next candidate!
    if (this._phase === 'LOBBY') {
      this._players = this._players.filter((p) => p.id !== newHost.id);
      delete this._peerDirectory[newHost.id];
    } else {
      newHost.connected = false;
      newHost.isHost = false;
      if (this._phase === 'DRAW') {
        newHost.drawDone = true;
      }
    }

    if (remainingFallbackCandidates.length > 0) {
      await this._runHostElection(newHost.id);
    } else {
      // Only we remain
      this._promoteSelfToHost([]);
    }
  }

  _attemptMigrateConnection(targetPeerId, localPlayer) {
    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (ok, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) resolve(val);
        else reject(val);
      };

      const conn = this._peer.connect(targetPeerId, {
        reliable: true,
        metadata: {
          kind: 'migrate',
          playerId: this._localPlayerId,
        },
      });

      if (!conn) {
        finish(false, new Error('connect failed'));
        return;
      }

      const timer = setTimeout(() => {
        try {
          conn.close();
        } catch {
          // ignore
        }
        finish(false, new Error('migrate timeout'));
      }, 4000);

      const onData = (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'migrate_ack' || msg.type === 'room_sync') {
          conn.off('data', onData);
          conn.off('close', onClose);
          conn.off('error', onErr);
          finish(true, {
            conn,
            state: msg.type === 'migrate_ack' ? msg.state : msg,
          });
        } else if (msg.type === 'join_reject') {
          conn.off('data', onData);
          conn.off('close', onClose);
          conn.off('error', onErr);
          try {
            conn.close();
          } catch {
            // ignore
          }
          finish(false, new Error(msg.reason || 'migrate rejected'));
        }
      };

      const onClose = () => finish(false, new Error('migrate conn closed'));
      const onErr = (err) => finish(false, err);

      conn.on('open', () => {
        this._send(conn, {
          type: 'migrate_hello',
          playerId: this._localPlayerId,
          peerId: this._peerId,
          name: localPlayer?.name || 'プレイヤー',
        });
      });

      conn.on('data', onData);
      conn.on('close', onClose);
      conn.on('error', onErr);
    });
  }

  // =========================================================================
  // Internal: State Sync & Utility Helpers
  // =========================================================================

  _sendDrawEvent(event) {
    if (!this._localPlayerId) return;
    const msg = {
      type: 'draw_event',
      playerId: this._localPlayerId,
      event,
    };
    if (this._isHost) {
      this._broadcast(msg);
    } else if (this._hostConn && this._hostConn.open) {
      this._send(this._hostConn, msg);
    }
  }

  _buildRoomState() {
    // Keep peerDirectory strictly synchronized with human players
    for (const p of this._players) {
      if (!p.isCPU && p.peerId) {
        this._peerDirectory[p.id] = {
          peerId: p.peerId,
          joinOrder: this._getJoinOrder(p),
        };
      }
    }
    return {
      players: this._players,
      settings: this._settings,
      phase: this._phase,
      currentTheme: this._currentTheme,
      peerDirectory: this._peerDirectory,
      hostId: this._hostId,
    };
  }

  _broadcastRoomSync() {
    if (!this._isHost) return;
    this._broadcast({
      type: 'room_sync',
      ...this._buildRoomState(),
    });
  }

  _applyRoomState(state, emitUpdates = true) {
    if (!state || typeof state !== 'object') return;

    const prevSettingsJson = emitUpdates ? JSON.stringify(this._settings) : '';

    if (state.settings && typeof state.settings === 'object') {
      const merged = { ...DEFAULT_SETTINGS, ...deepClone(state.settings) };
      merged.cpuLevel = normalizeCpuLevel(merged.cpuLevel, DEFAULT_CPU_LEVEL);
      this._settings = merged;
    }
    if (Array.isArray(state.players)) {
      this._players = deepClone(state.players).map((p) => {
        if (p?.isCPU) {
          p.cpuLevel = normalizeCpuLevel(p.cpuLevel, this._settings.cpuLevel);
        }
        return p;
      });
    }
    if (state.phase) {
      this._phase = state.phase;
    }
    if (state.currentTheme !== undefined) {
      this._currentTheme = deepClone(state.currentTheme);
    }
    if (state.peerDirectory && typeof state.peerDirectory === 'object') {
      this._peerDirectory = deepClone(state.peerDirectory);
    }
    if (state.hostId) {
      this._hostId = state.hostId;
    }

    if (emitUpdates) {
      this._emit('onPlayersUpdate', this.getPlayers());
      if (JSON.stringify(this._settings) !== prevSettingsJson) {
        this._emit('onSettingsUpdate', this.getSettings());
      }
    }
  }

  _pruneDisconnectedPlayers() {
    this._players = this._players.filter((p) => p.isCPU || p.connected !== false);
    const activeIds = new Set(this._players.map((p) => p.id));
    for (const pid of Object.keys(this._peerDirectory)) {
      if (!activeIds.has(pid)) {
        delete this._peerDirectory[pid];
      }
    }
  }

  _getJoinOrder(player) {
    if (typeof player?.joinOrder === 'number') return player.joinOrder;
    const dir = this._peerDirectory[player?.id];
    if (dir && typeof dir.joinOrder === 'number') return dir.joinOrder;
    return (player?.slot ?? 99) + 1;
  }

  _findAvailableSlot() {
    const used = new Set(this._players.map((p) => p.slot));
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (!used.has(i)) return i;
    }
    return -1;
  }

  _pickNextColor() {
    const used = new Set(this._players.map((p) => p.color));
    for (const c of AVATAR_COLORS) {
      if (!used.has(c)) return c;
    }
    return AVATAR_COLORS[this._players.length % AVATAR_COLORS.length];
  }

  _pickBalancedTeam() {
    let countA = 0;
    let countB = 0;
    for (const p of this._players) {
      if (p.team === 'B') countB++;
      else countA++;
    }
    return countA <= countB ? 'A' : 'B';
  }

  _ensureValidTeams() {
    this._players.forEach((p, i) => {
      if (p.team !== 'A' && p.team !== 'B') {
        p.team = i % 2 === 0 ? 'A' : 'B';
      }
    });
  }

  _send(conn, payload) {
    if (!conn || !conn.open) return false;
    try {
      conn.send(payload);
      return true;
    } catch {
      return false;
    }
  }

  _broadcast(payload, excludePlayerId = null) {
    for (const [playerId, entry] of this._connections.entries()) {
      if (excludePlayerId && playerId === excludePlayerId) continue;
      this._send(entry.conn, payload);
    }
  }

  _emit(callbackName, ...args) {
    const fn = this._cb?.[callbackName];
    if (typeof fn !== 'function') return;
    try {
      fn(...args);
    } catch (err) {
      console.error(`[NetworkManager] callback ${callbackName} threw:`, err);
    }
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _attachUnloadHandler() {
    this._detachUnloadHandler();
    if (typeof window === 'undefined') return;
    this._unloadHandler = () => {
      if (!this._localPlayerId) return;
      const leaveMsg = { type: 'leave', playerId: this._localPlayerId };
      if (this._isHost) {
        this._broadcast(leaveMsg);
      } else if (this._hostConn && this._hostConn.open) {
        this._send(this._hostConn, leaveMsg);
      }
    };
    window.addEventListener('beforeunload', this._unloadHandler);
    window.addEventListener('pagehide', this._unloadHandler);
  }

  _detachUnloadHandler() {
    if (typeof window === 'undefined' || !this._unloadHandler) return;
    window.removeEventListener('beforeunload', this._unloadHandler);
    window.removeEventListener('pagehide', this._unloadHandler);
    this._unloadHandler = null;
  }

  _cleanup(markDestroyed = true) {
    if (markDestroyed) {
      this._destroyed = true;
    }

    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;

    clearTimeout(this._migrationGraceTimer);
    this._migrationGraceTimer = null;

    clearTimeout(this._reconnectPeerTimer);
    this._reconnectPeerTimer = null;

    this._detachUnloadHandler();

    for (const entry of this._connections.values()) {
      try {
        entry.conn?.close();
      } catch {
        // ignore
      }
    }
    this._connections.clear();

    for (const item of this._earlyMigrationQueue) {
      try {
        item.conn?.close();
      } catch {
        // ignore
      }
    }
    this._earlyMigrationQueue = [];

    if (this._hostConn) {
      try {
        this._hostConn.close();
      } catch {
        // ignore
      }
      this._hostConn = null;
    }

    if (this._peer) {
      try {
        this._peer.destroy();
      } catch {
        // ignore
      }
      this._peer = null;
    }

    this._peerId = null;
    this._roomCode = null;
    this._localPlayerId = null;
    this._isHost = false;
    this._players = [];
    this._settings = { ...DEFAULT_SETTINGS };
    this._phase = 'LOBBY';
    this._currentTheme = null;
    this._peerDirectory = {};
    this._hostId = null;
    this._hostLastSeen = 0;
    this._migrating = false;
    this._peerReconnectAttempts = 0;
    this._disconnectedPlayerIds.clear();
  }
}

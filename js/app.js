// 60秒ファイター！ — メインアプリケーションコントローラー

import {
  MAX_PLAYERS,
  DRAW_TIME_SECONDS,
  AVATAR_COLORS,
  DRAW_PALETTE,
  THEMES,
  STAGES,
  STAMPS,
  CPU_LEVELS,
  DEFAULT_CPU_LEVEL,
  getCPULevelInfo,
  DEFAULT_STROKES,
  createDefaultPlayer,
} from './shared.js';
import { DrawingPad, RemotePreviewPad } from './drawing.js';
import { analyzeCharacter, generateCPUCharacter } from './analyzer.js';
import { renderThumbnail } from './character-renderer.js';
import { BattleEngine } from './battle.js';
import { NetworkManager } from './network.js';
import { sfx } from './sfx.js';

const STORAGE_KEY = 'fighter60s_profile_v1';

const DEFAULT_SETTINGS = {
  battleMode: 'ffa', // 'ffa' | '1v1' | '2v2'
  ruleMode: 'stock', // 'stock' | 'time'
  stockCount: 3,
  timeLimit: 120,
  stageId: 'notebook',
  themeId: 'random',
  cpuLevel: DEFAULT_CPU_LEVEL,
};

const state = {
  mode: 'offline', // 'offline' | 'online'
  phase: 'TOP', // 'TOP' | 'LOBBY' | 'DRAW' | 'STATS' | 'BATTLE' | 'RESULT'
  profile: {
    name: '',
    color: AVATAR_COLORS[0],
  },
  localPlayerId: null,
  isHost: true,
  roomCode: null,
  players: [],
  settings: { ...DEFAULT_SETTINGS },
  currentTheme: THEMES[0],

  // お絵描き管理
  drawingPad: null,
  previewPads: new Map(),
  drawEndTime: 0,
  drawTimerId: null,
  drawGraceTimeoutId: null,
  drawFinishedLocal: false,
  drawFinalized: false,
  lastWarnSecond: 99,

  // 能力発表管理
  statsTimerId: null,
  statsCountdown: 10,

  // バトル管理
  battleEngine: null,
  hudCardsMap: new Map(),
  hudDamageCache: new Map(),
  battleToastTimerId: null,
  touchVisible: false,

  // リザルト
  lastResult: null,

  // ネットワーク
  network: null,
};

// DOM キャッシュ
const $ = (id) => document.getElementById(id);

const screens = {
  TOP: () => $('screen-top'),
  LOBBY: () => $('screen-lobby'),
  DRAW: () => $('screen-draw'),
  STATS: () => $('screen-stats'),
  BATTLE: () => $('screen-battle'),
  RESULT: () => $('screen-result'),
};

// ==================== 初期化 ====================

function init() {
  loadProfile();
  buildStaticUI();
  bindEvents();
  setupAudioUnlock();
  updateMuteButtons();
  showScreen('TOP');
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.name === 'string') state.profile.name = parsed.name.slice(0, 12);
      if (AVATAR_COLORS.includes(parsed.color)) state.profile.color = parsed.color;
    }
  } catch {
    // localStorage 無効時は無視
  }
  $('input-player-name').value = state.profile.name;
}

function saveProfile() {
  const nameVal = $('input-player-name').value.trim().slice(0, 12);
  state.profile.name = nameVal;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profile));
  } catch {
    // 無視
  }
}

function getEffectivePlayerName() {
  const name = $('input-player-name').value.trim().slice(0, 12);
  return name || `ファイター${Math.floor(10 + Math.random() * 89)}`;
}

function setupAudioUnlock() {
  const unlock = () => {
    try {
      sfx.unlock();
    } catch {
      // ignore
    }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
}

function buildStaticUI() {
  // アバターカラー選択（8色）
  const colorPicker = $('avatar-color-picker');
  colorPicker.innerHTML = '';
  AVATAR_COLORS.forEach((hex) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `color-swatch${hex === state.profile.color ? ' is-selected' : ''}`;
    btn.style.backgroundColor = hex;
    btn.dataset.color = hex;
    btn.setAttribute('aria-label', `カラー ${hex}`);
    btn.addEventListener('click', () => {
      state.profile.color = hex;
      colorPicker.querySelectorAll('.color-swatch').forEach((el) => {
        el.classList.toggle('is-selected', el.dataset.color === hex);
      });
      saveProfile();
    });
    colorPicker.appendChild(btn);
  });

  // ステージセレクト
  const stageSelect = $('select-stage');
  stageSelect.innerHTML = '';
  STAGES.forEach((st) => {
    const opt = document.createElement('option');
    opt.value = st.id;
    opt.textContent = st.name;
    stageSelect.appendChild(opt);
  });

  // お題セレクト（カテゴリ別 optgroup、全36種）
  const themeSelect = $('select-theme');
  themeSelect.innerHTML = '';
  const randOpt = document.createElement('option');
  randOpt.value = 'random';
  randOpt.textContent = `🎲 ランダム（全${THEMES.length}種から毎回かわる！）`;
  themeSelect.appendChild(randOpt);

  const themesByCategory = new Map();
  THEMES.forEach((th) => {
    const cat = th.category || 'その他';
    if (!themesByCategory.has(cat)) themesByCategory.set(cat, []);
    themesByCategory.get(cat).push(th);
  });
  themesByCategory.forEach((list, cat) => {
    const group = document.createElement('optgroup');
    group.label = `${cat}（${list.length}種）`;
    list.forEach((th) => {
      const opt = document.createElement('option');
      opt.value = th.id;
      opt.textContent = th.emoji ? `${th.emoji} ${th.label}` : th.label;
      group.appendChild(opt);
    });
    themeSelect.appendChild(group);
  });

  // CPUの強さセレクト（5段階）
  const cpuLevelSelect = $('setting-cpu-level');
  cpuLevelSelect.innerHTML = '';
  CPU_LEVELS.forEach((lvl) => {
    const opt = document.createElement('option');
    opt.value = lvl.id;
    opt.textContent = `${lvl.badge} ${lvl.label} (${lvl.shortLabel})`;
    cpuLevelSelect.appendChild(opt);
  });

  // お絵描きパレット（10色）
  const paletteEl = $('draw-color-palette');
  paletteEl.innerHTML = '';
  DRAW_PALETTE.forEach((hex, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `palette-swatch${idx === 0 ? ' is-active' : ''}`;
    btn.style.backgroundColor = hex;
    btn.dataset.color = hex;
    btn.setAttribute('aria-label', `ペンの色 ${hex}`);
    btn.addEventListener('click', () => {
      selectDrawColor(hex);
    });
    paletteEl.appendChild(btn);
  });

  // スタンプバー（ロビー・お絵描き・バトル）
  buildStampBar($('lobby-stamp-bar'), false);
  buildStampBar($('draw-stamp-bar'), true);
  buildStampBar($('battle-stamp-bar'), true);

  // タッチデバイス判定
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    state.touchVisible = true;
    $('touch-controls').classList.remove('hidden');
  }
}

function buildStampBar(container, compact) {
  container.innerHTML = '';
  STAMPS.forEach((st) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stamp-btn';
    btn.title = st.text;
    btn.innerHTML = compact
      ? `<span>${st.emoji}</span><span>${st.text}</span>`
      : `<span>${st.emoji}</span><span>${st.text}</span>`;
    btn.addEventListener('click', () => sendStampAction(st.id));
    container.appendChild(btn);
  });
}

// ==================== イベントバインド ====================

function bindEvents() {
  // トップ画面
  $('input-player-name').addEventListener('change', saveProfile);
  $('input-room-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
  });
  $('input-room-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-join-room').click();
  });

  $('btn-create-room').addEventListener('click', handleCreateRoom);
  $('btn-join-room').addEventListener('click', handleJoinRoom);
  $('btn-cpu-mode').addEventListener('click', handleStartOfflineCPU);

  // ロビー画面
  $('btn-copy-code').addEventListener('click', handleCopyRoomCode);
  $('btn-leave-lobby').addEventListener('click', handleReturnToTop);
  $('btn-lobby-mute').addEventListener('click', toggleMute);
  $('btn-add-cpu').addEventListener('click', handleAddCPU);
  $('btn-toggle-ready').addEventListener('click', handleToggleReady);
  $('btn-start-game').addEventListener('click', handleStartDrawingFromLobby);

  $('select-battle-mode').addEventListener('change', (e) => {
    handleSettingsChange({ battleMode: e.target.value });
  });
  $('select-rule-mode').addEventListener('change', (e) => {
    handleSettingsChange({ ruleMode: e.target.value });
  });
  $('select-stage').addEventListener('change', (e) => {
    handleSettingsChange({ stageId: e.target.value });
  });
  $('select-theme').addEventListener('change', (e) => {
    handleSettingsChange({ themeId: e.target.value });
  });
  $('setting-cpu-level').addEventListener('change', (e) => {
    handleDefaultCPULevelChange(e.target.value);
  });

  $('lobby-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('lobby-chat-input');
    sendChatAction(input.value);
    input.value = '';
  });

  // お絵描き画面
  $('tool-pen').addEventListener('click', () => setDrawTool('pen'));
  $('tool-eraser').addEventListener('click', () => setDrawTool('eraser'));
  document.querySelectorAll('.size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const size = Number(btn.dataset.size) || 8;
      setDrawSize(size);
    });
  });
  $('btn-draw-undo').addEventListener('click', () => {
    if (state.drawingPad && !state.drawFinishedLocal) state.drawingPad.undo();
  });
  $('btn-draw-clear').addEventListener('click', () => {
    if (state.drawingPad && !state.drawFinishedLocal) state.drawingPad.clear();
  });
  $('btn-draw-done').addEventListener('click', submitLocalDrawing);

  $('draw-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('draw-chat-input');
    sendChatAction(input.value);
    input.value = '';
  });

  // 能力発表画面
  $('btn-start-battle').addEventListener('click', () => {
    if (state.isHost) hostTriggerStartBattle();
  });

  // バトル画面
  $('btn-battle-mute').addEventListener('click', toggleMute);
  $('btn-toggle-touch').addEventListener('click', () => {
    state.touchVisible = !state.touchVisible;
    $('touch-controls').classList.toggle('hidden', !state.touchVisible);
  });
  $('btn-battle-leave').addEventListener('click', () => {
    if (confirm('対戦を終了してトップ画面へ戻りますか？')) {
      handleReturnToTop();
    }
  });

  // タッチコントロールボタン
  document.querySelectorAll('#touch-controls .touch-btn').forEach((btn) => {
    const action = btn.dataset.action;
    const press = (e) => {
      e.preventDefault();
      btn.classList.add('is-pressed');
      state.battleEngine?.triggerVirtualInput(action, true);
    };
    const release = (e) => {
      e.preventDefault();
      btn.classList.remove('is-pressed');
      state.battleEngine?.triggerVirtualInput(action, false);
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
  });

  // リザルト画面
  $('btn-result-redraw').addEventListener('click', handleResultRedraw);
  $('btn-result-rematch').addEventListener('click', handleResultRematch);
  $('btn-result-lobby').addEventListener('click', handleResultReturnLobby);
  $('btn-result-top').addEventListener('click', handleReturnToTop);
}

// ==================== 画面・通知ユーティリティ ====================

function showScreen(phase) {
  state.phase = phase;
  Object.entries(screens).forEach(([key, getter]) => {
    const el = getter();
    if (el) el.classList.toggle('screen--active', key === phase);
  });
}

function setTopStatus(text, isError = false) {
  const el = $('top-status');
  el.textContent = text;
  el.classList.toggle('is-error', isError);
}

function setTopButtonsDisabled(disabled) {
  $('btn-create-room').disabled = disabled;
  $('btn-join-room').disabled = disabled;
  $('btn-cpu-mode').disabled = disabled;
}

function showToast(message, level = 'info') {
  const container = $('toast-container');
  const div = document.createElement('div');
  div.className = `toast toast--${level}`;
  div.textContent = message;
  container.appendChild(div);
  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transition = 'opacity 0.25s ease';
    setTimeout(() => div.remove(), 260);
  }, 3800);
}

function showBattleToast(message) {
  const el = $('battle-toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(state.battleToastTimerId);
  state.battleToastTimerId = setTimeout(() => {
    el.classList.add('hidden');
  }, 3000);
}

function toggleMute() {
  sfx.setMuted(!sfx.isMuted());
  updateMuteButtons();
}

function updateMuteButtons() {
  const muted = sfx.isMuted();
  const label = muted ? '🔇 効果音 OFF' : '🔊 効果音 ON';
  const b1 = $('btn-lobby-mute');
  const b2 = $('btn-battle-mute');
  if (b1) b1.textContent = label;
  if (b2) b2.textContent = label;
}

function appendChatMessage({ name, color, text, isSystem }) {
  const targets = [$('lobby-chat-log'), $('draw-chat-mini')];
  targets.forEach((log) => {
    if (!log) return;
    const row = document.createElement('div');
    row.className = `chat-msg${isSystem ? ' chat-msg--system' : ''}`;
    if (isSystem) {
      row.textContent = `📢 ${text}`;
    } else {
      const authorSpan = document.createElement('span');
      authorSpan.className = 'chat-msg-author';
      authorSpan.style.color = color || '#25211c';
      authorSpan.textContent = `${name}:`;
      const textSpan = document.createElement('span');
      textSpan.textContent = text;
      row.appendChild(authorSpan);
      row.appendChild(textSpan);
    }
    log.appendChild(row);
    while (log.children.length > 60) {
      log.removeChild(log.firstChild);
    }
    log.scrollTop = log.scrollHeight;
  });
}

function showFloatingStamp({ name, color, stampId }) {
  const stamp = STAMPS.find((s) => s.id === stampId);
  if (!stamp) return;
  try {
    sfx.playStamp();
  } catch {
    // ignore
  }
  const layer = $('stamp-float-layer');
  const bubble = document.createElement('div');
  bubble.className = 'floating-stamp';
  const leftPct = 14 + Math.random() * 64;
  bubble.style.left = `${leftPct}%`;

  const nameBadge = document.createElement('span');
  nameBadge.className = 'floating-stamp-name';
  nameBadge.style.backgroundColor = color || '#3b82f6';
  nameBadge.textContent = name || 'プレイヤー';

  const body = document.createElement('span');
  body.textContent = `${stamp.emoji} ${stamp.text}`;

  bubble.appendChild(nameBadge);
  bubble.appendChild(body);
  layer.appendChild(bubble);

  setTimeout(() => bubble.remove(), 2500);
  appendChatMessage({
    name: name || 'プレイヤー',
    color,
    text: `${stamp.emoji} ${stamp.text}`,
    isSystem: false,
  });
}

function clearChatLogs() {
  const l1 = $('lobby-chat-log');
  const l2 = $('draw-chat-mini');
  if (l1) l1.innerHTML = '';
  if (l2) l2.innerHTML = '';
}

function sendChatAction(rawText) {
  const text = (rawText || '').trim().slice(0, 80);
  if (!text) return;
  if (state.mode === 'online' && state.network) {
    state.network.sendChat(text);
  } else {
    const me = getLocalPlayer();
    appendChatMessage({
      name: me ? me.name : state.profile.name,
      color: me ? me.color : state.profile.color,
      text,
      isSystem: false,
    });
  }
}

function sendStampAction(stampId) {
  if (state.mode === 'online' && state.network) {
    state.network.sendStamp(stampId);
  } else {
    const me = getLocalPlayer();
    showFloatingStamp({
      playerId: state.localPlayerId,
      name: me ? me.name : state.profile.name,
      color: me ? me.color : state.profile.color,
      stampId,
    });
  }
}

function getLocalPlayer() {
  return state.players.find((p) => p.id === state.localPlayerId) || state.players[0] || null;
}

// ==================== トップ画面アクション ====================

function buildPlayerProfile() {
  saveProfile();
  const name = getEffectivePlayerName();
  $('input-player-name').value = name;
  state.profile.name = name;
  saveProfile();
  return { name, color: state.profile.color };
}

async function handleCreateRoom() {
  const profile = buildPlayerProfile();
  cleanupSession();
  state.mode = 'online';
  setTopButtonsDisabled(true);
  setTopStatus('部屋を作成しています...（PeerJSに接続中）');

  try {
    initNetwork();
    const res = await state.network.createRoom(profile);
    state.roomCode = res.roomCode;
    state.localPlayerId = res.localPlayerId;
    state.isHost = true;
    state.players = state.network.getPlayers();
    state.settings = { ...DEFAULT_SETTINGS, ...state.network.getSettings() };
    setTopStatus('');
    enterLobbyScreen();
    appendChatMessage({
      isSystem: true,
      text: `部屋コード「${state.roomCode}」を作成しました！友達にコードを教えてね。`,
    });
  } catch (err) {
    setTopStatus(err?.message || '部屋の作成に失敗しました。もう一度お試しください。', true);
    showToast(err?.message || '部屋の作成に失敗しました', 'error');
    cleanupSession();
  } finally {
    setTopButtonsDisabled(false);
  }
}

async function handleJoinRoom() {
  const roomCode = $('input-room-code').value.trim();
  if (!/^\d{6}$/.test(roomCode)) {
    setTopStatus('6桁の数字の部屋コードを入力してください！', true);
    $('input-room-code').focus();
    return;
  }

  const profile = buildPlayerProfile();
  cleanupSession();
  state.mode = 'online';
  setTopButtonsDisabled(true);
  setTopStatus(`部屋 ${roomCode} に接続しています...`);

  try {
    initNetwork();
    const res = await state.network.joinRoom(roomCode, profile);
    state.roomCode = res.roomCode || roomCode;
    state.localPlayerId = res.localPlayerId;
    state.isHost = state.network.isHost();
    state.players = state.network.getPlayers();
    state.settings = { ...DEFAULT_SETTINGS, ...state.network.getSettings() };
    setTopStatus('');
    enterLobbyScreen();
    appendChatMessage({
      isSystem: true,
      text: `部屋「${state.roomCode}」に参加しました！`,
    });
  } catch (err) {
    setTopStatus(err?.message || '部屋への参加に失敗しました。コードを確認してください。', true);
    showToast(err?.message || '部屋への参加に失敗しました', 'error');
    cleanupSession();
  } finally {
    setTopButtonsDisabled(false);
  }
}

function handleStartOfflineCPU() {
  const profile = buildPlayerProfile();
  cleanupSession();
  state.mode = 'offline';
  state.isHost = true;
  state.roomCode = null;
  state.settings = { ...DEFAULT_SETTINGS };

  const human = createDefaultPlayer({
    id: 'local_p1',
    slot: 0,
    name: profile.name,
    color: profile.color,
    team: 'A',
    isHost: true,
    isCPU: false,
    ready: true,
  });

  const cpuColor = AVATAR_COLORS.find((c) => c !== profile.color) || AVATAR_COLORS[1];
  const cpu1 = createDefaultPlayer({
    id: 'cpu_1',
    slot: 1,
    name: 'CPU 1',
    color: cpuColor,
    team: 'B',
    isHost: false,
    isCPU: true,
    cpuLevel: state.settings.cpuLevel || DEFAULT_CPU_LEVEL,
    ready: true,
  });

  state.localPlayerId = human.id;
  state.players = [human, cpu1];

  enterLobbyScreen();
  appendChatMessage({
    isSystem: true,
    text: 'オフラインCPU戦モードです！CPUを増やしたりルールを選んでスタートしよう。',
  });
}

// ==================== ネットワーク初期化 ====================

function initNetwork() {
  if (state.network) {
    state.network.disconnect();
    state.network = null;
  }

  state.network = new NetworkManager({
    onRoomReady: ({ roomCode, isHost, players, settings }) => {
      state.roomCode = roomCode;
      state.isHost = isHost;
      if (Array.isArray(players)) state.players = players;
      if (settings) state.settings = { ...DEFAULT_SETTINGS, ...settings };
      if (state.phase === 'LOBBY') renderLobby();
    },

    onPlayersUpdate: (players) => {
      if (!Array.isArray(players)) return;
      state.players = players;
      const me = getLocalPlayer();
      if (me) state.isHost = Boolean(me.isHost);
      if (state.phase === 'LOBBY') {
        renderLobby();
      } else if (state.phase === 'DRAW') {
        updateDrawDoneBadges();
      }
    },

    onSettingsUpdate: (settings) => {
      if (!settings) return;
      state.settings = { ...DEFAULT_SETTINGS, ...settings };
      if (state.phase === 'LOBBY') renderLobby();
    },

    onPhaseChange: (phase, payload = {}) => {
      handleRemotePhaseChange(phase, payload);
    },

    onDrawEvent: (playerId, event) => {
      if (playerId === state.localPlayerId) return;
      const pad = state.previewPads.get(playerId);
      if (!pad || !event) return;
      if (event.type === 'chunk') {
        pad.applyChunk(event.strokeMeta, event.points);
      } else if (event.type === 'end') {
        pad.endStroke(event.strokeId);
      } else if (event.type === 'undo') {
        pad.applyUndo(event.strokeId);
      } else if (event.type === 'clear') {
        pad.clear();
      }
    },

    onPlayerDrawDone: (playerId, strokes) => {
      const target = state.players.find((p) => p.id === playerId);
      if (target) {
        target.drawDone = true;
        if (Array.isArray(strokes)) target.strokes = strokes;
      }
      const pad = state.previewPads.get(playerId);
      if (pad && Array.isArray(strokes)) {
        pad.setStrokes(strokes);
      }
      updateDrawDoneBadges();

      if (state.isHost && state.phase === 'DRAW') {
        checkHostAllDrawDone();
      }
    },

    onStatsReceived: (playersWithStats) => {
      if (Array.isArray(playersWithStats)) {
        mergePlayersData(playersWithStats);
      }
      enterStatsScreen(state.players);
    },

    onBattleStart: (battleConfig) => {
      enterBattleScreen(battleConfig);
    },

    onBattleSnapshot: (snapshot) => {
      state.battleEngine?.applyHostSnapshot(snapshot);
    },

    onBattleEvent: (event) => {
      state.battleEngine?.applyHostEvent(event);
      handleBattleEventNotice(event);
    },

    onClientInput: (playerId, input) => {
      state.battleEngine?.setRemoteInput(playerId, input);
    },

    onBattleEnd: (result) => {
      if (state.phase === 'BATTLE') {
        enterResultScreen(result);
      }
    },

    onChatMessage: (msg) => {
      appendChatMessage(msg);
    },

    onStamp: (stampData) => {
      showFloatingStamp(stampData);
    },

    onNotification: (message, level = 'info') => {
      if (!message) return;
      const now = Date.now();
      const last = state._lastNotifications?.get(message) || 0;
      if (now - last < 2500) return;
      if (!state._lastNotifications) state._lastNotifications = new Map();
      state._lastNotifications.set(message, now);

      showToast(message, level);
      appendChatMessage({ isSystem: true, text: message });
      if (state.phase === 'BATTLE') {
        showBattleToast(message);
      }
    },

    onPlayerDisconnected: ({ playerId }) => {
      // 通知トースト・チャットは network.js の onNotification から送られるため重複表示しない
      if (state.phase === 'BATTLE') {
        state.battleEngine?.handlePlayerDisconnect(playerId);
      } else if (state.phase === 'DRAW' && state.isHost) {
        checkHostAllDrawDone();
      }
    },

    onHostMigrated: ({ isLocalNewHost, players }) => {
      state.isHost = Boolean(isLocalNewHost);
      if (Array.isArray(players)) state.players = players;

      // ホスト引き継ぎのトースト・チャット通知は network.js の onNotification 側で1回表示済み
      if (state.phase === 'LOBBY') {
        renderLobby();
      } else if (state.phase === 'DRAW') {
        updateDrawDoneBadges();
        if (isLocalNewHost) {
          checkHostAllDrawDone();
          if (Date.now() >= state.drawEndTime) {
            hostFinalizeDrawing();
          }
        }
      } else if (state.phase === 'STATS') {
        updateStatsHostControls();
        if (isLocalNewHost && state.statsCountdown <= 0) {
          hostTriggerStartBattle();
        }
      } else if (state.phase === 'BATTLE') {
        if (isLocalNewHost) {
          state.battleEngine?.promoteToHost();
        }
      } else if (state.phase === 'RESULT') {
        updateResultButtons();
      }
    },

    onError: (message) => {
      showToast(message || '通信エラーが発生しました', 'error');
      if (state.phase === 'TOP') {
        setTopStatus(message || '通信エラーが発生しました', true);
      }
    },
  });
}

function handleRemotePhaseChange(phase, payload) {
  if (phase === 'LOBBY') {
    stopBattleEngine();
    stopDrawTimers();
    stopStatsTimer();
    state.players.forEach((p) => {
      p.drawDone = false;
    });
    enterLobbyScreen();
  } else if (phase === 'DRAW') {
    stopBattleEngine();
    stopStatsTimer();
    const theme = payload?.theme || pickTheme(state.settings.themeId);
    const duration = payload?.duration || DRAW_TIME_SECONDS;
    const startTime = payload?.startTime || Date.now();
    enterDrawScreen(theme, startTime, duration);
  } else if (phase === 'STATS') {
    if (Array.isArray(payload?.players)) {
      mergePlayersData(payload.players);
    }
    enterStatsScreen(state.players);
  } else if (phase === 'BATTLE') {
    enterBattleScreen(payload);
  } else if (phase === 'RESULT') {
    enterResultScreen(payload?.result || payload);
  }
}

function mergePlayersData(incoming) {
  const byId = new Map(incoming.map((p) => [p.id, p]));
  state.players = incoming.map((inc) => {
    const existing = state.players.find((p) => p.id === inc.id);
    return existing ? { ...existing, ...inc } : inc;
  });
  // ローカルが抜けないように確認
  if (!byId.has(state.localPlayerId) && state.players.length > 0) {
    // すでに退出扱いでなければそのまま
  }
}

// ==================== ロビー画面 ====================

function enterLobbyScreen() {
  stopBattleEngine();
  stopDrawTimers();
  stopStatsTimer();
  showScreen('LOBBY');
  renderLobby();
}

function renderLobby() {
  const isOnline = state.mode === 'online';
  const roomBadge = $('lobby-room-badge');
  const modePill = $('lobby-mode-pill');

  if (isOnline && state.roomCode) {
    roomBadge.classList.remove('hidden');
    $('lobby-room-code').textContent = state.roomCode;
    modePill.textContent = state.isHost ? '🌐 オンライン（ホスト）' : '🌐 オンライン';
  } else {
    roomBadge.classList.add('hidden');
    modePill.textContent = '🤖 オフライン CPU戦';
  }

  // プレイヤー数・CPU追加ボタン
  $('lobby-player-count').textContent = String(state.players.length);
  const addCpuBtn = $('btn-add-cpu');
  addCpuBtn.classList.toggle('hidden', !state.isHost);
  addCpuBtn.disabled = state.players.length >= MAX_PLAYERS;

  // 4スロット描画
  const slotsContainer = $('lobby-players');
  slotsContainer.innerHTML = '';
  const isTeamMode = state.settings.battleMode === '2v2';

  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = state.players[i];
    if (!p) {
      const empty = document.createElement('div');
      empty.className = 'player-slot player-slot--empty';
      empty.textContent = `スロット ${i + 1}：空き（参加待ち / CPU追加可）`;
      slotsContainer.appendChild(empty);
      continue;
    }

    const isLocal = p.id === state.localPlayerId;
    const slot = document.createElement('div');
    slot.className = `player-slot${isLocal ? ' player-slot--local' : ''}`;

    const left = document.createElement('div');
    left.className = 'slot-left';

    const dot = document.createElement('span');
    dot.className = 'slot-color-dot';
    dot.style.backgroundColor = p.color;

    const info = document.createElement('div');
    info.className = 'slot-info';

    const nameRow = document.createElement('div');
    nameRow.className = 'slot-name-row';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'slot-name';
    nameSpan.textContent = p.name;
    nameRow.appendChild(nameSpan);
    if (p.isHost) {
      const crown = document.createElement('span');
      crown.title = 'ホスト';
      crown.textContent = '👑';
      nameRow.appendChild(crown);
    }

    const badges = document.createElement('div');
    badges.className = 'slot-badges';
    if (isLocal) {
      badges.appendChild(makeMiniBadge('あなた', ''));
    }
    if (p.isHost) {
      badges.appendChild(makeMiniBadge('ホスト', 'mini-badge--host'));
    }
    if (p.isCPU) {
      badges.appendChild(makeMiniBadge('🤖 CPU', 'mini-badge--cpu'));
      if (!state.isHost) {
        badges.appendChild(makeCPULevelBadge(p.cpuLevel));
      }
    } else if (!p.isHost && p.ready) {
      badges.appendChild(makeMiniBadge('準備OK', 'mini-badge--ready'));
    }
    if (isTeamMode) {
      badges.appendChild(
        makeMiniBadge(
          p.team === 'B' ? 'チームB' : 'チームA',
          p.team === 'B' ? 'mini-badge--teamB' : 'mini-badge--teamA'
        )
      );
    }

    info.appendChild(nameRow);
    info.appendChild(badges);
    left.appendChild(dot);
    left.appendChild(info);

    const right = document.createElement('div');
    right.className = 'slot-right';

    if (p.isCPU && state.isHost) {
      const cpuSel = document.createElement('select');
      const curLvl = p.cpuLevel || state.settings.cpuLevel || DEFAULT_CPU_LEVEL;
      cpuSel.className = `cpu-level-select${curLvl === 'insane' ? ' cpu-level-insane' : ''}`;
      cpuSel.setAttribute('aria-label', `${p.name}の強さ`);
      CPU_LEVELS.forEach((lvl) => {
        const opt = document.createElement('option');
        opt.value = lvl.id;
        opt.textContent = `${lvl.badge} ${lvl.label}`;
        cpuSel.appendChild(opt);
      });
      cpuSel.value = curLvl;
      cpuSel.addEventListener('change', (e) => handleSetCPULevel(p.id, e.target.value));
      right.appendChild(cpuSel);
    }

    if (isTeamMode && (state.isHost || isLocal)) {
      const teamBtn = document.createElement('button');
      teamBtn.type = 'button';
      teamBtn.className = 'sketch-btn sketch-btn--sm';
      teamBtn.textContent = p.team === 'B' ? 'B→A' : 'A→B';
      teamBtn.title = 'チーム切替';
      teamBtn.addEventListener('click', () => handleToggleTeam(p.id));
      right.appendChild(teamBtn);
    }

    if (p.isCPU && state.isHost) {
      const rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'sketch-btn sketch-btn--danger sketch-btn--sm';
      rmBtn.textContent = '✕';
      rmBtn.title = 'CPUを削除';
      rmBtn.addEventListener('click', () => handleRemoveCPU(p.id));
      right.appendChild(rmBtn);
    }

    slot.appendChild(left);
    slot.appendChild(right);
    slotsContainer.appendChild(slot);
  }

  // 設定フォーム同期
  const battleModeEl = $('select-battle-mode');
  const ruleModeEl = $('select-rule-mode');
  const stageEl = $('select-stage');
  const themeEl = $('select-theme');
  const cpuLevelEl = $('setting-cpu-level');

  battleModeEl.value = state.settings.battleMode || 'ffa';
  ruleModeEl.value = state.settings.ruleMode || 'stock';
  stageEl.value = state.settings.stageId || 'notebook';
  themeEl.value = state.settings.themeId || 'random';
  cpuLevelEl.value = state.settings.cpuLevel || DEFAULT_CPU_LEVEL;
  cpuLevelEl.classList.toggle('cpu-level-insane', cpuLevelEl.value === 'insane');

  [battleModeEl, ruleModeEl, stageEl, themeEl, cpuLevelEl].forEach((el) => {
    el.disabled = !state.isHost;
  });

  const stageObj = STAGES.find((s) => s.id === stageEl.value);
  $('stage-desc-note').textContent = stageObj ? stageObj.description : '';

  const themeObj = THEMES.find((t) => t.id === themeEl.value);
  $('theme-hint-note').textContent = themeObj
    ? themeObj.hint
    : `開始時に全${THEMES.length}種のお題からランダムで選ばれます！`;

  const cpuLvlInfo = getCPULevelInfo(cpuLevelEl.value);
  $('cpu-level-desc-note').textContent = `${cpuLvlInfo.description}（各CPUスロットから個別変更もできます）`;

  $('lobby-settings-hint').textContent = state.isHost
    ? 'あなたはホストです。自由にルールを設定できます'
    : 'ホストがルールを設定しています...';

  // 開始／準備ボタン
  const startBtn = $('btn-start-game');
  const readyBtn = $('btn-toggle-ready');
  const startHint = $('lobby-start-hint');

  if (state.isHost) {
    startBtn.classList.remove('hidden');
    readyBtn.classList.add('hidden');
    const canStart = validateCanStart();
    startBtn.disabled = !canStart.ok;
    startHint.textContent = canStart.reason;
  } else {
    startBtn.classList.add('hidden');
    readyBtn.classList.remove('hidden');
    const me = getLocalPlayer();
    const isReady = Boolean(me?.ready);
    readyBtn.textContent = isReady ? '↩ 準備を解除' : '✅ 準備OK！';
    readyBtn.classList.toggle('sketch-btn--accent', isReady);
    readyBtn.classList.toggle('sketch-btn--secondary', !isReady);
    startHint.textContent = 'ホストの開始を待っています...';
  }
}

function makeMiniBadge(text, extraClass) {
  const span = document.createElement('span');
  span.className = `mini-badge ${extraClass}`.trim();
  span.textContent = text;
  return span;
}

function makeCPULevelBadge(levelId) {
  const info = getCPULevelInfo(levelId);
  const span = document.createElement('span');
  span.className = `cpu-level-badge${info.id === 'insane' ? ' cpu-level-insane' : ''}`;
  span.title = `${info.label} (${info.shortLabel}) — ${info.description}`;
  span.textContent = `${info.badge} ${info.label}`;
  if (info.id !== 'insane') {
    span.style.backgroundColor = `${info.color}24`;
    span.style.borderColor = info.color;
  }
  return span;
}

function makeCPULevelBadgeHtml(levelId) {
  const info = getCPULevelInfo(levelId);
  if (info.id === 'insane') {
    return `<span class="cpu-level-badge cpu-level-insane" title="${escapeHtml(info.description)}">${info.badge} ${escapeHtml(info.label)}</span>`;
  }
  return `<span class="cpu-level-badge" style="background:${info.color}24;border-color:${info.color}" title="${escapeHtml(info.description)}">${info.badge} ${escapeHtml(info.label)}</span>`;
}

function validateCanStart() {
  if (state.players.length < 2) {
    return { ok: false, reason: '2人以上（またはCPUを追加）で開始できます！' };
  }
  if (state.settings.battleMode === '1v1' && state.players.length > 2) {
    return { ok: false, reason: '1対1モードは2人までです（モード変更かCPU削除をしてください）' };
  }
  if (state.settings.battleMode === '2v2') {
    const teamA = state.players.filter((p) => (p.team || 'A') === 'A').length;
    const teamB = state.players.filter((p) => p.team === 'B').length;
    if (teamA === 0 || teamB === 0) {
      return { ok: false, reason: '2対2モードではチームAとチームBの両方に1人以上必要です！' };
    }
  }
  return { ok: true, reason: '準備ができたらお絵描きをスタートしよう！' };
}

async function handleCopyRoomCode() {
  if (!state.roomCode) return;
  try {
    await navigator.clipboard.writeText(state.roomCode);
    showToast(`部屋コード「${state.roomCode}」をコピーしました！`, 'info');
  } catch {
    showToast(`部屋コード：${state.roomCode}`, 'info');
  }
}

function handleSettingsChange(partial) {
  if (!state.isHost) return;
  state.settings = { ...state.settings, ...partial };
  if (partial.battleMode === '2v2') {
    // 2v2 に切り替えたら自動で均等にチーム振り分け
    state.players.forEach((p, idx) => {
      p.team = idx % 2 === 0 ? 'A' : 'B';
    });
  }
  if (state.mode === 'online' && state.network) {
    state.network.updateSettings(partial);
  }
  renderLobby();
}

function handleDefaultCPULevelChange(levelId) {
  if (!state.isHost) return;
  const info = getCPULevelInfo(levelId);
  const nextLevel = info.id;
  state.settings = { ...state.settings, cpuLevel: nextLevel };
  state.players.forEach((p) => {
    if (p.isCPU) p.cpuLevel = nextLevel;
  });
  if (state.mode === 'online' && state.network) {
    state.network.updateSettings({ cpuLevel: nextLevel, applyToExistingCPUs: true });
  }
  renderLobby();
}

function handleSetCPULevel(playerId, levelId) {
  if (!state.isHost) return;
  const nextLevel = getCPULevelInfo(levelId).id;
  const target = state.players.find((p) => p.id === playerId && p.isCPU);
  if (!target) return;
  target.cpuLevel = nextLevel;
  if (state.mode === 'online' && state.network && typeof state.network.setCPULevel === 'function') {
    state.network.setCPULevel(playerId, nextLevel);
  }
  renderLobby();
}

function handleAddCPU() {
  if (!state.isHost || state.players.length >= MAX_PLAYERS) return;
  const defaultLevel = state.settings.cpuLevel || DEFAULT_CPU_LEVEL;
  if (state.mode === 'online' && state.network) {
    state.network.addCPU(defaultLevel);
  } else {
    const usedColors = new Set(state.players.map((p) => p.color));
    const color = AVATAR_COLORS.find((c) => !usedColors.has(c)) || AVATAR_COLORS[state.players.length % AVATAR_COLORS.length];
    const cpuNum = state.players.filter((p) => p.isCPU).length + 1;
    const teamACount = state.players.filter((p) => (p.team || 'A') === 'A').length;
    const teamBCount = state.players.filter((p) => p.team === 'B').length;
    const cpu = createDefaultPlayer({
      id: `cpu_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      slot: state.players.length,
      name: `CPU ${cpuNum}`,
      color,
      team: teamACount <= teamBCount ? 'A' : 'B',
      isHost: false,
      isCPU: true,
      cpuLevel: defaultLevel,
      ready: true,
    });
    state.players.push(cpu);
    renderLobby();
  }
}

function handleRemoveCPU(cpuId) {
  if (!state.isHost) return;
  if (state.mode === 'online' && state.network) {
    state.network.removeCPU(cpuId);
  } else {
    state.players = state.players.filter((p) => p.id !== cpuId);
    state.players.forEach((p, idx) => {
      p.slot = idx;
    });
    renderLobby();
  }
}

function handleToggleTeam(playerId) {
  if (state.mode === 'online' && state.network) {
    state.network.toggleTeam(playerId);
  } else {
    const target = state.players.find((p) => p.id === playerId);
    if (target) {
      target.team = target.team === 'B' ? 'A' : 'B';
      renderLobby();
    }
  }
}

function handleToggleReady() {
  const me = getLocalPlayer();
  if (!me || me.isHost) return;
  const nextReady = !me.ready;
  me.ready = nextReady;
  if (state.mode === 'online' && state.network) {
    state.network.setReady(nextReady);
  }
  renderLobby();
}

function pickTheme(themeId) {
  if (themeId && themeId !== 'random') {
    const found = THEMES.find((t) => t.id === themeId);
    if (found) return found;
  }
  return THEMES[Math.floor(Math.random() * THEMES.length)];
}

function handleStartDrawingFromLobby() {
  if (!state.isHost) return;
  const check = validateCanStart();
  if (!check.ok) {
    showToast(check.reason, 'warn');
    return;
  }
  hostStartDrawing();
}

function hostStartDrawing() {
  const theme = pickTheme(state.settings.themeId);
  const startTime = Date.now();
  const duration = DRAW_TIME_SECONDS;

  state.players.forEach((p) => {
    p.drawDone = false;
    p.strokes = [];
    p.stats = null;
  });

  if (state.mode === 'online' && state.network) {
    // network.startDrawing() がホスト自身の onPhaseChange('DRAW', payload) も発火する
    state.network.startDrawing(theme);
  } else {
    enterDrawScreen(theme, startTime, duration);
  }
}

// ==================== お絵描き画面 ====================

function enterDrawScreen(theme, startTime, duration = DRAW_TIME_SECONDS) {
  stopDrawTimers();
  stopStatsTimer();
  stopBattleEngine();

  const resolvedTheme =
    (theme && THEMES.find((t) => t.id === theme.id)) || theme || THEMES[0];
  state.currentTheme = { ...resolvedTheme, ...(theme || {}) };
  state.drawFinishedLocal = false;
  state.drawFinalized = false;
  state.lastWarnSecond = 99;
  state.drawEndTime = (startTime || Date.now()) + duration * 1000;

  state.players.forEach((p) => {
    p.drawDone = false;
    p.strokes = [];
  });

  showScreen('DRAW');

  // お題表示
  $('draw-theme-label').textContent = state.currentTheme.emoji
    ? `${state.currentTheme.emoji} ${state.currentTheme.label}`
    : state.currentTheme.label;
  $('draw-theme-hint').textContent = state.currentTheme.hint || '';
  $('draw-warning-banner').classList.add('hidden');
  $('draw-timer-box').classList.remove('is-warning');
  $('draw-done-overlay').classList.add('hidden');
  $('btn-draw-done').disabled = false;
  $('btn-draw-undo').disabled = false;
  $('btn-draw-clear').disabled = false;

  // メインキャンバス初期化
  if (state.drawingPad) {
    state.drawingPad.destroy();
    state.drawingPad = null;
  }
  const canvas = $('draw-canvas');
  state.drawingPad = new DrawingPad(canvas, {
    onStrokeChunk: (strokeMeta, points) => {
      if (state.mode === 'online' && state.network) {
        state.network.sendDrawChunk(strokeMeta, points);
      }
    },
    onStrokeEnd: (strokeId) => {
      if (state.mode === 'online' && state.network) {
        state.network.sendDrawEnd(strokeId);
      }
    },
    onUndo: (strokeId) => {
      if (state.mode === 'online' && state.network) {
        state.network.sendDrawUndo(strokeId);
      }
    },
    onClear: () => {
      if (state.mode === 'online' && state.network) {
        state.network.sendDrawClear();
      }
    },
  });

  setDrawTool('pen');
  selectDrawColor(DRAW_PALETTE[0]);
  setDrawSize(8);

  // 対戦相手ミニキャンバス構築
  buildOpponentPreviews();
  updateDrawDoneBadges();

  try {
    sfx.playDrawStart();
  } catch {
    // ignore
  }

  // カウントダウン開始
  updateDrawTimerDisplay();
  state.drawTimerId = setInterval(updateDrawTimerDisplay, 200);
}

function buildOpponentPreviews() {
  state.previewPads.clear();
  const container = $('draw-previews');
  container.innerHTML = '';

  const opponents = state.players.filter((p) => p.id !== state.localPlayerId);
  if (opponents.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted-note';
    empty.textContent = '他のプレイヤーはいません';
    container.appendChild(empty);
    return;
  }

  opponents.slice(0, 3).forEach((opp) => {
    const card = document.createElement('div');
    card.className = 'preview-card';
    card.dataset.playerId = opp.id;

    const head = document.createElement('div');
    head.className = 'preview-head';

    const nameWrap = document.createElement('div');
    nameWrap.className = 'preview-name-wrap';
    const dot = document.createElement('span');
    dot.className = 'preview-dot';
    dot.style.backgroundColor = opp.color;
    const nameEl = document.createElement('span');
    nameEl.className = 'preview-name';
    nameEl.textContent = opp.name;
    nameWrap.appendChild(dot);
    nameWrap.appendChild(nameEl);

    const doneTag = document.createElement('span');
    doneTag.className = 'preview-done-tag hidden';
    doneTag.textContent = '完成！';

    head.appendChild(nameWrap);
    head.appendChild(doneTag);
    card.appendChild(head);

    if (opp.isCPU) {
      const box = document.createElement('div');
      box.className = 'preview-cpu-placeholder';
      box.innerHTML = '🤖<br/>秘密のキャラを<br/>お絵描き中...';
      card.appendChild(box);
    } else {
      const miniCanvas = document.createElement('canvas');
      miniCanvas.width = 160;
      miniCanvas.height = 160;
      miniCanvas.className = 'preview-canvas';
      card.appendChild(miniCanvas);
      const pad = new RemotePreviewPad(miniCanvas);
      state.previewPads.set(opp.id, pad);
    }

    container.appendChild(card);
  });
}

function updateDrawDoneBadges() {
  const humans = state.players.filter((p) => !p.isCPU && p.connected !== false);
  const doneCount = humans.filter((p) => p.drawDone).length;
  $('draw-done-progress').textContent = `完了 ${doneCount}/${humans.length}`;

  document.querySelectorAll('#draw-previews .preview-card').forEach((card) => {
    const pid = card.dataset.playerId;
    const p = state.players.find((pl) => pl.id === pid);
    const tag = card.querySelector('.preview-done-tag');
    if (tag) {
      tag.classList.toggle('hidden', !p || !p.drawDone);
    }
  });
}

function setDrawTool(tool) {
  state.drawingPad?.setTool(tool);
  $('tool-pen').classList.toggle('is-active', tool === 'pen');
  $('tool-eraser').classList.toggle('is-active', tool === 'eraser');
}

function selectDrawColor(hex) {
  state.drawingPad?.setColor(hex);
  setDrawTool('pen');
  document.querySelectorAll('#draw-color-palette .palette-swatch').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.color === hex);
  });
}

function setDrawSize(size) {
  state.drawingPad?.setSize(size);
  document.querySelectorAll('.size-btn').forEach((btn) => {
    btn.classList.toggle('is-active', Number(btn.dataset.size) === size);
  });
}

function updateDrawTimerDisplay() {
  const remainingMs = Math.max(0, state.drawEndTime - Date.now());
  const remainingSec = Math.ceil(remainingMs / 1000);
  $('draw-timer-value').textContent = String(remainingSec);

  const isWarning = remainingSec <= 10 && remainingSec > 0;
  $('draw-timer-box').classList.toggle('is-warning', isWarning);
  $('draw-warning-banner').classList.toggle('hidden', !isWarning);

  if (remainingSec < state.lastWarnSecond) {
    state.lastWarnSecond = remainingSec;
    if (remainingSec === 10) {
      try {
        sfx.playWarning();
      } catch {
        // ignore
      }
    } else if (remainingSec <= 5 && remainingSec >= 1) {
      try {
        sfx.playTick();
      } catch {
        // ignore
      }
    }
  }

  if (remainingMs <= 0) {
    clearInterval(state.drawTimerId);
    state.drawTimerId = null;

    try {
      sfx.playFinish();
    } catch {
      // ignore
    }

    if (!state.drawFinishedLocal) {
      submitLocalDrawing();
    }

    if (state.isHost && !state.drawFinalized) {
      // クライアントの最終ストローク到着を少し待ってから解析
      const grace = state.mode === 'online' ? 1100 : 120;
      state.drawGraceTimeoutId = setTimeout(() => {
        hostFinalizeDrawing();
      }, grace);
    }
  }
}

function submitLocalDrawing() {
  if (state.drawFinishedLocal) return;
  state.drawFinishedLocal = true;

  const me = getLocalPlayer();
  const fallbackColor = me?.color || state.profile.color;
  const finalStrokes = state.drawingPad
    ? state.drawingPad.ensureNonEmpty(fallbackColor)
    : DEFAULT_STROKES;

  state.drawingPad?.setEnabled(false);
  $('draw-done-overlay').classList.remove('hidden');
  $('btn-draw-done').disabled = true;
  $('btn-draw-undo').disabled = true;
  $('btn-draw-clear').disabled = true;

  if (me) {
    me.drawDone = true;
    me.strokes = finalStrokes;
  }
  updateDrawDoneBadges();

  if (state.mode === 'online' && state.network) {
    state.network.sendDrawDone(finalStrokes);
  }

  if (state.isHost) {
    checkHostAllDrawDone();
  }
}

function checkHostAllDrawDone() {
  if (!state.isHost || state.drawFinalized) return;
  const humans = state.players.filter((p) => !p.isCPU && p.connected !== false);
  const allDone = humans.length > 0 && humans.every((p) => p.drawDone);
  if (allDone) {
    hostFinalizeDrawing();
  }
}

function hostFinalizeDrawing() {
  if (!state.isHost || state.drawFinalized) return;
  state.drawFinalized = true;
  stopDrawTimers();

  const themeId = state.currentTheme?.id || 'swordsman';
  const playersWithStats = state.players.map((p) => {
    let strokes = p.strokes;
    if (p.isCPU) {
      strokes = generateCPUCharacter(themeId, p.color);
    } else if (!Array.isArray(strokes) || strokes.length === 0) {
      strokes = DEFAULT_STROKES.map((s) => ({
        ...s,
        color: s.color === '#ef4444' ? p.color : s.color,
      }));
    }
    const stats = analyzeCharacter(strokes, p.color);
    return {
      ...p,
      drawDone: true,
      strokes,
      stats,
    };
  });

  state.players = playersWithStats;

  if (state.mode === 'online' && state.network) {
    state.network.broadcastStats(playersWithStats);
  }

  enterStatsScreen(playersWithStats);
}

function stopDrawTimers() {
  if (state.drawTimerId) {
    clearInterval(state.drawTimerId);
    state.drawTimerId = null;
  }
  if (state.drawGraceTimeoutId) {
    clearTimeout(state.drawGraceTimeoutId);
    state.drawGraceTimeoutId = null;
  }
}

// ==================== 能力値表示画面 ====================

function enterStatsScreen(playersWithStats) {
  stopDrawTimers();
  stopStatsTimer();
  if (state.drawingPad) {
    state.drawingPad.destroy();
    state.drawingPad = null;
  }

  if (Array.isArray(playersWithStats) && playersWithStats.length > 0) {
    state.players = playersWithStats;
  }

  showScreen('STATS');
  renderStatsCards();
  updateStatsHostControls();

  // 自動カウントダウン（ホストはいつでも即バトル開始可能）
  state.statsCountdown = 12;
  updateStatsCountdownLabel();
  state.statsTimerId = setInterval(() => {
    state.statsCountdown -= 1;
    updateStatsCountdownLabel();
    if (state.statsCountdown <= 0) {
      stopStatsTimer();
      if (state.isHost) {
        hostTriggerStartBattle();
      }
    }
  }, 1000);
}

function updateStatsHostControls() {
  const btn = $('btn-start-battle');
  if (state.isHost) {
    btn.classList.remove('hidden');
    btn.disabled = false;
  } else {
    btn.classList.add('hidden');
  }
}

function updateStatsCountdownLabel() {
  const el = $('stats-countdown');
  if (state.statsCountdown > 0) {
    el.textContent = `バトル開始まで ${state.statsCountdown} 秒`;
  } else {
    el.textContent = 'バトル開始中...';
  }
}

function stopStatsTimer() {
  if (state.statsTimerId) {
    clearInterval(state.statsTimerId);
    state.statsTimerId = null;
  }
}

function renderStatsCards() {
  const grid = $('stats-cards');
  grid.innerHTML = '';
  const isTeamMode = state.settings.battleMode === '2v2';

  state.players.forEach((p, idx) => {
    const st = p.stats || analyzeCharacter(p.strokes || DEFAULT_STROKES, p.color);
    p.stats = st;

    const card = document.createElement('article');
    card.className = 'sketch-card fighter-stat-card';
    card.style.animationDelay = `${idx * 70}ms`;

    // 上段：サムネイル＋名前＋アーキタイプ
    const top = document.createElement('div');
    top.className = 'stat-card-top';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'stat-thumb-wrap';
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 140;
    thumbCanvas.height = 140;
    thumbCanvas.className = 'stat-thumb-canvas';
    thumbWrap.appendChild(thumbCanvas);

    const ident = document.createElement('div');
    ident.className = 'stat-identity';

    const nameH3 = document.createElement('h3');
    nameH3.className = 'stat-player-name';
    const dot = document.createElement('span');
    dot.className = 'preview-dot';
    dot.style.backgroundColor = p.color;
    nameH3.appendChild(dot);
    nameH3.appendChild(document.createTextNode(p.name));
    if (p.isCPU) {
      nameH3.appendChild(makeMiniBadge('CPU', 'mini-badge--cpu'));
      nameH3.appendChild(makeCPULevelBadge(p.cpuLevel));
    }
    if (isTeamMode) {
      nameH3.appendChild(
        makeMiniBadge(
          p.team === 'B' ? 'チームB' : 'チームA',
          p.team === 'B' ? 'mini-badge--teamB' : 'mini-badge--teamA'
        )
      );
    }

    const arch = document.createElement('span');
    arch.className = 'archetype-badge';
    arch.textContent = st.archetype || 'バランスファイター';

    ident.appendChild(nameH3);
    ident.appendChild(arch);
    top.appendChild(thumbWrap);
    top.appendChild(ident);
    card.appendChild(top);

    // 特徴チップ
    if (Array.isArray(st.traits) && st.traits.length > 0) {
      const traitsRow = document.createElement('div');
      traitsRow.className = 'traits-row';
      st.traits.forEach((tr) => {
        const chip = document.createElement('span');
        chip.className = 'trait-chip';
        chip.title = tr.effect || '';
        chip.textContent = `${tr.icon || '✨'} ${tr.label}`;
        traitsRow.appendChild(chip);
      });
      card.appendChild(traitsRow);
    }

    // 8ステータスバー
    const barsList = document.createElement('div');
    barsList.className = 'stat-bars-list';
    const statItems = [
      { label: '攻撃', val: st.attack, display: st.attack, pct: st.attack, color: '#ef4444' },
      { label: '防御', val: st.defense, display: st.defense, pct: st.defense, color: '#3b82f6' },
      { label: '速度', val: st.speed, display: st.speed, pct: st.speed, color: '#10b981' },
      { label: 'ジャンプ', val: st.jump, display: st.jump, pct: st.jump, color: '#06b6d4' },
      { label: '重量', val: st.weight, display: st.weight, pct: st.weight, color: '#64748b' },
      { label: 'リーチ', val: st.reach, display: st.reach, pct: st.reach, color: '#f97316' },
      { label: 'つかみ', val: st.grabPower, display: st.grabPower, pct: st.grabPower, color: '#8b5cf6' },
      {
        label: '空中ジャンプ',
        val: st.airJumps,
        display: `${st.airJumps || 1}回`,
        pct: Math.min(100, ((st.airJumps || 1) / 3) * 100),
        color: '#ec4899',
      },
    ];

    statItems.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'stat-bar-row';
      const labelRow = document.createElement('div');
      labelRow.className = 'stat-bar-label';
      labelRow.innerHTML = `<span>${item.label}</span><span>${item.display}</span>`;
      const track = document.createElement('div');
      track.className = 'stat-bar-track';
      const fill = document.createElement('div');
      fill.className = 'stat-bar-fill';
      fill.style.width = `${Math.max(8, Math.min(100, Number(item.pct) || 50))}%`;
      fill.style.backgroundColor = item.color;
      track.appendChild(fill);
      row.appendChild(labelRow);
      row.appendChild(track);
      barsList.appendChild(row);
    });
    card.appendChild(barsList);

    // 必殺技ボックス
    const sp = st.specialMove || {
      name: 'インクウェーブ',
      category: '波動',
      color: '#3b82f6',
      description: 'インクの衝撃波を放つ！',
    };
    const spBox = document.createElement('div');
    spBox.className = 'special-move-box';
    spBox.style.borderLeftColor = sp.color || '#3b82f6';
    spBox.innerHTML = `
      <div class="special-move-head">
        <span class="special-move-name">⚡ ${escapeHtml(sp.name)}</span>
        <span class="special-move-cat">${escapeHtml(sp.category || '必殺技')}</span>
      </div>
      <p class="special-move-desc">${escapeHtml(sp.description || '')}</p>
    `;
    card.appendChild(spBox);

    grid.appendChild(card);

    // サムネイル描画
    try {
      renderThumbnail(thumbCanvas, p.strokes || DEFAULT_STROKES, st);
    } catch {
      // ignore
    }
  });
}

function hostTriggerStartBattle() {
  stopStatsTimer();
  const activePlayers = state.players.filter((p) => p.isCPU || p.connected !== false);
  const participants = activePlayers.length >= 2 ? activePlayers : state.players;
  const battleConfig = {
    stageId: state.settings.stageId || 'notebook',
    mode: state.settings.ruleMode || 'stock',
    stockCount: state.settings.stockCount || 3,
    timeLimit: state.settings.timeLimit || 120,
    teamMode: state.settings.battleMode === '2v2',
    players: participants.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      team: p.team || 'A',
      isCPU: Boolean(p.isCPU || p.connected === false),
      cpuLevel: p.cpuLevel || state.settings.cpuLevel || DEFAULT_CPU_LEVEL,
      strokes: p.strokes || DEFAULT_STROKES,
      stats: p.stats || analyzeCharacter(p.strokes || DEFAULT_STROKES, p.color),
    })),
  };

  if (state.mode === 'online' && state.network) {
    state.network.broadcastStartBattle(battleConfig);
  }
  enterBattleScreen(battleConfig);
}

// ==================== バトル画面 ====================

function enterBattleScreen(battleConfig) {
  stopStatsTimer();
  stopDrawTimers();
  stopBattleEngine();

  const cfg = battleConfig || {
    stageId: state.settings.stageId || 'notebook',
    mode: state.settings.ruleMode || 'stock',
    stockCount: state.settings.stockCount || 3,
    timeLimit: state.settings.timeLimit || 120,
    teamMode: state.settings.battleMode === '2v2',
    players: state.players,
  };

  if (Array.isArray(cfg.players) && cfg.players.length > 0) {
    mergePlayersData(cfg.players);
  }

  showScreen('BATTLE');

  const stageObj = STAGES.find((s) => s.id === cfg.stageId);
  $('battle-stage-pill').textContent = stageObj ? stageObj.name : '学校のノート';
  $('battle-rule-pill').textContent =
    cfg.mode === 'time'
      ? `タイム制 ${Math.round((cfg.timeLimit || 120) / 60)}分`
      : `ストック制 ${cfg.stockCount || 3}機`;

  buildBattleHUD(cfg);

  const canvas = $('battle-canvas');
  state.battleEngine = new BattleEngine(canvas, {
    stageId: cfg.stageId,
    mode: cfg.mode,
    stockCount: cfg.stockCount || 3,
    timeLimit: cfg.timeLimit || 120,
    teamMode: Boolean(cfg.teamMode),
    isHost: state.isHost,
    localPlayerId: state.localPlayerId,
    players: cfg.players,
    onStateBroadcast: (snapshot) => {
      if (state.mode === 'online' && state.isHost && state.network) {
        state.network.sendBattleSnapshot(snapshot);
      }
    },
    onEventBroadcast: (event) => {
      if (state.mode === 'online' && state.isHost && state.network) {
        state.network.sendBattleEvent(event);
      }
      handleBattleEventNotice(event);
    },
    onLocalInput: (input) => {
      if (state.mode === 'online' && !state.isHost && state.network) {
        state.network.sendClientInput(input);
      }
    },
    onHUDUpdate: (hudData) => {
      updateBattleHUD(hudData, cfg);
    },
    onBattleEnd: (result) => {
      handleLocalBattleEnd(result);
    },
  });

  if (typeof state.battleEngine.start === 'function') {
    state.battleEngine.start();
  }
}

function buildBattleHUD(cfg) {
  const grid = $('battle-hud-cards');
  grid.innerHTML = '';
  state.hudCardsMap.clear();
  state.hudDamageCache.clear();

  const maxStocks = cfg.stockCount || 3;
  const isStock = cfg.mode !== 'time';

  cfg.players.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'hud-card';
    card.style.borderBottomColor = p.color;

    const portrait = document.createElement('canvas');
    portrait.width = 64;
    portrait.height = 64;
    portrait.className = 'hud-portrait';

    const meta = document.createElement('div');
    meta.className = 'hud-meta';

    const nameLine = document.createElement('div');
    nameLine.className = 'hud-name-line';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'hud-name';
    nameSpan.textContent = p.name;
    nameLine.appendChild(nameSpan);
    if (cfg.teamMode) {
      nameLine.appendChild(
        makeMiniBadge(
          p.team === 'B' ? 'B' : 'A',
          p.team === 'B' ? 'mini-badge--teamB' : 'mini-badge--teamA'
        )
      );
    }
    if (p.isCPU) {
      nameLine.appendChild(makeCPULevelBadge(p.cpuLevel));
    }

    const stocksRow = document.createElement('div');
    stocksRow.className = 'hud-stocks';
    if (isStock) {
      for (let i = 0; i < maxStocks; i++) {
        const pip = document.createElement('span');
        pip.className = 'stock-pip';
        pip.style.backgroundColor = p.color;
        stocksRow.appendChild(pip);
      }
    } else {
      stocksRow.innerHTML = '<span class="muted-note">TIME</span>';
    }

    const spTrack = document.createElement('div');
    spTrack.className = 'hud-sp-track';
    const spFill = document.createElement('div');
    spFill.className = 'hud-sp-fill is-ready';
    spFill.style.width = '100%';
    spTrack.appendChild(spFill);

    meta.appendChild(nameLine);
    meta.appendChild(stocksRow);
    meta.appendChild(spTrack);

    const dmgWrap = document.createElement('div');
    dmgWrap.className = 'hud-damage-wrap';
    const dmgNum = document.createElement('span');
    dmgNum.className = 'hud-damage dmg-low';
    dmgNum.textContent = '0';
    const dmgPct = document.createElement('span');
    dmgPct.className = 'hud-damage-pct';
    dmgPct.textContent = '%';
    dmgWrap.appendChild(dmgNum);
    dmgWrap.appendChild(dmgPct);

    card.appendChild(portrait);
    card.appendChild(meta);
    card.appendChild(dmgWrap);
    grid.appendChild(card);

    try {
      renderThumbnail(portrait, p.strokes || DEFAULT_STROKES, p.stats);
    } catch {
      // ignore
    }

    state.hudCardsMap.set(p.id, {
      card,
      stocksRow,
      spFill,
      dmgNum,
      color: p.color,
      isStock,
      maxStocks,
    });
    state.hudDamageCache.set(p.id, 0);
  });
}

function updateBattleHUD(hudData, cfg) {
  if (!hudData) return;

  // タイマー更新
  if (typeof hudData.timeLeft === 'number') {
    const sec = Math.max(0, Math.ceil(hudData.timeLeft));
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, '0');
    $('battle-timer').textContent = `${m}:${s}`;
  } else {
    $('battle-timer').textContent = cfg.mode === 'stock' ? '∞' : '0:00';
  }

  if (!Array.isArray(hudData.fighters)) return;
  hudData.fighters.forEach((f) => {
    const refs = state.hudCardsMap.get(f.id);
    if (!refs) return;

    refs.card.classList.toggle('is-out', Boolean(f.isOut));

    // ダメージ％更新＋ヒット時ポップアニメ
    const dmg = Math.round(f.damage || 0);
    const prevDmg = state.hudDamageCache.get(f.id) || 0;
    if (dmg !== prevDmg) {
      refs.dmgNum.textContent = String(dmg);
      refs.dmgNum.className = `hud-damage ${getDamageTierClass(dmg)}`;
      if (dmg > prevDmg) {
        refs.dmgNum.classList.remove('is-pop');
        void refs.dmgNum.offsetWidth;
        refs.dmgNum.classList.add('is-pop');
      }
      state.hudDamageCache.set(f.id, dmg);
    }

    // ストック表示更新
    if (refs.isStock) {
      const pips = refs.stocksRow.querySelectorAll('.stock-pip');
      pips.forEach((pip, idx) => {
        pip.classList.toggle('stock-pip--lost', idx >= (f.stocks || 0));
      });
    }

    // 必殺技クールダウンバー（0=使用可能 or 1=使用可能の両形式に対応）
    // spec: specialCdRatio: 1=ready or 0..1 remaining -> 値からゲージ残量を判定
    const ratio = typeof f.specialCdRatio === 'number' ? f.specialCdRatio : 1;
    const readyPct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    refs.spFill.style.width = `${readyPct}%`;
    refs.spFill.classList.toggle('is-ready', readyPct >= 99);
  });
}

function getDamageTierClass(dmg) {
  if (dmg >= 120) return 'dmg-danger';
  if (dmg >= 80) return 'dmg-high';
  if (dmg >= 40) return 'dmg-mid';
  return 'dmg-low';
}

function handleBattleEventNotice(event) {
  if (!event) return;
  if (event.type === 'item_spawn') {
    const itemLabels = {
      hammer: '🔨 ハンマー出現！',
      bomb: '💣 爆弾が出現！',
      heal: '🍄 回復キノコ出現！',
      giant: '🌟 巨大化キノコ出現！',
    };
    const label = itemLabels[event.itemType || event.kind] || '🎁 アイテムが出現！';
    showBattleToast(label);
  }
}

function handleLocalBattleEnd(result) {
  if (state.phase !== 'BATTLE') return;
  if (state.mode === 'online' && state.isHost && state.network) {
    state.network.broadcastBattleEnd(result);
  }
  enterResultScreen(result);
}

function stopBattleEngine() {
  if (state.battleEngine) {
    if (typeof state.battleEngine.destroy === 'function') {
      state.battleEngine.destroy();
    } else if (typeof state.battleEngine.stop === 'function') {
      state.battleEngine.stop();
    }
    state.battleEngine = null;
  }
}

// ==================== リザルト画面 ====================

function enterResultScreen(result) {
  stopBattleEngine();
  state.lastResult = result || { winnerIds: [], winningTeam: null, rankings: [] };
  showScreen('RESULT');

  try {
    sfx.playWin();
  } catch {
    // ignore
  }

  const rankings = Array.isArray(state.lastResult.rankings) ? state.lastResult.rankings : [];
  const winnerIds = Array.isArray(state.lastResult.winnerIds) ? state.lastResult.winnerIds : [];
  const winningTeam = state.lastResult.winningTeam;

  // タイトル
  const titleEl = $('result-title');
  if (winningTeam) {
    titleEl.textContent = `🏆 チーム${winningTeam} の勝利！`;
  } else if (winnerIds.length > 0) {
    const names = winnerIds
      .map((id) => state.players.find((p) => p.id === id)?.name || rankings.find((r) => r.id === id)?.name)
      .filter(Boolean);
    titleEl.textContent = `🏆 ${names.join(' & ')} の勝利！`;
  } else {
    titleEl.textContent = '🤝 引き分け！';
  }

  // 勝者ショーケース
  const showcase = $('result-winner-showcase');
  showcase.innerHTML = '';
  const winners =
    winnerIds.length > 0
      ? winnerIds.map((id) => state.players.find((p) => p.id === id)).filter(Boolean)
      : state.players.slice(0, 1);

  const canvasesRow = document.createElement('div');
  canvasesRow.className = 'winner-canvases-row';
  winners.forEach((w) => {
    const box = document.createElement('div');
    box.className = 'winner-canvas-box';
    const cv = document.createElement('canvas');
    cv.width = 160;
    cv.height = 160;
    box.appendChild(cv);
    canvasesRow.appendChild(box);
    try {
      renderThumbnail(cv, w.strokes || DEFAULT_STROKES, w.stats);
    } catch {
      // ignore
    }
  });
  showcase.appendChild(canvasesRow);

  if (winners[0]) {
    const sub = document.createElement('div');
    sub.className = 'winner-subinfo';
    const arch = winners[0].stats?.archetype || 'ファイター';
    const spName = winners[0].stats?.specialMove?.name;
    sub.textContent = spName ? `${arch} ／ 必殺技：${spName}` : arch;
    showcase.appendChild(sub);
  }

  // ランキングテーブル
  const tbody = $('result-ranking-body');
  tbody.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉', '4位'];
  rankings.forEach((r, idx) => {
    const tr = document.createElement('tr');
    const rankLabel = medals[(r.rank || idx + 1) - 1] || `${r.rank || idx + 1}位`;
    const matchedPlayer = state.players.find((p) => p.id === r.id);
    const isCpu = Boolean(r.isCPU ?? matchedPlayer?.isCPU);
    const cpuLevel = r.cpuLevel || matchedPlayer?.cpuLevel || DEFAULT_CPU_LEVEL;
    const cpuTag = isCpu ? ` ${makeCPULevelBadgeHtml(cpuLevel)}` : '';
    const teamTag =
      state.settings.battleMode === '2v2'
        ? ` <span class="mini-badge ${r.team === 'B' ? 'mini-badge--teamB' : 'mini-badge--teamA'}">チーム${r.team || 'A'}</span>`
        : '';

    tr.innerHTML = `
      <td class="rank-medal">${rankLabel}</td>
      <td>
        <div class="rank-fighter-cell">
          <span class="preview-dot" style="background:${escapeHtml(r.color || '#3b82f6')}"></span>
          <span>${escapeHtml(r.name || 'ファイター')}${cpuTag}${teamTag}</span>
        </div>
      </td>
      <td><strong>${r.kos ?? 0}</strong></td>
      <td>${r.falls ?? 0}</td>
      <td>${Math.round(r.damageDealt ?? 0)}%</td>
    `;
    tbody.appendChild(tr);
  });

  updateResultButtons();
}

function updateResultButtons() {
  const canControl = state.isHost;
  $('btn-result-redraw').disabled = !canControl;
  $('btn-result-rematch').disabled = !canControl;
  $('btn-result-lobby').disabled = !canControl;
  $('result-client-note').classList.toggle('hidden', canControl);
}

function handleResultRedraw() {
  if (!state.isHost) return;
  hostStartDrawing();
}

function handleResultRematch() {
  if (!state.isHost) return;
  hostTriggerStartBattle();
}

function handleResultReturnLobby() {
  if (!state.isHost) return;
  if (state.mode === 'online' && state.network) {
    // network.requestReturnToLobby() がホスト自身の onPhaseChange('LOBBY') も発火する
    state.network.requestReturnToLobby();
  } else {
    enterLobbyScreen();
  }
}

function handleReturnToTop() {
  cleanupSession();
  clearChatLogs();
  setTopStatus('');
  showScreen('TOP');
}

function cleanupSession() {
  stopBattleEngine();
  stopDrawTimers();
  stopStatsTimer();
  if (state.drawingPad) {
    state.drawingPad.destroy();
    state.drawingPad = null;
  }
  state.previewPads.clear();
  if (state.network) {
    state.network.disconnect();
    state.network = null;
  }
  state.players = [];
  state.roomCode = null;
  state.localPlayerId = null;
  state.isHost = true;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 起動
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// 60秒ファイター！ — 共有定数・ヘルパー

export const CANVAS_SIZE = 320;
export const MAX_PLAYERS = 4;
export const DRAW_TIME_SECONDS = 60;

export const AVATAR_COLORS = [
  '#ef4444',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
];

export const DRAW_PALETTE = [
  '#1f2937',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#92400e',
];

export const THEMES = [
  // バトル・ファンタジー（12）
  { id: 'swordsman', label: '剣士', category: 'バトル・ファンタジー', emoji: '⚔️', hint: '大きな剣やマントを描くと攻撃・リーチUP！' },
  { id: 'dragon', label: 'ドラゴン', category: 'バトル・ファンタジー', emoji: '🐉', hint: '翼と角、炎の赤色を描くと超強力！' },
  { id: 'wizard', label: '魔法使い', category: 'バトル・ファンタジー', emoji: '🧙', hint: 'とんがり帽子と杖、青や黄色で属性攻撃！' },
  { id: 'ninja', label: '忍者', category: 'バトル・ファンタジー', emoji: '🥷', hint: '小さめ＆細身に描くとスピード重視に！' },
  { id: 'samurai', label: '侍', category: 'バトル・ファンタジー', emoji: '🏯', hint: '日本刀と兜のツノで鋭い斬撃ファイター！' },
  { id: 'pirate', label: '海賊', category: 'バトル・ファンタジー', emoji: '🏴‍☠️', hint: 'フックやサーベル、帽子を描いて豪快に！' },
  { id: 'hero', label: 'ヒーロー', category: 'バトル・ファンタジー', emoji: '🦸', hint: 'たなびくマントと星のマークでバランス最強！' },
  { id: 'knight', label: '騎士', category: 'バトル・ファンタジー', emoji: '🛡️', hint: '大きな盾と槍で鉄壁＆長リーチに！' },
  { id: 'angel', label: '天使', category: 'バトル・ファンタジー', emoji: '👼', hint: '大きな白い翼と輪っかで空中ジャンプUP！' },
  { id: 'devil', label: '悪魔', category: 'バトル・ファンタジー', emoji: '😈', hint: 'コウモリ翼と角・ヤリで攻撃的な空中戦！' },
  { id: 'slime', label: 'スライム', category: 'バトル・ファンタジー', emoji: '💧', hint: 'ぷるんと丸く描くと防御・ふっとび耐性UP！' },
  { id: 'oni', label: '赤鬼', category: 'バトル・ファンタジー', emoji: '👹', hint: '角と金棒、赤い体でパワフルな一撃！' },

  // メカ・SF（4）
  { id: 'robot', label: 'ロボット', category: 'メカ・SF', emoji: '🤖', hint: 'がっしり四角いボディやアンテナを描いてみよう！' },
  { id: 'alien', label: '宇宙人', category: 'メカ・SF', emoji: '👽', hint: '触角やたくさんの腕でつかみ＆リーチUP！' },
  { id: 'tank', label: '戦車', category: 'メカ・SF', emoji: '🚜', hint: 'どっしり大きく砲身を描くと超重量パワー型！' },
  { id: 'ufo', label: 'UFO', category: 'メカ・SF', emoji: '🛸', hint: '円盤＆光線でふわふわ空中戦が得意に！' },

  // 生き物（7）
  { id: 'animal', label: '動物', category: '生き物', emoji: '🐾', hint: '耳・しっぽ・長い脚で素早いファイターに！' },
  { id: 'dinosaur', label: '恐竜', category: '生き物', emoji: '🦖', hint: '大きな体としっぽ、キバで豪快な一撃！' },
  { id: 'cat', label: 'ネコ', category: '生き物', emoji: '🐱', hint: 'とんがり耳としっぽで軽快スピードタイプ！' },
  { id: 'shark', label: 'サメ', category: '生き物', emoji: '🦈', hint: '背びれとギザギザの歯、青色で氷・突進系に！' },
  { id: 'penguin', label: 'ペンギン', category: '生き物', emoji: '🐧', hint: '丸い体と小さな翼、水色で氷属性パワー！' },
  { id: 'beetle', label: 'カブトムシ', category: '生き物', emoji: '🪲', hint: '大きなツノと硬い甲羅で攻防ばっちり！' },
  { id: 'octopus', label: 'タコ', category: '生き物', emoji: '🐙', hint: '長い足をたくさん描くとリーチ＆つかみUP！' },

  // 食べ物（6）
  { id: 'food', label: '食べ物', category: '食べ物', emoji: '🍽️', hint: '丸いおにぎりやケーキは防御力が高いかも？' },
  { id: 'ramen', label: 'ラーメン', category: '食べ物', emoji: '🍜', hint: 'どんぶり＋お箸やナルトでアツアツ攻撃！' },
  { id: 'sushi', label: 'おすし', category: '食べ物', emoji: '🍣', hint: 'コンパクトなシャリと赤いネタで素早く戦う！' },
  { id: 'burger', label: 'ハンバーガー', category: '食べ物', emoji: '🍔', hint: 'ボリューム満点の丸ボディでどっしり防御型！' },
  { id: 'icecream', label: 'ソフトクリーム', category: '食べ物', emoji: '🍦', hint: '縦長コーン＋ひんやり色でリーチ＆氷技！' },
  { id: 'banana', label: 'バナナ', category: '食べ物', emoji: '🍌', hint: '細長い黄色いボディで雷＆スピード型に！' },

  // ゆるキャラ・ネタ（7）
  { id: 'weird', label: '変な生き物', category: 'ゆるキャラ・ネタ', emoji: '👾', hint: '自由な発想で！角や長い手足が特殊能力に！' },
  { id: 'ghost', label: 'おばけ', category: 'ゆるキャラ・ネタ', emoji: '👻', hint: 'ふわふわ浮かぶ姿や翼で空中戦が得意に！' },
  { id: 'snowman', label: '雪だるま', category: 'ゆるキャラ・ネタ', emoji: '⛄', hint: '丸い2段ボディと水色マフラーで防御＆氷技！' },
  { id: 'cactus', label: 'サボテン', category: 'ゆるキャラ・ネタ', emoji: '🌵', hint: 'トゲと両腕でリーチとカウンター力UP！' },
  { id: 'macho', label: 'マッチョ', category: 'ゆるキャラ・ネタ', emoji: '💪', hint: 'たくましい腕と広い肩幅で攻撃＆つかみ最強！' },
  { id: 'sumo', label: 'お相撲さん', category: 'ゆるキャラ・ネタ', emoji: '🤼', hint: '大きく丸い体でふっとびにくい重量級！' },
  { id: 'daruma', label: 'だるま', category: 'ゆるキャラ・ネタ', emoji: '🏮', hint: '赤い丸ボディで鉄壁防御＋炎パワー！' },
];

export const STAGES = [
  { id: 'notebook', name: '学校のノート', description: '罫線と定規の王道ステージ' },
  { id: 'paper', name: '画用紙', description: 'クレヨンと色鉛筆の立体ステージ' },
  { id: 'whiteboard', name: 'ホワイトボード', description: 'マグネットが並ぶ広々ステージ' },
];

export const STAMPS = [
  { id: 'hi', emoji: '👋', text: 'よろしく！' },
  { id: 'nice', emoji: '✨', text: 'うまい！' },
  { id: 'strong', emoji: '💪', text: 'つよい！' },
  { id: 'oops', emoji: '💦', text: 'しまった！' },
  { id: 'gg', emoji: '🎉', text: 'GG！' },
  { id: 'again', emoji: '🔥', text: 'もう1回！' },
];

export const CPU_LEVELS = [
  { id: 'easy', label: 'よわい', shortLabel: 'Lv.1', badge: '🐣', color: '#22c55e', description: 'のんびり動く初心者向け' },
  { id: 'normal', label: 'ふつう', shortLabel: 'Lv.2', badge: '🙂', color: '#3b82f6', description: 'バランスの良い標準AI' },
  { id: 'hard', label: 'つよい', shortLabel: 'Lv.3', badge: '😤', color: '#f59e0b', description: 'ガードや必殺技を使いこなす' },
  { id: 'expert', label: 'げきつよ', shortLabel: 'Lv.4', badge: '⚡', color: '#a855f7', description: '空中追撃や復帰阻止も狙う上級AI' },
  { id: 'insane', label: 'バカ強い', shortLabel: 'MAX', badge: '🔥', color: '#ef4444', description: '超反応＆連続コンボの鬼ボスAI！' },
];

export const DEFAULT_CPU_LEVEL = 'normal';

export function getCPULevelInfo(levelId) {
  return CPU_LEVELS.find((l) => l.id === levelId) || CPU_LEVELS[1];
}

// かわいい手描き棒人間ファイター（0..1 正規化座標）
export const DEFAULT_STROKES = [
  {
    id: 'default_head',
    tool: 'pen',
    color: '#1f2937',
    width: 7,
    points: [
      [0.5, 0.16],
      [0.58, 0.18],
      [0.63, 0.24],
      [0.62, 0.33],
      [0.55, 0.38],
      [0.45, 0.38],
      [0.38, 0.32],
      [0.38, 0.23],
      [0.43, 0.17],
      [0.5, 0.16],
    ],
  },
  {
    id: 'default_eye_l',
    tool: 'pen',
    color: '#1f2937',
    width: 6,
    points: [
      [0.46, 0.25],
      [0.465, 0.275],
    ],
  },
  {
    id: 'default_eye_r',
    tool: 'pen',
    color: '#1f2937',
    width: 6,
    points: [
      [0.55, 0.25],
      [0.555, 0.275],
    ],
  },
  {
    id: 'default_smile',
    tool: 'pen',
    color: '#ef4444',
    width: 5,
    points: [
      [0.46, 0.32],
      [0.51, 0.345],
      [0.56, 0.315],
    ],
  },
  {
    id: 'default_body',
    tool: 'pen',
    color: '#1f2937',
    width: 8,
    points: [
      [0.5, 0.38],
      [0.49, 0.52],
      [0.5, 0.65],
    ],
  },
  {
    id: 'default_arm_l',
    tool: 'pen',
    color: '#1f2937',
    width: 7,
    points: [
      [0.49, 0.44],
      [0.37, 0.5],
      [0.28, 0.45],
    ],
  },
  {
    id: 'default_arm_r',
    tool: 'pen',
    color: '#1f2937',
    width: 7,
    points: [
      [0.5, 0.44],
      [0.64, 0.47],
      [0.74, 0.4],
    ],
  },
  {
    id: 'default_leg_l',
    tool: 'pen',
    color: '#1f2937',
    width: 7,
    points: [
      [0.49, 0.65],
      [0.42, 0.78],
      [0.36, 0.88],
    ],
  },
  {
    id: 'default_leg_r',
    tool: 'pen',
    color: '#1f2937',
    width: 7,
    points: [
      [0.5, 0.65],
      [0.58, 0.78],
      [0.65, 0.88],
    ],
  },
  {
    id: 'default_headband',
    tool: 'pen',
    color: '#ef4444',
    width: 6,
    points: [
      [0.38, 0.21],
      [0.5, 0.2],
      [0.63, 0.21],
      [0.71, 0.17],
    ],
  },
];

export function createDefaultPlayer(overrides = {}) {
  return {
    id: `p_${Math.random().toString(36).slice(2, 10)}`,
    peerId: null,
    slot: 0,
    name: 'プレイヤー',
    color: AVATAR_COLORS[0],
    team: 'A',
    isHost: false,
    isCPU: false,
    cpuLevel: DEFAULT_CPU_LEVEL,
    connected: true,
    ready: false,
    drawDone: false,
    strokes: [],
    stats: null,
    ...overrides,
  };
}

export function generateRoomCode() {
  const firstDigit = 1 + Math.floor(Math.random() * 9);
  const rest = Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, '0');
  return `${firstDigit}${rest}`;
}

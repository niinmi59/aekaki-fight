import { DRAW_PALETTE } from './shared.js';
import { renderStrokesToInkCanvas } from './drawing.js';

const RASTER_SIZE = 128;

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function roundInt(v, min, max) {
  return Math.round(clamp(v, min, max));
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function createRasterCanvas() {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = RASTER_SIZE;
    c.height = RASTER_SIZE;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(RASTER_SIZE, RASTER_SIZE);
  }
  return null;
}

function analyzeRaster(strokes) {
  const canvas = createRasterCanvas();
  if (!canvas) {
    return null;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  renderStrokesToInkCanvas(ctx, strokes, RASTER_SIZE, RASTER_SIZE);
  const imgData = ctx.getImageData(0, 0, RASTER_SIZE, RASTER_SIZE).data;

  let minX = RASTER_SIZE;
  let minY = RASTER_SIZE;
  let maxX = -1;
  let maxY = -1;
  let filledPixels = 0;
  let sumX = 0;
  let sumY = 0;

  const rowMinX = new Int16Array(RASTER_SIZE).fill(RASTER_SIZE);
  const rowMaxX = new Int16Array(RASTER_SIZE).fill(-1);
  const rowCount = new Int16Array(RASTER_SIZE);
  const alphaMask = new Uint8Array(RASTER_SIZE * RASTER_SIZE);

  const colors = {
    fire: 0,
    lightning: 0,
    ice: 0,
    star: 0,
    nature: 0,
    dark: 0,
    earth: 0,
    chromatic: 0,
    bright: 0,
    pink: 0,
    yellow: 0,
  };

  for (let y = 0; y < RASTER_SIZE; y++) {
    const rowOff = y * RASTER_SIZE;
    for (let x = 0; x < RASTER_SIZE; x++) {
      const idx = (rowOff + x) * 4;
      const a = imgData[idx + 3];
      if (a < 28) continue;

      alphaMask[rowOff + x] = 1;
      filledPixels++;
      sumX += x;
      sumY += y;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x < rowMinX[y]) rowMinX[y] = x;
      if (x > rowMaxX[y]) rowMaxX[y] = x;
      rowCount[y]++;

      const { h, s, v } = rgbToHsv(imgData[idx], imgData[idx + 1], imgData[idx + 2]);
      if (v < 0.28 || (s < 0.16 && v < 0.55)) {
        colors.dark++;
      } else if (s >= 0.22) {
        colors.chromatic++;
        if (v >= 0.65 && s >= 0.35) colors.bright++;

        if ((h < 34 || h >= 338) && v >= 0.34) {
          colors.fire++;
        } else if (h >= 15 && h < 42 && v < 0.58) {
          colors.earth++;
          colors.dark += 0.35;
        } else if (h >= 34 && h < 74) {
          colors.yellow++;
          colors.lightning += 0.85;
          colors.star += 0.55;
        } else if (h >= 74 && h < 168) {
          colors.nature++;
        } else if (h >= 168 && h < 200) {
          colors.ice += 0.7;
          colors.lightning += 0.55;
        } else if (h >= 200 && h < 260) {
          colors.ice++;
        } else if (h >= 260 && h < 338) {
          colors.pink++;
          colors.star += 0.9;
        }
      }
    }
  }

  if (filledPixels < 6 || maxX < minX || maxY < minY) {
    return null;
  }

  const bw = Math.max(1, maxX - minX + 1);
  const bh = Math.max(1, maxY - minY + 1);
  const centroidX = sumX / filledPixels;
  const centroidY = sumY / filledPixels;

  // Row-wise silhouette interior area & horizontal segment counts
  let silhouetteArea = 0;
  let lowerBandRows = 0;
  let lowerSplitRows = 0;
  let bottomEdgeRows = 0;
  let bottomEdgeSplitRows = 0;
  let topBandRows = 0;
  let topSplitRows = 0;

  let midMaxSpan = 0;
  let torsoSpans = [];
  let upperMidMaxSpan = 0;
  let lowerMidMaxSpan = 0;
  let topBandMaxSpan = 0;
  let headBandMaxSpan = 0;

  let wingLeftMass = 0;
  let wingRightMass = 0;
  let wingBandTotal = 0;
  let wingLeftRows = 0;
  let wingRightRows = 0;

  const midX = (minX + maxX) * 0.5;
  const lowerStartY = minY + Math.floor(bh * 0.66);
  const topHornEndY = minY + Math.max(2, Math.ceil(bh * 0.15));
  const headEndY = minY + Math.ceil(bh * 0.42);
  const midStartY = minY + Math.floor(bh * 0.28);
  const midEndY = minY + Math.ceil(bh * 0.68);
  const wingStartY = minY + Math.floor(bh * 0.16);
  const wingEndY = minY + Math.ceil(bh * 0.62);
  const lowerMidStartY = minY + Math.floor(bh * 0.58);
  const lowerMidEndY = minY + Math.ceil(bh * 0.8);

  const minGapPx = Math.max(3, Math.round(bw * 0.08));

  for (let y = minY; y <= maxY; y++) {
    if (rowMaxX[y] < rowMinX[y]) continue;
    const span = rowMaxX[y] - rowMinX[y] + 1;
    silhouetteArea += span;

    if (y >= midStartY && y <= midEndY) {
      if (span > midMaxSpan) midMaxSpan = span;
      torsoSpans.push(span);
    }
    if (y >= wingStartY && y <= wingEndY) {
      if (span > upperMidMaxSpan) upperMidMaxSpan = span;
      const rowOff = y * RASTER_SIZE;
      let rowLeft = 0;
      let rowRight = 0;
      for (let x = rowMinX[y]; x <= rowMaxX[y]; x++) {
        if (!alphaMask[rowOff + x]) continue;
        wingBandTotal++;
        if (x < midX - bw * 0.26) {
          wingLeftMass++;
          rowLeft++;
        } else if (x > midX + bw * 0.26) {
          wingRightMass++;
          rowRight++;
        }
      }
      if (rowLeft >= 2) wingLeftRows++;
      if (rowRight >= 2) wingRightRows++;
    }
    if (y >= lowerMidStartY && y <= lowerMidEndY) {
      if (span > lowerMidMaxSpan) lowerMidMaxSpan = span;
    }
    if (y <= topHornEndY) {
      if (span > topBandMaxSpan) topBandMaxSpan = span;
    }
    if (y > topHornEndY && y <= headEndY) {
      if (span > headBandMaxSpan) headBandMaxSpan = span;
    }

    // Count horizontal separated runs for leg & horn detection
    if (y >= lowerStartY || y <= topHornEndY) {
      const rowOff = y * RASTER_SIZE;
      let runs = 0;
      let inRun = false;
      let gapLen = 0;
      const runStarts = [];
      const runEnds = [];

      for (let x = rowMinX[y]; x <= rowMaxX[y]; x++) {
        if (alphaMask[rowOff + x]) {
          if (!inRun) {
            if (runs === 0 || gapLen >= minGapPx) {
              runs++;
              runStarts.push(x);
            } else {
              runEnds.pop();
            }
            inRun = true;
            gapLen = 0;
          }
        } else if (inRun) {
          inRun = false;
          runEnds.push(x - 1);
          gapLen = 1;
        } else {
          gapLen++;
        }
      }
      if (inRun) runEnds.push(rowMaxX[y]);

      // Filter out 1px noise speckles
      let validRuns = 0;
      for (let r = 0; r < Math.min(runStarts.length, runEnds.length); r++) {
        if (runEnds[r] - runStarts[r] + 1 >= 2) validRuns++;
      }

      if (y >= lowerStartY) {
        lowerBandRows++;
        if (validRuns >= 2 && span >= bw * 0.24) lowerSplitRows++;
        if (y >= maxY - Math.max(2, Math.ceil(bh * 0.05))) {
          bottomEdgeRows++;
          if (validRuns >= 2 && span >= bw * 0.2) bottomEdgeSplitRows++;
        }
      }
      if (y <= topHornEndY) {
        topBandRows++;
        // True horns/ears show separated tips right near the top edge (not a single curved dome)
        if (validRuns >= 2 && validRuns <= 3 && y <= minY + Math.ceil(bh * 0.1)) {
          topSplitRows++;
        }
      }
    }
  }

  torsoSpans.sort((a, b) => a - b);
  const medianTorsoSpan =
    torsoSpans.length > 0 ? torsoSpans[Math.floor(torsoSpans.length * 0.5)] : bw * 0.5;

  const bboxAreaPx = bw * bh;
  const normBounds = {
    minX: round4(minX / RASTER_SIZE),
    minY: round4(minY / RASTER_SIZE),
    maxX: round4((maxX + 1) / RASTER_SIZE),
    maxY: round4((maxY + 1) / RASTER_SIZE),
    width: round4(bw / RASTER_SIZE),
    height: round4(bh / RASTER_SIZE),
  };

  return {
    bounds: normBounds,
    filledPixels,
    inkRatio: filledPixels / (RASTER_SIZE * RASTER_SIZE),
    compactness: filledPixels / Math.max(1, bboxAreaPx),
    silhouetteFill: silhouetteArea / Math.max(1, bboxAreaPx),
    centroidX: centroidX / RASTER_SIZE,
    centroidY: centroidY / RASTER_SIZE,
    lowerSplitRatio: lowerBandRows > 0 ? lowerSplitRows / lowerBandRows : 0,
    bottomEdgeSplitRatio: bottomEdgeRows > 0 ? bottomEdgeSplitRows / bottomEdgeRows : 0,
    topSplitRatio: topBandRows > 0 ? topSplitRows / topBandRows : 0,
    midMaxSpanRatio: midMaxSpan / Math.max(1, medianTorsoSpan),
    upperVsLowerSpan: upperMidMaxSpan / Math.max(1, lowerMidMaxSpan || medianTorsoSpan),
    topVsHeadSpan: topBandMaxSpan / Math.max(1, headBandMaxSpan || medianTorsoSpan),
    wingLeftRatio: wingBandTotal > 0 ? wingLeftMass / wingBandTotal : 0,
    wingRightRatio: wingBandTotal > 0 ? wingRightMass / wingBandTotal : 0,
    wingVerticalCoverage: Math.min(wingLeftRows, wingRightRows) / Math.max(1, bh),
    wingSymmetry:
      Math.max(wingLeftMass, wingRightMass) > 0
        ? Math.min(wingLeftMass, wingRightMass) / Math.max(wingLeftMass, wingRightMass)
        : 0,
    colors,
  };
}

function analyzeGeometry(strokes, bounds, centroidX, centroidY) {
  const penStrokes = Array.isArray(strokes)
    ? strokes.filter((s) => s && s.tool !== 'eraser' && Array.isArray(s.points) && s.points.length > 0)
    : [];

  let totalInkLength = 0;
  let totalPoints = 0;
  let weaponScore = 0;
  let bluntWeaponHint = false;
  let longArmStrokes = 0;
  let longLegStrokes = 0;
  let hornStrokes = 0;
  let wingStrokeLeft = false;
  let wingStrokeRight = false;

  const bw = Math.max(0.08, bounds.width);
  const bh = Math.max(0.08, bounds.height);
  const maxDim = Math.max(bw, bh);
  const midX = (bounds.minX + bounds.maxX) * 0.5;
  const midY = (bounds.minY + bounds.maxY) * 0.5;

  for (let i = 0; i < penStrokes.length; i++) {
    const s = penStrokes[i];
    const pts = s.points;
    totalPoints += pts.length;

    let pathLen = 0;
    let sMinX = 1;
    let sMaxX = 0;
    let sMinY = 1;
    let sMaxY = 0;
    for (let j = 0; j < pts.length; j++) {
      const x = pts[j][0];
      const y = pts[j][1];
      if (x < sMinX) sMinX = x;
      if (x > sMaxX) sMaxX = x;
      if (y < sMinY) sMinY = y;
      if (y > sMaxY) sMaxY = y;
      if (j > 0) {
        const dx = x - pts[j - 1][0];
        const dy = y - pts[j - 1][1];
        pathLen += Math.hypot(dx, dy);
      }
    }
    totalInkLength += pathLen;

    if (pts.length < 2 || pathLen < 0.03) continue;

    const pStart = pts[0];
    const pEnd = pts[pts.length - 1];
    const chord = Math.hypot(pEnd[0] - pStart[0], pEnd[1] - pStart[1]);
    const straightness = chord / Math.max(0.0001, pathLen);
    const dx = Math.abs(pEnd[0] - pStart[0]);
    const dy = Math.abs(pEnd[1] - pStart[1]);

    // Protruding straight weapon stroke (sword, spear, staff, hammer handle)
    const distStart = Math.hypot(pStart[0] - centroidX, pStart[1] - centroidY);
    const distEnd = Math.hypot(pEnd[0] - centroidX, pEnd[1] - centroidY);
    const tip = distEnd >= distStart ? pEnd : pStart;
    const tipNearOuter =
      tip[0] <= bounds.minX + bw * 0.1 ||
      tip[0] >= bounds.maxX - bw * 0.1 ||
      tip[1] <= bounds.minY + bh * 0.1;
    const tipNotFoot = tip[1] < bounds.maxY - bh * 0.25;
    const notPureHorizontalArm = dy >= chord * 0.25 || chord >= maxDim * 0.45;

    if (
      straightness >= 0.88 &&
      chord >= Math.max(0.24, maxDim * 0.38) &&
      tipNearOuter &&
      tipNotFoot &&
      notPureHorizontalArm
    ) {
      weaponScore += straightness * (chord / maxDim);
      if ((s.width || 7) >= 12) bluntWeaponHint = true;
    }

    // Horizontal arm extension in middle band
    const sMidY = (sMinY + sMaxY) * 0.5;
    if (
      sMidY >= bounds.minY + bh * 0.26 &&
      sMidY <= bounds.minY + bh * 0.68 &&
      dx >= bw * 0.36 &&
      dx > dy * 1.4
    ) {
      longArmStrokes++;
    }

    // Vertical leg stroke in lower band
    if (
      sMaxY >= bounds.maxY - bh * 0.1 &&
      sMinY >= bounds.minY + bh * 0.5 &&
      dy >= bh * 0.24 &&
      dy >= dx * 1.2
    ) {
      longLegStrokes++;
    }

    // Sharp horn / ear peak in top 24%
    if (
      sMinY <= bounds.minY + bh * 0.08 &&
      sMaxY <= bounds.minY + bh * 0.32 &&
      pathLen >= bh * 0.12 &&
      pathLen <= bh * 0.5
    ) {
      if (straightness < 0.72 || dy > dx * 1.1) {
        hornStrokes++;
      }
    }

    // Wing-like tall/looped strokes on upper-mid left & right flanks (not thin horizontal arms)
    const strokeH = sMaxY - sMinY;
    const strokeW = sMaxX - sMinX;
    if (
      sMinY >= bounds.minY + bh * 0.08 &&
      sMaxY <= bounds.minY + bh * 0.74 &&
      strokeH >= bh * 0.2 &&
      strokeW >= bw * 0.16 &&
      straightness < 0.8
    ) {
      if (sMinX <= bounds.minX + bw * 0.14 && sMaxX <= midX + bw * 0.1) {
        wingStrokeLeft = true;
      }
      if (sMaxX >= bounds.maxX - bw * 0.14 && sMinX >= midX - bw * 0.1) {
        wingStrokeRight = true;
      }
    }
  }

  return {
    strokeCount: penStrokes.length,
    totalInkLength,
    totalPoints,
    weaponScore,
    bluntWeaponHint,
    longArmStrokes,
    longLegStrokes,
    hornStrokes,
    hasSymWingStrokes: wingStrokeLeft && wingStrokeRight,
    midX,
    midY,
  };
}

function chooseSpecialMove(flags, dominantElement, stats, playerColor) {
  const powerBase = Math.round(16 + (stats.attack - 30) * 0.22);

  const catalog = {
    slash: {
      id: 'slash',
      name: '一閃インク斬り',
      category: '斬撃系',
      element: 'none',
      color: playerColor || '#3b82f6',
      description: '鋭い武器の軌跡で前方に三日月状のインク斬撃波を放つ！',
      power: clamp(powerBase + 4, 18, 34),
      cooldown: 3.8,
    },
    strike: {
      id: 'strike',
      name: '豪快スマッシュ撃',
      category: '打撃系',
      element: 'none',
      color: playerColor || '#ef4444',
      description: '全身の勢いを乗せた渾身の一撃で相手を大きく吹っ飛ばす！',
      power: clamp(powerBase + 6, 20, 36),
      cooldown: 4.4,
    },
    fire: {
      id: 'fire',
      name: 'ブレイズファイア弾',
      category: '属性攻撃（炎）',
      element: 'fire',
      color: '#f97316',
      description: '燃え上がるクレヨンの火球を放ち、着弾時に火花で爆発する！',
      power: clamp(powerBase + 3, 18, 34),
      cooldown: 4.0,
    },
    lightning: {
      id: 'lightning',
      name: 'サンダーボルト閃',
      category: '属性攻撃（雷）',
      element: 'lightning',
      color: '#eab308',
      description: '高速の電撃ボルトで相手を貫き、ビリッと強烈なヒットストップを与える！',
      power: clamp(powerBase + 2, 17, 33),
      cooldown: 3.9,
    },
    ice: {
      id: 'ice',
      name: 'フローズンシャード',
      category: '属性攻撃（氷）',
      element: 'ice',
      color: '#38bdf8',
      description: '冷たい氷の結晶を飛ばし、命中した相手の動きを一瞬鈍らせる！',
      power: clamp(powerBase + 1, 16, 31),
      cooldown: 4.1,
    },
    star: {
      id: 'star',
      name: 'スターダスト乱射',
      category: '属性攻撃（星）',
      element: 'star',
      color: '#ec4899',
      description: 'カラフルな落書き星を扇状にばら撒き、広範囲を跳ね回らせる！',
      power: clamp(powerBase, 15, 30),
      cooldown: 4.2,
    },
    wing_dash: {
      id: 'wing_dash',
      name: 'スカイウイング突撃',
      category: '飛行・突進技',
      element: 'none',
      color: '#06b6d4',
      description: '翼を広げて斜め上へ高速突進！攻撃と復帰を同時にこなす万能技！',
      power: clamp(powerBase + 2, 17, 32),
      cooldown: 3.5,
    },
    quake: {
      id: 'quake',
      name: 'ドッスン大地震',
      category: '地震・衝撃波',
      element: 'none',
      color: '#92400e',
      description: '巨体を叩きつけて左右に衝撃波を発生させ、周囲の敵をまとめて弾き飛ばす！',
      power: clamp(powerBase + 5, 19, 35),
      cooldown: 4.8,
    },
    rapid: {
      id: 'rapid',
      name: 'マッハ連続ラッシュ',
      category: '連続攻撃・高速移動',
      element: 'none',
      color: '#22c55e',
      description: '目にも留まらぬスピードで踏み込み、連続ヒットの嵐を叩き込む！',
      power: clamp(powerBase + 1, 16, 31),
      cooldown: 3.3,
    },
    ink_wave: {
      id: 'ink_wave',
      name: 'インクウェーブ',
      category: 'バランス波動',
      element: 'none',
      color: playerColor || '#6366f1',
      description: '描き立てのインクを波動に変えて前方に放つ、クセのない頼れる必殺技！',
      power: clamp(powerBase + 2, 17, 32),
      cooldown: 3.7,
    },
  };

  // Pick the most iconic special matching the character's standout features
  if (flags.wings && !flags.weapon) {
    if (dominantElement === 'fire' && flags.horns) return catalog.fire;
    return catalog.wing_dash;
  }
  if (flags.weapon) {
    if (dominantElement === 'fire' && flags.fireStrong) return catalog.fire;
    if (dominantElement === 'lightning' && flags.lightningStrong) return catalog.lightning;
    return flags.bluntWeapon || flags.big ? catalog.strike : catalog.slash;
  }
  if (dominantElement === 'fire') return catalog.fire;
  if (dominantElement === 'lightning') return catalog.lightning;
  if (dominantElement === 'ice') return catalog.ice;
  if (dominantElement === 'star') return catalog.star;
  if (flags.wings) return catalog.wing_dash;
  if (flags.big) return catalog.quake;
  if (flags.horns) return catalog.strike;
  if (flags.small) return catalog.rapid;
  if (flags.long_legs && stats.speed >= 72) return catalog.rapid;
  return catalog.ink_wave;
}

function chooseArchetype(flags, dominantElement, specialId) {
  if (flags.wings && dominantElement === 'fire') return '紅蓮の翼竜ファイター';
  if (flags.wings && flags.small) return '翼のちびスピードスター';
  if (flags.wings) return '翼のスピードスター';
  if (flags.weapon && flags.big) return '剛腕の重装剣士';
  if (flags.weapon && flags.small) return '電光のちび剣士';
  if (flags.weapon && dominantElement === 'lightning') return '雷鳴のウェポンマスター';
  if (flags.weapon) return '剛腕の剣士';
  if (flags.big && flags.round) return '鉄壁の巨大ボディ';
  if (flags.big) return 'ドッスン重量級タイタン';
  if (flags.round && dominantElement === 'ice') return '氷結の丸もちディフェンダー';
  if (flags.round) return '鉄壁の丸ボディ';
  if (flags.small && flags.long_legs) return '疾風のホッピングスター';
  if (flags.small) return 'ちょこまかスピードスター';
  if (flags.slender && flags.long_arms) return '超リーチの変幻トリックスター';
  if (flags.slender) return 'しなやかロングリーチャー';
  if (dominantElement === 'fire') return '燃え上がる炎の闘士';
  if (dominantElement === 'lightning') return 'バチバチ電撃ファイター';
  if (dominantElement === 'ice') return 'クールな氷結ファイター';
  if (dominantElement === 'star') return 'きらめく星屑アーティスト';
  if (flags.horns) return '突進ツノチャージャー';
  if (flags.long_arms) return '豪腕グラップラー';
  if (flags.long_legs) return '跳躍ランナー';
  if (specialId === 'ink_wave' && flags.simple) return '王道バランスファイター';
  return 'バランスファイター';
}

export function analyzeCharacter(strokes, playerColor = '#3b82f6') {
  const safeStrokes = Array.isArray(strokes) ? strokes : [];
  const raster = analyzeRaster(safeStrokes);

  // Fallback for empty / completely erased canvas
  if (!raster) {
    const defaultStats = {
      attack: 58,
      defense: 58,
      speed: 60,
      jump: 60,
      weight: 55,
      reach: 56,
      grabPower: 56,
      airJumps: 1,
      scale: 1.0,
      aspectRatio: 1.25,
      strokeCount: 0,
      inkAmount: 0,
      bounds: { minX: 0.25, minY: 0.2, maxX: 0.75, maxY: 0.85, width: 0.5, height: 0.65 },
      traits: [
        { id: 'simple', label: 'シンプル構造', icon: '✏️', effect: 'クセがなく扱いやすい万能タイプ' },
        { id: 'balanced', label: 'バランス型', icon: '⚖️', effect: '全能力が均等にまとまっている' },
      ],
      archetype: 'バランスファイター',
      specialMove: chooseSpecialMove({}, 'none', { attack: 58, speed: 60 }, playerColor),
    };
    return defaultStats;
  }

  const { bounds, colors } = raster;
  const boxArea = bounds.width * bounds.height;
  const maxSpan = Math.max(bounds.width, bounds.height);
  const aspectRatio = Number((bounds.height / Math.max(0.06, bounds.width)).toFixed(2));
  const geom = analyzeGeometry(safeStrokes, bounds, raster.centroidX, raster.centroidY);

  // Color / element distribution (relative to chromatic ink so black outlines don't mask colors)
  const totalPx = Math.max(1, raster.filledPixels);
  const darkRatio = colors.dark / totalPx;
  const chromaRatio = colors.chromatic / totalPx;
  const chromaBase = Math.max(1, colors.chromatic);

  const fireScore = chromaRatio >= 0.1 ? colors.fire / chromaBase : 0;
  const lightningScore = chromaRatio >= 0.1 ? colors.lightning / chromaBase : 0;
  const iceScore = chromaRatio >= 0.1 ? colors.ice / chromaBase : 0;
  const starScore =
    chromaRatio >= 0.1
      ? (colors.star + (colors.yellow > 4 && colors.pink > 4 ? colors.bright * 0.45 : 0)) / chromaBase
      : 0;
  const natureScore = chromaRatio >= 0.1 ? colors.nature / chromaBase : 0;

  let dominantElement = 'none';
  const elemEntries = [
    ['fire', fireScore],
    ['lightning', lightningScore],
    ['ice', iceScore],
    ['star', starScore],
  ].sort((a, b) => b[1] - a[1]);

  if (elemEntries[0][1] >= 0.34 && chromaRatio >= 0.14) {
    dominantElement = elemEntries[0][0];
  }

  // Feature flags (calibrated for hand-drawn 0..1 sketchbook proportions)
  const isBig = boxArea >= 0.52 || (maxSpan >= 0.8 && boxArea >= 0.46);
  const isSmall = !isBig && (boxArea <= 0.25 || maxSpan <= 0.52);
  const isSlender = aspectRatio >= 1.5 && bounds.width <= 0.46;
  // Require separated feet all the way to the very bottom edge so hollow ovals register as round, not legs
  const hasOpenBottomLegs = raster.bottomEdgeSplitRatio >= 0.6;
  const isLongLegs =
    (hasOpenBottomLegs && raster.lowerSplitRatio >= 0.45 && bounds.height >= 0.48) ||
    (hasOpenBottomLegs && geom.longLegStrokes >= 2 && bounds.height >= 0.5);
  const isRound =
    !isSlender &&
    !isLongLegs &&
    aspectRatio >= 0.72 &&
    aspectRatio <= 1.38 &&
    raster.silhouetteFill >= 0.58;
  const isLongArms =
    (raster.midMaxSpanRatio >= 1.65 && bounds.width >= 0.54) ||
    (geom.longArmStrokes >= 2 && bounds.width >= 0.56);
  const isWeapon = geom.weaponScore >= 0.36;
  const isWings =
    ((raster.wingLeftRatio >= 0.16 &&
      raster.wingRightRatio >= 0.16 &&
      raster.wingSymmetry >= 0.56 &&
      raster.wingVerticalCoverage >= 0.22 &&
      raster.upperVsLowerSpan >= 1.48) ||
      (geom.hasSymWingStrokes &&
        raster.wingSymmetry >= 0.55 &&
        raster.wingVerticalCoverage >= 0.2 &&
        bounds.width >= 0.58)) &&
    !isSlender &&
    !isRound;
  const isHorns =
    (raster.topSplitRatio >= 0.24 && raster.topVsHeadSpan <= 0.88) ||
    (geom.hornStrokes >= 2 && bounds.height >= 0.45);
  const isDetailed = geom.strokeCount >= 16 || geom.totalInkLength >= 4.8;
  const isSimple = geom.strokeCount <= 6 && geom.totalInkLength <= 2.6;
  const isHeavyDark = darkRatio >= 0.68 && chromaRatio < 0.18;
  const isNature = natureScore >= 0.4 && chromaRatio >= 0.14;

  const flags = {
    big: isBig,
    small: isSmall,
    slender: isSlender,
    round: isRound,
    long_legs: isLongLegs,
    long_arms: isLongArms,
    weapon: isWeapon,
    bluntWeapon: geom.bluntWeaponHint,
    wings: isWings,
    horns: isHorns,
    detailed: isDetailed,
    simple: isSimple,
    fireStrong: fireScore >= 0.55,
    lightningStrong: lightningScore >= 0.55,
  };

  // Start from balanced baseline
  let attack = 54;
  let defense = 54;
  let speed = 56;
  let jump = 56;
  let weight = 54;
  let reach = 54;
  let grabPower = 54;

  // Continuous size & ink influences
  const sizeNorm = clamp((boxArea - 0.36) / 0.32, -1, 1);
  attack += sizeNorm * 7;
  weight += sizeNorm * 13;
  defense += sizeNorm * 6;
  speed -= sizeNorm * 9;
  jump -= sizeNorm * 5;
  reach += clamp((maxSpan - 0.58) * 16, -6, 9);

  // Discrete shape / part bonuses
  if (isBig) {
    attack += 12;
    weight += 15;
    defense += 9;
    speed -= 10;
    jump -= 6;
    grabPower += 7;
  }
  if (isSmall) {
    speed += 15;
    jump += 10;
    weight -= 14;
    defense -= 6;
    reach -= 5;
  }
  if (isSlender) {
    reach += 13;
    speed += 6;
    weight -= 10;
    defense -= 5;
  }
  if (isRound) {
    defense += 16;
    weight += 11;
    speed -= 3;
    grabPower += 4;
  }
  if (isLongLegs) {
    speed += 10;
    jump += 13;
    reach += 4;
  }
  if (isLongArms) {
    reach += 14;
    grabPower += 16;
    attack += 4;
  }
  if (isWeapon) {
    attack += 15;
    reach += 14;
    defense -= 3;
  }
  if (isWings) {
    jump += 16;
    speed += 8;
    weight -= 7;
  }
  if (isHorns) {
    attack += 8;
    grabPower += 5;
    speed += 2;
  }

  // Color personality bonuses
  if (dominantElement === 'fire') {
    attack += 9;
    speed += 3;
  } else if (dominantElement === 'lightning') {
    speed += 10;
    attack += 5;
  } else if (dominantElement === 'ice') {
    defense += 7;
    reach += 6;
  } else if (dominantElement === 'star') {
    jump += 8;
    speed += 6;
    attack += 4;
  } else if (isNature) {
    defense += 5;
    speed += 5;
    jump += 5;
  } else if (isHeavyDark) {
    weight += 11;
    defense += 10;
    attack += 5;
    speed -= 4;
  }

  // Stroke count specialization vs simplicity
  if (isDetailed) {
    // Exaggerate top 2 strengths slightly for distinct specialized builds
    const pairs = [
      ['attack', attack],
      ['defense', defense],
      ['speed', speed],
      ['jump', jump],
      ['reach', reach],
    ].sort((a, b) => b[1] - a[1]);
    const topKey = pairs[0][0];
    if (topKey === 'attack') attack += 7;
    if (topKey === 'defense') defense += 7;
    if (topKey === 'speed') speed += 7;
    if (topKey === 'jump') jump += 7;
    if (topKey === 'reach') reach += 7;
  } else if (isSimple) {
    // Smooth stats gently toward well-rounded high floor
    attack = attack * 0.78 + 64 * 0.22;
    defense = defense * 0.78 + 64 * 0.22;
    speed = speed * 0.78 + 64 * 0.22;
    jump = jump * 0.78 + 64 * 0.22;
    weight = weight * 0.8 + 58 * 0.2;
    reach = reach * 0.8 + 60 * 0.2;
    grabPower = grabPower * 0.8 + 60 * 0.2;
  }

  const finalStats = {
    attack: roundInt(attack, 30, 98),
    defense: roundInt(defense, 30, 98),
    speed: roundInt(speed, 32, 92),
    jump: roundInt(jump, 35, 96),
    weight: roundInt(weight, 30, 98),
    reach: roundInt(reach, 35, 98),
    grabPower: roundInt(grabPower, 35, 98),
  };

  let airJumps = 1;
  if (isWings) {
    airJumps = finalStats.weight <= 58 || finalStats.jump >= 78 ? 3 : 2;
  } else if (isSmall || finalStats.jump >= 82) {
    airJumps = 2;
  }

  const rawScale = 0.78 + Math.sqrt(clamp(boxArea, 0.04, 0.78)) * 0.52;
  const scale = Number(clamp(rawScale, 0.78, 1.32).toFixed(2));

  // Build 2..5 clear Japanese trait badges
  const traits = [];
  const pushTrait = (id, label, icon, effect) => {
    if (traits.length < 5 && !traits.some((t) => t.id === id)) {
      traits.push({ id, label, icon, effect });
    }
  };

  if (isWeapon) pushTrait('weapon', '武器持ち', '⚔️', '攻撃力とリーチが大きくアップ');
  if (isWings) pushTrait('wings', '翼あり', '🪽', `空中ジャンプ${airJumps}回＆高い復帰力`);
  if (isBig) pushTrait('big', 'ビッグサイズ', '🦣', '重い一撃と圧倒的な吹っ飛び耐性');
  if (isSmall) pushTrait('small', 'スモールボディ', '⚡', '素早い機動力と回避力');
  if (isRound) pushTrait('round', 'まんまるボディ', '🛡️', '高い防御力とノックバック耐性');
  if (isSlender) pushTrait('slender', 'スリム体型', '🎋', '長いリーチと軽快なフットワーク');
  if (isLongLegs) pushTrait('long_legs', 'ながい脚', '🦵', '移動速度とジャンプ力がアップ');
  if (isLongArms) pushTrait('long_arms', 'ながい腕', '💪', '広いリーチと強力なつかみ投げ');
  if (isHorns) pushTrait('horns', 'ツノ・トゲ', '😈', '攻撃力と突進パワーが上昇');

  if (dominantElement === 'fire') pushTrait('fire', '炎カラー', '🔥', '熱い闘志で攻撃力アップ');
  else if (dominantElement === 'lightning') pushTrait('lightning', '雷カラー', '⚡', '電撃スピードで素早さアップ');
  else if (dominantElement === 'ice') pushTrait('ice', '氷カラー', '❄️', 'クールな防御とリーチ強化');
  else if (dominantElement === 'star') pushTrait('star', 'スターカラー', '⭐', '軽やかな跳躍とキラメキ技');
  else if (isHeavyDark) pushTrait('steel', '鋼のインク', '🪨', '重厚ボディで吹っ飛びにくい');
  else if (isNature) pushTrait('nature', 'ネイチャー色', '🌿', 'しなやかなバランス補正');

  if (isDetailed) pushTrait('detailed', '描き込み職人', '🎨', '長所がさらに尖った特化型');
  else if (isSimple) pushTrait('simple', 'シンプル構造', '✏️', '扱いやすい堅実バランス型');

  if (traits.length < 2) {
    pushTrait('balanced', 'バランス型', '⚖️', 'どんな戦況にも対応できる万能タイプ');
  }
  if (traits.length < 2) {
    pushTrait('handdrawn', '手描き魂', '🖍️', '勢いあるインクパワーを秘めている');
  }

  const specialMove = chooseSpecialMove(flags, dominantElement, finalStats, playerColor);
  const archetype = chooseArchetype(flags, dominantElement, specialMove.id);

  return {
    ...finalStats,
    airJumps,
    scale,
    aspectRatio,
    strokeCount: geom.strokeCount,
    inkAmount: Number(clamp(raster.inkRatio * 10, 0, 10).toFixed(2)),
    bounds,
    traits,
    archetype,
    specialMove,
  };
}

// ============================================================
// Procedural Hand-Drawn CPU Character Generator
// ============================================================

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildSketchHelper(rng, scale = 1, offsetX = 0, offsetY = 0) {
  const strokes = [];
  let seq = 0;

  const transform = (x, y, jitterAmt = 0.006) => {
    const sx = 0.5 + (x - 0.5) * scale + offsetX + (rng() - 0.5) * jitterAmt;
    const sy = 0.5 + (y - 0.5) * scale + offsetY + (rng() - 0.5) * jitterAmt;
    return [round4(clamp01(sx)), round4(clamp01(sy))];
  };

  const line = (x1, y1, x2, y2, color, width = 7, segments = 6, jitter = 0.007) => {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const lx = x1 + (x2 - x1) * t;
      const ly = y1 + (y2 - y1) * t;
      pts.push(transform(lx, ly, i === 0 || i === segments ? jitter * 0.5 : jitter));
    }
    strokes.push({ id: `cpu_${++seq}`, tool: 'pen', color, width, points: pts });
  };

  const poly = (rawPts, color, width = 7, jitter = 0.006) => {
    const pts = [];
    for (let i = 0; i < rawPts.length; i++) {
      const curr = rawPts[i];
      if (i > 0) {
        const prev = rawPts[i - 1];
        const midX = (prev[0] + curr[0]) * 0.5;
        const midY = (prev[1] + curr[1]) * 0.5;
        pts.push(transform(midX, midY, jitter));
      }
      pts.push(transform(curr[0], curr[1], jitter * 0.7));
    }
    strokes.push({ id: `cpu_${++seq}`, tool: 'pen', color, width, points: pts });
  };

  const oval = (cx, cy, rx, ry, color, width = 7, steps = 16, startAngle = 0, endAngle = Math.PI * 2 + 0.15) => {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = startAngle + ((endAngle - startAngle) * i) / steps;
      const x = cx + Math.cos(a) * rx;
      const y = cy + Math.sin(a) * ry;
      pts.push(transform(x, y, 0.006));
    }
    strokes.push({ id: `cpu_${++seq}`, tool: 'pen', color, width, points: pts });
  };

  const dot = (x, y, color, width = 7) => {
    strokes.push({ id: `cpu_${++seq}`, tool: 'pen', color, width, points: [transform(x, y, 0.003)] });
  };

  return { strokes, line, poly, oval, dot };
}

const ALL_CPU_THEMES = [
  'swordsman', 'dragon', 'wizard', 'ninja', 'samurai', 'pirate', 'hero', 'knight', 'angel', 'devil', 'slime', 'oni',
  'robot', 'alien', 'tank', 'ufo',
  'animal', 'dinosaur', 'cat', 'shark', 'penguin', 'beetle', 'octopus',
  'food', 'ramen', 'sushi', 'burger', 'icecream', 'banana',
  'weird', 'ghost', 'snowman', 'cactus', 'macho', 'sumo', 'daruma',
];

function normalizeThemeKey(themeId) {
  const raw = String(themeId || '').toLowerCase().trim();
  const map = {
    // バトル・ファンタジー
    swordsman: 'swordsman', 剣士: 'swordsman',
    dragon: 'dragon', ドラゴン: 'dragon',
    wizard: 'wizard', 魔法使い: 'wizard', mage: 'wizard',
    ninja: 'ninja', 忍者: 'ninja',
    samurai: 'samurai', 侍: 'samurai',
    pirate: 'pirate', 海賊: 'pirate',
    hero: 'hero', ヒーロー: 'hero',
    knight: 'knight', 騎士: 'knight',
    angel: 'angel', 天使: 'angel',
    devil: 'devil', 悪魔: 'devil', demon: 'devil',
    slime: 'slime', スライム: 'slime',
    oni: 'oni', 赤鬼: 'oni', 鬼: 'oni',
    // メカ・SF
    robot: 'robot', ロボット: 'robot', mech: 'robot',
    alien: 'alien', 宇宙人: 'alien',
    tank: 'tank', 戦車: 'tank',
    ufo: 'ufo',
    // 生き物
    animal: 'animal', 動物: 'animal',
    dinosaur: 'dinosaur', 恐竜: 'dinosaur', dino: 'dinosaur',
    cat: 'cat', ネコ: 'cat', 猫: 'cat',
    shark: 'shark', サメ: 'shark', 鮫: 'shark',
    penguin: 'penguin', ペンギン: 'penguin',
    beetle: 'beetle', カブトムシ: 'beetle',
    octopus: 'octopus', タコ: 'octopus', 蛸: 'octopus',
    // 食べ物
    food: 'food', 食べ物: 'food', onigiri: 'food',
    ramen: 'ramen', ラーメン: 'ramen',
    sushi: 'sushi', おすし: 'sushi', 寿司: 'sushi',
    burger: 'burger', ハンバーガー: 'burger',
    icecream: 'icecream', ソフトクリーム: 'icecream', アイス: 'icecream',
    banana: 'banana', バナナ: 'banana',
    // ゆるキャラ・ネタ
    weird: 'weird', 変な生き物: 'weird', monster: 'weird',
    ghost: 'ghost', おばけ: 'ghost',
    snowman: 'snowman', 雪だるま: 'snowman',
    cactus: 'cactus', サボテン: 'cactus',
    macho: 'macho', マッチョ: 'macho',
    sumo: 'sumo', お相撲さん: 'sumo', 相撲: 'sumo',
    daruma: 'daruma', だるま: 'daruma',
  };
  if (map[raw]) return map[raw];
  for (const [k, v] of Object.entries(map)) {
    if (raw.includes(k)) return v;
  }
  return ALL_CPU_THEMES[Math.floor(Math.random() * ALL_CPU_THEMES.length)];
}

export function generateCPUCharacter(themeId, color = '#3b82f6') {
  const key = normalizeThemeKey(themeId);
  const seed = Math.floor(Math.random() * 1e9) ^ Date.now();
  const rng = makeRng(seed);
  const ink = '#1f2937';
  const main = color || DRAW_PALETTE[6] || '#3b82f6';

  const bigSet = new Set(['robot', 'tank', 'sumo', 'oni', 'macho', 'dinosaur', 'dragon']);
  const smallSet = new Set(['ninja', 'cat', 'slime', 'penguin']);
  const themeScaleBias = bigSet.has(key)
    ? 1.08
    : smallSet.has(key)
      ? 0.78
      : key === 'daruma' || key === 'burger' || key === 'snowman'
        ? 0.94
        : 0.95;

  const scale = themeScaleBias + rng() * 0.06;
  const ox = (rng() - 0.5) * 0.03;
  const oy = (rng() - 0.5) * 0.025;
  const sk = buildSketchHelper(rng, scale, ox, oy);

  switch (key) {
    // ================= バトル・ファンタジー =================
    case 'swordsman': {
      sk.oval(0.44, 0.25, 0.1, 0.1, ink, 7, 14);
      sk.line(0.34, 0.21, 0.54, 0.2, '#ef4444', 6, 4);
      sk.poly([[0.34, 0.21], [0.24, 0.26], [0.2, 0.23]], '#ef4444', 5);
      sk.dot(0.41, 0.25, ink, 6);
      sk.dot(0.49, 0.25, ink, 6);
      sk.line(0.42, 0.3, 0.49, 0.29, ink, 4, 3);
      sk.poly([[0.36, 0.36], [0.52, 0.36], [0.55, 0.64], [0.33, 0.64], [0.36, 0.36]], main, 8);
      sk.poly([[0.35, 0.38], [0.2, 0.54], [0.26, 0.66], [0.34, 0.58]], main, 6);
      sk.line(0.39, 0.64, 0.33, 0.87, ink, 8, 5);
      sk.line(0.49, 0.64, 0.55, 0.87, ink, 8, 5);
      sk.line(0.36, 0.44, 0.27, 0.52, ink, 7, 4);
      sk.line(0.52, 0.44, 0.64, 0.48, ink, 7, 4);
      sk.line(0.61, 0.53, 0.69, 0.44, '#eab308', 8, 3);
      sk.line(0.65, 0.48, 0.88, 0.16, '#06b6d4', 9, 8, 0.003);
      sk.line(0.65, 0.48, 0.88, 0.16, ink, 4, 8, 0.003);
      break;
    }

    case 'dragon': {
      sk.poly([[0.44, 0.22], [0.38, 0.09], [0.48, 0.18]], '#f97316', 7);
      sk.poly([[0.56, 0.22], [0.62, 0.09], [0.52, 0.18]], '#f97316', 7);
      sk.oval(0.5, 0.27, 0.11, 0.09, '#ef4444', 8, 14);
      sk.dot(0.46, 0.26, '#eab308', 6);
      sk.dot(0.54, 0.26, '#eab308', 6);
      sk.oval(0.5, 0.53, 0.14, 0.18, '#ef4444', 9, 16);
      sk.line(0.46, 0.48, 0.54, 0.48, '#f97316', 6, 3);
      sk.line(0.45, 0.56, 0.55, 0.56, '#f97316', 6, 3);
      sk.poly([[0.38, 0.42], [0.16, 0.24], [0.12, 0.44], [0.22, 0.52], [0.36, 0.52]], '#ef4444', 8);
      sk.poly([[0.62, 0.42], [0.84, 0.24], [0.88, 0.44], [0.78, 0.52], [0.64, 0.52]], '#ef4444', 8);
      sk.line(0.34, 0.45, 0.18, 0.36, '#f97316', 5, 3);
      sk.line(0.66, 0.45, 0.82, 0.36, '#f97316', 5, 3);
      sk.line(0.42, 0.69, 0.38, 0.86, '#ef4444', 9, 4);
      sk.line(0.58, 0.69, 0.62, 0.86, '#ef4444', 9, 4);
      sk.poly([[0.61, 0.66], [0.76, 0.72], [0.84, 0.64]], '#f97316', 7);
      break;
    }

    case 'wizard': {
      sk.poly([[0.32, 0.3], [0.5, 0.08], [0.64, 0.3]], '#8b5cf6', 8);
      sk.line(0.26, 0.3, 0.69, 0.3, '#8b5cf6', 8, 5);
      sk.dot(0.48, 0.2, '#eab308', 7);
      sk.oval(0.48, 0.38, 0.08, 0.07, ink, 6, 12);
      sk.dot(0.45, 0.38, '#eab308', 6);
      sk.dot(0.52, 0.38, '#eab308', 6);
      sk.poly([[0.4, 0.45], [0.56, 0.45], [0.63, 0.84], [0.33, 0.84], [0.4, 0.45]], '#3b82f6', 8);
      sk.line(0.56, 0.55, 0.72, 0.5, ink, 6, 3);
      sk.line(0.7, 0.78, 0.83, 0.24, '#92400e', 7, 7, 0.003);
      sk.dot(0.84, 0.21, '#eab308', 13);
      sk.dot(0.84, 0.21, '#ec4899', 6);
      break;
    }

    case 'ninja': {
      sk.oval(0.48, 0.34, 0.09, 0.09, ink, 8, 14);
      sk.line(0.42, 0.33, 0.54, 0.33, '#f97316', 6, 3);
      sk.dot(0.45, 0.33, ink, 5);
      sk.dot(0.52, 0.33, ink, 5);
      sk.poly([[0.42, 0.43], [0.54, 0.43], [0.24, 0.47], [0.18, 0.42]], '#ef4444', 7);
      sk.poly([[0.43, 0.44], [0.55, 0.44], [0.57, 0.63], [0.4, 0.63], [0.43, 0.44]], ink, 8);
      sk.poly([[0.43, 0.63], [0.35, 0.72], [0.39, 0.82]], ink, 8);
      sk.poly([[0.54, 0.63], [0.64, 0.71], [0.59, 0.82]], ink, 8);
      sk.line(0.55, 0.5, 0.76, 0.45, '#06b6d4', 7, 5, 0.003);
      break;
    }

    case 'samurai': {
      // Kabuto helmet with golden crescent horns + long katana
      sk.poly([[0.33, 0.24], [0.45, 0.16], [0.57, 0.24]], ink, 8);
      sk.poly([[0.45, 0.18], [0.31, 0.08]], '#eab308', 7);
      sk.poly([[0.45, 0.18], [0.59, 0.08]], '#eab308', 7);
      sk.oval(0.45, 0.28, 0.09, 0.08, ink, 7, 12);
      sk.dot(0.42, 0.28, ink, 5);
      sk.dot(0.49, 0.28, ink, 5);
      // Armored haori & hakama
      sk.poly([[0.34, 0.38], [0.56, 0.38], [0.58, 0.62], [0.32, 0.62], [0.34, 0.38]], '#ef4444', 8);
      sk.line(0.35, 0.47, 0.55, 0.47, '#eab308', 5, 3);
      sk.line(0.34, 0.55, 0.56, 0.55, '#eab308', 5, 3);
      sk.poly([[0.34, 0.62], [0.28, 0.86], [0.42, 0.86], [0.45, 0.68], [0.48, 0.86], [0.62, 0.86], [0.56, 0.62]], ink, 8);
      // Long katana held up-right
      sk.line(0.55, 0.48, 0.66, 0.52, ink, 7, 3);
      sk.line(0.62, 0.56, 0.7, 0.48, '#eab308', 7, 2);
      sk.line(0.66, 0.51, 0.9, 0.14, ink, 7, 8, 0.002);
      break;
    }

    case 'pirate': {
      // Tricorn pirate hat with skull dot, eyepatch, striped coat & cutlass
      sk.poly([[0.24, 0.23], [0.46, 0.1], [0.66, 0.23], [0.24, 0.23]], ink, 8);
      sk.dot(0.46, 0.18, '#eab308', 7);
      sk.oval(0.45, 0.3, 0.1, 0.09, ink, 7, 14);
      sk.line(0.36, 0.27, 0.54, 0.31, ink, 4, 3); // eyepatch strap
      sk.dot(0.41, 0.29, ink, 8); // eyepatch
      sk.dot(0.5, 0.3, ink, 5);
      sk.poly([[0.35, 0.39], [0.55, 0.39], [0.58, 0.65], [0.32, 0.65], [0.35, 0.39]], '#ef4444', 8);
      sk.line(0.35, 0.48, 0.55, 0.48, ink, 5, 3);
      sk.line(0.34, 0.56, 0.56, 0.56, '#eab308', 6, 3);
      // Hook hand on left + cutlass on right
      sk.poly([[0.33, 0.46], [0.21, 0.49], [0.18, 0.42], [0.23, 0.39]], ink, 6);
      sk.line(0.56, 0.48, 0.68, 0.49, ink, 7, 3);
      sk.line(0.67, 0.49, 0.89, 0.2, '#06b6d4', 8, 7, 0.003);
      // Peg leg + boot
      sk.line(0.39, 0.66, 0.36, 0.87, '#92400e', 7, 4);
      sk.line(0.52, 0.66, 0.57, 0.87, ink, 8, 4);
      break;
    }

    case 'hero': {
      // Masked superhero with spiky crest, chest star & billowing cape
      sk.oval(0.5, 0.25, 0.1, 0.1, '#ef4444', 8, 14);
      sk.line(0.41, 0.24, 0.59, 0.24, '#eab308', 7, 3); // mask visor
      sk.poly([[0.43, 0.16], [0.5, 0.08], [0.57, 0.16]], '#eab308', 6);
      // Cape billowing wide behind
      sk.poly([[0.41, 0.37], [0.16, 0.45], [0.14, 0.7], [0.35, 0.66]], '#ef4444', 7);
      // Heroic torso + yellow star emblem
      sk.poly([[0.38, 0.36], [0.62, 0.36], [0.57, 0.64], [0.43, 0.64], [0.38, 0.36]], '#3b82f6', 8);
      sk.dot(0.5, 0.48, '#eab308', 11);
      // Power fist raised high!
      sk.line(0.62, 0.41, 0.78, 0.19, '#ef4444', 8, 5);
      sk.dot(0.79, 0.18, '#eab308', 10);
      sk.line(0.38, 0.43, 0.29, 0.54, '#3b82f6', 7, 3);
      // Heroic stance legs
      sk.line(0.45, 0.64, 0.37, 0.87, '#ef4444', 8, 4);
      sk.line(0.55, 0.64, 0.65, 0.87, '#ef4444', 8, 4);
      break;
    }

    case 'knight': {
      // Visor helm + plume + big shield on left + long lance on right
      sk.poly([[0.48, 0.18], [0.43, 0.08], [0.56, 0.11]], '#ef4444', 7); // plume
      sk.poly([[0.39, 0.19], [0.57, 0.19], [0.57, 0.35], [0.39, 0.35], [0.39, 0.19]], ink, 8);
      sk.line(0.42, 0.27, 0.54, 0.27, '#06b6d4', 5, 3); // visor slit
      // Armor torso
      sk.poly([[0.37, 0.37], [0.59, 0.37], [0.59, 0.66], [0.37, 0.66], [0.37, 0.37]], '#3b82f6', 9);
      // Shield on left
      sk.poly([[0.21, 0.41], [0.36, 0.41], [0.36, 0.62], [0.28, 0.69], [0.21, 0.62], [0.21, 0.41]], '#eab308', 8);
      // Long straight lance/sword on right
      sk.line(0.59, 0.47, 0.7, 0.48, ink, 7, 3);
      sk.line(0.67, 0.53, 0.9, 0.15, ink, 8, 8, 0.002);
      sk.line(0.42, 0.66, 0.39, 0.87, ink, 9, 4);
      sk.line(0.54, 0.66, 0.58, 0.87, ink, 9, 4);
      break;
    }

    case 'angel': {
      // Glowing halo + wide symmetrical feathered wings + light cyan/gold robe
      sk.oval(0.5, 0.11, 0.1, 0.032, '#eab308', 6, 12);
      sk.oval(0.5, 0.25, 0.095, 0.095, '#06b6d4', 7, 14);
      sk.dot(0.46, 0.24, ink, 5);
      sk.dot(0.54, 0.24, ink, 5);
      sk.poly([[0.46, 0.3], [0.5, 0.32], [0.54, 0.3]], '#ec4899', 4);
      // Big fluffy symmetrical wings!
      sk.poly([[0.4, 0.39], [0.16, 0.22], [0.1, 0.41], [0.16, 0.56], [0.35, 0.55]], '#06b6d4', 8);
      sk.poly([[0.6, 0.39], [0.84, 0.22], [0.9, 0.41], [0.84, 0.56], [0.65, 0.55]], '#06b6d4', 8);
      sk.line(0.34, 0.42, 0.16, 0.37, '#eab308', 5, 3);
      sk.line(0.66, 0.42, 0.84, 0.37, '#eab308', 5, 3);
      // Flowing robe
      sk.poly([[0.42, 0.36], [0.58, 0.36], [0.64, 0.81], [0.36, 0.81], [0.42, 0.36]], '#3b82f6', 7);
      sk.line(0.45, 0.81, 0.44, 0.88, '#eab308', 6, 2);
      sk.line(0.55, 0.81, 0.56, 0.88, '#eab308', 6, 2);
      break;
    }

    case 'devil': {
      // Twin red horns + symmetrical bat wings + grinning devil + pointed tail
      sk.poly([[0.43, 0.2], [0.36, 0.08], [0.47, 0.16]], '#ef4444', 7);
      sk.poly([[0.57, 0.2], [0.64, 0.08], [0.53, 0.16]], '#ef4444', 7);
      sk.oval(0.5, 0.27, 0.1, 0.09, '#8b5cf6', 8, 14);
      sk.dot(0.46, 0.26, '#eab308', 6);
      sk.dot(0.54, 0.26, '#eab308', 6);
      sk.poly([[0.44, 0.32], [0.5, 0.34], [0.56, 0.32]], '#ef4444', 5);
      // Symmetrical jagged bat wings
      sk.poly([[0.4, 0.42], [0.15, 0.25], [0.12, 0.5], [0.22, 0.46], [0.3, 0.54], [0.39, 0.53]], '#ef4444', 8);
      sk.poly([[0.6, 0.42], [0.85, 0.25], [0.88, 0.5], [0.78, 0.46], [0.7, 0.54], [0.61, 0.53]], '#ef4444', 8);
      // Body & legs + arrow tail
      sk.poly([[0.41, 0.37], [0.59, 0.37], [0.57, 0.67], [0.43, 0.67], [0.41, 0.37]], '#8b5cf6', 8);
      sk.line(0.44, 0.67, 0.39, 0.86, '#8b5cf6', 8, 4);
      sk.line(0.56, 0.67, 0.61, 0.86, '#8b5cf6', 8, 4);
      sk.poly([[0.58, 0.64], [0.75, 0.7], [0.82, 0.6]], '#ef4444', 6);
      break;
    }

    case 'slime': {
      // Cute plump squishy round teardrop slime blob!
      sk.poly(
        [
          [0.5, 0.2],
          [0.64, 0.36],
          [0.78, 0.58],
          [0.74, 0.76],
          [0.5, 0.8],
          [0.26, 0.76],
          [0.22, 0.58],
          [0.36, 0.36],
          [0.5, 0.2],
        ],
        '#06b6d4',
        10
      );
      sk.oval(0.5, 0.58, 0.2, 0.14, '#3b82f6', 7, 14);
      sk.dot(0.41, 0.54, ink, 9);
      sk.dot(0.59, 0.54, ink, 9);
      sk.dot(0.34, 0.6, '#ec4899', 7);
      sk.dot(0.66, 0.6, '#ec4899', 7);
      sk.poly([[0.44, 0.64], [0.5, 0.68], [0.56, 0.64]], ink, 5);
      break;
    }

    case 'oni': {
      // Big burly red Oni with yellow horns, tiger pants & thick iron club (kanabo)
      sk.poly([[0.41, 0.2], [0.36, 0.08], [0.46, 0.17]], '#eab308', 8);
      sk.poly([[0.55, 0.2], [0.6, 0.08], [0.5, 0.17]], '#eab308', 8);
      sk.oval(0.48, 0.27, 0.12, 0.1, '#ef4444', 9, 14);
      sk.dot(0.43, 0.26, ink, 7);
      sk.dot(0.53, 0.26, ink, 7);
      sk.poly([[0.42, 0.32], [0.48, 0.3], [0.54, 0.32]], ink, 5);
      // Huge burly red torso + tiger-stripe shorts
      sk.oval(0.48, 0.51, 0.2, 0.16, '#ef4444', 10, 16);
      sk.poly([[0.32, 0.59], [0.64, 0.59], [0.62, 0.72], [0.34, 0.72], [0.32, 0.59]], '#eab308', 9);
      sk.line(0.38, 0.62, 0.42, 0.7, ink, 5, 2);
      sk.line(0.52, 0.62, 0.56, 0.7, ink, 5, 2);
      // Heavy legs
      sk.line(0.4, 0.72, 0.36, 0.88, '#ef4444', 10, 4);
      sk.line(0.56, 0.72, 0.6, 0.88, '#ef4444', 10, 4);
      // Thick spiky kanabo iron club held up-right!
      sk.line(0.64, 0.48, 0.88, 0.16, ink, 14, 7, 0.003);
      sk.dot(0.79, 0.29, '#eab308', 6);
      sk.dot(0.85, 0.22, '#eab308', 6);
      break;
    }

    // ================= メカ・SF =================
    case 'robot': {
      sk.line(0.5, 0.1, 0.5, 0.19, '#eab308', 6, 3);
      sk.dot(0.5, 0.09, '#ef4444', 10);
      sk.poly([[0.36, 0.19], [0.64, 0.19], [0.64, 0.36], [0.36, 0.36], [0.36, 0.19]], ink, 8);
      sk.line(0.4, 0.27, 0.6, 0.27, '#eab308', 9, 4);
      sk.poly([[0.3, 0.38], [0.7, 0.38], [0.68, 0.67], [0.32, 0.67], [0.3, 0.38]], main, 9);
      sk.poly([[0.39, 0.45], [0.61, 0.45], [0.61, 0.58], [0.39, 0.58], [0.39, 0.45]], '#06b6d4', 6);
      sk.poly([[0.3, 0.43], [0.16, 0.47], [0.15, 0.58]], ink, 9);
      sk.poly([[0.7, 0.43], [0.84, 0.47], [0.85, 0.58]], ink, 9);
      sk.poly([[0.37, 0.67], [0.37, 0.85], [0.29, 0.86]], ink, 10);
      sk.poly([[0.63, 0.67], [0.63, 0.85], [0.71, 0.86]], ink, 10);
      break;
    }

    case 'alien': {
      sk.oval(0.5, 0.29, 0.15, 0.12, '#06b6d4', 8, 16);
      sk.oval(0.43, 0.3, 0.04, 0.055, ink, 6, 10);
      sk.oval(0.57, 0.3, 0.04, 0.055, ink, 6, 10);
      sk.line(0.42, 0.18, 0.35, 0.09, '#eab308', 6, 3);
      sk.dot(0.35, 0.09, '#eab308', 9);
      sk.line(0.58, 0.18, 0.65, 0.09, '#eab308', 6, 3);
      sk.dot(0.65, 0.09, '#eab308', 9);
      sk.poly([[0.43, 0.42], [0.57, 0.42], [0.55, 0.66], [0.45, 0.66], [0.43, 0.42]], '#06b6d4', 8);
      sk.line(0.43, 0.48, 0.2, 0.45, '#06b6d4', 7, 4);
      sk.line(0.57, 0.48, 0.8, 0.45, '#06b6d4', 7, 4);
      sk.line(0.46, 0.66, 0.4, 0.87, '#06b6d4', 7, 4);
      sk.line(0.54, 0.66, 0.6, 0.87, '#06b6d4', 7, 4);
      break;
    }

    case 'tank': {
      // Heavy armored green/ink tank with dome turret, cannon & treads
      sk.poly([[0.28, 0.32], [0.58, 0.32], [0.62, 0.5], [0.24, 0.5], [0.28, 0.32]], '#22c55e', 9);
      // Long straight cannon barrel pointing up-right!
      sk.line(0.58, 0.39, 0.9, 0.24, ink, 11, 7, 0.002);
      // Armored hull
      sk.poly([[0.16, 0.5], [0.76, 0.5], [0.8, 0.68], [0.14, 0.68], [0.16, 0.5]], '#22c55e', 10);
      sk.dot(0.43, 0.41, '#eab308', 8); // star emblem
      // Caterpillar treads + wheels
      sk.poly([[0.14, 0.68], [0.8, 0.68], [0.76, 0.84], [0.18, 0.84], [0.14, 0.68]], ink, 10);
      sk.oval(0.27, 0.76, 0.055, 0.055, '#eab308', 5, 10);
      sk.oval(0.47, 0.76, 0.055, 0.055, '#eab308', 5, 10);
      sk.oval(0.67, 0.76, 0.055, 0.055, '#eab308', 5, 10);
      break;
    }

    case 'ufo': {
      // Glowing flying saucer dome + tiny alien inside + tractor beam rays
      sk.oval(0.5, 0.35, 0.16, 0.13, '#06b6d4', 7, 14, Math.PI, Math.PI * 2);
      sk.oval(0.5, 0.33, 0.055, 0.06, '#22c55e', 7, 10); // tiny alien head
      sk.dot(0.48, 0.32, ink, 4);
      sk.dot(0.52, 0.32, ink, 4);
      // Wide metallic saucer ring with glowing yellow lights
      sk.oval(0.5, 0.46, 0.34, 0.11, '#8b5cf6', 9, 18);
      sk.dot(0.27, 0.46, '#eab308', 9);
      sk.dot(0.42, 0.49, '#eab308', 9);
      sk.dot(0.58, 0.49, '#eab308', 9);
      sk.dot(0.73, 0.46, '#eab308', 9);
      // Glowing yellow/cyan tractor beams below
      sk.line(0.38, 0.56, 0.28, 0.84, '#eab308', 6, 5);
      sk.line(0.5, 0.57, 0.5, 0.86, '#06b6d4', 6, 5);
      sk.line(0.62, 0.56, 0.72, 0.84, '#eab308', 6, 5);
      break;
    }

    // ================= 生き物 =================
    case 'animal': {
      sk.oval(0.5, 0.3, 0.14, 0.12, main, 8, 16);
      sk.poly([[0.38, 0.23], [0.34, 0.11], [0.45, 0.19]], main, 7);
      sk.poly([[0.62, 0.23], [0.66, 0.11], [0.55, 0.19]], main, 7);
      sk.dot(0.44, 0.29, ink, 7);
      sk.dot(0.56, 0.29, ink, 7);
      sk.poly([[0.46, 0.34], [0.5, 0.36], [0.54, 0.34]], ink, 5);
      sk.line(0.32, 0.3, 0.39, 0.31, ink, 4, 2);
      sk.line(0.61, 0.31, 0.68, 0.3, ink, 4, 2);
      sk.oval(0.5, 0.57, 0.19, 0.18, main, 9, 18);
      sk.oval(0.5, 0.58, 0.1, 0.1, '#f97316', 6, 12);
      sk.line(0.32, 0.53, 0.23, 0.49, main, 8, 3);
      sk.line(0.68, 0.53, 0.77, 0.49, main, 8, 3);
      sk.line(0.41, 0.74, 0.38, 0.86, main, 9, 3);
      sk.line(0.59, 0.74, 0.62, 0.86, main, 9, 3);
      sk.poly([[0.68, 0.65], [0.8, 0.61], [0.84, 0.48], [0.78, 0.42]], main, 7);
      break;
    }

    case 'dinosaur': {
      // Chunky green T-Rex with big jaws, back spikes, tiny arms & stomping tail
      sk.poly([[0.35, 0.18], [0.69, 0.16], [0.73, 0.31], [0.53, 0.33], [0.5, 0.4], [0.35, 0.37], [0.35, 0.18]], '#22c55e', 9);
      sk.dot(0.47, 0.23, ink, 7);
      sk.poly([[0.55, 0.32], [0.59, 0.28], [0.63, 0.32], [0.67, 0.28]], ink, 4); // teeth
      // Dorsal spikes along back
      sk.poly([[0.34, 0.25], [0.27, 0.27], [0.33, 0.35], [0.25, 0.4], [0.32, 0.49]], '#eab308', 6);
      // Big chunky dino belly + thick tail
      sk.oval(0.47, 0.55, 0.18, 0.17, '#22c55e', 10, 16);
      sk.poly([[0.31, 0.6], [0.14, 0.66], [0.26, 0.73], [0.4, 0.69]], '#22c55e', 9);
      // Tiny cute T-Rex arms
      sk.poly([[0.63, 0.49], [0.72, 0.51], [0.7, 0.56]], '#22c55e', 6);
      // Big stompy legs
      sk.line(0.42, 0.7, 0.39, 0.87, '#22c55e', 11, 4);
      sk.line(0.56, 0.7, 0.61, 0.87, '#22c55e', 11, 4);
      break;
    }

    case 'cat': {
      // Cute compact agile tabby cat with triangle ears, whiskers & curved tail
      sk.oval(0.5, 0.32, 0.13, 0.11, '#f97316', 8, 14);
      sk.poly([[0.39, 0.25], [0.35, 0.13], [0.46, 0.21]], '#f97316', 7);
      sk.poly([[0.61, 0.25], [0.65, 0.13], [0.54, 0.21]], '#f97316', 7);
      sk.dot(0.45, 0.31, ink, 6);
      sk.dot(0.55, 0.31, ink, 6);
      sk.poly([[0.46, 0.36], [0.5, 0.38], [0.54, 0.36]], '#ec4899', 4);
      sk.line(0.31, 0.31, 0.38, 0.33, ink, 3.5, 2);
      sk.line(0.31, 0.36, 0.38, 0.36, ink, 3.5, 2);
      sk.line(0.62, 0.33, 0.69, 0.31, ink, 3.5, 2);
      sk.line(0.62, 0.36, 0.69, 0.36, ink, 3.5, 2);
      sk.oval(0.5, 0.57, 0.13, 0.15, '#f97316', 8, 14);
      sk.line(0.38, 0.53, 0.28, 0.48, '#f97316', 7, 3);
      sk.line(0.62, 0.53, 0.72, 0.48, '#f97316', 7, 3);
      sk.line(0.44, 0.71, 0.4, 0.85, '#f97316', 7, 3);
      sk.line(0.56, 0.71, 0.6, 0.85, '#f97316', 7, 3);
      sk.poly([[0.62, 0.66], [0.76, 0.59], [0.78, 0.43]], '#f97316', 7);
      break;
    }

    case 'shark': {
      // Fierce upright blue shark with tall fin, zigzag teeth & tail fin!
      sk.poly([[0.32, 0.29], [0.5, 0.11], [0.68, 0.29], [0.71, 0.66], [0.5, 0.76], [0.29, 0.66], [0.32, 0.29]], '#3b82f6', 9);
      // Dorsal fin poking out left
      sk.poly([[0.3, 0.42], [0.14, 0.31], [0.29, 0.53]], '#3b82f6', 8);
      // Fierce eyes & wide zigzag chomp mouth
      sk.dot(0.43, 0.31, ink, 7);
      sk.dot(0.59, 0.31, ink, 7);
      sk.poly([[0.37, 0.44], [0.43, 0.49], [0.49, 0.44], [0.55, 0.49], [0.62, 0.44]], ink, 5);
      // Side pectoral fins + tail legs
      sk.line(0.69, 0.51, 0.83, 0.44, '#06b6d4', 8, 3);
      sk.poly([[0.42, 0.74], [0.33, 0.88]], '#3b82f6', 8);
      sk.poly([[0.58, 0.74], [0.67, 0.88]], '#3b82f6', 8);
      break;
    }

    case 'penguin': {
      // Adorable plump round penguin with orange beak, flapping flippers & webbed feet
      sk.oval(0.5, 0.49, 0.22, 0.29, ink, 10, 18);
      sk.oval(0.5, 0.55, 0.14, 0.18, '#06b6d4', 6, 14);
      sk.dot(0.43, 0.33, ink, 7);
      sk.dot(0.57, 0.33, ink, 7);
      sk.poly([[0.45, 0.38], [0.55, 0.38], [0.5, 0.44], [0.45, 0.38]], '#f97316', 7);
      // Flapping wings
      sk.poly([[0.29, 0.46], [0.16, 0.56], [0.27, 0.6]], ink, 8);
      sk.poly([[0.71, 0.46], [0.84, 0.56], [0.73, 0.6]], ink, 8);
      // Orange feet
      sk.line(0.4, 0.78, 0.34, 0.84, '#f97316', 8, 2);
      sk.line(0.6, 0.78, 0.66, 0.84, '#f97316', 8, 2);
      break;
    }

    case 'beetle': {
      // Rhinoceros beetle with massive Y-shaped horn at top & shiny brown/black shell
      sk.line(0.5, 0.3, 0.5, 0.11, '#92400e', 9, 5);
      sk.poly([[0.41, 0.08], [0.5, 0.16], [0.59, 0.08]], '#92400e', 8); // Y-horn fork!
      sk.oval(0.5, 0.34, 0.14, 0.09, ink, 8, 12);
      sk.dot(0.43, 0.34, '#eab308', 6);
      sk.dot(0.57, 0.34, '#eab308', 6);
      // Armored beetle shell
      sk.oval(0.5, 0.58, 0.2, 0.21, '#92400e', 10, 16);
      sk.line(0.5, 0.4, 0.5, 0.78, ink, 5, 4);
      // 6 insect legs
      sk.line(0.32, 0.47, 0.18, 0.41, ink, 6, 3);
      sk.line(0.68, 0.47, 0.82, 0.41, ink, 6, 3);
      sk.line(0.3, 0.59, 0.16, 0.62, ink, 6, 3);
      sk.line(0.7, 0.59, 0.84, 0.62, ink, 6, 3);
      sk.line(0.36, 0.74, 0.28, 0.86, ink, 6, 3);
      sk.line(0.64, 0.74, 0.72, 0.86, ink, 6, 3);
      break;
    }

    case 'octopus': {
      // Bright red octopus with big dome head & 6 sprawling long wavy tentacles!
      sk.oval(0.5, 0.31, 0.17, 0.16, '#ef4444', 9, 16);
      sk.dot(0.43, 0.33, ink, 7);
      sk.dot(0.57, 0.33, ink, 7);
      sk.oval(0.5, 0.41, 0.045, 0.035, '#f97316', 5, 8); // o-mouth
      // Wide sprawling wavy arms (triggers long_arms!)
      sk.poly([[0.38, 0.46], [0.22, 0.43], [0.1, 0.51]], '#ef4444', 8);
      sk.poly([[0.62, 0.46], [0.78, 0.43], [0.9, 0.51]], '#ef4444', 8);
      sk.poly([[0.39, 0.52], [0.24, 0.6], [0.14, 0.72]], '#ef4444', 8);
      sk.poly([[0.61, 0.52], [0.76, 0.6], [0.86, 0.72]], '#ef4444', 8);
      sk.poly([[0.45, 0.53], [0.4, 0.72], [0.35, 0.86]], '#ef4444', 8);
      sk.poly([[0.55, 0.53], [0.6, 0.72], [0.65, 0.86]], '#ef4444', 8);
      break;
    }

    // ================= 食べ物 =================
    case 'food': {
      sk.poly(
        [[0.5, 0.16], [0.75, 0.66], [0.72, 0.74], [0.28, 0.74], [0.25, 0.66], [0.5, 0.16]],
        ink,
        9
      );
      sk.poly([[0.36, 0.57], [0.64, 0.57], [0.64, 0.73], [0.36, 0.73], [0.36, 0.57]], ink, 11);
      sk.line(0.42, 0.65, 0.58, 0.65, ink, 12, 3);
      sk.dot(0.43, 0.42, ink, 8);
      sk.dot(0.57, 0.42, ink, 8);
      sk.dot(0.37, 0.47, '#ec4899', 8);
      sk.dot(0.63, 0.47, '#ec4899', 8);
      sk.poly([[0.45, 0.49], [0.5, 0.52], [0.55, 0.49]], '#ef4444', 5);
      sk.line(0.31, 0.52, 0.17, 0.44, main, 7, 4);
      sk.line(0.69, 0.52, 0.83, 0.42, main, 7, 4);
      sk.line(0.41, 0.74, 0.37, 0.87, ink, 8, 3);
      sk.line(0.59, 0.74, 0.63, 0.87, ink, 8, 3);
      break;
    }

    case 'ramen': {
      // Steaming ramen bowl with naruto swirl, chopsticks & little legs
      sk.poly([[0.22, 0.46], [0.78, 0.46], [0.69, 0.73], [0.31, 0.73], [0.22, 0.46]], '#ef4444', 9);
      sk.line(0.28, 0.54, 0.72, 0.54, '#eab308', 6, 4); // bowl rim pattern
      // Wavy yellow noodles & pink naruto on top
      sk.poly([[0.28, 0.43], [0.38, 0.36], [0.5, 0.42], [0.62, 0.36], [0.72, 0.43]], '#eab308', 7);
      sk.oval(0.42, 0.38, 0.06, 0.06, '#ec4899', 5, 10);
      // Pair of straight chopsticks lifting noodles up-right!
      sk.line(0.53, 0.4, 0.84, 0.14, '#92400e', 6, 6, 0.002);
      sk.line(0.57, 0.42, 0.88, 0.2, '#92400e', 6, 6, 0.002);
      // Cute bowl face + feet
      sk.dot(0.43, 0.62, ink, 7);
      sk.dot(0.57, 0.62, ink, 7);
      sk.line(0.41, 0.74, 0.38, 0.86, ink, 7, 3);
      sk.line(0.59, 0.74, 0.62, 0.86, ink, 7, 3);
      break;
    }

    case 'sushi': {
      // Nigiri sushi (bright red tuna neta on rice block) with headband & fists!
      sk.poly([[0.22, 0.37], [0.78, 0.37], [0.74, 0.51], [0.26, 0.51], [0.22, 0.37]], '#ef4444', 10);
      sk.line(0.32, 0.43, 0.68, 0.43, '#f97316', 7, 4);
      // Rice block body
      sk.poly([[0.29, 0.51], [0.71, 0.51], [0.69, 0.74], [0.31, 0.74], [0.29, 0.51]], ink, 8);
      sk.dot(0.43, 0.6, ink, 7);
      sk.dot(0.57, 0.6, ink, 7);
      sk.poly([[0.46, 0.66], [0.5, 0.69], [0.54, 0.66]], '#ef4444', 4);
      // Little fighting arms & legs
      sk.line(0.29, 0.59, 0.16, 0.53, ink, 7, 3);
      sk.line(0.71, 0.59, 0.84, 0.53, ink, 7, 3);
      sk.line(0.41, 0.74, 0.39, 0.86, ink, 7, 3);
      sk.line(0.59, 0.74, 0.61, 0.86, ink, 7, 3);
      break;
    }

    case 'burger': {
      // Plump round stacked cheeseburger fighter!
      sk.oval(0.5, 0.35, 0.24, 0.14, '#f97316', 9, 14, Math.PI, Math.PI * 2);
      sk.line(0.26, 0.36, 0.74, 0.36, '#f97316', 8, 5);
      sk.dot(0.41, 0.27, '#eab308', 5);
      sk.dot(0.52, 0.25, '#eab308', 5);
      sk.dot(0.61, 0.28, '#eab308', 5);
      // Lettuce, tomato, patty layers
      sk.poly([[0.24, 0.43], [0.34, 0.47], [0.46, 0.42], [0.58, 0.47], [0.76, 0.43]], '#22c55e', 8);
      sk.line(0.26, 0.52, 0.74, 0.52, '#ef4444', 8, 5);
      sk.line(0.25, 0.6, 0.75, 0.6, '#92400e', 11, 5);
      // Bottom bun
      sk.poly([[0.27, 0.67], [0.73, 0.67], [0.7, 0.76], [0.3, 0.76], [0.27, 0.67]], '#f97316', 8);
      // Eyes & stubby arms/feet
      sk.dot(0.43, 0.33, ink, 7);
      sk.dot(0.57, 0.33, ink, 7);
      sk.line(0.24, 0.55, 0.14, 0.49, ink, 7, 3);
      sk.line(0.76, 0.55, 0.86, 0.49, ink, 7, 3);
      sk.line(0.4, 0.77, 0.38, 0.86, ink, 8, 2);
      sk.line(0.6, 0.77, 0.62, 0.86, ink, 8, 2);
      break;
    }

    case 'icecream': {
      // Tall swirling soft-serve ice cream in waffle cone!
      sk.poly([[0.5, 0.11], [0.6, 0.24], [0.39, 0.28], [0.64, 0.37], [0.35, 0.43], [0.65, 0.51], [0.35, 0.51]], '#ec4899', 9);
      sk.oval(0.5, 0.42, 0.14, 0.08, '#06b6d4', 6, 12);
      sk.dot(0.44, 0.41, ink, 6);
      sk.dot(0.56, 0.41, ink, 6);
      // Waffle cone body
      sk.poly([[0.36, 0.52], [0.64, 0.52], [0.5, 0.87], [0.36, 0.52]], '#f97316', 8);
      sk.line(0.41, 0.61, 0.58, 0.61, '#92400e', 4, 3);
      sk.line(0.44, 0.7, 0.55, 0.7, '#92400e', 4, 3);
      // Cute arms
      sk.line(0.38, 0.58, 0.26, 0.53, '#ec4899', 6, 3);
      sk.line(0.62, 0.58, 0.74, 0.53, '#ec4899', 6, 3);
      break;
    }

    case 'banana': {
      // Tall cool yellow curved banana with sunglasses & stick limbs!
      sk.poly([[0.46, 0.12], [0.55, 0.14], [0.62, 0.35], [0.6, 0.61], [0.5, 0.79], [0.4, 0.77], [0.44, 0.56], [0.44, 0.31], [0.46, 0.12]], '#eab308', 10);
      sk.line(0.48, 0.12, 0.53, 0.14, '#92400e', 7, 2); // stem tip
      // Cool sunglasses
      sk.line(0.44, 0.35, 0.62, 0.35, ink, 9, 3);
      sk.poly([[0.48, 0.45], [0.53, 0.48], [0.58, 0.44]], ink, 4);
      // Limbs
      sk.line(0.44, 0.5, 0.28, 0.46, ink, 6, 3);
      sk.line(0.6, 0.5, 0.75, 0.44, ink, 6, 3);
      sk.line(0.44, 0.77, 0.38, 0.89, ink, 6, 3);
      sk.line(0.52, 0.77, 0.59, 0.89, ink, 6, 3);
      break;
    }

    // ================= ゆるキャラ・ネタ =================
    case 'weird': {
      sk.oval(0.5, 0.34, 0.12, 0.18, '#8b5cf6', 8, 16);
      sk.dot(0.44, 0.29, ink, 7);
      sk.dot(0.5, 0.24, '#eab308', 8);
      sk.dot(0.56, 0.29, ink, 7);
      sk.poly([[0.43, 0.39], [0.47, 0.42], [0.53, 0.39], [0.57, 0.42]], '#ec4899', 5);
      sk.poly([[0.45, 0.17], [0.39, 0.09], [0.34, 0.13]], '#ec4899', 6);
      sk.poly([[0.55, 0.17], [0.62, 0.08], [0.67, 0.12]], '#eab308', 6);
      sk.poly([[0.5, 0.52], [0.46, 0.64], [0.53, 0.73]], '#8b5cf6', 9);
      sk.poly([[0.45, 0.55], [0.28, 0.49], [0.12, 0.56]], '#22c55e', 8);
      sk.poly([[0.54, 0.55], [0.72, 0.48], [0.88, 0.55]], '#22c55e', 8);
      sk.line(0.46, 0.72, 0.35, 0.89, '#8b5cf6', 7, 4);
      sk.line(0.51, 0.73, 0.51, 0.88, '#ec4899', 7, 4);
      sk.line(0.55, 0.72, 0.66, 0.89, '#8b5cf6', 7, 4);
      break;
    }

    case 'snowman': {
      // Stacked round snowman with red bucket hat, carrot nose, scarf & twig arms
      sk.poly([[0.4, 0.14], [0.6, 0.14], [0.58, 0.25], [0.42, 0.25], [0.4, 0.14]], '#ef4444', 8);
      sk.oval(0.5, 0.36, 0.13, 0.11, '#06b6d4', 8, 16);
      sk.dot(0.45, 0.34, ink, 6);
      sk.dot(0.55, 0.34, ink, 6);
      sk.line(0.5, 0.38, 0.6, 0.39, '#f97316', 6, 3); // carrot nose
      sk.line(0.38, 0.47, 0.62, 0.47, '#3b82f6', 8, 4); // blue scarf
      // Big round bottom snowball
      sk.oval(0.5, 0.66, 0.2, 0.18, '#06b6d4', 9, 18);
      sk.dot(0.5, 0.6, ink, 6);
      sk.dot(0.5, 0.7, ink, 6);
      // Twig arms
      sk.line(0.32, 0.58, 0.17, 0.48, '#92400e', 6, 3);
      sk.line(0.68, 0.58, 0.83, 0.48, '#92400e', 6, 3);
      break;
    }

    case 'cactus': {
      // Spiky green desert cactus with raised U-arms & red top flower!
      sk.dot(0.5, 0.13, '#ef4444', 11);
      sk.dot(0.44, 0.15, '#ec4899', 7);
      sk.dot(0.56, 0.15, '#ec4899', 7);
      // Main tall green cactus trunk
      sk.poly([[0.41, 0.85], [0.41, 0.23], [0.5, 0.17], [0.59, 0.23], [0.59, 0.85], [0.41, 0.85]], '#22c55e', 10);
      // Raised cactus arms
      sk.poly([[0.41, 0.53], [0.24, 0.53], [0.24, 0.34]], '#22c55e', 10);
      sk.poly([[0.59, 0.48], [0.76, 0.48], [0.76, 0.29]], '#22c55e', 10);
      // Cute eyes & spiky needles
      sk.dot(0.46, 0.35, ink, 6);
      sk.dot(0.54, 0.35, ink, 6);
      sk.line(0.35, 0.31, 0.39, 0.31, ink, 4, 2);
      sk.line(0.61, 0.38, 0.65, 0.38, ink, 4, 2);
      sk.line(0.35, 0.67, 0.39, 0.67, ink, 4, 2);
      sk.line(0.61, 0.7, 0.65, 0.7, ink, 4, 2);
      break;
    }

    case 'macho': {
      // HUGE V-taper bodybuilder flexing double giant biceps!
      sk.oval(0.5, 0.22, 0.085, 0.085, '#f97316', 7, 14);
      sk.dot(0.47, 0.21, ink, 5);
      sk.dot(0.53, 0.21, ink, 5);
      sk.line(0.46, 0.26, 0.54, 0.26, ink, 4, 2);
      // Massive broad V-shaped chest
      sk.poly([[0.27, 0.32], [0.73, 0.32], [0.6, 0.63], [0.4, 0.63], [0.27, 0.32]], '#f97316', 10);
      sk.line(0.5, 0.34, 0.5, 0.59, '#92400e', 5, 3); // abs center line
      sk.line(0.42, 0.45, 0.58, 0.45, '#92400e', 5, 3);
      // Flexing huge biceps!
      sk.poly([[0.27, 0.35], [0.12, 0.42], [0.16, 0.24]], '#f97316', 11);
      sk.poly([[0.73, 0.35], [0.88, 0.42], [0.84, 0.24]], '#f97316', 11);
      // Briefs & thick legs
      sk.poly([[0.4, 0.63], [0.6, 0.63], [0.57, 0.72], [0.43, 0.72], [0.4, 0.63]], '#ef4444', 8);
      sk.line(0.43, 0.72, 0.36, 0.88, '#f97316', 10, 4);
      sk.line(0.57, 0.72, 0.64, 0.88, '#f97316', 10, 4);
      break;
    }

    case 'sumo': {
      // Huge wide round Sumo wrestler with chonmage topknot, mawashi & shiko stomp!
      sk.oval(0.5, 0.14, 0.055, 0.045, ink, 8, 10); // chonmage bun
      sk.oval(0.5, 0.26, 0.12, 0.1, '#f97316', 8, 14);
      sk.dot(0.45, 0.25, ink, 6);
      sk.dot(0.55, 0.25, ink, 6);
      sk.dot(0.41, 0.29, '#ec4899', 6);
      sk.dot(0.59, 0.29, '#ec4899', 6);
      // Huge round sumo belly
      sk.oval(0.5, 0.53, 0.27, 0.21, '#f97316', 11, 18);
      // Dark blue mawashi belt
      sk.line(0.26, 0.63, 0.74, 0.63, '#3b82f6', 12, 5);
      sk.line(0.5, 0.63, 0.5, 0.74, '#3b82f6', 10, 3);
      // Wide thrusting arms & stomping legs
      sk.line(0.25, 0.47, 0.12, 0.43, '#f97316', 10, 3);
      sk.line(0.75, 0.47, 0.88, 0.43, '#f97316', 10, 3);
      sk.line(0.37, 0.72, 0.29, 0.87, '#f97316', 11, 3);
      sk.line(0.63, 0.72, 0.71, 0.87, '#f97316', 11, 3);
      break;
    }

    case 'daruma': {
      // Big round lucky red Japanese Daruma doll with thick black eyebrows & gold crest!
      sk.oval(0.5, 0.51, 0.27, 0.28, '#ef4444', 12, 18);
      sk.oval(0.5, 0.4, 0.16, 0.11, '#f97316', 6, 14); // face window
      // Fierce thick eyebrows & big eyes
      sk.poly([[0.36, 0.34], [0.43, 0.31], [0.48, 0.35]], ink, 7);
      sk.poly([[0.64, 0.34], [0.57, 0.31], [0.52, 0.35]], ink, 7);
      sk.dot(0.43, 0.41, ink, 9);
      sk.dot(0.57, 0.41, ink, 9);
      sk.line(0.42, 0.48, 0.58, 0.48, ink, 5, 3); // stern mustache/mouth
      // Gold lucky belly lines
      sk.line(0.39, 0.62, 0.61, 0.62, '#eab308', 7, 4);
      sk.line(0.44, 0.69, 0.56, 0.69, '#eab308', 6, 3);
      break;
    }

    case 'ghost':
    default: {
      sk.poly(
        [
          [0.3, 0.74],
          [0.29, 0.42],
          [0.35, 0.24],
          [0.5, 0.17],
          [0.65, 0.24],
          [0.71, 0.42],
          [0.7, 0.74],
          [0.62, 0.67],
          [0.55, 0.76],
          [0.46, 0.67],
          [0.38, 0.76],
          [0.3, 0.74],
        ],
        '#3b82f6',
        9
      );
      sk.dot(0.43, 0.39, ink, 9);
      sk.dot(0.57, 0.39, ink, 9);
      sk.oval(0.5, 0.49, 0.05, 0.06, '#06b6d4', 6, 10);
      sk.line(0.3, 0.49, 0.18, 0.43, '#3b82f6', 7, 3);
      sk.line(0.7, 0.49, 0.82, 0.43, '#3b82f6', 7, 3);
      sk.dot(0.22, 0.25, '#06b6d4', 8);
      sk.dot(0.79, 0.28, '#06b6d4', 8);
      break;
    }
  }

  return sk.strokes;
}

import { CANVAS_SIZE } from './shared.js';
import { renderStrokesToInkCanvas } from './drawing.js';

const BASE_SIZE = CANVAS_SIZE || 320;

function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function findInkBounds(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, w, h).data;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    const rowOff = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[rowOff + x * 4 + 3] > 18) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;

  const pad = 6;
  const bx = Math.max(0, minX - pad);
  const by = Math.max(0, minY - pad);
  const rx = Math.min(w, maxX + 1 + pad);
  const ry = Math.min(h, maxY + 1 + pad);
  return { x: bx, y: by, w: Math.max(4, rx - bx), h: Math.max(4, ry - by) };
}

function drawFallbackStick(ctx, size, color = '#3b82f6') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, size * 0.045);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Head
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.28, size * 0.14, 0, Math.PI * 2);
  ctx.stroke();
  // Body & limbs
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.42);
  ctx.lineTo(size * 0.5, size * 0.7);
  ctx.moveTo(size * 0.28, size * 0.52);
  ctx.lineTo(size * 0.72, size * 0.52);
  ctx.moveTo(size * 0.5, size * 0.7);
  ctx.lineTo(size * 0.35, size * 0.88);
  ctx.moveTo(size * 0.5, size * 0.7);
  ctx.lineTo(size * 0.65, size * 0.88);
  ctx.stroke();
  ctx.restore();
}

export function buildCharacterSprite(strokes, stats = null) {
  const source = createCanvas(BASE_SIZE, BASE_SIZE);
  const srcCtx = source.getContext('2d');

  if (Array.isArray(strokes) && strokes.length > 0) {
    renderStrokesToInkCanvas(srcCtx, strokes, BASE_SIZE, BASE_SIZE);
  }

  let box = findInkBounds(source);
  if (!box) {
    drawFallbackStick(srcCtx, BASE_SIZE, stats?.specialMove?.color || '#3b82f6');
    box = findInkBounds(source) || { x: 40, y: 30, w: 240, h: 260 };
  }

  const cropW = box.w;
  const cropH = box.h;
  const fullCanvas = createCanvas(cropW, cropH);
  const fullCtx = fullCanvas.getContext('2d');
  fullCtx.drawImage(source, box.x, box.y, cropW, cropH, 0, 0, cropW, cropH);

  // Split upper body (~68%) and lower legs (~32%) for lively bouncy walk stride
  const splitY = Math.max(2, Math.min(cropH - 2, Math.round(cropH * 0.68)));
  const lowerH = Math.max(2, cropH - splitY);
  const halfW = Math.max(1, Math.round(cropW * 0.5));
  const rightW = Math.max(1, cropW - halfW);

  const upperCanvas = createCanvas(cropW, splitY);
  upperCanvas.getContext('2d').drawImage(fullCanvas, 0, 0, cropW, splitY, 0, 0, cropW, splitY);

  const lowerCanvas = createCanvas(cropW, lowerH);
  lowerCanvas.getContext('2d').drawImage(fullCanvas, 0, splitY, cropW, lowerH, 0, 0, cropW, lowerH);

  const lowerLeftCanvas = createCanvas(halfW, lowerH);
  lowerLeftCanvas
    .getContext('2d')
    .drawImage(fullCanvas, 0, splitY, halfW, lowerH, 0, 0, halfW, lowerH);

  const lowerRightCanvas = createCanvas(rightW, lowerH);
  lowerRightCanvas
    .getContext('2d')
    .drawImage(fullCanvas, halfW, splitY, rightW, lowerH, 0, 0, rightW, lowerH);

  // White & red hit-flash mask silhouettes (pre-baked to avoid compositing onto stage background)
  const flashCanvas = createCanvas(cropW, cropH);
  const flashCtx = flashCanvas.getContext('2d');
  flashCtx.drawImage(fullCanvas, 0, 0);
  flashCtx.globalCompositeOperation = 'source-atop';
  flashCtx.fillStyle = '#ffffff';
  flashCtx.fillRect(0, 0, cropW, cropH);

  const redFlashCanvas = createCanvas(cropW, cropH);
  const redFlashCtx = redFlashCanvas.getContext('2d');
  redFlashCtx.drawImage(fullCanvas, 0, 0);
  redFlashCtx.globalCompositeOperation = 'source-atop';
  redFlashCtx.fillStyle = '#ef4444';
  redFlashCtx.fillRect(0, 0, cropW, cropH);

  const traits = Array.isArray(stats?.traits) ? stats.traits : [];
  return {
    fullCanvas,
    upperCanvas,
    lowerCanvas,
    lowerLeftCanvas,
    lowerRightCanvas,
    flashCanvas,
    redFlashCanvas,
    width: cropW,
    height: cropH,
    splitY,
    lowerH,
    halfW,
    aspect: cropW / Math.max(1, cropH),
    specialColor: stats?.specialMove?.color || '#3b82f6',
    element: stats?.specialMove?.element || 'none',
    hasWings: traits.some((t) => t && t.id === 'wings'),
  };
}

function drawRoundedRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function drawSlashArc(ctx, drawW, drawH, color, heavy, t) {
  const progress = Math.min(1, Math.max(0, t / (heavy ? 0.28 : 0.18)));
  const alpha = Math.max(0, 1 - progress * 0.85);
  const radius = Math.max(drawW, drawH) * (heavy ? 0.72 : 0.56);

  ctx.save();
  ctx.translate(drawW * 0.25, -drawH * 0.52);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color || '#1f2937';
  ctx.lineWidth = heavy ? 10 : 6;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.arc(0, 0, radius, -Math.PI * 0.45 + progress * 0.25, Math.PI * 0.35 + progress * 0.2);
  ctx.stroke();

  // Inner bright highlight slash
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = heavy ? 4 : 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.88, -Math.PI * 0.38 + progress * 0.25, Math.PI * 0.25 + progress * 0.2);
  ctx.stroke();
  ctx.restore();
}

function drawChargeSparks(ctx, drawW, drawH, color, chargeRatio, t) {
  const count = 6;
  const rBase = Math.max(drawW, drawH) * (0.58 - chargeRatio * 0.14);
  ctx.save();
  ctx.translate(0, -drawH * 0.5);
  for (let i = 0; i < count; i++) {
    const a = t * 7 + (i * Math.PI * 2) / count;
    const dist = rBase + Math.sin(t * 14 + i) * 6;
    const sx = Math.cos(a) * dist;
    const sy = Math.sin(a) * dist * 0.85;
    ctx.strokeStyle = i % 2 === 0 ? color || '#f59e0b' : '#fde047';
    ctx.lineWidth = 2.5 + chargeRatio * 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx - 5, sy);
    ctx.lineTo(sx + 5, sy);
    ctx.moveTo(sx, sy - 5);
    ctx.lineTo(sx, sy + 5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSpecialAura(ctx, drawW, drawH, element, color, t) {
  const radius = Math.max(drawW, drawH) * (0.58 + Math.sin(t * 20) * 0.06);
  ctx.save();
  ctx.translate(0, -drawH * 0.5);

  const auraColor =
    element === 'fire'
      ? '#f97316'
      : element === 'lightning'
        ? '#eab308'
        : element === 'ice'
          ? '#38bdf8'
          : element === 'star'
            ? '#ec4899'
            : color || '#6366f1';

  // Sketchy burst ring
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = auraColor;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = auraColor;
  ctx.lineWidth = 3.5;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.06, t * 5, t * 5 + Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Element-flavored orbiting accent marks
  const rays = element === 'lightning' ? 6 : 5;
  for (let i = 0; i < rays; i++) {
    const a = t * 6 + (i * Math.PI * 2) / rays;
    const x1 = Math.cos(a) * radius * 0.85;
    const y1 = Math.sin(a) * radius * 0.85;
    const x2 = Math.cos(a) * radius * 1.28;
    const y2 = Math.sin(a) * radius * 1.28;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    if (element === 'lightning') {
      const mx = (x1 + x2) * 0.5 + Math.cos(a + 1.5) * 8;
      const my = (y1 + y2) * 0.5 + Math.sin(a + 1.5) * 8;
      ctx.lineTo(mx, my);
    }
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGrabHand(ctx, drawW, drawH, color, t) {
  const reach = drawW * (0.55 + Math.min(1, t * 6) * 0.45);
  ctx.save();
  ctx.translate(drawW * 0.15, -drawH * 0.5);
  ctx.strokeStyle = color || '#1f2937';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Sketchy extending grab line
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(reach * 0.5, -6 * Math.sin(t * 18), reach, 0);
  ctx.stroke();

  // Comical open hand / pincer at tip
  ctx.beginPath();
  ctx.arc(reach + 4, 0, 9, -Math.PI * 0.7, Math.PI * 0.7);
  ctx.moveTo(reach + 4, -8);
  ctx.lineTo(reach + 14, -10);
  ctx.moveTo(reach + 6, 0);
  ctx.lineTo(reach + 16, 0);
  ctx.moveTo(reach + 4, 8);
  ctx.lineTo(reach + 14, 10);
  ctx.stroke();
  ctx.restore();
}

function drawHammer(ctx, drawW, drawH, t) {
  const swing = Math.sin(t * 24) * 1.25 - 0.15;
  ctx.save();
  ctx.translate(drawW * 0.22, -drawH * 0.52);
  ctx.rotate(swing);

  // Wooden handle
  ctx.strokeStyle = '#1f2937';
  ctx.fillStyle = '#d97706';
  ctx.lineWidth = 3;
  drawRoundedRectPath(ctx, -5, -drawH * 0.85, 10, drawH * 0.85, 4);
  ctx.fill();
  ctx.stroke();

  // Giant red-and-yellow comic mallet head
  ctx.fillStyle = '#ef4444';
  drawRoundedRectPath(ctx, -26, -drawH * 0.96, 52, 30, 8);
  ctx.fill();
  ctx.stroke();

  // Yellow side caps
  ctx.fillStyle = '#facc15';
  ctx.fillRect(-24, -drawH * 0.93, 8, 24);
  ctx.fillRect(16, -drawH * 0.93, 8, 24);
  ctx.strokeRect(-24, -drawH * 0.93, 8, 24);
  ctx.strokeRect(16, -drawH * 0.93, 8, 24);

  // Motion speed lines around hammer head
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, drawH * 0.9, -Math.PI * 0.65, -Math.PI * 0.35);
  ctx.stroke();
  ctx.restore();
}

function drawShieldBubble(ctx, drawW, drawH, shieldHp, color, t) {
  // Normalize shieldHp whether caller passes 0..1 or 0..100
  const ratio = Math.max(0.18, Math.min(1, shieldHp > 1 ? shieldHp / 100 : shieldHp));
  const radius = Math.max(drawW, drawH) * (0.42 + ratio * 0.28);
  const low = ratio < 0.32;
  const wobble = Math.sin(t * 16) * (low ? 2.5 : 1);

  ctx.save();
  ctx.translate(0, -drawH * 0.5);

  ctx.fillStyle = low ? 'rgba(239, 68, 68, 0.24)' : 'rgba(59, 130, 246, 0.18)';
  ctx.beginPath();
  ctx.arc(0, 0, radius + wobble, 0, Math.PI * 2);
  ctx.fill();

  // Hand-drawn double marker ring
  ctx.strokeStyle = low ? '#ef4444' : color || '#3b82f6';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(0, 0, radius + wobble, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.arc(0, 0, radius - 4 - wobble, t * 2, t * 2 + Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Glossy crayon highlight
  ctx.globalAlpha = 0.65;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.78, -Math.PI * 0.78, -Math.PI * 0.45);
  ctx.stroke();

  ctx.restore();
}

function drawDizzyStars(ctx, drawH, t) {
  ctx.save();
  ctx.translate(0, -drawH - 6);
  for (let i = 0; i < 3; i++) {
    const a = t * 7 + (i * Math.PI * 2) / 3;
    const sx = Math.cos(a) * 18;
    const sy = Math.sin(a) * 5;
    ctx.fillStyle = i === 1 ? '#f97316' : '#facc15';
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlayerTag(ctx, x, topY, state) {
  const label = state.name || (state.isLocal ? 'YOU' : 'P');
  const tagColor = state.teamColor || state.color || '#3b82f6';

  ctx.save();
  ctx.font = 'bold 12px "Hiragino Maru Gothic ProN", "Yu Gothic", system-ui, sans-serif';
  const textW = Math.min(110, ctx.measureText(label).width);
  const pillW = Math.max(30, textW + (state.isLocal ? 18 : 12));
  const pillH = 20;
  const px = x - pillW * 0.5;
  const py = topY - pillH - 9;

  // Pill background with sketchy border
  ctx.fillStyle = 'rgba(255, 253, 247, 0.92)';
  ctx.strokeStyle = tagColor;
  ctx.lineWidth = 2.2;
  drawRoundedRectPath(ctx, px, py, pillW, pillH, 9);
  ctx.fill();
  ctx.stroke();

  // Downward pointer triangle
  ctx.fillStyle = tagColor;
  ctx.beginPath();
  ctx.moveTo(x - 5, py + pillH);
  ctx.lineTo(x + 5, py + pillH);
  ctx.lineTo(x, py + pillH + 6);
  ctx.closePath();
  ctx.fill();

  // Name text
  ctx.fillStyle = '#1f2937';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const displayLabel = state.isLocal ? `★${label}` : label;
  ctx.fillText(displayLabel, x, py + pillH * 0.53, pillW - 6);
  ctx.restore();
}

export function drawFighter(ctx, sprite, state) {
  if (!ctx || !state) return;

  const x = Number(state.x) || 0;
  const y = Number(state.y) || 0;
  const targetW = Number(state.width) || 64;
  const targetH = Number(state.height) || 74;
  const facing = state.facing === -1 ? -1 : 1;
  const animState = state.animState || 'idle';
  const t = Number(state.animTime) || 0;
  const vx = Number(state.vx) || 0;
  const vy = Number(state.vy) || 0;
  const onGround = Boolean(state.onGround);
  const shieldActive = Boolean(state.shieldActive) || animState === 'guard';
  const shieldHp = state.shieldHp !== undefined ? state.shieldHp : 1;
  const hitFlash = Number(state.hitFlash) || 0;
  const giantTimer = Number(state.giantTimer) || 0;
  const invulnTimer = Number(state.invulnTimer) || 0;
  const chargeRatio = Math.max(0, Math.min(1, Number(state.chargeRatio) || 0));
  const hasHammer = Boolean(state.hasHammer);

  // Preserve sprite aspect ratio neatly inside the fighter's visual box
  let drawW = targetW;
  let drawH = targetH;
  if (sprite && sprite.width && sprite.height) {
    const aspect = sprite.width / sprite.height;
    const boxAspect = targetW / Math.max(1, targetH);
    if (aspect > boxAspect * 1.25) {
      drawW = targetW * 1.15;
      drawH = drawW / aspect;
    } else if (aspect < boxAspect * 0.78) {
      drawH = targetH * 1.06;
      drawW = drawH * aspect;
    } else {
      drawW = targetW * 1.06;
      drawH = targetH * 1.06;
    }
  }

  // Invulnerability blink
  let alpha = 1;
  if (invulnTimer > 0) {
    alpha = Math.floor(invulnTimer * 18) % 2 === 0 ? 0.38 : 0.94;
  }

  // Compute procedural animation transforms (pivoted at bottom-center feet)
  let offsetX = 0;
  let offsetY = 0;
  let scaleX = 1;
  let scaleY = 1;
  let rotation = 0;
  let legPhase = 0;
  let useSplitLegs = false;

  switch (animState) {
    case 'walk':
    case 'run': {
      const speedFactor = Math.min(1.5, Math.max(0.7, Math.abs(vx) / 260));
      const cycle = t * 14 * speedFactor;
      offsetY = -Math.abs(Math.sin(cycle)) * 5.5;
      scaleX = 1 + Math.cos(cycle * 2) * 0.04;
      scaleY = 1 - Math.cos(cycle * 2) * 0.04;
      rotation = 0.08 * speedFactor;
      legPhase = cycle;
      useSplitLegs = true;
      break;
    }
    case 'jump': {
      if (vy < -60) {
        scaleX = 0.88;
        scaleY = 1.14;
        // Cute front-flip tuck on double-jump burst if animating quickly
        if (t < 0.28 && vy < -320) {
          rotation = (t / 0.28) * Math.PI * 2;
          scaleX = 0.94;
          scaleY = 0.94;
        }
      } else {
        scaleX = 1.06;
        scaleY = 0.95;
      }
      break;
    }
    case 'fall': {
      scaleX = 1.07;
      scaleY = 0.93;
      rotation = Math.sin(t * 8) * 0.06;
      break;
    }
    case 'attack': {
      const p = Math.min(1, t / 0.18);
      const lunge = Math.sin(p * Math.PI);
      offsetX = lunge * 12;
      rotation = lunge * 0.18;
      scaleX = 1 + lunge * 0.12;
      scaleY = 1 - lunge * 0.07;
      break;
    }
    case 'strong': {
      if (chargeRatio > 0 || t < 0.14) {
        const c = Math.max(chargeRatio, t / 0.14);
        offsetX = -6 - c * 4;
        rotation = -0.16 - c * 0.1;
        scaleX = 1.08 + c * 0.1;
        scaleY = 0.92 - c * 0.08;
      } else {
        const p = Math.min(1, (t - 0.14) / 0.22);
        const swing = Math.sin(p * Math.PI);
        offsetX = swing * 18;
        rotation = swing * 0.28;
        scaleX = 1 + swing * 0.18;
        scaleY = 1 - swing * 0.1;
      }
      break;
    }
    case 'special': {
      const pulse = Math.sin(t * 20);
      offsetX = 6;
      offsetY = -4 + pulse * 2;
      scaleX = 1.08 + pulse * 0.05;
      scaleY = 0.96 - pulse * 0.04;
      rotation = 0.12;
      break;
    }
    case 'recovery': {
      // Energetic upward soaring recovery pose!
      const boost = Math.sin(t * 24);
      offsetY = -6;
      scaleX = 0.86 + boost * 0.04;
      scaleY = 1.18 - boost * 0.04;
      rotation = 0.1;
      break;
    }
    case 'ledge': {
      // Clinging to the stage corner with gentle dangling sway
      offsetY = 6;
      scaleX = 0.96;
      scaleY = 1.04;
      rotation = Math.sin(t * 6) * 0.07;
      break;
    }
    case 'guard': {
      scaleX = 1.08;
      scaleY = 0.9;
      break;
    }
    case 'grab': {
      const reach = Math.min(1, t * 7);
      offsetX = reach * 10;
      rotation = reach * 0.16;
      scaleX = 1 + reach * 0.08;
      break;
    }
    case 'hurt':
    case 'stun':
    case 'dizzy': {
      if (!onGround && Math.hypot(vx, vy) > 180) {
        rotation = t * 11;
      } else {
        rotation = Math.sin(t * 22) * 0.22;
      }
      scaleX = 0.92;
      scaleY = 1.08;
      break;
    }
    case 'idle':
    default: {
      const breath = Math.sin(t * 4.5);
      scaleX = 1 - breath * 0.025;
      scaleY = 1 + breath * 0.035;
      break;
    }
  }

  ctx.save();

  // Contact shadow under feet when grounded
  if (onGround) {
    ctx.save();
    ctx.fillStyle = 'rgba(30, 41, 59, 0.2)';
    ctx.beginPath();
    ctx.ellipse(x, y + 1, Math.max(14, drawW * 0.36), 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.globalAlpha = alpha;
  ctx.translate(x, y);

  // Giant golden outline aura
  if (giantTimer > 0) {
    ctx.save();
    const gPulse = 1 + Math.sin(t * 14) * 0.05;
    ctx.translate(0, -drawH * 0.5);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 5;
    ctx.globalAlpha = alpha * 0.72;
    ctx.beginPath();
    ctx.ellipse(0, 0, drawW * 0.58 * gPulse, drawH * 0.56 * gPulse, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.ellipse(0, 0, drawW * 0.65 * gPulse, drawH * 0.62 * gPulse, t * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Flip horizontally according to facing direction
  ctx.scale(facing, 1);

  // Walk sketch motion lines behind fighter
  if ((animState === 'walk' || animState === 'run') && onGround && Math.abs(vx) > 90) {
    ctx.save();
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.45)';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    const dashOff = (t * 40) % 10;
    for (let i = 0; i < 3; i++) {
      const ly = -drawH * (0.22 + i * 0.24);
      ctx.beginPath();
      ctx.moveTo(-drawW * 0.48 - dashOff, ly);
      ctx.lineTo(-drawW * 0.68 - dashOff, ly);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Apply body animation transform
  ctx.save();
  ctx.translate(offsetX, offsetY);

  // Rotate around center of character during spin/tumble, or around feet otherwise
  if (Math.abs(rotation) > 0.6) {
    ctx.translate(0, -drawH * 0.5);
    ctx.rotate(rotation);
    ctx.scale(scaleX, scaleY);
    ctx.translate(0, drawH * 0.5);
  } else {
    ctx.rotate(rotation);
    ctx.scale(scaleX, scaleY);
  }

  // Special / Recovery aura behind character
  if (animState === 'special' || animState === 'recovery') {
    drawSpecialAura(
      ctx,
      drawW,
      drawH,
      animState === 'recovery' ? 'star' : sprite?.element || 'none',
      animState === 'recovery' ? '#38bdf8' : sprite?.specialColor || state.color,
      t
    );
  }

  // Draw hand-drawn sprite (split upper + animated legs during walk!)
  if (sprite && sprite.fullCanvas) {
    if (useSplitLegs && sprite.upperCanvas && sprite.lowerLeftCanvas && sprite.lowerRightCanvas) {
      const splitRatio = sprite.splitY / Math.max(1, sprite.height);
      const upperDrawH = drawH * splitRatio;
      const lowerDrawH = drawH - upperDrawH;
      const halfDrawW = drawW * (sprite.halfW / Math.max(1, sprite.width));
      const rightDrawW = drawW - halfDrawW;

      const stride = Math.sin(legPhase);
      const leftLift = Math.max(0, stride) * 5.5;
      const rightLift = Math.max(0, -stride) * 5.5;
      const leftSwingX = stride * 4.5;
      const rightSwingX = -stride * 4.5;

      // Left leg half
      ctx.save();
      ctx.translate(-drawW * 0.5 + leftSwingX, -lowerDrawH - leftLift);
      ctx.rotate(-stride * 0.14);
      ctx.drawImage(sprite.lowerLeftCanvas, 0, 0, halfDrawW, lowerDrawH);
      ctx.restore();

      // Right leg half
      ctx.save();
      ctx.translate(-drawW * 0.5 + halfDrawW + rightSwingX, -lowerDrawH - rightLift);
      ctx.rotate(stride * 0.14);
      ctx.drawImage(sprite.lowerRightCanvas, 0, 0, rightDrawW, lowerDrawH);
      ctx.restore();

      // Upper body slightly overlapping seam by 1px to prevent hairline gap
      ctx.drawImage(sprite.upperCanvas, -drawW * 0.5, -drawH, drawW, upperDrawH + 1);
    } else {
      ctx.drawImage(sprite.fullCanvas, -drawW * 0.5, -drawH, drawW, drawH);
    }

    // White/red hit flash overlay (pure source-over using pre-baked silhouettes)
    if (hitFlash > 0 && sprite.flashCanvas) {
      ctx.save();
      const flashAlpha = Math.min(0.85, hitFlash * 4.5);
      const useRed = hitFlash > 0.08 && Math.floor(hitFlash * 30) % 2 === 1 && sprite.redFlashCanvas;
      ctx.globalAlpha = alpha * flashAlpha;
      ctx.drawImage(
        useRed ? sprite.redFlashCanvas : sprite.flashCanvas,
        -drawW * 0.5,
        -drawH,
        drawW,
        drawH
      );
      ctx.restore();
    }
  } else {
    // Safety fallback silhouette if sprite wasn't built
    ctx.fillStyle = state.color || '#3b82f6';
    drawRoundedRectPath(ctx, -drawW * 0.4, -drawH, drawW * 0.8, drawH, 12);
    ctx.fill();
  }

  // Attack / Strong slash arcs & charge sparks
  if (animState === 'attack') {
    drawSlashArc(ctx, drawW, drawH, state.color || sprite?.specialColor, false, t);
  } else if (animState === 'strong') {
    if (chargeRatio > 0 || t < 0.14) {
      drawChargeSparks(ctx, drawW, drawH, state.color || '#f59e0b', Math.max(chargeRatio, 0.35), t);
    } else {
      drawSlashArc(ctx, drawW, drawH, state.color || '#ef4444', true, t - 0.14);
    }
  } else if (animState === 'grab') {
    drawGrabHand(ctx, drawW, drawH, state.color || '#1f2937', t);
  }

  // Giant Hammer item!
  if (hasHammer) {
    drawHammer(ctx, drawW, drawH, t);
  }

  ctx.restore(); // end body transform

  // Shield bubble (un-rotated around fighter)
  if (shieldActive) {
    drawShieldBubble(ctx, drawW, drawH, shieldHp, state.color || '#3b82f6', t);
  }

  // Dizzy stars when stunned/dizzy
  if (animState === 'dizzy' || animState === 'stun') {
    drawDizzyStars(ctx, drawH, t);
  }

  ctx.restore(); // end facing & translate

  // Floating player name tag above head (never flipped horizontally!)
  drawPlayerTag(ctx, x, y - drawH + Math.min(0, offsetY), state);
}

export function renderThumbnail(canvasEl, strokes, stats = null) {
  if (!canvasEl) return;
  const w = canvasEl.width || 120;
  const h = canvasEl.height || 120;
  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const sprite = buildCharacterSprite(strokes, stats);
  if (!sprite || !sprite.fullCanvas) return;

  const pad = Math.max(2, Math.round(Math.min(w, h) * 0.1));
  const availW = Math.max(1, w - pad * 2);
  const availH = Math.max(1, h - pad * 2);
  const scale = Math.min(availW / sprite.width, availH / sprite.height);

  const drawW = sprite.width * scale;
  const drawH = sprite.height * scale;
  const dx = (w - drawW) * 0.5;
  const dy = (h - drawH) * 0.5;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sprite.fullCanvas, dx, dy, drawW, drawH);
  ctx.restore();
}

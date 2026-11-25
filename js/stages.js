import { STAGES } from './shared.js';

const STAGE_WIDTH = 1200;
const STAGE_HEIGHT = 700;
const DEFAULT_BLAST_ZONE = { left: -220, right: 1420, top: -240, bottom: 880 };

const STAGE_CONFIGS = {
  notebook: {
    id: 'notebook',
    name: '学校のノート',
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    blastZone: { ...DEFAULT_BLAST_ZONE },
    spawnPoints: [
      { x: 410, y: 430 },
      { x: 790, y: 430 },
      { x: 520, y: 300 },
      { x: 680, y: 300 },
    ],
    platforms: [
      { x: 290, y: 520, w: 620, h: 36, passThrough: false, style: 'notebook_main' },
      { x: 315, y: 390, w: 165, h: 20, passThrough: true, style: 'ruler' },
      { x: 720, y: 390, w: 165, h: 20, passThrough: true, style: 'eraser' },
      { x: 495, y: 268, w: 210, h: 18, passThrough: true, style: 'pencil' },
    ],
  },
  paper: {
    id: 'paper',
    name: '画用紙',
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    blastZone: { ...DEFAULT_BLAST_ZONE },
    spawnPoints: [
      { x: 430, y: 435 },
      { x: 770, y: 435 },
      { x: 342, y: 275 },
      { x: 858, y: 275 },
    ],
    platforms: [
      { x: 310, y: 525, w: 580, h: 38, passThrough: false, style: 'sketch_main' },
      { x: 255, y: 365, w: 175, h: 22, passThrough: true, style: 'crayon_red' },
      { x: 770, y: 365, w: 175, h: 22, passThrough: true, style: 'crayon_blue' },
      { x: 500, y: 265, w: 200, h: 20, passThrough: true, style: 'sticky_note' },
    ],
  },
  whiteboard: {
    id: 'whiteboard',
    name: 'ホワイトボード',
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    blastZone: { ...DEFAULT_BLAST_ZONE },
    spawnPoints: [
      { x: 400, y: 430 },
      { x: 800, y: 430 },
      { x: 432, y: 268 },
      { x: 768, y: 268 },
    ],
    platforms: [
      { x: 280, y: 520, w: 640, h: 34, passThrough: false, style: 'tray_main' },
      { x: 325, y: 360, w: 215, h: 20, passThrough: true, style: 'magnet_bar_blue' },
      { x: 660, y: 360, w: 215, h: 20, passThrough: true, style: 'magnet_bar_red' },
    ],
  },
};

export function getStageConfig(stageId) {
  const cfg = STAGE_CONFIGS[stageId] || STAGE_CONFIGS.notebook;
  const meta = Array.isArray(STAGES) ? STAGES.find((s) => s.id === cfg.id) : null;
  return {
    id: cfg.id,
    name: meta?.name || cfg.name,
    width: cfg.width,
    height: cfg.height,
    blastZone: { ...cfg.blastZone },
    spawnPoints: cfg.spawnPoints.map((p) => ({ ...p })),
    platforms: cfg.platforms.map((p) => ({ ...p })),
  };
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawSketchyRect(ctx, x, y, w, h, r, fill, stroke = '#1f2937', lineWidth = 2.6) {
  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

function drawNotebookBackground(ctx, width, height, time) {
  // Warm paper base
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, '#fffdf7');
  bgGrad.addColorStop(1, '#f7f3e8');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Horizontal notebook blue rules
  ctx.save();
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.28)';
  ctx.lineWidth = 1.25;
  for (let y = 52; y < height; y += 34) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Red vertical margin line
  ctx.strokeStyle = 'rgba(248, 113, 113, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(106, 0);
  ctx.lineTo(106, height);
  ctx.stroke();

  // Left binder ring holes
  for (let i = 0; i < 6; i++) {
    const hy = 72 + i * 110;
    ctx.beginPath();
    ctx.arc(46, hy, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#e5e0d5';
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.35)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Inner ring shadow
    ctx.beginPath();
    ctx.arc(44, hy - 1, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#d6d1c4';
    ctx.fill();
  }

  // Faint charming margin & corner pencil doodles
  ctx.strokeStyle = 'rgba(71, 85, 105, 0.16)';
  ctx.fillStyle = 'rgba(71, 85, 105, 0.16)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Top-right doodles: star + sun + subtle bobbing
  const bob = Math.sin(time * 1.4) * 3;
  drawDoodleStar(ctx, 1110, 88 + bob, 18);
  drawDoodleStar(ctx, 1055, 128 - bob * 0.7, 11);

  // Cute smiley doodle near left margin
  ctx.beginPath();
  ctx.arc(146, 122, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(140, 118, 2, 0, Math.PI * 2);
  ctx.arc(152, 118, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(146, 123, 7, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  // Faint "60s!" & math doodle
  ctx.font = 'bold 20px "Comic Sans MS", "Rounded Mplus 1c", sans-serif';
  ctx.fillText('1+1=2', 1072, 625);
  ctx.fillText('FIGHT!', 130, 640);

  // Tiny rocket doodle
  ctx.save();
  ctx.translate(152, 275 + Math.sin(time * 1.8) * 4);
  ctx.rotate(-0.35);
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.quadraticCurveTo(10, -4, 8, 12);
  ctx.lineTo(-8, 12);
  ctx.quadraticCurveTo(-10, -4, 0, -18);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-8, 8);
  ctx.lineTo(-14, 16);
  ctx.lineTo(-6, 12);
  ctx.moveTo(8, 8);
  ctx.lineTo(14, 16);
  ctx.lineTo(6, 12);
  ctx.stroke();
  ctx.restore();

  // Subtle spiral doodle
  ctx.save();
  ctx.translate(1118, 285);
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 5; a += 0.25) {
    const r = a * 1.45;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (a === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

function drawPaperBackground(ctx, width, height, time) {
  // Warm textured sketchbook paper
  const bgGrad = ctx.createRadialGradient(
    width * 0.5,
    height * 0.42,
    80,
    width * 0.5,
    height * 0.5,
    width * 0.72
  );
  bgGrad.addColorStop(0, '#fffaf0');
  bgGrad.addColorStop(1, '#f3e7d1');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle paper fibers / stipple dots (deterministic grid)
  ctx.save();
  ctx.fillStyle = 'rgba(180, 148, 106, 0.11)';
  for (let gx = 24; gx < width; gx += 46) {
    for (let gy = 20; gy < height; gy += 42) {
      const ox = ((gx * 17 + gy * 31) % 19) - 9;
      const oy = ((gx * 29 + gy * 13) % 17) - 8;
      ctx.fillRect(gx + ox, gy + oy, 2.2, 2.2);
    }
  }

  // Soft pastel watercolor blobs in the background
  const blobs = [
    { x: 185, y: 150, r: 95, c: 'rgba(251, 191, 36, 0.11)' },
    { x: 1030, y: 170, r: 105, c: 'rgba(96, 165, 250, 0.11)' },
    { x: 990, y: 580, r: 90, c: 'rgba(244, 114, 182, 0.10)' },
    { x: 170, y: 590, r: 85, c: 'rgba(52, 211, 153, 0.10)' },
  ];
  for (const b of blobs) {
    ctx.beginPath();
    ctx.arc(b.x, b.y + Math.sin(time + b.x) * 2, b.r, 0, Math.PI * 2);
    ctx.fillStyle = b.c;
    ctx.fill();
  }

  // Inner sketchbook border frame
  ctx.strokeStyle = 'rgba(146, 114, 78, 0.25)';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.strokeRect(26, 22, width - 52, height - 44);
  ctx.setLineDash([]);

  // Masking tape corners
  drawMaskingTape(ctx, 48, 36, -0.58, '#fde68a');
  drawMaskingTape(ctx, width - 48, 36, 0.58, '#bfdbfe');
  drawMaskingTape(ctx, 48, height - 36, 0.58, '#fbcfe8');
  drawMaskingTape(ctx, width - 48, height - 36, -0.58, '#bbf7d0');

  // Faint crayon sun & clouds
  ctx.strokeStyle = 'rgba(234, 179, 8, 0.22)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(1070, 105, 24, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + time * 0.15;
    ctx.beginPath();
    ctx.moveTo(1070 + Math.cos(a) * 30, 105 + Math.sin(a) * 30);
    ctx.lineTo(1070 + Math.cos(a) * 40, 105 + Math.sin(a) * 40);
    ctx.stroke();
  }

  ctx.restore();
}

function drawMaskingTape(ctx, cx, cy, angle, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.78;
  ctx.fillRect(-52, -13, 104, 26);
  ctx.strokeStyle = 'rgba(120, 113, 108, 0.35)';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(-52, -13, 104, 26);
  ctx.restore();
}

function drawWhiteboardBackground(ctx, width, height, time) {
  // Glossy off-white surface
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#ffffff');
  bgGrad.addColorStop(0.55, '#f8fafc');
  bgGrad.addColorStop(1, '#eef2f7');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  // Faint subtle dot grid
  ctx.fillStyle = 'rgba(148, 163, 184, 0.24)';
  for (let x = 40; x < width - 20; x += 40) {
    for (let y = 40; y < height - 20; y += 40) {
      ctx.fillRect(x, y, 2, 2);
    }
  }

  // Glossy diagonal light sheen
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.moveTo(180, 0);
  ctx.lineTo(360, 0);
  ctx.lineTo(120, height);
  ctx.lineTo(-40, height);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(860, 0);
  ctx.lineTo(940, 0);
  ctx.lineTo(700, height);
  ctx.lineTo(620, height);
  ctx.closePath();
  ctx.fill();

  // Faint dry-erase doodles on board
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.14)';
  ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.font = 'bold 28px "Comic Sans MS", sans-serif';
  ctx.fillText('VS!', 576, 132);
  ctx.beginPath();
  ctx.arc(600, 122, 42, 0, Math.PI * 2);
  ctx.stroke();

  // Faint green arrow & bar chart sketch
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.14)';
  ctx.beginPath();
  ctx.moveTo(92, 165);
  ctx.lineTo(92, 235);
  ctx.lineTo(175, 235);
  ctx.stroke();
  ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
  ctx.fillRect(106, 205, 14, 30);
  ctx.fillRect(128, 185, 14, 50);
  ctx.fillRect(150, 172, 14, 63);

  // Faint red star
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.15)';
  drawDoodleStar(ctx, 1085, 180 + Math.sin(time * 1.5) * 2, 22);

  // Aluminum outer frame
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, width - 14, height - 14);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, width - 24, height - 24);

  // Colorful corner magnets
  const magnets = [
    { x: 56, y: 56, c: '#ef4444' },
    { x: width - 56, y: 56, c: '#3b82f6' },
    { x: 56, y: height - 56, c: '#f59e0b' },
    { x: width - 56, y: height - 56, c: '#10b981' },
  ];
  for (const m of magnets) {
    ctx.beginPath();
    ctx.arc(m.x + 2, m.y + 4, 17, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.18)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(m.x, m.y, 16, 0, Math.PI * 2);
    ctx.fillStyle = m.c;
    ctx.fill();
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2.4;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(m.x - 5, m.y - 5, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fill();
  }

  ctx.restore();
}

function drawDoodleStar(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}

function drawPlatform(ctx, p, time) {
  const { x, y, w, h, style } = p;
  ctx.save();

  // Drop shadow under platform
  drawRoundedRect(ctx, x + 5, y + 7, w, h, 8);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
  ctx.fill();

  switch (style) {
    case 'notebook_main': {
      // Sturdy wooden desk / notebook bar
      drawSketchyRect(ctx, x, y, w, h, 10, '#d9a46c', '#1f2937', 3);
      // Top highlight strip
      drawRoundedRect(ctx, x + 4, y + 3, w - 8, 9, 5);
      ctx.fillStyle = '#ecc08d';
      ctx.fill();
      // Subtle wood grain lines
      ctx.strokeStyle = 'rgba(120, 68, 28, 0.35)';
      ctx.lineWidth = 1.6;
      for (let gx = x + 36; gx < x + w - 40; gx += 110) {
        ctx.beginPath();
        ctx.moveTo(gx, y + 20);
        ctx.quadraticCurveTo(gx + 34, y + 15, gx + 68, y + 22);
        ctx.stroke();
      }
      // Corner rivets / tape accents
      ctx.fillStyle = '#fef3c7';
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 2;
      ctx.fillRect(x + 18, y + 10, 12, 16);
      ctx.strokeRect(x + 18, y + 10, 12, 16);
      ctx.fillRect(x + w - 30, y + 10, 12, 16);
      ctx.strokeRect(x + w - 30, y + 10, 12, 16);
      break;
    }

    case 'ruler': {
      // Wooden school ruler
      drawSketchyRect(ctx, x, y, w, h, 4, '#f5d07a', '#1f2937', 2.4);
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 1.5;
      for (let rx = x + 12; rx < x + w - 8; rx += 12) {
        const tall = ((rx - x) / 12) % 5 === 0;
        ctx.beginPath();
        ctx.moveTo(rx, y + 1);
        ctx.lineTo(rx, y + (tall ? 11 : 6));
        ctx.stroke();
      }
      break;
    }

    case 'eraser': {
      // Classic Japanese blue-white-black plastic eraser
      drawSketchyRect(ctx, x, y, w, h, 5, '#ffffff', '#1f2937', 2.4);
      const sleeveX = x + 34;
      const sleeveW = w - 68;
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(sleeveX, y + 1, sleeveW, 7);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(sleeveX, y + 8, sleeveW, 5);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(sleeveX, y + 13, sleeveW, h - 14);
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 2;
      ctx.strokeRect(sleeveX, y + 1, sleeveW, h - 2);
      break;
    }

    case 'pencil': {
      // Yellow wooden pencil with pink eraser end and sharpened tip
      const bodyX = x + 24;
      const bodyW = w - 54;
      // Pink eraser cap
      drawSketchyRect(ctx, x, y + 1, 20, h - 2, 4, '#f472b6', '#1f2937', 2.2);
      // Metal ferrule
      drawSketchyRect(ctx, x + 17, y + 1, 10, h - 2, 1, '#cbd5e1', '#1f2937', 2.2);
      // Pencil hex body
      drawSketchyRect(ctx, bodyX, y, bodyW, h, 2, '#facc15', '#1f2937', 2.4);
      ctx.fillStyle = '#fde047';
      ctx.fillRect(bodyX + 2, y + 2, bodyW - 4, 5);
      ctx.fillStyle = '#eab308';
      ctx.fillRect(bodyX + 2, y + h - 6, bodyW - 4, 4);
      // Sharpened tip
      ctx.beginPath();
      ctx.moveTo(bodyX + bodyW, y + 1);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(bodyX + bodyW, y + h - 1);
      ctx.closePath();
      ctx.fillStyle = '#fde68a';
      ctx.fill();
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      // Graphite point
      ctx.beginPath();
      ctx.moveTo(x + w - 10, y + h / 2 - 3.5);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(x + w - 10, y + h / 2 + 3.5);
      ctx.closePath();
      ctx.fillStyle = '#1f2937';
      ctx.fill();
      break;
    }

    case 'sketch_main': {
      // Thick sketchbook board ledge with spiral rings along bottom
      drawSketchyRect(ctx, x, y, w, h, 10, '#fff7ed', '#1f2937', 3);
      // Colored crayon stripe across top edge
      drawRoundedRect(ctx, x + 6, y + 4, w - 12, 9, 4);
      ctx.fillStyle = '#fb923c';
      ctx.fill();
      // Colorful sketchbook bottom tabs (spaced cleanly within platform width)
      const tabColors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];
      const tabW = 50;
      const tabMargin = 38;
      const tabStep = (w - tabMargin * 2 - tabW) / (tabColors.length - 1);
      for (let i = 0; i < tabColors.length; i++) {
        const tx = x + tabMargin + i * tabStep;
        ctx.fillStyle = tabColors[i];
        ctx.fillRect(tx, y + h - 11, tabW, 8);
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 1.6;
        ctx.strokeRect(tx, y + h - 11, tabW, 8);
      }
      break;
    }

    case 'crayon_red':
    case 'crayon_blue': {
      const mainColor = style === 'crayon_red' ? '#ef4444' : '#3b82f6';
      const wrapperColor = style === 'crayon_red' ? '#fca5a5' : '#93c5fd';
      drawSketchyRect(ctx, x + 10, y, w - 20, h, 5, mainColor, '#1f2937', 2.4);
      // Crayon paper wrapper
      ctx.fillStyle = wrapperColor;
      ctx.fillRect(x + 42, y + 2, w - 84, h - 4);
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(x + 54, y + 2, 7, h - 4);
      ctx.fillRect(x + w - 61, y + 2, 7, h - 4);
      // Tapered crayon tip
      ctx.beginPath();
      if (style === 'crayon_red') {
        ctx.moveTo(x + w - 10, y + 2);
        ctx.lineTo(x + w + 4, y + h / 2);
        ctx.lineTo(x + w - 10, y + h - 2);
      } else {
        ctx.moveTo(x + 10, y + 2);
        ctx.lineTo(x - 4, y + h / 2);
        ctx.lineTo(x + 10, y + h - 2);
      }
      ctx.closePath();
      ctx.fillStyle = mainColor;
      ctx.fill();
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      break;
    }

    case 'sticky_note': {
      const wobble = Math.sin(time * 2.5) * 1.2;
      drawSketchyRect(ctx, x, y + wobble * 0.25, w, h, 4, '#fef08a', '#1f2937', 2.4);
      // Adhesive top strip
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x + 2, y + 2 + wobble * 0.25, w - 4, 6);
      // Cute pin in center
      ctx.beginPath();
      ctx.arc(x + w / 2, y + 6 + wobble * 0.25, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      break;
    }

    case 'tray_main': {
      // Sleek aluminum whiteboard marker tray
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, '#e2e8f0');
      grad.addColorStop(0.5, '#cbd5e1');
      grad.addColorStop(1, '#94a3b8');
      drawSketchyRect(ctx, x, y, w, h, 8, grad, '#1f2937', 2.8);
      // Metallic highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fillRect(x + 12, y + 4, w - 24, 5);
      // Decorative dry-erase markers resting inside tray edge
      drawMiniMarker(ctx, x + 80, y + 14, 72, '#ef4444');
      drawMiniMarker(ctx, x + 175, y + 14, 72, '#3b82f6');
      drawMiniMarker(ctx, x + w - 180, y + 14, 72, '#1f2937');
      // Board felt eraser on right
      drawSketchyRect(ctx, x + w - 95, y + 10, 62, 16, 4, '#f97316', '#1f2937', 1.8);
      break;
    }

    case 'magnet_bar_blue':
    case 'magnet_bar_red': {
      const barCol = style === 'magnet_bar_blue' ? '#38bdf8' : '#fb7185';
      drawSketchyRect(ctx, x, y, w, h, 10, barCol, '#1f2937', 2.4);
      // Gloss stripe
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      drawRoundedRect(ctx, x + 10, y + 3, w - 20, 5, 3);
      ctx.fill();
      // End magnet caps
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + 16, y + h / 2, 5, 0, Math.PI * 2);
      ctx.arc(x + w - 16, y + h / 2, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    default: {
      drawSketchyRect(ctx, x, y, w, h, 6, '#e2e8f0', '#1f2937', 2.4);
      break;
    }
  }

  // Subtle dashed guide indicator under pass-through platforms so players intuitively know they can jump through
  if (p.passThrough) {
    ctx.strokeStyle = 'rgba(31, 41, 55, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(x + 14, y + h + 4);
    ctx.lineTo(x + w - 14, y + h + 4);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // Subtle corner brackets highlighting grabbable ledge corners (崖つかまり)
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 1, y + 12);
    ctx.lineTo(x + 1, y + 2);
    ctx.lineTo(x + 12, y + 2);
    ctx.moveTo(x + w - 1, y + 12);
    ctx.lineTo(x + w - 1, y + 2);
    ctx.lineTo(x + w - 12, y + 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawMiniMarker(ctx, x, y, w, capColor) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, 10);
  ctx.fillStyle = capColor;
  ctx.fillRect(x, y, 22, 10);
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x, y, w, 10);
}

export function drawStage(ctx, stageId, width = STAGE_WIDTH, height = STAGE_HEIGHT, time = 0) {
  const cfg = getStageConfig(stageId);

  if (cfg.id === 'paper') {
    drawPaperBackground(ctx, width, height, time);
  } else if (cfg.id === 'whiteboard') {
    drawWhiteboardBackground(ctx, width, height, time);
  } else {
    drawNotebookBackground(ctx, width, height, time);
  }

  for (const platform of cfg.platforms) {
    drawPlatform(ctx, platform, time);
  }
}

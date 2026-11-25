import { CANVAS_SIZE, DEFAULT_STROKES, DRAW_PALETTE } from './shared.js';

const LOGICAL_SIZE = CANVAS_SIZE || 320;
const CHUNK_INTERVAL_MS = 35;
const CHUNK_POINT_THRESHOLD = 4;
const MIN_POINT_DIST_SQ = 0.0022 * 0.0022;

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function cloneStrokes(strokes) {
  if (!Array.isArray(strokes)) return [];
  return strokes
    .filter((s) => s && Array.isArray(s.points) && s.points.length > 0)
    .map((s, idx) => ({
      id: s.id || `st_${idx}`,
      tool: s.tool === 'eraser' ? 'eraser' : 'pen',
      color: typeof s.color === 'string' ? s.color : DRAW_PALETTE[0] || '#1f2937',
      width: typeof s.width === 'number' && s.width > 0 ? s.width : 7,
      points: s.points
        .filter((p) => Array.isArray(p) && p.length >= 2)
        .map((p) => [round4(clamp01(Number(p[0]) || 0)), round4(clamp01(Number(p[1]) || 0))]),
    }))
    .filter((s) => s.points.length > 0);
}

/**
 * Draw a single normalized stroke onto a 2D context.
 * Uses smooth midpoint quadratic curves and destination-out for erasers.
 */
export function drawStroke(ctx, stroke, width = LOGICAL_SIZE, height = LOGICAL_SIZE) {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length === 0) return;

  const scale = Math.min(width, height) / LOGICAL_SIZE;
  const isEraser = stroke.tool === 'eraser';
  const baseWidth = typeof stroke.width === 'number' && stroke.width > 0 ? stroke.width : 7;
  const lineWidth = Math.max(1, baseWidth * (isEraser ? 1.5 : 1) * scale);
  const pts = stroke.points;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;

  if (isEraser) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.fillStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color || '#1f2937';
    ctx.fillStyle = stroke.color || '#1f2937';
  }

  if (pts.length === 1) {
    const x = pts[0][0] * width;
    const y = pts[0][1] * height;
    ctx.beginPath();
    ctx.arc(x, y, lineWidth * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  const x0 = pts[0][0] * width;
  const y0 = pts[0][1] * height;
  ctx.moveTo(x0, y0);

  if (pts.length === 2) {
    ctx.lineTo(pts[1][0] * width, pts[1][1] * height);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const cx = pts[i][0] * width;
      const cy = pts[i][1] * height;
      const nx = pts[i + 1][0] * width;
      const ny = pts[i + 1][1] * height;
      const mx = (cx + nx) * 0.5;
      const my = (cy + ny) * 0.5;
      ctx.quadraticCurveTo(cx, cy, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0] * width, last[1] * height);
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * Render an array of strokes onto an ink canvas (transparent background, eraser applied cleanly).
 */
export function renderStrokesToInkCanvas(inkCtx, strokes, width = LOGICAL_SIZE, height = LOGICAL_SIZE) {
  inkCtx.clearRect(0, 0, width, height);
  if (!Array.isArray(strokes)) return;
  for (let i = 0; i < strokes.length; i++) {
    drawStroke(inkCtx, strokes[i], width, height);
  }
}

function drawSketchbookGuide(ctx, width, height, showCrosshair = true) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // Subtle cream sketchbook paper wash
  ctx.fillStyle = '#fffdf7';
  ctx.fillRect(0, 0, width, height);

  // Subtle graph grid
  const step = width / 16;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = step; x < width; x += step) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
  }
  for (let y = step; y < height; y += step) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
  }
  ctx.stroke();

  if (showCrosshair) {
    // Faint center crosshair + ground line guide
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.16)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(width * 0.5, height * 0.08);
    ctx.lineTo(width * 0.5, height * 0.92);
    ctx.moveTo(width * 0.08, height * 0.5);
    ctx.lineTo(width * 0.92, height * 0.5);
    ctx.stroke();

    // Subtle feet/ground guide line near bottom
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.15)';
    ctx.beginPath();
    ctx.moveTo(width * 0.14, height * 0.86);
    ctx.lineTo(width * 0.86, height * 0.86);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function createOffscreenCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function hasVisibleInk(inkCanvas) {
  const ctx = inkCanvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, inkCanvas.width, inkCanvas.height).data;
  for (let i = 3; i < data.length; i += 16) {
    if (data[i] > 20) return true;
  }
  return false;
}

function buildFallbackStrokes(fallbackColor) {
  const accent = fallbackColor || DRAW_PALETTE[6] || '#3b82f6';
  const base = Array.isArray(DEFAULT_STROKES) && DEFAULT_STROKES.length > 0
    ? cloneStrokes(DEFAULT_STROKES)
    : [
        // Fallback cute doodle if DEFAULT_STROKES were ever empty
        {
          id: 'def_head',
          tool: 'pen',
          color: accent,
          width: 8,
          points: [
            [0.5, 0.18], [0.61, 0.22], [0.64, 0.32], [0.59, 0.42],
            [0.5, 0.45], [0.41, 0.42], [0.36, 0.32], [0.39, 0.22], [0.5, 0.18],
          ],
        },
        {
          id: 'def_body',
          tool: 'pen',
          color: accent,
          width: 9,
          points: [[0.5, 0.45], [0.5, 0.7]],
        },
        {
          id: 'def_arms',
          tool: 'pen',
          color: accent,
          width: 8,
          points: [[0.28, 0.53], [0.5, 0.56], [0.73, 0.48]],
        },
        {
          id: 'def_leg_l',
          tool: 'pen',
          color: accent,
          width: 8,
          points: [[0.5, 0.7], [0.38, 0.87]],
        },
        {
          id: 'def_leg_r',
          tool: 'pen',
          color: accent,
          width: 8,
          points: [[0.5, 0.7], [0.63, 0.87]],
        },
        {
          id: 'def_eye_l',
          tool: 'pen',
          color: '#1f2937',
          width: 6,
          points: [[0.45, 0.3]],
        },
        {
          id: 'def_eye_r',
          tool: 'pen',
          color: '#1f2937',
          width: 6,
          points: [[0.56, 0.3]],
        },
        {
          id: 'def_smile',
          tool: 'pen',
          color: '#1f2937',
          width: 5,
          points: [[0.45, 0.37], [0.5, 0.4], [0.56, 0.37]],
        },
      ];

  // Tint body/accent strokes with player's fallback color while preserving crisp eyes & smile
  return base.map((stroke, idx) => {
    const sid = String(stroke.id || '').toLowerCase();
    const isEye = sid.includes('eye');
    const isSmile = sid.includes('smile') || sid.includes('mouth');
    const isHeadband = sid.includes('headband') || sid.includes('ribbon');
    let nextColor = stroke.color;
    if (isEye) {
      nextColor = '#1f2937';
    } else if (isSmile) {
      nextColor = '#ef4444';
    } else if (isHeadband) {
      nextColor = accent;
    } else if (!sid.includes('head')) {
      nextColor = accent;
    }
    return {
      ...stroke,
      id: `fallback_${idx}_${Date.now().toString(36)}`,
      color: nextColor,
    };
  });
}

export class DrawingPad {
  constructor(canvasEl, options = {}) {
    if (!canvasEl) throw new Error('DrawingPad requires a canvas element');

    this.canvas = canvasEl;
    this.canvas.width = LOGICAL_SIZE;
    this.canvas.height = LOGICAL_SIZE;
    this.canvas.style.touchAction = 'none';
    this.ctx = this.canvas.getContext('2d');

    this.inkCanvas = createOffscreenCanvas(LOGICAL_SIZE, LOGICAL_SIZE);
    this.inkCtx = this.inkCanvas.getContext('2d');

    this.options = {
      onStrokeChunk: options.onStrokeChunk || null,
      onStrokeEnd: options.onStrokeEnd || null,
      onUndo: options.onUndo || null,
      onClear: options.onClear || null,
      onChange: options.onChange || null,
    };

    this.tool = 'pen';
    this.color = DRAW_PALETTE[0] || '#1f2937';
    this.size = 7;
    this.enabled = true;

    this.strokes = [];
    this._strokeSeq = 0;
    this._activePointerId = null;
    this._currentStroke = null;
    this._pendingPoints = [];
    this._lastFlushTime = 0;
    this._flushTimer = null;

    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onPointerCancel = this._handlePointerCancel.bind(this);

    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.canvas.addEventListener('pointermove', this._onPointerMove);
    this.canvas.addEventListener('pointerup', this._onPointerUp);
    this.canvas.addEventListener('pointercancel', this._onPointerCancel);

    this.redraw();
  }

  setTool(tool) {
    this.tool = tool === 'eraser' ? 'eraser' : 'pen';
  }

  setColor(hex) {
    if (typeof hex === 'string' && hex.length > 0) {
      this.color = hex;
    }
  }

  setSize(px) {
    const num = Number(px);
    if (!Number.isNaN(num) && num > 0) {
      this.size = Math.max(1, Math.min(40, num));
    }
  }

  setEnabled(bool) {
    const next = Boolean(bool);
    if (!next && this._currentStroke) {
      this._finishCurrentStroke();
    }
    this.enabled = next;
  }

  getStrokes() {
    return cloneStrokes(this.strokes);
  }

  loadStrokes(strokes) {
    if (this._currentStroke) {
      this._finishCurrentStroke();
    }
    this.strokes = cloneStrokes(strokes);
    this.redraw();
    if (this.options.onChange) {
      this.options.onChange(this.getStrokes());
    }
  }

  undo() {
    if (this._currentStroke) {
      this._finishCurrentStroke();
    }
    if (this.strokes.length === 0) return null;
    const removed = this.strokes.pop();
    this.redraw();
    if (this.options.onUndo) {
      this.options.onUndo(removed.id);
    }
    if (this.options.onChange) {
      this.options.onChange(this.getStrokes());
    }
    return removed;
  }

  clear() {
    this._cancelFlushTimer();
    this._activePointerId = null;
    this._currentStroke = null;
    this._pendingPoints = [];
    this.strokes = [];
    this.redraw();
    if (this.options.onClear) {
      this.options.onClear();
    }
    if (this.options.onChange) {
      this.options.onChange([]);
    }
  }

  ensureNonEmpty(fallbackColor) {
    if (this._currentStroke) {
      this._finishCurrentStroke();
    }
    const hasPenStroke = this.strokes.some(
      (s) => s.tool !== 'eraser' && Array.isArray(s.points) && s.points.length > 0
    );
    if (hasPenStroke && hasVisibleInk(this.inkCanvas)) {
      return this.getStrokes();
    }

    const fallback = buildFallbackStrokes(fallbackColor || this.color);
    this.strokes = fallback;
    this.redraw();
    if (this.options.onChange) {
      this.options.onChange(this.getStrokes());
    }
    return this.getStrokes();
  }

  redraw() {
    renderStrokesToInkCanvas(this.inkCtx, this.strokes, LOGICAL_SIZE, LOGICAL_SIZE);
    this._composite();
  }

  destroy() {
    this._cancelFlushTimer();
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('pointercancel', this._onPointerCancel);
    this._currentStroke = null;
    this._activePointerId = null;
    this._pendingPoints = [];
  }

  _composite() {
    drawSketchbookGuide(this.ctx, LOGICAL_SIZE, LOGICAL_SIZE, true);
    this.ctx.drawImage(this.inkCanvas, 0, 0);
  }

  _getNormalizedPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || LOGICAL_SIZE;
    const h = rect.height || LOGICAL_SIZE;
    const nx = round4(clamp01((e.clientX - rect.left) / w));
    const ny = round4(clamp01((e.clientY - rect.top) / h));
    return [nx, ny];
  }

  _handlePointerDown(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this._activePointerId !== null) return;

    e.preventDefault();
    this._activePointerId = e.pointerId;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch (_) {
      // Ignore synthetic events without active pointer capture
    }

    const pt = this._getNormalizedPoint(e);
    const id = `s_${Date.now().toString(36)}_${(++this._strokeSeq).toString(36)}`;
    const stroke = {
      id,
      tool: this.tool,
      color: this.tool === 'eraser' ? '#ffffff' : this.color,
      width: this.size,
      points: [pt],
    };

    this.strokes.push(stroke);
    this._currentStroke = stroke;
    this._pendingPoints = [pt];
    this._lastFlushTime = performance.now();

    drawStroke(this.inkCtx, stroke, LOGICAL_SIZE, LOGICAL_SIZE);
    this._composite();

    this._scheduleFlush();
  }

  _handlePointerMove(e) {
    if (!this.enabled || !this._currentStroke || e.pointerId !== this._activePointerId) return;
    e.preventDefault();

    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    const list = events && events.length > 0 ? events : [e];
    let added = false;

    for (let i = 0; i < list.length; i++) {
      const pt = this._getNormalizedPoint(list[i]);
      const pts = this._currentStroke.points;
      const prev = pts[pts.length - 1];
      const dx = pt[0] - prev[0];
      const dy = pt[1] - prev[1];
      if (dx * dx + dy * dy < MIN_POINT_DIST_SQ) continue;

      pts.push(pt);
      this._pendingPoints.push(pt);
      added = true;
    }

    if (!added) return;

    // Redraw ink layer smoothly when erasing or keep smooth curves accurate
    if (this._currentStroke.tool === 'eraser' || this._currentStroke.points.length <= 2) {
      drawStroke(this.inkCtx, this._currentStroke, LOGICAL_SIZE, LOGICAL_SIZE);
    } else {
      // Draw only the latest quadratic segment for fast, smooth pen strokes
      const pts = this._currentStroke.points;
      const n = pts.length;
      const p0 = pts[n - 3];
      const p1 = pts[n - 2];
      const p2 = pts[n - 1];
      const scale = 1;
      const lw = Math.max(1, this._currentStroke.width * scale);

      this.inkCtx.save();
      this.inkCtx.globalCompositeOperation = 'source-over';
      this.inkCtx.lineCap = 'round';
      this.inkCtx.lineJoin = 'round';
      this.inkCtx.lineWidth = lw;
      this.inkCtx.strokeStyle = this._currentStroke.color;

      const x0 = p0[0] * LOGICAL_SIZE;
      const y0 = p0[1] * LOGICAL_SIZE;
      const x1 = p1[0] * LOGICAL_SIZE;
      const y1 = p1[1] * LOGICAL_SIZE;
      const x2 = p2[0] * LOGICAL_SIZE;
      const y2 = p2[1] * LOGICAL_SIZE;

      const m0x = n === 3 ? x0 : (x0 + x1) * 0.5;
      const m0y = n === 3 ? y0 : (y0 + y1) * 0.5;
      const m1x = (x1 + x2) * 0.5;
      const m1y = (y1 + y2) * 0.5;

      this.inkCtx.beginPath();
      this.inkCtx.moveTo(m0x, m0y);
      this.inkCtx.quadraticCurveTo(x1, y1, m1x, m1y);
      this.inkCtx.stroke();
      this.inkCtx.restore();
    }

    this._composite();

    const now = performance.now();
    if (
      this._pendingPoints.length >= CHUNK_POINT_THRESHOLD ||
      now - this._lastFlushTime >= CHUNK_INTERVAL_MS
    ) {
      this._flushPendingChunk();
    } else {
      this._scheduleFlush();
    }
  }

  _handlePointerUp(e) {
    if (e.pointerId !== this._activePointerId) return;
    e.preventDefault();
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch (_) {
      // Ignore
    }
    this._finishCurrentStroke();
  }

  _handlePointerCancel(e) {
    if (e.pointerId !== this._activePointerId) return;
    this._finishCurrentStroke();
  }

  _finishCurrentStroke() {
    this._cancelFlushTimer();
    if (!this._currentStroke) {
      this._activePointerId = null;
      return;
    }

    const finished = this._currentStroke;
    // Draw tail segment accurately on ink layer
    drawStroke(this.inkCtx, finished, LOGICAL_SIZE, LOGICAL_SIZE);
    this._composite();

    this._flushPendingChunk();

    this._currentStroke = null;
    this._activePointerId = null;
    this._pendingPoints = [];

    if (this.options.onStrokeEnd) {
      this.options.onStrokeEnd(finished.id);
    }
    if (this.options.onChange) {
      this.options.onChange(this.getStrokes());
    }
  }

  _scheduleFlush() {
    if (this._flushTimer !== null) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._flushPendingChunk();
    }, CHUNK_INTERVAL_MS);
  }

  _cancelFlushTimer() {
    if (this._flushTimer !== null) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
  }

  _flushPendingChunk() {
    if (!this._currentStroke || this._pendingPoints.length === 0) return;
    const batch = this._pendingPoints;
    this._pendingPoints = [];
    this._lastFlushTime = performance.now();

    if (this.options.onStrokeChunk) {
      const meta = {
        id: this._currentStroke.id,
        tool: this._currentStroke.tool,
        color: this._currentStroke.color,
        width: this._currentStroke.width,
      };
      this.options.onStrokeChunk(meta, batch);
    }
  }
}

export class RemotePreviewPad {
  constructor(canvasEl) {
    if (!canvasEl) throw new Error('RemotePreviewPad requires a canvas element');

    this.canvas = canvasEl;
    this.canvas.width = LOGICAL_SIZE;
    this.canvas.height = LOGICAL_SIZE;
    this.ctx = this.canvas.getContext('2d');

    this.inkCanvas = createOffscreenCanvas(LOGICAL_SIZE, LOGICAL_SIZE);
    this.inkCtx = this.inkCanvas.getContext('2d');

    this.strokes = [];
    this._strokeMap = new Map();

    this.redraw();
  }

  applyChunk(strokeMeta, points) {
    if (!strokeMeta || !strokeMeta.id || !Array.isArray(points) || points.length === 0) return;

    const cleanPoints = points
      .filter((p) => Array.isArray(p) && p.length >= 2)
      .map((p) => [round4(clamp01(Number(p[0]) || 0)), round4(clamp01(Number(p[1]) || 0))]);
    if (cleanPoints.length === 0) return;

    let stroke = this._strokeMap.get(strokeMeta.id);
    let isNew = false;
    if (!stroke) {
      isNew = true;
      stroke = {
        id: strokeMeta.id,
        tool: strokeMeta.tool === 'eraser' ? 'eraser' : 'pen',
        color: typeof strokeMeta.color === 'string' ? strokeMeta.color : '#1f2937',
        width: typeof strokeMeta.width === 'number' && strokeMeta.width > 0 ? strokeMeta.width : 7,
        points: [],
      };
      this.strokes.push(stroke);
      this._strokeMap.set(stroke.id, stroke);
    }

    const prevLen = stroke.points.length;
    for (let i = 0; i < cleanPoints.length; i++) {
      stroke.points.push(cleanPoints[i]);
    }

    // Fast path: if this is the latest stroke and it's a pen or eraser, draw just the updated tail or redraw cleanly
    const isLatest = this.strokes[this.strokes.length - 1] === stroke;
    if (isLatest && (isNew || prevLen === 0 || stroke.tool === 'eraser')) {
      drawStroke(this.inkCtx, stroke, LOGICAL_SIZE, LOGICAL_SIZE);
      this._composite();
    } else if (isLatest) {
      // Draw only the appended overlapping slice to avoid full replay on every chunk
      const sliceStart = Math.max(0, prevLen - 2);
      const subStroke = {
        ...stroke,
        points: stroke.points.slice(sliceStart),
      };
      drawStroke(this.inkCtx, subStroke, LOGICAL_SIZE, LOGICAL_SIZE);
      this._composite();
    } else {
      this.redraw();
    }
  }

  endStroke(strokeId) {
    const stroke = this._strokeMap.get(strokeId);
    if (!stroke) return;
    if (this.strokes[this.strokes.length - 1] === stroke) {
      drawStroke(this.inkCtx, stroke, LOGICAL_SIZE, LOGICAL_SIZE);
      this._composite();
    } else {
      this.redraw();
    }
  }

  applyUndo(strokeId) {
    if (this.strokes.length === 0) return;
    if (strokeId && this._strokeMap.has(strokeId)) {
      this._strokeMap.delete(strokeId);
      this.strokes = this.strokes.filter((s) => s.id !== strokeId);
    } else {
      const removed = this.strokes.pop();
      if (removed) this._strokeMap.delete(removed.id);
    }
    this.redraw();
  }

  clear() {
    this.strokes = [];
    this._strokeMap.clear();
    this.redraw();
  }

  setStrokes(strokes) {
    this.strokes = cloneStrokes(strokes);
    this._strokeMap.clear();
    for (let i = 0; i < this.strokes.length; i++) {
      this._strokeMap.set(this.strokes[i].id, this.strokes[i]);
    }
    this.redraw();
  }

  redraw() {
    renderStrokesToInkCanvas(this.inkCtx, this.strokes, LOGICAL_SIZE, LOGICAL_SIZE);
    this._composite();
  }

  _composite() {
    drawSketchbookGuide(this.ctx, LOGICAL_SIZE, LOGICAL_SIZE, false);
    this.ctx.drawImage(this.inkCanvas, 0, 0);
  }
}

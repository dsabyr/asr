import { useRef, useEffect, useState, useCallback } from 'react';
import { renderCAMGrid } from '../cam/renderer.js';
import { WORLD_W, WORLD_H, WORLD_STEP, INTER_PX, GRID_SIZE } from '../cam/constants.js';

const CANVAS_H = 720;
const MIN_ZOOM = 0.22;
const MAX_ZOOM = 9;

export default function CAMCanvas({ camGrid, onSelectIntersection }) {
  const canvasRef = useRef(null);
  const wrapRef   = useRef(null);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [sel, setSel]   = useState({ ix: null, iy: null });
  const dragRef   = useRef({ active: false, moved: false, sx: 0, sy: 0, px: 0, py: 0 });
  const pinchRef  = useRef(null);

  useEffect(() => {
    const w    = wrapRef.current?.clientWidth || 640;
    const zoom = Math.min(w / WORLD_W, CANVAS_H / WORLD_H) * 0.94;
    const panX = (w - WORLD_W * zoom) / 2;
    const panY = (CANVAS_H - WORLD_H * zoom) / 2;
    canvasRef.current.width  = w;
    canvasRef.current.height = CANVAS_H;
    setView({ zoom, panX, panY });
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !camGrid) return;
    const id = requestAnimationFrame(() => {
      renderCAMGrid(canvasRef.current, camGrid, view.zoom, view.panX, view.panY, sel.ix, sel.iy);
    });
    return () => cancelAnimationFrame(id);
  }, [camGrid, view, sel]);

  const applyZoom = useCallback((factor, cx, cy) => {
    setView(v => {
      const nz  = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      let panX  = cx - (cx - v.panX) * (nz / v.zoom);
      let panY  = cy - (cy - v.panY) * (nz / v.zoom);
      const cw  = canvasRef.current?.width  || 640;
      const ch  = canvasRef.current?.height || CANVAS_H;
      const ww  = WORLD_W * nz, wh = WORLD_H * nz;
      panX = ww <= cw ? (cw-ww)/2 : Math.min(0, Math.max(cw-ww, panX));
      panY = wh <= ch ? (ch-wh)/2 : Math.min(0, Math.max(ch-wh, panY));
      return { zoom: nz, panX, panY };
    });
  }, []);

  const onWheel = useCallback(e => {
    e.preventDefault();
    const r = canvasRef.current.getBoundingClientRect();
    applyZoom(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - r.left, e.clientY - r.top);
  }, [applyZoom]);

  useEffect(() => {
    const el = canvasRef.current;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const onPointerDown = e => {
    dragRef.current = { active: true, moved: false, sx: e.clientX, sy: e.clientY, px: view.panX, py: view.panY };
    canvasRef.current.setPointerCapture(e.pointerId);
    canvasRef.current.style.cursor = 'grabbing';
  };

  const onPointerMove = e => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragRef.current.moved = true;
    setView(v => {
      const cw  = canvasRef.current?.width  || 640;
      const ch  = canvasRef.current?.height || CANVAS_H;
      const ww  = WORLD_W * v.zoom, wh = WORLD_H * v.zoom;
      let panX  = dragRef.current.px + dx;
      let panY  = dragRef.current.py + dy;
      panX = ww <= cw ? (cw-ww)/2 : Math.min(0, Math.max(cw-ww, panX));
      panY = wh <= ch ? (ch-wh)/2 : Math.min(0, Math.max(ch-wh, panY));
      return { ...v, panX, panY };
    });
  };

  const onPointerUp = e => {
    canvasRef.current.style.cursor = 'grab';
    if (!dragRef.current.moved) {
      const r  = canvasRef.current.getBoundingClientRect();
      const mx = (e.clientX - r.left - view.panX) / view.zoom;
      const my = (e.clientY - r.top  - view.panY) / view.zoom;
      _hitTest(mx, my, sel, setSel, onSelectIntersection);
    }
    dragRef.current.active = false;
  };

  const onTouchMove = e => {
    if (e.touches.length !== 2) { pinchRef.current = null; return; }
    e.preventDefault();
    const d = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    if (pinchRef.current) {
      const r = canvasRef.current.getBoundingClientRect();
      applyZoom(d / pinchRef.current,
        (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left,
        (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top
      );
    }
    pinchRef.current = d;
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', overflow: 'hidden', borderRadius: 8, touchAction: 'none' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onTouchMove={onTouchMove}
        onTouchEnd={() => { pinchRef.current = null; }}
      />
    </div>
  );
}

function _hitTest(mx, my, sel, setSel, onSelect) {
  let best = null, bestD = Infinity;
  for (let iy = 0; iy < GRID_SIZE; iy++) {
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      const cx = ix * WORLD_STEP + INTER_PX / 2;
      const cy = iy * WORLD_STEP + INTER_PX / 2;
      const d  = Math.hypot(mx - cx, my - cy);
      if (d < INTER_PX && d < bestD) { bestD = d; best = [ix, iy]; }
    }
  }
  if (best) {
    setSel({ ix: best[0], iy: best[1] });
    onSelect?.(best[0], best[1]);
  } else {
    setSel({ ix: null, iy: null });
    onSelect?.(null, null);
  }
}

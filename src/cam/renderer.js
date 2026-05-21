import { CELL_PX, INTER_PX, SEG_PX, ROAD_PX, WORLD_STEP,
         LANES, SEG_CELLS, INTER_CELLS, TURN_POCKET, GRID_SIZE } from './constants.js';
import { getSeg } from './grid.js';

function vColor(v) {
  if (v === 0) return '#4DA6E8';   // stopped — muted blue
  if (v <= 2)  return '#5CB85C';   // slow — green
  return '#F0A500';                 // moving — amber
}

function iOrig(ix, iy) {
  return { x: ix * WORLD_STEP, y: iy * WORLD_STEP };
}

export function renderCAMGrid(canvas, camGrid, zoom, panX, panY, selIx, selIy) {
  const ctx  = canvas.getContext('2d');

  const colors = {
    bg:        '#EDE8DC',   // warm beige land
    road:      '#FFFFFF',   // white road surface
    divider:   '#C8C3B8',   // warm grey center line
    emptyFill: 'rgba(180,170,155,0.18)',
    emptyStr:  'rgba(150,140,125,0.25)',
    pocket:    'rgba(212,83,126,0.13)',
    pocketStr: 'rgba(212,83,126,0.28)',
    interNS:   'rgba(29,158,117,0.18)',
    interEW:   'rgba(56,138,221,0.16)',
    interYel:  'rgba(239,159,39,0.16)',
    interSel:  'rgba(239,159,39,0.32)',
    strNS:     '#1A9268',
    strEW:     '#2E7FC0',
    strYel:    '#D4890A',
    strSel:    '#D4890A',
    incident:  '#D63B3B',
    pocketCar: '#C0456E',
    gridLine:  'rgba(150,140,125,0.20)',
    divLine:   'rgba(120,110,95,0.30)',
    label:     'rgba(60,50,35,0.55)',
  };

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  const C = CELL_PX;
  const m = 0.8;

  // 1. Road surface
  for (let iy = 0; iy < GRID_SIZE; iy++) {
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      const o = iOrig(ix, iy);
      if (ix < GRID_SIZE - 1) {
        ctx.fillStyle = colors.road;
        ctx.fillRect(o.x + INTER_PX, o.y, SEG_PX, ROAD_PX * 2);
        ctx.fillStyle = colors.divider;
        ctx.fillRect(o.x + INTER_PX, o.y + ROAD_PX - 0.8, SEG_PX, 1.6);
      }
      if (iy < GRID_SIZE - 1) {
        ctx.fillStyle = colors.road;
        ctx.fillRect(o.x, o.y + INTER_PX, ROAD_PX * 2, SEG_PX);
        ctx.fillStyle = colors.divider;
        ctx.fillRect(o.x + ROAD_PX - 0.8, o.y + INTER_PX, 1.6, SEG_PX);
      }
    }
  }

  // 2. Segment cells
  for (let iy = 0; iy < GRID_SIZE; iy++) {
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      const o = iOrig(ix, iy);

      if (ix < GRID_SIZE - 1) {
        const segEW = getSeg(camGrid, ix, iy, ix+1, iy);
        const segWE = getSeg(camGrid, ix+1, iy, ix, iy);
        for (let lane = 0; lane < LANES; lane++) {
          for (let ci = 0; ci < SEG_CELLS; ci++) {
            const wx      = o.x + INTER_PX + ci * C;
            const isPktEW = ci >= SEG_CELLS - TURN_POCKET && lane === 0;
            const isPktWE = ci >= SEG_CELLS - TURN_POCKET && lane === LANES - 1;

            _drawCell(ctx, C, m, wx, o.y + lane * C,
              segEW?.cells[lane][ci] ?? -1,
              segEW?.incident && ci === segEW.incidentCell ? 'incident'
                : isPktEW ? 'pocket' : 'normal', colors);

            const riWE = SEG_CELLS - 1 - ci;
            _drawCell(ctx, C, m, wx, o.y + ROAD_PX + (LANES-1-lane) * C,
              segWE?.cells[lane][riWE] ?? -1,
              segWE?.incident && riWE === segWE.incidentCell ? 'incident'
                : isPktWE ? 'pocket' : 'normal', colors);
          }
        }
      }

      if (iy < GRID_SIZE - 1) {
        const segNS = getSeg(camGrid, ix, iy, ix, iy+1);
        const segSN = getSeg(camGrid, ix, iy+1, ix, iy);
        for (let lane = 0; lane < LANES; lane++) {
          for (let ci = 0; ci < SEG_CELLS; ci++) {
            const wy      = o.y + INTER_PX + ci * C;
            const isPktNS = ci >= SEG_CELLS - TURN_POCKET && lane === 0;
            const isPktSN = ci >= SEG_CELLS - TURN_POCKET && lane === LANES - 1;

            _drawCell(ctx, C, m, o.x + ROAD_PX + lane * C, wy,
              segNS?.cells[lane][ci] ?? -1,
              segNS?.incident && ci === segNS.incidentCell ? 'incident'
                : isPktNS ? 'pocket' : 'normal', colors);

            const riSN = SEG_CELLS - 1 - ci;
            _drawCell(ctx, C, m, o.x + (LANES-1-lane) * C, wy,
              segSN?.cells[lane][riSN] ?? -1,
              segSN?.incident && riSN === segSN.incidentCell ? 'incident'
                : isPktSN ? 'pocket' : 'normal', colors);
          }
        }
      }
    }
  }

  // 3. Intersection conflict zones
  for (let iy = 0; iy < GRID_SIZE; iy++) {
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      const inter = camGrid.intersections[iy][ix];
      const o     = iOrig(ix, iy);
      const sel   = selIx === ix && selIy === iy;
      const p     = inter.phase;

      let bgC, strC, strW;
      if (sel)             { bgC = colors.interSel; strC = colors.strSel; strW = 2 / zoom; }
      else if (p === 'NS') { bgC = colors.interNS;  strC = colors.strNS;  strW = 1.5 / zoom; }
      else if (p === 'EW') { bgC = colors.interEW;  strC = colors.strEW;  strW = 1.5 / zoom; }
      else                 { bgC = colors.interYel;  strC = colors.strYel; strW = 1.2 / zoom; }

      ctx.fillStyle   = bgC;
      ctx.strokeStyle = strC;
      ctx.lineWidth   = strW;
      ctx.beginPath();
      ctx.rect(o.x, o.y, INTER_PX, INTER_PX);
      ctx.fill(); ctx.stroke();

      for (let r = 1; r < INTER_CELLS; r++) {
        ctx.strokeStyle = r === LANES ? colors.divLine : colors.gridLine;
        ctx.lineWidth   = (r === LANES ? 1.0 : 0.4) / zoom;
        ctx.beginPath();
        ctx.moveTo(o.x, o.y + r * C); ctx.lineTo(o.x + INTER_PX, o.y + r * C);
        ctx.stroke();
      }
      for (let c = 1; c < INTER_CELLS; c++) {
        ctx.strokeStyle = c === LANES ? colors.divLine : colors.gridLine;
        ctx.lineWidth   = (c === LANES ? 1.0 : 0.4) / zoom;
        ctx.beginPath();
        ctx.moveTo(o.x + c * C, o.y); ctx.lineTo(o.x + c * C, o.y + INTER_PX);
        ctx.stroke();
      }

      for (let r = 0; r < INTER_CELLS; r++) {
        for (let c = 0; c < INTER_CELLS; c++) {
          const v = inter.grid[r][c];
          if (v >= 0) {
            ctx.fillStyle = vColor(v);
            ctx.beginPath();
            ctx.roundRect(o.x + c*C + m, o.y + r*C + m, C-m*2, C-m*2, 1.2);
            ctx.fill();
          }
        }
      }

      const dr2  = Math.max(1.8, C * 0.28);
      const nsC2 = (p==='NS') ? '#1D9E75' : (p.includes('YELLOW')) ? '#EF9F27' : '#E24B4A';
      const ewC2 = (p==='EW') ? '#1D9E75' : (p.includes('YELLOW')) ? '#EF9F27' : '#E24B4A';
      ctx.fillStyle = nsC2;
      ctx.beginPath(); ctx.arc(o.x + INTER_PX*0.18, o.y + INTER_PX*0.18, dr2, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = ewC2;
      ctx.beginPath(); ctx.arc(o.x + INTER_PX*0.82, o.y + INTER_PX*0.18, dr2, 0, Math.PI*2); ctx.fill();

      if (zoom > 1.5) {
        ctx.fillStyle    = colors.label;
        ctx.font         = `${Math.round(C * 1.1)}px monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${ix},${iy}`, o.x + INTER_PX/2, o.y + INTER_PX * 0.72);
      }
    }
  }

  ctx.restore();
}

function _drawCell(ctx, C, m, wx, wy, v, type, colors) {
  if (type === 'incident') {
    ctx.fillStyle = colors.incident;
    ctx.beginPath(); ctx.roundRect(wx+m, wy+m, C-m*2, C-m*2, 1.2); ctx.fill();
  } else if (type === 'pocket') {
    ctx.fillStyle = v >= 0 ? colors.pocketCar : colors.pocket;
    if (v < 0) {
      ctx.strokeStyle = colors.pocketStr; ctx.lineWidth = 0.4;
      ctx.beginPath(); ctx.roundRect(wx+m, wy+m, C-m*2, C-m*2, 1.2); ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.roundRect(wx+m, wy+m, C-m*2, C-m*2, 1.2); ctx.fill();
    }
  } else if (v >= 0) {
    ctx.fillStyle = vColor(v);
    ctx.beginPath(); ctx.roundRect(wx+m, wy+m, C-m*2, C-m*2, 1.2); ctx.fill();
  } else {
    ctx.fillStyle   = colors.emptyFill;
    ctx.strokeStyle = colors.emptyStr;
    ctx.lineWidth   = 0.4;
    ctx.beginPath(); ctx.roundRect(wx+m, wy+m, C-m*2, C-m*2, 1.2); ctx.fill(); ctx.stroke();
  }
}

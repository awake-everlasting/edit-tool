// 하늘빛 사진첩 - 콜라주 편집 기능
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const MAX_PHOTOS = 4;
  const CELL = { '1:1': [800, 800], '4:5': [800, 1000], '16:9': [800, 450] };
  const FONTS = {
    nanum: '"Nanum Gothic", sans-serif',
    jua: '"Jua", sans-serif',
    gaegu: '"Gaegu", cursive',
    galmuri: '"Galmuri11", monospace'
  };

  const state = {
    photos: [],                 // {img, zoom, ox, oy}
    layout: 'horizontal',
    ratio: '1:1',
    gap: 16,
    bg: '#ffffff',
    caption: { text: '', font: 'nanum', size: 48, color: '#ffffff' }
  };

  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d');
  const stage = $('#stage');
  const wrap = $('#canvasWrap');
  const fileInput = $('#fileInput');
  let L = null;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function randomName() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const arr = new Uint8Array(10);
    crypto.getRandomValues(arr);
    return 'collage_' + [...arr].map((v) => chars[v % chars.length]).join('') + '.png';
  }

  /* ---------- 아코디언 탭 ---------- */
  $$('.tab[data-acc]').forEach((tab) => tab.addEventListener('click', () => {
    const name = tab.dataset.acc;
    const willOpen = tab.getAttribute('aria-expanded') !== 'true';
    $$('.tab[data-acc]').forEach((t) => {
      const open = willOpen && t.dataset.acc === name;
      t.setAttribute('aria-expanded', String(open));
      $('#acc-' + t.dataset.acc).classList.toggle('open', open);
    });
    if (willOpen) {
      setTimeout(() => $('#acc-' + name).scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 260);
    }
  }));

  /* ---------- 사진 불러오기 ---------- */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load')); };
      img.src = url;
    });
  }

  async function addFiles(list) {
    const files = [...list].filter((f) => !f.type || f.type.startsWith('image/'));
    if (!files.length) return;
    const room = MAX_PHOTOS - state.photos.length;
    if (room <= 0) { toast('사진은 최대 4장까지 넣을 수 있어요. ✕로 한 장을 빼고 다시 넣어주세요.'); return; }
    if (files.length > room) toast(`최대 4장이라 앞의 ${room}장만 넣었어요.`);
    let failed = 0;
    for (const f of files.slice(0, room)) {
      try { state.photos.push({ img: await loadImage(f), zoom: 1, ox: 0, oy: 0 }); }
      catch { failed++; }
    }
    if (failed) toast(`${failed}장은 열 수 없는 형식이에요. JPG나 PNG로 바꿔서 넣어주세요.`);
    refresh();
  }

  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('over'); });
  stage.addEventListener('dragleave', () => stage.classList.remove('over'));
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('over');
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  /* ---------- 배치 ---------- */
  $$('input[name=layout]').forEach((r) => r.addEventListener('change', () => {
    state.layout = r.value;
    updateTextLock();
    refresh();
  }));
  $$('input[name=ratio]').forEach((r) => r.addEventListener('change', () => {
    state.ratio = r.value;
    state.photos.forEach((p) => { p.ox = 0; p.oy = 0; });
    refresh();
  }));
  $('#gap').addEventListener('input', (e) => {
    state.gap = +e.target.value;
    $('#gapVal').textContent = state.gap + 'px';
    refresh();
  });

  function bindSwatches(groupSel, customSel, onPick) {
    const btns = $$(groupSel + ' .sw');
    const mark = (c) => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === c)));
    btns.forEach((b) => b.addEventListener('click', () => {
      mark(b.dataset.color);
      $(customSel).value = b.dataset.color;
      onPick(b.dataset.color);
    }));
    $(customSel).addEventListener('input', (e) => { mark(null); onPick(e.target.value); });
  }
  bindSwatches('#bgSwatches', '#bgCustom', (c) => { state.bg = c; render(); });

  /* ---------- 글자 (자막) ---------- */
  const cap = state.caption;
  $('#txtInput').addEventListener('input', (e) => { cap.text = e.target.value; render(); });
  $('#txtFont').addEventListener('change', (e) => { cap.font = e.target.value; loadFont().then(render); render(); });
  $('#txtSize').addEventListener('input', (e) => { cap.size = +e.target.value; $('#sizeVal').textContent = cap.size; render(); });
  bindSwatches('#txtSwatches', '#txtColor', (c) => { cap.color = c; render(); });

  function loadFont() {
    if (!document.fonts?.load) return Promise.resolve();
    return document.fonts.load(`40px ${FONTS[cap.font]}`, cap.text || '가A').catch(() => {});
  }

  function updateTextLock() {
    const off = state.layout !== 'horizontal';
    $('#textInner').classList.toggle('text-off', off);
    $$('#textInner .grid textarea, #textInner .grid select, #textInner .grid input, #textInner .grid button')
      .forEach((el) => { el.disabled = off; });
  }
  $('#toHorizontal').addEventListener('click', () => {
    $('input[name=layout][value=horizontal]').checked = true;
    state.layout = 'horizontal';
    updateTextLock();
    refresh();
  });

  /* ---------- 레이아웃 계산 ---------- */
  // withGhost: 미리보기에서만 '+ 사진' 칸을 하나 더 붙임 (저장 이미지엔 없음)
  function getLayout(withGhost) {
    const n = state.photos.length;
    const slots = Math.max(1, n + (withGhost && n < MAX_PHOTOS ? 1 : 0));
    const [cw, ch] = CELL[state.ratio];
    const g = state.gap;
    const horiz = state.layout === 'horizontal';
    const W = horiz ? slots * cw + (slots + 1) * g : cw + 2 * g;
    const H = horiz ? ch + 2 * g : slots * ch + (slots + 1) * g;
    const cells = [];
    for (let i = 0; i < slots; i++) {
      cells.push({ x: horiz ? g + i * (cw + g) : g, y: horiz ? g : g + i * (ch + g), w: cw, h: ch });
    }
    const photoW = horiz && n ? n * cw + (n + 1) * g : W;
    return { W, H, cells, cw, ch, g, horiz, photoW };
  }

  /* ---------- 그리기 ---------- */
  function draw(c, lay, exporting) {
    c.fillStyle = state.bg;
    c.fillRect(0, 0, lay.W, lay.H);

    lay.cells.forEach((cell, i) => {
      const p = state.photos[i];
      c.save();
      c.beginPath();
      c.rect(cell.x, cell.y, cell.w, cell.h);
      c.clip();
      if (p) {
        const s = Math.max(cell.w / p.img.width, cell.h / p.img.height) * p.zoom;
        const w = p.img.width * s, h = p.img.height * s;
        c.drawImage(p.img, cell.x + cell.w / 2 - w / 2 + p.ox, cell.y + cell.h / 2 - h / 2 + p.oy, w, h);
      } else if (!exporting) {
        drawGhost(c, cell);
      }
      c.restore();
    });

    if (lay.horiz && state.photos.length && cap.text.trim()) drawCaption(c, lay);
  }

  function drawGhost(c, cell) {
    c.fillStyle = '#f1f9fe';
    c.fillRect(cell.x, cell.y, cell.w, cell.h);
    c.setLineDash([18, 12]);
    c.lineWidth = 5;
    c.strokeStyle = '#9fd4f3';
    c.strokeRect(cell.x + 20, cell.y + 20, cell.w - 40, cell.h - 40);
    c.setLineDash([]);
    const cx = cell.x + cell.w / 2, cy = cell.y + cell.h / 2;
    const small = cell.h < 600;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#2f7fb5';
    c.font = `${small ? 120 : 160}px "Jua", sans-serif`;
    c.fillText('+', cx, cy - (small ? 40 : 60));
    c.font = `${small ? 44 : 56}px "Jua", sans-serif`;
    c.fillText('사진 넣기', cx, cy + (small ? 50 : 60));
    c.font = `28px "Nanum Gothic", sans-serif`;
    c.fillStyle = '#6b8599';
    c.fillText(`${state.photos.length} / ${MAX_PHOTOS}장`, cx, cy + (small ? 100 : 124));
  }

  function wrapLines(c, text, maxW) {
    const out = [];
    text.split('\n').forEach((para) => {
      let line = '';
      const tokens = para.split(/(\s+)/);
      tokens.forEach((tok) => {
        if (c.measureText(line + tok).width <= maxW) { line += tok; return; }
        if (line.trim()) out.push(line.trim());
        line = '';
        // 한 덩어리가 너무 길면 글자 단위로 자르기
        for (const ch of tok.trimStart()) {
          if (c.measureText(line + ch).width > maxW && line) { out.push(line); line = ''; }
          line += ch;
        }
      });
      out.push(line.trim());
    });
    return out;
  }

  function isLight(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 140;
  }

  function drawCaption(c, lay) {
    const size = cap.size * (lay.ch / 800);
    const lh = size * 1.3;
    c.save();
    c.font = `700 ${size}px ${FONTS[cap.font]}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const maxW = lay.photoW - lay.g * 2 - size;
    const lines = wrapLines(c, cap.text, maxW);
    const cx = lay.photoW / 2;
    const bottom = lay.g + lay.ch - lay.ch * 0.06 - size * 0.5;
    const light = isLight(cap.color);
    c.lineJoin = 'round';
    c.lineWidth = Math.max(3, size * 0.16);
    c.strokeStyle = light ? 'rgba(10,20,30,.85)' : 'rgba(255,255,255,.95)';
    c.shadowColor = light ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.4)';
    c.shadowBlur = size * 0.2;
    lines.forEach((l, i) => {
      const y = bottom - (lines.length - 1 - i) * lh;
      c.strokeText(l, cx, y);
    });
    c.shadowBlur = 0;
    c.fillStyle = cap.color;
    lines.forEach((l, i) => {
      const y = bottom - (lines.length - 1 - i) * lh;
      c.fillText(l, cx, y);
    });
    c.restore();
  }

  function render() {
    L = getLayout(true);
    if (canvas.width !== L.W || canvas.height !== L.H) {
      canvas.width = L.W;
      canvas.height = L.H;
    }
    draw(ctx, L, false);
    fit();
  }

  function fit() {
    if (!L) return;
    const aw = stage.clientWidth - 32;
    const ah = stage.clientHeight - 32;
    const s = Math.min(aw / L.W, ah / L.H);
    wrap.style.width = Math.max(1, L.W * s) + 'px';
    wrap.style.height = Math.max(1, L.H * s) + 'px';
  }
  new ResizeObserver(fit).observe(stage);

  function renderRemoveButtons() {
    $$('.cell-x').forEach((b) => b.remove());
    state.photos.forEach((p, i) => {
      const cell = L.cells[i];
      const b = document.createElement('button');
      b.className = 'cell-x';
      b.textContent = '✕';
      b.setAttribute('aria-label', `${i + 1}번째 사진 빼기`);
      b.style.left = ((cell.x + cell.w) / L.W * 100) + '%';
      b.style.top = (cell.y / L.H * 100) + '%';
      b.addEventListener('click', () => { state.photos.splice(i, 1); refresh(); });
      wrap.appendChild(b);
    });
  }

  function refresh() {
    render();
    renderRemoveButtons();
    $('#saveBtn').disabled = !state.photos.length;
  }

  /* ---------- 캔버스 조작 ---------- */
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  }
  function hitCell(p) {
    return L.cells.findIndex((c) => p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h);
  }
  function zoomCell(ci, point, newZoom, from) {
    const photo = state.photos[ci];
    const cell = L.cells[ci];
    const src = from || photo;
    const nz = clamp(newZoom, 0.2, 8);
    const k = nz / src.zoom;
    const px = point.x - (cell.x + cell.w / 2);
    const py = point.y - (cell.y + cell.h / 2);
    photo.ox = px - (px - src.ox) * k;
    photo.oy = py - (py - src.oy) * k;
    photo.zoom = nz;
  }

  canvas.addEventListener('wheel', (e) => {
    const p = toCanvas(e);
    const ci = hitCell(p);
    const photo = state.photos[ci];
    if (!photo) return;
    e.preventDefault();
    zoomCell(ci, p, photo.zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
    render();
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => {
    const photo = state.photos[hitCell(toCanvas(e))];
    if (photo) { Object.assign(photo, { zoom: 1, ox: 0, oy: 0 }); render(); }
  });

  const pointers = new Map();
  let gesture = null;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = toCanvas(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      gesture = { type: 'pan', ci: hitCell(p), last: p, start: p, moved: false };
    } else if (pointers.size === 2 && gesture?.type === 'pan') {
      const photo = state.photos[gesture.ci];
      if (photo) {
        const [a, b] = [...pointers.values()];
        gesture = { type: 'pinch', ci: gesture.ci, d0: dist(a, b), m0: mid(a, b), from: { zoom: photo.zoom, ox: photo.ox, oy: photo.oy } };
      }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse' && L) {
        const ci = hitCell(toCanvas(e));
        canvas.style.cursor = state.photos[ci] ? 'grab' : ci >= 0 ? 'pointer' : 'default';
      }
      return;
    }
    const p = toCanvas(e);
    pointers.set(e.pointerId, p);
    if (!gesture) return;

    if (gesture.type === 'pan') {
      if (dist(p, gesture.start) > 6) gesture.moved = true;
      const photo = state.photos[gesture.ci];
      if (photo) {
        canvas.style.cursor = 'grabbing';
        photo.ox += p.x - gesture.last.x;
        photo.oy += p.y - gesture.last.y;
        render();
      }
      gesture.last = p;
    } else if (gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const m = mid(a, b);
      const g = gesture;
      zoomCell(g.ci, g.m0, g.from.zoom * (dist(a, b) / g.d0), g.from);
      const photo = state.photos[g.ci];
      photo.ox += m.x - g.m0.x;
      photo.oy += m.y - g.m0.y;
      render();
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    // 빈 '+' 칸을 탭/클릭하면 사진 고르기
    if (e.type === 'pointerup' && gesture?.type === 'pan' && !gesture.moved && pointers.size === 0) {
      if (gesture.ci >= state.photos.length && gesture.ci >= 0) fileInput.click();
    }
    if (pointers.size === 0) {
      gesture = null;
      canvas.style.cursor = '';
    } else if (gesture?.type === 'pinch') {
      const rest = [...pointers.values()][0];
      gesture = { type: 'pan', ci: gesture.ci, last: rest, start: rest, moved: true };
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  /* ---------- 저장 ---------- */
  $('#saveBtn').addEventListener('click', async () => {
    if (!state.photos.length) { toast('먼저 사진을 한 장 이상 넣어주세요.'); return; }
    if (document.fonts?.ready) await document.fonts.ready;
    const lay = getLayout(false);
    const out = document.createElement('canvas');
    out.width = lay.W;
    out.height = lay.H;
    draw(out.getContext('2d'), lay, true);
    out.toBlob((blob) => {
      if (!blob) { toast('이미지가 너무 커서 저장하지 못했어요. 사진 수나 여백을 줄여보세요.'); return; }
      const name = randomName();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast(`${name} 저장했어요`);
    }, 'image/png');
  });

  /* ---------- 시작 ---------- */
  updateTextLock();
  refresh();
  if (document.fonts?.ready) document.fonts.ready.then(render);
})();

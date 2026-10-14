/* ============================================================
 * game.js - 合成大西瓜 · 渲染与交互层
 * 依赖：matter.min.js（物理引擎）+ sim.js（window.MiniSim）
 * ============================================================ */
(function () {
  'use strict';
  var sim = window.MiniSim.create();
  // 注意：配置一律从 sim.cfg 实时读取——调整边框尺寸会重建 sim，
  // 缓存的 cfg 会指向已失效的旧配置。

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = sim.cfg.width, H = sim.cfg.height;   // 逻辑尺寸（随边框调整而变）

  // 高清屏：内部分辨率 = 逻辑尺寸 × dpr，渲染坐标仍用逻辑尺寸
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  var nextCv = document.getElementById('nextBall');
  var NS = 64;
  nextCv.width = NS * dpr;
  nextCv.height = NS * dpr;
  nextCv.style.width = NS + 'px';
  nextCv.style.height = NS + 'px';
  var nctx = nextCv.getContext('2d');
  nctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  var el = {
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    panel: document.getElementById('overPanel'),
    finalScore: document.getElementById('finalScore'),
    banner: document.getElementById('banner'),
    wVal: document.getElementById('wVal'),
    hVal: document.getElementById('hVal'),
    autoToggle: document.getElementById('autoToggle'),
    autoGear: document.getElementById('autoGear')
  };

  var POP_MS = 180;      // 合成球放大动画时长
  var POPUP_MS = 800;    // 得分飘字时长
  var BANNER_MS = 2000;  // “合成大西瓜”横幅时长

  // 自动落球挡位（毫秒）：1 秒 … 0.04 秒
  var AUTO_GEARS = [1000, 500, 200, 100, 50, 40];

  // 边框尺寸调整范围与步长
  var SIZE_MIN = { w: 360, h: 520 };
  var SIZE_MAX = { w: 720, h: 900 };
  var SIZE_STEP = 20;

  var score = 0;
  var best = loadBest();
  var cur = sim.nextLevel();    // 当前待落球
  var next = sim.nextLevel();   // 预告的下一个
  var aimX = W / 2;
  var lastDropUiAt = -Infinity;
  var popups = [];              // 得分飘字 {x,y,text,bornAt}
  var melonShown = false;       // 是否已展示过终极横幅
  var overUi = false;
  var autoOn = false;           // 自动落球开关
  var autoMs = AUTO_GEARS[0];   // 当前挡位
  var nextAutoAt = Infinity;    // 下一次自动落球时刻

  function now() { return performance.now(); }

  function loadBest() {
    try { return +localStorage.getItem('xg_best') || 0; } catch (e) { return 0; }
  }
  function saveBest() {
    try { localStorage.setItem('xg_best', String(best)); } catch (e) { /* 隐私模式 */ }
  }
  function updateHud() {
    el.score.textContent = String(score);
    el.best.textContent = String(best);
  }
  function scoreFor(lv) {
    return lv * (lv - 1) / 2;   // 三角数：2→1, 3→3, 4→6, …, 11→55
  }
  function drawNextBall() {
    nctx.clearRect(0, 0, NS, NS);
    var r = Math.min(sim.cfg.radii[next], NS / 2 - 8);
    drawBall(nctx, NS / 2, NS / 2, r, next, 1);
  }

  function handleEvents(ev) {
    var i;
    for (i = 0; i < ev.merged.length; i++) {
      var m = ev.merged[i];
      var add = scoreFor(m.level);
      score += add;
      if (score > best) { best = score; saveBest(); }
      popups.push({ x: m.x, y: m.y, text: '+' + add, bornAt: now() });
      if (m.level >= sim.cfg.maxLv && !melonShown) {
        melonShown = true;
        el.banner.textContent = '🎉 合成大西瓜！';
        el.banner.classList.add('show');
        setTimeout(function () { el.banner.classList.remove('show'); }, BANNER_MS);
      }
    }
    if (ev.gameOver && !overUi) {
      overUi = true;
      el.finalScore.textContent = String(score);
      el.panel.classList.add('show');
    }
    for (i = popups.length - 1; i >= 0; i--) {
      if (now() - popups[i].bornAt > POPUP_MS) popups.splice(i, 1);
    }
    updateHud();
  }

  /** 开一局新游戏：清空球与分数，边框尺寸保持当前设置。 */
  function newGame() {
    sim.clear();
    score = 0;
    cur = sim.nextLevel();
    next = sim.nextLevel();
    popups.length = 0;
    melonShown = false;
    overUi = false;
    lastDropUiAt = -Infinity;
    el.banner.classList.remove('show');
    el.panel.classList.remove('show');
    drawNextBall();
    updateHud();
    updateSizeLabels();
  }

  /** 主画布尺寸跟随当前逻辑尺寸（含 CSS 宽度，窄屏自动收缩）。 */
  function applyCanvasSize() {
    W = sim.cfg.width;
    H = sim.cfg.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    applyCssWidth();
  }

  // clientWidth 不含经典滚动条宽度，比 innerWidth / 100vw 更准
  function applyCssWidth() {
    var avail = document.documentElement.clientWidth - 20;
    canvas.style.width = Math.min(W, Math.max(200, avail)) + 'px';
  }

  function updateSizeLabels() {
    el.wVal.textContent = String(sim.cfg.width);
    el.hVal.textContent = String(sim.cfg.height);
  }

  function restart() { newGame(); }

  /** 边框尺寸加减：超出范围则停在边界。局内调整，不重开。 */
  function stepSize(dim, delta) {
    var curVal = (dim === 'w' ? sim.cfg.width : sim.cfg.height);
    var nv = Math.min(SIZE_MAX[dim], Math.max(SIZE_MIN[dim], curVal + delta));
    if (nv === curVal) return;
    resizeInPlace(
      dim === 'w' ? nv : sim.cfg.width,
      dim === 'h' ? nv : sim.cfg.height
    );
  }

  /** 局内调整边框：不重开本局——sim 原地换墙、改配置，球和分数都保留。 */
  function resizeInPlace(w, h) {
    var T = sim.cfg.wallT;
    sim.resize({
      width: w,
      height: h,
      floorY: h - T,
      redLineY: Math.round(h * 150 / 660),
      dropY: Math.round(h * 92 / 660)
    });
    applyCanvasSize();   // 同步 W/H 与画布尺寸（不清游戏状态）
    updateSizeLabels();
  }

  // ---------- 自动落球 ----------

  function toggleAuto() {
    autoOn = !autoOn;
    el.autoToggle.textContent = autoOn ? '关' : '开';
    el.autoToggle.classList.toggle('on', autoOn);
    if (autoOn) nextAutoAt = performance.now();   // 立即开始
  }

  /** 自动模式心跳：到了下一挡位时刻就在随机水平位置落一球。 */
  function autoTick(t) {
    if (!autoOn || overUi) return;
    if (t < nextAutoAt) return;
    nextAutoAt = t + autoMs;
    var r = sim.cfg.radii[cur];
    var lo = sim.cfg.wallT + r + 4;
    var hi = sim.cfg.width - sim.cfg.wallT - r - 4;
    var span = hi - lo;
    aimX = span > 0 ? lo + Math.random() * span : (lo + hi) / 2;
    var b = sim.dropAuto(aimX, cur);   // 挡位控制节奏，不受手动冷却限制
    if (!b) return;
    cur = next;
    next = sim.nextLevel();
    drawNextBall();
  }

  // ---------- 渲染 ----------

  function drawBall(c, x, y, r, lv, alpha) {
    var col = sim.cfg.colors[lv];
    var g = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, col[0]);
    g.addColorStop(1, col[1]);
    c.save();
    c.globalAlpha = alpha;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = g;
    c.fill();
    c.lineWidth = Math.max(1.5, r * 0.08);
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.font = '700 ' + Math.max(10, Math.round(r * 0.95)) + 'px "Segoe UI", system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(lv), x, y + r * 0.06);
    c.restore();
  }

  function drawGhost(t) {
    if (overUi) return;
    var T = sim.cfg.wallT;
    var r = sim.cfg.radii[cur];
    var x = Math.min(Math.max(aimX, T + r), W - T - r);
    var frac = autoOn ? 1 : Math.min(1, Math.max(0, (t - lastDropUiAt) / sim.cfg.cooldown));

    // 下落引导线
    ctx.save();
    ctx.strokeStyle = 'rgba(90, 90, 120, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(x, sim.cfg.dropY + r + 4);
    ctx.lineTo(x, sim.cfg.floorY - 2);
    ctx.stroke();
    ctx.restore();

    if (frac >= 1) {
      drawBall(ctx, x, sim.cfg.dropY, r, cur, 0.85);
    } else {
      // 冷却中：球淡入 + 进度圆弧
      drawBall(ctx, x, sim.cfg.dropY, r, cur, 0.2 + 0.45 * frac);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x, sim.cfg.dropY, r + 5, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function render(t) {
    ctx.fillStyle = '#fffaf0';
    ctx.fillRect(0, 0, W, H);

    // 容器（与物理墙一致：满高左右墙 + 地板）
    var T = sim.cfg.wallT;
    ctx.fillStyle = 'rgba(110, 170, 220, 0.30)';
    ctx.fillRect(0, 0, T, H);
    ctx.fillRect(W - T, 0, T, H);
    ctx.fillRect(0, sim.cfg.floorY, W, H - sim.cfg.floorY);

    // 红色警戒线
    ctx.save();
    ctx.strokeStyle = 'rgba(235, 90, 90, 0.65)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(T + 1, sim.cfg.redLineY);
    ctx.lineTo(W - T - 1, sim.cfg.redLineY);
    ctx.stroke();
    ctx.restore();

    drawGhost(t);

    // 球（新合成的球带放大动画）
    var balls = sim.balls;
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      // 注意：合成发生在 sim.step()（帧内），bornAt 取的是帧内已前进的
      // 时刻，而 rAF 时间戳 t 是帧开始的时刻——同一帧 age 可能为负，
      // 不钳制会得到负缩放、负半径，让 arc()/梯度抛错并中断整个渲染循环
      var age = t - b.plugin.bornAt;
      if (age < 0) age = 0;
      var s = 1;
      if (age < POP_MS) {
        var p = age / POP_MS, u = p - 1;
        s = 1 + 2.70158 * u * u * u + 1.70158 * u * u;   // easeOutBack
      }
      if (s <= 0) continue;   // 防御：age=0 时 easeOutBack 恰好为 0
      drawBall(ctx, b.position.x, b.position.y, b.plugin.r * s, b.plugin.lv, 1);
    }

    // 得分飘字
    for (var j = 0; j < popups.length; j++) {
      var pp = popups[j];
      var k = (now() - pp.bornAt) / POPUP_MS;
      if (k >= 1) continue;
      if (k < 0) k = 0;   // 同帧创建的飘字，k 可能为微小的负数
      var y = pp.y - 24 - 34 * k;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.font = '700 17px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(70, 60, 90, 0.4)';
      ctx.strokeText(pp.text, pp.x, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(pp.text, pp.x, y);
      ctx.restore();
    }
  }

  // ---------- 主循环 ----------

  var lastT = performance.now();
  function frame(t) {
    var dt = Math.min(t - lastT, 50);   // 掉帧上限，避免物理暴冲
    lastT = t;
    autoTick(t);
    handleEvents(sim.step(dt));
    render(t);
    requestAnimationFrame(frame);
  }

  // ---------- 输入 ----------

  function toSimX(clientX) {
    var rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) / rect.width * W;
  }
  function tryDrop() {
    if (overUi || now() - lastDropUiAt < sim.cfg.cooldown) return;
    var b = sim.drop(aimX, cur);
    if (!b) return;
    lastDropUiAt = now();
    cur = next;
    next = sim.nextLevel();
    drawNextBall();
  }

  canvas.addEventListener('mousemove', function (e) { aimX = toSimX(e.clientX); });
  canvas.addEventListener('mousedown', function (e) { aimX = toSimX(e.clientX); tryDrop(); });
  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    aimX = toSimX(e.touches[0].clientX);
    tryDrop();
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    aimX = toSimX(e.touches[0].clientX);
  }, { passive: false });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  document.getElementById('restart').addEventListener('click', restart);
  document.getElementById('restart2').addEventListener('click', restart);

  // 边框尺寸 +/- 按钮
  var stepBtns = document.querySelectorAll('.step');
  for (var i = 0; i < stepBtns.length; i++) {
    stepBtns[i].addEventListener('click', (function (btn) {
      return function () {
        stepSize(btn.getAttribute('data-dim'), parseInt(btn.getAttribute('data-d'), 10));
      };
    })(stepBtns[i]));
  }

  // 自动落球：开关按钮 + 挡位选择
  el.autoToggle.addEventListener('click', toggleAuto);
  el.autoGear.addEventListener('change', function () {
    autoMs = parseInt(el.autoGear.value, 10) || AUTO_GEARS[0];
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'a' || e.key === 'A') { toggleAuto(); return; }
    if ((e.key === 'r' || e.key === 'R' || e.key === 'Enter') && overUi) restart();
  });

  // 视口尺寸变化时只调整画布显示宽度，不改物理世界
  window.addEventListener('resize', applyCssWidth);

  applyCanvasSize();
  updateSizeLabels();
  drawNextBall();
  updateHud();
  requestAnimationFrame(frame);
})();

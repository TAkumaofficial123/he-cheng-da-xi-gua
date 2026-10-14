/* smoke.js - 用最小 DOM 桩在 Node 里真实运行 game.js
 * 目的：抓到纯语法检查发现不了的运行时错误（接线、时钟、坐标系）
 * 用法：node smoke.js
 */
'use strict';

// ---- 最小 DOM 桩 ----
function makeCtx() {
  var grad = { addColorStop: function () {} };
  return new Proxy({}, {
    get: function (t, k) {
      // 与真实浏览器一致：负半径直接抛错（IndexSizeError）
      if (k === 'arc' || k === 'arcTo') return function (x, y, r) {
        if (r < 0) throw new Error('arc: 半径不能为负');
      };
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return function (x0, y0, r0, x1, y1, r1) {
        if (r0 < 0 || r1 < 0) throw new Error('gradient: 半径不能为负');
        return grad;
      };
      if (k === 'measureText') return function () { return { width: 10 }; };
      if (k === 'setTransform' || k === 'clearRect') return function () {};
      return function () {};
    },
    set: function () { return true; }
  });
}

function makeEl(id) {
  var listeners = {};
  var attrs = {};
  return {
    id: id,
    width: 0, height: 0,
    style: {},
    textContent: '',
    value: '',
    classList: {
      add: function () {},
      remove: function () {},
      toggle: function () {}
    },
    getAttribute: function (n) { return attrs[n]; },
    setAttribute: function (n, v) { attrs[n] = v; },
    getContext: function () { return makeCtx(); },
    addEventListener: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 480, height: 660 }; },
    __fire: function (ev, props) {
      (listeners[ev] || []).forEach(function (fn) {
        fn(Object.assign({
          clientX: 240, preventDefault: function () {},
          touches: [{ clientX: 240 }], key: 'r'
        }, props || {}));
      });
    }
  };
}

var els = {};
// 边框尺寸 +/- 按钮（game.js 启动时就会读取 .step）
var stepWMinus = makeEl('step-w-minus');
var stepWPlus = makeEl('step-w-plus');
var stepHMinus = makeEl('step-h-minus');
var stepHPlus = makeEl('step-h-plus');
[[stepWMinus, 'w', '-20'], [stepWPlus, 'w', '20'],
 [stepHMinus, 'h', '-20'], [stepHPlus, 'h', '20']].forEach(function (cfg) {
  cfg[0].setAttribute('data-dim', cfg[1]);
  cfg[0].setAttribute('data-d', cfg[2]);
});
var stepEls = [stepWMinus, stepWPlus, stepHMinus, stepHPlus];

globalThis.window = globalThis;
globalThis.addEventListener = function (ev, fn) {
  (globalThis.__winListeners = globalThis.__winListeners || {})[ev] = fn;
};
globalThis.document = {
  getElementById: function (id) { return els[id] || (els[id] = makeEl(id)); },
  querySelectorAll: function (sel) { return sel === '.step' ? stepEls.slice() : []; },
  documentElement: { clientWidth: 800 }
};
globalThis.localStorage = {
  getItem: function () { return null; },
  setItem: function () {}
};
globalThis.innerWidth = 800;
globalThis.devicePixelRatio = 2;

// rAF：记录回调，由下面的主循环手动驱动
var rafCb = null;
globalThis.requestAnimationFrame = function (cb) { rafCb = cb; };

// 模拟时钟：performance.now / rAF 时间戳 / sim 内部计时共用同一个假时钟，
// 否则真实时间不动，冷却（450ms）永远不会过，球只会落下一个。
// 关键细节：performance.now() 在一帧之内会随调用次数微增（模拟真实浏览器中
// “帧内时间也在流逝”），否则 sim.step 里合成的球 bornAt 恒等于帧起点 t，
// 复现不出 age = t - bornAt < 0 这类真机上才会触发的渲染崩溃。
var nowMs = 0;
var frameClock = 0;
var perfTick = 0;
globalThis.performance = {
  now: function () { perfTick++; return frameClock + perfTick * 0.001; }
};

// ---- 加载被测代码 ----
globalThis.Matter = require(__dirname + '/matter.min.js');
// 包装 MiniSim.create：捕获 game.js 创建（含重建）的所有游戏实例
var RealMiniSim = require(__dirname + '/sim.js');
var created = [];
globalThis.MiniSim = {
  create: function (cfg) { var s = RealMiniSim.create(cfg); created.push(s); return s; },
  defaultConfig: RealMiniSim.defaultConfig
};

require(__dirname + '/game.js');
function currentSim() { return created[created.length - 1]; }
var sim = created[0];
if (!sim) throw new Error('game.js 没有创建游戏实例');

// 固定随机源：永远掉 1 号球，间距 20px < 直径 34px → 必定发生合成
Math.random = function () { return 0; };

// ---- 驱动帧 ----
var frames = 0, drops = 0;
function runFrames(n) {
  for (var i = 0; i < n; i++) {
    if (!rafCb) throw new Error('game.js 没有持续调用 requestAnimationFrame');
    var cb = rafCb; rafCb = null;
    nowMs += 1000 / 60;
    frameClock = nowMs;
    perfTick = 0;              // 每帧归零：帧内时间从 0 开始微增
    cb(frameClock);
    frames++;
  }
}

var pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  [' + extra + ']' : '')); }
}

console.log('基础流程');
runFrames(60);
ok(frames === 60, 'game.js 首帧启动并持续请求帧');

// 定期落球（冷却 450ms < 32 帧间隔 533ms）
for (var round = 0; round < 12; round++) {
  els.game.__fire('mousedown', { clientX: 120 + round * 20 });
  drops++;
  runFrames(32);
}
ok(drops === 12, '模拟了 12 次点击落球');
ok(sim.balls.length > 0, '容器里有球', '数量=' + sim.balls.length);
var scoreSeen = +els.score.textContent;
ok(scoreSeen > 0, '合成发生过（HUD 得分 > 0）', '得分=' + els.score.textContent);

// 触摸路径也走一遍
els.game.__fire('touchstart', { touches: [{ clientX: 300 }] });
runFrames(40);
ok(true, '触摸落球路径无异常');

// 结算面板与重开按钮的 DOM 接线
ok(els.overPanel && els.banner && els.score && els.best, '所有 #id 元素都能取到');
ok(document.getElementById('restart').__fire && document.getElementById('restart2').__fire, '两个重开按钮已接事件');

console.log('功能：边框尺寸按钮');
ok(els.wVal.textContent === '480' && els.hVal.textContent === '660', '尺寸标签初始值 480×660');
stepWPlus.__fire('click');
ok(els.wVal.textContent === '500', '宽 +20 → 500', els.wVal.textContent);
stepHMinus.__fire('click');
ok(els.hVal.textContent === '640', '长 -20 → 640', els.hVal.textContent);
// 连续加到上限后应停在 720
for (var sb = 0; sb < 40; sb++) stepWPlus.__fire('click');
ok(els.wVal.textContent === '720', '宽到达上限 720 并停住', els.wVal.textContent);
ok(currentSim().cfg.width === 720 && currentSim().cfg.height === 640, '物理世界已原地更新为新尺寸',
  JSON.stringify([currentSim().cfg.width, currentSim().cfg.height]));
runFrames(10);
ok(true, '调整尺寸后继续跑帧无异常');

console.log('功能：自动落球');
var simNow = currentSim();
var balls0 = simNow.balls.length;
els.autoToggle.__fire('click');
ok(els.autoToggle.textContent === '关', '自动开关已打开（按钮显示“关”）');
els.autoGear.value = '40';
els.autoGear.__fire('change');
runFrames(120);   // 2 秒，0.04 秒挡位 ≈ 50 球
ok(currentSim() === simNow, '自动落球期间没有重建 sim');
var ballsAfter = simNow.balls.length;
ok(ballsAfter > balls0 || simNow.isGameOver(), '自动落球在持续落球', '球数=' + ballsAfter);
ok(+els.score.textContent > 0 || simNow.isGameOver(), '自动落球触发了合成', '得分=' + els.score.textContent);
els.autoToggle.__fire('click');
ok(els.autoToggle.textContent === '开', '自动开关已关闭');

// 物理在走人搭的舞台里继续跑，不抛错
runFrames(300);
ok(true, '再跑 300 帧无异常');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);

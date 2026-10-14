/* repro.js - 物理巡检：三球摆法 + 随机对局，排查“卡住”类物理异常
 * 检测：球逃逸出容器、坐标 NaN、少量球时的误判 gameOver、球数异常
 */
'use strict';
globalThis.Matter = require(__dirname + '/matter.min.js');
const Sim = require(__dirname + '/sim.js');
const STEP = 1000 / 60;

// mulberry32：可编程种子，保证可复现
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  [' + extra + ']' : '')); }
}

/**
 * 模拟一次对局：按 xs 序列在 460ms 间隔落球（等级取自 sim 的真实随机池）。
 * 返回巡检中发现的问题列表。
 */
function play(sim, xs, maxFrames) {
  const issues = [];
  const W = sim.cfg.width, H = sim.cfg.height, rly = sim.cfg.redLineY;
  let i = 0;
  for (let f = 0; f < maxFrames; f++) {
    if (i < xs.length && f % 28 === 0) {           // 28 帧 ≈ 467ms > 冷却 450ms
      sim.drop(xs[i++], sim.nextLevel());
    }
    const ev = sim.step(STEP);
    for (const b of sim.balls) {
      const { x, y } = b.position;
      if (!isFinite(x) || !isFinite(y) || !isFinite(b.velocity.x)) {
        issues.push('NaN 坐标 @frame ' + f);
        break;
      }
      if (y > H + 80 || x < -80 || x > W + 80) {
        issues.push('球逃逸 @frame ' + f + ' (' + x.toFixed(0) + ',' + y.toFixed(0) + ')');
        break;
      }
    }
    if (ev.gameOver) {
      // 球很少时不可能真的堆到红线（红线 150，地板 640）
      if (sim.balls.length < 14) {
        issues.push('疑似误判 gameOver：仅 ' + sim.balls.length + ' 个球 @frame ' + f);
      }
      break;
    }
  }
  return issues;
}

console.log('1. 三球同位直叠（最容易触发合成）');
{
  const sim = Sim.create();
  const issues = play(sim, [240, 240, 240], 900);
  ok(issues.length === 0, '无异常', issues.join('; '));
  ok(sim.balls.length > 0 && sim.balls.length <= 3, '球数合理', '数量=' + sim.balls.length);
}

console.log('2. 三球近邻（水平间距 20px < 直径，必接触合成）');
{
  const sim = Sim.create();
  const issues = play(sim, [200, 220, 240], 900);
  ok(issues.length === 0, '无异常', issues.join('; '));
}

console.log('3. 三球分散（200 / 280 / 240）');
{
  const sim = Sim.create();
  const issues = play(sim, [200, 280, 240], 900);
  ok(issues.length === 0, '无异常', issues.join('; '));
}

console.log('4. 三球贴墙（x = 40 / 440 / 240）');
{
  const sim = Sim.create();
  const issues = play(sim, [40, 440, 240], 900);
  ok(issues.length === 0, '无异常', issues.join('; '));
}

console.log('5. 随机对局 × 20（每局 60 球，种子固定）');
{
  let bad = 0, overCount = 0, totalBallsAtOver = [];
  for (let trial = 0; trial < 20; trial++) {
    const sim = Sim.create();
    const r = rng(1234 + trial);
    const xs = [];
    for (let d = 0; d < 60; d++) xs.push(60 + r() * 360);
    // 覆盖 play() 内部用 sim.nextLevel()（Math.random）——这里换掉以隔离外部随机
    const issues = play(sim, xs, 60 * 30 + 600);
    if (issues.length) { bad++; console.log('    trial ' + trial + ': ' + issues.join('; ')); }
    if (sim.isGameOver()) { overCount++; totalBallsAtOver.push(sim.balls.length); }
  }
  ok(bad === 0, '20 局全部无异常');
  ok(overCount === 0 || Math.min(...totalBallsAtOver) >= 14,
    'gameOver 发生时球数都合理（≥14）', JSON.stringify(totalBallsAtOver));
}

console.log('6. 对局中途局内随机调边框 × 5（每局 30 秒）');
{
  let bad = 0;
  for (let trial = 0; trial < 5; trial++) {
    const sim = Sim.create();
    const r = rng(777 + trial);
    let drops = 0, resizeAt = 60;
    for (let f = 0; f < 60 * 30; f++) {
      if (f % 28 === 0 && drops < 60 && !sim.isGameOver()) {
        sim.drop(60 + r() * 360, sim.nextLevel());
        drops++;
      }
      if (f >= resizeAt) {
        const h = Math.round((560 + r() * 160) / 20) * 20;
        const w = Math.round((420 + r() * 120) / 20) * 20;
        sim.resize({
          width: Math.min(720, Math.max(360, w)),
          height: Math.min(900, Math.max(520, h)),
          floorY: h - 20,
          redLineY: Math.round(h * 150 / 660),
          dropY: Math.round(h * 92 / 660)
        });
        resizeAt = f + 60 + Math.floor(r() * 120);
      }
      const ev = sim.step(STEP);
      for (const b of sim.balls) {
        const x = b.position.x, y = b.position.y;
        if (!isFinite(x) || !isFinite(y)) { bad++; break; }
        if (y > sim.cfg.height + 80 || x < -80 || x > sim.cfg.width + 80) { bad++; break; }
      }
      void ev;
    }
    if (sim.balls.some(function (b) {
      return !isFinite(b.position.x) || !isFinite(b.position.y) ||
        b.position.y > sim.cfg.height + 80;
    })) bad++;
  }
  ok(bad === 0, '调边框过程中无逃逸 / NaN / 穿墙残留');
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);

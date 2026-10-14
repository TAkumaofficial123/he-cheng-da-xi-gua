/* test.js - 无头测试：验证物理与游戏规则核心 */
globalThis.Matter = require(__dirname + '/matter.min.js');
const Sim = require(__dirname + '/sim.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  [' + extra + ']' : '')); }
}

const STEP = 1000 / 60;

console.log('1. 球落下并停在地板上');
{
  const sim = Sim.create();
  sim.place(240, 50, 1);
  for (let i = 0; i < 240; i++) sim.step(STEP);
  const b = sim.balls[0];
  const expected = sim.cfg.floorY - b.plugin.r;
  ok(sim.balls.length === 1, '球还在世界里');
  ok(Math.abs(b.position.y - expected) < 3, '停在地板上', 'y=' + b.position.y.toFixed(1) + ' 期望≈' + expected);
}

console.log('2. 两个相同数字球接触后合成');
{
  const sim = Sim.create();
  // 下方一个静止，上方一个砸下来 → 必定发生接触
  sim.place(220, 620, 1);
  sim.place(220, 500, 1);
  let merged = [];
  for (let i = 0; i < 300; i++) merged = merged.concat(sim.step(STEP).merged);
  ok(merged.some(m => m.level === 2), '产生过 2 号球');
  ok(sim.balls.length === 1, '合成后只剩一个球', '数量=' + sim.balls.length);
  ok(sim.balls[0] && sim.balls[0].plugin.lv === 2, '剩下的球是 2 号');
}

console.log('3. 四个 1 号球连锁合成');
{
  const sim = Sim.create();
  sim.place(200, 620, 1);
  sim.place(238, 620, 1);   // 第一排两个（1 号球直径 34）
  sim.place(219, 540, 1);   // 第二排两个，落下后连锁
  sim.place(257, 540, 1);
  let merged = [];
  for (let i = 0; i < 600; i++) merged = merged.concat(sim.step(STEP).merged);
  ok(merged.some(m => m.level === 3), '连锁产生过 3 号球', JSON.stringify(merged.map(m => m.level)));
  ok(sim.balls.length === 1 && sim.balls[0].plugin.lv === 3, '最终只剩一个 3 号球', '数量=' + sim.balls.length + ' lv=' + (sim.balls[0] && sim.balls[0].plugin.lv));
}

console.log('4. 5+5 合成 6（合成大西瓜时刻）');
{
  const sim = Sim.create();
  const r5 = sim.cfg.radii[5];
  sim.place(240, 640 - r5, 5);              // 地板上静止的 5 号
  sim.place(240, 640 - 2 * r5 - 80, 5);   // 上方落下砸中
  let lv6 = false;
  for (let i = 0; i < 400; i++) {
    const ev = sim.step(STEP);
    if (ev.merged.some(m => m.level === 6)) lv6 = true;
  }
  ok(lv6, 'merged 事件中有 level 6');
  ok(sim.balls.length === 1 && sim.balls[0].plugin.lv === 6, '最终为一个 6 号球', '数量=' + sim.balls.length);
}

console.log('5. 等级链延伸到 11：10+10 合成 11');
{
  const sim = Sim.create();
  ok(sim.cfg.maxLv === 11, 'maxLv配置为 11');
  ok(sim.cfg.radii[11] > sim.cfg.radii[10], '11 号球比 10 号大');
  const r10 = sim.cfg.radii[10];
  sim.place(240, 640 - r10, 10);
  sim.place(240, 640 - 2 * r10 - 80, 10);
  let lv11 = false;
  for (let i = 0; i < 400; i++) {
    const ev = sim.step(STEP);
    if (ev.merged.some(m => m.level === 11)) lv11 = true;
  }
  ok(lv11, 'merged 事件中有 level 11');
  ok(sim.balls.length === 1 && sim.balls[0].plugin.lv === 11, '最终为一个 11 号球', '数量=' + sim.balls.length);
}

console.log('6. 11 是最大球，11+11 不再合成');
{
  const sim = Sim.create();
  const r11 = sim.cfg.radii[11];
  sim.place(240, 640 - r11, 11);
  sim.place(240, 640 - 2 * r11 - 80, 11);   // 砸上去
  let mergedLv = [];
  for (let i = 0; i < 400; i++) mergedLv = mergedLv.concat(sim.step(STEP).merged.map(m => m.level));
  ok(!mergedLv.includes(12), '没有产生 12 号球', JSON.stringify(mergedLv));
  ok(sim.balls.length === 2, '两个 11 号球都还在', '数量=' + sim.balls.length);
}

console.log('7. 下落中的球穿过红线不算失败');
{
  const sim = Sim.create();   // 默认红线 y=150，球从 dropY=92 落下必经红线
  const b = sim.drop(240, 1);
  ok(!!b, '落球成功');
  let over = false;
  for (let i = 0; i < 300; i++) { if (sim.step(STEP).gameOver) over = true; }
  ok(!over, '穿过红线没有误判失败');
  ok(sim.balls.length === 1, '球完好停在容器里');
}

console.log('8. 静止的球顶过红线 → 判定失败');
{
  // 把红线调到很低，让地板上的小球静止后顶部超线
  const sim = Sim.create({ redLineY: 608 });
  sim.place(240, 600, 1);
  let over = false;
  for (let i = 0; i < 300; i++) { if (sim.step(STEP).gameOver) over = true; }
  ok(over, '静止球超线触发 gameOver');
}

console.log('9. 落球冷却');
{
  const sim = Sim.create({ cooldown: 1000 });
  const b1 = sim.drop(240, 1);
  const b2 = sim.drop(240, 1);
  ok(!!b1 && !b2, '冷却期内第二次落球被拒绝');
}

console.log('10. 自动落球不受手动冷却限制');
{
  const sim = Sim.create({ cooldown: 60000 });   // 手动冷却 60 秒
  const r = sim.cfg.radii[1];
  const b1 = sim.dropAuto(240, 1);
  const b2 = sim.dropAuto(120, 1);
  ok(!!b1 && !!b2, '自动落球无视冷却连续落球');
  ok(sim.balls.length === 2, '两个球都在世界里', '数量=' + sim.balls.length);
}

console.log('11. 局内调整边框：不重开，球保留并落到新地板');
{
  const sim = Sim.create();
  sim.place(240, 620, 1);
  sim.place(120, 500, 2);
  sim.resize({ width: 520, height: 680, floorY: 660, redLineY: 155, dropY: 95 });
  ok(sim.balls.length === 2, '调整后两个球都还在（未重开）', '数量=' + sim.balls.length);
  ok(sim.cfg.width === 520 && sim.cfg.height === 680, '配置已更新为 520×680');
  for (let i = 0; i < 300; i++) sim.step(STEP);
  const b = sim.balls[0];
  ok(Math.abs(b.position.y - (660 - b.plugin.r)) < 3, '球停在新地板上', 'y=' + b.position.y.toFixed(1));
}

console.log('12. 缩小边框后越界的球被收回容器');
{
  const sim = Sim.create();
  sim.place(430, 620, 1);              // 靠右（旧右墙允许的最大 x 是 443）
  sim.resize({ width: 400, height: 660, floorY: 640, redLineY: 145, dropY: 89 });
  const b = sim.balls[0];
  const maxX = 400 - 20 - b.plugin.r;
  ok(b.position.x <= maxX + 1e-6, '球被收进新右墙内侧', 'x=' + b.position.x.toFixed(1) + ' 上限 ' + maxX);
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);

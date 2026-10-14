/* ============================================================
 * sim.js - 合成大西瓜 · 物理与游戏规则
 * 无 DOM 依赖：浏览器中挂到 window.MiniSim，Node 中可 require 用于测试
 * ========================================================== */
(function (root) {
  'use strict';
  var Matter = root.Matter;
  var Engine = Matter.Engine;
  var Bodies = Matter.Bodies;
  var Body = Matter.Body;
  var Composite = Matter.Composite;
  var Events = Matter.Events;

  var STEP_MS = 1000 / 60;

  function defaultConfig() {
    return {
      width: 480,          // 画布宽
      height: 660,         // 画布高
      wallT: 20,           // 容器墙厚
      floorY: 640,         // 容器内部底面 y
      redLineY: 150,       // 红色警戒线 y
      dropY: 92,           // 待放置球的中心 y（红线之上，容器口）
      cooldown: 450,       // 两次落球的最小间隔 ms
      rest: 0.25,          // 弹性
      fric: 0.45,          // 摩擦
      maxSpeed: 34,        // 速度上限，防穿墙
      overGrace: 1500,     // 球顶越过红线持续累计这么多毫秒才判失败
      maxLv: 11,           // 最高等级（合成上限）
      radii: { 1: 17, 2: 23, 3: 31, 4: 41, 5: 53, 6: 67, 7: 79, 8: 92, 9: 106, 10: 122, 11: 138 },  // 数字 -> 半径
      colors: {            // 数字 -> [亮色, 暗色]（径向渐变用）
        1: ['#9BD4FF', '#4E94E8'],
        2: ['#9CEBC8', '#43BE7C'],
        3: ['#FFE28F', '#F2B43C'],
        4: ['#FFB37F', '#EF7E38'],
        5: ['#D8ACFF', '#9558E0'],
        6: ['#8FE6B4', '#2E9E5C'],
        7: ['#FFC1D6', '#EF5E94'],
        8: ['#A5E8F5', '#34B5CE'],
        9: ['#C9C8FF', '#6C63DB'],
        10: ['#F0A8E8', '#C24DB2'],
        11: ['#FF9E9E', '#DC4545']
      },
      spawn: [1, 1, 1, 2, 2, 2]  // 掉落球池：随机从中取一个
    };
  }

  function create(cfg) {
    var defaults = defaultConfig();
    cfg = cfg || {};
    for (var k in defaults) if (!(k in cfg)) cfg[k] = defaults[k];

    var engine = Engine.create();
    var world = engine.world;
    engine.gravity.y = 1;

    var walls = [];      // 三面静态墙（调整边框时整体重建）
    var wallOpts = { isStatic: true, friction: 0.6, restitution: 0.05, label: 'wall' };

    function buildWalls() {
      var T = cfg.wallT, W = cfg.width, F = cfg.floorY;
      walls.push(
        Bodies.rectangle(T / 2, cfg.height / 2, T, cfg.height, wallOpts),     // 左墙
        Bodies.rectangle(W - T / 2, cfg.height / 2, T, cfg.height, wallOpts), // 右墙
        Bodies.rectangle(W / 2, F + T / 2, W, T, wallOpts)                    // 地板
      );
      Composite.add(world, walls);
    }
    buildWalls();

    var balls = [];        // 当前所有球（物理体）
    var mergeQueue = [];   // 待处理的合成对（在帧末统一处理，避免碰撞事件中改世界）
    var merging = {};      // 已在合成队列中的球 id，防止重复配对
    var gameOver = false;
    var lastDropAt = -Infinity;

    function now() {
      return (root.performance && root.performance.now) ? root.performance.now() : Date.now();
    }

    function makeBall(x, y, lv) {
      var r = cfg.radii[lv];
      var b = Bodies.circle(x, y, r, {
        restitution: cfg.rest,
        friction: cfg.fric,
        frictionStatic: 0.5,
        label: 'ball'
      });
      b.plugin.lv = lv;
      b.plugin.r = r;
      b.plugin.bornAt = now();   // 合成动画起点
      balls.push(b);
      Composite.add(world, b);
      return b;
    }

    function removeBall(b) {
      var i = balls.indexOf(b);
      if (i >= 0) balls.splice(i, 1);
      Composite.remove(world, b);
    }

    // 相同数字的球一旦接触就登记为一对待合成
    Events.on(engine, 'collisionStart', function (ev) {
      for (var i = 0; i < ev.pairs.length; i++) {
        var a = ev.pairs[i].bodyA, b = ev.pairs[i].bodyB;
        if (!a.plugin || !b.plugin || !a.plugin.lv || !b.plugin.lv) continue;  // 墙等忽略
        if (a.plugin.lv !== b.plugin.lv) continue;
        if (a.plugin.lv >= cfg.maxLv) continue;       // 已是最大球，不再合成
        if (merging[a.id] || merging[b.id]) continue;
        merging[a.id] = merging[b.id] = true;
        mergeQueue.push([a, b]);
      }
    });

    function doMerge(a, b, events) {
      var nl = a.plugin.lv + 1;
      var mx = (a.position.x + b.position.x) / 2;
      var my = (a.position.y + b.position.y) / 2;
      var vx = (a.velocity.x + b.velocity.x) / 2;
      var vy = (a.velocity.y + b.velocity.y) / 2;
      removeBall(a);
      removeBall(b);
      var nb = makeBall(mx, my, nl);
      Body.setVelocity(nb, { x: vx, y: vy });
      Body.setAngularVelocity(nb, (a.angularVelocity + b.angularVelocity) / 2);
      events.merged.push({ level: nl, x: nb.position.x, y: nb.position.y });
    }

    /**
     * 推进物理，返回本帧事件：
     *   { merged: [{level,x,y}], gameOver: bool }
     * merged 中出现 level 6 即"合成大西瓜"时刻。
     */
    function step(dtMs) {
      var events = { merged: [], gameOver: false };
      var steps = Math.max(1, Math.round((dtMs == null ? STEP_MS : dtMs) / STEP_MS));
      for (var s = 0; s < steps; s++) Engine.update(engine, STEP_MS);

      // 统一处理合成队列
      var q = mergeQueue; mergeQueue = [];
      for (var i = 0; i < q.length; i++) {
        var a = q[i][0], b = q[i][1];
        if (balls.indexOf(a) < 0 || balls.indexOf(b) < 0) continue;  // 已被前面的合成吃掉
        doMerge(a, b, events);
      }

      // 限速防穿墙
      for (var j = 0; j < balls.length; j++) {
        var bb = balls[j];
        if (bb.speed > cfg.maxSpeed) {
          Body.setVelocity(bb, {
            x: bb.velocity.x / bb.speed * cfg.maxSpeed,
            y: bb.velocity.y / bb.speed * cfg.maxSpeed
          });
        }
      }

      // 红线判定：球顶越过红线并持续累计超过 overGrace 才失败。
      // 刚放下的球初速为 0，必然在红线上方待一小会儿再整体落入线下方，
      // 累计时长只对"持续越线"的球生效；碰撞弹起等瞬时越线不会误判。
      // （旧逻辑要求球"先整体越过红线一次"，会漏掉堆在红线上静止、
      //   却从未整体越线过的球——那恰恰是最典型的失败场景）
      if (!gameOver) {
        var frameMs = (dtMs == null ? STEP_MS : dtMs);
        for (var k = 0; k < balls.length; k++) {
          var bl = balls[k];
          var top = bl.position.y - bl.plugin.r;
          if (top <= cfg.redLineY) {
            bl.plugin.overMs = (bl.plugin.overMs || 0) + frameMs;
            if (bl.plugin.overMs >= cfg.overGrace) {
              gameOver = true;
              events.gameOver = true;
              break;
            }
          } else {
            bl.plugin.overMs = 0;
          }
        }
      }
      return events;
    }

    /** 鼠标点击落球。冷却中或已结束时返回 null。 */
    function drop(x, lv) {
      if (gameOver) return null;
      var t = now();
      if (t - lastDropAt < cfg.cooldown) return null;
      var r = cfg.radii[lv];
      // 直接读 cfg（而不是闭包缓存的尺寸），局内调整边框后仍按新容器钳制
      var cx = Math.min(Math.max(x, cfg.wallT + r), cfg.width - cfg.wallT - r);
      lastDropAt = t;
      return makeBall(cx, cfg.dropY, lv);
    }

    /** 自动落球：忽略手动冷却（节奏由挡位控制），仍受游戏结束约束。 */
    function dropAuto(x, lv) {
      if (gameOver) return null;
      var r = cfg.radii[lv];
      var cx = Math.min(Math.max(x, cfg.wallT + r), cfg.width - cfg.wallT - r);
      return makeBall(cx, cfg.dropY, lv);
    }

    /** 清空所有球，恢复初始状态。 */
    function clear() {
      for (var i = balls.length - 1; i >= 0; i--) Composite.remove(world, balls[i]);
      balls.length = 0;
      mergeQueue.length = 0;
      merging = {};
      gameOver = false;
      lastDropAt = -Infinity;
    }

    /**
     * 局内调整边框尺寸：只换墙、改配置，不重开本局（球、分数都保留）。
     * 新墙可能与现有球重叠（缩小边框时），建好墙后把越界的球收回容器内。
     */
    function resize(patch) {
      for (var k in patch) cfg[k] = patch[k];
      walls.forEach(function (w) { Composite.remove(world, w); });
      walls.length = 0;
      buildWalls();
      var T = cfg.wallT, W = cfg.width, F = cfg.floorY;
      for (var i = 0; i < balls.length; i++) {
        var b = balls[i];
        var r = b.plugin.r;
        var nx = Math.min(Math.max(b.position.x, T + r), W - T - r);
        var ny = Math.min(b.position.y, F - r);
        if (nx !== b.position.x || ny !== b.position.y) {
          Body.setPosition(b, { x: nx, y: ny });
          Body.setVelocity(b, {
            x: b.velocity.x * 0.25,
            y: Math.min(0, b.velocity.y) * 0.25
          });
        }
      }
    }

    function spawnLevel() {
      return cfg.spawn[(Math.random() * cfg.spawn.length) | 0];
    }

    return {
      cfg: cfg,
      engine: engine,
      world: world,
      balls: balls,          // 渲染层只读使用
      step: step,
      drop: drop,
      dropAuto: dropAuto,
      resize: resize,
      clear: clear,
      isGameOver: function () { return gameOver; },
      nextLevel: spawnLevel,
      place: function (x, y, lv) { return makeBall(x, y, lv); }  // 测试用：直接放置
    };
  }

  var api = { create: create, defaultConfig: defaultConfig };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MiniSim = api;
})(typeof window !== 'undefined' ? window : globalThis);

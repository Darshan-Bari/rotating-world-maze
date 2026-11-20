// Rotating-World Maze - shared game logic (levels + physics).
// Used by the browser game (game.js) and by the level checker (tools/verify.js).
// Physics mirrors stack.cpp: world is 600x600, y points up, gravity always
// pulls toward screen-bottom, and the maze rotates in 90 degree steps.
(function (root) {
  'use strict';

  var SIZE = 600, R = 12, GRAV = 0.30, MOVE = 0.70, MAXV = 6.0, DAMP = 0.99;

  // gravity + screen-right directions per rotation index (same as stack.cpp)
  var GX = [0, -1, 0, 1], GY = [-1, 0, 1, 0];
  var RX = [1, 0, -1, 0], RY = [0, -1, 0, 1];

  function rect(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }

  // Hazard that slides back and forth:
  // offset = sin(2*pi*(t/period + phase)) * (ax, ay)
  function mover(x, y, w, h, ax, ay, period, phase) {
    return { x: x, y: y, w: w, h: h, ax: ax, ay: ay, period: period, phase: phase || 0 };
  }

  var LEVELS = [
    // ---- original levels ----
    { name: 'First Drop', bx: 300, by: 540, goal: rect(270, 20, 60, 50),
      walls: [], hazards: [] },
    { name: 'The Ledge', bx: 120, by: 540, goal: rect(500, 20, 60, 50),
      walls: [rect(0, 120, 340, 30)], hazards: [] },
    { name: 'The Wall', bx: 120, by: 540, goal: rect(430, 540, 60, 50),
      walls: [rect(285, 150, 30, 450)], hazards: [] },
    { name: 'Switchback', bx: 100, by: 540, goal: rect(520, 540, 60, 50),
      walls: [rect(200, 150, 30, 450), rect(400, 0, 30, 450)], hazards: [] },
    { name: 'Triple Fold', bx: 80, by: 540, goal: rect(520, 540, 60, 50),
      walls: [rect(150, 200, 30, 400), rect(300, 0, 30, 400), rect(450, 200, 30, 400)],
      hazards: [] },

    // ---- new levels: spikes (red) restart the level on touch ----
    { name: 'Spike Floor', bx: 80, by: 540, goal: rect(520, 20, 60, 50),
      walls: [rect(0, 300, 400, 30)],
      hazards: [rect(0, 0, 505, 18)] },

    { name: 'Zig-Zag', bx: 60, by: 540, goal: rect(20, 20, 60, 50),
      walls: [rect(0, 450, 480, 30), rect(120, 300, 480, 30), rect(0, 150, 480, 30)],
      hazards: [rect(200, 480, 60, 16), rect(200, 0, 80, 18)] },

    { name: 'The Vault', bx: 540, by: 540, goal: rect(260, 255, 100, 90),
      walls: [rect(210, 360, 180, 30), rect(210, 210, 180, 30), rect(210, 210, 30, 180)],
      hazards: [rect(0, 0, 18, 600)] },

    { name: 'Pendulum', bx: 300, by: 540, goal: rect(270, 20, 60, 50),
      walls: [rect(240, 420, 120, 30)],
      hazards: [mover(200, 290, 200, 20, 180, 0, 180, 0),
                mover(200, 150, 200, 20, 180, 0, 180, 0.25)] },

    { name: 'Pistons', bx: 40, by: 540, goal: rect(530, 20, 60, 50),
      walls: [],
      hazards: [mover(170, -320, 30, 600, 0, 340, 200, 0),
                mover(290, 320, 30, 600, 0, -340, 200, 0.33),
                mover(410, -320, 30, 600, 0, 340, 200, 0.66)] },

    { name: 'Spiral', bx: 40, by: 540, goal: rect(245, 245, 110, 110),
      walls: [rect(90, 90, 420, 30), rect(90, 480, 420, 30), rect(90, 90, 30, 420),
              rect(480, 90, 30, 330),
              rect(200, 200, 200, 30), rect(200, 370, 200, 30), rect(370, 200, 30, 200),
              rect(200, 200, 30, 110)],
      hazards: [] },

    { name: 'Final Exam', bx: 540, by: 540, goal: rect(20, 530, 60, 50),
      walls: [rect(480, 500, 120, 25), rect(250, 250, 200, 30),
              rect(0, 460, 160, 25), rect(160, 460, 25, 100)],
      hazards: [rect(300, 0, 100, 15), rect(250, 585, 120, 15),
                mover(460, 300, 140, 20, 0, 170, 220, 0)] }
  ];

  function gIndex(step) { return ((step % 4) + 4) % 4; }

  // current rectangle of a hazard at level time t (frames)
  function hazardRect(hz, t) {
    if (!hz.period) return hz;
    var s = Math.sin(2 * Math.PI * (t / hz.period + hz.phase));
    return rect(hz.x + hz.ax * s, hz.y + hz.ay * s, hz.w, hz.h);
  }

  function ballOverlapsRect(b, r) {
    return (b.x + R > r.x) && (b.x - R < r.x + r.w) &&
           (b.y + R > r.y) && (b.y - R < r.y + r.h);
  }

  // circle vs rect (a little forgiving so grazing a spike is fine)
  function ballTouchesHazard(b, r) {
    var cx = Math.max(r.x, Math.min(b.x, r.x + r.w));
    var cy = Math.max(r.y, Math.min(b.y, r.y + r.h));
    var dx = b.x - cx, dy = b.y - cy, rad = R - 2;
    return dx * dx + dy * dy < rad * rad;
  }

  function resolveX(b, L) {
    for (var i = 0; i < L.walls.length; i++) {
      var w = L.walls[i];
      if (ballOverlapsRect(b, w)) { b.x = (b.x < w.x + w.w / 2) ? w.x - R : w.x + w.w + R; b.vx = 0; }
    }
    if (b.x < R) { b.x = R; b.vx = 0; }
    if (b.x > SIZE - R) { b.x = SIZE - R; b.vx = 0; }
  }

  function resolveY(b, L) {
    for (var i = 0; i < L.walls.length; i++) {
      var w = L.walls[i];
      if (ballOverlapsRect(b, w)) { b.y = (b.y < w.y + w.h / 2) ? w.y - R : w.y + w.h + R; b.vy = 0; }
    }
    if (b.y < R) { b.y = R; b.vy = 0; }
    if (b.y > SIZE - R) { b.y = SIZE - R; b.vy = 0; }
  }

  function newBall(L) { return { x: L.bx, y: L.by, vx: 0, vy: 0, t: 0 }; }

  function hitsHazard(b, L) {
    for (var i = 0; i < L.hazards.length; i++)
      if (ballTouchesHazard(b, hazardRect(L.hazards[i], b.t))) return true;
    return false;
  }

  // One physics frame. g = rotation index (0..3), moveInput = -1, 0, 1.
  // Returns 'goal', 'dead' or null.
  function step(b, L, g, moveInput) {
    b.vx += GX[g] * GRAV + moveInput * MOVE * RX[g];
    b.vy += GY[g] * GRAV + moveInput * MOVE * RY[g];
    b.vx *= DAMP; b.vy *= DAMP;
    var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (sp > MAXV) { b.vx = b.vx / sp * MAXV; b.vy = b.vy / sp * MAXV; }
    b.x += b.vx; resolveX(b, L);
    b.y += b.vy; resolveY(b, L);
    b.t++;
    if (hitsHazard(b, L)) return 'dead';
    if (ballOverlapsRect(b, L.goal)) return 'goal';
    return null;
  }

  var api = {
    SIZE: SIZE, R: R, GX: GX, GY: GY, RX: RX, RY: RY,
    LEVELS: LEVELS, gIndex: gIndex, hazardRect: hazardRect,
    newBall: newBall, step: step
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(this);

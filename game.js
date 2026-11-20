// Rotating-World Maze - browser version of stack.cpp (HTML5 canvas).
// The same CG algorithms are implemented by hand here:
//   Bresenham line (+ dotted style), Midpoint circle, Cohen-Sutherland clipping,
//   cubic Bezier (Bernstein), rotation about the maze center, HSV color, particles.
(function () {
  'use strict';

  var E = window.Engine;
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  // world view = gluOrtho2D(-130, 730, -130, 730) in stack.cpp
  var VMIN = -130, VMAX = 730, VIEW = VMAX - VMIN;
  var CX = 300, CY = 300;
  var k = 1;            // canvas pixels per world unit
  var PT = 2.6;         // size of a rasterized "point" in world units

  var TITLE = 0, PLAY = 1, CLEARED = 2, DEAD = 3, WIN = 4;
  var state = TITLE;

  var levelIndex = 0, L = E.LEVELS[0], ball = E.newBall(L);
  var stepCount = 0, visualAngle = 0, targetAngle = 0, rotating = false;
  var leftHeld = false, rightHeld = false;
  var particles = [], timer = 0;
  var levelStartMs = 0, totalMs = 0, lastLevelMs = 0, moves = 0, deaths = 0;

  // ---------------------------------------------------------------- sizing
  function resize() {
    var pad = document.getElementById('pad');
    var padH = pad && getComputedStyle(pad).display !== 'none' ? pad.offsetHeight + 20 : 0;
    var css = Math.max(240, Math.floor(Math.min(window.innerWidth, window.innerHeight - padH)));
    var dpr = window.devicePixelRatio || 1;
    canvas.style.width = canvas.style.height = css + 'px';
    canvas.width = canvas.height = Math.round(css * dpr);
    k = canvas.width / VIEW;
  }
  window.addEventListener('resize', resize);
  resize();

  function worldTransform() { ctx.setTransform(k, 0, 0, -k, -VMIN * k, VMAX * k); }

  function rgb(r, g, b) {
    return 'rgb(' + Math.round(r * 255) + ',' + Math.round(g * 255) + ',' + Math.round(b * 255) + ')';
  }

  // ---------------------------------------------------------------- Unit 6: HSV -> RGB
  function hsv2rgb(h, s, v) {
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r, g, b;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return [r + m, g + m, b + m];
  }

  // ---------------------------------------------------------------- Unit 3: Bresenham
  function bresenham(x0, y0, x1, y1, dotted) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    var err = dx - dy, i = 0, h = PT / 2;
    ctx.beginPath();
    for (;;) {
      if (!dotted || i % 8 < 4) ctx.rect(x0 - h, y0 - h, PT, PT);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
      i++;
    }
    ctx.fill();
  }

  // ---------------------------------------------------------------- Unit 3: Midpoint circle
  function midpointCircle(xc, yc, r) {
    xc |= 0; yc |= 0;
    var x = 0, y = r, p = 1 - r, h = PT / 2;
    ctx.beginPath();
    function plot(px, py) { ctx.rect(px - h, py - h, PT, PT); }
    while (x <= y) {
      plot(xc + x, yc + y); plot(xc - x, yc + y); plot(xc + x, yc - y); plot(xc - x, yc - y);
      plot(xc + y, yc + x); plot(xc - y, yc + x); plot(xc + y, yc - x); plot(xc - y, yc - x);
      x++;
      if (p < 0) p += 2 * x + 1;
      else { y--; p += 2 * (x - y) + 1; }
    }
    ctx.fill();
  }

  // ---------------------------------------------------------------- Unit 5: Cohen-Sutherland
  var INSIDE = 0, C_LEFT = 1, C_RIGHT = 2, C_BOTTOM = 4, C_TOP = 8;
  var XMIN = 0, YMIN = 0, XMAX = 600, YMAX = 600;

  function regionCode(x, y) {
    var c = INSIDE;
    if (x < XMIN) c |= C_LEFT; else if (x > XMAX) c |= C_RIGHT;
    if (y < YMIN) c |= C_BOTTOM; else if (y > YMAX) c |= C_TOP;
    return c;
  }

  // returns clipped [x0, y0, x1, y1] or null if fully outside
  function cohenSutherland(x0, y0, x1, y1) {
    var c0 = regionCode(x0, y0), c1 = regionCode(x1, y1);
    for (;;) {
      if (!(c0 | c1)) return [x0, y0, x1, y1];
      if (c0 & c1) return null;
      var c = c0 || c1, x, y;
      if (c & C_TOP) { x = x0 + (x1 - x0) * (YMAX - y0) / (y1 - y0); y = YMAX; }
      else if (c & C_BOTTOM) { x = x0 + (x1 - x0) * (YMIN - y0) / (y1 - y0); y = YMIN; }
      else if (c & C_RIGHT) { y = y0 + (y1 - y0) * (XMAX - x0) / (x1 - x0); x = XMAX; }
      else { y = y0 + (y1 - y0) * (XMIN - x0) / (x1 - x0); x = XMIN; }
      if (c === c0) { x0 = x; y0 = y; c0 = regionCode(x0, y0); }
      else { x1 = x; y1 = y; c1 = regionCode(x1, y1); }
    }
  }

  // rectangle clipped to the play area (used for hazards that slide out of it)
  function clipRect(r) {
    var x0 = Math.max(XMIN, r.x), y0 = Math.max(YMIN, r.y);
    var x1 = Math.min(XMAX, r.x + r.w), y1 = Math.min(YMAX, r.y + r.h);
    return (x1 > x0 && y1 > y0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  // ---------------------------------------------------------------- Unit 5: cubic Bezier
  function drawBezier(p) {
    ctx.beginPath();
    for (var i = 0; i <= 30; i++) {
      var t = i / 30, u = 1 - t;
      var b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
      var x = b0 * p[0][0] + b1 * p[1][0] + b2 * p[2][0] + b3 * p[3][0];
      var y = b0 * p[0][1] + b1 * p[1][1] + b2 * p[2][1] + b3 * p[3][1];
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ---------------------------------------------------------------- drawing helpers
  function fillRect(r) { ctx.fillRect(r.x, r.y, r.w, r.h); }

  function rectOutlineBresenham(r) {
    var x0 = r.x | 0, y0 = r.y | 0, x1 = (r.x + r.w) | 0, y1 = (r.y + r.h) | 0;
    bresenham(x0, y0, x1, y0, false);
    bresenham(x1, y0, x1, y1, false);
    bresenham(x1, y1, x0, y1, false);
    bresenham(x0, y1, x0, y0, false);
  }

  // spiky hazard: dark body + bright teeth along its long side
  function drawHazard(r) {
    ctx.fillStyle = rgb(0.45, 0.10, 0.14);
    fillRect(r);
    ctx.fillStyle = rgb(0.95, 0.32, 0.34);
    ctx.beginPath();
    var horizontal = r.w >= r.h, len = horizontal ? r.w : r.h;
    var n = Math.max(1, Math.round(len / 14)), seg = len / n;
    for (var i = 0; i < n; i++) {
      var a = i * seg;
      if (horizontal) {
        ctx.moveTo(r.x + a, r.y); ctx.lineTo(r.x + a + seg / 2, r.y + r.h); ctx.lineTo(r.x + a + seg, r.y);
      } else {
        ctx.moveTo(r.x, r.y + a); ctx.lineTo(r.x + r.w, r.y + a + seg / 2); ctx.lineTo(r.x, r.y + a + seg);
      }
    }
    ctx.fill();
  }

  // Unit 6: radial-shaded ball (bright off-center highlight -> dark rim)
  function drawBallShaded() {
    var R = E.R;
    var grad = ctx.createRadialGradient(ball.x - R * 0.25, ball.y + R * 0.25, 0, ball.x, ball.y, R);
    grad.addColorStop(0, rgb(1.0, 0.80, 0.65));
    grad.addColorStop(1, rgb(0.85, 0.35, 0.20));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(0.2, 0.08, 0.05);
    midpointCircle(ball.x, ball.y, R);
  }

  // text in world coordinates, drawn upright
  function drawText(x, y, s, size, color, align, bold) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var px = size * canvas.width / 600;
    ctx.font = (bold ? 'bold ' : '') + px + 'px ' + (bold ? '"Times New Roman", serif' : 'Helvetica, Arial, sans-serif');
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, (x - VMIN) * k, (VMAX - y) * k);
  }

  function timeStr(ms) {
    var tenths = Math.floor(ms / 100);
    return Math.floor(tenths / 10) + '.' + (tenths % 10) + 's';
  }

  // ---------------------------------------------------------------- scene
  function drawMaze() {
    var hue = hsv2rgb((levelIndex * 55) % 360, 0.55, 0.85);
    var hueCss = rgb(hue[0], hue[1], hue[2]);

    worldTransform();
    ctx.translate(CX, CY);
    ctx.rotate(visualAngle * Math.PI / 180);     // Unit 4: rotate about center
    ctx.translate(-CX, -CY);

    ctx.fillStyle = rgb(0.35, 0.40, 0.50);
    rectOutlineBresenham({ x: 0, y: 0, w: 600, h: 600 });

    // gravity guide: clipped by Cohen-Sutherland, rasterized dotted by Bresenham
    if (state !== DEAD) {
      var g = E.gIndex(stepCount);
      var seg = cohenSutherland(ball.x, ball.y, ball.x + E.GX[g] * 1000, ball.y + E.GY[g] * 1000);
      if (seg) {
        ctx.fillStyle = rgb(0.45, 0.50, 0.60);
        bresenham(seg[0], seg[1], seg[2], seg[3], true);
      }
    }

    var i;
    ctx.fillStyle = rgb(0.86, 0.88, 0.92);
    for (i = 0; i < L.walls.length; i++) fillRect(L.walls[i]);
    ctx.fillStyle = rgb(0.55, 0.58, 0.66);
    for (i = 0; i < L.walls.length; i++) rectOutlineBresenham(L.walls[i]);

    for (i = 0; i < L.hazards.length; i++) {
      var hr = clipRect(E.hazardRect(L.hazards[i], ball.t));
      if (hr) drawHazard(hr);
    }

    // goal + Bezier banner arc
    var G = L.goal;
    ctx.fillStyle = hueCss;
    fillRect(G);
    ctx.strokeStyle = hueCss;
    drawBezier([
      [G.x - 5, G.y + G.h],
      [G.x + G.w * 0.2, G.y + G.h + 55],
      [G.x + G.w * 0.8, G.y + G.h + 55],
      [G.x + G.w + 5, G.y + G.h]
    ]);

    for (i = 0; i < particles.length; i++) {
      var p = particles[i], a = Math.max(0, p.life / 40);
      ctx.fillStyle = rgb(Math.min(1, p.r * a + 0.2), Math.min(1, p.g * a + 0.2), Math.min(1, p.b * a + 0.1));
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
    }

    if (state !== DEAD) drawBallShaded();
  }

  var WHITE = rgb(0.90, 0.92, 0.95), ORANGE = rgb(0.96, 0.50, 0.32), GREEN = rgb(0.30, 0.80, 0.62);

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = rgb(0.13, 0.15, 0.20);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (state === TITLE) {
      drawText(300, 440, 'ROTATING - WORLD MAZE', 30, ORANGE, 'center', true);
      drawText(300, 370, 'Rotate the maze so the ball falls to the goal.', 14, WHITE, 'center');
      drawText(300, 340, E.LEVELS.length + ' levels. Red spikes send you back to the start.', 14, WHITE, 'center');
      drawText(300, 290, 'Arrows = move     Q / E = rotate     R = restart', 18, WHITE, 'center');
      drawText(300, 220, 'Press SPACE (or tap) to start', 18, GREEN, 'center');
      return;
    }

    if (state === WIN) {
      drawText(300, 420, 'ALL LEVELS CLEARED!', 30, GREEN, 'center', true);
      drawText(300, 350, 'Total time: ' + timeStr(totalMs), 18, WHITE, 'center');
      drawText(300, 320, 'Rotations: ' + moves + '     Deaths: ' + deaths, 18, WHITE, 'center');
      drawText(300, 250, 'Press R (or tap) to replay', 18, WHITE, 'center');
      return;
    }

    drawMaze();

    var shownMs = state === CLEARED ? totalMs : totalMs + (performance.now() - levelStartMs);
    drawText(-120, 705, 'Level ' + (levelIndex + 1) + ' / ' + E.LEVELS.length + '  ' + L.name, 18, WHITE);
    drawText(720, 705, 'Time ' + timeStr(shownMs) + '   Rot ' + moves + '   Deaths ' + deaths, 13, WHITE, 'right');
    drawText(-120, -110, 'Arrows: move   Q/E: rotate   R: restart', 13, WHITE);

    if (state === CLEARED) drawText(300, 330, 'LEVEL CLEAR!', 30, GREEN, 'center', true);
  }

  // ---------------------------------------------------------------- game flow
  function resetBall() {
    ball = E.newBall(L);
    stepCount = 0; visualAngle = targetAngle = 0; rotating = false;
    particles = [];
  }

  function loadLevel(i) {
    levelIndex = i; L = E.LEVELS[i];
    resetBall();
    levelStartMs = performance.now();
  }

  function newGame() { totalMs = 0; moves = 0; deaths = 0; loadLevel(0); state = PLAY; }

  function spawnParticles(x, y, color) {
    for (var i = 0; i < 24; i++) {
      var ang = Math.random() * Math.PI * 2, spd = 2 + Math.random() * 3;
      particles.push({ x: x, y: y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 40,
                       r: color[0], g: color[1], b: color[2] });
    }
  }

  function update() {
    if (state === PLAY) {
      if (rotating) {
        visualAngle += (targetAngle - visualAngle) * 0.15;
        if (Math.abs(targetAngle - visualAngle) < 0.5) { visualAngle = targetAngle; rotating = false; }
      } else {
        var move = (rightHeld ? 1 : 0) - (leftHeld ? 1 : 0);
        var result = E.step(ball, L, E.gIndex(stepCount), move);
        if (result === 'dead') {
          deaths++;
          spawnParticles(ball.x, ball.y, [0.95, 0.30, 0.30]);
          state = DEAD; timer = 45;
        } else if (result === 'goal') {
          lastLevelMs = performance.now() - levelStartMs;
          totalMs += lastLevelMs;
          spawnParticles(L.goal.x + L.goal.w / 2, L.goal.y + L.goal.h / 2,
                         hsv2rgb((levelIndex * 55) % 360, 0.55, 0.85));
          state = CLEARED; timer = 55;
        }
      }
    } else if (state === CLEARED || state === DEAD) {
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x += p.vx; p.y += p.vy; p.vy -= 0.12; p.life -= 1;
      }
      if (--timer <= 0) {
        if (state === DEAD) { resetBall(); state = PLAY; }
        else if (levelIndex + 1 < E.LEVELS.length) { loadLevel(levelIndex + 1); state = PLAY; }
        else state = WIN;
      }
    }
  }

  // fixed 60 Hz simulation, independent of monitor refresh rate
  var STEP = 1000 / 60, acc = 0, last = performance.now();
  function frame(now) {
    acc += Math.min(250, now - last); last = now;
    while (acc >= STEP) { update(); acc -= STEP; }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ?level=N jumps straight to level N (handy for demos)
  var startAt = parseInt(new URLSearchParams(location.search).get('level'), 10);
  if (startAt >= 1 && startAt <= E.LEVELS.length) { newGame(); loadLevel(startAt - 1); }

  // ---------------------------------------------------------------- input
  function rotate(dir) {
    if (state !== PLAY || rotating) return;
    stepCount += dir; targetAngle = stepCount * 90; rotating = true; moves++;
  }

  function press(key) {
    if (key === 'ArrowLeft') { leftHeld = true; }
    if (key === 'ArrowRight') { rightHeld = true; }
    if (state === TITLE) { if (key === ' ' || key === 'Enter' || key === 'tap') newGame(); return; }
    if (state === WIN) { if (key === 'r' || key === 'R' || key === 'tap') newGame(); return; }
    if (key === 'r' || key === 'R') { loadLevel(levelIndex); state = PLAY; return; }
    if (key === 'q' || key === 'Q') rotate(1);
    if (key === 'e' || key === 'E') rotate(-1);
  }

  function release(key) {
    if (key === 'ArrowLeft') leftHeld = false;
    if (key === 'ArrowRight') rightHeld = false;
  }

  window.addEventListener('keydown', function (ev) {
    if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(ev.key) >= 0) ev.preventDefault();
    if (ev.repeat) return;
    press(ev.key);
  });
  window.addEventListener('keyup', function (ev) { release(ev.key); });
  window.addEventListener('blur', function () { leftHeld = rightHeld = false; });

  canvas.addEventListener('pointerdown', function () { if (state === TITLE || state === WIN) press('tap'); });

  var buttons = document.querySelectorAll('#pad button');
  Array.prototype.forEach.call(buttons, function (btn) {
    var key = btn.getAttribute('data-key');
    btn.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      if (state === TITLE || state === WIN) press('tap');
      press(key);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) {
      btn.addEventListener(t, function () { release(key); });
    });
  });
})();

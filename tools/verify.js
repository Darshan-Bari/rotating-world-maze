// Checks that every level in engine.js can be solved.
// Breadth-first search over inputs: hold left / right / nothing for a few
// frames, or rotate the world (rotation freezes time, like in the game).
// Usage: node tools/verify.js
const E = require('../engine.js');

const FRAMES = 6;          // frames per input step (~0.1 s)
const MAX_STATES = 3e6;
let WEIGHT = 0.5;          // depth penalty; retried with larger values if search stalls

function solve(L) {
  const periods = L.hazards.filter(h => h.period).map(h => h.period);
  const P = periods.length ? periods[0] : 0;
  if (periods.some(p => p !== P)) throw new Error('moving hazards in a level must share a period');

  const key = (b, g) => {
    const ph = P ? Math.floor((b.t % P) / FRAMES) : 0;
    return (((((g * 256 + Math.round(b.x / 6)) * 256 + Math.round(b.y / 6)) * 16 +
      (Math.round(b.vx / 2) + 7)) * 16 + (Math.round(b.vy / 2) + 7)) * 64) + ph;
  };

  // greedy best-first: expand states closest to the goal first
  const gc = { x: L.goal.x + L.goal.w / 2, y: L.goal.y + L.goal.h / 2 };
  const cost = (n) => Math.hypot(n.b.x - gc.x, n.b.y - gc.y) + n.depth * WEIGHT;
  const heap = [];
  const push = (i) => {
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (nodes[heap[p]].c <= nodes[heap[c]].c) break;
      [heap[p], heap[c]] = [heap[c], heap[p]]; c = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1, r = l + 1;
        let m = p;
        if (l < heap.length && nodes[heap[l]].c < nodes[heap[m]].c) m = l;
        if (r < heap.length && nodes[heap[r]].c < nodes[heap[m]].c) m = r;
        if (m === p) break;
        [heap[p], heap[m]] = [heap[m], heap[p]]; p = m;
      }
    }
    return top;
  };

  const start = E.newBall(L);
  const nodes = [{ b: start, g: 0, parent: -1, act: '', depth: 0 }];
  nodes[0].c = cost(nodes[0]);
  push(0);
  const seen = new Set([key(start, 0)]);
  while (heap.length && nodes.length < MAX_STATES) {
    const head = pop();
    const n = nodes[head];
    for (const act of ['L', 'R', '.', 'Q', 'E']) {
      const b = { ...n.b };
      let g = n.g, result = null;
      if (act === 'Q') g = (g + 1) % 4;
      else if (act === 'E') g = (g + 3) % 4;
      else {
        const mv = act === 'L' ? -1 : act === 'R' ? 1 : 0;
        for (let f = 0; f < FRAMES && !result; f++) result = E.step(b, L, g, mv);
      }
      if (result === 'dead') continue;
      const k = key(b, g);
      if (seen.has(k)) continue;
      seen.add(k);
      const child = { b, g, parent: head, act, depth: n.depth + 1 };
      child.c = cost(child);
      nodes.push(child);
      push(nodes.length - 1);
      if (result === 'goal') {
        let path = '', i = nodes.length - 1;
        while (i > 0) { path = nodes[i].act + path; i = nodes[i].parent; }
        return { ok: true, path, frames: b.t, states: nodes.length };
      }
    }
  }
  return { ok: false, states: nodes.length };
}

let allOk = true;
E.LEVELS.forEach((L, i) => {
  let r;
  for (WEIGHT of [0.5, 8, 36]) { r = solve(L); if (r.ok) break; }
  allOk = allOk && r.ok;
  const pad = String(i + 1).padStart(2) + ' ' + L.name.padEnd(12);
  if (r.ok) {
    const rots = (r.path.match(/[QE]/g) || []).length;
    console.log(`${pad} OK   ${(r.frames / 60).toFixed(1)}s, ${rots} rotations, ${r.states} states  ${r.path}`);
  } else {
    console.log(`${pad} UNSOLVABLE (${r.states} states searched)`);
  }
});
process.exit(allOk ? 0 : 1);

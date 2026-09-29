// Run with: node --test tests/
// Loads the logic block straight out of index.html, so the tests always exercise the shipped code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const match = html.match(/\/\* LOGIC:BEGIN[\s\S]*?\*\/([\s\S]*?)\/\* LOGIC:END \*\//);
assert.ok(match, 'LOGIC:BEGIN / LOGIC:END markers not found in index.html');
// Evaluate in this realm (not a new vm context) so deepStrictEqual sees ordinary Arrays/Objects.
const L = vm.runInThisContext(`(() => {\n${match[1]}\nreturn HouseLogic;\n})()`, { filename: 'index.html#logic' });
const C = L.CONFIG;

const N = 3000;
const rng = L.mulberry32(20260928);
const grids = Array.from({ length: N }, () => L.generateGrid(rng));
const machinesOf = (g) => g.cells.map((p, i) => (p >= 0 ? i : -1)).filter((i) => i >= 0);
const inS4 = (g, i) => g.pitSizes[g.cells[i]] === C.TRUE_PIT_SIZE;

test(`every grid has 50 machines and ${C.AISLE_COUNT} aisles (${N} grids)`, () => {
  for (const g of grids) {
    assert.equal(g.cells.filter((p) => p >= 0).length, 50);
    assert.equal(g.cells.filter((p) => p === -1).length, C.AISLE_COUNT);
  }
});

test('pit sizes sum to 50, K in [8,14], size-4 pit count in [2,4], S4 non-empty', () => {
  for (const g of grids) {
    assert.equal(g.pitSizes.reduce((a, b) => a + b, 0), 50);
    assert.ok(g.pitSizes.length >= 8 && g.pitSizes.length <= 14);
    const m = g.pitSizes.filter((s) => s === 4).length;
    assert.ok(m >= 2 && m <= 4, `m=${m}`);
    for (const s of g.pitSizes) assert.ok(s === 4 || C.OTHER_PIT_SIZES.includes(s), `size ${s}`);
    assert.ok(machinesOf(g).some((i) => inS4(g, i)));
  }
});

test('exactly one machine is both in a size-4 pit and the majority color, and it is trueCell', () => {
  for (const g of grids) {
    const major = L.majorityInfo(L.countColors(g.colors)).color;
    const both = machinesOf(g).filter((i) => inS4(g, i) && g.colors[i] === major);
    assert.deepEqual(both, [g.trueCell]);
    assert.equal(major, g.majorColor);
    assert.deepEqual(L.validateGrid(g), []);
  }
});

test('majority margin is always >= 4 and the count stays under the soft cap', () => {
  for (const g of grids) {
    const info = L.majorityInfo(L.countColors(g.colors));
    assert.ok(info.margin >= C.MIN_MARGIN, `margin ${info.margin}`);
    assert.ok(info.count <= C.MAJOR_SOFT_CAP, `count ${info.count}`);
  }
});

test('majority color is roughly uniform over the palette', () => {
  const hist = new Array(6).fill(0);
  for (const g of grids) hist[g.majorColor]++;
  const expected = N / 6;
  for (const h of hist) assert.ok(Math.abs(h - expected) < expected * 0.15, `hist ${hist}`);
});

test("true machine's pit-of-origin is roughly uniform among the size-4 pits", () => {
  // Rank size-4 pits by reading order (first cell); the true pit's rank must not favor "first found".
  const byM = { 2: [0, 0], 3: [0, 0, 0], 4: [0, 0, 0, 0] };
  for (const g of grids) {
    const firstCell = new Map();
    g.cells.forEach((p, i) => { if (p >= 0 && g.pitSizes[p] === 4 && !firstCell.has(p)) firstCell.set(p, i); });
    const ranked = [...firstCell.keys()].sort((a, b) => firstCell.get(a) - firstCell.get(b));
    byM[ranked.length][ranked.indexOf(g.cells[g.trueCell])]++;
  }
  for (const [m, hist] of Object.entries(byM)) {
    const total = hist.reduce((a, b) => a + b, 0);
    assert.ok(total > 300, `too few m=${m} samples`);
    for (const h of hist) assert.ok(Math.abs(h / total - 1 / m) < 0.06, `m=${m} hist ${hist}`);
  }
});

test('the true machine is the unique maximum score (exactly 1) on every floor', () => {
  for (const g of grids) {
    const s = L.floorScores(g);
    assert.equal(s[g.trueCell], 1);
    for (const i of machinesOf(g)) if (i !== g.trueCell) assert.ok(s[i] < 1, `cell ${i} score ${s[i]}`);
    g.cells.forEach((p, i) => { if (p < 0) assert.equal(s[i], -1); });
  }
});

test('score is graded: falls with pit-size distance from 4, rises with color frequency', () => {
  const sizes = [4, 3, 5, 6, 7];
  const ps = sizes.map((s) => L.pitScore(s));
  assert.equal(ps[0], 1);
  assert.equal(ps[1], ps[2]);
  assert.ok(ps[0] > ps[1] && ps[2] > ps[3] && ps[3] > ps[4] && ps[4] >= 0);
  for (const g of grids.slice(0, 500)) {
    const s = L.floorScores(g);
    const counts = L.countColors(g.colors);
    const ms = machinesOf(g);
    for (const i of ms) {
      for (const j of ms) {
        const di = Math.abs(g.pitSizes[g.cells[i]] - 4), dj = Math.abs(g.pitSizes[g.cells[j]] - 4);
        const ci = counts[g.colors[i]], cj = counts[g.colors[j]];
        if (ci === cj && di < dj) assert.ok(s[i] > s[j]);
        if (di === dj && ci > cj) assert.ok(s[i] > s[j]);
      }
    }
  }
});

test('machine EV is monotone in score, house-level at or below the threshold, capped at warm EV', () => {
  for (let k = 0; k <= 100; k++) {
    const x = k / 100;
    if (x <= C.WARM_THRESHOLD) assert.equal(L.evForScore(x), L.HOUSE_EV);
    assert.ok(L.evForScore(x) <= L.WARM_EV + 1e-12);
    if (k > 0) assert.ok(L.evForScore(x) >= L.evForScore((k - 1) / 100));
  }
  for (const g of grids.slice(0, 500)) {
    const s = L.floorScores(g);
    const ev = L.floorEVs(g);
    const ms = machinesOf(g).filter((i) => i !== g.trueCell);
    for (const i of ms) for (const j of ms) if (s[i] > s[j]) assert.ok(ev[i] >= ev[j]);
    assert.equal(ev[g.trueCell], L.TRUE_EV);
    for (const i of ms) assert.ok(ev[i] < L.TRUE_EV);
  }
});

test('most machines still favor the house: median customer-favorable count per floor is 10-20', () => {
  const fav = grids.map((g) => L.floorEVs(g).filter((ev, i) => ev !== null && i !== g.trueCell && ev > 0).length);
  fav.sort((a, b) => a - b);
  const median = fav[fav.length >> 1];
  assert.ok(median >= 10 && median <= 20, `median ${median}`);
});

test('pits are contiguous (placement retries succeed in practice)', () => {
  for (const g of grids) {
    assert.equal(g.contiguous, true);
    g.pitSizes.forEach((_, p) => assert.ok(L.isPitContiguous(g, p)));
  }
});

test('borderSides: walls exactly where the neighbour is off-grid, aisle, or another pit', () => {
  for (const g of grids.slice(0, 200)) {
    for (let i = 0; i < L.TOTAL; i++) {
      if (g.cells[i] < 0) continue;
      const b = L.borderSides(g, i);
      const [up, right, down, left] = L.neighbors(i);
      const expectWall = (nb) => nb < 0 || g.cells[nb] !== g.cells[i];
      assert.deepEqual(b, { top: expectWall(up), right: expectWall(right), bottom: expectWall(down), left: expectWall(left) });
      // No stray wall inside a pit, no missing wall at a boundary:
      if (up >= 0 && g.cells[up] === g.cells[i]) assert.equal(b.top, false);
      if (right >= 0 && g.cells[right] === -1) assert.equal(b.right, true);
    }
  }
});

test('pitTints never give two touching pits the same tint', () => {
  for (const g of grids.slice(0, 500)) {
    const tints = L.pitTints(g);
    for (let i = 0; i < L.TOTAL; i++) {
      for (const nb of L.neighbors(i)) {
        if (nb < 0 || g.cells[i] < 0 || g.cells[nb] < 0 || g.cells[i] === g.cells[nb]) continue;
        assert.notEqual(tints[g.cells[i]], tints[g.cells[nb]]);
      }
    }
  }
});

test('uniqueness guard: validateGrid flags a forced-bad grid (zero or two candidates)', () => {
  const g = structuredClone(grids[0]);
  // Two candidates: paint another size-4-pit machine the majority color.
  const other = machinesOf(g).find((i) => inS4(g, i) && i !== g.trueCell);
  g.colors[other] = g.majorColor;
  assert.ok(L.validateGrid(g).some((e) => /exactly 1 machine/.test(e) || /margin|majorColor/.test(e)));
  // Zero candidates: recolor the true machine away from the majority.
  const g2 = structuredClone(grids[1]);
  g2.colors[g2.trueCell] = (g2.majorColor + 1) % 6;
  assert.ok(L.validateGrid(g2).some((e) => /found 0/.test(e)), L.validateGrid(g2).join('; '));
});

test('uniqueness guard: a corrupted generation is logged and regenerated, never shipped', () => {
  const errors = [];
  const logger = { error: (m) => errors.push(m) };
  const corrupt = (g) => {
    const other = g.cells.findIndex((p, i) => p >= 0 && g.pitSizes[p] === 4 && i !== g.trueCell);
    g.colors[other] = g.majorColor;
  };
  const g = L.generateGrid(L.mulberry32(7), { logger, tamper: (grid, attempt) => { if (attempt === 1) corrupt(grid); } });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /failed validation/);
  assert.deepEqual(L.validateGrid(g), []);
  // If every attempt is corrupt, generation throws rather than returning a bad grid.
  const errs2 = [];
  assert.throws(
    () => L.generateGrid(L.mulberry32(8), { logger: { error: (m) => errs2.push(m) }, maxAttempts: 3, tamper: corrupt }),
    (e) => e.name === 'GenerationError',
  );
  assert.equal(errs2.length, 3);
});

test('spin draws stay in range and match each machine EV', () => {
  const r = L.mulberry32(99);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(Math.abs(L.HOUSE_EV - -0.5) < 1e-9);
  assert.ok(Math.abs(L.WARM_EV - 1.5) < 1e-9);
  // 0.5 x mean jackpot $20 + 0.5 x favorable $0.30
  assert.ok(Math.abs(L.TRUE_EV - 10.15) < 1e-9);

  const g = grids.find((x) => {
    const s = L.floorScores(x);
    return machinesOf(x).some((i) => s[i] <= C.WARM_THRESHOLD) &&
      machinesOf(x).some((i) => i !== x.trueCell && L.warmth(s[i]) > 0.5);
  });
  assert.ok(g, 'no grid with both a cold and a clearly warm machine');
  const s = L.floorScores(g);
  const cold = machinesOf(g).find((i) => s[i] <= C.WARM_THRESHOLD);
  const warm = machinesOf(g).find((i) => i !== g.trueCell && L.warmth(s[i]) > 0.5);
  const draw = (i) => Array.from({ length: 60000 }, () => L.spin(g, i, r));

  const dc = draw(cold), dw = draw(warm), dt = draw(g.trueCell);
  assert.ok(dc.every((v) => v >= -2 && v <= 1));
  assert.ok(dw.every((v) => v >= -2 && v <= 3));
  assert.ok(dw.some((v) => v >= 2), 'warm machine never showed a +2/+3 tell');
  assert.ok(dt.every((v) => (v >= -1 && v <= 2) || (v >= 15 && v <= 25)));
  assert.ok(Math.abs(mean(dc) - L.machineEV(g, cold)) < 0.03);
  assert.ok(Math.abs(mean(dw) - L.machineEV(g, warm)) < 0.03);
  assert.ok(Math.abs(mean(dt) - L.TRUE_EV) < 0.2);
  const jackpotRate = dt.filter((v) => v >= 15).length / dt.length;
  assert.equal(C.JACKPOT_CHANCE, 0.5);
  assert.ok(Math.abs(jackpotRate - C.JACKPOT_CHANCE) < 0.01, `jackpot rate ${jackpotRate}`);

  const aisle = g.cells.indexOf(-1);
  assert.throws(() => L.spin(g, aisle, r), RangeError);
  assert.throws(() => L.spin(g, -1, r), RangeError);
});

test('aggregateEV is the sum of machine EVs', () => {
  for (const g of grids.slice(0, 50)) {
    const expected = machinesOf(g).reduce((a, i) => a + L.machineEV(g, i), 0);
    assert.ok(Math.abs(L.aggregateEV(g) - expected) < 1e-9);
  }
});

test('every pit has 3-7 machines', () => {
  for (const g of grids) for (const s of g.pitSizes) assert.ok(s >= 3 && s <= 7, `size ${s}`);
});

test('audit code is always BANDIT', () => {
  assert.equal(C.AUDIT_CODE, 'BANDIT');
});

test('validateSavedState accepts a real session and rejects junk', () => {
  const good = { v: 1, phase: 'practice', grid: grids[3], spinsLeft: 9, net: -4, wrongTaps: [], auditCode: null };
  const clean = L.validateSavedState(JSON.parse(JSON.stringify(good)));
  assert.ok(clean);
  assert.equal(clean.spinsLeft, 9);
  const someWrong = machinesOf(grids[3]).filter((i) => i !== grids[3].trueCell);
  const bad = [
    null, 42, 'x', {}, { ...good, v: 2 }, { ...good, phase: 'win' }, { ...good, spinsLeft: C.SPIN_BUDGET + 1 },
    { ...good, spinsLeft: -1 }, { ...good, net: 1.5 },
    { ...good, wrongTaps: [grids[3].trueCell] }, { ...good, wrongTaps: 'no' },
    { ...good, wrongTaps: [someWrong[0], someWrong[0]] },
    { ...good, wrongTaps: someWrong.slice(0, C.AUDIT_ATTEMPTS) }, // at the cap: should already have restarted
    { ...good, auditCode: 'BANDIT' }, { ...good, phase: 'success', auditCode: null },
    { ...good, phase: 'success', auditCode: 'K7QM2P' },
    { ...good, grid: { ...grids[3], cells: grids[3].cells.slice(1) } },
    { ...good, grid: { ...grids[3], majorColor: (grids[3].majorColor + 1) % 6 } },
  ];
  for (const b of bad) assert.equal(L.validateSavedState(b), null, JSON.stringify(b)?.slice(0, 80));
  assert.ok(L.validateSavedState({ ...good, wrongTaps: someWrong.slice(0, C.AUDIT_ATTEMPTS - 1), phase: 'success', auditCode: 'BANDIT' }));
});

test('AUDIT_ATTEMPTS is 5', () => {
  assert.equal(C.AUDIT_ATTEMPTS, 5);
});

test('seeded generation is reproducible', () => {
  assert.deepEqual(L.generateGrid(L.mulberry32(1)), L.generateGrid(L.mulberry32(1)));
});

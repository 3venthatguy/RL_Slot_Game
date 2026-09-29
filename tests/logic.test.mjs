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

test('payout tiers are 35/14/1 and independent of pit size and color', () => {
  let s4Fav = 0, s4All = 0, majFav = 0, majAll = 0, restFav = 0, restAll = 0;
  for (const g of grids) {
    const t = [0, 0, 0];
    machinesOf(g).forEach((i) => t[g.tiers[i]]++);
    assert.deepEqual(t, [35, 14, 1]);
    for (const i of machinesOf(g)) {
      if (i === g.trueCell) continue;
      const fav = g.tiers[i] === L.TIER.FAVORABLE ? 1 : 0;
      if (inS4(g, i)) { s4All++; s4Fav += fav; } else { restAll++; restFav += fav; }
      if (g.colors[i] === g.majorColor) { majAll++; majFav += fav; }
    }
  }
  const base = 14 / 49;
  for (const [name, f, a] of [['size-4 pits', s4Fav, s4All], ['majority color', majFav, majAll], ['other', restFav, restAll]]) {
    assert.ok(Math.abs(f / a - base) < 0.015, `${name}: favorable rate ${(f / a).toFixed(3)} vs ${base.toFixed(3)}`);
  }
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

test('spin draws stay in range and tier EVs match the spec', () => {
  const r = L.mulberry32(99);
  const draws = { 0: [], 1: [], 2: [] };
  for (let k = 0; k < 60000; k++) for (const t of [0, 1, 2]) draws[t].push(L.spin(t, r));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(draws[0].every((v) => v >= -2 && v <= 1));
  assert.ok(draws[1].every((v) => v >= -1 && v <= 2));
  assert.ok(draws[2].every((v) => (v >= -1 && v <= 2) || (v >= 15 && v <= 25)));
  assert.ok(Math.abs(mean(draws[0]) - -0.5) < 0.03);
  assert.ok(Math.abs(mean(draws[1]) - 0.3) < 0.03);
  assert.ok(Math.abs(mean(draws[2]) - L.tierEV(2)) < 0.2);
  const jackpotRate = draws[2].filter((v) => v >= 15).length / draws[2].length;
  assert.equal(C.JACKPOT_CHANCE, 0.5);
  assert.ok(Math.abs(jackpotRate - C.JACKPOT_CHANCE) < 0.01, `jackpot rate ${jackpotRate}`);
  assert.ok(Math.abs(L.tierEV(0) - -0.5) < 1e-9);
  assert.ok(Math.abs(L.tierEV(1) - 0.3) < 1e-9);
  // 0.5 x mean jackpot $20 + 0.5 x favorable $0.30
  assert.ok(Math.abs(L.tierEV(2) - 10.15) < 1e-9);
  assert.throws(() => L.spin(-1, r));
});

test('aggregateEV is computed from the tiers (35 house + 14 favorable + 1 true)', () => {
  const expected = 35 * L.tierEV(0) + 14 * L.tierEV(1) + L.tierEV(2);
  for (const g of grids.slice(0, 50)) assert.ok(Math.abs(L.aggregateEV(g) - expected) < 1e-9);
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
  const bad = [
    null, 42, 'x', {}, { ...good, v: 2 }, { ...good, phase: 'win' }, { ...good, spinsLeft: 16 },
    { ...good, spinsLeft: -1 }, { ...good, net: 1.5 }, { ...good, wrongTaps: [grids[3].trueCell] },
    { ...good, wrongTaps: 'no' }, { ...good, auditCode: 'BANDIT' }, { ...good, phase: 'success', auditCode: null },
    { ...good, phase: 'success', auditCode: 'K7QM2P' },
    { ...good, grid: { ...grids[3], cells: grids[3].cells.slice(1) } },
    { ...good, grid: { ...grids[3], majorColor: (grids[3].majorColor + 1) % 6 } },
  ];
  for (const b of bad) assert.equal(L.validateSavedState(b), null, JSON.stringify(b)?.slice(0, 80));
  assert.ok(L.validateSavedState({ ...good, phase: 'success', auditCode: 'BANDIT' }));
});

test('seeded generation is reproducible', () => {
  assert.deepEqual(L.generateGrid(L.mulberry32(1)), L.generateGrid(L.mulberry32(1)));
});

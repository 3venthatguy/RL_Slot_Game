# The House Rule

A single-file browser game for a reinforcement-learning workshop. Teams audit a casino floor (a 12×12 grid of 50 slot machines and 94 aisles) and must find the one machine secretly rigged in the customer's favor. Two structural rules decide which machine it is, and teams have to discover both.

## Design rationale

- **The lesson is generalizing a rule, not exploiting one layout.** Every practice casino is freshly generated. The two rules never change, but where they apply does. Teams have to infer the rule from many examples, the way a policy has to generalize across environments.
- **Pits are an explicit grouping.** Pits can touch each other on the floor, so empty space alone doesn't always separate clusters. The generator assigns each machine to a pit and draws each pit's outline, so "pit size" is readable at a glance instead of a puzzle about adjacency.
- **The color rule is global on purpose.** "Most common color on the whole floor" makes players look at the entire grid, not just a local neighborhood. The margin of 4 or more keeps the rule unambiguous without making it trivial.
- **Spin payouts are weak, noisy evidence.** The true machine behaves like an ordinary favorable machine 90% of the time, and payout tiers are assigned independently of pit and color. A 15-spin budget rarely surfaces the jackpot, so structure beats spin data.
- **The Final Audit disables spinning.** Teams have to name the machine on a floor they've never seen, using only structure. That proves they learned the rule rather than memorizing or sampling.

## Files

| File | Purpose |
|---|---|
| `index.html` | The complete game: inline CSS and JS, no dependencies, no network. |
| `tests/logic.test.mjs` | Node `node:test` suite for the generation logic. |

### How the tests stay in sync with the game

There is no separate `logic.js`. All pure logic lives in `index.html` between `/* LOGIC:BEGIN` and `/* LOGIC:END */`. The test file reads `index.html`, pulls out that block, and evaluates it with `node:vm`, so the tests always run the exact code that ships and there is no inline or copy step to forget. Keep the block free of DOM access, and don't rename the markers.

## Running

```sh
# Tests (Node 18+; no install needed)
node --test tests/logic.test.mjs

# Play locally: just open the file
start index.html        # Windows
open index.html         # macOS
xdg-open index.html     # Linux
```

It works from `file://`. If you prefer a local server: `npx serve .` or `python -m http.server`.

## Tuning

All tunables are in the `CONFIG` object at the top of the logic block in `index.html`:

| Constant | Default | Meaning |
|---|---|---|
| `PIT_COUNT_MIN` / `PIT_COUNT_MAX` | 8 / 14 | Range for the number of pits, K |
| `TRUE_PIT_SIZE` | 4 | The position rule (the true machine's pit size) |
| `TRUE_PIT_COUNT_MIN` / `_MAX` | 2 / 4 | How many pits have exactly `TRUE_PIT_SIZE` machines |
| `OTHER_PIT_SIZES` | `[3,5,6,7]` | Allowed sizes for all other pits, so every pit is 3–7 machines (must not include `TRUE_PIT_SIZE`) |
| `MAJOR_WEIGHT` | 3 | Draw weight of the majority color vs. 1 for each other color |
| `MIN_MARGIN` | 4 | Minimum lead of the majority color over the runner-up |
| `MAJOR_SOFT_CAP` | 18 | Maximum count of the majority color |
| `HOUSE_OUTCOMES` | `[-2..+1]`, EV −0.50 | Payout table `[dollars, weight]` for the 35 house machines |
| `FAVORABLE_OUTCOMES` | `[-1..+2]`, EV +0.30 | Payout table for the 14 favorable machines (and the true machine's normal spins) |
| `FAVORABLE_COUNT` | 14 | Number of favorable machines; house = 49 − this |
| `JACKPOT_CHANCE`, `JACKPOT_MIN`, `JACKPOT_MAX` | 0.1, 15, 25 | The true machine's heavy tail |
| `SPIN_BUDGET` | 15 | Spins per practice casino |
| `AUDIT_CODE` | `BANDIT` | Code shown on every passed audit |

UI timing constants (`SPIN_COOLDOWN_MS`, `NUDGE_AFTER_WRONG`) sit at the top of the UI script. The grid shape (`ROWS`, `COLS`, `MACHINE_COUNT`, `AISLE_COUNT`, currently 12×12 / 50 / 94) is also in `CONFIG`; `AISLE_COUNT` must equal `ROWS × COLS − MACHINE_COUNT`, and the board picks up `COLS` automatically. Run the tests after any change: they check every invariant the game relies on.

## Hosting

The game is a single static file with no network requests, so any static host works.

- **Next.js:** copy `index.html` into `public/`, for example as `public/house-rule/index.html`. It's then served at `/house-rule/index.html`. Link to that full path; Next doesn't serve `index.html` for a bare directory URL in `public/`.
- **Netlify Drop:** drag a folder containing `index.html` onto <https://app.netlify.com/drop>.
- **GitHub Pages:** commit `index.html` to the repo root (or `/docs`), then turn on Pages under *Settings → Pages → Deploy from a branch*.

## Saved progress

The game saves the current session to `localStorage` (key `house-rule:v1`), only so an accidental refresh doesn't lose progress. A refresh mid-practice **resumes the same casino with the same remaining spins**, so refreshing never refills the budget. A refresh in the Audit resumes the same audit grid, and a refresh on the success screen keeps the audit code. Saved data is fully validated on load and silently discarded if anything is off. If storage is blocked, the game still works; it just starts fresh at the intro after a reload.

## Facilitator debug view

Add `?debug=1` to the URL (for example `index.html?debug=1`) to show a panel under the grid. It lists the true machine's position, its pit id and size, all pit sizes, the majority and runner-up colors with counts, the tier EVs, and the summed expected value across all 50 machines. The true machine also gets a dashed outline. Use it to sanity-check generations before the workshop.

**Never link to `?debug=1` from anything players see.** Nothing in the game UI links to it, so keep it that way in any page that hosts the game.

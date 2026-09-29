# The House Rule

A single-file browser game for a reinforcement-learning workshop. Teams audit a casino floor (a 12×12 grid of 50 slot machines and 94 aisles) and must find the one machine secretly rigged in the customer's favor. Two structural rules decide which machine it is, and teams have to discover both.

## Design rationale

- **The lesson is generalizing a rule, not exploiting one layout.** Every practice casino is freshly generated. The two rules never change, but where they apply does. Teams have to infer the rule from many examples, the way a policy has to generalize across environments.
- **Pits are an explicit grouping.** Pits can touch each other on the floor, so empty space alone doesn't always separate clusters. The generator assigns each machine to a pit and draws each pit's outline, so "pit size" is readable at a glance instead of a puzzle about adjacency.
- **The color rule is global on purpose.** "Most common color on the whole floor" makes players look at the entire grid, not just a local neighborhood. The margin of 4 or more keeps the rule unambiguous without making it trivial.
- **Payouts form a gradient toward the answer.** Every machine gets a graded score from the same two rules, read as distances instead of pass/fail: how close its pit size is to 4, and how common its color is relative to the majority color. The two parts are weighted and summed into a score from 0 to 1. The true machine is always the unique 1. Machines scoring at or below `WARM_THRESHOLD` pay like plain house machines. Above it, spins increasingly draw from a warm table that can pay +$2 or +$3, which house machines never do. So a machine that is "almost right" pays noticeably better and points teams in the right direction. About 15 machines per floor end up favoring the customer, so most still favor the house. The true machine still pays a $15–$25 jackpot on half its spins.
- **The Final Audit disables spinning.** Teams have to name the machine on a floor they've never seen, using only structure. That proves they learned the rule rather than memorizing or sampling.
- **The Final Audit gives 5 tries, with no rule explanation ever shown.** A wrong tap only dims that machine and shows how many tries remain; it never says which rule the machine failed. A 6th wrong tap clears the session and sends the team back to the home page to start over. A correct tap confirms success but still explains nothing, so the two rules stay undocumented in the UI even after a team passes — the only way to learn them is by reading the floor across many practice casinos.

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
| `SCORE_WEIGHT_PIT` / `SCORE_WEIGHT_COLOR` | 1 / 1 | Weights of pit-size closeness and color frequency in the graded score (any positive values keep the true machine the unique maximum) |
| `WARM_THRESHOLD` | 0.6 | Scores at or below this pay exactly like house machines; above it the warm share rises linearly to 1 at score 1 |
| `HOUSE_OUTCOMES` | `[-2..+1]`, EV −0.50 | Payout table `[dollars, weight]` for cold machines |
| `WARM_OUTCOMES` | `[0..+3]`, EV +1.50 | Payout table blended in above the threshold, in proportion to the score |
| `FAVORABLE_OUTCOMES` | `[-1..+2]`, EV +0.30 | The true machine's non-jackpot spins only |
| `JACKPOT_CHANCE`, `JACKPOT_MIN`, `JACKPOT_MAX` | 0.5, 15, 25 | Chance and range of the true machine's jackpot |
| `SPIN_BUDGET` | 30 | Spins per practice casino |
| `AUDIT_CODE` | `BANDIT` | Code shown on every passed audit |
| `AUDIT_ATTEMPTS` | 5 | Wrong taps allowed in the Final Audit before it restarts |

The UI timing constant `SPIN_COOLDOWN_MS` sits at the top of the UI script. The grid shape (`ROWS`, `COLS`, `MACHINE_COUNT`, `AISLE_COUNT`, currently 12×12 / 50 / 94) is also in `CONFIG`; `AISLE_COUNT` must equal `ROWS × COLS − MACHINE_COUNT`, and the board picks up `COLS` automatically. Run the tests after any change: they check every invariant the game relies on.

## Hosting

The game is a single static file with no network requests, so any static host works.

- **Next.js:** copy `index.html` into `public/`, for example as `public/house-rule/index.html`. It's then served at `/house-rule/index.html`. Link to that full path; Next doesn't serve `index.html` for a bare directory URL in `public/`.
- **Netlify Drop:** drag a folder containing `index.html` onto <https://app.netlify.com/drop>.
- **GitHub Pages:** commit `index.html` to the repo root (or `/docs`), then turn on Pages under *Settings → Pages → Deploy from a branch*.

## Saved progress

Every new visit (a new tab or window, or reopening the file or site) starts at the home page. Within a tab, the game saves the current session to `sessionStorage` (key `house-rule:v1`) only so an accidental refresh doesn't lose progress. A refresh mid-practice **resumes the same casino with the same remaining spins**, so refreshing never refills the budget. Net winnings reset to $0 with every new casino. A refresh in the Audit resumes the same audit grid with the same wrong taps and attempts remaining (a refresh never grants extra attempts), and a refresh on the success screen keeps the audit code. Saved data is fully validated on load and silently discarded if anything is off. If storage is blocked, the game still works; it just starts fresh at the intro after a reload.

## Facilitator debug view

Add `?debug=1` to the URL (for example `index.html?debug=1`) to show a panel under the grid. It lists the true machine's position, its pit id and size, all pit sizes, the majority and runner-up colors with counts, the true machine's score and EV, the best-scoring other machine, how many machines are warm and how many favor the customer, the house/warm/true EV endpoints, and the summed expected value across all 50 machines. The true machine also gets a dashed outline. Use it to sanity-check generations before the workshop.

**Never link to `?debug=1` from anything players see.** Nothing in the game UI links to it, so keep it that way in any page that hosts the game.

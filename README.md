# Multiple Input Calculator

Type one expression. Feed it many inputs. See every answer at once — in a table, on a curve.

**Live:** https://nadzilla.github.io/Multiple-Input-Calculator/

![A calculator for functions, not arithmetic](https://img.shields.io/badge/deps-math.js%20only-38E8B0?style=flat-square) ![No build step](https://img.shields.io/badge/build-none-6A8088?style=flat-square)

---

## What it does

Most calculators answer one question at a time. This one evaluates `f(x)` across a
whole set of inputs in a single pass, so you can see the shape of an answer instead
of a single number.

- **Lists, ranges and expressions as input** — `1, 2, 3` · `0..10` · `0..1:0.25` · `pi/2` · `2^8`
- **Live plot** of the curve across your input range, with your inputs marked and a
  crosshair readout as you sweep the mouse
- **Parameter knobs** — any extra symbol in the expression (`a x^2 + b x + c`) becomes
  a slider, so you can watch the curve move
- **Full math.js vocabulary** — trig, logs, factorials, `nthRoot`, `mod`, constants
  like `pi` and `e`, implicit multiplication (`3x`)
- **Per-row errors** — `sqrt(-4)` or `1/0` flags that row instead of killing the run
- **Stats** for the result set: min, max, mean, sum
- **CSV copy / download**, and a **shareable link** that restores the whole session
- **Light / dark**, keyboard-friendly, works on a phone, remembers your last session

## Input syntax

| You type | You get |
|---|---|
| `5` | one input |
| `1, 2, 3` or `1 2 3` | three inputs |
| `0..10` | `0, 1, 2, … 10` |
| `0..1:0.25` | `0, 0.25, 0.5, 0.75, 1` |
| `10..0:2` | counts down |
| `pi/2`, `2^8`, `sqrt(2)` | evaluated, then added as a value |

Ranges are capped at 1000 generated values, and the table at 2000 rows.

## Keyboard

| Key | Action |
|---|---|
| <kbd>Enter</kbd> | add the current input(s) |
| <kbd>Esc</kbd> | clear the input box |
| <kbd>/</kbd> | jump to the expression field |

## Run it locally

No build, no bundler, no install — it's three static files.

```bash
git clone https://github.com/Nadzilla/Multiple-Input-Calculator.git
cd Multiple-Input-Calculator
npm start          # → http://localhost:4321
```

Opening `index.html` directly in a browser works too.

```
index.html      markup
css/style.css   design tokens + layout
js/app.js       parser, evaluator, plot renderer
```

math.js is loaded from cdnjs with a pinned version and an SRI hash — there are no
`node_modules` to install.

## Design

Dark mode is an oscilloscope: near-black surface, phosphor-mint signal, monospace
readouts. Light mode is engineering graph paper. One signal hue carries all data in
both, so the chart never changes meaning when the theme does.

## What changed in v2

The original was a single 253-line `index.html`. Rebuilt, and fixed along the way:

- the math.js `<script src>` used a **Windows backslash path**, so it 404'd on
  GitHub Pages and on any non-Windows machine
- it called **`math.eval`**, removed from math.js in v6 — the app was dead against
  any current build (now `evaluate`, pinned at 14.5.3)
- `numberInput.maxLength = "1"` silently capped **every input to a single digit**
- inputs were passed into the scope as **strings**, so math.js was doing string
  work instead of arithmetic
- one shared "Bad Input" flag meant a single out-of-domain value marked the whole
  expression invalid
- rows were `<th>` cells with numeric `id`s (`id="1"`), and *Reset* emptied the
  `<tr>`s but left them in the DOM, so the table grew forever
- `node_modules` (1520 files) was committed; now gitignored and off the dependency
  path entirely

## License

MIT

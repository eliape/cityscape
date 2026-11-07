# Transit City

A browser simulator in which a city grows on its own and slowly chokes on its own travel demand.
See the v0.1 specification for the model. This repository currently holds the **simulation layer
and its controls**; transit line building comes next.

```sh
make install      # npm install
make dev           # http://localhost:5173 (dev builds include the parameter tuning panel)
npm test           # Vitest: numerics, solver convergence, model behaviour
npm run headless -- 40 1 '{"beta":0.12}'   # run 40 years with seed 1 and overrides, print a summary
```

## Layout

| Path | What |
| --- | --- |
| `src/sim/` | Pure TypeScript model, no DOM: `grid`, `fields`, `network`, `travel`, `landuse`, `nucleation`, `params`, `rng`, `simulation` |
| `src/worker/simWorker.ts` | Owns the state, runs the tick loop (1× = one month per second), applies commands, streams snapshots (≤ 10/s) via Comlink |
| `src/render/` | Three.js map: a separate building layer (`lots.ts`: one building per 50 m lot, grown from the model's fields by construction / redevelopment / demolition events), ground overlay texture with GPU colour ramps, camera |
| `src/ui/` | Preact side panel, bottom bar, uPlot stats, lil-gui tuning |

## Controls

Space play/pause · 1 / 2 / 3 speed 1×, 4×, 16× · O cycle overlays. The tuning panel (every model
parameter) shows in dev builds, or in any build with `?tune` in the URL.

## Model notes

- All parameters are in physical units (m, m², per km², m²/month), so the cell size in `grid.ts` can change without retuning.

- Fast layer: walking + street, solved as a combined distribution/assignment problem (Evans) by
  Frank–Wolfe with a Newton line search, on 256 zones. Re-solved yearly or when a travel parameter changes.
- Slow layer: explicit Euler on ρ, J, R, S with a 5-point no-flux Laplacian and nucleation.
- One addition to the spec: bids use ln A − η ln(city total) (η = `scaleNorm`, default 1). With the
  plain logsum (η = 0) bids rise with the log of city size everywhere, and the city fills the whole
  grid at uniform density. η = 1 bounds the city like a classic open-city model; 1 − η is the
  return to scale. Firms also see a labour-market term that holds jobs near half the population.

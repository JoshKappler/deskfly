# deskfly

A housefly that lives on your screen. It buzzes around, lands on window
edges, screen borders and text inputs, grooms, walks, and startles away from
your cursor. Its startle reflex runs on the real thing: the complete FlyWire
connectome of an adult fruit fly brain (139,255 neurons, 3.87M connections)
simulated as a leaky integrate-and-fire network after Shiu et al. 2024.
Cursor approaches fly -> looming neurons (LC4, LPLC2) get Poisson drive ->
the spike cascade reaches the giant fiber escape neurons (DNp01) -> takeoff.

## Run

```
npm install
npm run build:helper     # Swift scanner for window edges / text inputs
npm run fetch:brain      # ~54 MB from FlyWire's public bucket
npm run prep:brain       # pack CSVs into binary arrays
npm run launch           # start at normal priority via `open`
```

Without the brain data the fly still flies; a stub emits the two firing
rates the behavior reads and the tray shows "stub brain". With it, the tray
shows "FlyWire live". Quit from the fly menu bar item.

Text-input landing needs Accessibility permission for the app (System
Settings -> Privacy & Security -> Accessibility); window edges and screen
borders work without it. Single display (the primary) for now.

## Pieces

- `src/` Electron overlay: transparent, click-through, always on top
- `src/behavior.js` flight physics and the perch/walk/groom/escape states
- `src/photofly.js` renderer built from real fly photographs (`sprites/`)
- `src/sprite.js` procedural vector fly, used when sprites are absent
- `brain/` the LIF simulation (worker thread; idles ~2% CPU, spikes only
  when stimulated)
- `helper/perchscan.swift` window edges (occlusion-subtracted) + AX text fields
- `scripts/sim-smoke.mjs` proves the loom -> giant fiber pathway end to end

## Debug

`DESKFLY_POSE=perch|flight|walk|groom DESKFLY_ZOOM=7 DESKFLY_CAPTURE=1 npm start`
pins the fly at screen centre and writes /tmp/deskfly-cap.png every 1.5s.
`DESKFLY_SIZE=<pt>` sets body length (default 18).

## Data and credits

Connectome: FlyWire public release, snapshot 783, CC BY-NC 4.0. Not
committed here; `npm run fetch:brain` downloads it. Cite Dorkenwald et al.
Nature 2024, Schlegel et al. Nature 2024. Model constants: Shiu et al.,
Nature 2024 (`brain/params.json`); deviations: dt 0.2 ms instead of 0.1,
a weak random background drive, and event-driven active-set integration.
Fly photo sources and licenses: `reference/SOURCES.md`.

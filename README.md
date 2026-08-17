# deskfly

A housefly that lives on your screen, run by the real FlyWire connectome of
an adult fruit fly brain: 139,255 neurons, 3.87M connections, simulated as a
leaky integrate-and-fire network after Shiu et al. 2024.

The desktop is its 3D world: the screen plane is a grass floor, every window
edge stands on it as a line of trees it can land in, berries appear in the
grass, and your cursor stalks it as a dark predator. That world is raycast
into a spherical panorama and fed to the fly's own retinotopic photoreceptor
map (11,118 cells placed from their real positions), so the optic lobe
computes motion and looming from what the fly actually sees. Behavior is
read out of the real command neurons: giant fiber (DNp01) fires -> escape
takeoff away from the louder LC4/LPLC2 side; DNp09 -> walking bouts;
DNa01/02 asymmetry -> steering; DNg11 -> grooming (articulated forelegs rub,
then wipe the eyes, in side view on a treetop); MDN -> backing up; standing
on food drives the labellar sugar neurons and the proboscis motor pool
answers -> it eats.

Menu bar fly icon -> "What the fly sees" opens the color view of its world
with live firing rates.

## Install

The easy way: clone this repo, open it in a coding agent (Claude Code,
Cursor, etc.), and say "set it up and launch it, per the README". The agent
runs the manual steps below and sorts out whatever your machine is missing.

Manual setup (macOS; needs Node 20+ and the Xcode command line tools for one
small Swift helper):

```
npm install
npm run build:helper     # Swift scanner for window edges / text inputs
npm run fetch:brain      # ~86 MB from FlyWire's public bucket + annotations
npm run prep:brain       # pack into binary arrays + eye map + cell groups
npm run launch           # start at normal priority via `open`
```

Without brain data a labeled stub fakes the two rates behavior needs.
Text-input landing spots need an Accessibility grant; window edges work
without. Primary display only. Quit from the fly menu bar item.

Optional hotkey: the app writes its pid to `/tmp/deskfly.pid` and toggles
the viewer on SIGUSR2, so any hotkey tool can bind
`kill -USR2 $(cat /tmp/deskfly.pid)` to open what the fly sees.

## Honesty notes, in one place

- LIF point neurons, fixed 1.8ms delays, one transmitter sign per neuron
  (GABA/glutamate inhibitory). No plasticity, no neuromodulation.
- The retina-to-lamina layer is truncated in FAFB, so luminance-change drive
  enters at L1-L5 and R7/R8, as rectified-contrast excitation.
- The sim runs at whatever fraction of real time fits ~25% of one core
  (typically 0.15-0.35x); reactions are correspondingly delayed.
- Command neurons carry a weak Poisson "internal state" drive so spontaneous
  bouts exist; escape, steering direction, and feeding are sensory-driven.
- Flight paths, landing mechanics and perch choice are body-level heuristics;
  the brain decides when, what, and which way.
- `scripts/vision-smoke.mjs` proves panorama -> optic lobe -> giant fiber
  with no scripted stimulus; `scripts/probe-cascade.mjs` reports layer-by-
  layer propagation.

## Data and credits

Connectome: FlyWire public release 783 (CC BY-NC 4.0), fetched not committed;
cite Dorkenwald et al. 2024, Schlegel et al. 2024 (annotations), Shiu et al.
2024 (model constants, `brain/params.json`). Sprite photo sources and
licenses: `reference/SOURCES.md` (side view: CC BY-SA 4.0, Elena Regina).
Code: MIT.

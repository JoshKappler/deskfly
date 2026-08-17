# deskfly

A housefly that lives on your screen, run by the real FlyWire connectome of
an adult fruit fly brain: 139,255 neurons, 3.87M connections, simulated as a
leaky integrate-and-fire network after Shiu et al. 2024.

The desktop is its 3D world, an alternate reality of your actual desktop:
the screen plane is a grass meadow, every window edge is a line of low-poly
trees with landable branches (drag a window and its grove slides with it),
the screen borders are the forest ring around it, berries grow where food
spawns, a pond reflects the sky, and your cursor prowls the meadow as a
dark mound of earth. One three.js scene renders that
world twice: a cube camera at the fly's position becomes the 360-degree
luminance panorama its real retinotopic eye map receives (11,118 cells at
their measured positions), and a perspective fly-cam shows you the same
world from wherever it is, at its altitude, looking where it looks. The
optic lobe computes motion and looming from that panorama; command neurons
(giant fiber escape, DNp09 walking, DNa01/02 steering, DNg11 grooming, MDN
backing, sugar cells and the proboscis motor pool for feeding) drive what
the body does, on the desktop and in the world alike. It perches on
treetops and branches, and grooms in side view with articulated forelegs.

Menu bar fly icon -> "What the fly sees" opens the fly-cam, with a HUD
(state, altitude, pitch, heading, live firing rates) and an inset showing
the actual eye input.

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
- Rendering is GPU rasterization (three.js), not path tracing; the pond and
  berry reflections sample a live environment cubemap re-rendered from the
  fly's position, so they show real scene content with approximate parallax.
- The eye and the viewer render the same scene, wind-blown grass included.
  Trees and branches are also physical (landable); rocks, flowers, bushes
  and the pond are visible to the fly but intangible.
- The sim runs at whatever fraction of real time fits its wall budget, most
  of one core (typically 0.25-0.45x); reactions are correspondingly delayed.
- Command neurons carry a weak Poisson "internal state" drive so spontaneous
  bouts exist, scaled by a labeled hunger variable that rises between meals
  and falls as the sugar cells taste food, so activity comes in waves.
  Escape, steering direction, and feeding are sensory-driven.
- Flight paths, landing mechanics and perch choice are body-level heuristics;
  the brain decides when, what, and which way.
- `scripts/vision-smoke.mjs` proves panorama -> optic lobe -> giant fiber
  with no scripted stimulus; `scripts/probe-cascade.mjs` reports layer-by-
  layer propagation.

## Data and credits

Connectome: FlyWire public release 783 (CC BY-NC 4.0), fetched not committed;
cite Dorkenwald et al. 2024, Schlegel et al. 2024 (annotations), Shiu et al.
2024 (model constants, `brain/params.json`). 3D rendering: three.js (MIT).
Sprite photo sources and licenses: `reference/SOURCES.md` (side view:
CC BY-SA 4.0, Elena Regina). Code: MIT.

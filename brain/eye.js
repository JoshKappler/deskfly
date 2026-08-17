// The fly's eye: maps screen luminance onto the real photoreceptor array and
// converts it to Poisson spikes delivered through those cells' real synapses.
//
// The input is a world-frame spherical panorama of the fly's 3D world
// (src/world.js renders it): each ommatidium (az, el) looks the panorama up
// at (az + heading, el), so the retina sees exactly what the world renderer
// drew, at the eye's own retinotopy. Rates follow luminance CHANGE against a
// slow per-cell average (phototransduction adapts to static scenes), so a
// still world costs almost nothing and motion lights the optic lobe up.

function poisson(lambda) {
  if (lambda > 30) {
    const u1 = Math.random() || 1e-12, u2 = Math.random();
    const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * g));
  }
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

class Eye {
  constructor(eyeData, params) {
    const v = params.vision;
    const step = Math.max(1, v.subsample | 0);
    const n = Math.floor(eyeData.idx.length / step);
    this.idx = new Int32Array(n);
    this.az = new Float32Array(n);
    this.el = new Float32Array(n);
    this.gain = new Float32Array(n);
    let j = 0;
    for (let i = 0; i < eyeData.idx.length && j < n; i += step) {
      this.idx[j] = eyeData.idx[i];
      this.az[j] = eyeData.az[i];
      this.el[j] = eyeData.el[i];
      this.gain[j] = eyeData.gain[i] * step; // keep total drive constant
      j++;
    }
    this.n = j;
    this.p = v;
    this.adapt = new Float32Array(this.n).fill(0.5); // slow luminance average
    this.cum = new Float64Array(this.n);
    this.total = 0;
  }

  // pano: { data: Uint8Array grayscale, w, h } spanning az -PI..PI (world
  // frame), el -PI/2..PI/2 top-to-bottom
  // fly:  { x, y, heading, z }
  update(pano, fly, dtMs) {
    const p = this.p;
    const k = Math.exp(-dtMs / p.adapt_tau_ms);
    const TAU = Math.PI * 2;
    let total = 0;
    for (let i = 0; i < this.n; i++) {
      let a = this.az[i] + fly.heading;
      a -= Math.floor((a + Math.PI) / TAU) * TAU; // wrap to -PI..PI
      let px = ((a + Math.PI) / TAU * pano.w) | 0;
      let py = ((Math.PI / 2 - this.el[i]) / Math.PI * pano.h) | 0;
      if (px >= pano.w) px = pano.w - 1;
      if (py >= pano.h) py = pano.h - 1;
      if (py < 0) py = 0;
      const L = pano.data[py * pano.w + px] / 255;
      const change = Math.abs(L - this.adapt[i]);
      this.adapt[i] += (L - this.adapt[i]) * (1 - k);
      const r = (p.r0_hz + p.r_gain_hz * change) * this.gain[i];
      total += r;
      this.cum[i] = total;
    }
    this.total = total;
  }

  // deliver this tick's photoreceptor spikes into the sim
  tick(sim) {
    if (!this.total) return;
    let n = poisson((this.total * sim.dt) / 1000);
    for (; n > 0; n--) {
      const r = Math.random() * this.total;
      let lo = 0, hi = this.n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.cum[mid] < r) lo = mid + 1; else hi = mid;
      }
      sim.injectSpike(this.idx[lo]);
    }
  }
}

module.exports = { Eye };

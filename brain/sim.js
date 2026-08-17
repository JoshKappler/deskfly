// Leaky integrate-and-fire over the FlyWire connectome, after Shiu et al. 2024:
//   dv/dt = (v_rest - v + g) / tau_mbr,  dg/dt = -g / tau_syn
//   spike: v > v_th  ->  v = v_reset, g = 0, refractory 2.2 ms
//   a presynaptic spike adds syn_count * sign * w_syn to g after a 1.8 ms delay.
// Only neurons whose state moved off rest are iterated, so a quiet brain is
// nearly free and cost scales with activity.

class Sim {
  constructor(data, params) {
    this.p = params;
    this.N = data.N;
    this.off = data.offsets;
    this.tgt = data.targets;
    this.w = data.weights;
    this.dt = params.dt_ms;
    this.decayS = Math.exp(-this.dt / params.tau_syn_ms);
    this.kV = this.dt / params.tau_mbr_ms;
    this.v = new Float32Array(this.N).fill(params.v_rest_mv);
    this.g = new Float32Array(this.N);
    this.refr = new Float32Array(this.N);
    this.spikeCount = new Uint32Array(this.N);
    this.active = new Int32Array(this.N);
    this.activeN = 0;
    this.isActive = new Uint8Array(this.N);
    this.delaySteps = Math.max(1, Math.round(params.delay_ms / this.dt));
    this.ring = Array.from({ length: this.delaySteps + 1 }, () => []);
    this.head = 0;
    this.stims = [];
    this.totalSpikes = 0;
    this.step = 0;
  }

  activate(i) {
    if (!this.isActive[i]) {
      this.isActive[i] = 1;
      this.active[this.activeN++] = i;
    }
  }

  // Poisson drive onto a neuron set, Shiu-style: rate hz, weight w_syn * stim_w_factor
  stimulate(indices, hz, durMs, wMv) {
    this.stims.push({
      idx: indices,
      prob: (hz * this.dt) / 1000,
      w: wMv !== undefined ? wMv : this.p.w_syn_mv * this.p.stim_w_factor,
      steps: Math.round(durMs / this.dt),
    });
  }

  tick() {
    const p = this.p;
    const bucket = this.ring[this.head];
    for (let k = 0; k < bucket.length; k += 2) {
      const i = bucket[k];
      this.g[i] += bucket[k + 1];
      this.activate(i);
    }
    bucket.length = 0;

    for (let s = this.stims.length - 1; s >= 0; s--) {
      const st = this.stims[s];
      if (--st.steps < 0) { this.stims.splice(s, 1); continue; }
      for (let k = 0; k < st.idx.length; k++) {
        if (Math.random() < st.prob) {
          const i = st.idx[k];
          this.g[i] += st.w;
          this.activate(i);
        }
      }
    }

    const out = this.ring[(this.head + this.delaySteps) % this.ring.length];
    let n = 0;
    let spikes = 0;
    for (let a = 0; a < this.activeN; a++) {
      const i = this.active[a];
      this.g[i] *= this.decayS;
      let keep = true;
      if (this.refr[i] > 0) {
        this.refr[i] -= this.dt;
        this.v[i] = p.v_reset_mv;
      } else {
        this.v[i] += this.kV * (p.v_rest_mv - this.v[i] + this.g[i]);
        if (this.v[i] >= p.v_th_mv) {
          spikes++;
          this.totalSpikes++;
          this.spikeCount[i]++;
          this.v[i] = p.v_reset_mv;
          this.g[i] = 0;
          this.refr[i] = p.refr_ms;
          for (let k = this.off[i]; k < this.off[i + 1]; k++) out.push(this.tgt[k], this.w[k]);
        } else if (Math.abs(this.v[i] - p.v_rest_mv) < 0.004 && Math.abs(this.g[i]) < 0.004) {
          this.v[i] = p.v_rest_mv;
          this.g[i] = 0;
          keep = false;
        }
      }
      if (keep) this.active[n++] = i;
      else this.isActive[i] = 0;
    }
    this.activeN = n;
    this.head = (this.head + 1) % this.ring.length;
    this.step++;
    return spikes;
  }
}

module.exports = { Sim };

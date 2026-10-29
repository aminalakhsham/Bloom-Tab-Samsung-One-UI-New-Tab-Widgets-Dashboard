// Samsung Music player engine: plays tracks from the on-device library through Web Audio (volume, short fades,
// 9-band equaliser, playback speed, crossfade). It runs in the offscreen document (offscreen.html) so music keeps
// playing while you browse and after the new tab is closed; outside the extension a page uses it directly.
//
// Two "decks" (audio elements) let the next track fade in while the current one fades out. The engine never decides
// what plays next: when a track ends (or a crossfade into the next one starts) it reports `ended` and the service
// worker writes the new state, which comes back through apply().
import { mdb } from './db.js';
import { EQ_BANDS, eqGains, upNext } from './core.js';

const FADE = 0.25;

class Deck {
  constructor(engine) {
    this.e = engine;
    this.a = new Audio();
    this.a.preload = 'auto';
    this.id = null;
    this.url = null;
    this.gain = null;
    this.target = 0;
    this.counted = false;
    this.done = false; // its end was already reported (crossfade under way)
    this.xfFailed = false;
    this.loading = Promise.resolve(false);
    const a = this.a;
    for (const ev of ['playing', 'pause', 'seeked', 'durationchange', 'waiting']) a.addEventListener(ev, () => this.e.reportPos(this));
    a.addEventListener('ended', () => this.e.onEnded(this));
    a.addEventListener('error', () => this.e.onError(this));
    a.addEventListener('timeupdate', () => this.e.onTime(this));
  }

  load(id, start = 0, quiet = false) {
    this.id = id;
    this.done = false;
    this.counted = false;
    this.xfFailed = false;
    this.loading = (async () => {
      const blob = await mdb.getAudio(id).catch(() => null);
      if (this.id !== id) return false; // superseded while loading
      if (!blob) {
        if (!quiet) this.e.report({ type: 'error', id });
        return false;
      }
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(blob);
      this.a.src = this.url;
      if (start > 0) {
        await new Promise((r) => {
          this.a.addEventListener('loadedmetadata', r, { once: true });
          this.a.addEventListener('error', r, { once: true });
        });
        if (this.id === id) {
          try {
            this.a.currentTime = start;
          } catch {}
        }
      }
      return this.id === id;
    })();
    return this.loading;
  }

  fade(to, dur = FADE) {
    this.target = to;
    const ac = this.e.ac;
    if (!ac || !this.gain) return;
    const g = this.gain.gain, t = ac.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    if (dur <= 0) g.setValueAtTime(to, t);
    else g.linearRampToValueAtTime(to, t + dur);
  }

  played() {
    if (this.counted || !this.id) return;
    this.counted = true;
    this.e.report({ type: 'played', id: this.id });
  }

  stop() {
    this.a.pause();
    this.a.removeAttribute('src');
    this.a.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.id = null;
    this.done = false;
    this.fade(0, 0);
  }
}

export class MusicEngine {
  /** report(msg): { type: 'pos', id, pos, dur, playing } | { type: 'ended', id, xf? } | { type: 'error', id } | { type: 'played', id } */
  constructor(report) {
    this.report = report;
    this.decks = [new Deck(this), new Deck(this)];
    this.cur = this.decks[0];
    this.inc = null; // the next track fading in during a crossfade
    this.m = null;
    this.seekN = null;
    this.want = false;
    this.ac = null;
    this.pre = null;
    this.bands = [];
    this.out = null;
    this.vol = 0.8;
    this.eqKey = '';
    this.pauseT = null;
    this.lastPing = 0;
  }

  other(d) {
    return d === this.decks[0] ? this.decks[1] : this.decks[0];
  }

  level() {
    return Math.pow(Math.max(0, Math.min(1, this.vol)), 2);
  }

  graph() {
    if (this.ac) {
      if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
      return;
    }
    const ac = (this.ac = new (globalThis.AudioContext || globalThis.webkitAudioContext)());
    this.pre = ac.createGain();
    for (const d of this.decks) {
      d.gain = ac.createGain();
      d.gain.gain.value = 0;
      ac.createMediaElementSource(d.a).connect(d.gain).connect(this.pre);
    }
    this.bands = EQ_BANDS.map((f, i) => {
      const b = ac.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.1;
      b.gain.value = 0;
      return b;
    });
    this.out = ac.createGain();
    this.out.gain.value = this.level();
    let n = this.pre;
    for (const b of this.bands) n = n.connect(b);
    n.connect(this.out).connect(ac.destination);
    this.eqKey = '';
    this.setEq(this.m);
  }

  setEq(m) {
    const g = eqGains(m);
    const key = g.join(',');
    if (key === this.eqKey || !this.ac) return;
    this.eqKey = key;
    const t = this.ac.currentTime;
    this.bands.forEach((b, i) => b.gain.setTargetAtTime(g[i], t, 0.05));
    // boosted bands would clip: lower the input by half the biggest boost
    this.pre.gain.setTargetAtTime(Math.pow(10, (-Math.max(0, ...g) * 0.5) / 20), t, 0.05);
  }

  reportPos(d, playing) {
    if (d !== this.cur || !d.id) return;
    const a = d.a;
    this.report({ type: 'pos', id: d.id, pos: a.currentTime || 0, dur: isFinite(a.duration) ? a.duration : 0, playing: playing ?? (!a.paused && !a.ended && a.readyState > 2) });
  }

  onEnded(d) {
    if (d !== this.cur) return d.stop(); // the old track of a crossfade ran out
    if (!d.id || d.done) return;
    d.done = true;
    d.played();
    this.report({ type: 'ended', id: d.id });
  }

  onError(d) {
    if (d === this.cur && d.id && d.url) this.report({ type: 'error', id: d.id });
  }

  onTime(d) {
    if (d !== this.cur) return;
    const a = d.a;
    if (!d.counted && a.currentTime >= Math.min(30, (a.duration || 60) / 2)) d.played();
    // an occasional checkpoint lets playback resume at the right spot after the browser restarts
    const now = Date.now();
    if (!a.paused && now - this.lastPing > 15000) {
      this.lastPing = now;
      this.reportPos(d);
    }
    const xf = +this.m?.crossfade || 0;
    if (xf > 0 && !this.inc && this.want && !d.done && !d.xfFailed && !a.paused && isFinite(a.duration) && a.duration > xf * 2 + 2) {
      const left = (a.duration - a.currentTime) / (a.playbackRate || 1);
      if (left <= xf) {
        const next = upNext(this.m);
        if (next && next !== d.id) this.crossfade(d, next);
      }
    }
  }

  /** Start the next track under the end of this one, then tell the service worker this one is over. */
  async crossfade(d, nextId) {
    d.done = true;
    const inc = (this.inc = this.other(d));
    const fail = () => {
      if (this.inc === inc) {
        this.inc = null;
        inc.stop();
      }
      d.done = false;
      d.xfFailed = true; // let it end normally
    };
    if (!(await inc.load(nextId, 0, true)) || this.inc !== inc || this.cur !== d) return fail();
    this.graph();
    inc.a.playbackRate = this.m?.speed || 1;
    inc.fade(0, 0);
    try {
      await inc.a.play();
    } catch {
      return fail();
    }
    if (this.inc !== inc) {
      if (this.cur !== inc) inc.stop(); // dropped meanwhile (it may also have become the current deck: keep it)
      return;
    }
    const t =Math.max(0.5, (d.a.duration - d.a.currentTime) / (d.a.playbackRate || 1));
    d.fade(0, t);
    inc.fade(1, t);
    d.played();
    this.report({ type: 'ended', id: d.id, xf: true });
  }

  dropIncoming() {
    if (!this.inc) return;
    this.inc.stop();
    this.inc = null;
    this.cur.done = false;
  }

  /** Make the player match the stored state `m` ('music') given the last reported position `p` ('musicPos'). */
  async apply(m, p) {
    this.m = m;
    const id = m?.queue?.[m.index] || null;
    this.vol = m?.volume ?? 0.8;
    if (this.out) this.out.gain.setTargetAtTime(this.level(), this.ac.currentTime, 0.05);
    this.setEq(m);
    for (const d of this.decks) if (d.a.playbackRate !== (m?.speed || 1)) d.a.playbackRate = m?.speed || 1;
    if (!id) return this.stopAll();
    // the track fading in became the current one
    if (this.inc && this.inc.id === id && this.cur.id !== id) {
      const old = this.cur;
      this.cur = this.inc;
      this.inc = null;
      this.seekN = m.seek?.n ?? null;
      setTimeout(() => old !== this.cur && old !== this.inc && old.stop(), Math.max(0, (old.a.duration - old.a.currentTime) * 1000) + 400);
      setTimeout(() => this.reportPos(this.cur), 50); // its 'playing' event came before it was the current track
    }
    const d = this.cur;
    d.a.loop = m.repeat === 'one';
    if (id !== d.id) {
      this.dropIncoming();
      // a paused track is only loaded when it's played
      if (!m.playing) {
        if (d.id) d.stop();
        return;
      }
      const seek = m.seek?.id === id ? m.seek : null;
      const start = p?.id === id && (!seek || (p.at || 0) >= (seek.at || 0)) ? p.pos : seek ? seek.pos : 0;
      this.seekN = m.seek?.n ?? null;
      if (!(await d.load(id, start)) || d.id !== id || this.cur !== d) return;
    } else {
      await d.loading;
      if (m.seek && m.seek.n !== this.seekN && m.seek.id === id) {
        this.seekN = m.seek.n;
        this.dropIncoming();
        d.done = false;
        try {
          d.a.currentTime = m.seek.pos;
        } catch {}
      }
    }
    if (this.m !== m) return; // a newer state arrived while loading
    this.want = !!m.playing;
    clearTimeout(this.pauseT);
    if (m.playing) {
      this.graph();
      if (d.a.paused) {
        d.fade(0, 0);
        try {
          await d.a.play();
        } catch (e) {
          if (e.name !== 'AbortError') this.reportPos(d, false);
          return;
        }
      }
      if (d.target !== 1) d.fade(1);
      if (this.inc?.a.paused) this.inc.a.play().catch(() => {});
    } else if (!d.a.paused || this.inc) {
      // fade out, then pause (unless play is pressed again meanwhile)
      d.fade(0);
      this.inc?.fade(0);
      this.pauseT = setTimeout(() => {
        if (this.want) return;
        d.a.pause();
        this.dropIncoming();
      }, FADE * 1000 + 40);
    }
  }

  stopAll() {
    clearTimeout(this.pauseT);
    this.want = false;
    this.inc = null;
    for (const d of this.decks) d.stop();
  }
}

// Gaming Hub, after Samsung Gaming Hub on One UI: a floating bottom navigation with Home (a hero card for today's
// puzzles and the streak, Continue playing, Instant plays with game artwork, Daily challenges), Library (every game
// as a card, filtered by kind) and Profile (player level, Game Booster–style stat tiles, Play time for the week, most
// played games, achievements). A game opens as a One UI sub-page: Back, the title with its level, a timer chip that
// pauses, Undo and the ⋮ menu (New game, Difficulty, Daily puzzle, the game's own options, How to play, Statistics).
// Wins and losses end in One UI dialogs. Games live in js/games/<game>.js (contract in index.js); records in center.js.
import { h, escapeHtml as esc } from '../core/util.js';
import { t, addStrings, fmtDate } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { iconBtn, menu, dialog, confirm, choose, prompt, seg, toast, list, row } from '../core/ui.js';
import { currentApp } from '../core/apps.js';
import { store } from '../core/store.js';
import { isLocked } from '../shell/lock.js';
import { GAMES, gameById } from './index.js';
import * as GC from './center.js';
import { gameArt, gameIcon } from './art.js';
import { fmtTime, newSeed, num, ltr } from './kit.js';

// ------------------------------------------------------------------ game modules (loaded once, kept for the session)
const MODS = {};
const loading = {};
const loadMod = (id) => (loading[id] ||= (gameById(id)?.load() || Promise.reject(new Error('no game ' + id)))
  .then((m) => (MODS[id] = m.default || null), (e) => { console.error(e); return (MODS[id] = null); }));
export const preload = () => Promise.all(GAMES.map((g) => loadMod(g.id)));

const nameOf = (id) => t(gameById(id)?.name || id);
const levelName = (mod, lv) => { const l = mod?.levels?.find((x) => x.id === lv); return l ? t(l.name) : ''; };
const lowerBetter = (mod, r = {}) => mod?.lowerIsBetter ?? (r.score == null && r.ms != null);
const CATS = { puzzle: 'games.cat.puzzle', cards: 'games.cat.cards', board: 'games.cat.board' };
const clamp01 = (v) => Math.max(0, Math.min(1, v || 0));
const sum = (a) => a.reduce((x, y) => x + (+y || 0), 0);
const lsGet = (k, d) => { try { return localStorage.getItem('gm.' + k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem('gm.' + k, v); } catch {} };
const shortDate = (d = new Date()) => fmtDate(d, { month: 'short', day: 'numeric' });
const days = (n) => (n === 1 ? t('games.days1') : t('games.days', { n: num(n) }));
const ic = (id, cls = '') => `<span class="gm-ic ${cls}">${gameIcon(id)}</span>`;

/** "1 h 12 min", "12 min" or "Less than 1 min". */
export function fmtDur(ms) {
  const m = Math.floor((ms || 0) / 60000);
  if (m < 1) return t('games.dur.lt1');
  return m >= 60 ? t('games.dur.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('games.dur.m', { m });
}
/** A progress ring (0…1) as SVG. */
function ring(p, size = 56, stroke = 6, cls = '') {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r, c = size / 2;
  return `<svg class="gm-ring ${cls}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" class="tr" stroke-width="${stroke}"/>${p > 0 ? `<circle cx="${c}" cy="${c}" r="${r}" class="pr" stroke-width="${stroke}" stroke-dasharray="${(C * clamp01(p)).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${c} ${c})"/>` : ''}</svg>`;
}
/** An achievement medal: a coloured disc with a white glyph when earned, grey with a progress ring while locked. */
const badge = (a, p, on) => `<span class="gm-badge ${on ? 'on' : ''}" style="--c:${a.color}">${on ? '' : ring(Math.min(p, 0.97), 64, 4, 'gm-badge-ring')}<span class="gm-medal">${icon(a.icon, 26)}</span></span>`;
const section = (title, extra, inner, cls = '') => `<section class="gm-sec ${cls}"><div class="gm-sec-h"><h2>${esc(title)}</h2>${extra || ''}</div>${inner}</section>`;

export async function render(ctx) {
  await preload();
  let tab = ['home', 'library', 'profile'].includes(lsGet('tab')) ? lsGet('tab') : 'home';
  let hubPage = null, drawHub = () => {}, game = null, libCat = 'all', achFilter = 'all', dead = false, day = GC.dateKey();
  const banners = h('div', { class: 'gm-banners', 'aria-live': 'polite' });
  ctx.win.appendChild(banners);

  // ---------------------------------------------------------------- tabs
  const TABS = [{ id: 'home', icon: 'gmGamepad', label: 'games.tab.home' }, { id: 'library', icon: 'gmLibrary', label: 'games.tab.library' }, { id: 'profile', icon: 'user', label: 'games.tab.profile' }];
  const tabsBar = () => h('nav', { class: 'ou-tabs gm-tabs' }, TABS.map((tb) =>
    h('button', { class: ['ou-tab', tb.id === tab && 'active'], dataset: { tab: tb.id }, onClick: () => tb.id !== tab && show(tb.id) },
      h('span', { html: icon(tb.icon, 20) }), h('span', null, t(tb.label)))));
  const avatarInner = () => { const n = (GC.profile().name || '').trim(); return n ? esc([...n][0].toUpperCase()) : icon('gmGamepad', 20); };
  const avatarBtn = () => h('button', { class: 'gm-avatar', title: t('games.tab.profile'), 'aria-label': t('games.tab.profile'), html: avatarInner(), onClick: () => show('profile') });

  function show(id) {
    tab = id;
    lsSet('tab', id);
    const opts = {
      home: { title: t('games.app'), subtitle: fmtDate(new Date(), { weekday: 'long', month: 'long', day: 'numeric' }), actions: [avatarBtn()], html: homeHTML },
      library: { title: t('games.library'), subtitle: t('games.nGames', { n: num(GAMES.length) }), actions: [avatarBtn()], html: libraryHTML },
      profile: { title: t('games.profile'), subtitle: '', actions: [iconBtn('more', (e) => profileMenu(e.currentTarget), t('common.more'))], html: profileHTML },
    }[id];
    const page = ctx.page({ title: opts.title, subtitle: opts.subtitle, actions: opts.actions, className: 'gm-page gm-tab-' + id });
    page.el.appendChild(tabsBar());
    page.body.classList.add('gm-body');
    hubPage = page;
    drawHub = () => { page.body.innerHTML = opts.html(); };
    page.onReturn = () => drawHub();
    page.body.addEventListener('click', onHubClick);
    page.body.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) { e.preventDefault(); e.target.click(); } });
    drawHub();
  }
  let renderT = 0;
  const renderSoon = () => { clearTimeout(renderT); renderT = setTimeout(() => { if (!game && !dead && ctx.depth === 1) drawHub(); }, 80); };

  // ---------------------------------------------------------------- Home
  function homeHTML() {
    const puzzles = GC.todayPuzzles(), solved = puzzles.filter((p) => p.solved).length, n = GC.streak(), best = GC.bestStreak();
    const next = puzzles.find((p) => !p.solved), today = GC.dateKey();
    const chip = (p) => {
      const mod = MODS[p.id], sv = GC.saved(GC.saveKey(p.id, true));
      const sub = p.solved ? (p.ms != null ? fmtTime(p.ms) : t('games.solved')) : sv ? t('games.resume') : mod?.dailyName ? t(mod.dailyName) : levelName(mod, mod?.dailyLevel);
      return `<button class="gm-daily ${p.solved ? 'done' : ''}" data-play="${p.id}" data-daily="1"><span class="gm-ic">${gameIcon(p.id)}${p.solved ? `<i class="gm-check">${icon('check', 14)}</i>` : ''}</span><b>${esc(p.name)}</b><small>${esc(sub)}</small></button>`;
    };
    let out = `<section class="gm-hero">
      <div class="gm-hero-top"><span class="gm-hero-label">${icon('gmPuzzle', 18)}<span>${esc(t('games.today'))}</span></span><span class="gm-hero-date">${esc(shortDate())}</span></div>
      <div class="gm-hero-main">
        <div class="gm-hero-streak ${n ? 'on' : ''}"><span class="gm-flame">${icon('gmFlameFill', 30)}</span><div><b>${num(n)}</b><span>${esc(n === 1 ? t('games.dayStreak1w') : t('games.dayStreakW'))}</span></div></div>
        <div class="gm-hero-ring">${ring(solved / puzzles.length, 64, 7)}<span><b>${ltr(`${solved}/${puzzles.length}`)}</b><small>${esc(t('games.solved'))}</small></span></div>
      </div>
      <div class="gm-week">${GC.recentDays(7).map((d) => `<span class="${d.won ? 'won' : ''} ${d.day === today ? 'today' : ''}"><i>${d.won ? icon('gmFlameFill', 14) : ''}</i><small>${esc(fmtDate(d.date, { weekday: 'narrow' }))}</small></span>`).join('')}</div>
      <div class="gm-dailies">${puzzles.map(chip).join('')}</div>
      ${next ? `<button class="gm-hero-btn" data-play="${next.id}" data-daily="1">${icon('play', 18)}<span>${esc(t('games.playDaily', { game: next.name }))}</span></button>` : `<p class="gm-hero-done">${icon('checkCircle', 20)}<span>${esc(t('games.allSolved'))}</span></p>`}
      <p class="gm-hero-foot">${esc(n ? t('games.bestStreak', { d: days(best) }) : t('games.startStreak'))}</p>
    </section>`;
    const saves = GC.savedGames();
    if (saves.length) out += section(t('games.continue'), '', `<div class="gm-hrow">${saves.map(contCard).join('')}</div>`);
    out += section(t('games.instant'), `<button class="gm-link" data-go="library">${esc(t('games.seeAll'))}</button>`, `<div class="gm-hrow gm-instant">${GAMES.map(cardHTML).join('')}</div>`);
    const mid = new Date();
    mid.setHours(24, 0, 0, 0);
    const hrs = Math.ceil((mid - Date.now()) / 3600000), winsToday = (store.get('games')?.days || {})[today] || 0;
    const chalRow = (c) => {
      const right = c.done ? `<span class="gm-done" title="${esc(t('games.chalDone'))}">${icon('checkCircle', 24)}</span>`
        : c.game ? `<button class="gm-pill" data-play="${c.game}" ${c.daily ? 'data-daily="1"' : ''}>${esc(t('games.play'))}</button>`
          : `<span class="gm-count">${ltr(`${Math.min(3, winsToday)}/3`)}</span>`;
      return `<div class="ou-row gm-chal ${c.done ? 'done' : ''}">${c.game ? ic(c.game, 'sm') : `<span class="ou-row-ico gm-chal-ic">${icon('gmFlag', 20)}</span>`}<span class="ou-row-text"><span class="ou-row-title">${esc(GC.challengeName(c))}</span><span class="ou-row-sub muted">${esc(c.game ? nameOf(c.game) : t('games.anyGame'))}</span></span>${right}</div>`;
    };
    out += section(t('games.challenges'), `<span class="gm-sec-sub">${esc(hrs > 1 ? t('games.endsIn', { n: hrs }) : t('games.endsSoon'))}</span>`, `<div class="ou-card ou-list gm-chals">${GC.todayChallenges().map(chalRow).join('')}</div>`);
    return `<div class="gm-wrap">${out}</div>`;
  }
  function contCard(s) {
    const mod = MODS[s.id], i = s.info || {};
    const sub = [s.daily ? t('games.daily') : levelName(mod, s.level), i.ms != null ? fmtTime(i.ms) : i.score != null ? t('games.scoreN', { n: num(i.score) }) : ''].filter(Boolean).join(' · ');
    return `<button class="gm-cont" data-play="${s.id}" ${s.daily ? 'data-daily="1"' : ''}>${ic(s.id)}<span class="gm-tt"><b>${esc(nameOf(s.id))}</b><small>${esc(sub)}</small>${i.pct != null ? `<span class="gm-bar"><i style="width:${Math.round(clamp01(i.pct) * 100)}%"></i></span>` : ''}</span><span class="gm-pill">${esc(t('games.resume'))}</span></button>`;
  }
  function cardHTML(g) {
    const sv = GC.saved(g.id);
    return `<article class="gm-card" data-play="${g.id}" role="button" tabindex="0" aria-label="${esc(nameOf(g.id))}"><div class="gm-art">${gameArt(g.id)}</div>
      <div class="gm-card-info">${ic(g.id)}<span class="gm-tt"><b>${esc(nameOf(g.id))}</b><small>${esc(t(CATS[g.cat]))}</small></span><span class="gm-pill">${esc(sv ? t('games.resume') : t('games.play'))}</span></div></article>`;
  }

  // ---------------------------------------------------------------- Library
  function libraryHTML() {
    const chips = ['all', 'puzzle', 'cards', 'board'];
    const tile = (g) => {
      const mod = MODS[g.id], s = GC.stats(g.id), sv = GC.saved(g.id);
      const lv = mod?.levels?.length ? GC.pref(g.id, 'level') || mod.level || mod.levels[0].id : 'default';
      const best = s.best?.[lv];
      const meta = [s.played ? t('games.nPlayed', { n: num(s.played) }) : t('games.notPlayed')];
      if (best != null) meta.push(t('games.bestV', { v: lowerBetter(mod) ? fmtTime(best) : num(best) }));
      return `<article class="gm-tile" data-play="${g.id}">
        <div class="gm-art">${gameArt(g.id)}${g.daily ? `<span class="gm-art-pill">${icon('calendar', 14)}<span>${esc(t('games.daily'))}</span></span>` : ''}</div>
        <div class="gm-tile-body"><div class="gm-tile-head">${ic(g.id)}<span class="gm-tt"><b>${esc(nameOf(g.id))}</b><small>${esc(t(CATS[g.cat]))}</small></span><button class="ou-icon-btn gm-tile-more" data-more="${g.id}" title="${esc(t('common.more'))}" aria-label="${esc(t('common.more'))}">${icon('more', 20)}</button></div>
        <p class="gm-tile-desc">${esc(mod?.desc ? t(mod.desc) : '')}</p>
        <p class="gm-tile-meta">${esc(meta.join(' · '))}</p>
        <button class="ou-btn primary gm-tile-play" data-play="${g.id}">${icon('play', 16)}<span>${esc(sv ? t('games.resume') : t('games.play'))}</span></button></div></article>`;
    };
    return `<div class="gm-wrap"><div class="ou-chips gm-cats">${chips.map((c) => `<button class="ou-chip ${c === libCat ? 'active' : ''}" data-cat="${c}">${esc(c === 'all' ? t('games.cat.all') : t(CATS[c]))}</button>`).join('')}</div>
      <div class="gm-lib">${GAMES.filter((g) => libCat === 'all' || g.cat === libCat).map(tile).join('')}</div></div>`;
  }
  function tileMenu(id, anchor) {
    const g = gameById(id), sv = GC.saved(id);
    menu(anchor, [
      { label: sv ? t('games.resume') : t('games.play'), icon: 'play', onClick: () => openGame(id) },
      sv && { label: t('games.newGame'), icon: 'plus', onClick: () => openGame(id, { fresh: true }) },
      g.daily && { label: t('games.daily'), icon: 'calendar', onClick: () => openGame(id, { daily: true }) },
      '-',
      { label: t('games.rules'), icon: 'info', onClick: () => rulesDialog(MODS[id]) },
      { label: t('games.statistics'), icon: 'gmChart', onClick: () => statsPage(id) },
    ], { align: 'end' });
  }

  // ---------------------------------------------------------------- Profile (with Game Booster–style stats)
  function profileHTML() {
    const T = GC.totals(), name = (GC.profile().name || '').trim();
    const week = GC.playTime(7), total = sum(week.map((d) => d.ms)), max = Math.max(...week.map((d) => d.ms), 1), today = GC.dateKey();
    const byGame = GAMES.map((g) => ({ id: g.id, ms: sum(week.map((d) => d.games[g.id] || 0)) })).filter((x) => x.ms > 0).sort((a, b) => b.ms - a.ms);
    let out = `<section class="gm-prof">
      <button class="gm-avatar xl" data-act="name" title="${esc(t('games.changeName'))}" aria-label="${esc(t('games.changeName'))}">${avatarInner()}</button>
      <div class="gm-prof-tt"><b>${esc(name || t('games.player'))}</b><span class="gm-lvl">${icon('starFill', 14)}<span>${esc(t('games.level', { n: num(T.level) }))}</span></span></div>
      <div class="gm-xp"><span class="gm-bar"><i style="width:${Math.round(clamp01(T.levelPct) * 100)}%"></i></span><small>${esc(t('games.xpNext', { n: num(T.toNext), lv: num(T.level + 1) }))}</small></div>
    </section>`;
    const tiles = [
      ['gmGamepad', '#7a5cff', num(T.played), t('games.st.played')],
      ['gmTrophy', '#f5a300', num(T.won), t('games.st.won')],
      ['gmChart', '#2fb36b', T.played ? num(T.won / T.played, { style: 'percent' }) : '–', t('games.st.winRate')],
      ['gmFlame', '#ff6b2c', num(T.bestStreak), t('games.st.bestStreak')],
      ['gmPuzzle', '#3e7bff', num(T.dailies), t('games.st.dailies')],
      ['gmMedal', '#d6249f', ltr(`${T.ach}/${T.achTotal}`), t('games.st.ach')],
    ];
    out += `<div class="gm-tiles">${tiles.map(([i, c, v, l]) => `<div class="gm-stat" style="--c:${c}"><span class="gm-stat-ic">${icon(i, 20)}</span><b>${v}</b><span>${esc(l)}</span></div>`).join('')}</div>`;
    out += `<section class="ou-card gm-time"><div class="gm-card-h"><span>${icon('gmRocket', 18)}<span>${esc(t('games.playTime'))}</span></span><small>${esc(t('games.last7'))}</small></div>
      <b class="gm-time-big">${esc(fmtDur(total))}</b><small class="gm-time-avg">${esc(t('games.avgDay', { d: fmtDur(total / 7) }))}</small>
      <div class="gm-chart">${week.map((d) => `<div class="gm-col ${d.day === today ? 'today' : ''}" title="${esc(fmtDate(d.date, { weekday: 'long' }) + ' · ' + fmtDur(d.ms))}"><span class="gm-colbar"><i style="height:${d.ms ? Math.max(4, Math.round((d.ms / max) * 100)) : 0}%"></i></span><small>${esc(fmtDate(d.date, { weekday: 'narrow' }))}</small></div>`).join('')}</div>
      ${byGame.length ? `<div class="gm-most"><p class="gm-most-h">${esc(t('games.mostPlayed'))}</p>${byGame.map((x) => `<div class="gm-most-row">${ic(x.id, 'sm')}<span class="gm-tt"><b>${esc(nameOf(x.id))}</b><span class="gm-bar"><i style="width:${Math.round((x.ms / byGame[0].ms) * 100)}%"></i></span></span><small>${esc(fmtDur(x.ms))}</small></div>`).join('')}</div>` : `<p class="gm-muted">${esc(t('games.noPlayTime'))}</p>`}
    </section>`;
    const got = GC.achievements(), earned = GC.ACHIEVEMENTS.filter((a) => got[a.id]).sort((a, b) => got[b.id] - got[a.id]);
    out += `<section class="ou-card gm-achcard" data-act="ach" role="button" tabindex="0"><div class="gm-card-h"><span>${icon('gmTrophy', 18)}<span>${esc(t('games.achievements'))}</span></span>${icon('forward', 18)}</div>
      <div class="gm-achsum">${ring(T.ach / T.achTotal, 60, 6)}<div><b>${esc(t('games.nOfTotal', { n: num(T.ach), total: num(T.achTotal) }))}</b><span>${esc(t('games.achEarned'))}</span></div></div>
      <div class="gm-minibadges">${earned.length ? earned.slice(0, 6).map((a) => `<span title="${esc(t(a.name))}">${badge(a, 1, true)}</span>`).join('') : `<p class="gm-muted">${esc(t('games.winToEarn'))}</p>`}</div></section>`;
    return `<div class="gm-wrap gm-profile">${out}</div>`;
  }
  function profileMenu(anchor) {
    menu(anchor, [
      { label: t('games.changeName'), icon: 'edit', onClick: changeName },
      { label: t('games.achievements'), icon: 'gmTrophy', onClick: achPage },
      '-',
      { label: t('games.resetAll'), icon: 'trash', danger: true, onClick: async () => {
        if (!(await confirm(t('games.resetAllQ'), t('games.resetAllMsg'), { okLabel: t('games.reset'), danger: true }))) return;
        store.remove('games');
        drawHub();
      } },
    ], { align: 'end' });
  }
  async function changeName() {
    const v = await prompt(t('games.changeName'), { value: GC.profile().name || '', placeholder: t('games.player') });
    if (v == null) return;
    GC.setProfile({ name: v.trim().slice(0, 40) });
    drawHub();
  }

  // ---------------------------------------------------------------- Achievements (a sub-page of Profile)
  function achPage() {
    ctx.push({
      title: t('games.achievements'),
      subtitle: t('games.nOfTotal', { n: num(GC.totals().ach), total: num(GC.ACHIEVEMENTS.length) }),
      className: 'gm-page gm-achpage',
      render(body) {
        body.classList.add('gm-body');
        const listEl = h('div', { class: 'gm-achlist' });
        const draw = () => {
          const g = store.get('games') || {}, got = GC.achievements(), all = GC.ACHIEVEMENTS;
          const groups = [{ title: t('games.general'), list: all.filter((a) => !a.game) }, ...GAMES.map((x) => ({ title: nameOf(x.id), list: all.filter((a) => a.game === x.id) }))];
          const shown = (a) => achFilter === 'all' || (achFilter === 'earned' ? !!got[a.id] : !got[a.id]);
          let out = '';
          for (const gr of groups) {
            const items = gr.list.filter(shown);
            if (!items.length) continue;
            out += section(gr.title, '', `<div class="ou-card ou-list gm-achs">${items.map((a) => {
              const on = !!got[a.id], p = GC.achProgress(a, g);
              const foot = on ? t('games.earnedOn', { date: fmtDate(new Date(got[a.id]), { month: 'short', day: 'numeric', year: 'numeric' }) })
                : a.goal > 1 ? t('games.nOfTotal', { n: num(Math.min(a.goal, Math.floor(a.progress(g) || 0))), total: num(a.goal) }) : t('games.notEarned');
              return `<div class="ou-row gm-ach ${on ? 'on' : ''}">${badge(a, p, on)}<span class="ou-row-text"><span class="ou-row-title">${esc(t(a.name))}</span><span class="gm-ach-desc">${esc(t(a.name + '.d'))}</span><span class="ou-row-sub ${on ? '' : 'muted'}">${esc(foot)}</span></span></div>`;
            }).join('')}</div>`);
          }
          listEl.innerHTML = out || `<div class="ou-empty">${icon('gmTrophy', 56)}<span>${esc(achFilter === 'earned' ? t('games.winToEarn') : t('games.allEarned'))}</span></div>`;
        };
        body.append(h('div', { class: 'gm-wrap' }, seg([{ value: 'all', label: t('games.all') }, { value: 'earned', label: t('games.earned') }, { value: 'locked', label: t('games.locked') }], achFilter, (v) => { achFilter = v; draw(); }), listEl));
        draw();
      },
    });
  }

  // ---------------------------------------------------------------- Statistics (a sub-page, from a game or the Library)
  function statsPage(id) {
    const mod = MODS[id];
    if (!mod) return;
    const shown = (mod.levels || []).filter((l) => !l.noStats), levels = shown.length ? shown : null;
    let lv = levels ? [game?.id === id && !game.daily && game.level, GC.pref(id, 'level'), mod.level].find((v) => v && levels.some((l) => l.id === v)) || levels[0].id : 'default';
    ctx.push({
      title: t('games.statistics'),
      subtitle: nameOf(id),
      className: 'gm-page gm-statspage',
      render(body) {
        body.classList.add('gm-body');
        const box = h('div', { class: 'gm-statlist' });
        const val = (v) => h('span', { class: 'gm-val' }, v);
        const draw = () => {
          const s = GC.stats(id), L = s.lv?.[lv] || (levels ? { p: 0, w: 0 } : { p: s.played || 0, w: s.won || 0 }), best = s.best?.[lv], lower = lowerBetter(mod);
          const rows = [[t('games.st.played'), num(L.p || 0)], [t('games.st.won'), num(L.w || 0)], [t('games.st.winRate'), L.p ? num((L.w || 0) / L.p, { style: 'percent' }) : '–'],
            [lower ? t('games.bestTime') : t('games.bestScore'), best == null ? '–' : lower ? fmtTime(best) : num(best)]];
          if (lower && L.n) rows.push([t('games.avgTime'), fmtTime(L.t / L.n)]);
          rows.push([t('games.curRun'), num(s.run || 0)], [t('games.bestRun'), num(s.bestRun || 0)]);
          let extra = [];
          try { extra = (game?.id === id && game.ctrl.stats?.()) || []; } catch {}
          for (const x of extra) rows.push([x.label, x.value]);
          const parts = [list(...rows.map(([k, v]) => row({ title: k, right: val(v) })))];
          if (gameById(id).daily) parts.push(h('div', { class: 'ou-subheader' }, t('games.daily')), list(row({ title: t('games.dailySolved'), right: val(num(GC.dailySolved(id))) }), row({ title: t('games.curStreak'), right: val(days(GC.streak())) }), row({ title: t('games.bestStreakL'), right: val(days(GC.bestStreak())) })));
          parts.push(h('div', { class: 'gm-actions' }, h('button', { class: 'ou-btn danger', onClick: reset }, t('games.resetStats'))));
          box.replaceChildren(...parts);
        };
        const reset = async () => {
          if (!(await confirm(t('games.resetQ'), t('games.resetMsg', { game: nameOf(id) }), { okLabel: t('games.reset'), danger: true }))) return;
          GC.resetStats(id);
          draw();
        };
        const wrap = h('div', { class: 'gm-wrap' });
        if (levels) wrap.append(seg(levels.map((l) => ({ value: l.id, label: t(l.name) })), lv, (v) => { lv = v; draw(); }));
        wrap.append(box);
        body.append(wrap);
        draw();
      },
    });
  }

  // ---------------------------------------------------------------- hub clicks
  function onHubClick(e) {
    const more = e.target.closest('[data-more]');
    if (more) { tileMenu(more.dataset.more, more); return; }
    const cat = e.target.closest('[data-cat]');
    if (cat) { libCat = cat.dataset.cat; drawHub(); return; }
    const go = e.target.closest('[data-go]');
    if (go) { show(go.dataset.go); return; }
    const a = e.target.closest('[data-act]');
    if (a) { if (a.dataset.act === 'name') changeName(); else if (a.dataset.act === 'ach') achPage(); return; }
    const pl = e.target.closest('[data-play]');
    if (pl) openGame(pl.dataset.play, { daily: !!pl.dataset.daily });
  }

  // ---------------------------------------------------------------- Game Center-like banners for achievements
  const queue = [];
  let showing = false;
  function celebrate(out) {
    for (const id of out?.chal || []) queue.push({ chal: id });
    for (const id of out?.ach || []) queue.push({ ach: id });
    pump();
  }
  function pump() {
    if (showing || !queue.length || dead) return;
    showing = true;
    const b = queue.shift(), a = b.ach && GC.achById(b.ach), c = b.chal && GC.CHALLENGES.find((x) => x.id === b.chal);
    if (!a && !c) { showing = false; pump(); return; }
    const node = h('div', { class: 'gm-banner', role: 'status', html: `${a ? badge(a, 1, true) : `<span class="gm-banner-ic">${icon('gmFlag', 22)}</span>`}<span class="gm-tt"><small>${esc(a ? t('games.achUnlocked') : t('games.chalDone'))}</small><b>${esc(a ? t(a.name) : GC.challengeName(c))}</b></span>` });
    banners.appendChild(node);
    requestAnimationFrame(() => node.classList.add('show'));
    // a backlog (several unlocked at once) moves along faster
    setTimeout(() => { node.classList.remove('show'); setTimeout(() => { node.remove(); showing = false; pump(); }, 320); }, queue.length ? 1600 : 3000);
  }

  // ---------------------------------------------------------------- playing a game
  /** The game page is on top, in the open window, and nothing covers it (no menu, dialog or lock). */
  const onTop = (p) => game === p && ctx.depth === p.depth && currentApp() === 'games' && !isLocked() && !document.querySelector('.ou-dialog-scrim, .ou-menu-scrim');
  function makeCtx(p) {
    const live = () => game === p;
    return {
      get daily() { return p.daily; },
      get seed() { return p.seed; },
      get level() { return p.level; },
      toast: (m) => toast(m),
      record: (r) => recordResult(p, r),
      finish: (r) => {
        const out = recordResult(p, r), round = p.round;
        setTimeout(() => { if (live() && p.round === round) resultDialog(p, r, out); }, r?.delay || 0);
        return out;
      },
      save: (s) => GC.save(p.key, s, s == null ? undefined : { level: p.level, ...(p.daily ? { day: GC.dateKey() } : {}), info: info(p.mod, s) }),
      load: () => GC.saved(p.key)?.s ?? null,
      changed: () => { if (live()) syncBar(p); },
      achieve: (id) => { if (GC.achById(id) && GC.unlock(id)) celebrate({ ach: [id] }); },
      active: () => live() && !p.paused && onTop(p),
      paused: () => !!p.paused,
      reduceMotion: () => document.documentElement.dataset.motion === 'reduce',
      progress: (f) => { const out = GC.progress(p.id, { level: p.level, ...f }); celebrate(out); return out; },
    };
  }
  function info(mod, s) { try { const i = mod?.info?.(s); return i && typeof i === 'object' ? i : undefined; } catch { return undefined; } }
  function recordResult(p, r = {}) {
    const res = { ...r, level: r.level ?? p.level, daily: r.daily ?? p.daily };
    delete res.title; delete res.keep; delete res.delay;
    const out = GC.record(p.id, res, { lowerIsBetter: lowerBetter(p.mod, r) });
    if (!r.keep) GC.save(p.key, null);
    celebrate(out);
    return out;
  }

  async function openGame(id, { daily = false, fresh = false } = {}) {
    if (!gameById(id)) return;
    const mod = await loadMod(id);
    if (dead) return;
    if (!mod) { toast(t('games.error')); return; }
    daily = daily && !!gameById(id).daily;
    if (game && game.id === id && game.daily === daily && !fresh) { while (ctx.depth > game.depth) ctx.pop(); return; }
    if (daily && GC.dailyResult(id)?.won) { solvedDialog(id); return; }
    closeGamePage();
    const key = GC.saveKey(id, daily);
    if (fresh) GC.save(key, null);
    const sv = GC.saved(key);
    const level = mod.levels?.length ? (daily ? mod.dailyLevel || mod.level : sv?.level || GC.pref(id, 'level') || mod.level || mod.levels[0].id) : undefined;
    const p = { id, mod, key, daily, level, seed: daily ? GC.dailySeed(id) : newSeed(), ctrl: {}, paused: false, round: 0 };
    game = p;
    ctx.push({ title: nameOf(id), hero: false, className: 'gm-gpage gm-g-' + id, actions: barActions(p), render: (body, page) => mountPage(p, body, page) });
  }
  /** Back to the hub: pops the game page and anything pushed over it. */
  function closeGamePage() { while (ctx.depth > 1) ctx.pop(); }

  function barActions(p) {
    p.timerBtn = h('button', { class: 'gm-timer', type: 'button', onClick: () => setPaused(p, !p.paused) }, h('span', { class: 'gm-timer-ic' }), h('span', { class: 'gm-timer-t' }, '0:00'));
    p.undoBtn = iconBtn('gmUndo', () => { if (game === p && p.ctrl.undo && !p.paused) { p.ctrl.undo(); syncBar(p); } }, t('common.undo'));
    p.undoBtn.dataset.act = 'undo';
    const more = iconBtn('more', (e) => gameMenu(p, e.currentTarget), t('common.more'));
    more.classList.add('gm-gmore');
    return [p.timerBtn, p.undoBtn, more];
  }
  function mountPage(p, body, page) {
    p.depth = ctx.depth;
    // a two-line title: the game, and its level or "Daily puzzle · Oct 26"
    p.titleEl = page.el.querySelector('.app-toolbar-title');
    p.titleEl.classList.add('gm-gtitle');
    p.titleEl.replaceChildren(h('b', null, nameOf(p.id)), h('span', { class: 'gm-gsub' }));
    body.classList.add('gm-gbody');
    p.host = h('div', { class: 'gm-host' });
    p.pauseEl = h('div', { class: 'gm-pause', hidden: true },
      h('div', { class: 'gm-pause-card' },
        h('span', { class: 'gm-ic lg', html: gameIcon(p.id) }),
        h('b', null, t('games.paused')),
        h('span', { class: 'gm-pause-sub' }),
        h('button', { class: 'ou-btn primary gm-resume', onClick: () => setPaused(p, false) }, h('span', { html: icon('play', 18) }), t('games.resume'))));
    p.stage = h('div', { class: 'gm-stage' }, p.host, p.pauseEl);
    body.appendChild(p.stage);
    // covered by Statistics: the clock stops, and starts again when the game is back on top
    page.onReturn = () => { if (p.autoPaused) { p.autoPaused = false; setPaused(p, false); } syncBar(p); };
    mountGame(p);
    syncBar(p);
    return () => closeGame(p);
  }
  function mountGame(p) {
    p.host.innerHTML = '';
    p.host.className = 'gm-host gm-h-' + p.id;
    try {
      p.ctrl = p.mod.mount(p.host, makeCtx(p)) || {};
    } catch (e) {
      console.error(e);
      p.ctrl = {};
      p.host.innerHTML = `<div class="ou-empty">${esc(t('games.error'))}</div>`;
    }
  }
  function closeGame(p) {
    flushTime();
    if (game !== p) return;
    try { p.ctrl?.unmount?.(); } catch (e) { console.error(e); }
    game = null;
    document.querySelectorAll('.gm-dialog').forEach((d) => d._close?.(null));
  }

  /** Starts over in the open game (New game, a level change, Try again). */
  function startNew(p, { level = p.level, daily = p.daily } = {}) {
    if (game !== p) return;
    if (daily !== p.daily) { openGame(p.id, { daily, fresh: true }); return; }
    p.round++;
    p.level = level;
    p.seed = daily ? GC.dailySeed(p.id) : newSeed();
    if (!daily && level) GC.setPref(p.id, 'level', level);
    if (p.ctrl.newGame) { GC.save(p.key, null); p.ctrl.newGame({ level, seed: p.seed, daily }); }
    else { try { p.ctrl.unmount?.(); } catch (e) { console.error(e); } GC.save(p.key, null); mountGame(p); }
    if (p.paused) setPaused(p, false);
    syncBar(p);
  }
  /** A game with real progress in it asks before it is replaced. */
  function inProgress(p) {
    const w = GC.saved(p.key);
    if (!w) return false;
    const i = w.info;
    return !i || i.pct > 0 || i.score > 0 || i.ms > 5000;
  }
  async function askNew(p, level) {
    if (inProgress(p) && !(await withPause(p, () => confirm(t('games.newQ'), t('games.newQMsg'), { okLabel: t('games.newGame') })))) return;
    startNew(p, { level, daily: false });
  }
  async function pickLevel(p) {
    const v = await withPause(p, () => choose(t('games.difficulty'), p.mod.levels.map((l) => ({ value: l.id, label: t(l.name), sub: p.mod.levelSub?.(l.id) })), p.level));
    if (v && v !== p.level) askNew(p, v);
  }
  /** Stops the game's clock while a dialog covers it (without the pause screen), and starts it again after. */
  async function withPause(p, fn) {
    const did = game === p && !!p.ctrl.pause && !p.paused;
    if (did) { p.paused = true; try { p.ctrl.pause(true); } catch {} }
    try {
      return await fn();
    } finally {
      if (did && game === p && p.paused && p.pauseEl.hidden) { p.paused = false; try { p.ctrl.pause(false); } catch {} syncBar(p); }
    }
  }

  function syncBar(p) {
    if (game !== p || !p.titleEl) return;
    p.titleEl.querySelector('.gm-gsub').textContent = p.daily ? `${t('games.daily')} · ${shortDate()}` : levelName(p.mod, p.level);
    p.undoBtn.hidden = !p.ctrl.undo || !!p.mod.undoInGame;
    p.undoBtn.disabled = !(p.ctrl.canUndo?.() ?? true) || p.paused;
    p.timerBtn.hidden = !p.ctrl.time;
    tickTimer(p);
  }
  function tickTimer(p) {
    if (game !== p || !p.ctrl.time) return;
    let ms = null;
    try { ms = p.ctrl.time(); } catch {}
    p.timerBtn.querySelector('.gm-timer-t').textContent = ms == null ? '' : fmtTime(ms);
    p.timerBtn.querySelector('.gm-timer-ic').innerHTML = icon(p.paused ? 'play' : 'pause', 16);
    const label = p.paused ? t('games.resume') : t('games.pause');
    if (p.timerBtn.title !== label) { p.timerBtn.title = label; p.timerBtn.setAttribute('aria-label', label); }
    p.timerBtn.classList.toggle('paused', !!p.paused);
  }
  function setPaused(p, on) {
    if (!p || game !== p || !p.ctrl.pause || !!p.paused === on) return;
    p.paused = on;
    try { p.ctrl.pause(on); } catch (e) { console.error(e); }
    p.stage.classList.toggle('paused', on);
    p.pauseEl.hidden = !on;
    if (on) {
      let ms = null;
      try { ms = p.ctrl.time?.(); } catch {}
      p.pauseEl.querySelector('.gm-pause-sub').textContent = [p.daily ? t('games.daily') : levelName(p.mod, p.level), ms != null ? fmtTime(ms) : ''].filter(Boolean).join(' · ');
      setTimeout(() => p.pauseEl.querySelector('.gm-resume')?.focus({ preventScroll: true }), 60);
    }
    syncBar(p);
  }

  function gameMenu(p, anchor) {
    const mod = p.mod, items = [];
    if (!p.daily) items.push({ label: t('games.newGame'), icon: 'plus', onClick: () => askNew(p, p.level) });
    if (!p.daily && mod.levels?.length) items.push({ label: t('games.difficulty'), icon: 'gmLevels', onClick: () => pickLevel(p) });
    if (gameById(p.id).daily) items.push(p.daily ? { label: t('games.normalGame'), icon: 'gmGamepad', onClick: () => openGame(p.id) } : { label: t('games.daily'), icon: 'calendar', onClick: () => openGame(p.id, { daily: true }) });
    let extra = [];
    try { extra = p.ctrl.menu?.() || []; } catch (e) { console.error(e); }
    if (extra.length) items.push('-', ...extra);
    items.push('-');
    if (p.ctrl.pause && !p.paused) items.push({ label: t('games.pause'), icon: 'pause', onClick: () => setPaused(p, true) });
    items.push({ label: t('games.rules'), icon: 'info', onClick: () => withPause(p, () => rulesDialog(mod)) }, { label: t('games.statistics'), icon: 'gmChart', onClick: () => statsPage(p.id) });
    menu(anchor, items, { align: 'end' });
  }
  function rulesDialog(mod) {
    if (!mod) return null;
    const content = h('div', { class: 'gm-rules' }, ...t(mod.rules || mod.desc).split('\n').map((x) => h('p', null, x)));
    return dialog({ title: t('games.rulesOf', { game: t(mod.name) }), content, className: 'gm-dialog gm-rules-dialog', actions: [{ label: t('common.ok'), value: true, primary: true }] });
  }

  // ---------------------------------------------------------------- One UI result dialogs
  async function resultDialog(p, r, out) {
    const mod = p.mod, s = GC.stats(p.id), lv = r.level ?? p.level, best = s.best?.[lv || 'default'], lower = lowerBetter(mod, r);
    const rows = [];
    if (r.ms != null) rows.push([t('games.time'), fmtTime(r.ms)]);
    if (r.score != null) rows.push([t('games.score'), num(r.score)]);
    if (r.won && best != null) rows.push([lower ? t('games.bestTime') : t('games.bestScore'), lower ? fmtTime(best) : num(best)]);
    if (r.mistakes != null) rows.push([t('games.mistakes'), num(r.mistakes)]);
    const sub = p.daily ? `${t('games.daily')} · ${shortDate()}` : levelName(mod, lv) || nameOf(p.id);
    const n = GC.streak();
    const content = h('div', { class: ['gm-result', r.won ? 'won' : 'lost'], html: `<div class="gm-result-ic"><span class="gm-ic lg">${gameIcon(p.id)}</span><i class="gm-result-badge">${icon(r.won ? 'gmTrophy' : 'close', 18)}</i></div>
      <p class="gm-result-sub">${esc(sub)}</p>
      ${out?.best ? `<span class="gm-newbest">${icon('starFill', 16)}<span>${esc(t('games.newBest'))}</span></span>` : ''}
      ${rows.length ? `<div class="gm-result-stats">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
      ${p.daily && r.won ? `<p class="gm-result-note">${icon('gmFlameFill', 18)}<span>${esc(t('games.streakN', { d: days(n) }))}</span></p><p class="gm-result-foot">${esc(t('games.comeBack'))}</p>` : ''}` });
    const title = r.title || (r.won ? t('games.youWin') : t('games.gameOver'));
    const actions = p.daily && r.won ? [{ label: t('common.done'), value: 'done', primary: true }]
      : [{ label: t('common.done'), value: 'done' }, { label: p.daily ? t('games.tryAgain') : t('games.newGame'), value: 'again', primary: true }];
    const v = await dialog({ title, content, actions, className: 'gm-dialog' });
    if (game !== p || dead) return;
    if (v === 'again') startNew(p);
    else if (v === 'done' && p.daily && r.won) closeGamePage();
  }
  function solvedDialog(id) {
    const r = GC.dailyResult(id);
    const content = h('div', { class: 'gm-result won', html: `<div class="gm-result-ic"><span class="gm-ic lg">${gameIcon(id)}</span><i class="gm-result-badge">${icon('check', 18)}</i></div>
      <p class="gm-result-sub">${esc(r?.ms != null ? t('games.solvedIn', { game: nameOf(id), time: fmtTime(r.ms) }) : t('games.solvedToday', { game: nameOf(id) }))}</p>
      <p class="gm-result-note">${icon('gmFlameFill', 18)}<span>${esc(t('games.streakN', { d: days(GC.streak()) }))}</span></p>
      <p class="gm-result-foot">${esc(t('games.comeBack'))}</p>` });
    return dialog({ title: t('games.solved'), content, className: 'gm-dialog', actions: [{ label: t('common.ok'), value: true, primary: true }] });
  }

  // ---------------------------------------------------------------- keys: the game's own, Ctrl/⌘+Z Undo, P Pause
  // A capture listener, so a game can claim Escape (Chess closes its promotion picker) before the window pops the page.
  const onKey = (e) => {
    const p = game;
    if (!p || !onTop(p) || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (p.paused) {
      if (plain && (e.key === 'Enter' || e.key === ' ' || e.code === 'KeyP')) { e.preventDefault(); setPaused(p, false); }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === 'KeyZ') {
      if (!e.shiftKey && p.ctrl.undo && (p.ctrl.canUndo?.() ?? true)) { e.preventDefault(); p.ctrl.undo(); syncBar(p); }
      return;
    }
    let handled = false;
    try { handled = !!p.ctrl.key?.(e); } catch (err) { console.error(err); }
    if (handled) { e.preventDefault(); return; }
    if (plain && e.code === 'KeyP' && p.ctrl.pause) { e.preventDefault(); setPaused(p, true); }
  };
  addEventListener('keydown', onKey, true);

  // ---------------------------------------------------------------- play time, the timer chip, the day changing
  let ptLast = performance.now(), ptAcc = 0, ptGame = null;
  function flushTime() { if (ptAcc > 0 && ptGame) GC.addPlayTime(ptGame, ptAcc); ptAcc = 0; }
  const tickT = setInterval(() => {
    const now = performance.now(), dt = Math.min(2000, now - ptLast);
    ptLast = now;
    const p = game;
    if (p) {
      tickTimer(p);
      if (!p.paused && !document.hidden && onTop(p)) {
        if (ptGame !== p.id) { flushTime(); ptGame = p.id; }
        ptAcc += dt;
        if (ptAcc >= 20000) flushTime();
      }
    }
    const d = GC.dateKey();
    if (d !== day) { day = d; renderSoon(); }
  }, 500);
  // a hidden tab pauses the game, so the clock doesn't run in the background
  const onVis = () => { if (document.hidden && game) { setPaused(game, true); flushTime(); } };
  document.addEventListener('visibilitychange', onVis);
  const offStore = store.on('games', () => { if (!game) renderSoon(); });

  // ---------------------------------------------------------------- routes: a widget, Finder or a notification names a tab or a game
  function route(o = {}) {
    const s = o.section;
    if (!s) return;
    if (['home', 'library', 'profile'].includes(s)) { closeGamePage(); if (tab !== s) show(s); return; }
    if (s === 'achievements') { closeGamePage(); show('profile'); achPage(); return; }
    if (s === 'daily') {
      const next = GC.todayPuzzles().find((x) => !x.solved);
      if (next) openGame(next.id, { daily: true });
      else { closeGamePage(); if (tab !== 'home') show('home'); }
      return;
    }
    const [id, d] = String(s).split(/[@:]/);
    if (gameById(id)) openGame(id, { daily: !!o.daily || d === 'daily' });
  }
  ctx.setParams = (p) => route(p || {});
  celebrate({ ach: GC.check() });
  show(tab);
  route(ctx.params || {});

  return () => {
    dead = true;
    if (game) closeGame(game);
    flushTime();
    removeEventListener('keydown', onKey, true);
    clearInterval(tickT);
    clearTimeout(renderT);
    document.removeEventListener('visibilitychange', onVis);
    offStore();
    banners.remove();
  };
}

addStrings({
  en: {
    'games.tab.home': 'Home',
    'games.tab.library': 'Library',
    'games.tab.profile': 'Profile',
    'games.library': 'Library',
    'games.profile': 'Profile',
    'games.nGames': '{n} games',
    'games.playDaily': 'Play {game}',
    'games.allSolved': 'All done! New puzzles tomorrow.',
    'games.bestStreak': 'Best streak: {d}',
    'games.startStreak': 'Solve a daily puzzle to start a streak.',
    'games.instant': 'Instant plays',
    'games.seeAll': 'See all',
    'games.challenges': 'Daily challenges',
    'games.endsIn': 'Ends in {n} h',
    'games.endsSoon': 'Ends in less than an hour',
    'games.anyGame': 'Any game',
    'games.cat.all': 'All',
    'games.cat.puzzle': 'Puzzle',
    'games.cat.cards': 'Card',
    'games.cat.board': 'Board',
    'games.nPlayed': 'Played {n} times',
    'games.notPlayed': 'Not played yet',
    'games.bestV': 'Best {v}',
    'games.player': 'Player',
    'games.level': 'Level {n}',
    'games.xpNext': '{n} XP to level {lv}',
    'games.changeName': 'Change name',
    'games.st.played': 'Games played',
    'games.st.won': 'Games won',
    'games.st.winRate': 'Win rate',
    'games.st.bestStreak': 'Best streak',
    'games.st.dailies': 'Daily puzzles',
    'games.st.ach': 'Achievements',
    'games.playTime': 'Play time',
    'games.last7': 'Last 7 days',
    'games.avgDay': 'Daily average {d}',
    'games.mostPlayed': 'Most played',
    'games.noPlayTime': 'Your play time shows up here once you play a game.',
    'games.dur.hm': '{h} h {m} min',
    'games.dur.m': '{m} min',
    'games.dur.lt1': 'Less than 1 min',
    'games.achievements': 'Achievements',
    'games.nOfTotal': '{n} of {total}',
    'games.achEarned': 'achievements earned',
    'games.winToEarn': 'Win games to earn achievements.',
    'games.allEarned': 'You’ve earned every achievement.',
    'games.all': 'All',
    'games.earned': 'Earned',
    'games.locked': 'Locked',
    'games.earnedOn': 'Earned {date}',
    'games.notEarned': 'Not earned yet',
    'games.general': 'General',
    'games.resetAll': 'Reset Gaming Hub',
    'games.resetAllQ': 'Reset Gaming Hub?',
    'games.resetAllMsg': 'Your stats, streaks, achievements, play time and saved games will be erased.',
    'games.statistics': 'Statistics',
    'games.bestTime': 'Best time',
    'games.bestScore': 'Best score',
    'games.avgTime': 'Average time',
    'games.curRun': 'Current win streak',
    'games.bestRun': 'Best win streak',
    'games.dailySolved': 'Daily puzzles solved',
    'games.curStreak': 'Current streak',
    'games.bestStreakL': 'Best streak',
    'games.resetStats': 'Reset statistics',
    'games.resetQ': 'Reset statistics?',
    'games.resetMsg': 'Games played, wins and best scores for {game} will be erased. Achievements stay.',
    'games.reset': 'Reset',
    'games.error': 'Something went wrong.',
    'games.newGame': 'New game',
    'games.difficulty': 'Difficulty',
    'games.normalGame': 'Normal game',
    'games.pause': 'Pause',
    'games.paused': 'Paused',
    'games.rules': 'How to play',
    'games.rulesOf': 'How to play {game}',
    'games.newQ': 'Start a new game?',
    'games.newQMsg': 'Your current game will end.',
    'games.time': 'Time',
    'games.score': 'Score',
    'games.best': 'Best',
    'games.moves': 'Moves',
    'games.hint': 'Hint',
    'games.mistakes': 'Mistakes',
    'games.highScore': 'High score',
    'games.tryAgain': 'Try again',
    'games.youWin': 'You win!',
    'games.gameOver': 'Game over',
    'games.puzzleSolved': 'Puzzle solved',
    'games.newBest': 'New best!',
    'games.streakN': 'Streak: {d}',
    'games.comeBack': 'Come back tomorrow for a new puzzle.',
    'games.solvedIn': 'You solved today’s {game} in {time}.',
    'games.solvedToday': 'You solved today’s {game}.',
    'games.achUnlocked': 'Achievement unlocked',
    'games.chalDone': 'Challenge complete',
    'games.ach.firstWin': 'First victory', 'games.ach.firstWin.d': 'Win any game.',
    'games.ach.wins10': 'On a roll', 'games.ach.wins10.d': 'Win 10 games.',
    'games.ach.wins50': 'Seasoned player', 'games.ach.wins50.d': 'Win 50 games.',
    'games.ach.allGames': 'Explorer', 'games.ach.allGames.d': 'Finish a game of every kind in Gaming Hub.',
    'games.ach.daily1': 'Daily habit', 'games.ach.daily1.d': 'Solve a daily puzzle.',
    'games.ach.streak3': 'Three-day streak', 'games.ach.streak3.d': 'Solve a daily puzzle three days in a row.',
    'games.ach.streak7': 'Week streak', 'games.ach.streak7.d': 'Solve a daily puzzle seven days in a row.',
    'games.ach.streak30': 'Month streak', 'games.ach.streak30.d': 'Solve a daily puzzle 30 days in a row.',
    'games.ach.perfectDay': 'Perfect day', 'games.ach.perfectDay.d': 'Solve all of today’s daily puzzles.',
    'games.ach.chal1': 'Challenger', 'games.ach.chal1.d': 'Complete a daily challenge.',
    'games.ach.chal10': 'Challenge accepted', 'games.ach.chal10.d': 'Complete 10 daily challenges.',
    'games.ach.nightOwl': 'Night owl', 'games.ach.nightOwl.d': 'Win a game between midnight and 4 a.m.',
    'games.ach.sudoku10': 'Puzzle fan', 'games.ach.sudoku10.d': 'Solve 10 Sudoku puzzles.',
    'games.ach.sudokuFast': 'Speed solver', 'games.ach.sudokuFast.d': 'Solve a Medium Sudoku in under 5 minutes.',
    'games.ach.sudokuClean': 'Flawless', 'games.ach.sudokuClean.d': 'Solve a Hard or Expert Sudoku with no mistakes and no hints.',
    'games.ach.sudokuExpert': 'Sudoku master', 'games.ach.sudokuExpert.d': 'Solve an Expert Sudoku.',
    'games.ach.msFirst': 'All clear', 'games.ach.msFirst.d': 'Clear a Minesweeper board.',
    'games.ach.msIntermediate': 'Bomb squad', 'games.ach.msIntermediate.d': 'Clear an Intermediate board.',
    'games.ach.msExpert': 'Expert sweeper', 'games.ach.msExpert.d': 'Clear an Expert board.',
    'games.ach.msExpertFast': 'Lightning sweep', 'games.ach.msExpertFast.d': 'Clear an Expert board in under 10 minutes.',
    'games.ach.msNoFlag': 'No flags needed', 'games.ach.msNoFlag.d': 'Clear an Intermediate or Expert board without placing a flag.',
    'games.ach.solWin': 'Solitaire winner', 'games.ach.solWin.d': 'Win a game of Solitaire.',
    'games.ach.sol10': 'Card shark', 'games.ach.sol10.d': 'Win 10 games of Solitaire.',
    'games.ach.chessWin': 'Checkmate', 'games.ach.chessWin.d': 'Beat the computer at Chess.',
    'games.ach.chessExpert': 'Grandmaster', 'games.ach.chessExpert.d': 'Beat the computer at Advanced or Expert level.',
    'games.ach.t1024': 'Halfway there', 'games.ach.t1024.d': 'Reach the 1024 tile in 2048.',
    'games.ach.t2048': 'Twenty forty-eight', 'games.ach.t2048.d': 'Reach the 2048 tile.',
    'games.ach.t4096': 'Beyond 2048', 'games.ach.t4096.d': 'Reach the 4096 tile.',
    'games.ach.tScore': 'High scorer', 'games.ach.tScore.d': 'Score 20,000 points in one game of 2048.',
    'games.chal.sudokuDaily8': 'Solve today’s Sudoku in under 8 minutes',
    'games.chal.msDaily': 'Clear today’s Minesweeper board',
    'games.chal.msDaily5': 'Clear today’s Minesweeper board in under 5 minutes',
    'games.chal.solDaily': 'Win today’s Solitaire deal',
    'games.chal.chessDaily': 'Solve today’s chess puzzle',
    'games.chal.sudokuClean': 'Solve a Sudoku without a mistake',
    'games.chal.sudokuHard': 'Solve a Hard Sudoku without hints',
    'games.chal.msBeginner60': 'Clear a Beginner board in under a minute',
    'games.chal.msNoFlag': 'Clear a Minesweeper board without placing a flag',
    'games.chal.t1024': 'Reach the 1024 tile in 2048',
    'games.chal.t10k': 'Score {n} points in one game of 2048',
    'games.chal.solWin': 'Win a game of Solitaire',
    'games.chal.chessWin': 'Beat the computer at Chess',
    'games.chal.wins3': 'Win three games today',
  },
  ar: {
    'games.tab.home': 'الرئيسية',
    'games.tab.library': 'المكتبة',
    'games.tab.profile': 'الملف الشخصي',
    'games.library': 'المكتبة',
    'games.profile': 'الملف الشخصي',
    'games.nGames': '{n} ألعاب',
    'games.playDaily': 'العب {game}',
    'games.allSolved': 'انتهيت! أحاجٍ جديدة غدًا.',
    'games.bestStreak': 'أفضل سلسلة: {d}',
    'games.startStreak': 'حُلّ أحجية يومية لتبدأ سلسلة.',
    'games.instant': 'ألعاب فورية',
    'games.seeAll': 'عرض الكل',
    'games.challenges': 'التحديات اليومية',
    'games.endsIn': 'ينتهي بعد {n} س',
    'games.endsSoon': 'ينتهي خلال أقل من ساعة',
    'games.anyGame': 'أي لعبة',
    'games.cat.all': 'الكل',
    'games.cat.puzzle': 'ألغاز',
    'games.cat.cards': 'ورق',
    'games.cat.board': 'لوحية',
    'games.nPlayed': 'لُعبت {n} مرة',
    'games.notPlayed': 'لم تُلعب بعد',
    'games.bestV': 'الأفضل {v}',
    'games.player': 'لاعب',
    'games.level': 'المستوى {n}',
    'games.xpNext': '{n} نقطة خبرة للمستوى {lv}',
    'games.changeName': 'تغيير الاسم',
    'games.st.played': 'الألعاب التي لعبتها',
    'games.st.won': 'الألعاب التي فزت بها',
    'games.st.winRate': 'نسبة الفوز',
    'games.st.bestStreak': 'أفضل سلسلة',
    'games.st.dailies': 'الأحاجي اليومية',
    'games.st.ach': 'الإنجازات',
    'games.playTime': 'وقت اللعب',
    'games.last7': 'آخر 7 أيام',
    'games.avgDay': 'المتوسط اليومي {d}',
    'games.mostPlayed': 'الأكثر لعبًا',
    'games.noPlayTime': 'يظهر وقت لعبك هنا بعد أن تلعب.',
    'games.dur.hm': '{h} س {m} د',
    'games.dur.m': '{m} د',
    'games.dur.lt1': 'أقل من دقيقة',
    'games.achievements': 'الإنجازات',
    'games.nOfTotal': '{n} من {total}',
    'games.achEarned': 'إنجازات محققة',
    'games.winToEarn': 'افُز في الألعاب لتحصل على إنجازات.',
    'games.allEarned': 'حصلت على كل الإنجازات.',
    'games.all': 'الكل',
    'games.earned': 'محققة',
    'games.locked': 'غير محققة',
    'games.earnedOn': 'حصلت عليها في {date}',
    'games.notEarned': 'لم يتحقق بعد',
    'games.general': 'عام',
    'games.resetAll': 'إعادة تعيين مركز الألعاب',
    'games.resetAllQ': 'إعادة تعيين مركز الألعاب؟',
    'games.resetAllMsg': 'سيتم مسح إحصاءاتك وسلاسلك وإنجازاتك ووقت لعبك وألعابك المحفوظة.',
    'games.statistics': 'الإحصاءات',
    'games.bestTime': 'أفضل وقت',
    'games.bestScore': 'أفضل نتيجة',
    'games.avgTime': 'متوسط الوقت',
    'games.curRun': 'سلسلة الانتصارات الحالية',
    'games.bestRun': 'أطول سلسلة انتصارات',
    'games.dailySolved': 'الأحاجي اليومية المحلولة',
    'games.curStreak': 'السلسلة الحالية',
    'games.bestStreakL': 'أفضل سلسلة',
    'games.resetStats': 'إعادة تعيين الإحصاءات',
    'games.resetQ': 'إعادة تعيين الإحصاءات؟',
    'games.resetMsg': 'سيتم مسح عدد الألعاب والانتصارات وأفضل النتائج في {game}. تبقى الإنجازات.',
    'games.reset': 'إعادة تعيين',
    'games.error': 'حدث خطأ ما.',
    'games.newGame': 'لعبة جديدة',
    'games.difficulty': 'الصعوبة',
    'games.normalGame': 'لعبة عادية',
    'games.pause': 'إيقاف مؤقت',
    'games.paused': 'متوقف مؤقتًا',
    'games.rules': 'طريقة اللعب',
    'games.rulesOf': 'طريقة لعب {game}',
    'games.newQ': 'هل تريد بدء لعبة جديدة؟',
    'games.newQMsg': 'ستنتهي لعبتك الحالية.',
    'games.time': 'الوقت',
    'games.score': 'النقاط',
    'games.best': 'الأفضل',
    'games.moves': 'النقلات',
    'games.hint': 'تلميح',
    'games.mistakes': 'الأخطاء',
    'games.highScore': 'أعلى نتيجة',
    'games.tryAgain': 'إعادة المحاولة',
    'games.youWin': 'لقد فزت!',
    'games.gameOver': 'انتهت اللعبة',
    'games.puzzleSolved': 'تم حل الأحجية',
    'games.newBest': 'رقم قياسي جديد!',
    'games.streakN': 'السلسلة: {d}',
    'games.comeBack': 'عُد غدًا لأحجية جديدة.',
    'games.solvedIn': 'حللت {game} اليوم في {time}.',
    'games.solvedToday': 'حللت {game} اليوم.',
    'games.achUnlocked': 'تم الحصول على إنجاز',
    'games.chalDone': 'اكتمل التحدي',
    'games.ach.firstWin': 'أول انتصار', 'games.ach.firstWin.d': 'افُز في أي لعبة.',
    'games.ach.wins10': 'في أوج التألق', 'games.ach.wins10.d': 'افُز في 10 ألعاب.',
    'games.ach.wins50': 'لاعب متمرّس', 'games.ach.wins50.d': 'افُز في 50 لعبة.',
    'games.ach.allGames': 'المستكشف', 'games.ach.allGames.d': 'أنهِ لعبة من كل نوع في مركز الألعاب.',
    'games.ach.daily1': 'عادة يومية', 'games.ach.daily1.d': 'حُلّ أحجية يومية.',
    'games.ach.streak3': 'سلسلة ثلاثة أيام', 'games.ach.streak3.d': 'حُلّ أحجية يومية ثلاثة أيام متتالية.',
    'games.ach.streak7': 'سلسلة أسبوع', 'games.ach.streak7.d': 'حُلّ أحجية يومية سبعة أيام متتالية.',
    'games.ach.streak30': 'سلسلة شهر', 'games.ach.streak30.d': 'حُلّ أحجية يومية 30 يومًا متتاليًا.',
    'games.ach.perfectDay': 'يوم مثالي', 'games.ach.perfectDay.d': 'حُلّ كل أحاجي اليوم.',
    'games.ach.chal1': 'المتحدّي', 'games.ach.chal1.d': 'أكمل تحديًا يوميًا.',
    'games.ach.chal10': 'التحدي مقبول', 'games.ach.chal10.d': 'أكمل 10 تحديات يومية.',
    'games.ach.nightOwl': 'بومة الليل', 'games.ach.nightOwl.d': 'افُز في لعبة بين منتصف الليل والساعة 4 صباحًا.',
    'games.ach.sudoku10': 'محب الأحاجي', 'games.ach.sudoku10.d': 'حُلّ 10 أحاجي سودوكو.',
    'games.ach.sudokuFast': 'الحلّال السريع', 'games.ach.sudokuFast.d': 'حُلّ سودوكو متوسطة في أقل من 5 دقائق.',
    'games.ach.sudokuClean': 'بلا أخطاء', 'games.ach.sudokuClean.d': 'حُلّ سودوكو صعبة أو للخبراء دون أخطاء أو تلميحات.',
    'games.ach.sudokuExpert': 'سيد السودوكو', 'games.ach.sudokuExpert.d': 'حُلّ سودوكو للخبراء.',
    'games.ach.msFirst': 'اللوحة نظيفة', 'games.ach.msFirst.d': 'نظّف لوحة كاسحة ألغام.',
    'games.ach.msIntermediate': 'فرقة المتفجرات', 'games.ach.msIntermediate.d': 'نظّف لوحة المستوى المتوسط.',
    'games.ach.msExpert': 'كاسح خبير', 'games.ach.msExpert.d': 'نظّف لوحة الخبير.',
    'games.ach.msExpertFast': 'كسح خاطف', 'games.ach.msExpertFast.d': 'نظّف لوحة الخبير في أقل من 10 دقائق.',
    'games.ach.msNoFlag': 'لا حاجة إلى أعلام', 'games.ach.msNoFlag.d': 'نظّف لوحة متوسطة أو لوحة خبير دون وضع أي علم.',
    'games.ach.solWin': 'فائز السوليتير', 'games.ach.solWin.d': 'افُز في لعبة سوليتير.',
    'games.ach.sol10': 'محترف الورق', 'games.ach.sol10.d': 'افُز في 10 ألعاب سوليتير.',
    'games.ach.chessWin': 'كش مات', 'games.ach.chessWin.d': 'اهزم الكمبيوتر في الشطرنج.',
    'games.ach.chessExpert': 'أستاذ كبير', 'games.ach.chessExpert.d': 'اهزم الكمبيوتر في المستوى المتقدم أو مستوى الخبير.',
    'games.ach.t1024': 'في منتصف الطريق', 'games.ach.t1024.d': 'اصنع مربع 1024 في 2048.',
    'games.ach.t2048': 'ألفان وثمانية وأربعون', 'games.ach.t2048.d': 'اصنع مربع 2048.',
    'games.ach.t4096': 'ما بعد 2048', 'games.ach.t4096.d': 'اصنع مربع 4096.',
    'games.ach.tScore': 'صاحب النقاط العالية', 'games.ach.tScore.d': 'احصل على 20,000 نقطة في لعبة 2048 واحدة.',
    'games.chal.sudokuDaily8': 'حُلّ سودوكو اليوم في أقل من 8 دقائق',
    'games.chal.msDaily': 'نظّف لوحة كاسحة الألغام لليوم',
    'games.chal.msDaily5': 'نظّف لوحة كاسحة الألغام لليوم في أقل من 5 دقائق',
    'games.chal.solDaily': 'افُز في توزيعة سوليتير اليوم',
    'games.chal.chessDaily': 'حُلّ أحجية الشطرنج لليوم',
    'games.chal.sudokuClean': 'حُلّ سودوكو دون أي خطأ',
    'games.chal.sudokuHard': 'حُلّ سودوكو صعبة دون تلميحات',
    'games.chal.msBeginner60': 'نظّف لوحة المبتدئ في أقل من دقيقة',
    'games.chal.msNoFlag': 'نظّف لوحة كاسحة الألغام دون وضع أي علم',
    'games.chal.t1024': 'اصنع مربع 1024 في 2048',
    'games.chal.t10k': 'احصل على {n} نقطة في لعبة 2048 واحدة',
    'games.chal.solWin': 'افُز في لعبة سوليتير',
    'games.chal.chessWin': 'اهزم الكمبيوتر في الشطرنج',
    'games.chal.wins3': 'افُز في ثلاث ألعاب اليوم',
  },
});

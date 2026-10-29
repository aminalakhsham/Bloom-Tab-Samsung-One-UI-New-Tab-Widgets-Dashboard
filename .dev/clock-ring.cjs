// Clock ringing through the service worker (js/bg/clock.js) with no Bloom Tab page open: an alarm fired for real by
// chrome.alarms rings into session state (`clockRinging`), plays its synthesised tone looped in the offscreen audio
// host (checked inside offscreen.html: the `play` message on channel 'clock' and a playing <audio>), posts a sticky
// notification with Snooze / Dismiss; the notification's buttons snooze (alarm:<id> re-armed, snoozeAt stored) and
// dismiss (sound stops); "Gradually increase volume" sends rising `volume` messages; a ring left alone expires into
// a snooze (or stops); closing the notification dismisses; a page's 'timer-done' report rings a timer once (the late
// chrome alarm then does nothing); +1 min / Restart; then a page opens on a ring already going and shows it full
// screen, and dismissing it there stops the sound.
// Not "triple": nothing much is drawn.   usage: .dev/run.sh .dev/clock-ring.cjs
module.exports = async ({ browser, page, url, boot, ok, sw, sleep, getStorage, setStorage, shot, logs }) => {
  const get = async (k) => (await getStorage(k))[k];
  const ringing = () => sw.evaluate(() => chrome.storage.session.get('clockRinging').then((r) => r.clockRinging || []));
  const alarm = (n) => sw.evaluate((n) => chrome.alarms.get(n).then((a) => a || null), n);
  const fire = (n, ms = 300) => sw.evaluate((n, d) => chrome.alarms.create(n, { when: Date.now() + d }), n, ms);
  const sys = () => sw.evaluate(() => chrome.notifications.getAll());
  const offscreenCount = () => sw.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length));
  const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; };

  await boot({ settings: { lang: 'en' } });
  await page.goto('about:blank');
  await sleep(300);

  // ——— an alarm rings with no page open ———
  await setStorage({
    notifications: [],
    alarms: [
      { id: 'a1', time: '07:00', days: [], label: 'Wake up', enabled: true, sound: 'beep', volume: 0.6, snooze: true, snoozeMin: 10, snoozeRepeat: 3 },
      { id: 'a2', time: '07:00', days: [1, 2, 3, 4, 5], label: '', enabled: true, sound: 'chimes', volume: 0.8, gradual: true, snooze: false },
    ],
  });
  await fire('alarm:a1');
  let list = await until(async () => { const l = await ringing(); return l.length && l; });
  const e1 = list?.[0];
  ok(e1 && e1.kind === 'alarm' && e1.ref === 'a1' && e1.label === 'Wake up' && e1.tone === 'beep' && e1.volume === 0.6 && e1.snooze && e1.snoozeMin === 10 && e1.until - e1.at === 60e3, `ring entry in session state ${JSON.stringify(e1)}`);
  ok(await until(async () => (await offscreenCount()) === 1), 'the offscreen audio host is created');
  // look inside offscreen.html: what it was told and what its <audio> does
  const target = await browser.waitForTarget((t) => t.url().endsWith('/offscreen.html'), { timeout: 5000 }).catch(() => null);
  ok(!!target, 'offscreen.html target found');
  const cdp = target && (await target.createCDPSession());
  const inOff = async (expr) => (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  if (cdp) {
    await inOff(`(() => {
      globalThis.__log = [];
      chrome.runtime.onMessage.addListener((m) => { if (m.target === 'offscreen') __log.push({ type: m.type, channel: m.channel, loop: m.loop, src: (m.src || '').slice(0, 22), volume: m.volume }); });
      const play = HTMLMediaElement.prototype.play;
      globalThis.__aud = [];
      HTMLMediaElement.prototype.play = function () { __aud.push(this); return play.call(this); };
      return true;
    })()`);
  }
  ok(await until(async () => (await sys())['alarm:a1']), 'system notification alarm:a1');
  const n1 = (await get('notifications')).find((x) => x.ref === 'a1');
  ok(n1 && n1.app === 'clock' && n1.icon === 'alarm' && n1.title === 'Wake up', 'notification list entry (the shell keeps clock rings out of heads-up banners)');
  ok((await get('alarms')).find((a) => a.id === 'a1').enabled === false, 'the one-time alarm switched off');

  // a second alarm (gradual volume, no snooze) rings on top: its tone takes over
  await fire('alarm:a2');
  list = await until(async () => { const l = await ringing(); return l.length === 2 && l; });
  ok(list && list[1].ref === 'a2' && list[1].gradual && list[1].snooze === false, 'second alarm rings too (gradual, no snooze)');
  const log = cdp ? await until(async () => { const l = await inOff('__log'); return l.some((m) => m.type === 'play') && l; }) : null;
  const play = log?.find((m) => m.type === 'play');
  ok(play && play.channel === 'clock' && play.loop === true && play.src === 'data:audio/wav;base64,' && play.volume < 0.8 * 0.2, `offscreen got play (channel clock, looping WAV, starting quietly): ${JSON.stringify(play)}`);
  const playing = cdp ? await until(() => inOff(`(() => { const a = __aud.at(-1); return !!a && !a.paused && a.loop && a.currentTime > 0; })()`), 4000) : false;
  ok(playing, 'the tone really plays (an <audio> looping, time moving) in offscreen.html');
  const vols = cdp ? await until(async () => { const l = (await inOff('__log')).filter((m) => m.type === 'volume'); return l.length >= 2 && l; }, 6000) : null;
  ok(vols && vols.every((m) => m.channel === 'clock') && vols[1].volume > vols[0].volume && vols[0].volume > play.volume, `gradual: rising volume messages (${vols?.map((m) => m.volume.toFixed(2)).join(' → ')})`);
  ok(await until(async () => { const s = await sys(); return s['alarm:a1'] && s['alarm:a2']; }), 'both notifications are up');

  // notification buttons: a2 (no snooze) has only Dismiss
  await sw.evaluate(() => chrome.notifications.onButtonClicked.dispatch('alarm:a2', 0));
  list = await until(async () => { const l = await ringing(); return l.length === 1 && l; });
  ok(list && list[0].ref === 'a1', 'Dismiss button (a2) stops that ring only');
  const log2 = cdp ? await until(async () => { const l = await inOff('__log'); return l.filter((m) => m.type === 'play').length >= 2 && l; }) : null;
  const play2 = log2?.filter((m) => m.type === 'play').at(-1);
  ok(play2 && play2.volume === 0.6, 'a1’s tone plays again at its own volume');
  // a1: Snooze (index 0)
  await sw.evaluate(() => chrome.notifications.onButtonClicked.dispatch('alarm:a1', 0));
  ok(await until(async () => !(await ringing()).length), 'Snooze button: nothing rings any more');
  const a1 = (await get('alarms')).find((a) => a.id === 'a1');
  ok(a1.snoozeAt && Math.abs(a1.snoozeAt - Date.now() - 10 * 60e3) < 5000 && a1.snoozeCount === 1, `snoozed for 10 minutes (snoozeAt, count 1)`);
  const sa = await alarm('alarm:a1');
  ok(sa && sa.scheduledTime === a1.snoozeAt, 'alarm:a1 re-armed at the snooze');
  ok(cdp && (await until(async () => (await inOff('__log')).at(-1)?.type === 'stop')), 'offscreen told to stop channel clock');
  ok(cdp && (await until(() => inOff('__aud.every((a) => a.paused)'))), '…and the sound has stopped');
  // the snooze rings: count kept; snoozing until there are no repeats left
  await setStorage({ alarms: (await get('alarms')).map((a) => (a.id === 'a1' ? { ...a, snoozeAt: Date.now() + 200, snoozeCount: 3 } : a)) });
  await fire('alarm:a1', 200);
  list = await until(async () => { const l = await ringing(); return l.length && l; });
  ok(list && list[0].ref === 'a1' && list[0].snooze === false, 'third snooze rang: no Snooze left (Repeat 3 times)');
  ok((await get('alarms')).find((a) => a.id === 'a1').snoozeAt === 0, 'snoozeAt cleared when it rings');

  // ——— expiry: a ring left alone ———
  await sw.evaluate(() => chrome.storage.session.get('clockRinging').then(({ clockRinging: l }) => chrome.storage.session.set({ clockRinging: l.map((r) => ({ ...r, until: Date.now() - 1 })) })));
  await fire('clockring:end', 100);
  ok(await until(async () => !(await ringing()).length), 'an alarm with no snooze left stops by itself after its minute');
  const sysA1 = (await sys())['alarm:a1'];
  ok(sysA1, 'its notification stays (now saying it was missed)');
  // with snooze left it snoozes by itself
  await setStorage({ alarms: (await get('alarms')).map((a) => (a.id === 'a1' ? { ...a, snoozeCount: 0, snoozeAt: 0, enabled: true } : a)) });
  await fire('alarm:a1', 100);
  await until(async () => (await ringing()).length);
  await sw.evaluate(() => chrome.storage.session.get('clockRinging').then(({ clockRinging: l }) => chrome.storage.session.set({ clockRinging: l.map((r) => ({ ...r, until: Date.now() - 1 })) })));
  await fire('clockring:end', 100);
  ok(await until(async () => !(await ringing()).length), 'an alarm with snooze left…');
  const a1b = (await get('alarms')).find((a) => a.id === 'a1');
  ok(a1b.snoozeAt > Date.now() + 9 * 60e3 && a1b.snoozeCount === 1, '…snoozes by itself');

  // closing the notification dismisses
  await fire('alarm:a2', 100);
  await until(async () => (await ringing()).length);
  await sw.evaluate(() => chrome.notifications.onClosed.dispatch('alarm:a2', true));
  ok(await until(async () => !(await ringing()).length), 'closing the notification (by the user) dismisses');

  // ——— timers: a page's report, then the late chrome alarm ———
  await setStorage({ notifications: [], clockPrefs: { timerSound: 'pulse', timerVolume: 0.5 }, timers: [{ id: 't1', label: 'Tea', duration: 120e3, base: 60e3, endsAt: Date.now() - 200, remaining: 120e3, running: true }] });
  const endsAt = (await get('timers'))[0].endsAt;
  // an extension page reports it (the service worker doesn't receive its own messages): the offscreen document
  const report = () => inOff(`chrome.runtime.sendMessage({ type: 'clock-ring', op: 'timer-done', id: 't1', endsAt: ${endsAt} }).then((r) => !!r)`);
  ok(cdp && (await offscreenCount()) === 1 && (await report()), 'a page reports the timer has ended');
  list = await until(async () => { const l = await ringing(); return l.length && l; });
  const et = list?.[0];
  ok(et && et.kind === 'timer' && et.ref === 't1' && et.tone === 'pulse' && et.volume === 0.5 && et.dur === 60e3 && et.key === 'timer:t1:' + endsAt, `timer-done report rings the timer ${JSON.stringify(et)}`);
  let tm = (await get('timers'))[0];
  ok(!tm.running && tm.rangInPage === true && tm.duration === 60e3 && tm.remaining === 60e3, 'timer reset to the time it was set to, marked rang');
  // a second report and the chrome alarm don't ring it again
  await report();
  await fire('timer:t1', 100);
  await sleep(900);
  ok((await ringing()).length === 1 && (await get('notifications')).filter((n) => n.ref === 't1').length === 1, 'rings once (a second report and the late alarm do nothing)');
  ok(JSON.stringify((await sys())['timer:t1'] ? 1 : 0) === '1', 'timer notification up');
  // +1 min (button index 1)
  await sw.evaluate(() => chrome.notifications.onButtonClicked.dispatch('timer:t1', 1));
  ok(await until(async () => !(await ringing()).length), '+1 min button stops the ring');
  tm = (await get('timers'))[0];
  ok(tm.running && Math.abs(tm.endsAt - Date.now() - 60e3) < 3000 && tm.base === 60e3, '+1 min restarts the same timer for a minute');
  ok((await alarm('timer:t1'))?.scheduledTime === tm.endsAt, '…with its chrome alarm');

  // ——— a page opening on a ring already going shows it; dismissing there stops everything ———
  await setStorage({ alarms: [{ id: 'a3', time: '07:00', days: [], label: 'Meeting', enabled: true }] });
  await fire('alarm:a3', 100);
  await until(async () => (await ringing()).length);
  await page.goto(url);
  await page.waitForFunction(() => window.__bootMs, { timeout: 30000 });
  ok(await until(() => page.evaluate(() => !!document.querySelector('.clk-ringing.alarm.show')), 4000), 'a new tab opens on the ringing screen');
  ok((await page.evaluate(() => document.querySelector('.clk-ring-title')?.textContent)) === 'Meeting', 'with the alarm’s name');
  await shot('clock-ring-01-newtab');
  await page.evaluate(() => document.querySelector('.clk-swipe-wrap.dismiss .clk-swipe').click()); // keyboard-style click acts
  ok(await until(async () => !(await ringing()).length), 'Dismiss in the page ends the ring in the service worker');
  ok(cdp && (await until(async () => (await inOff('__log')).at(-1)?.type === 'stop')), '…and stops the sound');
  ok(await until(() => page.evaluate(() => !document.querySelector('.clk-ringing'))), 'ringing screen gone');
  ok(!(await sys())['alarm:a3'], 'its notification cleared');

  const errs = logs.filter((l) => l.includes('pageerror'));
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
};

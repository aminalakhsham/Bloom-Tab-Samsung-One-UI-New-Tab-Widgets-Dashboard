// Samsung Wallet › Add to Wallet / Edit: the pass editor as a One UI page with a live card preview on top, the fields
// each kind starts with (a boarding pass's route, a ticket's seat, a membership number…), any fields of your own, a
// real barcode (QR, PDF417, Code 128, EAN-13, UPC-A — typed in, or read from a picture where Chrome has the
// BarcodeDetector), the card colour, a logo, a card picture and a photo (pictures go to IndexedDB through
// core/blobs.js), and notes. Cancel / Save sit in a bottom bar, as in Samsung's editors.
import { h, $, $$, escapeHtml as esc, uid, pickFile, readImage } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast, dialog, choose, seg, sw, swatches } from '../core/ui.js';
import { putBlob, delBlob, dataUrlToBlob } from '../core/blobs.js';
import * as M from './model.js';
import { data, mutate } from './data.js';
import { codeProblem, DETECTED, FORMAT_NAMES } from './barcode.js';
import { cardHTML, hydrate } from './card.js';
import { kindInfo, kindOne, kindOneIn } from './format.js';

export const COLORS = ['#1c1c22', '#4a4a52', '#e9e9ee', '#e5484d', '#ff7a2f', '#f5b400', '#2fb36b', '#147d6f', '#1fb5b0', '#3e8bff', '#1f4fd1', '#3d5a80', '#7a3ff2', '#c04ce0', '#e5466e', '#a0714f'];
const IMAGES = { logo: ['wallet.img.logo', 400], art: ['wallet.img.art', 1200], photo: ['wallet.img.photo', 600] };
const imagesFor = (k) => ['logo', 'art', ...(k === 'member' || k === 'id' || k === 'other' || k === 'ticket' ? ['photo'] : [])];
const DATE_LABEL = { boarding: 'wallet.f.departure', ticket: 'wallet.f.dateTime', key: 'wallet.f.validFrom', other: 'wallet.f.date' };

/** A new pass of a kind with the fields Samsung's partners put on one (labels in the UI language). */
export function template(kind) {
  const f = (...keys) => keys.map((k) => ({ l: t('wallet.f.' + k), v: '' }));
  const T = {
    boarding: { header: f('flight', 'gate'), primary: [{ l: '', v: '' }, { l: '', v: '' }], secondary: f('passenger'), aux: f('seat', 'group'), code: { type: 'pdf417' }, transit: 'air' },
    ticket: { header: f('section'), primary: f('event'), secondary: f('venue'), aux: f('row', 'seat'), code: { type: 'qr' } },
    member: { header: f('points'), primary: f('member'), secondary: f('memberNo', 'level'), aux: f('since'), code: { type: 'code128' } },
    coupon: { header: [], primary: f('offer'), secondary: f('store'), aux: [], code: { type: 'code128' } },
    gift: { header: [], primary: f('balance'), secondary: f('cardNo', 'pin'), aux: [], code: { type: 'code128' } },
    key: { header: [], primary: f('room'), secondary: f('address'), aux: [], code: { type: 'qr' } },
    id: { header: [], primary: f('name'), secondary: f('idNo', 'birth'), aux: f('org'), code: { type: 'qr' } },
    other: { header: [], primary: f('title'), secondary: [], aux: [], code: { type: 'qr' } },
  }[kind] || {};
  const p = M.normPass({ kind, ...T, code: { msg: '', alt: '', ...T.code } });
  // the template's empty fields stay (normPass drops fields without a label or value only)
  return { ...p, quick: true };
}

// ———————————————————————————————————————————————————————————— barcode from a picture
let scanOk = null;
/** Whether this browser can read barcodes in pictures (BarcodeDetector exists on ChromeOS, macOS and Android). */
export async function scanAvailable() {
  if (scanOk != null) return scanOk;
  if (!('BarcodeDetector' in globalThis)) return (scanOk = false);
  try { scanOk = (await BarcodeDetector.getSupportedFormats()).length > 0; } catch { scanOk = false; }
  return scanOk;
}
const alert = (title, message) => dialog({ title, message });
/** Asks for a picture and returns the biggest barcode in it: { type, msg } (null when there's none). */
export async function scanPhoto() {
  const file = await pickFile('image/*');
  if (!file) return null;
  try {
    const bmp = await createImageBitmap(file);
    const det = new BarcodeDetector({ formats: await BarcodeDetector.getSupportedFormats() });
    const found = (await det.detect(bmp)).sort((a, b) => b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height);
    if (!found.length) { await alert(t('wallet.noCode'), t('wallet.noCodeSub')); return null; }
    let type = DETECTED[found[0].format];
    if (!type) {
      // Aztec, Data Matrix and the rest can't be drawn again here: their text goes into a QR code, which scanners read too
      await alert(t('wallet.asQr'), t('wallet.asQrSub'));
      type = 'qr';
    }
    toast(t('wallet.codeFound'));
    return { type, msg: found[0].rawValue };
  } catch (e) {
    console.warn('wallet scan', e);
    await alert(t('wallet.noCode'), t('wallet.noCodeSub'));
    return null;
  }
}

// ———————————————————————————————————————————————————————————— the editor
/**
 * openEditor(env, { pass } | { kind, code }, after(pass, isNew)) pushes the editor page. Saving stores the pass, pops the
 * page and calls `after`.
 */
export function openEditor(env, { pass, kind = 'other', code, after } = {}) {
  const { ctx } = env;
  const isNew = !pass;
  const d = pass ? structuredClone(pass) : template(kind);
  if (code) d.code = { ...d.code, ...code };
  // the editor shows secondary and auxiliary fields together as "Details"
  const ed = { header: d.header, primary: d.primary, details: [...d.secondary, ...d.aux], back: d.back };
  const before = { logo: d.logo, art: d.art, photo: d.photo };
  const made = new Set();
  let saved = false, body, preview, form;

  const collect = () => {
    const p = M.normPass({
      ...d, header: ed.header, primary: ed.primary, secondary: ed.details.slice(0, 4), aux: ed.details.slice(4, 9), back: ed.back,
    });
    return p;
  };
  function drawPreview() {
    preview.innerHTML = cardHTML(collect());
    hydrate(preview);
  }
  let pt = 0;
  const later = () => { clearTimeout(pt); pt = setTimeout(drawPreview, 60); };

  const input = (k, value, { type = 'text', ph = '', max = 300, cls = '' } = {}) => `<input class="wl-in ${cls}" data-k="${k}" type="${type}" value="${esc(value ?? '')}" placeholder="${esc(ph)}" maxlength="${max}" aria-label="${esc(ph)}">`;
  const frow = (label, inner, cls = '') => `<label class="wl-frow ${cls}"><span class="wl-frow-l">${esc(label)}</span>${inner}</label>`;
  const pair = (g, f, i, { phL = t('wallet.label'), phV = t('wallet.value') } = {}) => `<div class="wl-pair" data-g="${g}" data-i="${i}">
    <input class="wl-in" data-p="l" value="${esc(f.l)}" placeholder="${esc(phL)}" aria-label="${esc(phL)}" maxlength="60">
    <input class="wl-in" data-p="v" value="${esc(f.v)}" placeholder="${esc(phV)}" aria-label="${esc(phV)}" maxlength="300">
    <button class="wl-rm" data-rm aria-label="${esc(t('wallet.removeField'))}" title="${esc(t('wallet.removeField'))}">${icon('minus', 18)}</button></div>`;
  const group = (g, title, max, hint = '') => `<div class="ou-subheader">${esc(title)}</div><div class="ou-card wl-fgroup" data-g="${g}">
    ${ed[g].map((f, i) => pair(g, f, i)).join('')}
    ${ed[g].length < max ? `<button class="wl-addf" data-addf="${g}">${icon('plus', 18)}<span>${esc(t('wallet.addField'))}</span></button>` : ''}</div>
    ${hint ? `<p class="wl-hint">${esc(hint)}</p>` : ''}`;

  function drawForm() {
    const k = d.kind;
    const dt = d.date ? (d.date.length > 10 ? d.date : d.date + 'T00:00') : '';
    let html = `<div class="ou-card wl-fgroup">
      <button class="wl-frow wl-frow-btn" data-act="kind"><span class="wl-frow-l">${esc(t('wallet.type'))}</span><span class="wl-frow-v"><span class="wl-kdot" style="--c:${kindInfo(k).color}">${icon(kindInfo(k).icon, 16)}</span>${esc(kindOne(k))}</span>${icon('down', 18)}</button>
      ${frow(t('wallet.cardName'), input('name', d.name, { ph: t('wallet.cardNamePh'), max: 80 }))}
      ${k === 'boarding' ? `<div class="wl-frow"><span class="wl-frow-l">${esc(t('wallet.transport'))}</span><span class="wl-transit"></span></div>` : ''}
      ${M.DATED.includes(k) ? frow(t(DATE_LABEL[k]), input('date', dt, { type: 'datetime-local' })) : ''}
      ${frow(k === 'coupon' || k === 'key' ? t('wallet.f.validUntil') : t('wallet.f.expires'), input('expires', d.expires, { type: 'date' }))}
    </div>
    <p class="wl-hint">${esc(k === 'ticket' || k === 'boarding' ? t('wallet.expiryHintDated') : t('wallet.expiryHint'))}</p>`;
    if (k === 'boarding') {
      html += `<div class="ou-subheader">${esc(t('wallet.route'))}</div><div class="ou-card wl-fgroup">
        ${[0, 1].map((i) => `<div class="wl-pair route" data-g="primary" data-i="${i}"><span class="wl-pair-l">${esc(i ? t('wallet.to') : t('wallet.from'))}</span>
          <input class="wl-in" data-p="l" value="${esc(ed.primary[i]?.l)}" placeholder="${esc(t('wallet.city'))}" aria-label="${esc(t('wallet.city'))}" maxlength="60">
          <input class="wl-in code" data-p="v" value="${esc(ed.primary[i]?.v)}" placeholder="${esc(t('wallet.codePh'))}" aria-label="${esc(t('wallet.codePh'))}" maxlength="8"></div>`).join('')}</div>`;
    }
    html += group('header', t('wallet.g.header'), 3, t('wallet.g.headerHint'));
    if (k !== 'boarding') html += group('primary', t('wallet.g.primary'), 1);
    html += group('details', t('wallet.g.details'), 9);
    html += group('back', t('wallet.moreInfo'), 20, t('wallet.g.backHint'));
    html += `<div class="ou-subheader">${esc(t('wallet.barcode'))}</div><div class="ou-card wl-fgroup">
      <button class="wl-frow wl-frow-btn" data-act="format"><span class="wl-frow-l">${esc(t('wallet.format'))}</span><span class="wl-frow-v">${esc(d.code.type ? FORMAT_NAMES[d.code.type] : t('common.none'))}</span>${icon('down', 18)}</button>
      ${d.code.type ? frow(t('wallet.number'), input('codeMsg', d.code.msg, { ph: d.code.type === 'ean13' ? '4006381333931' : d.code.type === 'upca' ? '036000291452' : t('wallet.numberPh'), max: 2000, cls: 'mono' })) : ''}
      ${d.code.type ? frow(t('wallet.textBelow'), input('codeAlt', d.code.alt, { ph: t('wallet.optional'), max: 80 })) : ''}
      <button class="wl-frow wl-frow-btn accent" data-act="scan" hidden>${icon('wl-scan', 18)}<span>${esc(t('wallet.scan'))}</span></button>
    </div><p class="wl-hint wl-code-err" aria-live="polite"></p>`;
    html += `<div class="ou-subheader">${esc(t('wallet.design'))}</div><div class="ou-card wl-fgroup">
      <div class="wl-frow stack"><span class="wl-frow-l">${esc(t('wallet.color'))}</span><span class="wl-sw"></span></div>
      <div class="wl-frow"><span class="wl-frow-l">${esc(t('wallet.textColor'))}</span><span class="wl-fgseg"></span></div>
      ${imagesFor(k).map((im) => `<div class="wl-frow wl-imgrow"><span class="wl-frow-l">${esc(t(IMAGES[im][0]))}</span>
        ${d[im] ? `<img class="wl-imgth" data-blob="${esc(d[im])}" alt=""><button class="ou-btn danger" data-img-rm="${im}">${esc(t('common.remove'))}</button>` : ''}
        <button class="ou-btn" data-img="${im}">${esc(d[im] ? t('wallet.change') : t('wallet.choose'))}</button></div>`).join('')}
    </div>`;
    html += `<div class="ou-subheader">${esc(t('wallet.notes'))}</div><div class="ou-card wl-fgroup"><textarea class="wl-in wl-notes" data-k="notes" rows="3" placeholder="${esc(t('wallet.notes'))}" maxlength="4000" aria-label="${esc(t('wallet.notes'))}">${esc(d.notes || '')}</textarea></div>
      <div class="ou-card wl-fgroup"><div class="wl-frow wl-quickrow"><span class="wl-frow-l">${esc(t('wallet.inQuick'))}<small>${esc(t('wallet.inQuickSub'))}</small></span></div></div>`;
    form.innerHTML = html;
    if (k === 'boarding') $('.wl-transit', form).appendChild(seg(M.TRANSITS.map((x) => ({ value: x, label: t('wallet.tr.' + x) })), d.transit || 'air', (v) => { d.transit = v; later(); }));
    $('.wl-sw', form).appendChild(swatches(COLORS.includes(d.bg) ? COLORS : [d.bg, ...COLORS], d.bg, (c) => { d.bg = c; later(); }));
    $('.wl-fgseg', form).appendChild(seg([{ value: '', label: t('wallet.auto') }, { value: '#ffffff', label: t('wallet.white') }, { value: '#111114', label: t('wallet.black') }], ['', '#ffffff', '#111114'].includes(d.fg) ? d.fg : '', (v) => { d.fg = v; later(); }));
    $('.wl-quickrow', form).appendChild(sw(!!d.quick, (v) => { d.quick = v; }, { label: t('wallet.inQuick') }));
    hydrate(form);
    checkCode();
    scanAvailable().then((ok) => { const b = $('[data-act="scan"]', form); if (b) b.hidden = !ok; });
  }
  function checkCode() {
    const err = d.code.type && d.code.msg ? codeProblem(d.code.type, d.code.msg) : '';
    const n = form && $('.wl-code-err', form);
    if (n) { n.textContent = err ? t(err) : ''; n.classList.toggle('bad', !!err); }
    return err;
  }

  // typing
  const onInput = (e) => {
    const i = e.target;
    const p = i.closest('.wl-pair');
    if (p) {
      const g = p.dataset.g, k = +p.dataset.i;
      while (ed[g].length <= k) ed[g].push({ l: '', v: '' });
      ed[g][k][i.dataset.p] = i.value;
    } else if (i.dataset.k === 'codeMsg') { d.code.msg = i.value.trim(); checkCode(); }
    else if (i.dataset.k === 'codeAlt') d.code.alt = i.value;
    else if (i.dataset.k === 'date') d.date = i.value || undefined;
    else if (i.dataset.k === 'expires') d.expires = i.value || undefined;
    else if (i.dataset.k === 'name' || i.dataset.k === 'notes') d[i.dataset.k] = i.value;
    later();
  };
  const onClick = async (e) => {
    const a = e.target.closest('[data-act], [data-rm], [data-addf], [data-img], [data-img-rm]');
    if (!a) return;
    if (a.dataset.act === 'kind') {
      const v = await choose(t('wallet.type'), M.KIND_IDS.map((k) => ({ value: k, label: kindOne(k) })), d.kind);
      if (v && v !== d.kind) changeKind(v);
    } else if (a.dataset.act === 'format') {
      const v = await choose(t('wallet.format'), [{ value: '', label: t('common.none') }, ...Object.entries(FORMAT_NAMES).map(([value, label]) => ({ value, label }))], d.code.type);
      if (v != null) { d.code.type = v; drawForm(); drawPreview(); }
    } else if (a.dataset.act === 'scan') {
      const found = await scanPhoto();
      if (found) { d.code = { ...d.code, ...found }; drawForm(); drawPreview(); }
    } else if (a.hasAttribute('data-rm')) {
      const p = a.closest('.wl-pair');
      ed[p.dataset.g].splice(+p.dataset.i, 1);
      drawForm(); drawPreview();
    } else if (a.dataset.addf) {
      ed[a.dataset.addf].push({ l: '', v: '' });
      drawForm(); drawPreview();
      $$(`.wl-pair[data-g="${a.dataset.addf}"] [data-p="l"]`, form).at(-1)?.focus();
    } else if (a.dataset.img) {
      const k = a.dataset.img, file = await pickFile('image/*');
      if (!file) return;
      try {
        const blob = await dataUrlToBlob(await readImage(file, IMAGES[k][1], 0.86));
        const id = 'wallet:' + uid();
        await putBlob(id, blob);
        made.add(id);
        d[k] = id;
        drawForm(); drawPreview();
      } catch (err) {
        console.warn('wallet image', err);
        toast(t('wallet.badPicture'));
      }
    } else if (a.dataset.imgRm) {
      delete d[a.dataset.imgRm];
      drawForm(); drawPreview();
    }
  };
  // a new kind brings its own fields while nothing was typed yet; typed values stay
  function changeKind(k) {
    const typed = ['header', 'primary', 'details'].some((g) => ed[g].some((f) => f.v));
    const tp = template(k);
    const wasDefault = Object.values(M.KINDS).some((x) => x.color === d.bg);
    d.kind = k;
    if (!typed) { ed.header = tp.header; ed.primary = tp.primary; ed.details = [...tp.secondary, ...tp.aux]; if (!d.code.msg) d.code.type = tp.code.type; }
    else ed.primary = k === 'boarding' ? [0, 1].map((i) => ed.primary[i] || { l: '', v: '' }) : ed.primary.slice(0, 1);
    if (k === 'boarding') d.transit ||= 'air';
    if (!M.DATED.includes(k)) delete d.date;
    if (wasDefault) d.bg = tp.bg;
    if (!imagesFor(k).includes('photo')) delete d.photo;
    drawForm(); drawPreview();
  }
  async function save() {
    const err = checkCode();
    if (err) { await alert(t('wallet.checkCode'), t(err)); return; }
    // a field shows on the pass only with a value (a label alone, like an empty "Gate", is left out)
    for (const g of ['header', 'details', 'back']) ed[g] = ed[g].filter((f) => f.v.trim());
    if (d.kind !== 'boarding') ed.primary = ed.primary.filter((f) => f.v.trim());
    if (!M.DATED.includes(d.kind)) delete d.date;
    if (d.code.type && !d.code.msg) d.code.type = '';
    const p = collect();
    p.name = p.name.trim();
    if (isNew) { p.id = 'p' + uid(); p.at = Date.now(); }
    saved = true;
    mutate((x) => { const i = x.passes.findIndex((q) => q.id === p.id); if (i >= 0) x.passes[i] = p; else x.passes.unshift(p); });
    // pictures that were replaced or never used are removed, unless another pass (a duplicate) still shows them
    const used = new Set(data().passes.flatMap((q) => [q.logo, q.art, q.photo]).filter(Boolean));
    for (const id of [...made, ...Object.values(before)]) if (id && !used.has(id)) delBlob(id).catch(() => {});
    ctx.pop();
    after?.(p, isNew);
  }

  ctx.push({
    title: isNew ? t('wallet.addKind', { kind: kindOneIn(d.kind) }) : t('wallet.editPass'), hero: false, className: 'wl-page wl-editor',
    render(b, page) {
      body = b;
      body.classList.add('wl-body');
      preview = h('div', { class: 'wl-ed-prev' });
      form = h('div', { class: 'wl-ed-form' });
      body.append(preview, form);
      body.addEventListener('input', onInput);
      body.addEventListener('click', onClick);
      const bar = h('div', { class: 'wl-edbar' },
        h('button', { class: 'wl-edbar-btn', onClick: () => ctx.pop() }, t('common.cancel')),
        h('button', { class: 'wl-edbar-btn primary', dataset: { act: 'save' }, onClick: save }, t('common.save')));
      page.el.appendChild(bar);
      drawForm();
      drawPreview();
      if (isNew) setTimeout(() => $('[data-k="name"]', form)?.focus(), 380);
      // pictures picked for a pass that was never saved are removed again
      return () => { if (!saved) for (const id of made) delBlob(id).catch(() => {}); };
    },
  });
}

// Contacts: reading and writing .vcf files (Import / Export in Manage contacts, Share), with photos kept as blobs
// `contacts:<id>` in IndexedDB, shrunk to 640 px JPEGs; and a contact as plain text (Share › Copy as text).
import { uid, download } from '../core/util.js';
import { putBlob, getBlob } from '../core/blobs.js';
import { addStrings, t } from '../core/i18n.js';
import { toast, dialog } from '../core/ui.js';
import * as M from './model.js';
import { parse, serializeAll, decodeBytes } from './vcard.js';
import { data, mutate } from './data.js';
import { contactName, labelText, dayText } from './format.js';

/** A picture as a JPEG no larger than `max` pixels on its long side. */
export async function shrinkImage(blob, max = 640) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  return cv.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
}

/** Contacts read from .vcf files, with new ids, and their photos saved as blobs. */
export async function readVcf(files) {
  const out = [];
  for (const f of files) {
    let cards = [];
    try {
      cards = parse(decodeBytes(new Uint8Array(await f.arrayBuffer())));
    } catch (e) {
      console.warn('vcf', f.name, e);
    }
    for (const c of cards) {
      const now = Date.now();
      const contact = { ...c, id: 'c' + uid(), created: now, updated: now };
      delete contact._photo;
      if (c._photo?.bytes?.length) {
        try {
          const key = 'contacts:' + uid();
          await putBlob(key, await shrinkImage(new Blob([c._photo.bytes], { type: c._photo.type }), 640));
          contact.photo = key;
        } catch (e) {
          console.warn('vcf photo', e);
        }
      }
      out.push(M.normContact(contact));
    }
  }
  return out.filter(Boolean);
}

/** Imports .vcf files into Contacts; returns the new contacts' ids. */
export async function importFiles(files) {
  const list = [...(files || [])].filter((f) => /\.(vcf|vcard)$/i.test(f.name) || /vcard/i.test(f.type));
  if (!list.length) return [];
  const cs = await readVcf(list);
  if (!cs.length) {
    dialog({ title: t('contacts.importFail'), message: t('contacts.importNone') });
    return [];
  }
  mutate((d) => {
    d.items.push(...cs);
  });
  toast(cs.length === 1 ? t('contacts.imported1') : t('contacts.importedN', { n: cs.length }));
  return cs.map((c) => c.id);
}

async function jpegB64(key) {
  const blob = await getBlob(key).catch(() => null);
  if (!blob) return null;
  try {
    const jpeg = await shrinkImage(blob, 640);
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { type: 'JPEG', b64: btoa(bin) };
  } catch {
    return null;
  }
}
/** Saves contacts as one .vcf file (vCard 3.0 with photos). */
export async function exportContacts(list, name) {
  if (!list.length) return;
  const photos = new Map();
  for (const c of list) {
    if (!c.photo) continue;
    const p = await jpegB64(c.photo);
    if (p) photos.set(c.id, p);
  }
  const safe = String(name || t('app.contacts')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Contacts';
  download(safe + '.vcf', serializeAll(list, photos), 'text/vcard');
  toast(list.length === 1 ? t('contacts.exported1') : t('contacts.exportedN', { n: list.length }));
}
/** Share › vCard file for some contacts (one contact's file is named after them). */
export function shareContacts(ids) {
  const d = data();
  const list = ids.map((id) => M.byId(d, id)).filter(Boolean);
  return exportContacts(list, list.length === 1 ? contactName(list[0], d.prefs.order) : t('app.contacts'));
}

/** A contact as plain text: name, then every detail on its own line. */
export function contactText(c) {
  const order = data().prefs.order;
  const lines = [contactName(c, order)];
  const role = [c.job, c.company].filter(Boolean).join(', ');
  if (role) lines.push(role);
  for (const e of c.phones || []) lines.push(`${labelText(e.l)}: ${e.v}`);
  for (const e of c.emails || []) lines.push(`${labelText(e.l)}: ${e.v}`);
  for (const e of c.addrs || []) lines.push(`${labelText(e.l)}: ${M.ADDR_PARTS.map((k) => e[k]).filter(Boolean).join(', ')}`);
  for (const e of c.urls || []) lines.push(e.v);
  if (c.bday) lines.push(`${t('contacts.label.birthday')}: ${dayText(c.bday)}`);
  return lines.join('\n');
}

addStrings({
  en: {
    'contacts.importFail': 'Couldn’t import',
    'contacts.importNone': 'No contacts were found in this file.',
    'contacts.imported1': '1 contact imported',
    'contacts.importedN': '{n} contacts imported',
    'contacts.exported1': '1 contact exported',
    'contacts.exportedN': '{n} contacts exported',
  },
  ar: {
    'contacts.importFail': 'تعذر الاستيراد',
    'contacts.importNone': 'لم يتم العثور على جهات اتصال في هذا الملف.',
    'contacts.imported1': 'تم استيراد جهة اتصال واحدة',
    'contacts.importedN': 'تم استيراد {n} جهة اتصال',
    'contacts.exported1': 'تم تصدير جهة اتصال واحدة',
    'contacts.exportedN': 'تم تصدير {n} جهة اتصال',
  },
});

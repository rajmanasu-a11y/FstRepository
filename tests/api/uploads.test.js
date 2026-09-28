import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { setup, teardown, loginAs, ids, query, visitBody } from './_helpers.js';

let rec;
let i;
before(async () => { await setup(); rec = await loginAs('reception'); i = await ids(); });
after(teardown);

const form = (buf, name, type) => {
  const f = new FormData();
  f.append('photo', new Blob([buf], { type }), name);
  return f;
};

test('photos are validated, re-encoded to a small 3:4 JPEG and stripped of metadata', async () => {
  const big = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#88aacc' } })
    .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-data', Make: 'TestCam' } } })
    .jpeg({ quality: 95 }).toBuffer();
  const r = await rec.request('POST', '/photos', { form: form(big, 'camera.jpg', 'image/jpeg') });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.width, 360);
  assert.equal(r.data.height, 480);
  assert.ok(r.data.sizeBytes < big.length / 5, `compressed: ${r.data.sizeBytes} < ${big.length}`);
  const img = await rec.request('GET', r.data.url.replace(/^\/api/, ''), { raw: true });
  const buf = Buffer.from(await img.arrayBuffer());
  const meta = await sharp(buf).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.exif, undefined, 'EXIF removed');
  assert.ok(!buf.includes(Buffer.from('secret-gps-data')));
  const { rows } = await query('SELECT storage_key, is_attached FROM stored_files WHERE id = $1', [r.data.fileId]);
  assert.match(rows[0].storage_key, /^photos\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/, 'database stores a reference, not the image');
  assert.equal(rows[0].is_attached, false);

  const reg = await rec.post('/visits', visitBody(i, { visitor: { photoFileId: r.data.fileId } }));
  assert.equal(reg.status, 201);
  assert.ok(reg.data.visit.visitor.photoUrl.endsWith(r.data.fileId));
  const att = await query('SELECT is_attached FROM stored_files WHERE id = $1', [r.data.fileId]);
  assert.equal(att.rows[0].is_attached, true);
});

test('invalid uploads are rejected: disguised files, wrong types and oversized files', async () => {
  const fake = await rec.request('POST', '/photos', { form: form(Buffer.from('<?php system($_GET["c"]); ?>'), 'shell.jpg', 'image/jpeg') });
  assert.equal(fake.status, 415);
  assert.match(fake.data.error.message, /Only JPEG, PNG or WebP/);
  const pdf = await rec.request('POST', '/photos', { form: form(Buffer.from('%PDF-1.4'), 'doc.pdf', 'application/pdf') });
  assert.equal(pdf.status, 415);
  const svg = await rec.request('POST', '/photos', { form: form(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'x.svg', 'image/svg+xml') });
  assert.equal(svg.status, 415);
  const huge = Buffer.alloc(6 * 1024 * 1024, 1);
  const tooBig = await rec.request('POST', '/photos', { form: form(huge, 'big.jpg', 'image/jpeg') });
  assert.equal(tooBig.status, 413);
  assert.match(tooBig.data.error.message, /too large/);
  const none = await rec.request('POST', '/photos', { form: new FormData() });
  assert.equal(none.status, 422);
});

test('photos are only served to authorised users', async () => {
  const { rows } = await query(`SELECT v.photo_file_id FROM visitors v WHERE v.photo_file_id IS NOT NULL
                                 AND NOT EXISTS (SELECT 1 FROM visits vi WHERE vi.visitor_id = v.id AND vi.host_employee_id = $1) LIMIT 1`, [i.rajesh]);
  const url = `/files/photos/${rows[0].photo_file_id}`;
  assert.equal((await rec.request('GET', url, { raw: true })).status, 200);
  const host = await loginAs('rajesh.kumar');
  assert.equal((await host.request('GET', url, { raw: true })).status, 404, "host cannot see other hosts' visitors");
  assert.equal((await host.request('GET', '/files/photos/..%2F..%2Fetc%2Fpasswd', { raw: true })).status, 404, 'path traversal rejected');
  const security = await loginAs('security');
  assert.equal((await security.post('/photos', {})).status, 403, 'security cannot upload photos');
});

test('an unused photo cannot be attached to a different visitor after it is used', async () => {
  const img = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#ccc' } }).png().toBuffer();
  const up = await rec.request('POST', '/photos', { form: form(img, 'a.png', 'image/png') });
  const a = await rec.post('/visits', visitBody(i, { visitor: { photoFileId: up.data.fileId } }));
  assert.equal(a.status, 201);
  const b = await rec.post('/visits', visitBody(i, { visitor: { photoFileId: up.data.fileId } }));
  assert.equal(b.status, 422);
});

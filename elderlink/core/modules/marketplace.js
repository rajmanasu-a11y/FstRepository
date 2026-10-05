// FR-LST (listings and minimum charges), FR-SRC (search and discovery), FR-VER provider side.
import { assert, fail, haversineKm, istDateKey, istTime, addDaysKey, weekdayOfKey, HOUR, MIN, DAY } from '../util.js';
import { audit, caregiverFor, config, isStaff, notifyStaff, providerAdminFor, providerCard, providerQuality, requireRole, serviceById, badgesFor, caregiverQuality } from '../context.js';
import { medianFlag, rankScore, reviewScore } from '../rules.js';
import { CAREGIVER_CATEGORIES } from '../catalog.js';

export function durationMin(unit) {
  return { visit: 60, '12-h shift': 720, '24-h live-in': 1440, package: 60, hour: 60, month: 60 }[unit] || 60;
}

const ACTIVE = ['pending_approval', 'requested', 'accepted', 'assigned', 'in_progress'];

function providerBusyCount(db, listing, start, end) {
  const provider = db.get('providers', listing.providerId);
  return db.filter('bookings', (b) => b.providerId === provider.id && ACTIVE.includes(b.status) && b.start < end && b.end > start).length;
}

/** FR-LST-05: free slots for a listing on one date. */
export function slotsFor(db, listing, dateKey) {
  const provider = db.get('providers', listing.providerId);
  const av = listing.availability || provider.availability || { days: [1, 2, 3, 4, 5, 6], from: '08:00', to: '18:00' };
  const blocked = provider.blocked || [];
  const dow = weekdayOfKey(dateKey);
  if (!av.days.includes(dow) || blocked.includes(dateKey)) return [];
  const dur = durationMin(listing.unit);
  const capacity = provider.type === 'independent' ? 1 : listing.capacity || 2;
  const now = db.now();
  const starts = [];
  if (dur >= 720) starts.push(istTime(dateKey, av.from)); // shifts start once a day
  else for (let t = istTime(dateKey, av.from); t + dur * MIN <= istTime(dateKey, av.to); t += 60 * MIN) starts.push(t);
  return starts.map((t) => {
    const end = t + dur * MIN;
    return { start: t, end, free: providerBusyCount(db, listing, t, end) < capacity && t > now + 2 * HOUR };
  });
}

export function nextFreeSlot(db, listing) {
  let key = istDateKey(db.now());
  for (let i = 0; i < 10; i++) {
    const s = slotsFor(db, listing, key).find((x) => x.free);
    if (s) return s.start;
    key = addDaysKey(key, 1);
  }
  return null;
}

export function listingView(db, l, senior) {
  const provider = db.get('providers', l.providerId);
  const svc = serviceById(db, l.serviceId);
  const card = providerCard(db, provider);
  const distanceKm = senior ? Math.round(haversineKm(senior, provider) * 10) / 10 : null;
  return {
    id: l.id, serviceId: l.serviceId, serviceName: svc?.name, serviceNameHi: svc?.nameHi, serviceIcon: svc?.icon, unit: l.unit,
    minCharge: l.minCharge, addOns: l.addOns || [], radiusKm: l.radiusKm, languages: l.languages || card.languages, gender: l.gender || card.gender,
    status: l.status, medianPrice: svc?.medianPrice, packageItems: l.packageItems, title: l.title, flag: l.flag,
    nextSlot: nextFreeSlot(db, l), distanceKm, provider: card,
  };
}

export function routes(r) {
  r('GET', '/services', ({ db }) => db.all('services').filter((s) => s.active !== false), { public: true });

  // FR-SRC-01..04, 07, 09
  r('GET', '/search', ({ db, user, query }) => {
    const senior = query.seniorId ? db.get('seniors', query.seniorId) : null;
    const loc = senior || { lat: 12.9250, lng: 77.5938 };
    const svc = query.serviceId ? serviceById(db, query.serviceId) : null;
    let rows = db.filter('listings', (l) => l.status === 'published' && (!svc || l.serviceId === svc.id));
    rows = rows.filter((l) => {
      const p = db.get('providers', l.providerId);
      if (!p || p.status !== 'verified') return false; // BR-01
      return haversineKm(loc, p) <= l.radiusKm;
    });
    let results = rows.map((l) => listingView(db, l, loc));
    const f = query;
    if (f.maxPrice) results = results.filter((x) => x.minCharge <= Number(f.maxPrice));
    if (f.minRating) results = results.filter((x) => (x.provider.quality ?? 0) >= Number(f.minRating));
    if (f.gender) results = results.filter((x) => !x.gender || x.gender === f.gender);
    if (f.language) results = results.filter((x) => (x.languages || []).includes(f.language));
    if (f.providerType) results = results.filter((x) => x.provider.type === f.providerType);
    if (f.badge) results = results.filter((x) => x.provider.badges.includes(f.badge));
    if (f.date) {
      results = results.filter((x) => slotsFor(db, db.get('listings', x.id), f.date).some((s) => s.free));
    }
    for (const x of results) {
      x.rank = rankScore({ quality: x.provider.quality, distanceKm: x.distanceKm, radiusKm: x.radiusKm, price: x.minCharge, median: x.medianPrice, availableSoon: x.nextSlot && x.nextSlot - db.now() < 2 * DAY });
    }
    const sort = f.sort || 'recommended';
    const sorters = {
      recommended: (a, b) => b.rank - a.rank,
      price: (a, b) => a.minCharge - b.minCharge,
      nearest: (a, b) => a.distanceKm - b.distanceKm,
      rating: (a, b) => (b.provider.quality ?? 0) - (a.provider.quality ?? 0),
      reviews: (a, b) => b.provider.reviewCount - a.provider.reviewCount,
    };
    results.sort(sorters[sort] || sorters.recommended);
    // Sponsored placement: only for providers scoring 60+ (FR-SRC-03)
    const sponsored = results.find((x) => db.get('listings', x.id).sponsored && (x.provider.quality ?? 0) >= 60);
    if (sponsored && sort === 'recommended') { results = [{ ...sponsored, sponsored: true }, ...results.filter((x) => x.id !== sponsored.id)]; }
    if (!results.length && svc && senior) {
      db.insert('supplyRequests', { seniorId: senior.id, area: senior.area, serviceId: svc.id, serviceName: svc.name, userId: user?.id, status: 'open' }, 'sup');
      notifyStaff(db, 'coordinator', { channels: ['push'], title: 'No provider covers an address', body: `${svc.name} requested in ${senior.area || senior.city}`, event: 'supply' });
    }
    return { results, median: svc?.medianPrice || null, service: svc, noCoverage: !results.length };
  });

  r('GET', '/listings/:id', ({ db, params, query }) => {
    const l = db.get('listings', params.id);
    assert(l, 404, 'Listing not found');
    const senior = query.seniorId ? db.get('seniors', query.seniorId) : null;
    return listingView(db, l, senior);
  }, { public: true });

  r('GET', '/listings/:id/slots', ({ db, params, query }) => {
    const l = db.get('listings', params.id);
    assert(l, 404, 'Listing not found');
    const days = [];
    let key = query.date || istDateKey(db.now());
    for (let i = 0; i < (Number(query.days) || 7); i++) { days.push({ date: key, slots: slotsFor(db, l, key) }); key = addDaysKey(key, 1); }
    return days;
  }, { public: true });

  // FR-SRC-06 provider profile
  r('GET', '/providers/:id', ({ db, params, query }) => {
    const p = db.get('providers', params.id);
    assert(p, 404, 'Provider not found');
    const senior = query.seniorId ? db.get('seniors', query.seniorId) : null;
    const listings = db.filter('listings', (l) => l.providerId === p.id && l.status === 'published').map((l) => listingView(db, l, senior));
    const reviews = db.filter('reviews', (rv) => rv.providerId === p.id && rv.status === 'published').sort((a, b) => b.createdAt - a.createdAt);
    const dims = {};
    for (const rv of reviews) for (const [k, v] of Object.entries(rv.ratings)) if (typeof v === 'number') (dims[k] ||= []).push(v);
    const summary = Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10]));
    const staff = p.type === 'independent' ? [] : db.filter('caregivers', (c) => c.providerId === p.id && c.status === 'verified').map((c) => ({ id: c.id, name: c.name, category: CAREGIVER_CATEGORIES[c.category]?.label, photo: c.photo, badges: badgesFor(db, c) }));
    return {
      ...providerCard(db, p), listings, staff, summary,
      reviews: reviews.slice(0, 20).map((rv) => ({ id: rv.id, reviewerType: rv.reviewerType, reviewerLabel: rv.reviewerLabel, score: reviewScore(rv.ratings), ratings: rv.ratings, text: rv.text, tags: rv.tags, visitDate: rv.visitDate, reply: rv.reply, serviceName: rv.serviceName })),
    };
  }, { public: true });

  // FR-SRC-08 favourites
  r('GET', '/favourites', ({ db, user }) => db.filter('favourites', (f) => f.userId === user.id).map((f) => ({ ...f, provider: providerCard(db, db.get('providers', f.providerId)) })));
  r('POST', '/favourites', ({ db, user, body }) => {
    const existing = db.find('favourites', (f) => f.userId === user.id && f.providerId === body.providerId);
    if (existing) { db.remove('favourites', existing.id); return { saved: false }; }
    db.insert('favourites', { userId: user.id, providerId: body.providerId }, 'fav');
    return { saved: true };
  });

  // ---- provider side ----
  function myProvider(db, user) {
    const p = providerAdminFor(db, user) || (caregiverFor(db, user) && db.get('providers', caregiverFor(db, user).providerId));
    assert(p, 403, 'No provider account found');
    return p;
  }

  r('GET', '/my/listings', ({ db, user }) => {
    const p = myProvider(db, user);
    return db.filter('listings', (l) => l.providerId === p.id).map((l) => ({ ...listingView(db, l, null), history: db.filter('priceHistory', (h) => h.listingId === l.id) }));
  });

  // FR-LST-03, 04, 08
  r('POST', '/my/listings', ({ db, user, body }) => {
    const p = myProvider(db, user);
    const svc = serviceById(db, body.serviceId);
    assert(svc, 400, 'Choose a service from the catalogue');
    const minCharge = Math.round(Number(body.minCharge));
    assert(minCharge > 0, 400, 'Enter your minimum charge in rupees');
    const radiusKm = Math.round(Number(body.radiusKm) || 5);
    assert(radiusKm >= 1 && radiusKm <= 25, 400, 'Service radius must be 1 to 25 km');
    if (p.type === 'independent') {
      const cg = db.find('caregivers', (c) => c.providerId === p.id);
      // BR-02 / FR-LST-04
      if (!svc.allowed.includes(cg.category)) fail(400, `A ${CAREGIVER_CATEGORIES[cg.category].label} cannot list "${svc.name}"`, 'category');
      if (CAREGIVER_CATEGORIES[cg.category].nurse && cg.verification?.registration !== 'pass') fail(400, 'Registration verification pending', 'registration');
    } else {
      const staff = db.filter('caregivers', (c) => c.providerId === p.id && c.status === 'verified');
      assert(staff.some((c) => svc.allowed.includes(c.category)), 400, `None of your verified staff can deliver "${svc.name}"`, 'category');
    }
    const flag = medianFlag(minCharge, svc.medianPrice, config(db));
    const l = db.insert('listings', {
      providerId: p.id, serviceId: svc.id, unit: svc.unit, minCharge, radiusKm, languages: body.languages || p.languages || ['English'],
      gender: body.gender || null, addOns: (body.addOns || []).filter((a) => a.name && a.price > 0).map((a) => ({ name: a.name, price: Math.round(a.price) })),
      status: p.status === 'verified' && !flag ? 'published' : flag ? 'review' : 'draft', flag, title: body.title || null,
      packageItems: body.packageItems || null, capacity: body.capacity || null,
    }, 'lst');
    db.insert('priceHistory', { listingId: l.id, minCharge, by: user.name }, 'prh');
    if (flag) notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Price outside city range', body: `${p.name}: ${svc.name} at Rs ${minCharge} (median Rs ${svc.medianPrice})`, event: 'price_flag' });
    audit(db, user, 'listing.create', l.id);
    return { ...listingView(db, l, null), notice: flag ? `This price is far from the city median (Rs ${svc.medianPrice}). A coordinator will review it before it goes live.` : p.status !== 'verified' ? 'Your listing will go live once verification is complete.' : 'Your listing is live.' };
  });

  // FR-LST-06, 07, 11
  r('PATCH', '/my/listings/:id', ({ db, user, params, body }) => {
    const p = myProvider(db, user);
    const l = db.get('listings', params.id);
    assert(l && l.providerId === p.id, 404, 'Listing not found');
    const patch = {};
    if (body.minCharge != null && Number(body.minCharge) !== l.minCharge) {
      const svc = serviceById(db, l.serviceId);
      patch.minCharge = Math.round(Number(body.minCharge));
      patch.flag = medianFlag(patch.minCharge, svc.medianPrice, config(db));
      db.insert('priceHistory', { listingId: l.id, minCharge: patch.minCharge, by: user.name }, 'prh');
      if (patch.flag) { patch.status = 'review'; notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Price outside city range', body: `${p.name}: ${svc.name} at Rs ${patch.minCharge}`, event: 'price_flag' }); }
    }
    if (body.radiusKm != null) patch.radiusKm = Math.min(25, Math.max(1, Number(body.radiusKm)));
    if (body.status && ['published', 'paused', 'unpublished'].includes(body.status)) {
      if (body.status === 'published') assert(p.status === 'verified' && !(patch.flag ?? l.flag), 400, 'This listing cannot go live until verification and price review are complete');
      patch.status = body.status;
    }
    if (body.addOns) patch.addOns = body.addOns;
    db.update('listings', l.id, patch);
    audit(db, user, 'listing.update', l.id, Object.keys(patch));
    return { ...listingView(db, db.get('listings', l.id), null), notice: patch.minCharge ? 'New price applies to new bookings only. Confirmed bookings keep their price.' : null };
  });

  r('PUT', '/my/availability', ({ db, user, body }) => {
    const p = myProvider(db, user);
    const days = (body.days || []).map(Number).filter((d) => d >= 0 && d <= 6);
    assert(days.length, 400, 'Pick at least one day');
    assert(/^\d\d:\d\d$/.test(body.from) && /^\d\d:\d\d$/.test(body.to) && body.from < body.to, 400, 'Check the start and end time');
    db.update('providers', p.id, { availability: { days, from: body.from, to: body.to }, blocked: body.blocked || p.blocked || [] });
    return db.get('providers', p.id);
  });

  // FR-VER-01..03: caregiver submits verification documents
  r('GET', '/my/verification', ({ db, user }) => {
    const cg = caregiverFor(db, user);
    assert(cg, 404, 'No caregiver profile');
    return { caregiver: cg, badges: badgesFor(db, cg), log: db.filter('verificationLog', (v) => v.caregiverId === cg.id), quality: caregiverQuality(db, cg.id) };
  });
  r('PATCH', '/my/verification', ({ db, user, body }) => {
    const cg = caregiverFor(db, user);
    assert(cg, 404, 'No caregiver profile');
    const patch = {};
    for (const k of ['category', 'registrationNo', 'registrationCouncil', 'registrationExpiry', 'pan', 'qualifications', 'languages', 'gender', 'bank', 'bio', 'experienceYears']) if (body[k] !== undefined) patch[k] = body[k];
    if (body.submit) {
      assert(patch.pan || cg.pan, 400, 'PAN is needed');
      assert(patch.bank || cg.bank, 400, 'Bank account is needed for payouts');
      if (CAREGIVER_CATEGORIES[patch.category || cg.category]?.nurse) assert(patch.registrationNo || cg.registrationNo, 400, 'Nurses must enter their nursing registration number');
      patch.status = 'submitted';
      patch.verification = { ...cg.verification, id: 'pass' }; // Aadhaar e-KYC is instant via the KYC agency (mocked)
      db.insert('verificationLog', { caregiverId: cg.id, from: cg.status, to: 'submitted', by: user.name, reason: 'Documents submitted' }, 'vlg');
      notifyStaff(db, 'coordinator', { channels: ['push'], title: 'New verification', body: `${cg.name} submitted documents`, event: 'verification' });
    }
    db.update('caregivers', cg.id, patch);
    if (patch.bank) db.update('providers', cg.providerId, { bank: patch.bank });
    return db.get('caregivers', cg.id);
  });

  // FR-VER-06 org adds staff
  r('POST', '/provider/staff', ({ db, user, body }) => {
    requireRole(user, 'provider_admin');
    const p = providerAdminFor(db, user);
    assert(body.name && body.category, 400, 'Name and category are needed');
    const cg = db.insert('caregivers', { providerId: p.id, name: body.name, category: body.category, gender: body.gender || 'F', languages: body.languages || ['English', 'Kannada'], status: 'submitted', registrationNo: body.registrationNo, registrationCouncil: body.registrationCouncil || 'KSNC', verification: { id: 'pass', registration: 'pending', police: 'pending', interview: 'pending' }, inductionScore: 0, lat: p.lat, lng: p.lng }, 'cg');
    db.insert('verificationLog', { caregiverId: cg.id, from: 'draft', to: 'submitted', by: user.name, reason: 'Added to staff roster' }, 'vlg');
    return cg;
  });

  r('GET', '/provider/quality', ({ db, user }) => {
    const p = myProvider(db, user);
    const staff = db.filter('caregivers', (c) => c.providerId === p.id).map((c) => ({ id: c.id, name: c.name, category: c.category, status: c.status, quality: caregiverQuality(db, c.id) }));
    return { provider: providerQuality(db, p.id), staff };
  });

  r('GET', '/catalogue/allowed', ({ db, user }) => {
    const cg = caregiverFor(db, user);
    const p = providerAdminFor(db, user);
    const cats = cg && db.get('providers', cg.providerId)?.type === 'independent' ? [cg.category] : p ? [...new Set(db.filter('caregivers', (c) => c.providerId === p.id && c.status === 'verified').map((c) => c.category))] : [];
    return db.all('services').map((s) => ({ ...s, allowedForMe: s.allowed.some((c) => cats.includes(c)) }));
  });

  r('GET', '/staff/:id', ({ db, user, params }) => {
    const cg = db.get('caregivers', params.id);
    assert(cg, 404, 'Not found');
    if (!isStaff(user)) {
      const p = myProvider(db, user);
      assert(cg.providerId === p.id, 403, 'Not your staff');
    }
    return { ...cg, badges: badgesFor(db, cg), quality: caregiverQuality(db, cg.id) };
  });
}

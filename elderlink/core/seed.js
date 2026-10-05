// Demo data for the Bengaluru pilot (SRS 10.2). All people, providers and numbers are fictional.
// Dates are relative to "now" so the demo always looks current.
import { SERVICES, PLANS, CONFIG, SCAM_ALERTS, COURSES, CHECKLISTS } from './catalog.js';
import { istDateKey, istTime, addDaysKey, seededRandom, DAY, HOUR, MIN } from './util.js';
import { priceBooking } from './rules.js';

const HOME = { lat: 12.9250, lng: 77.5838 }; // Jayanagar 4th Block

const REVIEW_TEXT = {
  good: [
    'Very gentle with Amma and always on time. Explained every step.',
    'Came on time, washed hands, checked BP and sugar and wrote it all down. We could see the report in Dubai within minutes.',
    'Respectful and patient. My father felt comfortable from the first visit.',
    'Dressing done neatly, no pain. Will book again.',
    'बहुत अच्छी सेवा। समय पर आईं और माँ से प्यार से बात की।',
    'Professional and kind. Spoke to my mother in Kannada which made a big difference.',
    'Excellent physio, my father is walking better after 3 weeks.',
    'Reliable and clean. The visit code check gives us confidence.',
    'Helped with insulin and taught my mother how to check sugar herself.',
    'Took Appa to the hospital, waited through the whole OPD and brought him back safely.',
  ],
  mid: [
    'Good care but came 20 minutes late once.',
    'Okay service. Could communicate a bit more with the family.',
    'Did the job, but seemed in a hurry.',
  ],
  bad: [
    'Came very late and left early. Not happy.',
    'Was on the phone most of the time.',
  ],
};

export function seed(db) {
  const rnd = seededRandom(7);
  const now = db.now();
  const today = istDateKey(now);
  const d = db.data;
  d.meta.config = JSON.parse(JSON.stringify(CONFIG));
  for (const s of SERVICES) db.insert('services', { ...s, active: true });
  for (const p of PLANS) db.insert('plans', { ...p, active: true });
  for (const a of SCAM_ALERTS) db.insert('scamAlerts', a);
  for (const c of COURSES) db.insert('courses', c);

  const user = (id, o) => db.insert('users', { id, language: 'en', prefs: {}, tz: 'Asia/Kolkata', ...o });

  // ---- ElderLink staff ----
  user('usr_neha', { role: 'coordinator', name: 'Neha Sharma', mobile: '+919900011001', persona: { order: 6, title: 'Care coordinator', blurb: 'Verifies providers, assigns check-visit nurses, handles complaints and quality tickets.', icon: 'clipboard' } });
  user('usr_imran', { role: 'emergency', name: 'Imran Khan', mobile: '+919900011002', persona: { order: 7, title: 'Emergency desk (24x7)', blurb: 'Answers SOS alerts, triages, dispatches ambulances and keeps the family updated.', icon: 'siren' } });
  user('usr_vikram', { role: 'admin', name: 'Vikram Singh', mobile: '+919900011003', persona: { order: 8, title: 'Admin', blurb: 'Sets prices, plans, commission and rules; sees business reports and the audit log.', icon: 'settings' } });

  // ---- family and seniors ----
  user('usr_arjun', { role: 'family', name: 'Arjun Rao', mobile: '+971501234567', email: 'arjun@example.com', tz: 'Asia/Dubai', city: 'Dubai', relation: 'son', persona: { order: 2, title: 'Family: son in Dubai', blurb: 'Pays for care for his parents in Bengaluru. Books, approves, tracks visits, medicines and SOS from afar.', icon: 'family' } });
  user('usr_meera', { role: 'family', name: 'Meera Rao', mobile: '+919845011223', email: 'meera@example.com', city: 'Pune', relation: 'daughter' });
  user('usr_kiran', { role: 'family', name: 'Kiran Rao', mobile: '+919845099887', city: 'Bengaluru', relation: 'grandson' });
  user('usr_kamala', { role: 'senior', name: 'Kamala Rao', mobile: '+919886012345', language: 'en', prefs: { seniorMode: true, textSize: 'large' }, seniorId: 'sen_kamala', persona: { order: 1, title: 'Senior: Kamala, 78', blurb: 'Uses the big-button Senior mode: today\'s medicines, next visit, call family and SOS.', icon: 'senior' } });

  const dobYears = (y, md = '-03-12') => `${new Date(now).getUTCFullYear() - y}${md}`;
  db.insert('seniors', {
    id: 'sen_kamala', userId: 'usr_kamala', name: 'Kamala Rao', gender: 'F', dob: dobYears(78), address: '23, 11th Main, 4th Block, Jayanagar, Bengaluru 560011', area: 'Jayanagar', city: 'Bengaluru', ...HOME,
    languages: ['Kannada', 'Hindi', 'English'], mobile: '+919886012345', conditions: ['Type 2 diabetes', 'High blood pressure', 'Knee osteoarthritis'], allergies: ['Penicillin'],
    mobility: 'Walks with a stick', cognition: 'Normal', bloodGroup: 'B+', doctor: 'Dr. S. Murthy (physician)', hospital: 'Lakeside Multispeciality Hospital',
    emergencyContacts: [{ name: 'Shobha Iyengar (neighbour)', phone: '+919845500111', distanceKm: 0.2 }, { name: 'Venkat Rao (nephew)', phone: '+919845500222', distanceKm: 8 }],
    consent: { status: 'given', method: 'otp', at: now - 40 * DAY }, nominee: 'usr_arjun', checkinSettings: { enabled: true, time: '09:00', human: false }, abha: '91-4567-8901-2345',
  });
  db.insert('seniors', {
    id: 'sen_raghavan', userId: null, name: 'Raghavan Rao', gender: 'M', dob: dobYears(84, '-07-01'), address: '23, 11th Main, 4th Block, Jayanagar, Bengaluru 560011', area: 'Jayanagar', city: 'Bengaluru', ...HOME,
    languages: ['Kannada', 'English'], mobile: '+919886054321', conditions: ["Parkinson's disease", 'Mild dementia'], allergies: [], mobility: 'Needs help to walk', cognition: 'Mild dementia', bloodGroup: 'O+',
    doctor: 'Dr. A. Rao (neurologist)', hospital: 'Lakeside Multispeciality Hospital', emergencyContacts: [{ name: 'Shobha Iyengar (neighbour)', phone: '+919845500111', distanceKm: 0.2 }, { name: 'Venkat Rao (nephew)', phone: '+919845500222', distanceKm: 8 }],
    consent: { status: 'given', method: 'guardian', approvedBy: 'Neha Sharma', document: 'Power of attorney (Arjun Rao).pdf', at: now - 38 * DAY }, guardian: 'usr_arjun', nominee: 'usr_arjun', checkinSettings: { enabled: false, time: '09:00', human: false },
  });
  for (const sid of ['sen_kamala', 'sen_raghavan']) {
    db.insert('circle', { seniorId: sid, userId: 'usr_arjun', role: 'owner', relation: 'son', status: 'active' });
    db.insert('circle', { seniorId: sid, userId: 'usr_meera', role: 'manager', relation: 'daughter', status: 'active' });
    db.insert('circle', { seniorId: sid, userId: 'usr_kiran', role: 'viewer', relation: 'grandson', status: 'active' });
  }
  db.insert('approvalRules', { seniorId: 'sen_kamala', enabled: true, threshold: 2000 });
  db.insert('carePlans', { seniorId: 'sen_kamala', goals: ['Keep fasting sugar under 130', 'BP under 140/90', 'Walk 15 minutes every evening'], routines: ['Wakes 6 am, filter coffee', 'Lunch 1 pm', 'Evening walk in the lane with stick', 'Sleeps by 10 pm'], preferences: { food: 'Vegetarian, low sugar, soft food', language: 'Kannada first, then Hindi', religion: 'Hindu; daily pooja 7 am, please do not disturb' }, doNot: ['No penicillin', 'Do not rearrange furniture', 'Do not give sweets'], version: 3, updatedBy: 'Meera Rao' });
  db.insert('carePlans', { seniorId: 'sen_raghavan', goals: ['Safe at home, no falls', 'Keep a daily routine'], routines: ['Walks with help after breakfast', 'Likes old Kannada film songs'], preferences: { food: 'Vegetarian', language: 'Kannada' }, doNot: ['Do not leave him alone near the stairs', 'Do not argue if confused; redirect gently'], version: 1, updatedBy: 'Arjun Rao' });
  db.insert('tasks', { seniorId: 'sen_kamala', title: "Book Amma's eye check-up at Lakeside", assigneeId: 'usr_meera', due: addDaysKey(today, 5), done: false, createdBy: 'usr_arjun' });
  db.insert('tasks', { seniorId: 'sen_kamala', title: 'Renew health insurance (due next month)', assigneeId: 'usr_arjun', due: addDaysKey(today, 20), done: false, createdBy: 'usr_arjun' });
  db.insert('tasks', { seniorId: 'sen_raghavan', title: "Collect Appa's neurology report", assigneeId: 'usr_kiran', due: addDaysKey(today, 2), done: false, createdBy: 'usr_meera' });

  // ---- providers and caregivers ----
  const prov = (id, o) => db.insert('providers', { id, city: 'Bengaluru', status: 'verified', languages: ['English', 'Kannada'], lastChecked: now - 60 * DAY, availability: { days: [0, 1, 2, 3, 4, 5, 6], from: '07:00', to: '20:00' }, blocked: [], bank: { bank: 'HDFC Bank', last4: String(1000 + Math.floor(rnd() * 8999)), verified: true }, ...o });
  const cgv = (id, o) => db.insert('caregivers', { id, status: 'verified', verification: { id: 'pass', registration: 'pass', police: 'pass', references: 'pass', interview: 'pass' }, inductionScore: 92, lastChecked: now - 60 * DAY, skillBadges: [], ...o });

  // independent caregivers (each is their own provider)
  const indie = [
    { key: 'priya', name: 'Priya Nair', cat: 'GNM', gender: 'F', lat: 12.9077, lng: 77.5851, area: 'JP Nagar', langs: ['English', 'Kannada', 'Malayalam', 'Hindi'], exp: 9, qual: 'GNM, St. Martha\'s School of Nursing', reg: 'KNC-GNM-48213', council: 'Karnataka State Nursing Council', bio: 'Home-care nurse for 9 years. Diabetes and wound care. Patient, calm, and I keep families informed.', persona: { order: 3, title: 'Caregiver: nurse Priya', blurb: 'Independent nurse. Accepts bookings, checks in with GPS and visit code, fills the checklist and vitals.', icon: 'nurse' }, badges: ['Wound care'], q: 'high', n: 26 },
    { key: 'anitha', name: 'Anitha Kumari', cat: 'ANM', gender: 'F', lat: 12.9406, lng: 77.5738, area: 'Basavanagudi', langs: ['Kannada', 'Tamil', 'English'], exp: 6, qual: 'ANM, Govt. School of Nursing, Mysuru', reg: 'KNC-ANM-22871', council: 'Karnataka State Nursing Council', bio: 'Injections, vitals, insulin and sugar checks. Morning slots preferred.', q: 'good', n: 18 },
    { key: 'rahul', name: 'Rahul Shetty', cat: 'PHYSIO', gender: 'M', lat: 12.9166, lng: 77.6101, area: 'BTM Layout', langs: ['English', 'Kannada', 'Tulu', 'Hindi'], exp: 7, qual: 'BPT, MPT (Neuro), RGUHS', reg: 'KSPC-PT-1187', council: 'Karnataka State Physiotherapy Council', bio: 'Knee and hip rehab, stroke and Parkinson\'s physiotherapy at home.', q: 'good', n: 20 },
    { key: 'manju', name: 'Manjunath Gowda', cat: 'GDA', gender: 'M', lat: 12.9255, lng: 77.5468, area: 'Banashankari', langs: ['Kannada', 'English'], exp: 5, qual: 'GDA certificate, Healthcare Sector Skill Council', bio: 'Day and night attendant. Bathing, walking help, bedridden care.', q: 'fair', n: 14 },
    { key: 'sneha', name: 'Sneha Reddy', cat: 'COMPANION', gender: 'F', lat: 12.9308, lng: 77.5838, area: 'Jayanagar', langs: ['English', 'Telugu', 'Kannada', 'Hindi'], exp: 2, qual: 'MA Psychology student, trained companion', bio: 'Conversation, walks, reading and phone help. Loves old film songs.', q: 'high', n: 12 },
    { key: 'ravi', name: 'Ravi Kumar', cat: 'CONCIERGE', gender: 'M', lat: 12.9280, lng: 77.5800, area: 'Jayanagar', langs: ['Kannada', 'Hindi', 'English'], exp: 4, qual: 'Verified helper, two-wheeler and car licence', bio: 'Groceries, bank and post office, pension life certificate, bill payments and hospital escort.', q: 'good', n: 15 },
    { key: 'suresh', name: 'Suresh Babu', cat: 'GDA', gender: 'M', lat: 12.9350, lng: 77.6000, area: 'Wilson Garden', langs: ['Kannada', 'Telugu'], exp: 3, qual: 'GDA certificate', bio: 'Attendant shifts, available at short notice.', q: 'poor', n: 10 },
  ];
  const CG = {};
  for (const x of indie) {
    db.insert('users', { id: `usr_${x.key}`, role: 'caregiver', name: x.name, mobile: '+9198' + String(Math.floor(10000000 + rnd() * 89999999)), language: 'en', prefs: {}, tz: 'Asia/Kolkata', persona: x.persona });
    const p = prov(`prv_${x.key}`, { type: 'independent', typeLabel: 'Independent', name: x.name, adminUserId: `usr_${x.key}`, lat: x.lat, lng: x.lng, area: x.area, languages: x.langs, bio: x.bio, address: `${x.area}, Bengaluru` });
    CG[x.key] = cgv(`cg_${x.key}`, { userId: `usr_${x.key}`, providerId: p.id, name: x.name, category: x.cat, gender: x.gender, languages: x.langs, lat: x.lat, lng: x.lng, experienceYears: x.exp, qualifications: x.qual, registrationNo: x.reg, registrationCouncil: x.council, registrationExpiry: x.reg ? addDaysKey(today, 400) : null, pan: 'ABCDE1234F', skillBadges: x.badges || [], q: x.q, n: x.n });
  }
  CG.priya.inductionScore = 96;

  // organisations
  db.insert('users', { id: 'usr_rekha', role: 'provider_admin', name: 'Rekha Pillai', mobile: '+919900022001', language: 'en', prefs: {}, tz: 'Asia/Kolkata', persona: { order: 4, title: 'Hospital: Lakeside admin', blurb: 'Lists hospital services and packages, accepts bookings, assigns staff nurses, sees payouts and reviews.', icon: 'hospital' } });
  db.insert('users', { id: 'usr_carenest', role: 'provider_admin', name: 'Joseph D\'Souza', mobile: '+919900022002', language: 'en', prefs: {}, tz: 'Asia/Kolkata' });
  db.insert('users', { id: 'usr_sevana', role: 'provider_admin', name: 'Dr. Usha Hegde', mobile: '+919900022003', language: 'en', prefs: {}, tz: 'Asia/Kolkata' });
  const lakeside = prov('prv_lakeside', { type: 'hospital', typeLabel: 'Hospital', name: 'Lakeside Multispeciality Hospital', adminUserId: 'usr_rekha', lat: 12.9180, lng: 77.5900, area: 'Jayanagar 9th Block', address: '45, 30th Cross, Jayanagar 9th Block, Bengaluru 560069', registrationNo: 'KPME/BLR/2014/0457', hfr: 'IN2910000457', gstin: '29AABCL1234K1Z2', bio: '150-bed multispeciality hospital with a home-care department: doctors, nurses and post-discharge packages.', verification: { facility: 'pass' }, experienceYears: 12 });
  const carenest = prov('prv_carenest', { type: 'agency', typeLabel: 'Home-care agency', name: 'CareNest Home Health', adminUserId: 'usr_carenest', lat: 12.9352, lng: 77.6245, area: 'Koramangala', address: '12, 5th Block, Koramangala, Bengaluru 560095', registrationNo: 'KA-SE-2019-88213', gstin: '29AACCC5678M1Z9', bio: 'Trained attendants and nurses for day, night and live-in care across South Bengaluru.', verification: { facility: 'pass' }, languages: ['English', 'Kannada', 'Hindi', 'Tamil'], experienceYears: 7 });
  const sevana = prov('prv_sevana', { type: 'nursing_home', typeLabel: 'Nursing home', name: 'Sevana Nursing Home', adminUserId: 'usr_sevana', lat: 12.9500, lng: 77.5730, area: 'Shankarapuram', address: '8, Shankarapuram, Bengaluru 560004', registrationNo: 'KPME/BLR/2009/0112', gstin: '29AAFCS4321P1Z1', bio: 'Small nursing home with palliative and long-stay care, and live-in attendants at home.', verification: { facility: 'pass' } });
  const staff = [
    { key: 'kavitha', p: lakeside, name: 'Dr. Kavitha Menon', cat: 'DOCTOR', gender: 'F', reg: 'KMC-74521', council: 'Karnataka Medical Council', q: 'high', n: 12 },
    { key: 'lakshmi', p: lakeside, name: 'Lakshmi Devi', cat: 'GNM', gender: 'F', reg: 'KNC-GNM-31877', council: 'Karnataka State Nursing Council', q: 'high', n: 22, user: true },
    { key: 'joseph', p: lakeside, name: 'Joseph Mathew', cat: 'RN', gender: 'M', reg: 'KNC-RN-19022', council: 'Karnataka State Nursing Council', q: 'good', n: 14 },
    { key: 'fatima', p: carenest, name: 'Fatima Begum', cat: 'GDA', gender: 'F', q: 'good', n: 18 },
    { key: 'suma', p: carenest, name: 'Suma R', cat: 'ANM', gender: 'F', reg: 'KNC-ANM-40118', council: 'Karnataka State Nursing Council', q: 'fair', n: 12 },
    { key: 'prakash', p: carenest, name: 'Prakash N', cat: 'GDA', gender: 'M', q: 'good', n: 12 },
    { key: 'usha_n', p: sevana, name: 'Shanthi M', cat: 'GNM', gender: 'F', reg: 'KNC-GNM-11290', council: 'Karnataka State Nursing Council', q: 'good', n: 10 },
    { key: 'gopal', p: sevana, name: 'Gopal K', cat: 'GDA', gender: 'M', q: 'good', n: 10 },
  ];
  for (const x of staff) {
    if (x.user) db.insert('users', { id: `usr_${x.key}`, role: 'caregiver', name: x.name, mobile: '+9197' + String(Math.floor(10000000 + rnd() * 89999999)), language: 'en', prefs: {}, tz: 'Asia/Kolkata' });
    CG[x.key] = cgv(`cg_${x.key}`, { userId: x.user ? `usr_${x.key}` : null, providerId: x.p.id, name: x.name, category: x.cat, gender: x.gender, languages: x.p.languages, lat: x.p.lat, lng: x.p.lng, registrationNo: x.reg, registrationCouncil: x.council, registrationExpiry: x.reg ? addDaysKey(today, 300) : null, q: x.q, n: x.n });
  }
  // the Lakeside nurse whose registration expires soon (shows the 30-day warning in the queue)
  CG.joseph.registrationExpiry = addDaysKey(today, 21);

  // applicants waiting in the verification queue
  db.insert('users', { id: 'usr_deepa', role: 'caregiver', name: 'Deepa M', mobile: '+919741100221', language: 'en', prefs: {}, tz: 'Asia/Kolkata', persona: { order: 5, title: 'New nurse applying', blurb: 'Just signed up. Shows the verification steps, induction training and why listings stay hidden until verified.', icon: 'id' } });
  const pDeepa = prov('prv_deepa', { type: 'independent', typeLabel: 'Independent', name: 'Deepa M', adminUserId: 'usr_deepa', status: 'submitted', lat: 12.9279, lng: 77.6271, area: 'Koramangala', languages: ['English', 'Kannada', 'Hindi'] });
  cgv('cg_deepa', { userId: 'usr_deepa', providerId: pDeepa.id, name: 'Deepa M', category: 'GNM', gender: 'F', languages: ['English', 'Kannada', 'Hindi'], lat: 12.9279, lng: 77.6271, status: 'submitted', verification: { id: 'pass', registration: 'pending', police: 'pending', references: 'pending', interview: 'pending' }, inductionScore: 48, registrationNo: 'KNC-GNM-50331', registrationCouncil: 'Karnataka State Nursing Council', registrationExpiry: addDaysKey(today, 700), pan: 'FGHIJ5678K', experienceYears: 3, qualifications: 'GNM, Bangalore Baptist Hospital School of Nursing', bank: { bank: 'SBI', last4: '7781', verified: true } });
  db.insert('verificationLog', { caregiverId: 'cg_deepa', from: 'draft', to: 'submitted', by: 'Deepa M', reason: 'Documents submitted', createdAt: now - 2 * DAY });
  const pRamesh = prov('prv_ramesh', { type: 'independent', typeLabel: 'Independent', name: 'Ramesh K', status: 'under_review', lat: 12.9200, lng: 77.6000, area: 'BTM Layout' });
  cgv('cg_ramesh', { providerId: pRamesh.id, name: 'Ramesh K', category: 'GDA', gender: 'M', languages: ['Kannada', 'Hindi'], lat: 12.92, lng: 77.6, status: 'under_review', verification: { id: 'pass', registration: 'n/a', police: 'pending', references: 'pass', interview: 'pass' }, inductionScore: 85, pan: 'KLMNO9012P', experienceYears: 4, qualifications: 'GDA certificate' });
  db.insert('verificationLog', { caregiverId: 'cg_ramesh', from: 'submitted', to: 'under_review', by: 'Neha Sharma', reason: 'Police verification requested from vendor', createdAt: now - 4 * DAY });
  cgv('cg_sarah', { providerId: 'prv_lakeside', name: 'Sarah Thomas', category: 'GNM', gender: 'F', languages: ['English', 'Malayalam'], lat: lakeside.lat, lng: lakeside.lng, status: 'submitted', verification: { id: 'pass', registration: 'pending', police: 'pending', interview: 'pending' }, inductionScore: 0, registrationNo: 'KNC-GNM-52210', registrationCouncil: 'Karnataka State Nursing Council' });

  // ---- listings ----
  const L = {};
  const listing = (key, providerKey, serviceId, minCharge, o = {}) => {
    const svc = SERVICES.find((s) => s.id === serviceId);
    L[key] = db.insert('listings', { id: `lst_${key}`, providerId: `prv_${providerKey}`, serviceId, unit: svc.unit, minCharge, radiusKm: 8, languages: db.get('providers', `prv_${providerKey}`).languages, status: 'published', addOns: [], ...o });
    db.insert('priceHistory', { listingId: L[key].id, minCharge, by: 'seed', createdAt: now - 90 * DAY });
  };
  listing('priya_nurse', 'priya', 'svc_nurse_visit', 650, { gender: 'F', addOns: [{ name: 'Insulin training for family', price: 150 }, { name: 'Wound dressing kit', price: 120 }] });
  listing('priya_catheter', 'priya', 'svc_catheter', 950, { gender: 'F' });
  listing('priya_check', 'priya', 'svc_check', 700, { gender: 'F' });
  listing('anitha_nurse', 'anitha', 'svc_nurse_visit', 500, { gender: 'F', addOns: [{ name: 'Glucometer strips (10)', price: 180 }] });
  listing('anitha_lab', 'anitha', 'svc_lab', 250, { gender: 'F' });
  listing('rahul_physio', 'rahul', 'svc_physio', 800, { gender: 'M', radiusKm: 10, addOns: [{ name: 'TENS therapy', price: 200 }] });
  listing('rahul_audit', 'rahul', 'svc_safety_audit', 900, { gender: 'M', radiusKm: 10 });
  listing('manju_12h', 'manju', 'svc_attendant12', 1000, { gender: 'M' });
  listing('manju_24h', 'manju', 'svc_attendant24', 1650, { gender: 'M' });
  listing('sneha_comp', 'sneha', 'svc_companion', 400, { gender: 'F' });
  listing('sneha_tech', 'sneha', 'svc_techhelp', 300, { gender: 'F' });
  listing('ravi_errand', 'ravi', 'svc_errand', 300, { gender: 'M' });
  listing('ravi_escort', 'ravi', 'svc_escort', 600, { gender: 'M' });
  listing('ravi_life', 'ravi', 'svc_lifecert', 350, { gender: 'M' });
  listing('ravi_repair', 'ravi', 'svc_repair', 450, { gender: 'M' });
  listing('suresh_12h', 'suresh', 'svc_attendant12', 900, { gender: 'M' });
  listing('suresh_cheap', 'suresh', 'svc_attendant24', 950, { gender: 'M', status: 'review', flag: 'low' });
  listing('lake_doctor', 'lakeside', 'svc_doctor', 1400, { radiusKm: 10, capacity: 2 });
  listing('lake_nurse', 'lakeside', 'svc_nurse_visit', 700, { radiusKm: 10, capacity: 3 });
  listing('lake_iv', 'lakeside', 'svc_iv', 1300, { radiusKm: 10, capacity: 2 });
  listing('lake_postop', 'lakeside', 'svc_postop', 9000, { radiusKm: 12, capacity: 2, title: '7-day post-surgery home care', packageItems: ['Daily nurse visit (7)', 'Doctor visit on day 1 and day 6', 'Wound care and dressing', 'Discharge medicine reconciliation', '24x7 nurse helpline'] });
  listing('lake_palliative', 'lakeside', 'svc_palliative', 1500, { radiusKm: 12, capacity: 1 });
  listing('lake_lab', 'lakeside', 'svc_lab', 299, { radiusKm: 10, capacity: 4 });
  listing('nest_12h', 'carenest', 'svc_attendant12', 1050, { radiusKm: 12, capacity: 4 });
  listing('nest_24h', 'carenest', 'svc_attendant24', 1700, { radiusKm: 12, capacity: 3 });
  listing('nest_nurse', 'carenest', 'svc_nurse_visit', 550, { radiusKm: 12, capacity: 2 });
  listing('nest_escort', 'carenest', 'svc_escort', 650, { radiusKm: 12, capacity: 2 });
  listing('sevana_24h', 'sevana', 'svc_attendant24', 1900, { radiusKm: 10, capacity: 2 });
  listing('sevana_pall', 'sevana', 'svc_palliative', 1300, { radiusKm: 10, capacity: 1 });
  db.get('listings', 'lst_lake_nurse').sponsored = true;

  // ---- background families (authors of past reviews) ----
  const bgNames = ['Lalitha S', 'Mohan Krishnan', 'Saroja Iyer', 'Abdul Rahim', 'Gowramma', 'Thomas Varghese', 'Padma Rajan', 'Narayan Hegde', 'Vimala Shetty', 'Shankar Rao'];
  const bgSeniors = bgNames.map((n, i) => {
    const uid = `usr_bgsen${i}`;
    db.insert('users', { id: uid, role: 'senior', name: n, mobile: '+9190000' + String(10000 + i), language: 'en', prefs: {}, background: true });
    const fam = `usr_bgfam${i}`;
    db.insert('users', { id: fam, role: 'family', name: `${n.split(' ')[0]}'s ${i % 2 ? 'daughter' : 'son'}`, mobile: '+9191000' + String(10000 + i), language: 'en', prefs: {}, background: true });
    const s = db.insert('seniors', { id: `sen_bg${i}`, userId: uid, name: n, gender: i % 2 ? 'F' : 'M', dob: dobYears(66 + (i * 3) % 20), address: 'Bengaluru', area: 'South Bengaluru', city: 'Bengaluru', lat: HOME.lat + (rnd() - 0.5) * 0.05, lng: HOME.lng + (rnd() - 0.5) * 0.05, languages: ['Kannada'], conditions: [], allergies: [], emergencyContacts: [], consent: { status: 'given' }, background: true });
    db.insert('circle', { seniorId: s.id, userId: fam, role: 'owner', relation: i % 2 ? 'daughter' : 'son', status: 'active' });
    return { s, fam, rel: i % 2 ? 'daughter' : 'son' };
  });

  // ---- historical bookings with visits, reviews, payments and payouts ----
  const quality = { high: [4.5, 5, 0.96, 1], good: [3.7, 4.6, 0.8, 0.9], fair: [3.0, 4.0, 0.62, 0.75], poor: [1.8, 3.2, 0.4, 0.6] };
  const listingFor = (cgKey) => {
    const cgRec = CG[cgKey];
    const ls = db.filter('listings', (l) => l.providerId === cgRec.providerId && l.status === 'published' && SERVICES.find((s) => s.id === l.serviceId).allowed.includes(cgRec.category) && l.serviceId !== 'svc_postop');
    return ls[Math.floor(rnd() * ls.length)];
  };
  const pastBooking = (cgKey, seniorRec, payer, payerRel, start, opts = {}) => {
    const cgRec = CG[cgKey];
    const l = opts.listing || listingFor(cgKey);
    if (!l) return null;
    const svc = SERVICES.find((s) => s.id === l.serviceId);
    const p = db.get('providers', l.providerId);
    const [lo, hi, onTimeP, checkP] = quality[cgRec.q || 'good'];
    const price = priceBooking({ minCharge: l.minCharge, discountPct: opts.discountPct || 0, trusted: cgRec.q === 'high' });
    const dur = { visit: 60, '12-h shift': 720, '24-h live-in': 1440, package: 60 }[l.unit] || 60;
    const late = rnd() > onTimeP ? (15 + Math.floor(rnd() * 25)) * MIN : Math.floor(rnd() * 8) * MIN;
    const items = CHECKLISTS[svc.checklist];
    const checklistRate = rnd() < checkP ? 1 : (items.length - 1) / items.length;
    const status = opts.status || 'paid_out';
    const b = db.insert('bookings', {
      seniorId: seniorRec.id, seniorName: seniorRec.name, listingId: l.id, serviceId: svc.id, serviceName: svc.name, serviceNameHi: svc.nameHi, checklistKey: svc.checklist,
      providerId: p.id, providerName: p.name, caregiverId: cgRec.id, caregiverName: cgRec.name, start, end: start + dur * MIN, qty: 1, addOns: [], notes: '', price,
      status, bookedBy: payer, payerId: payer, source: 'marketplace', visitCode: String(1000 + Math.floor(rnd() * 9000)), assignedAt: start - 2 * DAY,
      checkInAt: start + late, checkInDistanceM: 20 + Math.floor(rnd() * 90), checkOutAt: start + dur * MIN, completedAt: start + dur * MIN, confirmedAt: start + dur * MIN + 2 * HOUR,
      checklistRate, timeline: [{ at: start - 2 * DAY, text: 'Booked and paid' }, { at: start + late, text: 'Checked in (code verified)' }, { at: start + dur * MIN, text: 'Checked out, report sent' }],
      alerts: {}, checkInAttempts: 0, isCheckVisit: !!svc.checkVisit, background: !!seniorRec.background, createdAt: start - 2 * DAY,
    });
    const pay = db.insert('payments', { userId: payer, seniorId: seniorRec.id, amount: price.total, fromCredit: 0, charged: price.total, purpose: svc.name, method: ['upi', 'card', 'upi'][Math.floor(rnd() * 3)], bookingId: b.id, gatewayRef: 'pay_seed' + b.id, status: 'released', capturedAt: start - 2 * DAY, createdAt: start - 2 * DAY });
    b.paymentId = pay.id;
    if (status === 'paid_out') db.insert('payouts', { providerId: p.id, caregiverId: cgRec.id, bookingId: b.id, gross: price.careValue, commission: price.commission, tds: Math.round(price.providerShare * 0.01), amount: price.providerShare - Math.round(price.providerShare * 0.01), status: 'paid', dueAt: start + 2 * DAY, paidAt: start + 2 * DAY, utr: 'UTR' + Math.floor(rnd() * 1e10), createdAt: start + DAY });
    if (opts.review !== false && rnd() < 0.85) {
      const mk = (type, label, uid) => {
        const base = lo + rnd() * (hi - lo);
        const r = () => Math.max(1, Math.min(5, Math.round(base + (rnd() - 0.5))));
        const score = base;
        const pool = score >= 4.2 ? REVIEW_TEXT.good : score >= 3.2 ? REVIEW_TEXT.mid : REVIEW_TEXT.bad;
        db.insert('reviews', { bookingId: b.id, providerId: p.id, caregiverId: cgRec.id, seniorId: seniorRec.id, userId: uid, reviewerType: type, reviewerLabel: label, ratings: { punctuality: r(), skill: r(), behaviour: r(), hygiene: r(), communication: r() }, text: rnd() < 0.7 ? pool[Math.floor(rnd() * pool.length)] : '', tags: [], visitDate: start, serviceName: svc.name, status: 'published', flags: [], channel: type === 'senior' && rnd() < 0.4 ? 'ivr' : 'app', createdAt: start + dur * MIN + 3 * HOUR });
      };
      if (rnd() < 0.8) mk('senior', 'Senior', seniorRec.userId);
      mk('payer', `Paid by ${payerRel}`, payer);
    }
    return b;
  };

  for (const [key, cgRec] of Object.entries(CG)) {
    if (!cgRec.n || !['verified'].includes(cgRec.status)) continue;
    const loyal = bgSeniors[Math.floor(rnd() * bgSeniors.length)];
    for (let i = 0; i < cgRec.n; i++) {
      const who = i % 3 === 0 ? loyal : bgSeniors[Math.floor(rnd() * bgSeniors.length)];
      const start = istTime(addDaysKey(today, -(3 + Math.floor(rnd() * 80))), ['08:00', '09:00', '10:00', '11:00', '15:00', '16:00'][Math.floor(rnd() * 6)]);
      pastBooking(key, who.s, who.fam, who.rel, start);
    }
  }
  // a substantiated complaint and a no-show against the low performer
  db.insert('grievances', { userId: 'usr_bgfam3', userName: "Abdul's son", seniorId: 'sen_bg3', providerId: 'prv_suresh', caregiverId: 'cg_suresh', category: 'Late', subject: 'Late: Attendant, 12-hour shift', text: 'Came 50 minutes late and left early without telling us.', priority: 'normal', status: 'resolved', outcome: 'Provider warning', substantiated: true, ackAt: now - 9 * DAY, resolvedAt: now - 7 * DAY, ackDueAt: now - 8 * DAY, resolveDueAt: now + 20 * DAY, createdAt: now - 10 * DAY });

  // ---- Kamala's history ----
  const kamala = db.get('seniors', 'sen_kamala');
  const raghavan = db.get('seniors', 'sen_raghavan');
  for (let i = 0; i < 6; i++) pastBooking('priya', kamala, 'usr_arjun', 'son', istTime(addDaysKey(today, -(8 + i * 9)), '10:30'), { listing: L.priya_nurse, discountPct: i < 2 ? 5 : 0 });
  for (let i = 0; i < 3; i++) pastBooking('rahul', raghavan, 'usr_meera', 'daughter', istTime(addDaysKey(today, -(5 + i * 7)), '11:00'), { listing: L.rahul_physio });
  pastBooking('ravi', kamala, 'usr_meera', 'daughter', istTime(addDaysKey(today, -15), '09:30'), { listing: L.ravi_escort });

  // check visits with vitals (last 3 months), trending better
  const vitalsHist = [
    { d: -75, bpSys: 156, bpDia: 94, pulse: 84, spo2: 96, temp: 98.4, sugar: 182, weight: 64 },
    { d: -45, bpSys: 148, bpDia: 90, pulse: 80, spo2: 97, temp: 98.2, sugar: 165, weight: 63.5 },
    { d: -26, bpSys: 142, bpDia: 88, pulse: 78, spo2: 97, temp: 98.6, sugar: 151, weight: 63 },
    { d: -12, bpSys: 138, bpDia: 86, pulse: 76, spo2: 98, temp: 98.4, sugar: 142, weight: 63 },
  ];
  for (const v of vitalsHist) {
    const start = istTime(addDaysKey(today, v.d), '10:00');
    const b = pastBooking('lakshmi', kamala, 'usr_arjun', 'son', start, { listing: { ...L.lake_nurse, serviceId: 'svc_check', unit: 'visit', id: null, providerId: 'prv_lakeside' }, review: false });
    Object.assign(b, { listingId: null, source: 'subscription', isCheckVisit: true, serviceName: 'Wellness check visit', serviceNameHi: 'मासिक स्वास्थ्य जाँच', checklistKey: 'check', serviceId: 'svc_check' });
    const vals = { ...v }; delete vals.d;
    const vr = db.insert('vitals', { seniorId: 'sen_kamala', at: start + 40 * MIN, source: 'check visit', bookingId: b.id, by: 'Lakshmi Devi', ...vals });
    db.insert('visitReports', { bookingId: b.id, seniorId: 'sen_kamala', checklist: Object.fromEntries(CHECKLISTS.check.map((c) => [c, true])), checklistItems: CHECKLISTS.check, vitalsId: vr.id, vitals: vals, observations: v.d > -30 ? 'Sugar improving with evening walks. Knee pain manageable. Bathroom grab bar recommended.' : 'BP a little high; advised low salt. Mood good.', mood: 'good', traffic: { vitals: vals.bpSys >= 150 ? 'amber' : 'green', medicines: 'green', home: 'amber', mood: 'green', nutrition: 'green' }, by: 'Lakshmi Devi', createdAt: start + HOUR });
  }
  // Raghavan vitals from physio visits
  for (const dd of [-19, -12, -5]) db.insert('vitals', { seniorId: 'sen_raghavan', at: istTime(addDaysKey(today, dd), '11:10'), source: 'visit', by: 'Rahul Shetty', bpSys: 128 + dd * -0.3, bpDia: 80, pulse: 72, spo2: 96 });

  // yesterday's completed visit waiting for confirmation and reviews
  const yStart = istTime(addDaysKey(today, -1), '10:30');
  const yb = pastBooking('priya', kamala, 'usr_arjun', 'son', yStart, { listing: L.priya_nurse, status: 'completed', review: false, discountPct: 5 });
  Object.assign(yb, { completedAt: now - 2 * HOUR, confirmedAt: null });
  yb.checkOutAt = Math.min(yb.checkOutAt, now - 2 * HOUR);
  db.get('payments', yb.paymentId).status = 'escrow';
  db.insert('visitReports', { bookingId: yb.id, seniorId: 'sen_kamala', checklist: Object.fromEntries(CHECKLISTS.nursing.map((c) => [c, true])), checklistItems: CHECKLISTS.nursing, vitals: { bpSys: 136, bpDia: 84, pulse: 76, sugar: 138 }, observations: 'Insulin pen technique reviewed with Kamala amma. Small blister on left heel cleaned and dressed; check again in 3 days.', mood: 'good', by: 'Priya Nair', createdAt: yb.checkOutAt });
  db.insert('vitals', { seniorId: 'sen_kamala', at: yStart + 30 * MIN, source: 'visit', bookingId: yb.id, by: 'Priya Nair', bpSys: 136, bpDia: 84, pulse: 76, sugar: 138 });

  // ---- subscription ----
  const subStart = now - 12 * DAY;
  const subPay = db.insert('payments', { userId: 'usr_arjun', seniorId: 'sen_kamala', amount: 2499, fromCredit: 0, charged: 2499, purpose: 'Care plan (monthly)', method: 'upi_autopay', gatewayRef: 'pay_seedsub', status: 'captured', createdAt: subStart, capturedAt: subStart });
  const sub = db.insert('subscriptions', { id: 'sub_kamala', seniorId: 'sen_kamala', planId: 'plan_care', payerId: 'usr_arjun', cycle: 'monthly', method: 'upi_autopay', mandateId: 'mdt_kamala01', status: 'active', periodStart: subStart, periodEnd: subStart + 30 * DAY, nextBillingAt: subStart + 30 * DAY, coordinatorId: 'usr_neha', checkDay: { weekday: 6, time: '10:00' }, failCount: 0, payments: [subPay.id], createdAt: subStart - 60 * DAY });
  // upcoming check visits: one assigned to the same nurse, one waiting for the coordinator
  const svcCheck = SERVICES.find((s) => s.id === 'svc_check');
  const mkCheck = (days, assigned) => {
    const start = istTime(addDaysKey(today, days), '10:00');
    db.insert('bookings', { seniorId: 'sen_kamala', seniorName: 'Kamala Rao', listingId: null, serviceId: svcCheck.id, serviceName: svcCheck.name, serviceNameHi: svcCheck.nameHi, checklistKey: 'check', providerId: assigned ? 'prv_lakeside' : null, providerName: assigned ? 'Lakeside Multispeciality Hospital' : 'ElderLink care team', caregiverId: assigned ? 'cg_lakshmi' : null, caregiverName: assigned ? 'Lakshmi Devi' : null, start, end: start + HOUR, qty: 1, addOns: [], notes: 'Included in Care plan', price: { serviceValue: 0, addOnsValue: 0, discount: 0, careValue: 0, platformFee: 0, gst: 0, total: 0, commission: 0, providerShare: 700, elderlinkFee: 0 }, status: assigned ? 'assigned' : 'accepted', assignedAt: assigned ? now - DAY : null, bookedBy: 'system', source: 'subscription', subscriptionId: sub.id, visitCode: String(1000 + Math.floor(rnd() * 9000)), isCheckVisit: true, preferredCaregiverId: 'cg_lakshmi', timeline: [{ at: subStart, text: 'Scheduled as part of the subscription' }], alerts: {}, checkInAttempts: 0 });
  };
  mkCheck(2, true);
  mkCheck(16, false);
  db.insert('invoices', { subscriptionId: sub.id, seniorId: 'sen_kamala', number: 'ELK/SUB/00001', issuer: 'ElderLink Care Technologies Pvt Ltd (demo)', issuerGstin: '29AAAAA0000A1Z5', kind: 'subscription', lines: [{ text: 'Care plan, monthly', amount: 2118 }], taxable: 2118, gst: 381, total: 2499, note: 'Price includes GST at 18%.', createdAt: subStart });

  // ---- upcoming bookings ----
  const roundUp = (t, m) => Math.ceil(t / (m * MIN)) * m * MIN;
  const todayVisit = Math.max(istTime(today, '10:30'), roundUp(now + 40 * MIN, 15));
  const mkUpcoming = (cgKey, listingRec, start, status, seniorRec, payer, extra = {}) => {
    const svc = SERVICES.find((s) => s.id === listingRec.serviceId);
    const cgRec = cgKey ? CG[cgKey] : null;
    const p = db.get('providers', listingRec.providerId);
    const price = priceBooking({ minCharge: listingRec.minCharge, discountPct: seniorRec.id === 'sen_kamala' ? 5 : 0, trusted: cgRec?.q === 'high' });
    const dur = { visit: 60, '12-h shift': 720, '24-h live-in': 1440 }[listingRec.unit] || 60;
    const b = db.insert('bookings', { seniorId: seniorRec.id, seniorName: seniorRec.name, listingId: listingRec.id, serviceId: svc.id, serviceName: svc.name, serviceNameHi: svc.nameHi, checklistKey: svc.checklist, providerId: p.id, providerName: p.name, caregiverId: cgRec?.id || null, caregiverName: cgRec?.name || null, start, end: start + dur * MIN, qty: 1, addOns: [], notes: '', price, status, bookedBy: payer, payerId: payer, payerName: db.get('users', payer)?.name, source: 'marketplace', visitCode: String(1000 + Math.floor(rnd() * 9000)), assignedAt: cgRec ? now - 20 * HOUR : null, requestedAt: now - DAY, acceptBy: status === 'requested' ? now + 25 * MIN : null, timeline: [{ at: now - DAY, text: `Booked and paid by ${db.get('users', payer)?.name}` }], alerts: {}, checkInAttempts: 0, ...extra });
    if (status !== 'pending_approval') {
      const pay = db.insert('payments', { userId: payer, seniorId: seniorRec.id, amount: price.total, fromCredit: 0, charged: price.total, purpose: svc.name, method: 'upi', bookingId: b.id, gatewayRef: 'pay_up' + b.id, status: 'escrow', capturedAt: now - DAY, createdAt: now - DAY });
      b.paymentId = pay.id;
    }
    return b;
  };
  const tv = mkUpcoming('priya', L.priya_nurse, todayVisit, 'assigned', kamala, 'usr_arjun', { notes: 'Check the heel blister and review insulin technique.' });
  tv.visitCode = '4821';
  mkUpcoming('rahul', L.rahul_physio, istTime(addDaysKey(today, 1), '11:00'), 'assigned', raghavan, 'usr_meera', { notes: 'Balance and gait exercises.' });
  mkUpcoming(null, L.nest_12h, istTime(addDaysKey(today, 2), '08:00'), 'accepted', raghavan, 'usr_arjun', { notes: 'Day attendant while Kamala amma goes to the eye camp.' });
  mkUpcoming('sneha', L.sneha_comp, istTime(addDaysKey(today, 3), '16:00'), 'assigned', raghavan, 'usr_meera', { notes: 'Loves old Kannada film songs. Short walk in the park if he is steady.' });
  // a senior request waiting for family approval (FR-FAM-03 / FR-CON-05)
  const req = mkUpcoming(null, L.ravi_escort, istTime(addDaysKey(today, 4), '09:00'), 'pending_approval', kamala, 'usr_kamala', { source: 'senior_request', bookedByName: 'Kamala Rao', notes: 'Requested by the senior: eye camp at Lakeside', caregiverId: 'cg_ravi', caregiverName: 'Ravi Kumar' });
  req.timeline = [{ at: now - 3 * HOUR, text: 'Requested by Kamala Rao, waiting for family approval' }];
  req.payerId = null;
  // requests waiting for providers to accept
  mkUpcoming(null, L.lake_postop, istTime(addDaysKey(today, 3), '09:00'), 'requested', bgSeniors[1].s, bgSeniors[1].fam, { background: false });
  mkUpcoming(null, L.lake_doctor, istTime(addDaysKey(today, 1), '17:00'), 'accepted', bgSeniors[4].s, bgSeniors[4].fam);
  mkUpcoming('priya', L.priya_catheter, istTime(addDaysKey(today, 2), '17:00'), 'requested', bgSeniors[2].s, bgSeniors[2].fam);
  mkUpcoming('priya', L.priya_nurse, istTime(addDaysKey(today, 1), '09:00'), 'assigned', bgSeniors[0].s, bgSeniors[0].fam);

  // ---- medicines and dose history ----
  const meds = [
    { id: 'med_metformin', seniorId: 'sen_kamala', name: 'Glycomet (Metformin)', generic: 'Metformin', strength: '500 mg', form: 'tablet', dose: '1 tablet', times: ['08:00', '20:00'], food: 'after food', stock: 46, color: '#ffffff', shape: 'oval', doctor: 'Dr. S. Murthy' },
    { id: 'med_amlo', seniorId: 'sen_kamala', name: 'Amlong (Amlodipine)', generic: 'Amlodipine', strength: '5 mg', form: 'tablet', dose: '1 tablet', times: ['08:00'], food: 'after food', stock: 12, color: '#f7d7e3', shape: 'round', doctor: 'Dr. S. Murthy' },
    { id: 'med_calcium', seniorId: 'sen_kamala', name: 'Shelcal (Calcium + D3)', generic: 'Calcium carbonate + Vitamin D3', strength: '500 mg', form: 'tablet', dose: '1 tablet', times: ['14:00'], food: 'after food', stock: 28, color: '#fff3c4', shape: 'oval', doctor: 'Dr. S. Murthy' },
    { id: 'med_atorva', seniorId: 'sen_kamala', name: 'Atorva (Atorvastatin)', generic: 'Atorvastatin', strength: '10 mg', form: 'tablet', dose: '1 tablet', times: ['21:00'], food: 'after food', stock: 30, color: '#e3f0ff', shape: 'round', doctor: 'Dr. S. Murthy' },
    { id: 'med_insulin', seniorId: 'sen_kamala', name: 'Lantus (Insulin glargine)', generic: 'Insulin glargine', strength: '10 units', form: 'injection', dose: '10 units', times: ['22:00'], food: '', stock: 25, critical: true, color: '#d8f3e6', shape: 'pen', doctor: 'Dr. S. Murthy' },
    { id: 'med_syndopa', seniorId: 'sen_raghavan', name: 'Syndopa Plus (Levodopa + Carbidopa)', generic: 'Levodopa + Carbidopa', strength: '100/25 mg', form: 'tablet', dose: '1 tablet', times: ['08:00', '14:00', '20:00'], food: 'before food', stock: 70, critical: true, color: '#ffe0c2', shape: 'round', doctor: 'Dr. A. Rao' },
    { id: 'med_donep', seniorId: 'sen_raghavan', name: 'Donep (Donepezil)', generic: 'Donepezil', strength: '5 mg', form: 'tablet', dose: '1 tablet', times: ['21:00'], food: '', stock: 26, color: '#ffffff', shape: 'round', doctor: 'Dr. A. Rao' },
  ];
  for (const m of meds) db.insert('medicines', { doseQty: 1, startDate: addDaysKey(today, -120), endDate: null, critical: false, active: true, addedBy: 'Meera Rao', ...m });
  for (const m of meds) {
    for (let dd = -14; dd <= 0; dd++) {
      const key = addDaysKey(today, dd);
      for (const time of m.times) {
        const due = istTime(key, time);
        if (due > now - 70 * MIN) continue; // recent and future doses are created live by the jobs
        const roll = rnd();
        const status = roll < (m.seniorId === 'sen_kamala' ? 0.9 : 0.86) ? 'taken' : roll < 0.93 ? 'skipped' : 'missed';
        db.insert('doses', { medicineId: m.id, seniorId: m.seniorId, seniorName: m.seniorId === 'sen_kamala' ? 'Kamala Rao' : 'Raghavan Rao', medName: `${m.name} ${m.strength}`, time, due, status, critical: !!m.critical, takenAt: status === 'taken' ? due + Math.floor(rnd() * 25) * MIN : null, source: m.seniorId === 'sen_kamala' ? 'senior app' : 'IVR keypress', reminded: due, createdAt: due - DAY });
      }
    }
  }

  // ---- past SOS case ----
  const sosAt = now - 24 * DAY;
  db.insert('cases', { seniorId: 'sen_kamala', seniorName: 'Kamala Rao', trigger: 'senior app (long press)', triggeredBy: 'Kamala Rao', status: 'closed', type: 'medical', reason: 'Fall with injury', location: { ...HOME, source: 'GPS' }, covered: true, agentId: 'usr_imran', agentName: 'Imran Khan', ackAt: sosAt + 38 * 1000, outcome: 'Minor bruise, no hospital needed', closedAt: sosAt + 55 * MIN, followUp: { at: sosAt + 20 * HOUR, by: 'Neha Sharma', notes: 'Booked home safety audit; grab bar to be fitted in bathroom.' }, summary: {}, createdAt: sosAt, timeline: [
    { at: sosAt, kind: 'trigger', text: 'SOS raised by Kamala Rao (senior app)' },
    { at: sosAt + 4000, kind: 'notify', text: 'Care circle (3) and 2 emergency contacts alerted by push, SMS and voice' },
    { at: sosAt + 38000, kind: 'ack', text: 'Imran Khan acknowledged in 38 s' },
    { at: sosAt + 70000, kind: 'call_senior', text: 'Called Kamala Rao: answered. Slipped in bathroom, conscious, pain in left hip.' },
    { at: sosAt + 2 * MIN, kind: 'triage', text: 'Triage: medical (Fall with injury)' },
    { at: sosAt + 3 * MIN, kind: 'call_contact', text: 'Called emergency contact Shobha Iyengar (neighbour): going to the home' },
    { at: sosAt + 6 * MIN, kind: 'nearby_caregiver', text: 'Asked nearby verified caregiver Priya Nair to check in person' },
    { at: sosAt + 28 * MIN, kind: 'note', text: 'Priya Nair on site: can bear weight, bruise only, vitals normal' },
    { at: sosAt + 55 * MIN, kind: 'close', text: 'Closed by Imran Khan: Minor bruise, no hospital needed' },
    { at: sosAt + 20 * HOUR, kind: 'followup', text: 'Coordinator follow-up: booked home safety audit; grab bar to be fitted' },
  ] });
  for (let i = 0; i < 9; i++) { const at = now - (30 + i * 9) * DAY; db.insert('cases', { seniorId: `sen_bg${i}`, seniorName: bgNames[i], trigger: 'senior app (long press)', status: 'closed', type: i % 3 ? 'nonurgent' : 'medical', reason: i % 3 ? 'Anxiety / needs to talk' : 'Breathlessness', ackAt: at + (22 + i * 6) * 1000, outcome: i % 3 ? 'Reassured on call' : 'Taken to hospital', closedAt: at + HOUR, followUp: { at: at + DAY }, location: HOME, timeline: [], createdAt: at, summary: {} }); }

  // ---- operations queues ----
  db.insert('qualityTickets', { kind: 'low_rating', seniorId: 'sen_bg6', caregiverId: 'cg_suresh', providerId: 'prv_suresh', text: 'Paid by son rated 2 stars (did not come on time): Came very late and left early.', status: 'open', priority: 'high', dueAt: now - 2 * HOUR, createdAt: now - 3 * HOUR });
  db.insert('grievances', { userId: 'usr_bgfam5', userName: "Thomas's daughter", seniorId: 'sen_bg5', providerId: 'prv_carenest', caregiverId: 'cg_suma', category: 'Billing', subject: 'Billing: charged for add-on not used', text: 'We were charged Rs 180 for glucometer strips that were not used.', priority: 'normal', status: 'open', ackDueAt: now + 30 * HOUR, resolveDueAt: now + 28 * DAY, createdAt: now - 18 * HOUR });
  db.insert('supplyRequests', { seniorId: 'sen_bg8', area: 'Whitefield', serviceId: 'svc_physio', serviceName: 'Physiotherapy session', status: 'open', createdAt: now - DAY });
  db.insert('scamReports', { seniorId: 'sen_bg2', channel: 'call', text: 'Caller said he was from "Mumbai police" and that a parcel in her name had drugs. Asked her to stay on video call.', lostMoney: false, status: 'open', createdAt: now - 5 * HOUR });
  db.insert('checkins', { seniorId: 'sen_kamala', date: addDaysKey(today, -1), attempts: 1, status: 'ok', respondedAt: istTime(addDaysKey(today, -1), '09:02'), mood: 'good' });

  // ---- extras catalogue ----
  const eq = [
    { id: 'eq_o2', name: 'Oxygen concentrator (5 L)', category: 'oxygen', rentMonthly: 4500, deposit: 10000, price: 48000, partner: 'BreatheEasy Medical (licensed)' },
    { id: 'eq_bed', name: 'Hospital bed (semi-fowler, manual)', category: 'bed', rentMonthly: 3200, deposit: 5000, price: 32000, partner: 'MediRent Bengaluru' },
    { id: 'eq_mattress', name: 'Air mattress for bed sores', category: 'bed', rentMonthly: 900, deposit: 1500, price: 4200, partner: 'MediRent Bengaluru' },
    { id: 'eq_wheel', name: 'Wheelchair (foldable)', category: 'mobility', rentMonthly: 1200, deposit: 2000, price: 7500, partner: 'MediRent Bengaluru' },
    { id: 'eq_walker', name: 'Walker with wheels', category: 'mobility', rentMonthly: 450, deposit: 800, price: 2800, partner: 'MediRent Bengaluru' },
    { id: 'eq_commode', name: 'Commode chair', category: 'mobility', rentMonthly: 500, deposit: 800, price: 3200, partner: 'MediRent Bengaluru' },
    { id: 'eq_bp', name: 'Digital BP monitor (large display)', category: 'device', price: 2100, partner: 'AGEasy-style curated store' },
    { id: 'eq_grab', name: 'Bathroom grab bar, fitted', category: 'safety', price: 1450, partner: 'SafeHome Fixers' },
    { id: 'eq_mat', name: 'Non-slip bath mat', category: 'safety', price: 499, partner: 'Curated store' },
    { id: 'eq_phone', name: 'Big-button phone with SOS key', category: 'device', price: 1899, partner: 'Curated store' },
  ];
  for (const e of eq) db.insert('equipment', { rating: 4 + Math.round(rnd() * 9) / 10, ...e });
  const ev = [
    { title: 'Gentle chair yoga', titleHi: 'कुर्सी योग', days: 1, time: '07:30', online: true, language: 'English / Kannada', host: 'Yoga teacher Smitha' },
    { title: 'Carnatic music evening (live)', titleHi: 'कर्नाटक संगीत संध्या', days: 2, time: '17:30', online: false, venue: 'Jayanagar 4th Block community hall', language: 'Kannada' },
    { title: 'Smartphone class: UPI safely and spotting scams', titleHi: 'स्मार्टफ़ोन क्लास: सुरक्षित UPI', days: 3, time: '11:00', online: true, language: 'Hindi', host: 'ElderLink digital helper' },
    { title: 'Health talk: managing diabetes in winter', titleHi: 'स्वास्थ्य वार्ता: मधुमेह', days: 5, time: '16:00', online: true, language: 'English', host: 'Dr. Kavitha Menon, Lakeside' },
    { title: 'Bhagavad Gita study circle', titleHi: 'भगवद गीता अध्ययन', days: 6, time: '10:00', online: true, language: 'Hindi / Sanskrit' },
    { title: 'Deepavali get-together', titleHi: 'दीपावली मिलन', days: 9, time: '17:00', online: false, venue: 'Lalbagh West Gate partner venue', language: 'All' },
  ];
  for (const e of ev) db.insert('events', { title: e.title, titleHi: e.titleHi, at: istTime(addDaysKey(today, e.days), e.time), online: e.online, venue: e.venue || 'Online (video link)', language: e.language, host: e.host || 'ElderLink community', city: 'Bengaluru', baseAttendees: 8 + Math.floor(rnd() * 30) });
  db.insert('rsvps', { eventId: db.all('events')[2].id, seniorId: 'sen_kamala' });
  db.insert('vault', { seniorId: 'sen_kamala', title: 'Aadhaar card', type: 'ID', fileName: 'aadhaar_kamala.pdf', size: 210000, shareWith: ['owner', 'manager'], uploadedBy: 'Arjun Rao', encrypted: true });
  db.insert('vault', { seniorId: 'sen_kamala', title: 'Star Health senior policy 2026', type: 'Insurance', fileName: 'star_health_policy.pdf', size: 880000, shareWith: ['owner', 'manager', 'viewer'], uploadedBy: 'Arjun Rao', encrypted: true });
  db.insert('vault', { seniorId: 'sen_kamala', title: 'Pension payment order (PPO)', type: 'Pension', fileName: 'ppo.pdf', size: 150000, shareWith: ['owner'], uploadedBy: 'Meera Rao', encrypted: true });
  for (const c of COURSES) db.insert('courseProgress', { courseId: c.id, caregiverId: 'cg_priya', score: 90 + Math.floor(rnd() * 10), passed: true, at: now - 200 * DAY });
  for (const c of COURSES.slice(0, 3)) db.insert('courseProgress', { courseId: c.id, caregiverId: 'cg_deepa', score: 92 + Math.floor(rnd() * 8), passed: true, at: now - 2 * DAY });

  db.insert('credits', { userId: 'usr_arjun', amount: 200, reason: 'Provider cancelled: goodwill credit', expiresAt: now + 300 * DAY, createdAt: now - 40 * DAY });
  db.insert('helplineCalls', { seniorId: 'sen_kamala', userId: 'usr_kamala', question: 'Feeling dizzy after morning walk', nurse: 'Nurse Shalini (RN, helpline)', status: 'answered', answeredInSec: 64, advice: 'Sugar was 92 on home check. Advised a glass of buttermilk and rest; walk after breakfast instead of before. Logged for check visit.', createdAt: now - 6 * DAY });

  const act = (sid, who, text, ago, kind = 'info') => db.insert('activity', { seniorId: sid, userId: null, who, text, kind, createdAt: now - ago });
  act('sen_kamala', 'Meera Rao', 'updated the care plan', 9 * DAY);
  act('sen_kamala', 'Arjun Rao', 'booked Nursing visit with Priya Nair', DAY);
  act('sen_kamala', 'Priya Nair', 'completed Nursing visit (report sent)', 2 * HOUR, 'visit');
  act('sen_kamala', 'Kamala Rao', 'asked for a Hospital escort (needs approval)', 3 * HOUR, 'approval');
  act('sen_raghavan', 'Meera Rao', 'booked Physiotherapy with Rahul Shetty', 2 * DAY);
  act('sen_raghavan', 'Kiran Rao', 'was assigned "Collect Appa\'s neurology report"', DAY);

  const note = (to, title, body, ago, extra = {}) => db.insert('notifications', { userId: to, channel: 'push', title, body, status: 'sent', read: false, createdAt: now - ago, ...extra });
  note('usr_arjun', 'Visit report ready', 'Priya Nair finished Nursing visit for Kamala Rao. Tap to confirm or raise an issue within 24 hours.', 2 * HOUR);
  note('usr_arjun', 'Approval needed', 'Kamala Rao asked for Hospital escort. Approve or decline in the app.', 3 * HOUR);
  note('usr_arjun', 'Medicine running low', 'Amlong (Amlodipine) will run out in 12 days. Order a refill.', 20 * HOUR);

  // itemised DPDP consents recorded at sign-up (FR-ONB-02)
  for (const u of db.all('users').filter((x) => !x.background)) {
    for (const purpose of ['care', 'circle', 'health']) db.insert('consents', { userId: u.id, purpose, version: 'v1.0', granted: true, at: u.createdAt || now - 60 * DAY }, 'con');
    if (u.id === 'usr_arjun') db.insert('consents', { userId: u.id, purpose: 'marketing', version: 'v1.0', granted: false, at: now - 60 * DAY }, 'con');
  }

  // remove helper fields
  for (const c of db.all('caregivers')) { delete c.q; delete c.n; }
  d.meta.seededAt = now;
  db.dirty = true;
}

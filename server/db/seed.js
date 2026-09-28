/**
 * Demo data for evaluation and testing. All dates are generated relative to
 * the current date so the dashboard always shows a realistic "today":
 * visitors on premises, an overstay, expected pre-registrations, pending
 * approvals, a restricted-visitor denial and a year of history for reports.
 *
 * Usage: npm run db:seed            (refuses to run on a database with visitors)
 *        npm run db:seed -- --force (adds demo data regardless)
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { config } from '../config.js';
import { pool, withTransaction } from './pool.js';
import { hashPassword } from '../lib/passwords.js';
import { localDate, addDays } from '../lib/time.js';

export const DEMO_PASSWORD = 'Vms@Demo2026';
const TZ = 'Asia/Kolkata';

// Deterministic PRNG so every seeded database looks the same.
let prngState = 20260928;
const rand = () => { prngState = (prngState * 1664525 + 1013904223) % 4294967296; return prngState / 4294967296; };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));

const ORGANISATION = {
  name: 'Northgate Administrative Complex',
  shortName: 'NAC',
  address: 'Plot 14, Civic Centre Road, Sector 5, Bengaluru 560001',
  phone: '+91 80 4000 1200',
  email: 'reception@northgate.example',
  website: 'www.northgate.example',
  footerText: 'This document is generated electronically by the Visitor Management System.',
  logoFileId: null,
  receptionPoint: 'Main Entrance',
  timezone: TZ,
  defaultCountryCode: '+91',
};

const DEPARTMENTS = [
  ['ADMIN', 'Administration'], ['FIN', 'Finance'], ['HR', 'Human Resources'], ['IT', 'Information Technology'],
  ['LEGAL', 'Legal'], ['SEC', 'Security'], ['OPS', 'Operations'], ['PROC', 'Procurement'],
];

const EMPLOYEES = [
  ['EMP-1001', 'Mr.', 'Rajesh Kumar', 'Manager – Administration', 'ADMIN', 'Ground Floor, Block A'],
  ['EMP-1002', 'Ms.', 'Priya Sharma', 'Deputy Director – Finance', 'FIN', 'First Floor, Block A'],
  ['EMP-1003', 'Mr.', 'Anil Mehta', 'Chief Financial Officer', 'FIN', 'Second Floor, Block A'],
  ['EMP-1004', 'Dr.', 'Sunita Rao', 'Head – Human Resources', 'HR', 'First Floor, Block B'],
  ['EMP-1005', 'Mr.', 'Vikram Singh', 'IT Manager', 'IT', 'Second Floor, Block B'],
  ['EMP-1006', 'Ms.', 'Kavita Nair', 'Senior Legal Counsel', 'LEGAL', 'Third Floor, Block A'],
  ['EMP-1007', 'Mr.', 'Suresh Iyer', 'Chief Security Officer', 'SEC', 'Security Office, Gate 1'],
  ['EMP-1008', 'Mr.', 'Deepak Joshi', 'Operations Manager', 'OPS', 'Ground Floor, Block C'],
  ['EMP-1009', 'Ms.', 'Anjali Gupta', 'Procurement Officer', 'PROC', 'First Floor, Block C'],
  ['EMP-1010', 'Mr.', 'Manoj Pillai', 'Assistant Manager – Administration', 'ADMIN', 'Ground Floor, Block A'],
  ['EMP-1011', 'Ms.', 'Neha Verma', 'HR Executive', 'HR', 'First Floor, Block B'],
  ['EMP-1012', 'Mr.', 'Arjun Reddy', 'Systems Administrator', 'IT', 'Server Wing, Block B'],
  ['EMP-1013', 'Mrs.', 'Lakshmi Menon', 'Accounts Officer', 'FIN', 'First Floor, Block A'],
  ['EMP-1014', 'Mr.', 'Rahul Desai', 'Facilities Supervisor', 'OPS', 'Ground Floor, Block C'],
  ['EMP-1015', 'Ms.', 'Pooja Bhatt', 'Legal Assistant', 'LEGAL', 'Third Floor, Block A'],
  ['EMP-1016', 'Mr.', 'Sanjay Kulkarni', 'Director – Operations', 'OPS', 'Fourth Floor, Block A'],
  ['EMP-1017', 'Dr.', 'Meera Krishnan', 'Chief Administrative Officer', 'ADMIN', 'Fourth Floor, Block A'],
  ['EMP-1018', 'Mr.', 'Karthik Subramanian', 'Network Engineer', 'IT', 'Second Floor, Block B'],
  ['EMP-1019', 'Ms.', 'Ritu Malhotra', 'Senior Purchase Officer', 'PROC', 'First Floor, Block C'],
  ['EMP-1020', 'Mr.', 'Harish Chandra', 'Security Supervisor', 'SEC', 'Security Office, Gate 1'],
  ['EMP-1021', 'Ms.', 'Divya Agarwal', 'Recruitment Manager', 'HR', 'First Floor, Block B'],
  ['EMP-1022', 'Mr.', 'Naveen Prasad', 'Internal Auditor', 'FIN', 'Second Floor, Block A'],
];

const COMPANIES = [
  ['ABC Technologies Pvt. Ltd.', 'IT Services', 'Whitefield, Bengaluru 560066', 'Srinivas Rao', '+918040102030', 'contact@abctech.example', 'www.abctech.example'],
  ['Infosphere Consulting LLP', 'Consulting', 'MG Road, Bengaluru 560001', 'Nisha Kapoor', '+918041112233', 'info@infosphere.example', 'www.infosphere.example'],
  ['Bharat Engineering Works', 'Engineering', 'Peenya Industrial Area, Bengaluru 560058', 'Gopal Shetty', '+918028394455', null, null],
  ['Sunrise Facility Services', 'Facility Management', 'Koramangala, Bengaluru 560034', 'Mohan Das', '+918025536677', 'ops@sunrisefs.example', null],
  ['Apex Legal Associates', 'Legal', 'Cunningham Road, Bengaluru 560052', 'Adv. Rekha Menon', '+918022201122', 'chambers@apexlegal.example', null],
  ['Global Logistics India Ltd.', 'Logistics', 'Hosur Road, Bengaluru 560068', 'Farhan Ali', '+918049998877', null, 'www.globallogistics.example'],
  ['Metro Office Supplies', 'Vendor', 'Jayanagar, Bengaluru 560041', 'Prakash Jain', '+918026634455', 'sales@metrooffice.example', null],
  ['Zenith Systems Integrators', 'IT Hardware', 'Electronic City, Bengaluru 560100', 'Ravi Teja', '+918067712345', 'support@zenithsi.example', null],
  ['National Audit Services', 'Audit', 'Residency Road, Bengaluru 560025', 'CA Venkatesh', '+918022245566', null, null],
  ['Blue Line Couriers', 'Courier', 'Indiranagar, Bengaluru 560038', 'Dispatch Desk', '+918025251234', null, null],
  ['Kiran Constructions', 'Contractor', 'Yelahanka, Bengaluru 560064', 'Kiran Gowda', '+918028561234', null, null],
  ['Office of the Regional Commissioner', 'Government', 'Vidhana Veedhi, Bengaluru 560001', 'Protocol Officer', '+918022253344', null, null],
];

// name, mobile, company index (or null), designation, category code, id type code, gender for silhouette tint
const VISITORS = [
  ['Ramesh Kumar', '9876543210', 0, 'General Manager', 'BUSINESS', 'GOVT_ID'],
  ['Sneha Kulkarni', '9845012345', 1, 'Senior Consultant', 'CONSULTANT', 'GOVT_ID'],
  ['Mohammed Irfan', '9900112233', 2, 'Site Engineer', 'CONTRACTOR', 'DRIVING'],
  ['Lakshmi Narayan', '9731234567', 3, 'Supervisor', 'SERVICE', 'EMPLOYEE_ID'],
  ['Adv. Rohan Menon', '9886098860', 4, 'Advocate', 'BUSINESS', 'OFFICIAL_ID'],
  ['Farhan Qureshi', '9740011223', 5, 'Account Manager', 'VENDOR', 'GOVT_ID'],
  ['Prakash Jain', '9448012345', 6, 'Sales Executive', 'VENDOR', null],
  ['Ravi Teja', '9019012345', 7, 'Engineer', 'SERVICE', 'EMPLOYEE_ID'],
  ['Venkatesh Iyer', '9620012345', 8, 'Audit Partner', 'BUSINESS', 'GOVT_ID'],
  ['Santosh Yadav', '9591234567', 9, 'Delivery Executive', 'DELIVERY', null],
  ['Kiran Gowda', '9535012345', 10, 'Contractor', 'CONTRACTOR', 'DRIVING'],
  ['Shri Ashok Hegde', '9480012345', 11, 'Deputy Commissioner', 'GOVT', 'OFFICIAL_ID'],
  ['Ananya Bose', '9902345678', null, null, 'INTERVIEW', 'PASSPORT'],
  ['Rohit Bansal', '9812345670', 0, 'Project Manager', 'BUSINESS', 'GOVT_ID'],
  ['Meenakshi Sundaram', '9444012345', 1, 'Consultant', 'CONSULTANT', null],
  ['Imran Sheikh', '9767012345', 2, 'Engineer', 'CONTRACTOR', 'DRIVING'],
  ['Deepa Nair', '9895012345', null, null, 'GUEST', null],
  ['Gaurav Saxena', '9971012345', 7, 'Technical Lead', 'VENDOR', 'EMPLOYEE_ID'],
  ['Pallavi Deshpande', '9822012345', null, null, 'INTERVIEW', 'GOVT_ID'],
  ['Sameer Khan', '9833012345', 5, 'Logistics Coordinator', 'VENDOR', null],
  ['Anita Fernandes', '9820098200', 4, 'Paralegal', 'BUSINESS', null],
  ['Vijay Patil', '9960012345', 3, 'Electrician', 'SERVICE', 'EMPLOYEE_ID'],
  ['Harpreet Kaur', '9815012345', 11, 'Inspector', 'GOVT', 'OFFICIAL_ID'],
  ['Arvind Swamy', '9845098450', 8, 'Senior Auditor', 'BUSINESS', 'GOVT_ID'],
  ['Nikhil Rao', '9008012345', 0, 'Solutions Architect', 'BUSINESS', null],
  ['Sunil Shetty', '9731098765', 10, 'Mason Supervisor', 'CONTRACTOR', 'DRIVING'],
  ['Priyanka Chopra', '9899012345', null, null, 'GUEST', null],
  ['Abdul Rahman', '9945012345', 9, 'Courier Associate', 'DELIVERY', null],
  ['Kavya Hegde', '9611012345', 1, 'Analyst', 'CONSULTANT', null],
  ['Manish Tiwari', '9935012345', 6, 'Regional Sales Manager', 'VENDOR', null],
  ['Jose Mathew', '9447012345', 2, 'Quality Inspector', 'CONTRACTOR', 'GOVT_ID'],
  ['Shalini Rao', '9741012345', null, null, 'INTERVIEW', 'GOVT_ID'],
  ['Arun Prakash', '9884012345', 7, 'Field Engineer', 'SERVICE', 'EMPLOYEE_ID'],
  ['Rekha Pillai', '9496012345', 3, 'Housekeeping Lead', 'SERVICE', null],
  ['Tarun Malhotra', '9810098100', 5, 'Branch Head', 'BUSINESS', null],
  ['Asha Kiran', '9036012345', null, null, 'GUEST', null],
  ['Dinesh Karthik', '9500012345', 0, 'Delivery Manager', 'BUSINESS', null],
  ['Rajiv Menon', '9447098765', 11, 'Section Officer', 'GOVT', 'OFFICIAL_ID'],
  ['Suresh Babu', '9380012345', 10, 'Site Supervisor', 'CONTRACTOR', 'DRIVING'],
  ['Neelam Gupta', '9811198111', 8, 'Audit Associate', 'BUSINESS', null],
];

const TINTS = ['#dbe4f0', '#e2e8f0', '#e0e7ef', '#e5e7eb', '#dde6ee', '#e8e5e0'];

async function silhouette(i) {
  const bg = TINTS[i % TINTS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480" viewBox="0 0 360 480">
    <rect width="360" height="480" fill="${bg}"/>
    <circle cx="180" cy="190" r="78" fill="#94a3b8"/>
    <path d="M40 480 C40 350 110 300 180 300 C250 300 320 350 320 480 Z" fill="#94a3b8"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 78 }).toBuffer();
}

async function storePhoto(client, buf, userId) {
  const key = `photos/demo/${crypto.randomUUID()}.jpg`;
  const full = path.join(config.storageDir, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf);
  const { rows } = await client.query(
    `INSERT INTO stored_files (purpose, storage_key, mime_type, size_bytes, width, height, sha256, is_attached, created_by)
     VALUES ('VISITOR_PHOTO', $1, 'image/jpeg', $2, 360, 480, $3, TRUE, $4) RETURNING id`,
    [key, buf.length, crypto.createHash('sha256').update(buf).digest('hex'), userId],
  );
  return rows[0].id;
}

/** A UTC Date for a local (Asia/Kolkata, UTC+05:30) date and time. */
function at(date, hh, mm) {
  const d = new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`);
  return d;
}

export async function seed({ force = false, log = console.log } = {}) {
  const today = localDate(TZ);
  const now = new Date();
  await withTransaction(async (client) => {
    const existing = await client.query('SELECT count(*)::int AS n FROM visitors');
    if (existing.rows[0].n > 0 && !force) {
      throw new Error('The database already contains visitors. Use --force to add demo data anyway.');
    }
    await client.query(`UPDATE system_settings SET value = $1 WHERE key = 'organisation'`, [JSON.stringify(ORGANISATION)]);

    // ---- Departments & employees ----
    const dept = {};
    for (const [code, name] of DEPARTMENTS) {
      const { rows } = await client.query('INSERT INTO departments (code, name) VALUES ($1, $2) RETURNING id', [code, name]);
      dept[code] = rows[0].id;
    }
    const emp = {};
    const empRows = [];
    for (const [codeE, sal, name, desig, d, loc] of EMPLOYEES) {
      const first = name.split(' ')[0].toLowerCase();
      const last = name.split(' ').slice(-1)[0].toLowerCase();
      const { rows } = await client.query(
        `INSERT INTO employees (employee_code, salutation, full_name, designation, department_id, official_mobile, official_email, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [codeE, sal, name, desig, dept[d], `+9198${between(10000000, 99999999)}`, `${first}.${last}@northgate.example`, loc],
      );
      emp[name] = rows[0].id;
      empRows.push({ id: rows[0].id, name: `${sal} ${name}`, designation: desig, departmentId: dept[d], dept: d });
    }

    // ---- Users ----
    const roles = Object.fromEntries((await client.query('SELECT code, id FROM roles')).rows.map((r) => [r.code, r.id]));
    const pw = await hashPassword(DEMO_PASSWORD);
    const users = [
      ['superadmin', 'System Super Administrator', 'SUPER_ADMIN', null],
      ['admin', 'Meera Krishnan', 'ADMIN', emp['Meera Krishnan']],
      ['reception', 'Anita D\'Souza', 'RECEPTION', null],
      ['reception2', 'Farida Begum', 'RECEPTION', null],
      ['security', 'Harish Chandra', 'SECURITY', emp['Harish Chandra']],
      ['rajesh.kumar', 'Rajesh Kumar', 'HOST', emp['Rajesh Kumar']],
      ['priya.sharma', 'Priya Sharma', 'HOST', emp['Priya Sharma']],
    ];
    const uid = {};
    for (const [u, n, r, e] of users) {
      const { rows } = await client.query(
        `INSERT INTO users (username, full_name, email, password_hash, role_id, employee_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [u, n, `${u}@northgate.example`, pw, roles[r], e],
      );
      uid[u] = rows[0].id;
    }
    const receptionIds = [uid.reception, uid.reception2];

    // ---- Companies ----
    const companyIds = [];
    for (const [name, category, address, contact, phone, email, website] of COMPANIES) {
      const { rows } = await client.query(
        `INSERT INTO companies (name, category, address, contact_person, contact_number, email, website, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [name, category, address, contact, phone, email, website, uid.admin],
      );
      companyIds.push(rows[0].id);
    }

    // ---- Masters lookup ----
    const lookup = async (table) => Object.fromEntries((await client.query(`SELECT code, id FROM ${table}`)).rows.map((r) => [r.code, r.id]));
    const categories = await lookup('visitor_categories');
    const purposes = await lookup('purposes');
    const areas = await lookup('access_areas');
    const idTypes = await lookup('id_types');

    // ---- Visitors ----
    const visitors = [];
    for (let i = 0; i < VISITORS.length; i++) {
      const [name, mobile, ci, desig, cat, idt] = VISITORS[i];
      const photoId = i < 30 ? await storePhoto(client, await silhouette(i), uid.reception) : null;
      const created = at(addDays(today, -between(380, 420)), 9, 0);
      const { rows } = await client.query(
        `INSERT INTO visitors (full_name, mobile_country_code, mobile_number, email, company_id, designation, id_type_id, id_reference,
                               photo_file_id, created_by, updated_by, created_at)
         VALUES ($1, '+91', $2, $3, $4, $5, $6, $7, $8, $9, $9, $10) RETURNING id, visitor_code`,
        [name, mobile, ci !== null && i % 3 === 0 ? `${name.split(' ').slice(-1)[0].toLowerCase()}@${COMPANIES[ci][0].split(' ')[0].toLowerCase()}.example` : null,
          ci !== null ? companyIds[ci] : null, desig, idt ? idTypes[idt] : null, idt ? `XXXXXX${between(1000, 9999)}` : null, photoId, pick(receptionIds), created],
      );
      if (photoId) await client.query('INSERT INTO visitor_photos (visitor_id, file_id, captured_by, captured_at) VALUES ($1, $2, $3, $4)', [rows[0].id, photoId, uid.reception, created]);
      visitors.push({ id: rows[0].id, code: rows[0].visitor_code, name, companyId: ci !== null ? companyIds[ci] : null, cat, index: i });
    }
    const byName = Object.fromEntries(visitors.map((v) => [v.name, v]));

    // Watchlist examples
    await client.query(`UPDATE visitors SET watchlist_status = 'BLOCKED', watchlist_reason = 'Misconduct during previous visit – entry barred by Chief Security Officer',
                         watchlist_updated_by = $2, watchlist_updated_at = now() - interval '40 days' WHERE id = $1`, [byName['Sameer Khan'].id, uid.superadmin]);
    await client.query(`UPDATE visitors SET watchlist_status = 'FLAGGED', watchlist_reason = 'Escort required at all times (contract dispute pending)',
                         watchlist_updated_by = $2, watchlist_updated_at = now() - interval '20 days' WHERE id = $1`, [byName['Jose Mathew'].id, uid.superadmin]);

    // ---- Visit plan ----
    const purposeFor = (cat) => ({
      BUSINESS: ['OFFICIAL_MEETING', 'BUSINESS_MEETING', 'CONSULTATION'], CONSULTANT: ['CONSULTATION', 'OFFICIAL_MEETING', 'TRAINING'],
      CONTRACTOR: ['SERVICE', 'INSPECTION'], SERVICE: ['SERVICE'], VENDOR: ['VENDOR_VISIT', 'BUSINESS_MEETING', 'DOC_SUBMISSION'],
      DELIVERY: ['DELIVERY'], GOVT: ['GOVT_VISIT', 'INSPECTION', 'AUDIT'], INTERVIEW: ['INTERVIEW'], GUEST: ['PERSONAL', 'OFFICIAL_MEETING'],
    }[cat] || ['OFFICIAL_MEETING']);
    const hostFor = (purposeCode) => {
      const map = {
        INTERVIEW: ['HR'], TRAINING: ['HR', 'IT'], SERVICE: ['OPS', 'IT'], DELIVERY: ['ADMIN', 'PROC'], VENDOR_VISIT: ['PROC'],
        DOC_SUBMISSION: ['PROC', 'FIN'], AUDIT: ['FIN'], INSPECTION: ['OPS', 'SEC'], CONSULTATION: ['LEGAL', 'FIN', 'IT'],
      };
      const depts = map[purposeCode] || ['ADMIN', 'FIN', 'IT', 'OPS', 'LEGAL'];
      return pick(empRows.filter((e) => depts.includes(e.dept)));
    };
    const areaFor = (purposeCode, hostDept) => (purposeCode === 'SERVICE' && hostDept === 'IT' ? 'SERVER_ROOM'
      : ['OFFICIAL_MEETING', 'BUSINESS_MEETING', 'CONSULTATION', 'TRAINING'].includes(purposeCode) ? pick(['CONFERENCE', 'ADMINISTRATION', 'FIRST_FLOOR'])
        : purposeCode === 'DELIVERY' ? 'RECEPTION' : pick(['ADMINISTRATION', 'FIRST_FLOOR', 'OTHER']));

    const NO_RANDOM_HISTORY = new Set(['Ramesh Kumar', 'Sneha Kulkarni', 'Venkatesh Iyer', 'Pallavi Deshpande', 'Harpreet Kaur',
      'Shalini Rao', 'Asha Kiran', 'Arun Prakash', 'Meenakshi Sundaram']);
    const plan = [];
    const push = (v) => plan.push(v);
    const rajesh = empRows.find((e) => e.name.endsWith('Rajesh Kumar'));

    // Ramesh Kumar: 12 completed visits, last one 10 days ago, always meeting Mr. Rajesh Kumar.
    const rameshDays = [-10, -24, -41, -63, -88, -112, -140, -175, -210, -260, -310, -365];
    rameshDays.forEach((d, k) => push({
      visitor: byName['Ramesh Kumar'], date: addDays(today, d), host: k % 4 === 3 ? pick(empRows.filter((e) => e.dept === 'ADMIN')) : rajesh,
      purpose: k === 0 ? 'OFFICIAL_MEETING' : pick(['OFFICIAL_MEETING', 'BUSINESS_MEETING']), kind: 'done', inAt: [10, 32], minutes: k === 0 ? 106 : between(40, 130),
      vehicle: k % 2 === 0 ? { number: 'KA01MJ4521', type: 'CAR' } : null,
    }));
    // Two more repeat visitors with 10+ visits each.
    for (const name of ['Sneha Kulkarni', 'Venkatesh Iyer']) {
      for (let k = 0; k < 11; k++) {
        const v = byName[name];
        const purpose = pick(purposeFor(v.cat));
        push({ visitor: v, date: addDays(today, -between(5, 360)), host: hostFor(purpose), purpose, kind: 'done', minutes: between(30, 150) });
      }
    }
    // General history across the past ~13 months.
    for (let k = 0; k < 330; k++) {
      const v = visitors[Math.floor(Math.pow(rand(), 1.6) * visitors.length)];
      // Keep the showcase repeat visitors' counts exact, and keep some of today's visitors first-time.
      if (NO_RANDOM_HISTORY.has(v.name) || (v.name === 'Sameer Khan' && k > 5)) continue;
      const purpose = pick(purposeFor(v.cat));
      const dayOffset = -between(1, 395);
      const date = addDays(today, dayOffset);
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (dow === 0 || (dow === 6 && rand() < 0.7)) continue;
      const r = rand();
      push({
        visitor: v, date, host: hostFor(purpose), purpose,
        kind: r < 0.9 ? 'done' : r < 0.95 ? 'cancelled' : 'denied-host',
        minutes: purpose === 'DELIVERY' ? between(5, 20) : between(20, 200),
        overstayed: rand() < 0.04,
        vehicle: rand() < 0.25 ? { number: `KA${String(between(1, 53)).padStart(2, '0')}${pick(['AB', 'MC', 'HX', 'N', 'P'])}${between(1000, 9999)}`, type: pick(['CAR', 'CAR', 'TWO_WHEELER', 'TAXI', 'COMMERCIAL']) } : null,
      });
    }
    // Earlier today: checked out
    [['Rohit Bansal', 'BUSINESS_MEETING', [9, 15], 55], ['Santosh Yadav', 'DELIVERY', [9, 40], 12], ['Pallavi Deshpande', 'INTERVIEW', [9, 50], 75],
      ['Anita Fernandes', 'DOC_SUBMISSION', [10, 5], 25], ['Arvind Swamy', 'AUDIT', [8, 45], 95]].forEach(([n, p, t, m]) => {
      push({ visitor: byName[n], date: today, host: hostFor(p), purpose: p, kind: 'done', inAt: t, minutes: m, today: true });
    });
    // Currently on premises (relative to now)
    const minsAgo = (m) => new Date(now.getTime() - m * 60000);
    [['Mohammed Irfan', 'SERVICE', 50, 120], ['Nikhil Rao', 'OFFICIAL_MEETING', 35, 60], ['Kiran Gowda', 'INSPECTION', 80, 180],
      ['Meenakshi Sundaram', 'CONSULTATION', 20, 90], ['Harpreet Kaur', 'GOVT_VISIT', 15, 60], ['Jose Mathew', 'INSPECTION', 25, 120]].forEach(([n, p, ago, dur]) => {
      push({ visitor: byName[n], date: today, host: hostFor(p), purpose: p, kind: 'inside', inAtDate: minsAgo(ago), duration: dur, today: true });
    });
    // Overstay: checked in 3h40m ago for a 1 hour visit
    push({ visitor: byName['Vijay Patil'], date: today, host: empRows.find((e) => e.name.endsWith('Rahul Desai')), purpose: 'SERVICE', kind: 'inside', inAtDate: minsAgo(220), duration: 60, today: true, overstay: true });
    // Rajesh Kumar has a visitor inside right now
    push({ visitor: byName['Dinesh Karthik'], date: today, host: rajesh, purpose: 'OFFICIAL_MEETING', kind: 'inside', inAtDate: minsAgo(40), duration: 60, today: true, vehicle: { number: 'KA05MN7788', type: 'CAR' } });
    // Expected (pre-registered) today and upcoming
    [['Shalini Rao', 'INTERVIEW', today, '14:30', 60], ['Asha Kiran', 'PERSONAL', today, '15:00', 30], ['Tarun Malhotra', 'BUSINESS_MEETING', today, '16:00', 90],
      ['Kavya Hegde', 'TRAINING', addDays(today, 1), '10:00', 180], ['Neelam Gupta', 'AUDIT', addDays(today, 2), '11:00', 120]].forEach(([n, p, d, t, dur]) => {
      push({ visitor: byName[n], date: d, host: hostFor(p), purpose: p, kind: 'expected', arrival: t, duration: dur, today: d === today });
    });
    push({ visitor: byName['Abdul Rahman'], date: today, host: rajesh, purpose: 'DELIVERY', kind: 'expected', arrival: '12:00', duration: 15, today: true });
    // Pending approval (server room / restricted area)
    push({ visitor: byName['Arun Prakash'], date: today, host: empRows.find((e) => e.name.endsWith('Arjun Reddy')), purpose: 'SERVICE', kind: 'pending', area: 'SERVER_ROOM', duration: 120, today: true });
    push({ visitor: byName['Gaurav Saxena'], date: today, host: rajesh, purpose: 'VENDOR_VISIT', kind: 'pending', area: 'RESTRICTED', duration: 60, today: true });
    // Restricted visitor denied today
    push({ visitor: byName['Sameer Khan'], date: today, host: empRows.find((e) => e.name.endsWith('Anjali Gupta')), purpose: 'VENDOR_VISIT', kind: 'denied-restricted', today: true });

    // Chronological order so reference numbers increase with time.
    const startOf = (p) => p.inAtDate?.getTime() ?? at(p.date, ...(p.inAt || [between(9, 16), between(0, 59)])).getTime();
    for (const p of plan) p.sortKey = startOf(p);
    plan.sort((a, b) => a.sortKey - b.sortKey);

    const receptionistFor = () => pick(receptionIds);
    let passCount = 0;
    for (const p of plan) {
      const v = p.visitor;
      const year = Number(p.date.slice(0, 4));
      const code = (await client.query('SELECT next_document_number($1, $2) AS c', ['VST', year])).rows[0].c;
      const catId = categories[v.cat] || categories.GUEST;
      const area = p.area || areaFor(p.purpose, p.host.dept);
      const recBy = receptionistFor();
      const duration = p.duration || (p.purpose === 'DELIVERY' ? 15 : pick([30, 60, 60, 60, 90, 120]));
      let checkIn = null;
      let checkOut = null;
      let status;
      let minutes = null;
      let validUntil = null;
      if (p.kind === 'done' || p.kind === 'inside') {
        checkIn = p.inAtDate || new Date(p.sortKey);
        // Keep today's completed visits in the past even when seeding early in the day.
        if (p.today && p.kind === 'done' && checkIn.getTime() + (p.minutes + 5) * 60000 > now.getTime()) {
          checkIn = new Date(now.getTime() - (p.minutes + between(10, 90)) * 60000);
        }
        validUntil = new Date(checkIn.getTime() + duration * 60000);
        if (p.kind === 'done') {
          minutes = p.overstayed ? duration + between(20, 90) : Math.min(p.minutes, duration + 10);
          checkOut = new Date(checkIn.getTime() + minutes * 60000);
          status = 'CHECKED_OUT';
        } else {
          status = p.overstay ? 'OVERSTAY' : 'CHECKED_IN';
        }
      } else if (p.kind === 'expected') status = 'EXPECTED';
      else if (p.kind === 'pending') status = 'PENDING_APPROVAL';
      else if (p.kind === 'cancelled') status = 'CANCELLED';
      else status = 'DENIED';
      const created = checkIn ? new Date(checkIn.getTime() - between(2, 6) * 60000) : (p.today ? new Date(now.getTime() - between(60, 300) * 60000) : at(p.date, 9, 0));
      const createdFinal = p.kind === 'expected' ? new Date(Math.min(now.getTime() - 86400000, at(p.date, 9, 0).getTime() - 86400000 * between(1, 5))) : created;
      let vehicleId = null;
      if (p.vehicle) {
        const { rows } = await client.query(
          `INSERT INTO vehicles (registration_number, vehicle_type, last_visitor_id) VALUES ($1, $2, $3)
           ON CONFLICT (registration_number) DO UPDATE SET last_visitor_id = EXCLUDED.last_visitor_id RETURNING id`, [p.vehicle.number, p.vehicle.type, v.id],
        );
        vehicleId = rows[0].id;
      }
      const isPrereg = p.kind === 'expected';
      const { rows } = await client.query(
        `INSERT INTO visits (visit_code, visitor_id, company_id, host_employee_id, department_id, host_name_snapshot, host_designation_snapshot,
            purpose_id, category_id, access_area_id, appointment_type, appointment_date, expected_arrival, expected_duration_min, is_preregistered,
            special_instructions, qr_token, status, entry_point, id_verified, id_verified_by, id_verified_at, consent_given, consent_at, consent_recorded_by,
            consent_text_version, vehicle_id, driver_name, parking_required, arrived_at, check_in_at, checked_in_by, valid_until, check_out_at,
            checked_out_by, duration_minutes, overstay_flagged_at, host_notified_at, closed_at, status_reason, created_at, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'Main Entrance',$19,$20,$21,$22,$23,$24,'1.0',$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$40)
         RETURNING id`,
        [
          code, v.id, v.companyId, p.host.id, p.host.departmentId, p.host.name, p.host.designation,
          purposes[p.purpose], catId, areas[area] || null, isPrereg ? 'PRE_REGISTERED' : 'WALK_IN', p.date, p.arrival || null, duration, isPrereg,
          isPrereg && p.purpose === 'INTERVIEW' ? 'Candidate to be escorted to HR interview room, First Floor Block B.' : null,
          crypto.randomBytes(24).toString('base64url'), status,
          Boolean(checkIn) && rand() < 0.7, checkIn ? recBy : null, checkIn,
          Boolean(checkIn), checkIn, checkIn ? recBy : null,
          vehicleId, null, Boolean(vehicleId) && rand() < 0.6, checkIn, checkIn, checkIn ? recBy : null, validUntil, checkOut,
          checkOut ? receptionistFor() : null, minutes,
          p.overstay ? new Date(validUntil.getTime() + 15 * 60000) : (p.overstayed ? validUntil : null),
          checkIn, checkOut, status === 'DENIED' ? (p.kind === 'denied-restricted' ? 'Restricted visitor – entry not permitted (Misconduct during previous visit – entry barred by Chief Security Officer)' : 'Rejected by host – meeting not scheduled') : status === 'CANCELLED' ? 'Visitor did not arrive' : null,
          createdFinal, isPrereg && p.host.id === rajesh.id ? uid['rajesh.kumar'] : recBy,
        ],
      );
      const visitId = rows[0].id;
      const hist = async (from, to, event, remarks, when, by) => client.query(
        'INSERT INTO visit_status_history (visit_id, from_status, to_status, event, remarks, changed_by, changed_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [visitId, from, to, event, remarks, by ?? null, when],
      );
      await hist(null, isPrereg ? 'EXPECTED' : 'REGISTERED', isPrereg ? 'PRE_REGISTERED' : 'REGISTERED', isPrereg ? 'Visit pre-registered' : 'Visitor registered at reception', createdFinal, recBy);
      if (p.kind === 'pending') {
        await hist(null, 'PENDING_APPROVAL', 'APPROVAL_REQUESTED', `Approval requested from ${p.host.name}`, createdFinal, recBy);
        await client.query('INSERT INTO approvals (visit_id, approver_employee_id, requested_by, requested_at, reason) VALUES ($1, $2, $3, $4, $5)',
          [visitId, p.host.id, recBy, createdFinal, `Access area: ${area === 'SERVER_ROOM' ? 'Server Room' : 'Restricted Area'}`]);
      }
      if (p.kind === 'denied-restricted') await hist(null, 'DENIED', 'DENIED_RESTRICTED', 'Restricted visitor – entry not permitted', createdFinal, recBy);
      if (p.kind === 'denied-host') await hist('PENDING_APPROVAL', 'DENIED', 'REJECTED', 'Rejected by host – meeting not scheduled', new Date(createdFinal.getTime() + 600000), null);
      if (p.kind === 'cancelled') await hist('EXPECTED', 'CANCELLED', 'CANCELLED', 'Visitor did not arrive', at(p.date, 18, 0), recBy);
      if (checkIn) {
        passCount++;
        const pass = (await client.query('SELECT next_document_number($1, $2) AS c', ['PASS', year])).rows[0].c;
        await client.query(
          `INSERT INTO visitor_passes (pass_number, visit_id, status, issued_at, issued_by, valid_until, print_count, last_printed_at, returned_at)
           VALUES ($1, $2, $3, $4, $5, $6, 1, $4, $7)`, [pass, visitId, checkOut ? 'RETURNED' : 'ISSUED', checkIn, recBy, validUntil, checkOut],
        );
        await hist(null, 'APPROVED', 'APPROVED', null, created, recBy);
        await hist('APPROVED', 'APPROVED', 'DECLARATION_ACCEPTED', 'Declaration version 1.0', checkIn, recBy);
        await hist('APPROVED', 'CHECKED_IN', 'CHECKED_IN', `Visitor Pass ${pass} issued`, checkIn, recBy);
        await hist('CHECKED_IN', 'CHECKED_IN', 'HOST_NOTIFIED', `Host ${p.host.name} notified of arrival`, checkIn, null);
        await hist('CHECKED_IN', 'CHECKED_IN', 'PASS_PRINTED', 'Visitor Pass printed (copy 1)', checkIn, recBy);
        if (p.overstay || p.overstayed) await hist('CHECKED_IN', 'OVERSTAY', 'OVERSTAY', 'Expected departure exceeded', new Date(validUntil.getTime() + 15 * 60000), null);
        if (checkOut) {
          await hist(p.overstayed ? 'OVERSTAY' : 'CHECKED_IN', 'CHECKED_OUT', 'CHECKED_OUT', null, checkOut, recBy);
          await hist('CHECKED_OUT', 'CHECKED_OUT', 'VISIT_CLOSED', 'Visit record closed', checkOut, recBy);
        }
        if (p.today && p.host.id === rajesh.id) {
          await client.query(
            `INSERT INTO notifications (channel, type, recipient_user_id, recipient_employee_id, title, body, visit_id, status, created_at, sent_at, read_at)
             VALUES ('IN_APP', 'VISITOR_ARRIVAL', $1, $2, $3, $4, $5, 'DELIVERED', $6, $6, NULL)`,
            [uid['rajesh.kumar'], rajesh.id, `Visitor arrived: ${v.name}`,
              `Visitor Arrival Notification\n\nVisitor: ${v.name}\nOrganisation: ${v.companyId ? COMPANIES[VISITORS[v.index][2]][0] : '—'}\nPurpose: Official Meeting\nArrival: ${new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(checkIn).toUpperCase()}\nReception: Main Entrance\nVisitor Pass Number: ${pass}`,
              visitId, checkIn],
          );
        }
      }
    }
    await client.query(`UPDATE visitors v SET total_visits = s.total, first_visit_at = s.first_at, last_visit_at = s.last_at
                          FROM (SELECT visitor_id, count(*) FILTER (WHERE check_in_at IS NOT NULL) AS total, min(check_in_at) AS first_at, max(check_in_at) AS last_at
                                  FROM visits GROUP BY visitor_id) s WHERE s.visitor_id = v.id`);
    await client.query(
      `INSERT INTO audit_logs (username, role_code, action, entity_type, summary) VALUES ('system', 'SYSTEM', 'DEMO_DATA_LOADED', 'system', $1)`,
      [`Demo data loaded: ${visitors.length} visitors, ${COMPANIES.length} companies, ${EMPLOYEES.length} employees, ${plan.length} visits, ${passCount} passes`],
    );
    log(`[seed] ${visitors.length} visitors, ${COMPANIES.length} companies, ${EMPLOYEES.length} employees, ${DEPARTMENTS.length} departments, ${plan.length} visits`);
    log(`[seed] demo users: superadmin, admin, reception, reception2, security, rajesh.kumar, priya.sharma  (password: ${DEMO_PASSWORD})`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed({ force: process.argv.includes('--force') })
    .then(() => pool.end())
    .catch((err) => {
      console.error(`[seed] ${err.message}`);
      process.exit(1);
    });
}

-- =============================================================================
-- Reference data required in every installation (not demo data).
-- Roles, permissions, default masters, default settings and print templates.
-- =============================================================================

INSERT INTO roles (code, name, description) VALUES
  ('SUPER_ADMIN', 'Super Administrator',        'Full control of users, masters, settings, audit, retention and exports'),
  ('ADMIN',       'Administrator',              'Visitor operations, host management and reports'),
  ('RECEPTION',   'Reception / Front Desk Officer', 'Visitor registration, check-in, check-out and pass printing'),
  ('SECURITY',    'Security Officer',           'Verification, on-premises monitoring and emergency roll call'),
  ('HOST',        'Host / Employee',            'Expected visitors, pre-registration and approvals for own visitors');

INSERT INTO permissions (code, description) VALUES
  ('dashboard.view',        'View dashboard'),
  ('dashboard.analytics',   'View dashboard analytics charts'),
  ('visitor.view',          'Search and view visitor records'),
  ('visitor.create',        'Register new visitors'),
  ('visitor.update',        'Update visitor information'),
  ('visitor.archive',       'Archive visitor records'),
  ('visitor.watchlist',     'Manage blocked / restricted visitors'),
  ('visitor.watchlist.view','View restricted visitor alerts'),
  ('visit.view_all',        'View all visits'),
  ('visit.view_own',        'View visits where the user is the host'),
  ('visit.create',          'Create visits / walk-in registrations'),
  ('visit.checkin',         'Check visitors in'),
  ('visit.checkout',        'Check visitors out'),
  ('visit.cancel',          'Cancel visits'),
  ('visit.approve_own',     'Approve or reject own visitor requests'),
  ('visit.approve_any',     'Approve or reject any visitor request (override)'),
  ('prereg.own',            'Pre-register visitors for self as host'),
  ('prereg.any',            'Pre-register visitors for any host'),
  ('pass.print',            'Print visitor passes and visitor records'),
  ('security.verify',       'Verify visitor passes and QR codes'),
  ('onpremises.view',       'View visitors currently on premises'),
  ('emergency.view',        'View and print emergency roll call'),
  ('report.view',           'View reports'),
  ('report.export',         'Export reports and data (PDF / Excel / CSV)'),
  ('employee.view',         'Search employees / hosts'),
  ('employee.manage',       'Create and modify employees / hosts'),
  ('company.view',          'Search companies'),
  ('company.create',        'Add new companies during registration'),
  ('company.manage',        'Manage the company directory'),
  ('master.manage',         'Manage departments, categories, purposes and access areas'),
  ('settings.manage',       'Manage system settings and print templates'),
  ('user.manage',           'Manage user accounts'),
  ('audit.view',            'View audit logs'),
  ('retention.manage',      'Configure and run data retention');

-- Super Administrator: every permission.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'SUPER_ADMIN';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
  'dashboard.view', 'dashboard.analytics', 'visitor.view', 'visitor.create', 'visitor.update',
  'visitor.watchlist.view', 'visit.view_all', 'visit.create', 'visit.checkin', 'visit.checkout',
  'visit.cancel', 'visit.approve_any', 'prereg.any', 'pass.print', 'onpremises.view', 'emergency.view',
  'report.view', 'employee.view', 'employee.manage', 'company.view', 'company.create', 'company.manage',
  'security.verify'
]) WHERE r.code = 'ADMIN';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
  'dashboard.view', 'visitor.view', 'visitor.create', 'visitor.update', 'visitor.watchlist.view',
  'visit.view_all', 'visit.create', 'visit.checkin', 'visit.checkout', 'visit.cancel', 'prereg.any',
  'pass.print', 'onpremises.view', 'emergency.view', 'employee.view', 'company.view', 'company.create'
]) WHERE r.code = 'RECEPTION';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
  'dashboard.view', 'visitor.view', 'visitor.watchlist.view', 'visit.view_all', 'visit.checkin',
  'visit.checkout', 'security.verify', 'onpremises.view', 'emergency.view', 'employee.view', 'company.view'
]) WHERE r.code = 'SECURITY';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
  'dashboard.view', 'visit.view_own', 'visit.approve_own', 'prereg.own', 'company.view', 'company.create'
]) WHERE r.code = 'HOST';

INSERT INTO visitor_categories (code, name, requires_approval, requires_id, roll_call_group, sort_order) VALUES
  ('GUEST',        'Guest',                FALSE, FALSE, 'VISITOR',    10),
  ('BUSINESS',     'Business Visitor',     FALSE, FALSE, 'VISITOR',    20),
  ('VENDOR',       'Vendor',               FALSE, FALSE, 'VISITOR',    30),
  ('CONTRACTOR',   'Contractor',           FALSE, TRUE,  'CONTRACTOR', 40),
  ('CONSULTANT',   'Consultant',           FALSE, FALSE, 'VISITOR',    50),
  ('GOVT',         'Government Official',  FALSE, FALSE, 'VISITOR',    60),
  ('INTERVIEW',    'Interview Candidate',  FALSE, TRUE,  'VISITOR',    70),
  ('DELIVERY',     'Delivery Personnel',   FALSE, FALSE, 'SERVICE',    80),
  ('SERVICE',      'Service Personnel',    FALSE, TRUE,  'SERVICE',    90),
  ('STAFF',        'Staff – Other Office', FALSE, FALSE, 'EMPLOYEE',   95),
  ('OTHER',        'Other',                FALSE, FALSE, 'VISITOR',   100);

INSERT INTO purposes (code, name, requires_specify, sort_order) VALUES
  ('OFFICIAL_MEETING',   'Official Meeting',           FALSE,  10),
  ('BUSINESS_MEETING',   'Business Meeting',           FALSE,  20),
  ('VENDOR_VISIT',       'Vendor Visit',               FALSE,  30),
  ('SERVICE',            'Service / Maintenance',      FALSE,  40),
  ('DELIVERY',           'Delivery',                   FALSE,  50),
  ('INTERVIEW',          'Interview',                  FALSE,  60),
  ('TRAINING',           'Training',                   FALSE,  70),
  ('CONSULTATION',       'Consultation',               FALSE,  80),
  ('GOVT_VISIT',         'Government Official Visit',  FALSE,  90),
  ('PERSONAL',           'Personal Visit',             FALSE, 100),
  ('DOC_SUBMISSION',     'Document Submission',        FALSE, 110),
  ('DOC_COLLECTION',     'Document Collection',        FALSE, 120),
  ('INSPECTION',         'Inspection',                 FALSE, 130),
  ('AUDIT',              'Audit',                      FALSE, 140),
  ('OTHER',              'Other',                      TRUE,  999);

INSERT INTO access_areas (code, name, is_restricted, requires_approval, sort_order) VALUES
  ('RECEPTION',     'Reception',          FALSE, FALSE, 10),
  ('ADMINISTRATION','Administration',     FALSE, FALSE, 20),
  ('FIRST_FLOOR',   'First Floor',        FALSE, FALSE, 30),
  ('CONFERENCE',    'Conference Room',    FALSE, FALSE, 40),
  ('RESTRICTED',    'Restricted Area',    TRUE,  TRUE,  50),
  ('SERVER_ROOM',   'Server Room',        TRUE,  TRUE,  60),
  ('OTHER',         'Other',              FALSE, FALSE, 99);

INSERT INTO id_types (code, name, sort_order) VALUES
  ('GOVT_ID',     'Government ID',   10),
  ('PASSPORT',    'Passport',        20),
  ('DRIVING',     'Driving Licence', 30),
  ('EMPLOYEE_ID', 'Employee ID',     40),
  ('OFFICIAL_ID', 'Official ID',     50),
  ('OTHER',       'Other',           99);

INSERT INTO system_settings (key, value, description) VALUES
('organisation', '{
  "name": "Organisation Name",
  "shortName": "ORG",
  "address": "",
  "phone": "",
  "email": "",
  "website": "",
  "footerText": "This document is generated electronically by the Visitor Management System.",
  "logoFileId": null,
  "receptionPoint": "Main Entrance",
  "timezone": "Asia/Kolkata",
  "defaultCountryCode": "+91"
}', 'Organisation identity, branding and locale'),
('visitor', '{
  "defaultDurationMinutes": 60,
  "maxDurationMinutes": 480,
  "overstayGraceMinutes": 15,
  "requireApprovalForWalkIns": false,
  "idNumberStorage": "MASKED",
  "requiredFields": {
    "email": false,
    "company": true,
    "designation": false,
    "idType": false,
    "idNumber": false,
    "photo": false,
    "category": true,
    "accessArea": false,
    "declaration": true
  },
  "declarationText": "I confirm that the information provided by me is accurate and that I will comply with the applicable visitor and security procedures of the organisation.",
  "declarationVersion": "1.0"
}', 'Visitor registration rules'),
('notification', '{
  "inApp": true,
  "email": { "enabled": false, "fromAddress": "" },
  "sms": { "enabled": false, "provider": "" },
  "whatsapp": { "enabled": false, "provider": "" },
  "overstay": { "reception": true, "security": true, "host": true, "admin": false },
  "restrictedAlert": { "security": true, "admin": true }
}', 'Host and alert notification channels'),
('security', '{
  "sessionTimeoutMinutes": 30,
  "absoluteSessionHours": 12,
  "passwordMinLength": 10,
  "passwordRequireComplexity": true,
  "maxLoginAttempts": 5,
  "lockoutMinutes": 15,
  "showContactOnEmergencyList": true,
  "maskMobileInPrint": true
}', 'Authentication and privacy controls'),
('retention', '{
  "archiveVisitorsAfterDays": 730,
  "anonymiseVisitorsAfterDays": 1825,
  "deletePhotosAfterDays": 365,
  "deleteUnattachedUploadsAfterHours": 24
}', 'Data retention policy');

INSERT INTO print_templates (code, name, config) VALUES
('VISITOR_PASS', 'Visitor Pass (Badge)', '{
  "widthMm": 90,
  "heightMm": 60,
  "paper": "BADGE",
  "showPhoto": true,
  "showQr": true,
  "headerColor": "#12305a",
  "instruction": "This pass must be displayed prominently while on the premises and returned at the time of departure."
}'),
('HALF_A4_RECORD', 'Visitor Record (Half-A4)', '{
  "copies": ["Office Copy", "Visitor Copy"],
  "showPhoto": true,
  "showQr": true,
  "showSignatures": true,
  "title": "VISITOR RECORD"
}');

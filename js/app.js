/* ==========================================================================
   COLLEGE COMPUTER MAINTENANCE SYSTEM (CCMS)
   Enterprise Role-Based Access Control & Maintenance Workflow
   ========================================================================== */

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const E = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const K = 'ccms_v2';
let T = null;
let D = null;
let CURRENT_USER = null;
let FM = null;
let TR = '';
let F = {};
let Q = {};
let PRE = null;

const now = () => T || new Date().toISOString();
const dn = n => new Date(Date.now() - n * 864e5).toISOString();
const fd = d => d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const fdd = d => d ? new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '';

/* Status and Priority colors */
const SC = {
  'Reported': '#64748b',
  'Assigned': '#6366f1',
  'Diagnosing': '#f59e0b',
  'Diagnosed': '#14b8a6',
  'Under Repair': '#f97316',
  'Technician Completed': '#0284c7',
  'Awaiting Faculty Verification': '#d97706',
  'Resolved': '#16a34a',
  'Not Corrected': '#dc2626',
  'Reported to Admin': '#b91c1c',
  'Admin Action Required': '#991b1b',
  'Reassigned': '#8b5cf6',
  'Escalated': '#dc2626',
  'Overdue': '#7f1d1d'
};

const PC = {
  'Low': '#64748b',
  'Medium': '#0ea5e9',
  'High': '#f97316',
  'Critical': '#dc2626'
};

const CATS = [
  'Hardware', 'Software', 'Network', 'Keyboard', 'Mouse', 'Monitor',
  'CPU', 'RAM', 'Storage', 'Printer', 'Operating System', 'Application',
  'Internet', 'Power Supply', 'Other'
];

const PR = ['Low', 'Medium', 'High', 'Critical'];

const op = a => a.map(o => Array.isArray(o) ? `<option value="${o[0]}">${o[1]}</option>` : `<option value="${o}">${o}</option>`).join('');

/* Domain lookups */
const U_ = id => D.users.find(u => u.id == id);
const C_ = id => D.comps.find(c => c.id == id);
const L_ = id => D.labs.find(l => l.id == id);
const I_ = id => D.issues.find(i => i.id == id);
const me = () => CURRENT_USER;
const unm = id => U_(id)?.name || '';
const lab = i => L_(C_(i.cid)?.lab);

let saveInFlight = false;
const api = async (path, options = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const csrf = document.cookie.match(/(?:^|;\s*)ccms_csrf=([^;]+)/);
  if (csrf && options.method && options.method != 'GET') headers['X-CSRF-Token'] = decodeURIComponent(csrf[1]);
  const res = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
};
const notify = (message, type = 'info') => {
  const box = $('#app');
  if (!box) return;
  const existing = box.querySelector('.alert');
  if (existing) existing.remove();
  const node = document.createElement('div');
  node.className = `alert ${type == 'error' ? 'alert-danger' : 'alert-success'}`;
  node.setAttribute('role', 'status');
  node.textContent = message;
  box.prepend(node);
};
const save = async () => {
  if (!D || saveInFlight) return;
  saveInFlight = true;
  try {
    const result = await api('/api/sync', { method: 'POST', body: JSON.stringify({ data: D }) });
    D = result.data;
  } catch (err) {
    notify(err.message, 'error');
  } finally {
    saveInFlight = false;
  }
};
const go = p => { location.hash = '#/' + p; };

const od = i => i.status != 'Resolved' && (Date.now() - new Date(i.created)) / 864e5 > D.set.overdue;

const bd = (t, c) => `<span class="bd" style="background:${c}">${t}</span>`;
const sb = i => bd(i.status, SC[i.status] || '#64748b') + (od(i) ? ' ' + bd('Overdue', SC.Overdue) : '');
const pb = p => bd(p, PC[p] || '#64748b');

/* Simplified status for Student view (Section 16) */
function studentStatus(s) {
  if (s == 'Reported' || s == 'Recorded') return 'Reported';
  if (['Assigned', 'Diagnosing', 'Diagnosed', 'Under Repair', 'Reassigned'].includes(s)) return 'Under Maintenance';
  if (['Technician Completed', 'Awaiting Faculty Verification', 'Not Corrected', 'Reported to Admin', 'Admin Action Required'].includes(s)) return 'Awaiting Verification';
  if (s == 'Resolved') return 'Resolved';
  return s;
}

function studentBadge(i) {
  const ss = studentStatus(i.status);
  const colorMap = {
    'Reported': '#64748b',
    'Under Maintenance': '#f97316',
    'Awaiting Verification': '#d97706',
    'Resolved': '#16a34a'
  };
  return bd(ss, colorMap[ss] || '#64748b');
}

/* Charts and statistics helpers */
const bars = o => {
  const entries = Object.entries(o);
  if (!entries.length) return '<p class="mut">No data available</p>';
  const max = Math.max(1, ...Object.values(o));
  return entries.map(([k, v]) => `
    <div class="br">
      <span>${E(k)}</span>
      <i><b style="width:${(v / max * 100).toFixed(1)}%"></b></i>
      <em>${v}</em>
    </div>
  `).join('');
};

const cnt = (l, f) => l.reduce((o, x) => {
  const k = f(x);
  if (k != null) o[k] = (o[k] || 0) + 1;
  return o;
}, {});

const resDays = i => {
  const end = i.status == 'Resolved' ? new Date(i.log[i.log.length - 1].d) : new Date();
  return Math.max(0.1, (end - new Date(i.created)) / 864e5);
};

/* ==========================================================================
   ROLE-BASED NOTIFICATION SYSTEM (Section 15)
   ========================================================================== */

function nt(uid, iid, msg, action = 'Inspect / Review complaint', status = '') {
  if (!uid) return;
  const i = I_(iid);
  D.notes.unshift({
    id: 'nt_' + Math.random().toString(36).slice(2, 9),
    uid: uid,
    iid: iid,
    cid: i ? i.cid : '',
    issue: i ? i.title : 'Maintenance Update',
    action: action,
    status: status || (i ? i.status : 'Active'),
    msg: msg,
    date: now(),
    read: 0
  });
}

function nta(iid, msg, action = 'Admin Action Required', status = 'Admin Action Required') {
  D.users.filter(u => u.role == 'Admin').forEach(u => nt(u.id, iid, msg, action, status));
}

function setS(i, s, m, authorName = '') {
  i.status = s;
  i.updated = now();
  const entry = authorName ? `${authorName}: ${m}` : m;
  i.log.push({ d: i.updated, s, m: entry });
}

const setC = (cid, s) => {
  const c = C_(cid);
  if (c) c.status = s;
};

function hist(i, w, r, p, techWho = '') {
  D.hist.push({
    cid: i.cid,
    iid: i.id,
    tech: techWho || i.tech,
    date: now(),
    problem: i.title,
    diag: i.diag?.text || '',
    work: w,
    parts: p || '',
    status: i.status,
    remarks: r || ''
  });
  const c = C_(i.cid);
  if (c) c.last = now().slice(0, 10);
}

function odChk() {
  if (!D) return;
  let ch = 0;
  D.issues.forEach(i => {
    if (od(i) && !i.odn) {
      i.odn = 1;
      ch = 1;
      nta(i.id, `Complaint ${i.id} on ${i.cid} is overdue.`, 'Expedite technician resolution', 'Overdue');
      if (i.tech) nt(i.tech, i.id, `Complaint ${i.id} on ${i.cid} is overdue.`, 'Immediate repair required', 'Overdue');
    }
  });
  if (ch) save();
}

/* ==========================================================================
   SEED DATA & INITIAL SETUP
   ========================================================================== */

function seed() {
  const us = [
    { id: 'stu', name: 'Arun Kumar', email: 'student@college.edu', role: 'Student', dept: 'CSBS' },
    { id: 'fac', name: 'Dr. Meena S', email: 'faculty@college.edu', role: 'Faculty', dept: 'CSE' },
    { id: 't1', name: 'Ravi Shankar', email: 'tech@college.edu', role: 'Technician', dept: 'IT Support' },
    { id: 't2', name: 'Suresh Babu', email: 'tech2@college.edu', role: 'Technician', dept: 'IT Support' },
    { id: 'adm', name: 'Prof. Lakshmi (HOD)', email: 'admin@college.edu', role: 'Admin', dept: 'Administration' }
  ];

  const ls = [
    { id: 'LAB-01', name: 'Computer Science Laboratory', bld: 'Block A', room: '101', tech: 't1', faculty: 'fac' },
    { id: 'LAB-02', name: 'Networks Laboratory', bld: 'Block A', room: '102', tech: 't2', faculty: 'fac' },
    { id: 'LAB-03', name: 'Programming Laboratory', bld: 'Block B', room: '201', tech: 't1', faculty: 'fac' }
  ];

  const cs = [];
  ls.forEach((l, k) => {
    for (let n = 1; n <= 6; n++) {
      cs.push({
        id: `LAB0${k + 1}-PC0${n}`,
        serial: `SN${4100 + k * 10 + n}`,
        lab: l.id,
        name: `CSL${k + 1}-${n}`,
        cpu: ['Intel Core i5-12400', 'Intel Core i7-12700', 'AMD Ryzen 5 5600'][k],
        ram: ['16 GB DDR4', '32 GB DDR4', '16 GB DDR4'][k],
        disk: '512 GB NVMe SSD',
        os: k == 1 ? 'Ubuntu 22.04 LTS' : 'Windows 11 Pro',
        status: 'Working',
        purchase: `202${2 + k}-07-01`,
        warranty: `202${5 + k}-07-01`,
        last: ''
      });
    }
  });

  D = {
    users: us,
    labs: ls,
    comps: cs,
    issues: [],
    hist: [],
    notes: [],
    seq: 0,
    set: { overdue: 7 }
  };

  /* Helper to add realistic demo complaints */
  const addDemoIssue = (uid, cid, cat, title, desc, pri, daysAgo, techId, setupFn) => {
    const t0 = dn(daysAgo);
    const i = {
      id: `CMP-2026-${String(++D.seq).padStart(4, '0')}`,
      uid: uid,
      cid: cid,
      cat: cat,
      title: title,
      desc: desc,
      pri: pri,
      status: 'Reported',
      created: t0,
      updated: t0,
      tech: techId,
      diag: null,
      repair: null,
      verification: null,
      adminAction: null,
      esc: null,
      log: [{ d: t0, s: 'Reported', m: 'Issue reported by ' + U_(uid).name }],
      img: null
    };
    D.issues.push(i);
    if (setupFn) setupFn(i, t0, daysAgo);
    return i;
  };

  /* 1. Fully Resolved Complaint (Student Arun, verified by Faculty Dr. Meena) */
  addDemoIssue('stu', 'LAB01-PC01', 'Keyboard', 'Keyboard keys sticking', 'Several keys in the numeric keypad are unresponsive.', 'Low', 12, 't1', (i, t0, dAgo) => {
    const t1 = dn(dAgo - 1);
    i.tech = 't1';
    setS(i, 'Assigned', 'Assigned to Ravi Shankar');
    i.log[i.log.length - 1].d = t1;
    const t2 = dn(dAgo - 2);
    i.diag = { text: 'Key membrane worn out and debris under keys', result: 'Diagnosed', date: t2, tech: 't1' };
    setS(i, 'Diagnosed', 'Diagnosed: Key membrane worn out');
    i.log[i.log.length - 1].d = t2;
    const t3 = dn(dAgo - 3);
    i.repair = { desc: 'Replaced with new mechanical USB keyboard', parts: 'USB Keyboard Standard', remarks: 'Tested all keys OK', date: t3, tech: 't1', result: 'Issue Corrected' };
    setS(i, 'Technician Completed', 'Technician marked Issue Corrected: Replaced keyboard');
    i.log[i.log.length - 1].d = t3;
    const t4 = dn(dAgo - 4);
    i.verification = { who: 'fac', name: 'Dr. Meena S', date: t4, time: '11:20 AM', result: 'Corrected', remarks: 'Inspected lab machine. New keyboard works smoothly.' };
    setS(i, 'Resolved', 'Verified and Resolved by Faculty Dr. Meena S');
    i.log[i.log.length - 1].d = t4;
    hist(i, 'Replaced keyboard', 'Faculty verified working', 'USB Keyboard', 't1');
  });

  /* 2. Issue Currently Under Repair (Technician Ravi Shankar) */
  addDemoIssue('stu', 'LAB01-PC02', 'CPU', 'System not powering on', 'Computer shuts down immediately after pressing power button.', 'High', 3, 't1', (i, t0, dAgo) => {
    const t1 = dn(dAgo - 0.5);
    i.tech = 't1';
    setS(i, 'Assigned', 'Assigned to Ravi Shankar');
    i.log[i.log.length - 1].d = t1;
    const t2 = dn(dAgo - 1);
    i.diag = { text: 'Faulty SMPS 450W power supply unit detected', result: 'Diagnosed', date: t2, tech: 't1' };
    setS(i, 'Under Repair', 'Repair started: Replacing SMPS power unit');
    i.log[i.log.length - 1].d = t2;
    setC('LAB01-PC02', 'Under Maintenance');
  });

  /* 3. Issue Awaiting Faculty Verification (Technician finished -> Dr. Meena must verify!) */
  addDemoIssue('stu', 'LAB01-PC03', 'RAM', 'System random blue screen reboot', 'System crashes with memory management BSOD error.', 'High', 2, 't1', (i, t0, dAgo) => {
    i.tech = 't1';
    setS(i, 'Assigned', 'Assigned to Ravi Shankar');
    const t2 = dn(dAgo - 0.8);
    i.diag = { text: 'Defective RAM module in Slot 2', result: 'Diagnosed', date: t2, tech: 't1' };
    setS(i, 'Diagnosed', 'Diagnosed: Bad RAM stick');
    i.log[i.log.length - 1].d = t2;
    const t3 = dn(dAgo - 1.2);
    i.repair = { desc: 'Replaced defective 16GB DDR4 module with tested Corsair stick', parts: '16GB DDR4 RAM Module', remarks: 'Ran MemTest86 for 3 passes. Zero errors.', date: t3, tech: 't1', result: 'Issue Corrected' };
    setS(i, 'Awaiting Faculty Verification', 'Technician completed repair. Awaiting Faculty Verification.');
    i.log[i.log.length - 1].d = t3;
  });

  /* 4. Issue with Faculty Verification Failed -> Reported to Admin! (Admin action required) */
  addDemoIssue('fac', 'LAB02-PC01', 'Monitor', 'Display flickering continuously', 'Screen turns black every 30 seconds during lab sessions.', 'Critical', 5, 't2', (i, t0, dAgo) => {
    i.tech = 't2';
    setS(i, 'Assigned', 'Assigned to Suresh Babu');
    const t2 = dn(dAgo - 1);
    i.diag = { text: 'Loose HDMI connector cable', result: 'Diagnosed', date: t2, tech: 't2' };
    i.repair = { desc: 'Replaced HDMI cable with new shielded cable', parts: 'HDMI 2.0 Cable', remarks: 'Tested OK at idle', date: t2, tech: 't2', result: 'Issue Corrected' };
    setS(i, 'Awaiting Faculty Verification', 'Technician completed repair');
    i.log[i.log.length - 1].d = t2;
    const t3 = dn(dAgo - 2);
    i.verification = { who: 'fac', name: 'Dr. Meena S', date: t3, time: '02:45 PM', result: 'Not Corrected', remarks: 'Flickering still occurs once GPU temperature rises. Screen still blanking out.' };
    setS(i, 'Reported to Admin', 'Faculty verified: Issue Not Corrected. Reported to Admin for re-inspection / escalation.');
    i.log[i.log.length - 1].d = t3;
    setC('LAB02-PC01', 'Faulty');
  });

  /* 5. Assigned Issue (Technician Suresh Babu) */
  addDemoIssue('stu', 'LAB02-PC02', 'Internet', 'Ethernet port not obtaining IP address', 'Network cable is plugged in but showing No Internet Access.', 'Medium', 1, 't2', (i, t0, dAgo) => {
    i.tech = 't2';
    setS(i, 'Assigned', 'Assigned to Suresh Babu for network diagnosis');
  });

  /* 6. Newly Reported Issue by Student */
  addDemoIssue('stu', 'LAB03-PC01', 'Mouse', 'Left click button not responding', 'Optical mouse left button is completely unresponsive.', 'Low', 0.2, null, (i) => {
    // freshly reported
  });

  /* Notifications */
  D.notes = [
    {
      id: 'n1',
      uid: 'stu',
      iid: 'CMP-2026-0001',
      cid: 'LAB01-PC01',
      issue: 'Keyboard keys sticking',
      action: 'Verified and Resolved',
      status: 'Resolved',
      msg: 'Your computer maintenance complaint CMP-2026-0001 has been verified and resolved by Faculty Dr. Meena S.',
      date: dn(8),
      read: 1
    },
    {
      id: 'n2',
      uid: 'stu',
      iid: 'CMP-2026-0003',
      cid: 'LAB01-PC03',
      issue: 'System random blue screen reboot',
      action: 'Awaiting Faculty Verification',
      status: 'Awaiting Faculty Verification',
      msg: 'Technician Ravi Shankar has completed repair on CMP-2026-0003. Awaiting faculty verification.',
      date: dn(1),
      read: 0
    },
    {
      id: 'n3',
      uid: 'fac',
      iid: 'CMP-2026-0003',
      cid: 'LAB01-PC03',
      issue: 'System random blue screen reboot',
      action: 'Verification Required',
      status: 'Awaiting Faculty Verification',
      msg: 'Technician has completed work on CMP-2026-0003. Please verify whether the issue has been corrected.',
      date: dn(1),
      read: 0
    },
    {
      id: 'n4',
      uid: 't1',
      iid: 'CMP-2026-0002',
      cid: 'LAB01-PC02',
      issue: 'System not powering on',
      action: 'Repair in Progress',
      status: 'Under Repair',
      msg: 'Complaint CMP-2026-0002 in Computer Science Laboratory has been assigned to you.',
      date: dn(2.5),
      read: 0
    },
    {
      id: 'n5',
      uid: 'adm',
      iid: 'CMP-2026-0004',
      cid: 'LAB02-PC01',
      issue: 'Display flickering continuously',
      action: 'Admin Action Required',
      status: 'Reported to Admin',
      msg: 'Faculty Dr. Meena S reported that CMP-2026-0004 was not correctly resolved. Reason: Flickering still occurs once GPU temperature rises. Admin action required.',
      date: dn(1.8),
      read: 0
    }
  ];

  save();
  return D;
}

/* Data is loaded from the authenticated same-origin API. */

/* ==========================================================================
   ROLE-BASED AUTHORIZATION & NAVIGATION MATRIX (Section 19 & 20)
   ========================================================================== */

const ROLE_MENUS = {
  Student: [
    { id: 'dashboard', label: 'Dashboard', icon: '' },
    { id: 'report', label: 'Report Issue', icon: '' },
    { id: 'issues', label: 'My Issues', icon: '' },
    { id: 'notes', label: 'Notifications', icon: '' },
    { id: 'settings', label: 'Profile', icon: '' }
  ],
  Technician: [
    { id: 'dashboard', label: 'Dashboard', icon: '' },
    { id: 'issues', label: 'Assigned Issues', icon: '' },
    { id: 'updates', label: 'Issue Updates', icon: '' },
    { id: 'notes', label: 'Notifications', icon: '' },
    { id: 'settings', label: 'Profile', icon: '' }
  ],
  Faculty: [
    { id: 'dashboard', label: 'Dashboard', icon: '' },
    { id: 'verify', label: 'Issues to Verify', icon: '' },
    { id: 'verified', label: 'Verified Issues', icon: '' },
    { id: 'notes', label: 'Notifications', icon: '' },
    { id: 'settings', label: 'Profile', icon: '' }
  ],
  Admin: [
    { id: 'dashboard', label: 'Dashboard', icon: '' },
    { id: 'issues', label: 'All Issues', icon: '' },
    { id: 'users', label: 'Users', icon: '' },
    { id: 'students', label: 'Students', icon: '' },
    { id: 'faculty', label: 'Faculty', icon: '' },
    { id: 'technicians', label: 'Technicians', icon: '' },
    { id: 'computers', label: 'Computers', icon: '' },
    { id: 'labs', label: 'Laboratories', icon: '' },
    { id: 'maint', label: 'Maintenance', icon: '' },
    { id: 'escalations', label: 'Escalations', icon: '' },
    { id: 'notes', label: 'Notifications', icon: '' },
    { id: 'reports', label: 'Reports', icon: '' },
    { id: 'analytics', label: 'Analytics', icon: '' },
    { id: 'settings', label: 'Settings', icon: '' }
  ]
};

function canAccessPage(page, role) {
  const allowed = {
    Student: ['dashboard', 'report', 'issues', 'notes', 'settings'],
    Technician: ['dashboard', 'issues', 'updates', 'notes', 'settings'],
    Faculty: ['dashboard', 'verify', 'verified', 'notes', 'settings'],
    Admin: [
      'dashboard', 'issues', 'users', 'students', 'faculty', 'technicians',
      'computers', 'labs', 'maint', 'escalations', 'notes', 'reports', 'analytics', 'settings'
    ]
  };
  return (allowed[role] || []).includes(page);
}

function canViewIssue(i, u) {
  if (!i || !u) return false;
  if (u.role == 'Admin') return true;
  if (u.role == 'Student') return i.uid == u.id;
  if (u.role == 'Technician') return i.tech == u.id;
  if (u.role == 'Faculty') {
    const l = lab(i);
    return i.uid == u.id || l?.faculty == u.id || ['Awaiting Faculty Verification', 'Technician Completed', 'Not Corrected', 'Reported to Admin', 'Resolved'].includes(i.status);
  }
  return false;
}

function scopeIssues() {
  const u = me();
  if (!u) return [];
  if (u.role == 'Admin') return D.issues;
  if (u.role == 'Student') return D.issues.filter(i => i.uid == u.id);
  if (u.role == 'Technician') return D.issues.filter(i => i.tech == u.id);
  if (u.role == 'Faculty') {
    return D.issues.filter(i => {
      const l = lab(i);
      return i.uid == u.id || l?.faculty == u.id;
    });
  }
  return [];
}

/* ==========================================================================
   UI SHELL & MODAL HELPERS
   ========================================================================== */

const modal = h => {
  $('#mc').innerHTML = '<button class="x sm" onclick="cm()"></button>' + h;
  $('#md').style.display = 'flex';
};
const cm = () => { $('#md').style.display = 'none'; };

function shell(page, contentHtml) {
  const u = me();
  const unreadCount = D.notes.filter(n => n.uid == u.id && !n.read).length;
  const menuList = ROLE_MENUS[u.role] || [];
  const currentItem = menuList.find(m => m.id == page) || { label: 'Dashboard' };

  return `
    <aside class="side">
      <div class="lg"> <b>CCMS Portal</b></div>
      <div style="padding:4px 12px 14px;font-size:11px;color:#93c5fd;text-transform:uppercase;letter-spacing:1px">
        ${u.role} Workspace
      </div>
      ${menuList.map(item => `
        <a class="${item.id == page ? 'on' : ''}" onclick="go('${item.id}')">
          ${item.icon} ${item.label}
          ${item.id == 'notes' && unreadCount ? `<span style="float:right;background:var(--r);color:#fff;border-radius:10px;padding:0 6px;font-size:11px">${unreadCount}</span>` : ''}
          ${item.id == 'verify' && u.role == 'Faculty' ? (() => {
            const vCnt = D.issues.filter(i => ['Awaiting Faculty Verification', 'Technician Completed'].includes(i.status)).length;
            return vCnt ? `<span style="float:right;background:var(--o);color:#fff;border-radius:10px;padding:0 6px;font-size:11px">${vCnt}</span>` : '';
          })() : ''}
        </a>
      `).join('')}
      <a onclick="out()" style="margin-top:20px;border-top:1px solid #3b82f644;padding-top:12px"> Logout</a>
    </aside>

    <div class="mn">
      <header>
        <button class="hb" onclick="document.body.classList.toggle('nav')"></button>
        <h2>${currentItem.label}</h2>
        <span class="sp"></span>
        <a class="bell" onclick="go('notes')" title="Notifications">
          ${unreadCount ? `<sup>${unreadCount}</sup>` : ''}
        </a>
        <span class="who">
          <b>${E(u.name)}</b> <small>(${u.role}${u.dept ? '  ' + E(u.dept) : ''})</small>
        </span>
      </header>
      <main>${contentHtml}</main>
    </div>
  `;
}

function renderAccessDenied() {
  return `
    <div class="card" style="text-align:center;padding:50px 20px">
      <div style="font-size:54px;margin-bottom:12px"></div>
      <h2 style="color:var(--r);margin-bottom:8px">Access Denied</h2>
      <p class="mut" style="max-width:480px;margin:0 auto 20px">
        You do not have administrative or role-level permissions to access this page or resource.
      </p>
      <button class="btn pb" onclick="go('dashboard')">Return to My Dashboard</button>
    </div>
  `;
}

const out = async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch (_) {}
  CURRENT_USER = null;
  D = null;
  go('home');
};

async function li(e) {
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return false;
  button.disabled = true;
  button.textContent = 'Signing in...';
  const error = form.querySelector('.form-error');
  error.textContent = '';
  const f = Object.fromEntries(new FormData(e.target));
  const id = f.id.trim().toLowerCase();
  try {
    const result = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: id, password: f.pw, remember: !!f.rm })
    });
    CURRENT_USER = result.user;
    D = result.data;
    go('dashboard');
  } catch (err) {
    error.textContent = err.message || 'Unable to sign in.';
    button.disabled = false;
    button.textContent = 'Sign In';
  }
  return false;
}

async function restoreSession() {
  try {
    const result = await api('/api/session');
    CURRENT_USER = result.user;
    D = result.data;
  } catch (_) {
    CURRENT_USER = null;
    D = null;
  }
  render();
}

function togglePassword() {
  const input = $('#login_password');
  const button = $('#password_toggle');
  if (!input || !button) return;
  input.type = input.type == 'password' ? 'text' : 'password';
  button.textContent = input.type == 'password' ? 'Show' : 'Hide';
}

const home = () => `
  <div class="lp">
    <nav>
      <b> CCMS</b>
      <span class="sp"></span>
      <a class="btn" onclick="go('login')">Login</a>
    </nav>
    <section class="hero">
      <h1>College Computer Maintenance System</h1>
      <h3>Role-Based Equipment Maintenance & Verification Platform</h3>
      <p>Seamlessly interconnecting Students, Technicians, Faculty Verification Authorities, and Administration.</p>
      <button class="pb" onclick="go('login')">Report an Issue</button> 
      <button class="ob" onclick="go('login')">Login to Portal</button>
    </section>
    <section class="g4">
      <div><b></b><h3>Student Reporting</h3><p class="mut">Report malfunctioning lab computers and track resolution live.</p></div>
      <div><b></b><h3>Technician Dispatch</h3><p class="mut">Inspect, diagnose, and execute repairs with parts logging.</p></div>
      <div><b></b><h3>Faculty Verification</h3><p class="mut">Laboratory verification authority confirms actual machine readiness.</p></div>
      <div><b></b><h3>Admin Supervision</h3><p class="mut">College-wide visibility, reassignment, and overdue escalation.</p></div>
    </section>
    <footer style="text-align:center;padding:24px" class="mut">
       College Computer Maintenance System  Secure Educational Institution Infrastructure
    </footer>
  </div>
`;

const login = () => `
  <div class="lg2">
    <form class="card" onsubmit="return li(event)">
      <div class="logo" aria-hidden="true">CC</div>
      <h2 style="text-align:center;margin:8px 0 4px">CCMS Portal Login</h2>
      <p class="mut" style="text-align:center;margin:0 0 16px;font-size:12px">Sign in with your role-based account</p>

      <label>Email / User ID
        <input name="id" id="login_id" autocomplete="username" placeholder="e.g. student@college.edu" required>
      </label>

      <label>Password
        <div class="password-field">
          <input name="pw" id="login_password" type="password" autocomplete="current-password" required>
          <button type="button" class="sm gr" id="password_toggle" onclick="togglePassword()">Show</button>
        </div>
      </label>

      <div class="row">
        <label class="ck"><input type="checkbox" name="rm"> Remember me</label>
        <span class="sp"></span>
        <span class="mut" title="Password recovery is handled by college administration.">Contact your administrator for account recovery.</span>
      </div>

      <button type="submit" class="pb" style="margin-top:6px">Sign In</button>
      <div class="form-error" role="alert" aria-live="polite"></div>

      <div class="box" style="background:#f8fafc;font-size:12px;margin-top:14px">
        <b>Local demonstration accounts</b>
        <div style="margin-top:6px;line-height:1.7">
          Use the account details documented in README. Select the account by email; roles are assigned by the server.
        </div>
      </div>
      <a onclick="go('home')" style="text-align:center;display:block;margin-top:8px"> Back to home</a>
    </form>
  </div>
`;

/* ==========================================================================
   ROLE-SPECIFIC DASHBOARDS (Section 4, 6, 8, 12)
   WORKFLOW DIAGRAM COMPLETELY REMOVED FROM ALL DASHBOARDS (Section 1)
   ========================================================================== */

/* 1. STUDENT DASHBOARD (Section 4) */
function renderStudentDashboard(u) {
  const myIssues = D.issues.filter(i => i.uid == u.id);
  const openCount = myIssues.filter(i => i.status != 'Resolved').length;
  const pendingCount = myIssues.filter(i => ['Reported', 'Recorded', 'Assigned'].includes(i.status)).length;
  const resolvedCount = myIssues.filter(i => i.status == 'Resolved').length;

  return `
    <div class="card" style="background:linear-gradient(135deg, #1e3a8a, #2563eb);color:#fff">
      <h2>Welcome, ${E(u.name)}!</h2>
      <p style="margin:4px 0 0;opacity:0.9">Student Portal  Department of ${E(u.dept)}</p>
    </div>

    <!-- Student Stat Cards: ONLY 3 cards (Section 4) -->
    <div class="cards">
      <div class="st" style="--c:#0ea5e9">
        <b>${openCount}</b>My Open Issues
      </div>
      <div class="st" style="--c:#f59e0b">
        <b>${pendingCount}</b>My Pending Issues
      </div>
      <div class="st" style="--c:#16a34a">
        <b>${resolvedCount}</b>My Resolved Issues
      </div>
    </div>

    <!-- Prominent Report Issue Button (Section 4) -->
    <div style="margin:20px 0 16px">
      <button class="btn btn-lg pb" onclick="go('report')" style="box-shadow:0 4px 12px rgba(245,158,11,0.35);font-size:15px">
         Report Computer Issue
      </button>
    </div>

    <!-- Student My Recent Issues Table (Section 4) -->
    <div class="card">
      <div class="row">
        <h3>My Recent Issues</h3>
        <span class="sp"></span>
        <button class="sm" onclick="go('issues')">View All My Issues </button>
      </div>

      ${myIssues.length ? `
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>Complaint ID</th>
                <th>Computer ID</th>
                <th>Issue</th>
                <th>Date Reported</th>
                <th>Status</th>
                <th>Last Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${myIssues.slice().sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 6).map(i => `
                <tr class="cl" onclick="show('${i.id}')">
                  <td><b>${i.id}</b></td>
                  <td>${i.cid}</td>
                  <td>${E(i.title)}</td>
                  <td>${fdd(i.created)}</td>
                  <td>${studentBadge(i)}</td>
                  <td>${fdd(i.updated)}</td>
                  <td><button class="sm" onclick="event.stopPropagation();show('${i.id}')">View Status</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <p class="mut" style="padding:16px 0">You haven't reported any computer issues yet.</p>
      `}
    </div>
  `;
}

/* 2. TECHNICIAN DASHBOARD (Section 6) */
function renderTechnicianDashboard(u) {
  const myWork = D.issues.filter(i => i.tech == u.id);
  const assigned = myWork.filter(i => i.status != 'Resolved').length;
  const pendingDiag = myWork.filter(i => ['Assigned', 'Diagnosing'].includes(i.status)).length;
  const underRepair = myWork.filter(i => ['Under Repair', 'Diagnosed', 'Reassigned'].includes(i.status)).length;
  const completed = myWork.filter(i => ['Technician Completed', 'Awaiting Faculty Verification', 'Resolved'].includes(i.status)).length;

  return `
    <div class="card" style="background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff">
      <h2>Technician Workspace  ${E(u.name)}</h2>
      <p style="margin:4px 0 0;opacity:0.9">Assigned Equipment Maintenance & Hardware Diagnostics</p>
    </div>

    <!-- Technician Stat Cards (Section 6) -->
    <div class="cards">
      <div class="st" style="--c:#2563eb">
        <b>${assigned}</b>Assigned Issues
      </div>
      <div class="st" style="--c:#f59e0b">
        <b>${pendingDiag}</b>Pending Diagnosis
      </div>
      <div class="st" style="--c:#f97316">
        <b>${underRepair}</b>Issues Under Repair
      </div>
      <div class="st" style="--c:#16a34a">
        <b>${completed}</b>Completed Issues
      </div>
    </div>

    <div class="card">
      <div class="row">
        <h3>My Assigned Work Queue</h3>
        <span class="sp"></span>
        <button class="sm" onclick="go('updates')">Open Quick Update Mode</button>
      </div>

      ${myWork.length ? `
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>Complaint ID</th>
                <th>Computer ID</th>
                <th>Laboratory</th>
                <th>Issue</th>
                <th>Priority</th>
                <th>Current Status</th>
                <th>Last Updated</th>
                <th>Technician Action</th>
              </tr>
            </thead>
            <tbody>
              ${myWork.slice().sort((a, b) => b.updated.localeCompare(a.updated)).map(i => `
                <tr class="cl" onclick="show('${i.id}')">
                  <td><b>${i.id}</b></td>
                  <td>${i.cid}</td>
                  <td>${E(lab(i)?.name)}</td>
                  <td>${E(i.title)}</td>
                  <td>${pb(i.pri)}</td>
                  <td>${sb(i)}</td>
                  <td>${fdd(i.updated)}</td>
                  <td>
                    ${['Assigned', 'Diagnosing'].includes(i.status) ? `<button class="sm warn" onclick="event.stopPropagation();show('${i.id}')">Diagnose</button>` : ''}
                    ${['Diagnosed', 'Under Repair', 'Reassigned'].includes(i.status) ? `<button class="sm pb" onclick="event.stopPropagation();show('${i.id}')">Repair / Update</button>` : ''}
                    ${['Awaiting Faculty Verification', 'Technician Completed'].includes(i.status) ? `<span class="mut" style="font-size:12px">Awaiting Faculty</span>` : ''}
                    ${i.status == 'Resolved' ? `<span class="mut" style="font-size:12px">Completed & Verified</span>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <p class="mut">No computer issues currently assigned to you.</p>
      `}
    </div>
  `;
}

/* 3. FACULTY DASHBOARD (Section 8) */
function renderFacultyDashboard(u) {
  const labIssues = D.issues.filter(i => {
    const l = lab(i);
    return l?.faculty == u.id || i.uid == u.id;
  });

  const pendingVerification = D.issues.filter(i => ['Awaiting Faculty Verification', 'Technician Completed'].includes(i.status));
  const underMaintenance = labIssues.filter(i => ['Assigned', 'Diagnosing', 'Under Repair', 'Reassigned'].includes(i.status)).length;
  const verifiedCount = D.issues.filter(i => i.verification && i.verification.who == u.id).length;

  return `
    <div class="card" style="background:linear-gradient(135deg,#065f46,#047857);color:#fff">
      <h2>Faculty Verification Authority  ${E(u.name)}</h2>
      <p style="margin:4px 0 0;opacity:0.9">Laboratory Equipment Maintenance Oversight & Repair Verification</p>
    </div>

    <!-- Faculty Stat Cards (Section 8) -->
    <div class="cards">
      <div class="st" style="--c:#f59e0b">
        <b>${pendingVerification.length}</b>Pending Verifications
      </div>
      <div class="st" style="--c:#f97316">
        <b>${underMaintenance}</b>Under Maintenance
      </div>
      <div class="st" style="--c:#16a34a">
        <b>${verifiedCount}</b>Verified by Me
      </div>
      <div class="st" style="--c:#2563eb">
        <b>${labIssues.length}</b>Total Lab Issues
      </div>
    </div>

    ${pendingVerification.length ? `
      <div class="card" style="border:2px solid var(--o)">
        <h3 style="color:#b45309"> Action Required: Equipment Awaiting Faculty Verification (${pendingVerification.length})</h3>
        <p class="mut">Technicians have completed their maintenance. Please inspect the machine and certify whether it is functioning properly.</p>
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>Complaint ID</th>
                <th>Computer ID</th>
                <th>Laboratory</th>
                <th>Issue</th>
                <th>Technician Repair Note</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${pendingVerification.map(i => `
                <tr>
                  <td><b>${i.id}</b></td>
                  <td>${i.cid}</td>
                  <td>${E(lab(i)?.name)}</td>
                  <td>${E(i.title)}</td>
                  <td>${E(i.repair?.desc || 'Repair completed')}</td>
                  <td>
                    <button class="sm pb" onclick="show('${i.id}')">Verify Issue Now</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}

    <div class="card">
      <div class="row">
        <h3>Laboratory Maintenance Complaints</h3>
        <span class="sp"></span>
        <button class="sm" onclick="go('verify')">Verification Center </button>
      </div>
      ${itb(labIssues.slice().sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 8))}
    </div>
  `;
}

/* 4. ADMIN DASHBOARD (Section 12 - NO WORKFLOW DIAGRAM) */
function renderAdminDashboard(u) {
  const l = D.issues;
  const n = s => l.filter(i => s.includes(i.status)).length;
  const cd = (t, v, c) => `<div class="st" style="--c:${c}"><b>${v}</b>${t}</div>`;
  const res = n(['Resolved']);
  const pen = l.length - res;
  const pc = l.length ? (res / l.length * 100).toFixed(1) : 0;
  const mo = cnt(l, i => i.created.slice(0, 7));
  const tw = cnt(l.filter(i => i.tech && i.status != 'Resolved'), i => unm(i.tech));
  const awaitingVer = n(['Awaiting Faculty Verification', 'Technician Completed']);
  const adminActionReq = l.filter(i => ['Reported to Admin', 'Admin Action Required', 'Not Corrected'].includes(i.status) || od(i));

  return `
    ${adminActionReq.length ? `
      <div class="alert alert-danger">
        <span style="font-size:18px"></span>
        <div style="flex:1">
          <b>${adminActionReq.length} Complaint(s) Require Administrative Attention</b>
          (Faculty verification failed, issue not corrected, or overdue)
        </div>
        <button class="sm dg" onclick="go('escalations')">Review Escalations</button>
      </div>
    ` : ''}

    <!-- Admin Full Analytics Cards (Section 12) -->
    <div class="cards">
      ${cd('Total Computers', D.comps.length, '#2563eb')}
      ${cd('Total Laboratories', D.labs.length, '#6366f1')}
      ${cd('Open Issues', pen, '#0ea5e9')}
      ${cd('Pending Assignment', n(['Reported', 'Recorded']), '#eab308')}
      ${cd('Under Repair', n(['Under Repair', 'Diagnosed', 'Reassigned']), '#f97316')}
      ${cd('Awaiting Verification', awaitingVer, '#d97706')}
      ${cd('Resolved', res, '#16a34a')}
      ${cd('Action Required', adminActionReq.length, '#dc2626')}
      ${cd('Overdue', l.filter(od).length, '#7f1d1d')}
    </div>

    <!-- Admin Charts (Section 12) -->
    <div class="g2">
      <div class="card"><h4>Issues by Category</h4>${bars(cnt(l, i => i.cat))}</div>
      <div class="card"><h4>Issues by Laboratory</h4>${bars(cnt(l, i => lab(i)?.name))}</div>
      <div class="card"><h4>Monthly Complaints</h4>${bars(mo)}</div>
      <div class="card">
        <h4>Resolved vs Pending</h4>
        <div class="donut" style="background:conic-gradient(var(--g) 0 ${pc}%, var(--o) ${pc}% 100%)"></div>
        <p style="text-align:center;margin-top:10px">
          <span style="color:var(--g)"></span> Resolved ${res} &nbsp;&nbsp;
          <span style="color:var(--o)"></span> Pending ${pen} (${pc}%)
        </p>
      </div>
      <div class="card" style="grid-column:1/-1">
        <h4>Technician Active Workload</h4>
        ${bars(tw)}
      </div>
    </div>

    <!-- Recent College-wide Issues -->
    <div class="card" style="margin-top:16px">
      <div class="row">
        <h4>Recent College Maintenance Issues</h4>
        <span class="sp"></span>
        <button class="sm" onclick="go('issues')">View All Issues </button>
      </div>
      ${itb(l.slice().sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 8))}
    </div>
  `;
}

/* ==========================================================================
   PAGES OBJECT (ROUTED VIEWS)
   ========================================================================== */

const P = {};

/* Main dashboard router */
P.dashboard = () => {
  const u = me();
  if (u.role == 'Student') return renderStudentDashboard(u);
  if (u.role == 'Technician') return renderTechnicianDashboard(u);
  if (u.role == 'Faculty') return renderFacultyDashboard(u);
  if (u.role == 'Admin') return renderAdminDashboard(u);
  return renderStudentDashboard(u);
};

/* Student Report Issue Form (Section 5) */
P.report = () => {
  const u = me();
  const nextId = `CMP-2026-${String(D.seq + 1).padStart(4, '0')}`;
  return `
    <div class="card" style="max-width:760px;margin:0 auto">
      <div class="row" style="margin-bottom:12px">
        <h3>Report Computer Issue</h3>
        <span class="sp"></span>
        <span class="mut">Complaint ID: <b>${nextId}</b></span>
      </div>

      <form class="grid" onsubmit="return subIssue(event)">
        <label>Laboratory
          <select name="lab" id="sl" onchange="lc()" required>
            ${op(D.labs.map(l => [l.id, `${l.id}  ${l.name}`]))}
          </select>
        </label>

        <label>Building & Room
          <input id="bl" readonly style="background:#f1f5f9">
        </label>

        <label>Computer ID
          <select name="cid" id="sc" required></select>
        </label>

        <label>Issue Category
          <select name="cat" required>${op(CATS)}</select>
        </label>

        <label>Priority
          <select name="pri" required>${op(PR)}</select>
        </label>

        <label class="w">Issue Title
          <input name="title" placeholder="Brief summary of problem (e.g. System not starting)" required>
        </label>

        <label class="w">Detailed Description
          <textarea name="desc" rows="4" placeholder="Describe what happens, any error messages, or damaged components..." required></textarea>
        </label>

        <label class="w">Upload Image (optional)
          <input type="file" name="img" accept="image/*">
        </label>

        <div class="w" style="margin-top:10px">
          <button class="pb btn-lg" style="width:100%">Submit Issue</button>
        </div>
      </form>
    </div>
  `;
};

function lc() {
  const l = $('#sl');
  if (!l) return;
  if (PRE) { l.value = PRE.lab; }
  const selectedLab = L_(l.value);
  $('#bl').value = selectedLab ? `${selectedLab.bld}, Room ${selectedLab.room}` : '';
  const comps = D.comps.filter(c => c.lab == l.value);
  $('#sc').innerHTML = op(comps.map(c => [c.id, `${c.id} (${c.name} - ${c.status})`]));
  if (PRE) {
    $('#sc').value = PRE.cid;
    PRE = null;
  }
}

function subIssue(e) {
  e.preventDefault();
  const fm = new FormData(e.target);
  const f = Object.fromEntries(fm);
  const u = me();
  const file = fm.get('img');

  const finalize = imgUrl => {
    const t = now();
    const id = `CMP-2026-${String(++D.seq).padStart(4, '0')}`;
    const selectedLab = L_(f.lab);
    const labTechId = selectedLab?.tech || null;
    const labFacultyId = selectedLab?.faculty || null;

    const newIssue = {
      id: id,
      uid: u.id,
      cid: f.cid,
      cat: f.cat,
      title: f.title,
      desc: f.desc,
      pri: f.pri,
      status: 'Reported',
      created: t,
      updated: t,
      tech: labTechId,
      diag: null,
      repair: null,
      verification: null,
      adminAction: null,
      esc: null,
      log: [{ d: t, s: 'Reported', m: `Issue reported by ${u.name} (${u.role})` }],
      img: imgUrl
    };

    if (labTechId) {
      newIssue.status = 'Assigned';
      newIssue.log.push({ d: t, s: 'Assigned', m: `Assigned automatically to lab technician ${unm(labTechId)}` });
    }

    D.issues.push(newIssue);

    /* Notification for Student (Section 5) */
    nt(
      u.id,
      newIssue.id,
      `Your complaint ${newIssue.id} has been submitted successfully.`,
      'Track complaint status',
      newIssue.status
    );

    /* Notification for Technician (Section 5) */
    if (labTechId) {
      nt(
        labTechId,
        newIssue.id,
        `New computer issue reported.\nComplaint: ${newIssue.id}\nComputer: ${newIssue.cid}\nLaboratory: ${selectedLab?.name}\nIssue: ${newIssue.title}\nReported by: ${u.name}\nAction required: Please inspect the issue.`,
        'Please inspect the issue',
        'Assigned'
      );
    }

    /* Notification for Faculty (Section 5) */
    if (labFacultyId) {
      nt(
        labFacultyId,
        newIssue.id,
        `New computer issue reported in your laboratory.\nComplaint: ${newIssue.id}\nComputer: ${newIssue.cid}\nLaboratory: ${selectedLab?.name}\nIssue: ${newIssue.title}\nReported by: ${u.name}\nAction required: Information notice.`,
        'Laboratory oversight notice',
        'Reported'
      );
    }

    /* Notification for Admin */
    nta(newIssue.id, `New complaint ${newIssue.id} reported on ${newIssue.cid}.`, 'Supervise assignment', 'Reported');

    save();
    alert(`Complaint ${newIssue.id} submitted successfully!`);
    go('issues');
  };

  if (file && file.size > 0) {
    const reader = new FileReader();
    reader.onload = () => finalize(reader.result);
    reader.readAsDataURL(file);
  } else {
    finalize(null);
  }
  return false;
}

/* My Issues / All Issues Page */
P.issues = () => {
  const u = me();
  const list = scopeIssues();
  const q = (Q.q || '').toLowerCase();
  const stFilter = Q.s || '';

  const filtered = list.filter(i => {
    if (stFilter && i.status != stFilter) return false;
    const hay = (i.id + ' ' + i.title + ' ' + i.cid + ' ' + i.cat + ' ' + unm(i.tech)).toLowerCase();
    return hay.includes(q);
  }).sort((a, b) => b.updated.localeCompare(a.updated));

  const pageTitle = u.role == 'Admin' ? 'All College Complaints' : u.role == 'Technician' ? 'My Assigned Issues' : u.role == 'Faculty' ? 'Laboratory Issues' : 'My Reported Issues';

  return `
    <div class="card">
      <div class="row np">
        <input placeholder="Search complaints by ID, title, computer ID, or technician..." value="${E(Q.q || '')}" oninput="Q.q=this.value;$('#issue_table_container').innerHTML=renderRoleIssueTable(flIssues())">
        <select onchange="Q.s=this.value;$('#issue_table_container').innerHTML=renderRoleIssueTable(flIssues())">
          <option value="">All Statuses</option>
          ${op(Object.keys(SC).filter(x => x != 'Pending'))}
        </select>
        ${u.role == 'Student' ? `<button class="pb" onclick="go('report')">+ Report New Issue</button>` : ''}
      </div>
      <div id="issue_table_container" style="margin-top:14px">
        ${renderRoleIssueTable(filtered)}
      </div>
    </div>
  `;
};

function flIssues() {
  const list = scopeIssues();
  const q = (Q.q || '').toLowerCase();
  const stFilter = Q.s || '';
  return list.filter(i => {
    if (stFilter && i.status != stFilter) return false;
    const hay = (i.id + ' ' + i.title + ' ' + i.cid + ' ' + i.cat + ' ' + unm(i.tech)).toLowerCase();
    return hay.includes(q);
  }).sort((a, b) => b.updated.localeCompare(a.updated));
}

function renderRoleIssueTable(l) {
  const u = me();
  if (!l.length) return '<p class="mut" style="padding:16px 0">No records found matching your criteria.</p>';

  if (u.role == 'Student') {
    return `
      <div class="tw">
        <table>
          <thead>
            <tr>
              <th>Complaint ID</th>
              <th>Computer ID</th>
              <th>Issue Title</th>
              <th>Date Reported</th>
              <th>Status</th>
              <th>Last Updated</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${l.map(i => `
              <tr class="cl" onclick="show('${i.id}')">
                <td><b>${i.id}</b></td>
                <td>${i.cid}</td>
                <td>${E(i.title)}</td>
                <td>${fdd(i.created)}</td>
                <td>${studentBadge(i)}</td>
                <td>${fdd(i.updated)}</td>
                <td><button class="sm" onclick="event.stopPropagation();show('${i.id}')">View Status</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  return itb(l);
}

const itb = l => l.length ? `
  <div class="tw">
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Computer</th>
          <th>Lab</th>
          <th>Issue</th>
          <th>Reported</th>
          <th>Technician</th>
          <th>Priority</th>
          <th>Status</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        ${l.map(i => `
          <tr class="cl" onclick="show('${i.id}')">
            <td><b>${i.id}</b></td>
            <td>${i.cid}</td>
            <td>${E(lab(i)?.name)}</td>
            <td>${E(i.title)}</td>
            <td>${fdd(i.created)}</td>
            <td>${E(unm(i.tech))}</td>
            <td>${pb(i.pri)}</td>
            <td>${sb(i)}</td>
            <td>${fdd(i.updated)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
` : '<p class="mut">No records found.</p>';

/* Technician Quick Updates Page */
P.updates = () => {
  const u = me();
  if (u.role != 'Technician') return renderAccessDenied();
  const activeWork = D.issues.filter(i => i.tech == u.id && i.status != 'Resolved');

  return `
    <div class="card">
      <h3>Active Maintenance Updates</h3>
      <p class="mut">Quick action console to diagnose issues and submit repair results.</p>
      ${activeWork.length ? `
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>Complaint</th>
                <th>Computer</th>
                <th>Problem</th>
                <th>Current Status</th>
                <th>Action Required</th>
                <th>Execute Action</th>
              </tr>
            </thead>
            <tbody>
              ${activeWork.map(i => `
                <tr>
                  <td><b>${i.id}</b></td>
                  <td>${i.cid} (${E(lab(i)?.name)})</td>
                  <td>${E(i.title)}</td>
                  <td>${sb(i)}</td>
                  <td>
                    ${i.status == 'Assigned' ? 'Needs initial fault diagnosis' : ''}
                    ${i.status == 'Diagnosing' ? 'Diagnosis in progress' : ''}
                    ${['Diagnosed', 'Under Repair', 'Reassigned'].includes(i.status) ? 'Needs repair & verification submission' : ''}
                    ${['Technician Completed', 'Awaiting Faculty Verification'].includes(i.status) ? 'Submitted to Faculty' : ''}
                  </td>
                  <td>
                    <button class="sm pb" onclick="show('${i.id}')">Manage Issue</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <p class="mut">All assigned complaints are currently resolved. Great work!</p>
      `}
    </div>
  `;
};

/* Faculty Issues to Verify Page (Section 8) */
P.verify = () => {
  const u = me();
  if (u.role != 'Faculty') return renderAccessDenied();
  const toVerify = D.issues.filter(i => ['Awaiting Faculty Verification', 'Technician Completed'].includes(i.status));

  return `
    <div class="card">
      <div class="row">
        <h3>Complaints Awaiting Faculty Verification (${toVerify.length})</h3>
      </div>
      <p class="mut">As the laboratory verification authority, you inspect repaired machines and certify them as either Corrected (Resolved) or Not Corrected (Report to Admin).</p>

      ${toVerify.length ? `
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>Complaint ID</th>
                <th>Computer ID</th>
                <th>Laboratory</th>
                <th>Issue</th>
                <th>Technician</th>
                <th>Repair Performed</th>
                <th>Parts Replaced</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${toVerify.map(i => `
                <tr>
                  <td><b>${i.id}</b></td>
                  <td>${i.cid}</td>
                  <td>${E(lab(i)?.name)}</td>
                  <td>${E(i.title)}</td>
                  <td>${E(unm(i.tech))}</td>
                  <td>${E(i.repair?.desc || '')}</td>
                  <td>${E(i.repair?.parts || 'None')}</td>
                  <td>
                    <button class="sm pb" onclick="show('${i.id}')">Inspect & Verify</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <div style="text-align:center;padding:30px">
          <div style="font-size:36px;margin-bottom:8px"></div>
          <p class="mut">No complaints currently awaiting faculty verification.</p>
        </div>
      `}
    </div>
  `;
};

/* Faculty Verified Issues History */
P.verified = () => {
  const u = me();
  if (u.role != 'Faculty') return renderAccessDenied();
  const list = D.issues.filter(i => i.verification);

  return `
    <div class="card">
      <h3>Faculty Verification Records</h3>
      <p class="mut">Historical audit log of all maintenance verifications performed by faculty.</p>
      ${list.length ? `
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>Complaint</th>
                <th>Computer</th>
                <th>Verification Date</th>
                <th>Verified By</th>
                <th>Result</th>
                <th>Faculty Remarks</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(i => `
                <tr class="cl" onclick="show('${i.id}')">
                  <td><b>${i.id}</b></td>
                  <td>${i.cid}</td>
                  <td>${fdd(i.verification.date)}</td>
                  <td>${E(i.verification.name)}</td>
                  <td>
                    ${i.verification.result == 'Corrected' ? `<span class="bd suc"> Corrected</span>` : `<span class="bd dg"> Not Corrected</span>`}
                  </td>
                  <td>${E(i.verification.remarks || '')}</td>
                  <td>${sb(i)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<p class="mut">No verification records found.</p>'}
    </div>
  `;
};

/* Role-based Notifications Page (Section 15) */
P.notes = () => {
  const u = me();
  const list = D.notes.filter(n => n.uid == u.id);

  return `
    <div class="card">
      <div class="row">
        <h3>My Notifications</h3>
        <span class="sp"></span>
        <button class="sm gr" onclick="D.notes.forEach(n => n.uid == '${u.id}' && (n.read = 1)); save(); render();">
          Mark All as Read
        </button>
      </div>
      <p class="mut">Alerts, assignments, status changes, and verification notices for your role.</p>

      <div style="margin-top:14px">
        ${list.length ? list.map(n => `
          <div class="note-card ${n.read ? '' : 'unread'}" onclick="rd('${n.id}')">
            <div class="row" style="margin:0 0 6px">
              <b>${n.iid ? `${n.iid}` : 'Notification'}</b>
              ${n.cid && n.cid != '' ? `<span class="mut" style="font-size:12px"> Computer: ${n.cid}</span>` : ''}
              ${n.status ? `<span style="margin-left:6px">${bd(n.status, SC[n.status] || '#64748b')}</span>` : ''}
              <span class="sp"></span>
              <small class="mut">${fd(n.date)}</small>
            </div>
            <div style="margin-bottom:6px;font-size:13px">${E(n.msg)}</div>
            <div class="row" style="margin:0;font-size:12px">
              <span class="mut">Action required: <b>${E(n.action || 'None')}</b></span>
              <span class="sp"></span>
              <span class="mut" style="color:var(--p2)">Click to open complaint </span>
            </div>
          </div>
        `).join('') : '<p class="mut">No notifications.</p>'}
      </div>
    </div>
  `;
};

function rd(id) {
  const n = D.notes.find(x => x.id == id);
  if (n) {
    n.read = 1;
    save();
    render();
    if (n.iid && I_(n.iid)) show(n.iid);
  }
}

/* ==========================================================================
   ADMIN PAGES (SUPERVISION & AUDIT)
   ========================================================================== */

/* Admin Escalations & Action Required Page */
P.escalations = () => {
  const u = me();
  if (u.role != 'Admin') return renderAccessDenied();
  const escalated = D.issues.filter(i => ['Reported to Admin', 'Admin Action Required', 'Not Corrected', 'Escalated'].includes(i.status) || od(i));

  return `
    <div class="card">
      <h3>Administrative Action & Escalation Queue (${escalated.length})</h3>
      <p class="mut">Complaints where faculty verification failed, repair difficulties occurred, or service level deadlines were exceeded.</p>

      ${escalated.length ? `
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>Complaint ID</th>
                <th>Computer</th>
                <th>Laboratory</th>
                <th>Issue</th>
                <th>Current Status</th>
                <th>Technician</th>
                <th>Escalation / Verification Notes</th>
                <th>Admin Authority Action</th>
              </tr>
            </thead>
            <tbody>
              ${escalated.map(i => `
                <tr>
                  <td><b>${i.id}</b></td>
                  <td>${i.cid}</td>
                  <td>${E(lab(i)?.name)}</td>
                  <td>${E(i.title)}</td>
                  <td>${sb(i)}</td>
                  <td>${E(unm(i.tech))}</td>
                  <td style="max-width:240px">
                    ${i.verification?.remarks ? `<span style="color:var(--r)">Faculty failed: ${E(i.verification.remarks)}</span>` : ''}
                    ${i.esc?.reason ? `<span>Reason: ${E(i.esc.reason)}</span>` : ''}
                    ${od(i) ? `<span style="color:var(--r)">Overdue by >${D.set.overdue} days</span>` : ''}
                  </td>
                  <td>
                    <button class="sm pb" onclick="show('${i.id}')">Take Admin Action</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <p class="mut">No unresolved escalations or overdue issues at this time.</p>
      `}
    </div>
  `;
};

/* Admin Users Management */
P.users = () => {
  const u = me();
  if (u.role != 'Admin') return renderAccessDenied();
  return `
    <div class="card">
      <div class="row">
        <h3>User Directory (${D.users.length})</h3>
        <span class="sp"></span>
        <button onclick="addU()">+ Add New User</button>
      </div>
      <div class="tw">
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Email (Login ID)</th><th>Role</th><th>Department</th></tr></thead>
          <tbody>
            ${D.users.map(x => `
              <tr>
                <td><b>${x.id}</b></td>
                <td>${E(x.name)}</td>
                <td>${E(x.email)}</td>
                <td>${bd(x.role, x.role == 'Admin' ? '#1e3a8a' : x.role == 'Faculty' ? '#047857' : x.role == 'Technician' ? '#f59e0b' : '#64748b')}</td>
                <td>${E(x.dept || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
};

function addU() {
  fm('Add User', [
    ['name', 'Full Name'],
    ['email', 'Email Address', 'email'],
    ['password', 'Password', 'password'],
    ['role', 'Role', 'select', ['Student', 'Faculty', 'Technician', 'Admin']],
    ['dept', 'Department']
  ], f => {
    D.users.push({ ...f, id: 'u_' + Date.now().toString(36) });
  });
}

/* Dedicated Students Page */
P.students = () => {
  const u = me();
  if (u.role != 'Admin') return renderAccessDenied();
  const students = D.users.filter(x => x.role == 'Student');
  return `
    <div class="card">
      <h3>Registered Students</h3>
      <div class="tw">
        <table>
          <thead><tr><th>Student ID</th><th>Name</th><th>Email</th><th>Department</th><th>Reported Issues</th></tr></thead>
          <tbody>
            ${students.map(s => {
              const count = D.issues.filter(i => i.uid == s.id).length;
              return `
                <tr>
                  <td><b>${s.id}</b></td>
                  <td>${E(s.name)}</td>
                  <td>${E(s.email)}</td>
                  <td>${E(s.dept)}</td>
                  <td><b>${count}</b> issue(s) reported</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
};

/* Dedicated Faculty Page */
P.faculty = () => {
  const u = me();
  if (u.role != 'Admin') return renderAccessDenied();
  const faculty = D.users.filter(x => x.role == 'Faculty');
  return `
    <div class="card">
      <h3>Faculty Verification Authorities</h3>
      <div class="tw">
        <table>
          <thead><tr><th>Faculty ID</th><th>Name</th><th>Email</th><th>Department</th><th>Supervised Labs</th><th>Verifications Performed</th></tr></thead>
          <tbody>
            ${faculty.map(f => {
              const labs = D.labs.filter(l => l.faculty == f.id).map(l => l.name).join(', ') || 'All Department Labs';
              const verCount = D.issues.filter(i => i.verification && i.verification.who == f.id).length;
              return `
                <tr>
                  <td><b>${f.id}</b></td>
                  <td>${E(f.name)}</td>
                  <td>${E(f.email)}</td>
                  <td>${E(f.dept)}</td>
                  <td>${E(labs)}</td>
                  <td><b>${verCount}</b> verifications</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
};

/* Dedicated Technicians Page */
P.technicians = () => {
  const u = me();
  if (u.role != 'Admin') return renderAccessDenied();
  const techs = D.users.filter(x => x.role == 'Technician');
  return `
    <div class="card">
      <h3>Technician Staff Workload & Performance</h3>
      <div class="tw">
        <table>
          <thead><tr><th>Technician</th><th>Email</th><th>Assigned</th><th>Under Repair</th><th>Completed</th><th>Avg Days</th></tr></thead>
          <tbody>
            ${techs.map(t => {
              const all = D.issues.filter(i => i.tech == t.id);
              const active = all.filter(i => i.status != 'Resolved').length;
              const underRep = all.filter(i => ['Under Repair', 'Diagnosed', 'Reassigned'].includes(i.status)).length;
              const res = all.filter(i => i.status == 'Resolved');
              const avg = res.length ? (res.reduce((s, i) => s + resDays(i), 0) / res.length).toFixed(1) : '';
              return `
                <tr>
                  <td><b>${E(t.name)}</b></td>
                  <td>${E(t.email)}</td>
                  <td>${active}</td>
                  <td>${underRep}</td>
                  <td>${res.length}</td>
                  <td>${avg} d</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
};

/* Computers Inventory */
P.computers = () => {
  const u = me();
  if (u.role != 'Admin') return renderAccessDenied();
  const q = (Q.c || '').toLowerCase();
  const filtered = D.comps.filter(c => (c.id + c.serial + c.name + c.cpu).toLowerCase().includes(q));

  return `
    <div class="card">
      <div class="row">
        <h3>Computer Inventory (${D.comps.length})</h3>
        <span class="sp"></span>
        <button onclick="addC()">+ Add Computer</button>
      </div>
      <div class="row np">
        <input placeholder="Filter computers by ID, serial, processor..." value="${E(Q.c || '')}" oninput="Q.c=this.value;render()">
      </div>
      <div class="tw">
        <table>
          <thead><tr><th>ID</th><th>Lab</th><th>Processor</th><th>RAM</th><th>Storage</th><th>OS</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            ${filtered.map(c => `
              <tr class="cl" onclick="cmod('${c.id}')">
                <td><b>${c.id}</b></td>
                <td>${c.lab}</td>
                <td>${c.cpu}</td>
                <td>${c.ram}</td>
                <td>${c.disk}</td>
                <td>${c.os}</td>
                <td>${bd(c.status, c.status == 'Working' ? '#16a34a' : c.status == 'Under Maintenance' ? '#f97316' : '#dc2626')}</td>
                <td><button class="sm" onclick="event.stopPropagation();cmod('${c.id}')">Details</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
};

function cmod(id) {
  const c = C_(id);
  if (!c) return;
  const l = L_(c.lab);
  const u = me();
  modal(`
    <h3>Computer: ${c.id}  ${E(c.name)}</h3>
    <div class="box">
      <dl>
        <dt>Laboratory</dt><dd>${E(l ? l.name : c.lab)}</dd>
        <dt>Serial Number</dt><dd>${c.serial}</dd>
        <dt>Processor</dt><dd>${c.cpu}</dd>
        <dt>RAM</dt><dd>${c.ram}</dd>
        <dt>Storage</dt><dd>${c.disk}</dd>
        <dt>Operating System</dt><dd>${c.os}</dd>
        <dt>Hardware Status</dt><dd>${bd(c.status, c.status == 'Working' ? '#16a34a' : '#dc2626')}</dd>
      </dl>
    </div>
    ${u.role == 'Admin' ? `
      <div class="row">
        <label>Update Status:
          <select onchange="C_('${id}').status=this.value;save();cmod('${id}');render()">
            ${['Working', 'Under Maintenance', 'Faulty', 'Retired'].map(s => `<option ${s == c.status ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
      </div>
    ` : ''}
    <h4>Maintenance History</h4>
    ${hTbl(D.hist.filter(h => h.cid == id))}
    <h4>Associated Complaints</h4>
    ${itb(D.issues.filter(i => i.cid == id))}
  `);
}

function addC() {
  fm('Add Computer', [
    ['lab', 'Laboratory', 'select', D.labs.map(l => [l.id, l.name])],
    ['serial', 'Serial Number'],
    ['name', 'Computer Name'],
    ['cpu', 'Processor'],
    ['ram', 'RAM'],
    ['disk', 'Storage'],
    ['os', 'Operating System']
  ], f => {
    const count = D.comps.filter(c => c.lab == f.lab).length + 1;
    D.comps.push({
      ...f,
      id: `${f.lab.replace('-', '')}-PC${String(count).padStart(2, '0')}`,
      status: 'Working',
      last: ''
    });
  });
}

/* Laboratories Page */
P.labs = () => {
  const u = me();
  if (u.role != 'Admin') return renderAccessDenied();
  return `
    <div class="card">
      <div class="row">
        <h3>College Laboratories (${D.labs.length})</h3>
        <span class="sp"></span>
        <button onclick="addL()">+ Add Laboratory</button>
      </div>
      <div class="g2">
        ${D.labs.map(l => {
          const comps = D.comps.filter(c => c.lab == l.id);
          const activeIssues = D.issues.filter(i => i.status != 'Resolved' && C_(i.cid)?.lab == l.id).length;
          return `
            <div class="card">
              <h3>${l.id}: ${E(l.name)}</h3>
              <dl>
                <dt>Building</dt><dd>${l.bld}</dd>
                <dt>Room</dt><dd>${l.room}</dd>
                <dt>Total Computers</dt><dd>${comps.length}</dd>
                <dt>Assigned Technician</dt><dd>${E(unm(l.tech))}</dd>
                <dt>Faculty in Charge</dt><dd>${E(unm(l.faculty))}</dd>
                <dt>Active Issues</dt><dd>${activeIssues ? `<span class="bd dg">${activeIssues} Active</span>` : '<span class="bd suc">All OK</span>'}</dd>
              </dl>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
};

function addL() {
  fm('Add Laboratory', [
    ['name', 'Laboratory Name'],
    ['bld', 'Building'],
    ['room', 'Room Number'],
    ['tech', 'Technician in Charge', 'select', D.users.filter(u => u.role == 'Technician').map(u => [u.id, u.name])],
    ['faculty', 'Faculty in Charge', 'select', D.users.filter(u => u.role == 'Faculty').map(u => [u.id, u.name])]
  ], f => {
    D.labs.push({ ...f, id: 'LAB-' + String(D.labs.length + 1).padStart(2, '0') });
  });
}

/* Maintenance History */
P.maint = () => {
  const u = me();
  if (u.role != 'Admin') return renderAccessDenied();
  const q = (Q.m || '').toLowerCase();
  const histList = D.hist.slice().reverse().filter(h => JSON.stringify(h).toLowerCase().includes(q));

  return `
    <div class="card">
      <h3>Complete Maintenance Ledger</h3>
      <div class="row np">
        <input placeholder="Search maintenance ledger..." value="${E(Q.m || '')}" oninput="Q.m=this.value;render()">
      </div>
      ${hTbl(histList)}
    </div>
  `;
};

const hTbl = l => l.length ? `
  <div class="tw">
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Complaint</th>
          <th>Problem</th>
          <th>Diagnosis</th>
          <th>Repair Performed</th>
          <th>Spare Parts</th>
          <th>Technician</th>
          <th>Status</th>
          <th>Remarks</th>
        </tr>
      </thead>
      <tbody>
        ${l.map(h => `
          <tr>
            <td>${fdd(h.date)}</td>
            <td><b>${h.iid}</b></td>
            <td>${E(h.problem)}</td>
            <td>${E(h.diag)}</td>
            <td>${E(h.work)}</td>
            <td>${E(h.parts)}</td>
            <td>${E(unm(h.tech))}</td>
            <td>${bd(h.status, SC[h.status] || '#64748b')}</td>
            <td>${E(h.remarks)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
` : '<p class="mut">No maintenance records found.</p>';

/* Analytics & Reports */
P.analytics = () => P.reports();

P.reports = () => {
  const u = me();
  if (u.role != 'Admin') return renderAccessDenied();
  const l = D.issues;
  const res = l.filter(i => i.status == 'Resolved');
  const avg = res.length ? (res.reduce((s, i) => s + resDays(i), 0) / res.length).toFixed(1) : '';

  return `
    <div class="card">
      <h3>System-wide Maintenance Reports & Analytics</h3>
      <div class="cards" style="margin-top:14px">
        <div class="st" style="--c:#2563eb"><b>${l.length}</b>Total Issues</div>
        <div class="st" style="--c:#16a34a"><b>${avg}</b>Avg Resolution (Days)</div>
        <div class="st" style="--c:#dc2626"><b>${l.filter(i => i.esc).length}</b>Escalated</div>
        <div class="st" style="--c:#7f1d1d"><b>${l.filter(od).length}</b>Overdue</div>
      </div>
      <div class="g2">
        <div class="card"><h4>Complaints by Category</h4>${bars(cnt(l, i => i.cat))}</div>
        <div class="card"><h4>Complaints by Laboratory</h4>${bars(cnt(l, i => lab(i)?.name))}</div>
      </div>
      <div class="row" style="margin-top:16px">
        <button onclick="window.print()">Export Printable PDF</button>
      </div>
    </div>
  `;
};

/* Settings & Profile */
P.settings = () => {
  const u = me();
  return `
    <div class="card">
      <h3>User Profile</h3>
      <dl>
        <dt>User ID</dt><dd>${u.id}</dd>
        <dt>Name</dt><dd><b>${E(u.name)}</b></dd>
        <dt>Email</dt><dd>${E(u.email)}</dd>
        <dt>Role</dt><dd>${bd(u.role, '#2563eb')}</dd>
        <dt>Department</dt><dd>${E(u.dept || '')}</dd>
      </dl>
    </div>

    ${u.role == 'Admin' ? `
      <div class="card">
        <h3>Administrative System Settings</h3>
        <label>Overdue Threshold (Days)
          <input type="number" min="1" value="${D.set.overdue}" onchange="D.set.overdue=+this.value||7;save();alert('Saved');render()">
        </label>
        <div style="margin-top:16px">
          <button class="dg" onclick="if(confirm('Reset all database records to default demonstration data?')){seed();out()}">
            Reset All Demo Data
          </button>
        </div>
      </div>
    ` : ''}
  `;
};

/* ==========================================================================
   COMPLAINT DETAILS & WORKFLOW ACTIONS MODAL (Section 6, 8, 9, 10, 13, 17)
   ========================================================================== */

function show(id) {
  const i = I_(id);
  const u = me();
  if (!i || !u) return;

  /* Strict Role-Based Privacy & Authorization (Section 17 & 20) */
  if (!canViewIssue(i, u)) {
    modal(`
      <div style="text-align:center;padding:24px">
        <h3 style="color:var(--r)">Access Denied</h3>
        <p class="mut">You do not have permission to view this complaint.</p>
      </div>
    `);
    return;
  }

  const s = i.status;
  const isStudent = u.role == 'Student';
  const isTech = u.role == 'Technician' && i.tech == u.id;
  const isFaculty = u.role == 'Faculty';
  const isAdmin = u.role == 'Admin';

  /* --- Student-Safe View (Section 17) --- */
  if (isStudent) {
    modal(`
      <h3>${i.id}  ${E(i.title)}</h3>
      <div style="margin-bottom:12px">${studentBadge(i)}</div>

      <div class="box">
        <h4>Complaint Information</h4>
        <dl>
          <dt>Complaint ID</dt><dd><b>${i.id}</b></dd>
          <dt>Computer ID</dt><dd>${i.cid}</dd>
          <dt>Laboratory</dt><dd>${E(lab(i)?.name)}</dd>
          <dt>Category</dt><dd>${i.cat}</dd>
          <dt>Priority</dt><dd>${pb(i.pri)}</dd>
          <dt>Date Reported</dt><dd>${fd(i.created)}</dd>
          <dt>Current Status</dt><dd>${studentBadge(i)}</dd>
          <dt>Description</dt><dd>${E(i.desc)}</dd>
        </dl>
      </div>

      ${i.img ? `<div class="box"><h4>Attached Photo</h4><img src="${i.img}" style="max-width:100%;max-height:220px;border-radius:8px"></div>` : ''}

      ${i.status == 'Resolved' ? `
        <div class="box" style="background:#dcfce7;border-color:#16a34a">
          <h4 style="color:#166534"> Verification & Resolution Notice</h4>
          <p style="margin:4px 0">Your complaint has been verified and resolved by Faculty <b>${E(i.verification?.name || 'Dr. Meena S')}</b> on ${fdd(i.verification?.date)}.</p>
        </div>
      ` : `
        <div class="box" style="background:#f8fafc">
          <h4>Status Notice</h4>
          <p class="mut" style="margin:4px 0">
            ${i.status == 'Reported' ? 'Your complaint has been logged and assigned to technical maintenance.' : ''}
            ${['Assigned', 'Diagnosing', 'Under Repair', 'Reassigned'].includes(i.status) ? 'The technician is actively diagnosing/repairing this computer.' : ''}
            ${['Technician Completed', 'Awaiting Faculty Verification'].includes(i.status) ? 'Technician has completed repairs. Faculty verification is in progress.' : ''}
            ${['Not Corrected', 'Reported to Admin', 'Admin Action Required'].includes(i.status) ? 'Faculty re-inspection requested. Technical administration is coordinating further action.' : ''}
          </p>
        </div>
      `}
    `);
    return;
  }

  /* --- Full View for Technician, Faculty, Admin --- */
  let actionsHtml = '';

  /* Technician Actions (Section 6 & 7: CANNOT directly mark Resolved) */
  if (isTech) {
    if (s == 'Assigned') {
      actionsHtml += `
        <div class="box" style="background:#fffbeb;border-color:#f59e0b">
          <h4>Technician Initial Action</h4>
          <button class="btn pb" onclick="startDiag('${i.id}')">Start Diagnosis</button>
        </div>
      `;
    }

    if (s == 'Diagnosing') {
      actionsHtml += `
        <form class="box" onsubmit="return submitDiag(event, '${i.id}')" style="background:#fffbeb;border-color:#f59e0b">
          <h4>Submit Diagnosis</h4>
          <label>Diagnosis Findings
            <textarea name="text" placeholder="Detail hardware/software issue discovered..." required></textarea>
          </label>
          <label>Result
            <select name="res">
              <option value="Diagnosed">Issue Diagnosed (Proceed to Repair)</option>
              <option value="Unable to Diagnose">Unable to Diagnose</option>
            </select>
          </label>
          <div style="margin-top:10px">
            <button class="btn pb">Save Diagnosis</button>
          </div>
        </form>
      `;
    }

    if (['Diagnosed', 'Under Repair', 'Reassigned'].includes(s)) {
      actionsHtml += `
        <form class="box" onsubmit="return submitTechRepair(event, '${i.id}')" style="background:#f0fdf4;border-color:#22c55e">
          <h4>Submit Repair Result (Awaiting Faculty Verification)</h4>
          <p class="mut" style="font-size:12px">
            Note: Technician reports repair outcome. Final "Resolved" status is certified by Faculty.
          </p>

          <label>Repair Outcome
            <select name="outcome" required>
              <option value="Issue Corrected">Issue Corrected (Submit for Faculty Verification)</option>
              <option value="Issue Not Corrected">Issue Not Corrected (Escalate)</option>
            </select>
          </label>

          <label>Work Performed / Repair Description
            <textarea name="desc" placeholder="Detail replacement, soldering, OS reinstallation, etc." required></textarea>
          </label>

          <label>Spare Parts Required / Used
            <input name="parts" placeholder="e.g. 16GB DDR4 RAM, Power Cable, etc.">
          </label>

          <label>Technician Remarks
            <input name="remarks" placeholder="Observations, test results, benchmarks...">
          </label>

          <div style="margin-top:10px">
            <button class="btn pb">Submit Maintenance Result</button>
          </div>
        </form>
      `;
    }
  }

  /* Faculty Actions (Section 8, 9, 10: ISSUE CORRECTED or ISSUE NOT CORRECTED) */
  if (isFaculty && ['Awaiting Faculty Verification', 'Technician Completed'].includes(s)) {
    actionsHtml += `
      <div class="box" style="background:#fef3c7;border:2px solid #f59e0b">
        <h4 style="color:#b45309">Faculty Laboratory Verification Authority</h4>
        <p style="margin:4px 0 10px;font-size:13px">
          The technician has completed repair. Please inspect <b>${i.cid}</b> in <b>${E(lab(i)?.name)}</b> and certify whether the issue is resolved.
        </p>

        <form onsubmit="return submitFacultyVerification(event, '${i.id}')">
          <label>Faculty Verification Remarks
            <textarea name="remarks" placeholder="Enter remarks regarding machine testing..." required></textarea>
          </label>
          <div class="row" style="margin-top:12px">
            <button type="submit" name="decision" value="Corrected" class="btn suc" style="font-size:14px;padding:10px 18px">
               ISSUE CORRECTED
            </button>
            <button type="submit" name="decision" value="Not Corrected" class="btn dg" style="font-size:14px;padding:10px 18px">
               ISSUE NOT CORRECTED
            </button>
          </div>
        </form>
      </div>
    `;
  }

  /* Faculty: Report to Admin if already Not Corrected */
  if (isFaculty && s == 'Not Corrected') {
    actionsHtml += `
      <form class="box" onsubmit="return submitFacultyReportToAdmin(event, '${i.id}')" style="background:#fee2e2;border-color:#dc2626">
        <h4 style="color:#991b1b">Report Unresolved Issue to Admin</h4>
        <label>Reason for Admin Escalation
          <textarea name="reason" placeholder="Explain why repair failed and required Admin intervention..." required>Problem still exists after repair.</textarea>
        </label>
        <div style="margin-top:10px">
          <button class="btn dg">Submit Report to Admin</button>
        </div>
      </form>
    `;
  }

  /* Admin Actions (Section 13: Supreme authority, Send back to technician, Reassign) */
  if (isAdmin) {
    actionsHtml += `
      <div class="box" style="background:#f8fafc;border:2px solid #3b82f6">
        <h4>Administrator Controls</h4>

        <!-- Assign / Reassign Technician -->
        <form class="row" onsubmit="return adminAssign(event, '${i.id}')" style="margin-bottom:12px">
          <select name="tech" required>
            <option value="">Select Technician...</option>
            ${op(D.users.filter(u => u.role == 'Technician').map(u => [u.id, `${u.name} (Active: ${D.issues.filter(x => x.tech == u.id && x.status != 'Resolved').length})`]))}
          </select>
          <button class="btn pb">${i.tech ? 'Reassign Technician' : 'Assign Technician'}</button>
        </form>

        <!-- Send Back to Technician (Section 13) -->
        <form onsubmit="return adminSendBack(event, '${i.id}')" style="margin-top:10px;border-top:1px solid #e2e8f0;padding-top:10px">
          <b>Send Back to Technician with Instructions:</b>
          <label style="margin-top:6px">Instructions / Directive
            <textarea name="msg" placeholder="e.g. Faculty verification failed. Issue still exists. Please inspect the computer again." required>Faculty verification failed. Issue still exists. Please inspect the computer again.</textarea>
          </label>
          <div style="margin-top:8px">
            <button class="btn warn">Direct Technician to Re-inspect</button>
          </div>
        </form>

        <!-- Force Resolve -->
        <div class="row" style="margin-top:12px;border-top:1px solid #e2e8f0;padding-top:10px">
          <button class="btn suc sm" onclick="adminForceResolve('${i.id}')">Directly Mark as Resolved</button>
        </div>
      </div>
    `;
  }

  modal(`
    <div class="row">
      <h3>${i.id}  ${E(i.title)}</h3>
      <span class="sp"></span>
      ${sb(i)} ${pb(i.pri)}
    </div>

    <div class="box">
      <h4>Complaint Information</h4>
      <dl>
        <dt>Computer ID</dt><dd><b>${i.cid}</b></dd>
        <dt>Laboratory</dt><dd>${E(lab(i)?.name)}</dd>
        <dt>Reported By</dt><dd>${E(unm(i.uid))} (${U_(i.uid)?.role || 'User'})</dd>
        <dt>Category</dt><dd>${i.cat}</dd>
        <dt>Description</dt><dd>${E(i.desc)}</dd>
        <dt>Date Reported</dt><dd>${fd(i.created)}</dd>
        <dt>Assigned Tech</dt><dd>${E(unm(i.tech))}</dd>
      </dl>
    </div>

    ${i.diag ? `
      <div class="box">
        <h4>Technician Diagnosis</h4>
        <dl>
          <dt>Technician</dt><dd>${E(unm(i.diag.tech))}</dd>
          <dt>Diagnosis</dt><dd>${E(i.diag.text)}</dd>
          <dt>Result</dt><dd>${bd(i.diag.result, i.diag.result == 'Diagnosed' ? '#16a34a' : '#dc2626')}</dd>
          <dt>Date</dt><dd>${fd(i.diag.date)}</dd>
        </dl>
      </div>
    ` : ''}

    ${i.repair ? `
      <div class="box">
        <h4>Technician Repair Details</h4>
        <dl>
          <dt>Technician</dt><dd>${E(unm(i.repair.tech))}</dd>
          <dt>Repair Action</dt><dd>${E(i.repair.desc)}</dd>
          <dt>Parts Replaced</dt><dd>${E(i.repair.parts || 'None')}</dd>
          <dt>Remarks</dt><dd>${E(i.repair.remarks || 'None')}</dd>
          <dt>Outcome</dt><dd>${bd(i.repair.result || 'Issue Corrected', '#0284c7')}</dd>
          <dt>Repair Date</dt><dd>${fd(i.repair.date)}</dd>
        </dl>
      </div>
    ` : ''}

    ${i.verification ? `
      <div class="box" style="${i.verification.result == 'Corrected' ? 'background:#f0fdf4;border-color:#22c55e' : 'background:#fee2e2;border-color:#ef4444'}">
        <h4>Faculty Verification Record</h4>
        <dl>
          <dt>Verified By</dt><dd><b>${E(i.verification.name)}</b></dd>
          <dt>Result</dt><dd>${i.verification.result == 'Corrected' ? '<span class="bd suc"> Corrected</span>' : '<span class="bd dg"> Not Corrected</span>'}</dd>
          <dt>Date & Time</dt><dd>${fd(i.verification.date)}</dd>
          <dt>Faculty Remarks</dt><dd>${E(i.verification.remarks || 'None')}</dd>
        </dl>
      </div>
    ` : ''}

    ${actionsHtml}

    <div class="box">
      <h4>Activity & Audit Log</h4>
      <div style="font-size:12px;max-height:160px;overflow:auto">
        ${i.log.slice().reverse().map(l => `
          <div class="mut" style="padding:3px 0;border-bottom:1px solid #f1f5f9">
            ${fd(l.d)}  <b>${l.s}</b>: ${E(l.m)}
          </div>
        `).join('')}
      </div>
    </div>
  `);
}

/* ==========================================================================
   WORKFLOW ACTION HANDLERS
   ========================================================================== */

/* Technician Start Diagnosis */
function startDiag(id) {
  const i = I_(id);
  const u = me();
  if (u.role != 'Technician' || i.tech != u.id) return;
  setS(i, 'Diagnosing', 'Diagnosis started by ' + u.name);
  setC(i.cid, 'Under Maintenance');
  save();
  show(id);
  render();
}

/* Technician Submit Diagnosis */
function submitDiag(e, id) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const i = I_(id);
  const u = me();
  if (u.role != 'Technician' || i.tech != u.id) return false;

  i.diag = {
    text: f.text,
    result: f.res,
    date: now(),
    tech: u.id
  };

  if (f.res == 'Diagnosed') {
    setS(i, 'Under Repair', 'Diagnosed: ' + f.text, u.name);
  } else {
    setS(i, 'Unable to Resolve', 'Unable to diagnose: ' + f.text, u.name);
    setC(i.cid, 'Faulty');
    nta(i.id, `Technician was unable to diagnose complaint ${i.id}.`, 'Admin review required', 'Unable to Resolve');
  }

  save();
  show(id);
  render();
  return false;
}

/* Technician Submit Repair Result (Section 6 & 7) */
function submitTechRepair(e, id) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const i = I_(id);
  const u = me();
  if (u.role != 'Technician' || i.tech != u.id) return false;

  i.repair = {
    desc: f.desc,
    parts: f.parts,
    remarks: f.remarks,
    date: now(),
    tech: u.id,
    result: f.outcome
  };

  const l = lab(i);
  const facultyId = l?.faculty || null;

  if (f.outcome == 'Issue Corrected') {
    /* Status MUST be Awaiting Faculty Verification (Section 7) */
    setS(i, 'Awaiting Faculty Verification', `Repair completed: ${f.desc}. Awaiting Faculty Verification.`, u.name);

    /* Notify Faculty (Section 8) */
    if (facultyId) {
      nt(
        facultyId,
        i.id,
        `Technician has completed work on ${i.id}.\nPlease verify whether the issue has been corrected.`,
        'Verify issue in laboratory',
        'Awaiting Faculty Verification'
      );
    }

    /* Notify Student */
    nt(
      i.uid,
      i.id,
      `Technician has completed maintenance for complaint ${i.id}. Awaiting faculty laboratory verification.`,
      'Track verification',
      'Awaiting Faculty Verification'
    );
  } else {
    /* Issue Not Corrected */
    setS(i, 'Not Corrected', `Technician reported issue could not be corrected: ${f.remarks || f.desc}`, u.name);
    setC(i.cid, 'Faulty');

    nta(i.id, `Technician reported ${i.id} could not be corrected: ${f.remarks || f.desc}`, 'Reassign or external vendor required', 'Not Corrected');
    if (facultyId) {
      nt(facultyId, i.id, `Technician reported ${i.id} could not be corrected.`, 'Laboratory notice', 'Not Corrected');
    }
  }

  save();
  show(id);
  render();
  return false;
}

/* Faculty Submit Verification (Section 8, 9, 10) */
function submitFacultyVerification(e, id) {
  e.preventDefault();
  const btn = e.submitter;
  const decision = btn.value; // 'Corrected' or 'Not Corrected'
  const f = Object.fromEntries(new FormData(e.target));
  const i = I_(id);
  const u = me();
  if (u.role != 'Faculty') return false;

  const t = now();
  const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  if (decision == 'Corrected') {
    /* Section 9: Mark RESOLVED */
    i.verification = {
      who: u.id,
      name: u.name,
      date: t,
      time: timeStr,
      result: 'Corrected',
      remarks: f.remarks
    };

    setS(i, 'Resolved', `Verified and Resolved by Faculty ${u.name}. Remarks: ${f.remarks}`);
    setC(i.cid, 'Working');

    hist(i, i.repair?.desc || 'Maintenance performed', f.remarks, i.repair?.parts || '', i.tech);

    /* Notify Student (Section 9) */
    nt(
      i.uid,
      i.id,
      `Your computer maintenance complaint ${i.id} has been verified and resolved.`,
      'Complaint Resolved',
      'Resolved'
    );

    /* Notify Technician (Section 9) */
    if (i.tech) {
      nt(
        i.tech,
        i.id,
        `Complaint ${i.id} on ${i.cid} has been verified and marked as Resolved by Faculty ${u.name}.`,
        'Work Completed',
        'Resolved'
      );
    }
  } else {
    /* Section 10: Mark NOT CORRECTED */
    i.verification = {
      who: u.id,
      name: u.name,
      date: t,
      time: timeStr,
      result: 'Not Corrected',
      remarks: f.remarks
    };

    setS(i, 'Not Corrected', `Faculty verification failed: Issue Not Corrected. Remarks: ${f.remarks}`);
    setC(i.cid, 'Faulty');

    /* Auto Report to Admin (Section 10) */
    nta(
      i.id,
      `Faculty has reported that complaint ${i.id} was not correctly resolved.\nReason: ${f.remarks}\nAdmin action required.`,
      'Admin action required',
      'Reported to Admin'
    );
  }

  save();
  show(id);
  render();
  return false;
}

/* Faculty Explicit "Report to Admin" (Section 10) */
function submitFacultyReportToAdmin(e, id) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const i = I_(id);
  const u = me();
  if (u.role != 'Faculty') return false;

  setS(i, 'Reported to Admin', `Reported to Admin by Faculty ${u.name}. Reason: ${f.reason}`);

  nta(
    i.id,
    `Faculty has reported that complaint ${i.id} was not correctly resolved.\nReason: ${f.reason}\nAdmin action required.`,
    'Reassign or instruct technician',
    'Reported to Admin'
  );

  save();
  show(id);
  render();
  return false;
}

/* Admin Assign / Reassign Technician (Section 13) */
function adminAssign(e, id) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const i = I_(id);
  const u = me();
  if (u.role != 'Admin') return false;

  i.tech = f.tech;
  setS(i, 'Assigned', `Assigned to technician ${unm(f.tech)} by Admin`);

  nt(
    f.tech,
    i.id,
    `Complaint ${i.id} on ${i.cid} has been assigned to you by Admin.`,
    'Inspect and repair',
    'Assigned'
  );

  save();
  show(id);
  render();
  return false;
}

/* Admin Send Back to Technician (Section 13) */
function adminSendBack(e, id) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const i = I_(id);
  const u = me();
  if (u.role != 'Admin') return false;

  const directive = f.msg;
  setS(i, 'Reassigned', `Admin Directive to Technician ${unm(i.tech)}: ${directive}`);

  if (i.tech) {
    nt(
      i.tech,
      i.id,
      `Complaint ${i.id} has been sent back by Admin.\nDirective: ${directive}`,
      'Immediate Re-inspection',
      'Reassigned'
    );
  }

  save();
  show(id);
  render();
  return false;
}

/* Admin Direct Force Resolve */
function adminForceResolve(id) {
  const i = I_(id);
  const u = me();
  if (u.role != 'Admin') return;
  if (!confirm('Mark this complaint as resolved by Administrative Authority?')) return;

  setS(i, 'Resolved', 'Marked as Resolved by Administrator ' + u.name);
  setC(i.cid, 'Working');

  nt(i.uid, i.id, `Your complaint ${i.id} has been closed and resolved by Administration.`, 'Resolved', 'Resolved');
  if (i.tech) nt(i.tech, i.id, `Complaint ${i.id} has been marked as Resolved by Admin.`, 'Completed', 'Resolved');

  save();
  show(id);
  render();
}

/* Form modal helper */
function fm(title, fields, cb) {
  FM = cb;
  modal(`
    <h3>${title}</h3>
    <form class="grid" onsubmit="return FS(event)">
      ${fields.map(f => `
        <label>${f[1]}
          ${f[2] == 'select' ? `
            <select name="${f[0]}">${op(f[3])}</select>
          ` : `
            <input name="${f[0]}" type="${f[2] || 'text'}" required>
          `}
        </label>
      `).join('')}
      <button class="w pb" style="margin-top:8px">Save</button>
    </form>
  `);
}

function FS(e) {
  e.preventDefault();
  FM(Object.fromEntries(new FormData(e.target)));
  save();
  cm();
  render();
  return false;
}

/* ==========================================================================
   APPLICATION ROUTER & INITIALIZATION
   ========================================================================== */

function render() {
  odChk();
  const rawHash = location.hash.slice(2) || 'home';
  let page = rawHash.split('?')[0] || 'home';
  const u = me();
  const appEl = $('#app');

  document.body.classList.remove('nav');

  if (!u) {
    appEl.innerHTML = page == 'login' ? login() : home();
    return;
  }
  if (page == 'login' || page == 'home') page = 'dashboard';

  /* Strict Role Authorization Enforcement (Section 20) */
  if (!canAccessPage(page, u.role)) {
    appEl.innerHTML = shell(page, renderAccessDenied());
    return;
  }

  const renderFn = P[page] || P.dashboard;
  appEl.innerHTML = shell(page, renderFn());

  if (page == 'report') {
    lc();
  }
}

window.onhashchange = render;
restoreSession();

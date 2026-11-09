// Employees, departments and login accounts
import { all, batch, first, run, stmt } from '../db.js';
import { fail, readJson } from '../http.js';
import { can, inScope, ROLE_LABELS, scopeSql } from '../permissions.js';
import { checkPasswordRules, setPassword, tempPassword } from '../auth.js';
import { DEFAULT_PASSWORD, photoResponse } from './portal.js';
import { getSettings } from '../settings.js';
import { layout, sendEmail } from '../email.js';
import { clean, esc, isEmail, lower } from '../utils.js';

// ---------------------------------------------------------------- employees
// user_*: the linked login account (System access: Department head / Admin / Super admin)
const EMPLOYEE_SQL = `SELECT e.id, e.emp_no, e.name, e.email, e.department_id, d.name AS department, e.status, e.designation, e.etf_no, e.nic_no, e.phone,
  (e.portal_hash <> '') AS own_password, e.portal_last_login, e.photo_at,
  u.id AS user_id, u.role AS user_role, u.status AS user_status
  FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN users u ON u.employee_id = e.id`;

async function listEmployees(c) {
  const s = scopeSql(c.me, 'e.department_id');
  const [rows, designations, heads] = await Promise.all([
    all(c.env, `${EMPLOYEE_SQL} WHERE ${s.sql} ORDER BY e.emp_no`, ...s.args),
    all(c.env, 'SELECT name FROM designations ORDER BY name COLLATE NOCASE'),
    all(c.env, 'SELECT user_id, department_id FROM department_heads'),
  ]);
  for (const r of rows) {
    const active = r.user_id && r.user_status === 'active';
    r.access = !active ? 'none' : r.user_role === 'super_admin' ? 'super_admin' : r.user_role === 'admin' ? 'admin' : 'head';
    r.head_of = active ? heads.filter((h) => h.user_id === r.user_id).map((h) => h.department_id) : [];
  }
  return { rows, designations: designations.map((d) => d.name) };
}

// ---- System access (Super admin only): an employee who is also a Department head / Admin.
// One person = one login account linked to the employee (users.employee_id), one password, and the
// Employee ⇄ Admin switch in both apps.
const ACCESS_LABEL = { none: 'No system access', head: 'Department head', admin: 'Admin' };

const accessLog = (env, e, userId, access, deptNames, by) => stmt(env,
  'INSERT INTO access_log (employee_id, user_id, emp_name, access, departments, changed_by) VALUES (?, ?, ?, ?, ?, ?)',
  e.id, userId, e.name, access, deptNames, by);

// The login account of an employee: the linked one, else an unlinked one with the same email
async function accountOf(env, e) {
  const linked = await first(env, 'SELECT * FROM users WHERE employee_id = ?', e.id);
  if (linked || !isEmail(e.email)) return linked;
  const byEmail = await first(env, 'SELECT * FROM users WHERE email = ? COLLATE NOCASE', e.email);
  if (byEmail && byEmail.employee_id && byEmail.employee_id !== e.id) fail(400, `The email ${e.email} belongs to the login account of another employee.`);
  return byEmail;
}

// No system access any more: the login is disabled (kept for history), signed out, not head of anything
const removeAccessStatements = (env, userId) => [
  stmt(env, `UPDATE users SET status = 'disabled' WHERE id = ? AND role <> 'super_admin'`, userId),
  stmt(env, `DELETE FROM sessions WHERE user_id = ? AND (SELECT role FROM users WHERE id = ?) <> 'super_admin'`, userId, userId),
  stmt(env, `DELETE FROM department_heads WHERE user_id = ? AND (SELECT role FROM users WHERE id = ?) <> 'super_admin'`, userId, userId),
];

async function setAccess(c) {
  if (!c.me.isSuper) fail(403, 'Only the Super admin can give or remove system access.');
  const { env } = c;
  const id = Number(c.params.id);
  const e = await first(env, 'SELECT * FROM employees WHERE id = ?', id);
  if (!e) fail(404, 'Employee not found.');
  const b = await readJson(c.request);
  const access = String(b.access || '');
  if (!ACCESS_LABEL[access]) fail(400, 'Choose the system access.');
  const deptIds = [...new Set((Array.isArray(b.departments) ? b.departments : []).map(Number).filter(Boolean))];
  const depts = deptIds.length ? await all(env, `SELECT id, name FROM departments WHERE id IN (${deptIds.map(() => '?').join(', ')})`, ...deptIds) : [];
  if (depts.length !== deptIds.length) fail(400, 'A chosen department does not exist any more. Please reload the page.');
  const deptNames = depts.map((d) => d.name).sort().join(', ');

  const u = await accountOf(env, e);
  if (u && u.role === 'super_admin') fail(400, `${e.name} is a Super admin. Change this account on the Login accounts page.`);
  if (u && u.id === c.me.id) fail(400, 'You cannot change your own system access.');

  if (access === 'none') {
    if (!u || u.status !== 'active') return { ok: true, access };
    await batch(env, [stmt(env, 'UPDATE users SET employee_id = ? WHERE id = ?', id, u.id), ...removeAccessStatements(env, u.id),
      accessLog(env, e, u.id, 'none', '', c.me.name)]);
    return { ok: true, access };
  }

  if (e.status !== 'Active') fail(400, `${e.name} is Inactive. Make the employee Active first.`);
  if (!isEmail(e.email)) fail(400, `Add an email for ${e.name} first - it is used to sign in.`);
  if (access === 'head' && !deptIds.length) fail(400, 'Choose the department(s) this head looks after.');
  const designation = access === 'head' ? clean(e.designation).slice(0, 80) : '';

  // One password: the employee's own leave app password if they set one, else the login's, else the default
  let userId = u && u.id;
  let passwordNote = 'They sign in with their usual password.';
  if (u) {
    await run(env, `UPDATE users SET name = ?, email = ?, role = ?, designation = ?, status = 'active', employee_id = ? WHERE id = ?`,
      e.name, lower(e.email), access, designation, id, u.id);
    if (e.portal_hash) {
      await run(env, 'UPDATE users SET password_hash = ?, password_salt = ?, must_change = 0, failed_count = 0, locked_until = NULL WHERE id = ?', e.portal_hash, e.portal_salt, u.id);
    } else if (u.password_hash) {
      await run(env, 'UPDATE employees SET portal_hash = ?, portal_salt = ? WHERE id = ?', u.password_hash, u.password_salt, id);
    } else {
      await setPassword(env, u.id, DEFAULT_PASSWORD, true);
      passwordNote = `First password: ${DEFAULT_PASSWORD} (they choose their own when they sign in).`;
    }
  } else {
    const res = await run(env, `INSERT INTO users (email, name, role, designation, status, must_change, employee_id, password_hash, password_salt)
      VALUES (?, ?, ?, ?, 'active', 0, ?, ?, ?)`, lower(e.email), e.name, access, designation, id, e.portal_hash || '', e.portal_salt || '');
    userId = res.meta.last_row_id;
    if (!e.portal_hash) {
      await setPassword(env, userId, DEFAULT_PASSWORD, true);
      passwordNote = `First password: ${DEFAULT_PASSWORD} (they choose their own when they sign in).`;
    }
  }
  await batch(env, [
    stmt(env, 'DELETE FROM department_heads WHERE user_id = ?', userId),
    ...deptIds.map((d) => stmt(env, 'INSERT INTO department_heads (department_id, user_id) VALUES (?, ?)', d, userId)),
    stmt(env, 'DELETE FROM sessions WHERE user_id = ?', userId),        // the new access applies from the next sign-in
    accessLog(env, e, userId, access, deptNames, c.me.name),
  ]);
  return { ok: true, access, email: lower(e.email), password_note: passwordNote };
}

async function accessHistory(c) {
  if (!c.me.isSuper) fail(403, 'Only the Super admin can see this.');
  return { rows: await all(c.env, `SELECT access, departments, changed_by, created_at FROM access_log WHERE employee_id = ? ORDER BY id DESC LIMIT 50`, Number(c.params.id)) };
}

// Saving an employee keeps the linked login in line: same name and email; Inactive / deleted = no system access
async function linkedAccountStatements(c, id, v, by) {
  const u = await first(c.env, 'SELECT id, role, email, status FROM users WHERE employee_id = ?', id);
  if (!u) return [];
  const out = [];
  if (v) {
    if (lower(u.email) !== v.email) {
      if (!v.email) fail(400, `${v.name} has a system login - the email cannot be empty.`);
      if (await first(c.env, 'SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id <> ?', v.email, u.id)) fail(400, `Email ${v.email} is already used by another login account.`);
    }
    if (v.email) out.push(stmt(c.env, 'UPDATE users SET name = ?, email = ? WHERE id = ?', v.name, v.email, u.id));
  }
  if ((!v || v.status === 'Inactive') && u.role !== 'super_admin' && u.status === 'active') {
    out.push(...removeAccessStatements(c.env, u.id));
    const name = v ? v.name : ((await first(c.env, 'SELECT name FROM employees WHERE id = ?', id)) || {}).name || '';
    out.push(accessLog(c.env, { id, name }, u.id, 'none', '', `${by} (employee ${v ? 'made Inactive' : 'deleted'})`));
  }
  return out;
}

// "clearing executive" typed again uses the list's spelling ("Clearing Executive")
async function listSpelling(env, name) {
  if (!name) return '';
  const hit = await first(env, 'SELECT name FROM designations WHERE name = ? COLLATE NOCASE', name);
  return hit ? hit.name : name;
}

// A designation typed as "<Add New>" joins the list (nothing happens if it is already there)
function rememberDesignation(env, name) {
  return name ? stmt(env, 'INSERT OR IGNORE INTO designations (name) VALUES (?)', name) : null;
}

// An employee's profile photo (chosen by them in the leave request app)
async function employeePhoto(c) {
  const s = scopeSql(c.me, 'department_id');
  const e = await first(c.env, `SELECT photo FROM employees WHERE id = ? AND ${s.sql}`, Number(c.params.id), ...s.args);
  return photoResponse(e && e.photo);
}

// Small list for "apply for another employee"
async function employeeOptions(c) {
  const s = scopeSql(c.me, 'e.department_id');
  return { rows: await all(c.env, `SELECT e.id, e.emp_no, e.name, d.name AS department FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id WHERE e.status = 'Active' AND ${s.sql} ORDER BY e.name`, ...s.args) };
}

function employeeInput(c, b) {
  const v = {
    emp_no: clean(b.emp_no).toUpperCase().replace(/\s+/g, ''),
    name: clean(b.name),
    email: lower(b.email),
    department_id: Number(b.department_id) || null,
    status: b.status === 'Inactive' ? 'Inactive' : 'Active',
    designation: clean(b.designation).replace(/\s+/g, ' ').slice(0, 80),
    etf_no: clean(b.etf_no).toUpperCase().replace(/\s+/g, ''),
    nic_no: clean(b.nic_no).toUpperCase().replace(/\s+/g, ''),
    phone: clean(b.phone).replace(/\s+/g, ' '),
  };
  if (v.etf_no && !/^[A-Z0-9/-]{1,20}$/.test(v.etf_no)) fail(400, 'ETF number: use letters and numbers only (max 20).');
  // Sri Lankan NIC: old 9 digits + V / X (e.g. 851234567V), new 12 digits (e.g. 198512345678)
  if (v.nic_no && !/^(\d{9}[VX]|\d{12})$/.test(v.nic_no)) fail(400, 'NIC number must be 9 digits + V / X (old) or 12 digits (new).');
  if (v.phone && !/^\+?[\d\s-]{9,16}$/.test(v.phone)) fail(400, 'Phone number is not valid (e.g. 077 123 4567 or +94 77 123 4567).');
  if (!v.emp_no || v.emp_no.length > 30) fail(400, 'Employee number is required.');
  if (!v.name || v.name.length > 100) fail(400, 'Name is required.');
  if (v.email && !isEmail(v.email)) fail(400, 'Email is not valid.');
  if (!v.department_id) fail(400, 'Choose a department.');
  if (!inScope(c.me, v.department_id)) fail(403, 'You can only use your own department(s).');
  return v;
}

async function checkEmployeeUnique(env, v, id = 0) {
  if (await first(env, 'SELECT id FROM employees WHERE emp_no = ? COLLATE NOCASE AND id <> ?', v.emp_no, id)) fail(400, `Employee number ${v.emp_no} is already used.`);
  if (v.email && await first(env, 'SELECT id FROM employees WHERE email = ? COLLATE NOCASE AND id <> ?', v.email, id)) fail(400, `Email ${v.email} is already used by another employee.`);
  if (v.nic_no && await first(env, 'SELECT id FROM employees WHERE nic_no = ? AND id <> ?', v.nic_no, id)) fail(400, `NIC ${v.nic_no} is already used by another employee.`);
  if (v.etf_no && await first(env, 'SELECT id FROM employees WHERE etf_no = ? AND id <> ?', v.etf_no, id)) fail(400, `ETF number ${v.etf_no} is already used by another employee.`);
}

async function createEmployee(c) {
  const v = employeeInput(c, await readJson(c.request));
  v.designation = await listSpelling(c.env, v.designation);
  await checkEmployeeUnique(c.env, v);
  const res = await run(c.env, 'INSERT INTO employees (emp_no, name, email, department_id, status, designation, etf_no, nic_no, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    v.emp_no, v.name, v.email, v.department_id, v.status, v.designation, v.etf_no, v.nic_no, v.phone);
  await batch(c.env, [rememberDesignation(c.env, v.designation)]);
  return { id: res.meta.last_row_id };
}

async function updateEmployee(c) {
  const id = Number(c.params.id);
  const old = await first(c.env, 'SELECT * FROM employees WHERE id = ?', id);
  if (!old) fail(404, 'Employee not found.');
  if (!inScope(c.me, old.department_id)) fail(403, 'This employee is not in your department(s).');
  const v = employeeInput(c, await readJson(c.request));
  v.designation = await listSpelling(c.env, v.designation);
  await checkEmployeeUnique(c.env, v, id);
  const dept = await first(c.env, 'SELECT name FROM departments WHERE id = ?', v.department_id);
  const linked = await linkedAccountStatements(c, id, v, c.me.name);
  await batch(c.env, [
    ...linked,
    stmt(c.env, 'UPDATE employees SET emp_no = ?, name = ?, email = ?, department_id = ?, status = ?, designation = ?, etf_no = ?, nic_no = ?, phone = ? WHERE id = ?',
      v.emp_no, v.name, v.email, v.department_id, v.status, v.designation, v.etf_no, v.nic_no, v.phone, id),
    rememberDesignation(c.env, v.designation),
    // keep the requests in line with the employee record
    stmt(c.env, 'UPDATE leave_requests SET emp_no = ?, emp_name = ?, emp_email = ? WHERE employee_id = ?', v.emp_no, v.name, v.email, id),
    stmt(c.env, `UPDATE leave_requests SET department_id = ?, department = ? WHERE employee_id = ? AND status = 'Pending'`, v.department_id, dept ? dept.name : '', id),
  ]);
  return { ok: true };
}

async function deleteEmployee(c) {
  const id = Number(c.params.id);
  const old = await first(c.env, 'SELECT department_id FROM employees WHERE id = ?', id);
  if (!old) fail(404, 'Employee not found.');
  if (!inScope(c.me, old.department_id)) fail(403, 'This employee is not in your department(s).');
  await batch(c.env, [
    ...(await linkedAccountStatements(c, id, null, c.me.name)),     // their system login is disabled too
    stmt(c.env, 'DELETE FROM employees WHERE id = ?', id),          // requests keep the name / number they were saved with
  ]);
  return { ok: true };
}

// ---- employee portal (employees sign in at /request with their email + password)
// Reset = back to the default password (user@123), signed out everywhere, unlocked
async function resetPortalPassword(c) {
  const id = Number(c.params.id);
  const e = await first(c.env, 'SELECT id, emp_no, name, email, department_id FROM employees WHERE id = ?', id);
  if (!e) fail(404, 'Employee not found.');
  if (!inScope(c.me, e.department_id)) fail(403, 'This employee is not in your department(s).');
  const u = await first(c.env, 'SELECT id, role FROM users WHERE employee_id = ?', id);
  if (u && u.role === 'super_admin') fail(400, `${e.name} is a Super admin - reset the password on the Login accounts page.`);
  await batch(c.env, [
    stmt(c.env, `UPDATE employees SET portal_hash = '', portal_salt = '', portal_failed = 0, portal_locked_until = NULL WHERE id = ?`, id),
    stmt(c.env, 'DELETE FROM employee_sessions WHERE employee_id = ?', id),
  ]);
  // one password: their system login also goes back to the default, and must be changed at the next sign-in
  if (u) {
    await setPassword(c.env, u.id, DEFAULT_PASSWORD, true);
    await run(c.env, 'DELETE FROM sessions WHERE user_id = ?', u.id);
  }
  return { ok: true, email: e.email, default_password: DEFAULT_PASSWORD };
}

// rows: [{ emp_no, name, email, department, status }] - adds new employees, updates existing ones (same number)
async function importEmployees(c) {
  const b = await readJson(c.request);
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 2000) : [];
  if (!rows.length) fail(400, 'No rows to import.');
  const depts = await all(c.env, 'SELECT id, name FROM departments');
  const deptId = new Map(depts.map((d) => [d.name.toLowerCase(), d.id]));
  const errors = [];
  let added = 0;
  let updated = 0;
  for (const [i, raw] of rows.entries()) {
    const line = i + 2;
    const deptName = clean(raw.department);
    if (deptName && !deptId.has(deptName.toLowerCase())) {
      if (!c.me.scopeAll || !can(c.me, 'departments.edit')) { errors.push(`Row ${line}: department "${deptName}" does not exist.`); continue; }
      const res = await run(c.env, 'INSERT INTO departments (name) VALUES (?)', deptName);
      deptId.set(deptName.toLowerCase(), res.meta.last_row_id);
    }
    try {
      const v = employeeInput(c, { ...raw, department_id: deptId.get(deptName.toLowerCase()), status: /inactive/i.test(raw.status) ? 'Inactive' : 'Active' });
      const old = await first(c.env, 'SELECT id, department_id FROM employees WHERE emp_no = ? COLLATE NOCASE', v.emp_no);
      if (old && !inScope(c.me, old.department_id)) throw new Error('employee is in another department');
      if (v.email && await first(c.env, 'SELECT id FROM employees WHERE email = ? COLLATE NOCASE AND id <> ?', v.email, old ? old.id : 0)) throw new Error(`email ${v.email} is used by another employee`);
      if (old) {
        await batch(c.env, [
          ...(await linkedAccountStatements(c, old.id, v, `${c.me.name} (import)`)),
          stmt(c.env, 'UPDATE employees SET name = ?, email = ?, department_id = ?, status = ? WHERE id = ?', v.name, v.email, v.department_id, v.status, old.id),
        ]);
        updated++;
      } else {
        await run(c.env, 'INSERT INTO employees (emp_no, name, email, department_id, status) VALUES (?, ?, ?, ?, ?)', v.emp_no, v.name, v.email, v.department_id, v.status);
        added++;
      }
    } catch (err) {
      errors.push(`Row ${line}: ${err.message}`);
    }
  }
  return { added, updated, errors };
}

// ---------------------------------------------------------------- departments
async function listDepartments(c) {
  const s = scopeSql(c.me, 'd.id');
  const [depts, heads] = await Promise.all([
    all(c.env, `SELECT d.id, d.name, (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.status = 'Active') AS employees
                FROM departments d WHERE ${s.sql} ORDER BY d.name`, ...s.args),
    all(c.env, 'SELECT h.department_id, u.id, u.name, u.email FROM department_heads h JOIN users u ON u.id = h.user_id ORDER BY u.name'),
  ]);
  const users = can(c.me, 'departments.edit')
    ? await all(c.env, `SELECT id, name, email FROM users WHERE status = 'active' ORDER BY name`) : [];
  return {
    rows: depts.map((d) => ({ ...d, heads: heads.filter((h) => h.department_id === d.id).map(({ id, name, email }) => ({ id, name, email })) })),
    users,
  };
}

async function saveHeads(env, departmentId, headIds) {
  const ids = [...new Set((Array.isArray(headIds) ? headIds : []).map(Number).filter(Boolean))];
  const statements = [stmt(env, 'DELETE FROM department_heads WHERE department_id = ?', departmentId)];
  for (const id of ids) {
    statements.push(stmt(env, 'INSERT INTO department_heads (department_id, user_id) SELECT ?, id FROM users WHERE id = ?', departmentId, id));
    // a head needs the head permissions: plain employees become "Department head"
    statements.push(stmt(env, `UPDATE users SET role = 'head' WHERE id = ? AND role = 'employee'`, id));
  }
  await batch(env, statements);
}

// New head accounts typed in the department form: { name, email, password }.
// An existing account with that email is just used; otherwise a "Department head" login is made with that password.
async function newHeadIds(c, b) {
  const list = (Array.isArray(b.new_heads) ? b.new_heads : []).filter((h) => h && (clean(h.email) || clean(h.name)));
  if (!list.length) return [];
  if (!can(c.me, 'users.edit')) fail(403, 'You need the "Create and edit login accounts" permission to make head accounts.');
  const ids = [];
  for (const h of list) {
    const email = lower(h.email);
    const name = clean(h.name);
    if (!isEmail(email)) fail(400, `Head email "${h.email || ''}" is not valid.`);
    const old = await first(c.env, 'SELECT id, role FROM users WHERE email = ? COLLATE NOCASE', email);
    if (old) { ids.push(old.id); continue; }
    if (!name) fail(400, `Enter the name of the head (${email}).`);
    checkPasswordRules(h.password);
    const res = await run(c.env, `INSERT INTO users (email, name, role, status, must_change, employee_id) VALUES (?, ?, 'head', 'active', 0, ${FREE_EMPLOYEE_SQL})`, email, name, email);
    await setPassword(c.env, res.meta.last_row_id, h.password, false);
    ids.push(res.meta.last_row_id);
  }
  return ids;
}

async function createDepartment(c) {
  if (!c.me.scopeAll) fail(403, 'Only people who see every department can add departments.');
  const b = await readJson(c.request);
  const name = clean(b.name);
  if (!name || name.length > 80) fail(400, 'Department name is required.');
  if (await first(c.env, 'SELECT id FROM departments WHERE name = ? COLLATE NOCASE', name)) fail(400, 'This department already exists.');
  const extra = await newHeadIds(c, b);
  const res = await run(c.env, 'INSERT INTO departments (name) VALUES (?)', name);
  await saveHeads(c.env, res.meta.last_row_id, [...(b.head_ids || []), ...extra]);
  return { id: res.meta.last_row_id };
}

async function updateDepartment(c) {
  const id = Number(c.params.id);
  if (!inScope(c.me, id)) fail(403, 'This is not your department.');
  const b = await readJson(c.request);
  const name = clean(b.name);
  if (!name || name.length > 80) fail(400, 'Department name is required.');
  if (await first(c.env, 'SELECT id FROM departments WHERE name = ? COLLATE NOCASE AND id <> ?', name, id)) fail(400, 'Another department has this name.');
  const extra = await newHeadIds(c, b);
  b.head_ids = [...(b.head_ids || []), ...extra];
  await batch(c.env, [
    stmt(c.env, 'UPDATE departments SET name = ? WHERE id = ?', name, id),
    stmt(c.env, 'UPDATE leave_requests SET department = ? WHERE department_id = ?', name, id),
  ]);
  await saveHeads(c.env, id, b.head_ids);
  return { ok: true };
}

async function deleteDepartment(c) {
  const id = Number(c.params.id);
  if (!c.me.scopeAll) fail(403, 'Only people who see every department can delete departments.');
  const used = await first(c.env, 'SELECT COUNT(*) AS n FROM employees WHERE department_id = ?', id);
  if (used.n) fail(400, `Move the ${used.n} employee(s) of this department first.`);
  await run(c.env, 'DELETE FROM departments WHERE id = ?', id);
  return { ok: true };
}

// ---------------------------------------------------------------- login accounts
// A new login account is linked to the employee with the same email (if that employee has no login yet)
const FREE_EMPLOYEE_SQL = `(SELECT e.id FROM employees e WHERE e.email <> '' AND e.email = ? COLLATE NOCASE
  AND NOT EXISTS (SELECT 1 FROM users x WHERE x.employee_id = e.id) LIMIT 1)`;

async function listUsers(c) {
  const [users, heads] = await Promise.all([
    all(c.env, `SELECT u.id, u.email, u.name, u.role, u.designation, u.status, u.must_change, u.last_login, u.created_at,
                (SELECT e.emp_no FROM employees e WHERE e.id = u.employee_id) AS emp_no
                FROM users u ORDER BY u.name`),
    all(c.env, 'SELECT h.user_id, d.name FROM department_heads h JOIN departments d ON d.id = h.department_id'),
  ]);
  return {
    roles: ROLE_LABELS,
    rows: users.map((u) => ({ ...u, head_of: heads.filter((h) => h.user_id === u.id).map((h) => h.name) })),
  };
}

// Designation is only kept for Department heads
function designationFor(role, value) {
  const d = clean(value).slice(0, 80);
  return role === 'head' ? d : '';
}

function roleAllowed(me, role) {
  if (!ROLE_LABELS[role]) fail(400, 'Choose a role.');
  if ((role === 'super_admin' || role === 'admin') && !me.isSuper) fail(403, 'Only the Super admin can give the Admin or Super admin role.');
}

async function welcome(c, user, password) {
  const settings = await getSettings(c.env);
  const url = settings.app_url || c.origin;
  return sendEmail(c.env, settings, {
    to: user.email, subject: `Your ${settings.company_name} Leave and Shift Management System account`,
    html: layout(settings, `<p>Hi ${esc(user.name)},</p><p>An account was made for you in the Leave and Shift Management System.</p>
      <p>Open: <a href="${esc(url)}">${esc(url)}</a><br>Email: <b>${esc(user.email)}</b><br>First password: <b>${esc(password)}</b></p>
      <p>You will choose your own password when you sign in the first time.</p>`),
  });
}

async function createUser(c) {
  const b = await readJson(c.request);
  const email = lower(b.email);
  const name = clean(b.name);
  const role = clean(b.role) || 'head';
  if (!isEmail(email)) fail(400, 'Enter a valid email.');
  if (!name) fail(400, 'Enter the name.');
  roleAllowed(c.me, role);
  if (await first(c.env, 'SELECT id FROM users WHERE email = ? COLLATE NOCASE', email)) fail(400, 'An account with this email already exists.');
  const res = await run(c.env, `INSERT INTO users (email, name, role, designation, status, must_change, employee_id) VALUES (?, ?, ?, ?, 'active', 1, ${FREE_EMPLOYEE_SQL})`,
    email, name, role, designationFor(role, b.designation), email);
  const password = tempPassword();
  await setPassword(c.env, res.meta.last_row_id, password, true);
  const emailed = await welcome(c, { email, name }, password);
  return { id: res.meta.last_row_id, tempPassword: password, emailed };
}

async function loadEditableUser(c, id) {
  const u = await first(c.env, 'SELECT * FROM users WHERE id = ?', id);
  if (!u) fail(404, 'Account not found.');
  if ((u.role === 'super_admin' || u.role === 'admin') && !c.me.isSuper) fail(403, 'Only the Super admin can change Admin accounts.');
  return u;
}

async function updateUser(c) {
  const id = Number(c.params.id);
  const u = await loadEditableUser(c, id);
  const b = await readJson(c.request);
  const name = clean(b.name) || u.name;
  const role = clean(b.role) || u.role;
  const status = b.status === 'disabled' ? 'disabled' : 'active';
  roleAllowed(c.me, role);
  if (id === c.me.id && (status === 'disabled' || role !== u.role)) fail(400, 'You cannot disable yourself or change your own role.');
  if (u.role === 'super_admin' && (role !== 'super_admin' || status === 'disabled')) {
    const supers = await first(c.env, `SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin' AND status = 'active'`);
    if (supers.n <= 1) fail(400, 'There must always be at least one active Super admin.');
  }
  const designation = designationFor(role, b.designation === undefined ? u.designation : b.designation);
  await run(c.env, 'UPDATE users SET name = ?, role = ?, designation = ?, status = ? WHERE id = ?', name, role, designation, status, id);
  if (status === 'disabled') await run(c.env, 'DELETE FROM sessions WHERE user_id = ?', id);
  return { ok: true };
}

async function resetUserPassword(c) {
  const id = Number(c.params.id);
  const u = await loadEditableUser(c, id);
  const password = tempPassword();
  await setPassword(c.env, id, password, true);
  await run(c.env, 'DELETE FROM sessions WHERE user_id = ?', id);
  const emailed = await welcome(c, u, password);
  return { tempPassword: password, emailed };
}

async function deleteUser(c) {
  const id = Number(c.params.id);
  const u = await loadEditableUser(c, id);
  if (id === c.me.id) fail(400, 'You cannot delete your own account.');
  // a Super admin can delete another Super admin, but one active Super admin must always remain
  if (u.role === 'super_admin') {
    const others = await first(c.env, `SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin' AND status = 'active' AND id <> ?`, id);
    if (!others.n) fail(400, 'This is the last active Super admin. Make someone else Super admin first.');
  }
  await run(c.env, 'DELETE FROM users WHERE id = ?', id);
  return { ok: true };
}

export default [
  { method: 'GET', path: '/api/employees', perm: 'employees.view', handler: listEmployees },
  { method: 'GET', path: '/api/employees/options', perm: 'leave.apply_others', handler: employeeOptions },
  { method: 'GET', path: '/api/employees/:id/photo', perm: 'employees.view', handler: employeePhoto },
  { method: 'POST', path: '/api/employees', perm: 'employees.edit', handler: createEmployee },
  { method: 'POST', path: '/api/employees/import', perm: 'employees.edit', handler: importEmployees },
  { method: 'POST', path: '/api/employees/:id/portal-reset', perm: 'employees.edit', handler: resetPortalPassword },
  { method: 'PUT', path: '/api/employees/:id', perm: 'employees.edit', handler: updateEmployee },
  { method: 'PUT', path: '/api/employees/:id/access', perm: 'employees.edit', handler: setAccess },
  { method: 'GET', path: '/api/employees/:id/access', perm: 'employees.view', handler: accessHistory },
  { method: 'DELETE', path: '/api/employees/:id', perm: 'employees.delete', handler: deleteEmployee },

  { method: 'GET', path: '/api/departments', perm: 'departments.view', handler: listDepartments },
  { method: 'POST', path: '/api/departments', perm: 'departments.edit', handler: createDepartment },
  { method: 'PUT', path: '/api/departments/:id', perm: 'departments.edit', handler: updateDepartment },
  { method: 'DELETE', path: '/api/departments/:id', perm: 'departments.delete', handler: deleteDepartment },

  { method: 'GET', path: '/api/users', perm: 'users.view', handler: listUsers },
  { method: 'POST', path: '/api/users', perm: 'users.edit', handler: createUser },
  { method: 'PUT', path: '/api/users/:id', perm: 'users.edit', handler: updateUser },
  { method: 'POST', path: '/api/users/:id/reset-password', perm: 'users.edit', handler: resetUserPassword },
  { method: 'DELETE', path: '/api/users/:id', perm: 'users.delete', handler: deleteUser },
];

// Employees, departments and login accounts
import { all, batch, first, run, stmt } from '../db.js';
import { fail, readJson } from '../http.js';
import { can, inScope, ROLE_LABELS, scopeSql } from '../permissions.js';
import { checkPasswordRules, setPassword, tempPassword } from '../auth.js';
import { DEFAULT_PASSWORD, photoResponse } from './portal.js';
import { getSettings } from '../settings.js';
import { layout, sendEmail } from '../email.js';
import { clean, esc, isDate, isEmail, lower } from '../utils.js';

// ---------------------------------------------------------------- employees
const EMPLOYEE_SQL = `SELECT e.id, e.emp_no, e.name, e.email, e.department_id, d.name AS department, e.status, e.birthday,
  (e.portal_hash <> '') AS own_password, e.portal_last_login, e.photo_at,
  (SELECT u.id FROM users u WHERE e.email <> '' AND u.email = e.email COLLATE NOCASE) AS user_id
  FROM employees e LEFT JOIN departments d ON d.id = e.department_id`;

async function listEmployees(c) {
  const s = scopeSql(c.me, 'e.department_id');
  return { rows: await all(c.env, `${EMPLOYEE_SQL} WHERE ${s.sql} ORDER BY e.emp_no`, ...s.args) };
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
    birthday: clean(b.birthday),
  };
  if (v.birthday && !isDate(v.birthday)) fail(400, 'Birthday is not a valid date.');
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
}

async function createEmployee(c) {
  const v = employeeInput(c, await readJson(c.request));
  await checkEmployeeUnique(c.env, v);
  const res = await run(c.env, 'INSERT INTO employees (emp_no, name, email, department_id, status, birthday) VALUES (?, ?, ?, ?, ?, ?)',
    v.emp_no, v.name, v.email, v.department_id, v.status, v.birthday);
  return { id: res.meta.last_row_id };
}

async function updateEmployee(c) {
  const id = Number(c.params.id);
  const old = await first(c.env, 'SELECT * FROM employees WHERE id = ?', id);
  if (!old) fail(404, 'Employee not found.');
  if (!inScope(c.me, old.department_id)) fail(403, 'This employee is not in your department(s).');
  const v = employeeInput(c, await readJson(c.request));
  await checkEmployeeUnique(c.env, v, id);
  const dept = await first(c.env, 'SELECT name FROM departments WHERE id = ?', v.department_id);
  await batch(c.env, [
    stmt(c.env, 'UPDATE employees SET emp_no = ?, name = ?, email = ?, department_id = ?, status = ?, birthday = ? WHERE id = ?',
      v.emp_no, v.name, v.email, v.department_id, v.status, v.birthday, id),
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
  await run(c.env, 'DELETE FROM employees WHERE id = ?', id);     // requests keep the name / number they were saved with
  return { ok: true };
}

// ---- employee portal (employees sign in at /request with their email + password)
// Reset = back to the default password (user@123), signed out everywhere, unlocked
async function resetPortalPassword(c) {
  const id = Number(c.params.id);
  const e = await first(c.env, 'SELECT id, emp_no, name, email, department_id FROM employees WHERE id = ?', id);
  if (!e) fail(404, 'Employee not found.');
  if (!inScope(c.me, e.department_id)) fail(403, 'This employee is not in your department(s).');
  await batch(c.env, [
    stmt(c.env, `UPDATE employees SET portal_hash = '', portal_salt = '', portal_failed = 0, portal_locked_until = NULL WHERE id = ?`, id),
    stmt(c.env, 'DELETE FROM employee_sessions WHERE employee_id = ?', id),
  ]);
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
        await run(c.env, 'UPDATE employees SET name = ?, email = ?, department_id = ?, status = ? WHERE id = ?', v.name, v.email, v.department_id, v.status, old.id);
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
    const res = await run(c.env, `INSERT INTO users (email, name, role, status, must_change) VALUES (?, ?, 'head', 'active', 0)`, email, name);
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
async function listUsers(c) {
  const [users, heads] = await Promise.all([
    all(c.env, `SELECT u.id, u.email, u.name, u.role, u.status, u.must_change, u.last_login, u.created_at,
                (SELECT e.emp_no FROM employees e WHERE e.email <> '' AND e.email = u.email COLLATE NOCASE) AS emp_no
                FROM users u ORDER BY u.name`),
    all(c.env, 'SELECT h.user_id, d.name FROM department_heads h JOIN departments d ON d.id = h.department_id'),
  ]);
  return {
    roles: ROLE_LABELS,
    rows: users.map((u) => ({ ...u, head_of: heads.filter((h) => h.user_id === u.id).map((h) => h.name) })),
  };
}

function roleAllowed(me, role) {
  if (!ROLE_LABELS[role]) fail(400, 'Choose a role.');
  if ((role === 'super_admin' || role === 'admin') && !me.isSuper) fail(403, 'Only the Super admin can give the Admin or Super admin role.');
}

async function welcome(c, user, password) {
  const settings = await getSettings(c.env);
  const url = settings.app_url || c.origin;
  return sendEmail(c.env, settings, {
    to: user.email, subject: `Your ${settings.company_name} Leave System account`,
    html: layout(settings, `<p>Hi ${esc(user.name)},</p><p>An account was made for you in the Leave System.</p>
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
  const res = await run(c.env, `INSERT INTO users (email, name, role, status, must_change) VALUES (?, ?, ?, 'active', 1)`, email, name, role);
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
  await run(c.env, 'UPDATE users SET name = ?, role = ?, status = ? WHERE id = ?', name, role, status, id);
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

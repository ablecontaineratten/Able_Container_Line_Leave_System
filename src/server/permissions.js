// What each role may see and do. The Super admin can always do everything.
// d = default for [admin, head] (a third number is ignored); changes are saved in the "permissions" table.
import { all, batch, stmt } from './db.js';
import { fail } from './http.js';

// The main system's roles (employees use the leave request app, not the system)
export const ROLES = ['admin', 'head'];
export const ROLE_LABELS = { super_admin: 'Super admin', admin: 'Admin', head: 'Department head' };

export const PERMS = [
  { key: 'scope.all',          group: 'Visibility', label: 'See every department (not only their own)',           d: [1, 0, 0] },
  { key: 'mine.view',          group: 'Leave',      label: 'See own leave and balance',                           d: [1, 1, 1] },
  { key: 'leave.apply',        group: 'Leave',      label: 'Apply for leave',                                     d: [1, 1, 1] },
  { key: 'leave.apply_others', group: 'Leave',      label: 'Apply for leave for another employee',                d: [1, 0, 0] },
  { key: 'leave.past_dates',   group: 'Leave',      label: 'Use leave dates before today',                        d: [1, 0, 0] },
  { key: 'approve.decide',     group: 'Leave',      label: 'Approve or reject pending requests',                  d: [1, 1, 0] },
  { key: 'requests.view',      group: 'Leave',      label: 'See all requests',                                    d: [1, 1, 0] },
  { key: 'requests.cancel',    group: 'Leave',      label: 'Cancel approved leave',                               d: [1, 1, 0] },
  { key: 'requests.manage',    group: 'Leave',      label: 'Change any status (also system rejections)',          d: [1, 0, 0] },
  { key: 'requests.delete',    group: 'Leave',      label: 'Delete leave requests',                               d: [0, 0, 0] },
  { key: 'team.view',          group: 'Reports',    label: 'See Leave balance',                                   d: [1, 1, 0] },
  { key: 'summary.view',       group: 'Reports',    label: 'See the Leave Chart (all leave dates)',               d: [1, 1, 0] },
  { key: 'summary.edit',       group: 'Reports',    label: 'Edit the Leave Chart (add / remove leave dates)',     d: [0, 0, 0] },
  { key: 'calendar.view',      group: 'Reports',    label: 'See the leave calendar',                              d: [1, 1, 1] },
  { key: 'reports.view',       group: 'Reports',    label: 'See leave reports',                                   d: [1, 1, 0] },
  { key: 'employees.view',     group: 'People',     label: 'See employees',                                       d: [1, 1, 0] },
  { key: 'employees.edit',     group: 'People',     label: 'Add, edit and import employees',                      d: [1, 0, 0] },
  { key: 'employees.delete',   group: 'People',     label: 'Delete employees',                                    d: [0, 0, 0] },
  { key: 'departments.view',   group: 'People',     label: 'See departments',                                     d: [1, 1, 0] },
  { key: 'departments.edit',   group: 'People',     label: 'Add and edit departments and heads',                  d: [1, 0, 0] },
  { key: 'departments.delete', group: 'People',     label: 'Delete departments',                                  d: [0, 0, 0] },
  { key: 'users.view',         group: 'Accounts',   label: 'See login accounts',                                  d: [1, 0, 0] },
  { key: 'users.edit',         group: 'Accounts',   label: 'Create and edit login accounts, reset passwords',     d: [1, 0, 0] },
  { key: 'users.delete',       group: 'Accounts',   label: 'Delete login accounts',                               d: [0, 0, 0] },
  { key: 'settings.view',      group: 'System',     label: 'See settings, leave types and holidays',              d: [1, 0, 0] },
  { key: 'settings.edit',      group: 'System',     label: 'Change settings, leave types and holidays',           d: [1, 0, 0] },
];

// rows from the permissions table -> { key: { admin, head, employee } }
export function accessFromRows(rows) {
  const out = {};
  for (const p of PERMS) {
    out[p.key] = {};
    ROLES.forEach((r, i) => { out[p.key][r] = !!p.d[i]; });
  }
  for (const r of rows || []) {
    if (out[r.perm_key] && ROLES.includes(r.role)) out[r.perm_key][r.role] = !!r.allowed;
  }
  return out;
}

export async function getAccess(env) {
  return accessFromRows(await all(env, 'SELECT perm_key, role, allowed FROM permissions'));
}

export async function saveAccess(env, matrix) {
  const statements = [stmt(env, 'DELETE FROM permissions')];
  for (const p of PERMS) {
    ROLES.forEach((r, i) => {
      const allowed = !!(matrix && matrix[p.key] && matrix[p.key][r]);
      if (allowed !== !!p.d[i]) {
        statements.push(stmt(env, 'INSERT INTO permissions (perm_key, role, allowed) VALUES (?, ?, ?)', p.key, r, allowed ? 1 : 0));
      }
    });
  }
  await batch(env, statements);
  return getAccess(env);
}

export function permsFor(role, access) {
  const isSuper = role === 'super_admin';
  const out = {};
  for (const p of PERMS) out[p.key] = isSuper || !!(access[p.key] && access[p.key][role]);
  out['access.edit'] = isSuper;
  return out;
}

export const can = (me, key) => !!(me && me.perms && me.perms[key]);

// key can be one permission or a list (any of them is enough)
export function requirePerm(me, key) {
  const keys = Array.isArray(key) ? key : [key];
  if (!keys.some((k) => can(me, k))) fail(403, 'You do not have access to do this. Please ask an admin.');
}

export const inScope = (me, departmentId) => me.scopeAll || me.deptIds.includes(Number(departmentId));

// SQL condition limiting rows to the departments this person may see
export function scopeSql(me, column = 'department_id') {
  if (me.scopeAll) return { sql: '1 = 1', args: [] };
  if (!me.deptIds.length) return { sql: '1 = 0', args: [] };
  return { sql: `${column} IN (${me.deptIds.map(() => '?').join(', ')})`, args: [...me.deptIds] };
}

// Employee ⇄ Admin switch, for an employee who is also a Department head / Admin (one person, one sign-in).
// Shown at the top of the system ('/') and of the leave app ('/request/'); the last mode is remembered on
// this device and opens after the next sign-in (the first time: Admin).
const KEY = 'acl_mode';

export function storedMode() {
  try { return localStorage.getItem(KEY) === 'emp' ? 'emp' : 'admin'; } catch { return 'admin'; }
}

export function rememberMode(mode) {
  try { localStorage.setItem(KEY, mode === 'emp' ? 'emp' : 'admin'); } catch { /* private mode */ }
}

// pending = requests waiting for this person's decision (a small red count on "Admin")
export function modeSwitchHtml(active, pending = 0) {
  const btn = (mode, label, extra = '') => `<button type="button" data-mode="${mode}" class="${active === mode ? 'on' : ''}"
    aria-pressed="${active === mode}">${label}${extra}</button>`;
  const count = pending ? `<em aria-label="${pending} waiting">${pending > 99 ? '99+' : pending}</em>` : '';
  return `<div class="mode-switch" role="group" aria-label="Switch between Employee and Admin">${btn('emp', 'Employee')}${btn('admin', 'Admin', count)}</div>`;
}

// go(mode) opens the other app; if it fails, the switch goes back and onError gets the message
export function wireModeSwitch(scope, active, go, onError = (msg) => alert(msg)) {
  scope.querySelectorAll('.mode-switch').forEach((box) => box.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', async () => {
    const mode = b.dataset.mode;
    if (mode === active || box.classList.contains('busy')) return;
    const mark = (m) => box.querySelectorAll('[data-mode]').forEach((x) => { x.classList.toggle('on', x.dataset.mode === m); x.setAttribute('aria-pressed', String(x.dataset.mode === m)); });
    mark(mode);
    box.classList.add('busy');
    rememberMode(mode);
    try {
      await go(mode);
    } catch (err) {
      mark(active);
      rememberMode(active);
      box.classList.remove('busy');
      onError(err.message || 'Could not switch. Please try again.');
    }
  })));
}

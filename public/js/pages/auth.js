// Sign in, forgot password, first-time setup and "choose your own password"
import { post } from '../api.js';
import { $, esc } from '../ui.js';

// The company video plays full screen under a soft blue / violet glow; the form sits in the middle as glass
function frame(root, brand, title, sub, inner) {
  const b = brand || {};
  const company = esc(b.company_name || 'Leave System');
  root.innerHTML = `<div class="auth3">
    <div class="auth3-glow" aria-hidden="true"><i></i><i></i><i></i></div>
    <img class="trial-stamp auth3-trial" src="/img/trial-stamp.svg" alt="Trial version">
    <main class="auth3-box">
      <div class="auth3-logo" role="img" aria-label="${company} logo"><img src="/img/logo-white.svg" alt=""><span class="auth3-shine"></span></div>
      <p class="auth3-tag">${company} · Leave System</p>
      <h1>${esc(title)}</h1>${sub ? `<p class="auth3-sub">${sub}</p>` : ''}
      ${inner}
    </main>
    <p class="auth3-foot">© ${new Date().getFullYear()} ${company} · Online leave management system</p>
  </div>`;
  const v = root.querySelector('video');
  if (v) v.play().catch(() => {});
  root.querySelectorAll('input[type=password]').forEach(addEye);
}

// eye button inside a password box: show / hide what was typed
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.9 17.9A10.1 10.1 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22"/></svg>';
function addEye(input) {
  const wrap = document.createElement('span');
  wrap.className = 'pw-wrap';
  input.replaceWith(wrap);
  wrap.append(input);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pw-eye';
  const draw = () => {
    const shown = input.type === 'text';
    btn.innerHTML = shown ? EYE_OFF : EYE;
    btn.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
    btn.setAttribute('aria-pressed', String(shown));
  };
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    input.type = input.type === 'password' ? 'text' : 'password';
    draw();
    input.focus();
  });
  draw();
  wrap.append(btn);
}
// Submits a form, shows the server error in .form-error
function handle(form, fn) {
  const err = $('.form-error', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      await fn(Object.fromEntries(new FormData(form)));
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });
}

export function renderLogin(root, brand, onDone) {
  frame(root, brand, 'Sign in', '', `
    <form class="stack" id="login-form">
      <label class="pill-field"><span class="sr-only">Email address</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>
        <input type="email" name="email" autocomplete="username" placeholder="Email address" required></label>
      <label class="pill-field"><span class="sr-only">Password</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
        <input type="password" name="password" autocomplete="current-password" placeholder="Password" required></label>
      <div class="auth3-row">
        <label class="auth3-check"><input type="checkbox" name="remember" checked><i aria-hidden="true"></i>Keep me logged in</label>
        <button class="link" type="button" id="forgot-link">Forgot password?</button>
      </div>
      <p class="form-error" hidden></p>
      <button class="auth3-btn" type="submit">Sign in</button>
    </form>`);
  const form = $('#login-form');
  form.email.focus();
  // one sign-in for everyone: the server says which app this person uses
  handle(form, async (v) => {
    const res = await post('/auth/signin', { ...v, remember: form.remember.checked });
    if (res.target && res.target !== '/') location.href = res.target;
    else onDone();
  });
  $('#forgot-link').addEventListener('click', () => renderForgot(root, brand, onDone, form.email.value));
}

function renderForgot(root, brand, onDone, email = '') {
  frame(root, brand, 'Reset password', 'We will email you a 6-digit code.', `
    <form class="stack" id="forgot-form">
      <label class="field"><span>Email</span><input type="email" name="email" value="${esc(email)}" required></label>
      <p class="form-error" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Send code</button>
      <button class="link" type="button" data-back>Back to sign in</button>
    </form>`);
  $('[data-back]').addEventListener('click', () => renderLogin(root, brand, onDone));
  handle($('#forgot-form'), async (v) => {
    await post('/auth/forgot', v);
    frame(root, brand, 'Enter the code', `If <b>${esc(v.email)}</b> has an account, a code was sent. It works for 15 minutes.`, `
      <form class="stack" id="reset-form">
        <input type="hidden" name="email" value="${esc(v.email)}">
        <label class="field"><span>6-digit code</span><input name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required></label>
        <label class="field"><span>New password</span><input type="password" name="password" autocomplete="new-password" required>
          <small>At least 8 characters, letters and numbers.</small></label>
        <p class="form-error" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">Save new password</button>
        <button class="link" type="button" data-back>Back to sign in</button>
      </form>`);
    $('[data-back]').addEventListener('click', () => renderLogin(root, brand, onDone));
    handle($('#reset-form'), async (r) => {
      await post('/auth/reset', r);
      await post('/auth/signin', { email: r.email, password: r.password });
      onDone();
    });
  });
}

export function renderSetup(root, brand, onDone) {
  frame(root, brand, 'Welcome! First-time setup', 'Create the <b>Super admin</b> account. This person can do everything in the system.', `
    <form class="stack" id="setup-form">
      <label class="field"><span>Company name</span><input name="company_name" value="${esc((brand && brand.company_name) || '')}" required></label>
      <label class="field"><span>Your name</span><input name="name" required></label>
      <label class="field"><span>Your email</span><input type="email" name="email" autocomplete="username" required></label>
      <label class="field"><span>Password</span><input type="password" name="password" autocomplete="new-password" required>
        <small>At least 8 characters, letters and numbers.</small></label>
      <p class="form-error" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Create Super admin</button>
    </form>`);
  handle($('#setup-form'), async (v) => { await post('/setup', v); onDone(); });
}

export function renderForceChange(root, brand, onDone) {
  frame(root, brand, 'Choose your own password', 'This is your first sign in (or your password was reset). Please choose a new password.', `
    <form class="stack" id="pw-form">
      <label class="field"><span>Current (temporary) password</span><input type="password" name="current" autocomplete="current-password" required></label>
      <label class="field"><span>New password</span><input type="password" name="password" autocomplete="new-password" required>
        <small>At least 8 characters, letters and numbers.</small></label>
      <label class="field"><span>New password again</span><input type="password" name="again" autocomplete="new-password" required></label>
      <p class="form-error" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Save password</button>
      <button class="link" type="button" id="out">Sign out</button>
    </form>`);
  $('#out').addEventListener('click', async () => { await post('/auth/logout').catch(() => {}); location.reload(); });
  handle($('#pw-form'), async (v) => {
    if (v.password !== v.again) throw new Error('The two new passwords are not the same.');
    await post('/auth/password', { current: v.current, password: v.password });
    onDone();
  });
}

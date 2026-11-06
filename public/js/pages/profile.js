// My account: who I am and change password
import { post } from '../api.js';
import { $, esc, pageHead, toast } from '../ui.js';
import { notificationSettings } from '../push.js';

export default async function render(view, ctx) {
  const { me } = ctx.state;
  const line = (k, v) => `<div class="kv"><span>${esc(k)}</span><div>${v}</div></div>`;
  view.innerHTML = `${pageHead('My account')}
    <div class="grid-2">
      <section class="card"><h2>Details</h2><div class="details">
        ${line('Name', esc(me.name))}
        ${line('Email', esc(me.email))}
        ${line('Role', esc(me.roleLabel))}
        ${me.employee ? line('Employee', `${esc(me.employee.emp_no)} · ${esc(me.employee.department || '-')}`) : line('Employee', '<span class="muted">Not linked</span>')}
        ${me.headOf.length ? line('Head of', esc(me.headOf.map((d) => d.name).join(', '))) : ''}
      </div></section>
      <section class="card"><h2>Change password</h2>
        <form class="stack" id="pw-form">
          <label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label>
          <label class="field"><span>New password</span><input type="password" name="password" autocomplete="new-password" required>
            <small>At least 8 characters, letters and numbers.</small></label>
          <label class="field"><span>New password again</span><input type="password" name="again" autocomplete="new-password" required></label>
          <p class="form-error" hidden></p>
          <div><button class="btn btn-primary" type="submit">Change password</button></div>
        </form></section>
    </div>
    <div id="notif-settings"></div>`;
  notificationSettings($('#notif-settings'), { post, toast });
  const form = $('#pw-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    err.hidden = true;
    try {
      if (form.password.value !== form.again.value) throw new Error('The two new passwords are not the same.');
      await post('/auth/password', { current: form.current.value, password: form.password.value });
      form.reset();
      toast('Password changed. Other devices were signed out.');
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
}

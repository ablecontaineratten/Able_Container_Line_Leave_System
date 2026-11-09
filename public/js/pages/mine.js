// My Leave · Balance · Profile for a head / admin / super admin who is also an employee:
// the SAME screens as the employee app (components/emp-app.js), inside the system page.
import { post } from '../api.js';
import { toast } from '../ui.js';
import { showEmbedded } from '../components/emp-app.js';

const PATH = { home: 'my-leave', balance: 'balance', profile: 'me' };
const SCREEN = { 'my-leave': 'home', balance: 'balance', me: 'profile' };
const currentScreen = () => SCREEN[(location.hash.replace(/^#\/?/, '') || 'home').split('?')[0]] || '';

// the leave app session of the same person (opened once per page load; no second sign-in)
let session = null;
const ensureSession = () => (session ||= post('/auth/my-session').catch((err) => { session = null; throw err; }));

export const mineScreen = (screen) => async (view, ctx) => {
  if (!ctx.state.me.employee) {
    view.innerHTML = '<div class="notice">Your login is not linked to an employee record. Please ask the Super admin.</div>';
    return;
  }
  await ensureSession();
  if (!ctx.isCurrent()) return;
  await showEmbedded(view, screen, {
    screen: currentScreen,
    go: (s) => ctx.go(PATH[s]),
    signOut: () => { location.hash = ''; location.reload(); },
    signedOut: () => { session = null; toast('Please try again.', 'error'); },
  });
};

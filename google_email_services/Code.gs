/**
 * Code.gs  -  Email sender for the Leave System (Google Sheet + Apps Script)
 *
 * The Leave System (Cloudflare) sends each email here; this script sends it with Gmail
 * and writes a row in the "Email Log" sheet. Nothing else is stored.
 *
 * Setup (see GUIDE.md in this folder):
 *   1. Run  setup   (makes the log sheet + the secret key, sends you a test email)
 *   2. Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone → Deploy
 *   3. Put the Web app URL and the secret key in Cloudflare (GOOGLE_MAIL_URL, GOOGLE_MAIL_SECRET)
 */

const LOG_SHEET = 'Email Log';
const LOG_HEAD = ['Time', 'To', 'Subject', 'Status', 'Details'];
const MAX_RECIPIENTS = 20;                  // one request never needs more

// ---------------------------------------------------------------- run once from the editor
function setup() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('EMAIL_SECRET');
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('EMAIL_SECRET', secret);
  }
  logSheet_();
  const me = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({
    to: me,
    subject: 'Leave System email service is ready',
    htmlBody: '<p>The Google email service for the Leave System is set up.</p><p>Next: deploy it as a Web app (see GUIDE.md).</p>',
    name: 'Leave System',
  });
  Logger.log('READY.\n\nSecret key (GOOGLE_MAIL_SECRET):\n' + secret +
    '\n\nEmails left today: ' + MailApp.getRemainingDailyQuota() +
    '\nA test email was sent to ' + me + '.\nNext: Deploy → New deployment → Web app.');
}

// Shows the secret key again if you lose it
function showSecret() {
  Logger.log('GOOGLE_MAIL_SECRET:\n' + PropertiesService.getScriptProperties().getProperty('EMAIL_SECRET'));
}

// ---------------------------------------------------------------- web app
// Health check: opening the Web app URL in a browser shows that it works (no secret needed, nothing sent)
function doGet() {
  return json_({ ok: true, service: 'Leave System email', remaining_today: MailApp.getRemainingDailyQuota() });
}

// The Leave System posts: { secret, to: [..], subject, html, name, replyTo }
function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  const secret = PropertiesService.getScriptProperties().getProperty('EMAIL_SECRET');
  if (!secret || body.secret !== secret) return json_({ ok: false, error: 'Wrong secret' });

  const to = [].concat(body.to || []).map(String).map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  const subject = String(body.subject || '').slice(0, 250);
  if (!to.length || !subject) return json_({ ok: false, error: 'Missing to or subject' });
  if (to.length > MAX_RECIPIENTS) return json_({ ok: false, error: 'Too many recipients' });
  if (MailApp.getRemainingDailyQuota() < to.length) {
    log_(to, subject, 'FAILED', 'Daily Gmail limit reached');
    return json_({ ok: false, error: 'Daily Gmail sending limit reached. Emails start again tomorrow.' });
  }

  try {
    const mail = { to: to.join(','), subject: subject, htmlBody: String(body.html || ''), name: String(body.name || 'Leave System').slice(0, 80) };
    if (body.replyTo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.replyTo))) mail.replyTo = String(body.replyTo);
    MailApp.sendEmail(mail);
    log_(to, subject, 'Sent', '');
    return json_({ ok: true, sent: to.length, remaining_today: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    log_(to, subject, 'FAILED', String(err && err.message || err));
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------------------------------------------------------------- helpers
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function logSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.getRange(1, 1, 1, LOG_HEAD.length).setValues([LOG_HEAD]).setFontWeight('bold').setBackground('#1f2a7a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 260); sh.setColumnWidth(3, 380); sh.setColumnWidth(5, 300);
  }
  return sh;
}

function log_(to, subject, status, details) {
  try {
    const sh = logSheet_();
    sh.appendRow([new Date(), to.join(', '), subject, status, details]);
    if (sh.getLastRow() > 5001) sh.deleteRows(2, sh.getLastRow() - 5001);      // keep the last 5000 rows
  } catch (err) { /* logging must never stop an email */ }
}

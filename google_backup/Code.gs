/**
 * Code.gs  -  Google Sheet backup for the Leave and Shift Management System
 *
 * The system sends all its data here (one tab per page) and this script writes it into THIS Google Sheet.
 * After the first sync the system sends the data again after every change, so the sheet stays up to date.
 *
 * Setup (see GUIDE.md in this folder):
 *   1. Run  setup   once (makes the secret key + the "Sync Log" tab)
 *   2. Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone → Deploy
 *   3. In the system: Settings → General → Google Sheet Backup → paste the Web app URL + the secret key → First-time sync
 */

const LOG_TAB = 'Sync Log';
const HEADER_BG = '#28398a';

// ---------------------------------------------------------------- run once from the editor
function setup() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('BACKUP_SECRET');
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('BACKUP_SECRET', secret);
  }
  logSheet_();
  // hourly timer for scheduled syncs (Every hour / Every day). The system decides if a sync is due.
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'scheduledSync') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('scheduledSync').timeBased().everyHours(1).create();
  Logger.log('READY.\n\nSecret key (paste it in the system):\n' + secret +
    '\n\nNext: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).');
}

// Shows the secret key again if you lose it
function showSecret() {
  Logger.log('Secret key:\n' + PropertiesService.getScriptProperties().getProperty('BACKUP_SECRET'));
}

// ---------------------------------------------------------------- web app
// Health check: opening the Web app URL in a browser shows that it works (nothing is changed)
function doGet() {
  return json_({ ok: true, service: 'Leave System backup', sheet: SpreadsheetApp.getActive().getName() });
}

// The system posts: { secret, type, first, tabs: { 'Employees': [[header...], [row...]], ... } }
function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  const secret = PropertiesService.getScriptProperties().getProperty('BACKUP_SECRET');
  if (!secret || body.secret !== secret) return json_({ ok: false, error: 'Wrong secret key' });
  if (!body.tabs || typeof body.tabs !== 'object') return json_({ ok: false, error: 'No data' });

  if (body.system_url && /^https:\/\//.test(body.system_url)) {      // remembered for the hourly scheduled sync
    PropertiesService.getScriptProperties().setProperty('SYSTEM_URL', String(body.system_url).replace(/\/+$/, ''));
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return json_({ ok: false, error: 'Another sync is running, try again' });
  try {
    const ss = SpreadsheetApp.getActive();
    let rows = 0;
    Object.keys(body.tabs).forEach(function (name) {
      const data = body.tabs[name] || [];
      rows += Math.max(data.length - 1, 0);
      writeTab_(ss, name, data, body.headerRows && body.headerRows[name] ? body.headerRows[name] : 1);
    });
    if (body.first) {                       // first time: remove the empty "Sheet1" the new file came with
      const blank = ss.getSheetByName('Sheet1');
      if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
    }
    log_(body.type || 'Sync', 'OK', rows);
    return json_({ ok: true, rows: rows, sheet: ss.getName(), url: ss.getUrl() });
  } catch (err) {
    log_(body.type || 'Sync', 'FAILED: ' + (err && err.message || err), '');
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// Runs every hour (made by setup): asks the system "is a sync due?" - if yes the system sends the data
function scheduledSync() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SYSTEM_URL');
  const secret = props.getProperty('BACKUP_SECRET');
  if (!url || !secret) return;
  try {
    UrlFetchApp.fetch(url + '/api/backup/tick', {
      method: 'post', contentType: 'application/json', payload: JSON.stringify({ secret: secret }), muteHttpExceptions: true,
    });
  } catch (err) { log_('Scheduled check', 'FAILED: ' + (err && err.message || err), ''); }
}

// ---------------------------------------------------------------- helpers
function writeTab_(ss, name, data, headerRows) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearContents();
  if (!data.length) return;
  const width = data.reduce(function (n, r) { return Math.max(n, r.length); }, 1);
  const values = data.map(function (r) {
    const row = r.map(function (v) { return v === null || v === undefined ? '' : v; });
    while (row.length < width) row.push('');
    return row;
  });
  sh.getRange(1, 1, values.length, width).setValues(values);
  const head = sh.getRange(headerRows, 1, 1, width);
  head.setFontWeight('bold').setBackground(HEADER_BG).setFontColor('#ffffff');
  sh.setFrozenRows(headerRows);
}

function logSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(LOG_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['Time', 'Type', 'Result', 'Rows']]).setFontWeight('bold').setBackground(HEADER_BG).setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 170); sh.setColumnWidth(3, 320);
  }
  return sh;
}

function log_(type, result, rows) {
  try {
    const sh = logSheet_();
    sh.appendRow([new Date(), type, result, rows]);
    if (sh.getLastRow() > 2001) sh.deleteRows(2, sh.getLastRow() - 2001);      // keep the last 2000 syncs
  } catch (err) { /* logging must never stop a sync */ }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

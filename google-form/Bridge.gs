/**
 * Bridge.gs  -  connects the EXISTING Google leave form (same link) to the new Leave Management System.
 *
 * What it does
 *   - Every form answer is sent to the new system, which checks it (balance, weekends, holidays, same days twice,
 *     number/name match), saves it and emails the department head(s) with Approve / Reject buttons.
 *     When something is wrong, the employee gets a red "request NOT sent" email instead.
 *   - Every hour the Employee Name / Employee Number / Leave Type lists in the form are refreshed
 *     from the new system, so new employees and leave types appear by themselves.
 *
 * Setup (one time) - see GUIDE.md part 6A:
 *   1. https://script.google.com → New project → paste this file.
 *   2. Project Settings → Script Properties: add  LMS_URL  and  LMS_FORM_SECRET.
 *   3. Select  createLeaveForm  next to Run → Run → allow the permissions.
 *      It creates the NEW form, connects it and writes the link in the log (View → Logs / Execution log).
 */

// 'verified' = email taken from the employee's Google sign-in (they must be signed in to Google)
// 'typed'    = employee types their email (works without a Google account)
const BRIDGE_EMAIL_MODE = 'typed';

const BRIDGE_Q = {
  NAME: 'Employee Name', EMPNO: 'Employee Number', EMP: 'Employee (Number - Name)', EMAIL: 'Employee Email',
  TYPE: 'Leave Type', DATE: 'Leave Date', TO_OLD: 'To Date (only if more than 1 day)', HALF_OLD: 'Half day or not?',
  OUT: 'Out Time (Short Leave only)', RET: 'Return Time (Short Leave only)', REASON: 'Reason',
  HOWMANY: 'How many days?', DAYTYPE: 'Full or half day?', FROMR: 'From Date', TOR: 'To Date',
  DATES: ['Date 1', 'Date 2', 'Date 3', 'Date 4'],
};
const BRIDGE_NO_EMP = '(no employees yet - ask the admin)';
const BRIDGE_FAILED = 'LMS_FAILED';            // answers that could not reach the system (sent again by resendFailed)

// ---------------------------------------------------------------- create the form (run once)
// Builds a NEW form with the same questions and pages as the old one, then connects it.
function createLeaveForm() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('FORM_ID')) {
    throw new Error('A form was already created (Script Property FORM_ID). Delete that property first if you really want another new form.');
  }
  const Q = BRIDGE_Q;
  const data = bridgeCall_('get', '/api/form/options');
  const form = FormApp.create('Leave Request - ' + (data.company_name || 'Company'));
  form.setDescription('Choose your name and number, then the leave type, and answer the questions for that type.');
  try {
    form.setEmailCollectionType(BRIDGE_EMAIL_MODE === 'verified'
      ? FormApp.EmailCollectionType.VERIFIED : FormApp.EmailCollectionType.RESPONDER_INPUT);
  } catch (err) {
    form.setCollectEmail(true);
  }

  form.addListItem().setTitle(Q.NAME).setHelpText('Choose YOUR name.').setRequired(true).setChoiceValues([BRIDGE_NO_EMP]);
  form.addListItem().setTitle(Q.EMPNO).setRequired(true).setChoiceValues([BRIDGE_NO_EMP])
    .setHelpText('Choose YOUR employee number. Number and name must belong to you, or the request is stopped.');
  const typeItem = form.addListItem().setTitle(Q.TYPE).setRequired(true);

  const shortPage = form.addPageBreakItem().setTitle('Short Leave');
  shortPage.setGoToPage(FormApp.PageNavigationType.SUBMIT);
  form.addDateItem().setTitle(Q.DATE).setRequired(true);
  form.addTimeItem().setTitle(Q.OUT).setHelpText('Optional');
  form.addTimeItem().setTitle(Q.RET).setHelpText('Optional');
  form.addParagraphTextItem().setTitle(Q.REASON).setHelpText('Optional');

  // Every page ends with Submit; the "How many days?" answer decides which date page is shown
  const addDatesFlow = (title, allowHalf) => {
    const page = form.addPageBreakItem().setTitle(title);
    page.setGoToPage(FormApp.PageNavigationType.SUBMIT);
    const how = form.addMultipleChoiceItem().setTitle(Q.HOWMANY).setRequired(true)
      .setHelpText('Choose one day, a date range, or separate dates.');
    const p1 = form.addPageBreakItem().setTitle('One day');
    p1.setGoToPage(FormApp.PageNavigationType.SUBMIT);
    form.addDateItem().setTitle(Q.DATE).setRequired(true);
    if (allowHalf) form.addMultipleChoiceItem().setTitle(Q.DAYTYPE).setChoiceValues(['Full Day', 'Half Day']).setRequired(true);
    form.addParagraphTextItem().setTitle(Q.REASON).setHelpText('Optional');
    const p2 = form.addPageBreakItem().setTitle('Days in a row');
    p2.setGoToPage(FormApp.PageNavigationType.SUBMIT);
    form.addDateItem().setTitle(Q.FROMR).setRequired(true);
    form.addDateItem().setTitle(Q.TOR).setRequired(true);
    form.addParagraphTextItem().setTitle(Q.REASON).setHelpText('Optional');
    const p3 = form.addPageBreakItem().setTitle('Multiple separate dates').setHelpText('Choose 2 to 4 dates. Each date is one full day.');
    p3.setGoToPage(FormApp.PageNavigationType.SUBMIT);
    form.addDateItem().setTitle(Q.DATES[0]).setRequired(true);
    form.addDateItem().setTitle(Q.DATES[1]).setRequired(true);
    form.addDateItem().setTitle(Q.DATES[2]);
    form.addDateItem().setTitle(Q.DATES[3]);
    form.addParagraphTextItem().setTitle(Q.REASON).setHelpText('Optional');
    how.setChoices([how.createChoice('One day', p1), how.createChoice('Days in a row', p2), how.createChoice('Multiple separate dates', p3)]);
    return page;
  };
  const halfPage = addDatesFlow('Casual Leave', true);
  const datesPage = addDatesFlow('Leave dates', false);
  typeItem.setChoices(data.types.map(t => typeItem.createChoice(t.name, t.is_short ? shortPage : t.allow_half ? halfPage : datesPage)));

  props.setProperty('FORM_ID', form.getId());
  setupBridge();
  let short = '';
  try { short = form.shortenFormUrl(form.getPublishedUrl()); } catch (err) {}
  Logger.log('NEW FORM CREATED\n\nLink for employees:\n' + form.getPublishedUrl() + (short ? '\nShort link: ' + short : '') +
    '\n\nEdit the form:\n' + form.getEditUrl() + '\n\nPaste the employee link in the app: Settings → General → Google Form link.');
}

// ---------------------------------------------------------------- setup
function setupBridge() {
  bridgeConfig_();
  const form = bridgeForm_();
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));     // also removes the OLD system's triggers
  ScriptApp.newTrigger('onFormSubmitBridge').forForm(form).onFormSubmit().create();
  ScriptApp.newTrigger('syncFormLists').timeBased().everyHours(1).create();
  form.setAcceptingResponses(true);
  form.setConfirmationMessage('Thank you. Your request was sent to your department head. ' +
    'You will get an email when it is approved or rejected. If something is wrong, you will get an email to fill the form again.');
  const lists = syncFormLists();
  Logger.log('Bridge is ready.\nForm link (unchanged): ' + form.getPublishedUrl() + '\n' + lists);
}

// Quick check: can the script reach the new system?
function testBridge() {
  const data = bridgeCall_('get', '/api/form/options');
  Logger.log('Connected. ' + data.employees.length + ' active employees, leave types: ' + data.types.map(t => t.name).join(', '));
}

// ---------------------------------------------------------------- form answer -> new system
function onFormSubmitBridge(e) {
  const resp = e.response;
  try {
    const res = bridgeSend_(resp);
    Logger.log(resp.getId() + ': ' + JSON.stringify(res));
  } catch (err) {
    const failed = JSON.parse(PropertiesService.getScriptProperties().getProperty(BRIDGE_FAILED) || '[]');
    if (failed.indexOf(resp.getId()) === -1) failed.push(resp.getId());
    PropertiesService.getScriptProperties().setProperty(BRIDGE_FAILED, JSON.stringify(failed.slice(-200)));
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Leave form: an answer did not reach the Leave System',
      'Error: ' + err.message + '\n\nThe answer is kept. Open the Apps Script project and run "resendFailed" when the problem is fixed.');
    throw err;
  }
}

// Sends again every answer that failed before (the system never saves the same answer twice)
function resendFailed() {
  const props = PropertiesService.getScriptProperties();
  const failed = JSON.parse(props.getProperty(BRIDGE_FAILED) || '[]');
  const form = bridgeForm_();
  const still = [];
  failed.forEach(id => {
    try {
      const resp = form.getResponse(id);
      Logger.log(id + ': ' + JSON.stringify(bridgeSend_(resp)));
    } catch (err) {
      Logger.log(id + ': ' + err.message);
      still.push(id);
    }
  });
  props.setProperty(BRIDGE_FAILED, JSON.stringify(still));
  Logger.log('Sent again: ' + (failed.length - still.length) + ', still failing: ' + still.length);
}

function bridgeSend_(resp) {
  return bridgeCall_('post', '/api/form/submit', bridgePayload_(resp));
}

// Reads the answers of the old form (all its versions) into the shape the new system expects
function bridgePayload_(resp) {
  const Q = BRIDGE_Q;
  const a = {};
  resp.getItemResponses().forEach(ir => {
    const v = ir.getResponse();
    if (v !== '' && v !== null && v !== undefined) a[ir.getItem().getTitle()] = v;
  });
  let empNo = String(a[Q.EMPNO] || '').trim();
  let empName = String(a[Q.NAME] || '').trim();
  if (!empNo && a[Q.EMP]) {                                  // one list: "EMP005 - John Silva"
    const s = String(a[Q.EMP]);
    const i = s.indexOf(' - ');
    empNo = (i > -1 ? s.slice(0, i) : s).trim();
    empName = empName || (i > -1 ? s.slice(i + 3).trim() : '');
  }
  let email = '';
  try { email = resp.getRespondentEmail() || ''; } catch (err) {}
  if (!email) email = String(a[Q.EMAIL] || '').trim();

  const p = {
    response_id: resp.getId(), email: email, emp_no: empNo, emp_name: empName,
    leave_type: String(a[Q.TYPE] || '').trim(), reason: String(a[Q.REASON] || '').trim(),
    out_time: String(a[Q.OUT] || ''), return_time: String(a[Q.RET] || ''),
  };
  const how = String(a[Q.HOWMANY] || '');
  if (/separate|multiple/i.test(how)) {
    p.mode = 'dates';
    p.dates = Q.DATES.map(k => a[k]).filter(Boolean);
  } else if (/row/i.test(how)) {
    p.mode = 'range';
    p.from = a[Q.FROMR];
    p.to = a[Q.TOR] || a[Q.FROMR];
  } else if (a[Q.TO_OLD] && a[Q.TO_OLD] !== a[Q.DATE]) {     // older form version
    p.mode = 'range';
    p.from = a[Q.DATE];
    p.to = a[Q.TO_OLD];
  } else {
    p.mode = 'one';
    p.date = a[Q.DATE];
    p.half = /^half/i.test(String(a[Q.DAYTYPE] || '')) || /^yes/i.test(String(a[Q.HALF_OLD] || ''));
  }
  return p;
}

// ---------------------------------------------------------------- new system -> form lists (hourly)
function syncFormLists() {
  const Q = BRIDGE_Q;
  const form = bridgeForm_();
  const data = bridgeCall_('get', '/api/form/options');
  const lists = title => form.getItems(FormApp.ItemType.LIST).filter(it => it.getTitle() === title).map(it => it.asListItem());
  const fill = (title, values) => lists(title).forEach(li => li.setChoiceValues(values.length ? values : [BRIDGE_NO_EMP]));

  const emps = data.employees;
  const names = emps.map(e => e.name).filter((n, i, all) => all.indexOf(n) === i).sort((x, y) => x.localeCompare(y));
  const numbers = emps.map(e => e.emp_no).sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }));
  fill(Q.NAME, names);
  fill(Q.EMPNO, numbers);
  fill(Q.EMP, emps.map(e => e.emp_no + ' - ' + e.name));

  // leave types: keep the page each type jumps to (Short Leave / half day page / normal dates page)
  const pages = {};
  form.getItems(FormApp.ItemType.PAGE_BREAK).forEach(it => { pages[it.getTitle()] = it.asPageBreakItem(); });
  lists(Q.TYPE).forEach(li => {
    if (pages['Short Leave'] && pages['Casual Leave'] && pages['Leave dates']) {
      li.setChoices(data.types.map(t => li.createChoice(t.name,
        t.is_short ? pages['Short Leave'] : t.allow_half ? pages['Casual Leave'] : pages['Leave dates'])));
    } else {
      li.setChoiceValues(data.types.map(t => t.name));
    }
  });
  return emps.length + ' employees and ' + data.types.length + ' leave types are in the form lists.';
}

// ---------------------------------------------------------------- helpers
function bridgeConfig_() {
  const p = PropertiesService.getScriptProperties();
  const url = String(p.getProperty('LMS_URL') || '').trim().replace(/\/+$/, '');
  const secret = String(p.getProperty('LMS_FORM_SECRET') || '').trim();
  if (!/^https:\/\//.test(url) || secret.length < 16) {
    throw new Error('Add Script Properties LMS_URL and LMS_FORM_SECRET first (Project Settings → Script Properties).');
  }
  return { url: url, secret: secret };
}

function bridgeForm_() {
  const id = PropertiesService.getScriptProperties().getProperty('FORM_ID');
  if (!id) throw new Error('Script Property FORM_ID is missing. Add the ID of the existing leave form (from its edit link).');
  return FormApp.openById(id);
}

function bridgeCall_(method, path, body) {
  const cfg = bridgeConfig_();
  const options = { method: method, contentType: 'application/json', headers: { 'x-form-secret': cfg.secret }, muteHttpExceptions: true };
  if (body) options.payload = JSON.stringify(body);
  const res = UrlFetchApp.fetch(cfg.url + path, options);
  let data = null;
  try { data = JSON.parse(res.getContentText()); } catch (err) {}
  if (res.getResponseCode() !== 200) {
    throw new Error('Leave System answered ' + res.getResponseCode() + ': ' + ((data && data.error) || res.getContentText().slice(0, 200)));
  }
  return data;
}

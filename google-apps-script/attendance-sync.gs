/**
 * FALAH ACADEMY — Attendance sync ("Today sheet" design)
 * Teachers mark TODAY's attendance with dropdowns; the platform stores
 * all history. The sheet never grows — column C is cleared overnight.
 *
 * SHEET LAYOUT (one tab per grade, named exactly: Pre-K, KG, Grade 1, Grade 3)
 *   Row 1:  StudentNo | Student Name | Today | Note (optional)
 *   Rows 2+: 10001    | Ahmed T.     | Present ▾ | ...
 * Column C: dropdown with Present / Late / Absent (blank = not recorded).
 * P / L / A shorthand typed directly also works.
 *
 * SETUP (~5 min, in the school's Google account):
 * 1. Extensions > Apps Script > paste this file > save.
 * 2. Project Settings > Script properties:
 *      SUPABASE_URL          e.g. https://xxxx.supabase.co
 *      SUPABASE_SERVICE_KEY  the SECRET key (never in the website)
 * 3. Run the function `setupSheet` once (dropdowns + formatting).
 * 4. Triggers > Add trigger:
 *      syncAttendance  | From spreadsheet | On change
 *      clearToday      | Time-driven     | Day timer | Midnight to 1am
 */

var STATUS_MAP = {
  "P": "present", "PRESENT": "present",
  "L": "late",    "LATE": "late",
  "A": "absent",  "ABSENT": "absent",
};
var GRADE_TABS = ["Pre-K", "KG", "Grade 1", "Grade 3"];

function syncAttendance() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL");
  var key = props.getProperty("SUPABASE_SERVICE_KEY");
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY in Script properties.");

  var today = Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM-dd");
  var enrollments = fetchEnrollmentMap_(url, key); // student_no -> enrollment_id
  var rows = [];

  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sheet) {
    if (GRADE_TABS.indexOf(sheet.getName().trim()) === -1) return;
    var data = sheet.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      var studentNo = String(data[r][0]).trim();
      var enrollmentId = enrollments[studentNo];
      var status = STATUS_MAP[String(data[r][2]).trim().toUpperCase()];
      if (!enrollmentId || !status) continue;
      rows.push({
        enrollment_id: enrollmentId,
        date: today,
        status: status,
        notes: String(data[r][3] || "").trim() || null,
        recorded_by: sheet.getName(),
        synced_at: new Date().toISOString(),
      });
    }
  });

  if (!rows.length) { Logger.log("Nothing to sync."); return; }
  var resp = UrlFetchApp.fetch(url + "/rest/v1/attendance?on_conflict=enrollment_id,date", {
    method: "post",
    contentType: "application/json",
    headers: { apikey: key, Authorization: "Bearer " + key, Prefer: "resolution=merge-duplicates" },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error("Sync failed: " + resp.getContentText().slice(0, 300));
  }
  Logger.log("Synced " + rows.length + " attendance marks for " + today + ".");
}

/** Nightly reset: clears Today + Note columns so teachers start fresh. */
function clearToday() {
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sheet) {
    if (GRADE_TABS.indexOf(sheet.getName().trim()) === -1) return;
    var last = sheet.getLastRow();
    if (last > 1) sheet.getRange(2, 3, last - 1, 2).clearContent();
  });
}

/** One-time helper: headers, dropdowns, frozen row, column widths. */
function setupSheet() {
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sheet) {
    if (GRADE_TABS.indexOf(sheet.getName().trim()) === -1) return;
    sheet.getRange("A1:D1")
      .setValues([["StudentNo", "Student Name", "Today", "Note (optional)"]])
      .setFontWeight("bold");
    sheet.setFrozenRows(1);
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["Present", "Late", "Absent"], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange("C2:C100").setDataValidation(rule);
    sheet.setColumnWidth(2, 180);
    sheet.setColumnWidth(4, 220);
  });
}

/** Map student_no -> enrollment_id for active enrollments. */
function fetchEnrollmentMap_(url, key) {
  var resp = UrlFetchApp.fetch(
    url + "/rest/v1/enrollments?select=id,status,students(student_no)&status=eq.active",
    { headers: { apikey: key, Authorization: "Bearer " + key } }
  );
  var map = {};
  JSON.parse(resp.getContentText()).forEach(function (e) {
    if (e.students && e.students.student_no != null) map[String(e.students.student_no)] = e.id;
  });
  return map;
}

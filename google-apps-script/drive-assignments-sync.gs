/**
 * FALAH ACADEMY — Assignments sync (Google Drive -> Platform)
 * Implements FR-004 / BR-030: teachers upload assignment files to Drive
 * once; this script publishes their metadata to the Parent Portal.
 *
 * DRIVE FOLDER STRUCTURE (create once in the school's Drive):
 *   Falah Assignments/            <- root folder (any name; use its ID below)
 *     Pre-K/
 *     KG/
 *     Grade 1/
 *     Grade 3/
 * Subfolder names must exactly match the grade names in the platform.
 *
 * FILE NAMING (teachers drop files named like this):
 *   2026-09-05 - Math - Worksheet p12.pdf
 *   ^due date    ^subject ^title (extension ignored)
 * Files without a leading date sync with no due date; without " - "
 * separators the whole name becomes the title (subject "General").
 *
 * SETUP (~5 min, in the school's Google account):
 * 1. script.google.com -> New project -> paste this file.
 * 2. Project Settings -> Script properties:
 *      SUPABASE_URL          e.g. https://xxxx.supabase.co
 *      SUPABASE_SERVICE_KEY  the SECRET key (never in the website)
 *      ASSIGNMENTS_FOLDER_ID the root folder's ID (from its Drive URL)
 * 3. Triggers -> Add trigger -> syncAssignments -> time-driven -> every hour.
 */

function syncAssignments() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL");
  var key = props.getProperty("SUPABASE_SERVICE_KEY");
  var rootId = props.getProperty("ASSIGNMENTS_FOLDER_ID");
  if (!url || !key || !rootId) throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_KEY, ASSIGNMENTS_FOLDER_ID in Script properties.");

  var grades = fetchGrades_(url, key); // name -> id
  var root = DriveApp.getFolderById(rootId);
  var rows = [];

  var folders = root.getFolders();
  while (folders.hasNext()) {
    var folder = folders.next();
    var gradeId = grades[folder.getName().trim()];
    if (!gradeId) continue; // folder name doesn't match a grade
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      var meta = parseName_(f.getName());
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      rows.push({
        drive_file_id: f.getId(),
        grade_id: gradeId,
        enrollment_id: null,
        subject: meta.subject,
        title: meta.title,
        instructions: null,
        file_url: "https://drive.google.com/file/d/" + f.getId() + "/view",
        due_date: meta.due,
        assigned_date: Utilities.formatDate(f.getDateCreated(), "America/Los_Angeles", "yyyy-MM-dd"),
        source: "drive",
      });
    }
  }

  for (var i = 0; i < rows.length; i += 200) {
    var resp = UrlFetchApp.fetch(url + "/rest/v1/assignments?on_conflict=drive_file_id", {
      method: "post",
      contentType: "application/json",
      headers: { apikey: key, Authorization: "Bearer " + key, Prefer: "resolution=merge-duplicates" },
      payload: JSON.stringify(rows.slice(i, i + 200)),
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() >= 300) throw new Error("Sync failed: " + resp.getContentText().slice(0, 300));
  }
  Logger.log("Synced " + rows.length + " assignment files.");
}

function fetchGrades_(url, key) {
  var resp = UrlFetchApp.fetch(url + "/rest/v1/grades?select=id,name&is_active=eq.true", {
    headers: { apikey: key, Authorization: "Bearer " + key },
  });
  var map = {};
  JSON.parse(resp.getContentText()).forEach(function (g) { map[g.name] = g.id; });
  return map;
}

function parseName_(name) {
  var base = name.replace(/\.[^.]+$/, "");
  var parts = base.split(" - ").map(function (s) { return s.trim(); });
  var due = null, subject = "General", title = base;
  if (parts.length >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
    due = parts.shift();
  }
  if (parts.length >= 2) {
    subject = parts.shift();
    title = parts.join(" - ");
  } else if (parts.length === 1) {
    title = parts[0];
  }
  return { due: due, subject: subject, title: title };
}

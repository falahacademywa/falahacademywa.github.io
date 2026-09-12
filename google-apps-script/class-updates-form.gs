/**
 * FALAH ACADEMY — Class Updates forms (teacher notes + photos -> platform)
 *
 * TWO Google Forms, one script:
 *   1. CLASS UPDATE form  — class teachers. One submission covers all four
 *      subjects: English, Mathematics, Science, Islamic Education. Each
 *      subject has its own text box (+ optional homework due date). Every
 *      non-empty subject becomes its own update in the Family Portal, so
 *      parents still see updates per subject.
 *   2. QUR'AN UPDATE form — the Qur'an teacher. Whole class OR one student
 *      (an individual update is visible only to that family).
 *
 * SETUP (~10 min, school Google account, at script.google.com):
 * 1. New project -> paste this file -> save (name it "Class Updates").
 * 2. Project Settings -> Script properties:
 *      SUPABASE_URL          e.g. https://xxxx.supabase.co
 *      SUPABASE_SERVICE_KEY  the LEGACY service_role key (starts eyJ...)
 *      TEACHER_EMAILS        (OPTIONAL) extra always-allowed addresses,
 *                            e.g. the school admin. The real allowlist is
 *                            the ACTIVE teachers in Admin -> Teachers — add
 *                            or deactivate a teacher there (with their Google
 *                            email) and form access follows automatically.
 * 3. Run createForm() once, then createQuranForm() once (authorize when
 *    asked). The log prints each form's edit URL and teacher link.
 * 4. MANUAL STEP, for EACH form (Google's API can't add upload questions):
 *    open the edit URL -> Add question -> "File upload" -> title it
 *    "Photo / file (optional)" -> allow 1-3 files, 10MB. Drag it to the end.
 * 5. Share the Class Update link with class teachers and the Qur'an Update
 *    link with the Qur'an teacher (they must be signed into any Google
 *    account — required for file upload; a personal Gmail is fine).
 * 6. Roster changes later? Run refreshRoster() to rebuild the student list
 *    on the Qur'an form.
 *
 * UPGRADING FROM THE OLD SINGLE FORM (subject dropdown): after step 3, open
 * Triggers (clock icon) and delete the trigger that points at the OLD form,
 * then unshare/trash the old form. Old submissions are already in the
 * platform; nothing to migrate.
 */

var GRADES = ["Pre-K", "KG", "Grade 1", "Grade 3"];
var CLASS_SUBJECTS = ["English", "Mathematics", "Science", "Islamic Education"];
var QURAN_SUBJECT = "Qur'an";
var STUDENT_NONE = "Whole class (default)";

// Question titles (the submit handler reads answers by these exact titles)
var Q_GRADE = "Grade / Class";
var Q_STUDENT = "Individual student (optional)";
var Q_NOTE = "Update / note";
var Q_DUE = "Homework due date (optional)";
function qNote_(subject) { return subject + " — update"; }
function qDue_(subject)  { return subject + " — homework due (optional)"; }

/** 1) Class Update form: one submission = up to four subject updates. */
function createForm() {
  var props = PropertiesService.getScriptProperties();
  var form = FormApp.create("Falah Academy — Class Update");
  form.setDescription(
    "Assalamu Alaikum! Fill in only the subjects that had something today — " +
    "leave the others blank. Parents of your class see each subject's update in the Family Portal.")
    .setCollectEmail(true)
    .setAllowResponseEdits(false)
    .setLimitOneResponsePerUser(false);

  form.addListItem().setTitle(Q_GRADE).setChoiceValues(GRADES).setRequired(true);

  CLASS_SUBJECTS.forEach(function (s) {
    form.addSectionHeaderItem().setTitle(s);
    form.addParagraphTextItem().setTitle(qNote_(s))
      .setHelpText("What did the class do in " + s + "? Any practice at home? Leave blank if nothing today.");
    form.addDateItem().setTitle(qDue_(s))
      .setHelpText("Only if this " + s + " update assigns homework with a deadline.");
  });

  props.setProperty("FORM_ID", form.getId());
  ScriptApp.newTrigger("onFormSubmitHandler").forForm(form).onFormSubmit().create();

  Logger.log("CLASS form — EDIT (add the File upload question here!): " + form.getEditUrl());
  Logger.log("CLASS form — TEACHER link (share with class teachers): " + form.getPublishedUrl());
}

/** 2) Qur'an Update form: whole class or one student. */
function createQuranForm() {
  var props = PropertiesService.getScriptProperties();
  var form = FormApp.create("Falah Academy — Qur'an Update");
  form.setDescription(
    "Assalamu Alaikum! Post today's Qur'an update. Leave 'Individual student' as " +
    "'Whole class' unless the update is for one student only — an individual update " +
    "is visible only to that family.")
    .setCollectEmail(true)
    .setAllowResponseEdits(false)
    .setLimitOneResponsePerUser(false);

  form.addListItem().setTitle(Q_GRADE).setChoiceValues(GRADES).setRequired(true);
  form.addListItem().setTitle(Q_STUDENT)
    .setHelpText("Pick a student only if this update is for that child alone.")
    .setChoiceValues([STUDENT_NONE].concat(fetchRoster_()));
  form.addParagraphTextItem().setTitle(Q_NOTE)
    .setHelpText("Lesson covered, sabaq/revision, what to practise at home.")
    .setRequired(true);
  form.addDateItem().setTitle(Q_DUE)
    .setHelpText("Only if this update assigns practice with a deadline.");

  props.setProperty("QURAN_FORM_ID", form.getId());
  ScriptApp.newTrigger("onFormSubmitHandler").forForm(form).onFormSubmit().create();

  Logger.log("QUR'AN form — EDIT (add the File upload question here!): " + form.getEditUrl());
  Logger.log("QUR'AN form — TEACHER link (share with the Qur'an teacher): " + form.getPublishedUrl());
}

/** Rebuilds the student dropdown on the Qur'an form (run after roster changes). */
function refreshRoster() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("QURAN_FORM_ID");
  if (!id) throw new Error("Run createQuranForm() first.");
  var form = FormApp.openById(id);
  var items = form.getItems(FormApp.ItemType.LIST);
  for (var i = 0; i < items.length; i++) {
    if (items[i].getTitle() === Q_STUDENT) {
      items[i].asListItem().setChoiceValues([STUDENT_NONE].concat(fetchRoster_()));
      Logger.log("Student list refreshed.");
      return;
    }
  }
}

/** One handler for both forms; branches on which form fired the trigger. */
function onFormSubmitHandler(e) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL");
  var key = props.getProperty("SUPABASE_SERVICE_KEY");
  var isQuran = e.source && e.source.getId() === props.getProperty("QURAN_FORM_ID");

  var resp = e.response;
  var email = (resp.getRespondentEmail() || "").toLowerCase();

  // Allowlist = active teachers in the platform (Admin -> Teachers), plus
  // TEACHER_EMAILS as extra always-allowed addresses / fallback.
  var allow = activeTeacherEmails_(url, key);
  var extra = (props.getProperty("TEACHER_EMAILS") || "").toLowerCase()
    .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  extra.forEach(function (a) { if (allow.indexOf(a) === -1) allow.push(a); });
  if (allow.length && allow.indexOf(email) === -1) {
    Logger.log("Ignored submission from non-active-teacher address: " + email);
    return;
  }

  // Collect answers by question title; capture the (single) uploaded file.
  var answers = {};
  var fileUrl = null, thumbUrl = null;
  resp.getItemResponses().forEach(function (ir) {
    if (ir.getItem().getType() === FormApp.ItemType.FILE_UPLOAD) {
      var ids = ir.getResponse();
      if (ids && ids.length) {
        var f = DriveApp.getFileById(ids[0]);
        f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        fileUrl = "https://drive.google.com/file/d/" + ids[0] + "/view";
        thumbUrl = "https://drive.google.com/thumbnail?id=" + ids[0] + "&sz=w600";
      }
    } else {
      answers[ir.getItem().getTitle()] = ir.getResponse();
    }
  });

  var grade = answers[Q_GRADE];
  if (!grade) return;
  var H = { apikey: key, Authorization: "Bearer " + key };
  var gradeId = lookupGradeId_(url, H, grade);
  var today = Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM-dd");

  // Build the list of updates this submission produces.
  var updates = [];
  if (isQuran) {
    var note = answers[Q_NOTE];
    if (!note) return;
    var enrollmentId = null;
    var pick = answers[Q_STUDENT];
    if (pick && pick !== STUDENT_NONE) {
      enrollmentId = lookupEnrollment_(url, H, String(pick).split(" - ")[0].trim());
    }
    updates.push({ subject: QURAN_SUBJECT, note: note, due: answers[Q_DUE] || null, enrollmentId: enrollmentId });
  } else {
    CLASS_SUBJECTS.forEach(function (s) {
      var n = String(answers[qNote_(s)] || "").trim();
      if (n) updates.push({ subject: s, note: n, due: answers[qDue_(s)] || null, enrollmentId: null });
    });
    if (!updates.length) { Logger.log("Class form submitted with all subjects blank; nothing posted."); return; }
  }

  // Post one class_update per subject. The uploaded photo (if any) is
  // attached to every update in this submission, since a single upload
  // can't be tied to one subject.
  updates.forEach(function (u) {
    post_(url + "/rest/v1/class_updates", H, {
      grade_id: u.enrollmentId ? null : gradeId,
      enrollment_id: u.enrollmentId,
      subject: u.subject,
      note: u.note,
      attachment_url: fileUrl,
      attachment_thumb: thumbUrl,
      homework_due: u.due,
      update_date: today,
      teacher_email: email,
    });
    // Homework with a due date also lands in Assignments (due-date machinery
    // + immediate parent notification via the existing DB trigger).
    if (u.due) {
      post_(url + "/rest/v1/assignments", H, {
        grade_id: u.enrollmentId ? null : gradeId,
        enrollment_id: u.enrollmentId,
        subject: u.subject,
        title: u.note.length > 80 ? u.note.slice(0, 77) + "..." : u.note,
        instructions: u.note.length > 80 ? u.note : null,
        file_url: fileUrl,
        due_date: u.due,
        source: "manual",
      });
    }
  });
  Logger.log("Synced " + updates.length + " update(s) for " + grade +
    (isQuran ? " [Qur'an" + (updates[0].enrollmentId ? ", individual" : "") + "]" : " [class]"));
}

// ---------------- helpers ----------------
// Emails of active teachers in the platform (Admin -> Teachers). Lowercased.
// Returns [] on any error so callers can fall back to TEACHER_EMAILS.
function activeTeacherEmails_(url, key) {
  try {
    var r = UrlFetchApp.fetch(
      url + "/rest/v1/teachers?select=email&active=eq.true&email=not.is.null",
      { headers: { apikey: key, Authorization: "Bearer " + key }, muteHttpExceptions: true });
    if (r.getResponseCode() >= 300) return [];
    return JSON.parse(r.getContentText())
      .map(function (t) { return (t.email || "").trim().toLowerCase(); })
      .filter(Boolean);
  } catch (err) {
    Logger.log("activeTeacherEmails_ failed: " + err);
    return [];
  }
}

function fetchRoster_() {
  var props = PropertiesService.getScriptProperties();
  var r = UrlFetchApp.fetch(
    props.getProperty("SUPABASE_URL") +
    "/rest/v1/enrollments?select=grade_name,students(student_no,first_name,last_name)&status=eq.active&order=grade_name",
    { headers: { apikey: props.getProperty("SUPABASE_SERVICE_KEY"), Authorization: "Bearer " + props.getProperty("SUPABASE_SERVICE_KEY") } }
  );
  return JSON.parse(r.getContentText()).map(function (e) {
    return e.students.student_no + " - " + e.students.first_name + " " + e.students.last_name + " (" + e.grade_name + ")";
  });
}

function lookupGradeId_(url, H, name) {
  var r = UrlFetchApp.fetch(url + "/rest/v1/grades?select=id&name=eq." + encodeURIComponent(name), { headers: H });
  var rows = JSON.parse(r.getContentText());
  if (!rows.length) throw new Error("Unknown grade: " + name);
  return rows[0].id;
}

function lookupEnrollment_(url, H, studentNo) {
  var r = UrlFetchApp.fetch(url + "/rest/v1/enrollments?select=id,students!inner(student_no)&status=eq.active&students.student_no=eq." + studentNo, { headers: H });
  var rows = JSON.parse(r.getContentText());
  return rows.length ? rows[0].id : null;
}

function post_(endpoint, H, body) {
  var resp = UrlFetchApp.fetch(endpoint, {
    method: "post",
    contentType: "application/json",
    headers: { apikey: H.apikey, Authorization: H.Authorization, Prefer: "return=minimal" },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) throw new Error("Sync failed: " + resp.getContentText().slice(0, 300));
}

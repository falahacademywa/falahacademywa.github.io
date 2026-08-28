/**
 * FALAH ACADEMY — Class Updates form (teacher notes + photos -> platform)
 * Teachers post per-subject updates ("English: practiced 3-letter words,
 * homework due Thursday" + photo) through one Google Form. Qur'an updates
 * can target the whole class or one student.
 *
 * SETUP (~7 min, school Google account, at script.google.com):
 * 1. New project -> paste this file -> save (name it "Class Updates").
 * 2. Project Settings -> Script properties:
 *      SUPABASE_URL          e.g. https://xxxx.supabase.co
 *      SUPABASE_SERVICE_KEY  the LEGACY service_role key (starts eyJ...)
 *      TEACHER_EMAILS        comma-separated allowlist, e.g.
 *                            "teacher1@gmail.com, quran.teacher@gmail.com"
 * 3. Run createForm() once (authorize when asked). The log prints the
 *    form's edit URL and the teacher link.
 * 4. MANUAL STEP (Google's API can't add upload questions): open the form's
 *    edit URL -> Add question -> "File upload" -> title it "Photo / file
 *    (optional)" -> allow 1-3 files, 10MB. Drag it above the submit end.
 * 5. Share the responder link with teachers (they must be signed into any
 *    Google account — required for file upload; their personal Gmail is fine).
 * 6. Roster changes later? Run refreshRoster() to rebuild the student list.
 */

var GRADES = ["Pre-K", "KG", "Grade 1", "Grade 3"];
var SUBJECTS = ["English", "Math", "Science", "Islamic Studies", "Qur'an", "Arabic", "Other"];
var STUDENT_NONE = "Whole class (default)";

function createForm() {
  var props = PropertiesService.getScriptProperties();
  var form = FormApp.create("Falah Academy — Class Update");
  form.setDescription(
    "Assalamu Alaikum! Post one update per subject. Parents of your class see it in the Family Portal.\n" +
    "For Qur'an you may pick one student to make the update visible only to that family.")
    .setCollectEmail(true)
    .setAllowResponseEdits(false)
    .setLimitOneResponsePerUser(false);

  form.addListItem().setTitle("Grade / Class").setChoiceValues(GRADES).setRequired(true);
  form.addListItem().setTitle("Subject").setChoiceValues(SUBJECTS).setRequired(true);
  form.addParagraphTextItem().setTitle("Update / note")
    .setHelpText("What did the class do? Any homework or practice at home?")
    .setRequired(true);
  form.addDateItem().setTitle("Homework due date (optional)")
    .setHelpText("Only if this update assigns homework with a deadline.");
  form.addListItem().setTitle("Individual student (optional — Qur'an)")
    .setHelpText("Leave as 'Whole class' unless this update is for one student only.")
    .setChoiceValues([STUDENT_NONE].concat(fetchRoster_()));

  props.setProperty("FORM_ID", form.getId());
  ScriptApp.newTrigger("onFormSubmitHandler").forForm(form).onFormSubmit().create();

  Logger.log("EDIT the form (add the File upload question here!): " + form.getEditUrl());
  Logger.log("TEACHER link (share this): " + form.getPublishedUrl());
}

/** Rebuilds the student dropdown from the platform (run after roster changes). */
function refreshRoster() {
  var props = PropertiesService.getScriptProperties();
  var form = FormApp.openById(props.getProperty("FORM_ID"));
  var items = form.getItems(FormApp.ItemType.LIST);
  for (var i = 0; i < items.length; i++) {
    if (items[i].getTitle().indexOf("Individual student") === 0) {
      items[i].asListItem().setChoiceValues([STUDENT_NONE].concat(fetchRoster_()));
      Logger.log("Student list refreshed.");
      return;
    }
  }
}

function onFormSubmitHandler(e) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL");
  var key = props.getProperty("SUPABASE_SERVICE_KEY");
  var allow = (props.getProperty("TEACHER_EMAILS") || "").toLowerCase()
    .split(",").map(function (s) { return s.trim(); }).filter(Boolean);

  var resp = e.response;
  var email = (resp.getRespondentEmail() || "").toLowerCase();
  if (allow.length && allow.indexOf(email) === -1) {
    Logger.log("Ignored submission from non-allowlisted address: " + email);
    return;
  }

  var answers = {};
  var fileUrl = null, thumbUrl = null;
  resp.getItemResponses().forEach(function (ir) {
    var title = ir.getItem().getTitle();
    if (ir.getItem().getType() === FormApp.ItemType.FILE_UPLOAD) {
      var ids = ir.getResponse();
      if (ids && ids.length) {
        var f = DriveApp.getFileById(ids[0]);
        f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        fileUrl = "https://drive.google.com/file/d/" + ids[0] + "/view";
        thumbUrl = "https://drive.google.com/thumbnail?id=" + ids[0] + "&sz=w600";
      }
    } else {
      answers[title] = ir.getResponse();
    }
  });

  var grade = answers["Grade / Class"];
  var subject = answers["Subject"] || "General";
  var note = answers["Update / note"];
  var due = answers["Homework due date (optional)"] || null;   // "yyyy-MM-dd"
  var studentPick = answers["Individual student (optional — Qur'an)"];
  if (!note || !grade) return;

  var H = { apikey: key, Authorization: "Bearer " + key };
  var gradeId = lookupGradeId_(url, H, grade);
  var enrollmentId = null;
  if (studentPick && studentPick !== STUDENT_NONE) {
    var no = String(studentPick).split(" - ")[0].trim();
    enrollmentId = lookupEnrollment_(url, H, no);
  }

  post_(url + "/rest/v1/class_updates", H, {
    grade_id: enrollmentId ? null : gradeId,
    enrollment_id: enrollmentId,
    subject: subject,
    note: note,
    attachment_url: fileUrl,
    attachment_thumb: thumbUrl,
    homework_due: due,
    update_date: Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM-dd"),
    teacher_email: email,
  });

  // Homework with a due date also lands in Assignments (due-date machinery
  // + immediate parent notification via the existing DB trigger).
  if (due) {
    post_(url + "/rest/v1/assignments", H, {
      grade_id: enrollmentId ? null : gradeId,
      enrollment_id: enrollmentId,
      subject: subject,
      title: note.length > 80 ? note.slice(0, 77) + "..." : note,
      instructions: note.length > 80 ? note : null,
      file_url: fileUrl,
      due_date: due,
      source: "manual",
    });
  }
  Logger.log("Update synced (" + subject + ", " + (enrollmentId ? "individual" : grade) + ")");
}

// ---------------- helpers ----------------
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

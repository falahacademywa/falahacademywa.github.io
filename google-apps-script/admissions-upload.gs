/**
 * FALAH ACADEMY — admission document upload (website admission form, js/popup.js)
 * Saves the birth certificate / immunization record into the private Drive folder
 * FOLDER_ID (one sub-folder per child) and e-mails the school.
 * Hardened 2026-11-06 (security review): only PDF/Word/JPG/PNG up to 5 MB, only the two
 * document kinds the form sends, cleaned names, at most 30 uploads per hour, no folder is
 * ever trashed, and errors return a generic message (details stay in the execution log).
 * Deploy changes with Deploy > Manage deployments > edit > New version (keeps the URL).
 */
var FOLDER_ID = '1KAKcUbj_3W7bzURBchKQRQ-zMry2XO58';
var NOTIFICATION_EMAIL = 'falahacademywa@gmail.com';
var MAX_BYTES = 5 * 1024 * 1024;
var MAX_PER_HOUR = 30;
var KINDS = { Birth_Certificate: true, Immunization_Records: true };
var TYPES = {
  'application/pdf': 'pdf', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png'
};

function clean_(s, max) {
  return String(s || '').replace(/[\u0000-\u001f\u007f<>:"\/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function refuse_(why) {
  Logger.log('refused: ' + why);
  return reply_({ success: false, error: 'Upload refused: ' + why });
}
// global hourly cap so a script cannot fill the Drive or the mail quota
function underLimit_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cache = CacheService.getScriptCache();
    var key = 'uploads_' + Utilities.formatDate(new Date(), 'Etc/UTC', 'yyyyMMddHH');
    var n = Number(cache.get(key) || 0);
    if (n >= MAX_PER_HOUR) return false;
    cache.put(key, String(n + 1), 3700);
    return true;
  } finally { lock.releaseLock(); }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return refuse_('empty request');
    if (e.postData.contents.length > Math.ceil(MAX_BYTES * 4 / 3) + 4096) return refuse_('file over 5 MB');
    var data = JSON.parse(e.postData.contents);
    var studentName = clean_(data.studentName, 80) || 'Unknown';
    var fatherName = clean_(data.fatherName, 80);
    var fileType = String(data.fileType || '');
    var mimeType = String(data.mimeType || '').toLowerCase();
    if (!KINDS[fileType]) return refuse_('unknown document kind');
    if (!TYPES[mimeType]) return refuse_('only PDF, Word, JPG or PNG files');
    if (typeof data.fileData !== 'string' || !data.fileData) return refuse_('no file');
    var decoded = Utilities.base64Decode(data.fileData);
    if (!decoded.length || decoded.length > MAX_BYTES) return refuse_('file over 5 MB');
    if (!underLimit_()) return refuse_('too many uploads right now, please try again later');

    var fileName = clean_(data.fileName, 100).replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'upload';
    fileName = fileName + '.' + TYPES[mimeType];
    var year = new Date().getFullYear();
    var folderName = studentName + (fatherName ? ' _ ' + fatherName : '') + ' — ' + year;

    var parentFolder = DriveApp.getFolderById(FOLDER_ID);
    var existing = parentFolder.getFoldersByName(folderName);
    var studentFolder = existing.hasNext() ? existing.next() : parentFolder.createFolder(folderName);

    var blob = Utilities.newBlob(decoded, mimeType, fileType + '_' + fileName);
    var file = studentFolder.createFile(blob);
    var fileUrl = file.getUrl();

    MailApp.sendEmail({
      to: NOTIFICATION_EMAIL,
      subject: 'New Document — ' + studentName + ' (' + fileType + ')',
      body: 'A new document uploaded.\n\nStudent: ' + studentName + '\nFather: ' + fatherName + '\nDocument: ' + fileType +
            '\nFile: ' + fileName + '\n\nView: ' + fileUrl + '\n\nFolder: https://drive.google.com/drive/folders/' + FOLDER_ID
    });
    return reply_({ success: true, fileUrl: fileUrl });
  } catch (err) {
    Logger.log('upload failed: ' + err);
    return reply_({ success: false, error: 'Upload failed, please try again or e-mail the school.' });
  }
}

function doGet(e) {
  return reply_({ status: 'Falah Academy Upload Service Active' });
}

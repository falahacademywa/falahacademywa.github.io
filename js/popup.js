// ============================================================
// FALAH ACADEMY — ADMISSION POPUP FORM
// ============================================================

var UPLOAD_URL = 'https://script.google.com/macros/s/AKfycbzFkBlczArLnF38obznGSFZPBMzzD3oOzA0TdPBSOp-e5lD5Y3rx_yiMFopTljWGCPLYA/exec';
var popupStep = 1;
var uploadedFiles = { birthCert: null, immunization: null };

// ---- OPEN / CLOSE ----
window.openAdmissionPopup = function() {
  var popup = document.getElementById('admission-popup');
  if (!popup) { console.error('Popup element not found'); return; }
  popup.classList.add('open');
  document.body.classList.add('popup-open');
  popupStep = 1;
  showPopupStep(1);
};

window.closeAdmissionPopup = function() {
  var popup = document.getElementById('admission-popup');
  if (!popup) return;
  popup.classList.remove('open');
  document.body.classList.remove('popup-open');
  clearAllErrors();
  resetFileUploads();
  var formEl = document.getElementById('popup-admission-form');
  var successEl = document.getElementById('popup-success');
  if (formEl) { formEl.style.display = 'block'; formEl.reset(); }
  if (successEl) successEl.classList.remove('show');
  popupStep = 1;
  showPopupStep(1);
};

window.popupNext = function() {
  if (validatePopupStep(popupStep)) showPopupStep(popupStep + 1);
};

window.popupPrev = function() {
  clearAllErrors();
  if (popupStep > 1) showPopupStep(popupStep - 1);
};

window.submitPopupForm = function(e) {
  e.preventDefault();
  if (!validatePopupStep(4)) return;

  var btn = document.getElementById('popup-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading files...'; }

  var fName = document.getElementById('p_student_first') ? document.getElementById('p_student_first').value : '';
  var lName = document.getElementById('p_student_last') ? document.getElementById('p_student_last').value : '';
  var studentName = (fName + ' ' + lName).trim();

  var street  = document.getElementById('p_street')  ? document.getElementById('p_street').value  : '';
  var city    = document.getElementById('p_city')    ? document.getElementById('p_city').value    : '';
  var zipcode = document.getElementById('p_zipcode') ? document.getElementById('p_zipcode').value : '';

  var params = {
    student_first_name:     fName,
    student_middle_name:    document.getElementById('p_student_middle') ? document.getElementById('p_student_middle').value : '',
    student_last_name:      lName,
    gender:                 document.querySelector('input[name="p_gender"]:checked') ? document.querySelector('input[name="p_gender"]:checked').value : '',
    date_of_birth:          document.getElementById('p_dob') ? document.getElementById('p_dob').value : '',
    address:                street + ', ' + city + ', WA ' + zipcode,
    street:                 street,
    city:                   city,
    zipcode:                zipcode,
    grade:                  document.getElementById('p_grade') ? document.getElementById('p_grade').value : '',
    father_first_name:      document.getElementById('p_father_first') ? document.getElementById('p_father_first').value : '',
    father_middle_name:     document.getElementById('p_father_middle') ? document.getElementById('p_father_middle').value : '',
    father_last_name:       document.getElementById('p_father_last') ? document.getElementById('p_father_last').value : '',
    father_email:           document.getElementById('p_father_email') ? document.getElementById('p_father_email').value : '',
    father_phone:           document.getElementById('p_father_phone') ? document.getElementById('p_father_phone').value : '',
    mother_first_name:      document.getElementById('p_mother_first') ? document.getElementById('p_mother_first').value : '',
    mother_last_name:       document.getElementById('p_mother_last') ? document.getElementById('p_mother_last').value : '',
    mother_phone:           document.getElementById('p_mother_phone') ? document.getElementById('p_mother_phone').value : '',
    emergency_name:         document.getElementById('p_emg_name') ? document.getElementById('p_emg_name').value : '',
    emergency_phone:        document.getElementById('p_emg_phone') ? document.getElementById('p_emg_phone').value : '',
    emergency_relationship: document.getElementById('p_emg_rel') ? document.getElementById('p_emg_rel').value : '',
    heard_about:            document.getElementById('p_heard') ? document.getElementById('p_heard').value : '',
    previous_school:        document.getElementById('p_prev_school') ? document.getElementById('p_prev_school').value : '',
    special_needs:          document.getElementById('p_special') ? document.getElementById('p_special').value : '',
    comments:               document.getElementById('p_comments') ? document.getElementById('p_comments').value : '',
    drive_links:            'Uploading...'
  };

  var fatherFirst = document.getElementById('p_father_first') ? document.getElementById('p_father_first').value : '';
  var fatherLast  = document.getElementById('p_father_last')  ? document.getElementById('p_father_last').value  : '';
  var fatherName  = (fatherFirst + ' ' + fatherLast).trim();

  var uploadPromises = [];
  if (uploadedFiles.birthCert) uploadPromises.push(uploadFileToDrive(uploadedFiles.birthCert, 'Birth_Certificate', studentName, fatherName));
  if (uploadedFiles.immunization) uploadPromises.push(uploadFileToDrive(uploadedFiles.immunization, 'Immunization_Records', studentName, fatherName));

  Promise.all(uploadPromises)
    .then(function(results) {
      if (btn) btn.textContent = 'Sending...';
      var links = results.map(function(r) { return r.fileUrl || ''; }).filter(Boolean);
      var docNotes = [];
      if (links.length) docNotes.push(links.join('\n'));
      var laterBox2 = document.getElementById('p_docs_later');
      if (laterBox2 && laterBox2.checked) docNotes.push('Parent will provide the missing document(s) before the first day of school.');
      params.drive_links = docNotes.join('\n') || 'No files uploaded';
      emailjs.init('gYiHBKLQSOxt1Sfal');
      return emailjs.send('service_1g7cfrl', 'template_tiqzn2e', params);
    })
    .then(function(response) {
      console.log('SUCCESS:', response.status, response.text);
      var formEl = document.getElementById('popup-admission-form');
      var successEl = document.getElementById('popup-success');
      if (formEl) formEl.style.display = 'none';
      if (successEl) successEl.classList.add('show');
    })
    .catch(function(error) {
      console.error('Error:', JSON.stringify(error));
      if (btn) { btn.disabled = false; btn.textContent = 'Submit Admission'; }
      alert('Something went wrong. Please try again or email us at falahacademywa@gmail.com');
    });
};

window.handleFileSelect = function(input, type) {
  var file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { alert('File must be under 5MB.'); input.value = ''; return; }
  var allowed = ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/jpg','image/png'];
  if (allowed.indexOf(file.type) === -1) { alert('Please upload PDF, DOC, JPG or PNG only.'); input.value = ''; return; }

  if (type === 'birth-cert') {
    document.getElementById('birth-cert-placeholder').style.display = 'none';
    document.getElementById('birth-cert-preview').style.display = 'block';
    document.getElementById('birth-cert-name').textContent = file.name;
    document.getElementById('birth-cert-upload-area').style.borderColor = '#2e7d32';
    uploadedFiles.birthCert = file;
  } else {
    document.getElementById('immunization-placeholder').style.display = 'none';
    document.getElementById('immunization-preview').style.display = 'block';
    document.getElementById('immunization-name').textContent = file.name;
    document.getElementById('immunization-upload-area').style.borderColor = '#2e7d32';
    uploadedFiles.immunization = file;
  }
};

// ---- INTERNAL FUNCTIONS ----
function showPopupStep(step) {
  document.querySelectorAll('.popup-form-page').forEach(function(p, i) {
    p.classList.toggle('active', i + 1 === step);
  });
  for (var i = 1; i <= 4; i++) {
    var circle = document.getElementById('pstep-' + i);
    var label  = document.getElementById('plabel-' + i);
    if (!circle || !label) continue;
    circle.classList.remove('active', 'done');
    label.classList.remove('active');
    if (i < step) circle.classList.add('done');
    else if (i === step) { circle.classList.add('active'); label.classList.add('active'); }
    var conn = document.getElementById('pconn-' + i);
    if (conn) conn.classList.toggle('done', i < step);
  }
  popupStep = step;
  var modal = document.querySelector('.popup-modal');
  if (modal) modal.scrollTop = 0;
}

function isValidUSPhone(phone) {
  var digits = phone.replace(/\D/g, '');
  if (digits.charAt(0) === '1') digits = digits.substring(1);
  return digits.length === 10;
}

function isValidEmail(email) {
  var parts = email.trim().split('@');
  return parts.length === 2 && parts[0].length > 0 && parts[1].indexOf('.') > 0;
}

function isValidName(name) { return name.trim().length >= 2; }
function isValidZip(zip)   { return /^\d{5}$/.test(zip.trim()); }

function showFieldError(fieldId, message) {
  var field = document.getElementById(fieldId);
  if (!field) return;
  field.style.borderColor = '#c62828';
  var err = field.parentElement.querySelector('.field-error');
  if (!err) {
    err = document.createElement('p');
    err.className = 'field-error';
    err.style.cssText = 'color:#c62828;font-size:11px;margin-top:4px;';
    field.parentElement.appendChild(err);
  }
  err.textContent = message;
}

function clearAllErrors() {
  document.querySelectorAll('.field-error').forEach(function(e) { e.remove(); });
  document.querySelectorAll('.form-input, .form-select').forEach(function(f) { f.style.borderColor = ''; });
}

function resetFileUploads() {
  uploadedFiles = { birthCert: null, immunization: null };
  ['birth-cert', 'immunization'].forEach(function(type) {
    var area = document.getElementById(type + '-upload-area');
    var placeholder = document.getElementById(type + '-placeholder');
    var preview = document.getElementById(type + '-preview');
    if (area) area.style.borderColor = '';
    if (placeholder) placeholder.style.display = 'block';
    if (preview) preview.style.display = 'none';
  });
}

function validateFileUploads() {
  // Documents are optional at application time. If any document is missing,
  // the parent must confirm they will provide the documents before the
  // first day of school (checkbox #p_docs_later).
  var bothUploaded = uploadedFiles.birthCert && uploadedFiles.immunization;
  var laterBox = document.getElementById('p_docs_later');
  var laterChecked = laterBox && laterBox.checked;
  if (bothUploaded || laterChecked) return true;

  var group = document.getElementById('docs-later-group');
  if (group && !group.querySelector('.field-error')) {
    var err = document.createElement('p');
    err.className = 'field-error';
    err.style.cssText = 'color:#c62828;font-size:11px;margin-top:4px;';
    err.textContent = 'Please upload the document(s) above, or check this box to confirm you will provide them before the first day of school.';
    group.appendChild(err);
  }
  return false;
}

function validatePopupStep(step) {
  clearAllErrors();
  var valid = true;

  if (step === 1) {
    var fName = document.getElementById('p_student_first') ? document.getElementById('p_student_first').value : '';
    var lName = document.getElementById('p_student_last')  ? document.getElementById('p_student_last').value  : '';
    if (!isValidName(fName)) { showFieldError('p_student_first', 'Please enter a valid first name (at least 2 characters)'); valid = false; }
    if (!isValidName(lName)) { showFieldError('p_student_last',  'Please enter a valid last name (at least 2 characters)');  valid = false; }
    if (!document.querySelector('input[name="p_gender"]:checked')) {
      valid = false;
      var gGroup = document.querySelector('.form-radio-group');
      if (gGroup && !gGroup.querySelector('.field-error')) {
        var ge = document.createElement('p'); ge.className = 'field-error';
        ge.style.cssText = 'color:#c62828;font-size:11px;margin-top:4px;';
        ge.textContent = 'Please select a gender'; gGroup.appendChild(ge);
      }
    }
    var dob = document.getElementById('p_dob') ? document.getElementById('p_dob').value : '';
    if (!dob) { showFieldError('p_dob', 'Please enter date of birth'); valid = false; }
    var street  = document.getElementById('p_street')  ? document.getElementById('p_street').value  : '';
    var city    = document.getElementById('p_city')    ? document.getElementById('p_city').value    : '';
    var zipcode = document.getElementById('p_zipcode') ? document.getElementById('p_zipcode').value : '';
    if (street.trim().length < 5) { showFieldError('p_street',  'Please enter a valid street address'); valid = false; }
    if (city.trim().length < 2)   { showFieldError('p_city',    'Please enter a valid city');           valid = false; }
    if (!isValidZip(zipcode))     { showFieldError('p_zipcode', 'Please enter a valid 5-digit ZIP');    valid = false; }
    var grade = document.getElementById('p_grade') ? document.getElementById('p_grade').value : '';
    if (!grade) { showFieldError('p_grade', 'Please select a grade'); valid = false; }
    if (!validateFileUploads()) valid = false;
  }

  if (step === 2) {
    var ff = document.getElementById('p_father_first') ? document.getElementById('p_father_first').value : '';
    var fl = document.getElementById('p_father_last')  ? document.getElementById('p_father_last').value  : '';
    var mf = document.getElementById('p_mother_first') ? document.getElementById('p_mother_first').value : '';
    var ml = document.getElementById('p_mother_last')  ? document.getElementById('p_mother_last').value  : '';
    if (!isValidName(ff)) { showFieldError('p_father_first', 'Please enter a valid name (at least 2 characters)'); valid = false; }
    if (!isValidName(fl)) { showFieldError('p_father_last',  'Please enter a valid name (at least 2 characters)'); valid = false; }
    if (!isValidName(mf)) { showFieldError('p_mother_first', 'Please enter a valid name (at least 2 characters)'); valid = false; }
    if (!isValidName(ml)) { showFieldError('p_mother_last',  'Please enter a valid name (at least 2 characters)'); valid = false; }
    var fe = document.getElementById('p_father_email') ? document.getElementById('p_father_email').value : '';
    if (!isValidEmail(fe)) { showFieldError('p_father_email', 'Please enter a valid email address'); valid = false; }
    var fp = document.getElementById('p_father_phone') ? document.getElementById('p_father_phone').value : '';
    var mp = document.getElementById('p_mother_phone') ? document.getElementById('p_mother_phone').value : '';
    if (!isValidUSPhone(fp)) { showFieldError('p_father_phone', 'Please enter a valid US phone e.g. (206) 555-0123'); valid = false; }
    if (!isValidUSPhone(mp)) { showFieldError('p_mother_phone', 'Please enter a valid US phone e.g. (206) 555-0123'); valid = false; }
    if (isValidUSPhone(fp) && isValidUSPhone(mp)) {
      var fd = fp.replace(/\D/g,''); if(fd.charAt(0)==='1') fd=fd.substring(1);
      var md = mp.replace(/\D/g,''); if(md.charAt(0)==='1') md=md.substring(1);
      if (fd === md) { showFieldError('p_mother_phone', "Mother's phone cannot be same as Father's phone"); valid = false; }
    }
  }

  if (step === 3) {
    var en = document.getElementById('p_emg_name')  ? document.getElementById('p_emg_name').value  : '';
    var ep = document.getElementById('p_emg_phone') ? document.getElementById('p_emg_phone').value : '';
    var er = document.getElementById('p_emg_rel')   ? document.getElementById('p_emg_rel').value   : '';
    if (!isValidName(en))    { showFieldError('p_emg_name',  'Please enter a valid name (at least 2 characters)'); valid = false; }
    if (!isValidUSPhone(ep)) { showFieldError('p_emg_phone', 'Please enter a valid US phone number'); valid = false; }
    if (!er)                 { showFieldError('p_emg_rel',   'Please select a relationship'); valid = false; }
    if (isValidUSPhone(ep)) {
      var ed = ep.replace(/\D/g,''); if(ed.charAt(0)==='1') ed=ed.substring(1);
      var fp2 = document.getElementById('p_father_phone') ? document.getElementById('p_father_phone').value : '';
      var mp2 = document.getElementById('p_mother_phone') ? document.getElementById('p_mother_phone').value : '';
      var fd2 = fp2.replace(/\D/g,''); if(fd2.charAt(0)==='1') fd2=fd2.substring(1);
      var md2 = mp2.replace(/\D/g,''); if(md2.charAt(0)==='1') md2=md2.substring(1);
      if (ed === fd2) { showFieldError('p_emg_phone', "Cannot be same as Father's phone"); valid = false; }
      else if (ed === md2) { showFieldError('p_emg_phone', "Cannot be same as Mother's phone"); valid = false; }
    }
  }

  if (step === 4) {
    var agree = document.getElementById('p_agree');
    if (!agree || !agree.checked) {
      if (agree) { agree.style.outline = '2px solid #c62828'; }
      var fg = agree ? agree.closest('.form-group') : null;
      if (fg && !fg.querySelector('.field-error')) {
        var ae = document.createElement('p'); ae.className = 'field-error';
        ae.style.cssText = 'color:#c62828;font-size:11px;margin-top:4px;';
        ae.textContent = 'Please agree to the terms to proceed'; fg.appendChild(ae);
      }
      valid = false;
    }
  }

  return valid;
}

function fileToBase64(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() { resolve(reader.result.split(',')[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function uploadFileToDrive(file, fileType, studentName, fatherName) {
  return fileToBase64(file).then(function(base64) {
    return fetch(UPLOAD_URL, {
      method: 'POST',
      body: JSON.stringify({ studentName: studentName, fatherName: fatherName || '', fileType: fileType, fileName: file.name, fileData: base64, mimeType: file.type })
    }).then(function(res) { return res.json(); });
  });
}

// ---- EVENT LISTENERS ----
document.addEventListener('DOMContentLoaded', function() {
  var popup = document.getElementById('admission-popup');
  if (popup) {
    popup.addEventListener('click', function(e) {
      if (e.target === this) closeAdmissionPopup();
    });
  }
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeAdmissionPopup();
});

console.log('popup.js loaded — openAdmissionPopup ready:', typeof window.openAdmissionPopup);

// ============================================================
// FALAH ACADEMY — SUMMER PROGRAM POPUP FORM
// ============================================================

var summerStep = 1;
var SUMMER_TEMPLATE = 'template_tiqzn2e'; // Reusing admission template

// ---- OPEN / CLOSE ----
window.openSummerPopup = function() {
  var popup = document.getElementById('summer-popup');
  if (!popup) { console.error('Summer popup not found'); return; }
  popup.classList.add('open');
  document.body.classList.add('popup-open');
  summerStep = 1;
  showSummerStep(1);
};

window.closeSummerPopup = function() {
  var popup = document.getElementById('summer-popup');
  if (!popup) return;
  popup.classList.remove('open');
  document.body.classList.remove('popup-open');
  clearSummerErrors();
  var formEl = document.getElementById('summer-form');
  var successEl = document.getElementById('summer-success');
  if (formEl) { formEl.style.display = 'block'; formEl.reset(); }
  if (successEl) successEl.classList.remove('show');
  summerStep = 1;
  showSummerStep(1);
};

window.summerNext = function() {
  if (validateSummerStep(summerStep)) showSummerStep(summerStep + 1);
};

window.summerPrev = function() {
  clearSummerErrors();
  if (summerStep > 1) showSummerStep(summerStep - 1);
};

window.submitSummerForm = function(e) {
  e.preventDefault();
  if (!validateSummerStep(3)) return;

  var btn = document.getElementById('summer-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  var params = {
    student_first_name:     document.getElementById('s_student_first')  ? document.getElementById('s_student_first').value  : '',
    student_middle_name:    document.getElementById('s_student_middle') ? document.getElementById('s_student_middle').value : '',
    student_last_name:      document.getElementById('s_student_last')   ? document.getElementById('s_student_last').value   : '',
    gender:                 document.querySelector('input[name="s_gender"]:checked') ? document.querySelector('input[name="s_gender"]:checked').value : '',
    date_of_birth:          document.getElementById('s_dob')            ? document.getElementById('s_dob').value            : '',
    address:                [document.getElementById('s_street')?.value, document.getElementById('s_city')?.value, 'WA', document.getElementById('s_zipcode')?.value].filter(Boolean).join(', '),
    street:                 document.getElementById('s_street')         ? document.getElementById('s_street').value         : '',
    city:                   document.getElementById('s_city')           ? document.getElementById('s_city').value           : '',
    zipcode:                document.getElementById('s_zipcode')        ? document.getElementById('s_zipcode').value        : '',
    age_group:              document.getElementById('s_age')            ? document.getElementById('s_age').value            : '',
    father_first_name:      document.getElementById('s_father_first')   ? document.getElementById('s_father_first').value   : '',
    father_middle_name:     document.getElementById('s_father_middle')  ? document.getElementById('s_father_middle').value  : '',
    father_last_name:       document.getElementById('s_father_last')    ? document.getElementById('s_father_last').value    : '',
    father_email:           document.getElementById('s_father_email')   ? document.getElementById('s_father_email').value   : '',
    father_phone:           document.getElementById('s_father_phone')   ? document.getElementById('s_father_phone').value   : '',
    mother_first_name:      document.getElementById('s_mother_first')   ? document.getElementById('s_mother_first').value   : '',
    mother_last_name:       document.getElementById('s_mother_last')    ? document.getElementById('s_mother_last').value    : '',
    mother_phone:           document.getElementById('s_mother_phone')   ? document.getElementById('s_mother_phone').value   : '',
    emergency_name:         document.getElementById('s_emg_name')       ? document.getElementById('s_emg_name').value       : '',
    emergency_phone:        document.getElementById('s_emg_phone')      ? document.getElementById('s_emg_phone').value      : '',
    emergency_relationship: document.getElementById('s_emg_rel')        ? document.getElementById('s_emg_rel').value        : '',
    heard_about:            document.getElementById('s_heard')          ? document.getElementById('s_heard').value          : '',
    comments:               document.getElementById('s_comments')       ? document.getElementById('s_comments').value       : '',
    program:                'Summer Program 2026 (Jul 6 – Aug 6)'
  };

  emailjs.init('gYiHBKLQSOxt1Sfal');
  emailjs.send('service_1g7cfrl', SUMMER_TEMPLATE, params)
    .then(function(response) {
      console.log('Summer form SUCCESS:', response.status);
      var formEl = document.getElementById('summer-form');
      var successEl = document.getElementById('summer-success');
      if (formEl) formEl.style.display = 'none';
      if (successEl) successEl.classList.add('show');
    })
    .catch(function(error) {
      console.error('Summer form error:', JSON.stringify(error));
      if (btn) { btn.disabled = false; btn.textContent = 'Submit Registration'; }
      alert('Something went wrong. Please try again or email us at falahacademywa@gmail.com');
    });
};

// ---- INTERNAL ----
function showSummerStep(step) {
  document.querySelectorAll('.summer-form-page').forEach(function(p, i) {
    p.classList.toggle('active', i + 1 === step);
  });
  for (var i = 1; i <= 3; i++) {
    var circle = document.getElementById('sstep-' + i);
    var label  = document.getElementById('slabel-' + i);
    if (!circle || !label) continue;
    circle.classList.remove('active', 'done');
    label.classList.remove('active');
    if (i < step) circle.classList.add('done');
    else if (i === step) { circle.classList.add('active'); label.classList.add('active'); }
    if (i <= 2) {
      var conn = document.getElementById('sconn-' + i);
      if (conn) conn.classList.toggle('done', i < step);
    }
  }
  summerStep = step;
  var modal = document.querySelector('#summer-popup .popup-modal');
  if (modal) modal.scrollTop = 0;
}

function clearSummerErrors() {
  var popup = document.getElementById('summer-popup');
  if (!popup) return;
  popup.querySelectorAll('.field-error').forEach(function(e) { e.remove(); });
  popup.querySelectorAll('.form-input, .form-select').forEach(function(f) { f.style.borderColor = ''; });
}

function showSummerError(fieldId, message) {
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

function isSummerValidPhone(phone) {
  var digits = phone.replace(/\D/g, '');
  if (digits.charAt(0) === '1') digits = digits.substring(1);
  return digits.length === 10;
}

function isSummerValidEmail(email) {
  var parts = email.trim().split('@');
  return parts.length === 2 && parts[0].length > 0 && parts[1].indexOf('.') > 0;
}

function validateSummerStep(step) {
  clearSummerErrors();
  var valid = true;

  if (step === 1) {
    var fn = document.getElementById('s_student_first') ? document.getElementById('s_student_first').value : '';
    var ln = document.getElementById('s_student_last')  ? document.getElementById('s_student_last').value  : '';
    if (fn.trim().length < 2) { showSummerError('s_student_first', 'Please enter a valid first name'); valid = false; }
    if (ln.trim().length < 2) { showSummerError('s_student_last',  'Please enter a valid last name');  valid = false; }
    if (!document.querySelector('input[name="s_gender"]:checked')) {
      valid = false;
      var gGroup = document.querySelector('#summer-popup .form-radio-group');
      if (gGroup && !gGroup.querySelector('.field-error')) {
        var ge = document.createElement('p'); ge.className = 'field-error';
        ge.style.cssText = 'color:#c62828;font-size:11px;margin-top:4px;';
        ge.textContent = 'Please select a gender'; gGroup.appendChild(ge);
      }
    }
    var dob = document.getElementById('s_dob') ? document.getElementById('s_dob').value : '';
    if (!dob) { showSummerError('s_dob', 'Please enter date of birth'); valid = false; }
    var street  = document.getElementById('s_street')  ? document.getElementById('s_street').value  : '';
    var city    = document.getElementById('s_city')    ? document.getElementById('s_city').value    : '';
    var zipcode = document.getElementById('s_zipcode') ? document.getElementById('s_zipcode').value : '';
    if (street.trim().length < 5) { showSummerError('s_street',  'Please enter a valid street address'); valid = false; }
    if (city.trim().length < 2)   { showSummerError('s_city',    'Please enter a valid city'); valid = false; }
    if (!/^\d{5}$/.test(zipcode.trim())) { showSummerError('s_zipcode', 'Please enter a valid 5-digit ZIP'); valid = false; }
    if (!document.getElementById('s_age')?.value) { showSummerError('s_age', 'Please select an age group'); valid = false; }
  }

  if (step === 2) {
    var ff = document.getElementById('s_father_first') ? document.getElementById('s_father_first').value : '';
    var fl = document.getElementById('s_father_last')  ? document.getElementById('s_father_last').value  : '';
    var mf = document.getElementById('s_mother_first') ? document.getElementById('s_mother_first').value : '';
    var ml = document.getElementById('s_mother_last')  ? document.getElementById('s_mother_last').value  : '';
    if (ff.trim().length < 2) { showSummerError('s_father_first', 'Please enter a valid name'); valid = false; }
    if (fl.trim().length < 2) { showSummerError('s_father_last',  'Please enter a valid name'); valid = false; }
    if (mf.trim().length < 2) { showSummerError('s_mother_first', 'Please enter a valid name'); valid = false; }
    if (ml.trim().length < 2) { showSummerError('s_mother_last',  'Please enter a valid name'); valid = false; }
    var fe = document.getElementById('s_father_email') ? document.getElementById('s_father_email').value : '';
    if (!isSummerValidEmail(fe)) { showSummerError('s_father_email', 'Please enter a valid email address'); valid = false; }
    var fp = document.getElementById('s_father_phone') ? document.getElementById('s_father_phone').value : '';
    var mp = document.getElementById('s_mother_phone') ? document.getElementById('s_mother_phone').value : '';
    if (!isSummerValidPhone(fp)) { showSummerError('s_father_phone', 'Please enter a valid US phone'); valid = false; }
    if (!isSummerValidPhone(mp)) { showSummerError('s_mother_phone', 'Please enter a valid US phone'); valid = false; }
    if (isSummerValidPhone(fp) && isSummerValidPhone(mp)) {
      var fd = fp.replace(/\D/g,''); if(fd.charAt(0)==='1') fd=fd.substring(1);
      var md = mp.replace(/\D/g,''); if(md.charAt(0)==='1') md=md.substring(1);
      if (fd === md) { showSummerError('s_mother_phone', "Mother's phone cannot be same as Father's phone"); valid = false; }
    }
  }

  if (step === 3) {
    var en = document.getElementById('s_emg_name')  ? document.getElementById('s_emg_name').value  : '';
    var ep = document.getElementById('s_emg_phone') ? document.getElementById('s_emg_phone').value : '';
    var er = document.getElementById('s_emg_rel')   ? document.getElementById('s_emg_rel').value   : '';
    if (en.trim().length < 2) { showSummerError('s_emg_name',  'Please enter a valid name'); valid = false; }
    if (!isSummerValidPhone(ep)) { showSummerError('s_emg_phone', 'Please enter a valid US phone'); valid = false; }
    if (!er) { showSummerError('s_emg_rel', 'Please select a relationship'); valid = false; }
    var agree = document.getElementById('s_agree');
    if (!agree || !agree.checked) {
      if (agree) agree.style.outline = '2px solid #c62828';
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

document.addEventListener('DOMContentLoaded', function() {
  var popup = document.getElementById('summer-popup');
  if (popup) {
    popup.addEventListener('click', function(e) {
      if (e.target === this) closeSummerPopup();
    });
  }
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeSummerPopup();
});

console.log('summer-popup.js loaded — openSummerPopup ready:', typeof window.openSummerPopup);

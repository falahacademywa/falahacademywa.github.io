/* ============================================
   FALAH ACADEMY — Main JavaScript
   ============================================ */


// ---- ROTATING QURANIC AYAAT ----
const ayaat = [
  {
    arabic: "اقْرَأْ بِاسْمِ رَبِّكَ الَّذِي خَلَقَ",
    translation: "Read in the name of your Lord who created",
    ref: "— Surah Al-Alaq (96:1)"
  },
  {
    arabic: "قُلْ هَلْ يَسْتَوِي ٱلَّذِينَ يَعْلَمُونَ وَٱلَّذِينَ لَا يَعْلَمُونَ",
    translation: "Say, are those who know equal to those who do not know?",
    ref: "— Surah Az-Zumar (39:9)"
  },
  {
    arabic: "وَقُل رَّبِّ زِدْنِي عِلْمًا",
    translation: "And say: My Lord, increase me in knowledge",
    ref: "— Surah Taha (20:114)"
  }
];

let currentAyahIndex = 0;

function initAyaat() {
  const container = document.getElementById('ayah-rotator');
  if (!container) return;

  function showAyah(index) {
    container.style.opacity = '0';
    container.style.transform = 'translateY(8px)';
    setTimeout(() => {
      const a = ayaat[index];
      container.innerHTML = `
        <p style="color:#e8d5a0;font-size:1.1rem;font-style:normal;line-height:1.8;margin-bottom:0.5rem;direction:rtl;">${a.arabic}</p>
        <p style="color:#c0d4f0;font-style:italic;font-size:0.9rem;margin-bottom:0.3rem;">"${a.translation}"</p>
        <small style="color:#6080a8;font-size:0.78rem;">${a.ref}</small>
      `;
      container.style.opacity = '1';
      container.style.transform = 'translateY(0)';
    }, 300);
  }

  // Show first ayah
  showAyah(0);

  // Rotate every 5 seconds
  setInterval(() => {
    currentAyahIndex = (currentAyahIndex + 1) % ayaat.length;
    showAyah(currentAyahIndex);
  }, 5000);
}

// ---- ANNOUNCEMENT BANNER ----
const announcementConfig = {
  text: "Admissions Open for Academic Year 2026–2027 — Limited Seats Available!",
  link: "admissions.html",
  active: true
};

function initBanner() {
  const banner = document.getElementById('announcement-banner');
  if (!banner) return;
  if (!announcementConfig.active || !announcementConfig.text) {
    banner.classList.add('hidden');
    return;
  }
  const textEl = banner.querySelector('.banner-text');
  if (textEl) textEl.textContent = announcementConfig.text;
  banner.addEventListener('click', function(e) {
    if (e.target.classList.contains('banner-close')) {
      banner.classList.add('hidden');
      return;
    }
    if (announcementConfig.link) window.location.href = announcementConfig.link;
  });
}

// ---- NAVBAR ----
function initNavbar() {
  const navbar = document.querySelector('.navbar');
  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.nav-links');
  if (!navbar) return;

  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 50);
    const btn = document.getElementById('back-to-top');
    if (btn) btn.classList.toggle('show', window.scrollY > 400);
  });

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      hamburger.classList.toggle('open');
    });

    // Close menu when any link is clicked
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        hamburger.classList.remove('open');
      });
    });
  }

  // Active page highlighting
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });
}

// ---- BACK TO TOP ----
function initBackToTop() {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

// ---- SCROLL ANIMATIONS ----
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
}

// ---- COUNTDOWN TIMER ----
function initCountdown() {
  const container = document.getElementById('countdown-container');
  if (!container) return;

  const schoolStart = new Date('2026-08-26T09:00:00');
  const schoolEnd = new Date('2027-06-24T14:00:00');

  function update() {
    const now = new Date();
    if (now < schoolStart) {
      const diff = schoolStart - now;
      const days = Math.floor(diff / 86400000);
      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:3rem;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;text-align:left;">
            <div style="font-size:1.8rem;margin-bottom:0.5rem;">🌙</div>
            <h2 class="countdown-title" style="text-align:left;">First Day of School</h2>
            <p class="countdown-subtitle" style="text-align:left;margin-top:0.4rem;">Academic Year 2026–2027</p>
            <p style="color:#c9a84c;font-size:0.9rem;margin-top:0.3rem;font-weight:500;">August 26, 2026</p>
          </div>
          <div style="flex:0 0 auto;">
            <div class="countdown-box" style="min-width:160px;padding:1.5rem 2.5rem;text-align:center;">
              <span class="countdown-num" style="font-size:5rem;">${String(days).padStart(2,'0')}</span>
              <span class="countdown-label" style="font-size:13px;letter-spacing:2px;margin-top:8px;">Days to Go</span>
            </div>
          </div>
        </div>`;
    } else if (now >= schoolStart && now <= schoolEnd) {
      container.innerHTML = `
        <div class="countdown-icon">📚</div>
        <h2 class="countdown-title">Alhamdulillah — School is in Session!</h2>
        <p class="countdown-subtitle" style="color:#c0d4f0;font-size:1rem;margin-top:0.5rem">We are honored to serve our community and nurture the young Ummah of Nabi Muhammad ﷺ</p>`;
    } else {
      container.innerHTML = `
        <div class="countdown-icon">🎉</div>
        <h2 class="countdown-title">Admissions Open for Next Academic Year!</h2>
        <p class="countdown-subtitle" style="margin-bottom:1.5rem">Enroll your child at Falah Academy today</p>
        <a href="admissions.html" class="btn-primary">Apply Now →</a>`;
    }
  }

  update();
  setInterval(update, 1000);
}

// ---- ACADEMIC CALENDAR ----
const calendarEvents = {
  '2025-2026': {
    '2025-09-02': { type: 'school-start', label: 'First Day of School' },
    '2025-11-11': { type: 'school-off', label: 'Veterans Day — School Off' },
    '2025-11-19': { type: 'event', label: 'PTA Meeting' },
    '2025-11-27': { type: 'school-off', label: 'Thanksgiving Break — School Off' },
    '2025-11-28': { type: 'school-off', label: 'Thanksgiving Break — School Off' },
    '2025-12-22': { type: 'school-off', label: 'Winter Break — School Off' },
    '2025-12-23': { type: 'school-off', label: 'Winter Break — School Off' },
    '2025-12-24': { type: 'school-off', label: 'Winter Break — School Off' },
    '2025-12-25': { type: 'school-off', label: 'Winter Break — School Off' },
    '2025-12-26': { type: 'school-off', label: 'Winter Break — School Off' },
    '2025-12-29': { type: 'school-off', label: 'Winter Break — School Off' },
    '2025-12-30': { type: 'school-off', label: 'Winter Break — School Off' },
    '2025-12-31': { type: 'school-off', label: 'Winter Break — School Off' },
    '2026-01-01': { type: 'school-off', label: 'Winter Break — School Off' },
    '2026-01-02': { type: 'school-off', label: 'Winter Break — School Off' },
    '2026-01-19': { type: 'school-off', label: 'MLK Day — School Off' },
    '2026-02-18': { type: 'islamic', label: 'Start of Ramadan ☽ (Subject to Moon Sighting)' },
    '2026-03-16': { type: 'islamic', label: 'Eid / Spring Break ☽ (Subject to Moon Sighting)' },
    '2026-03-17': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2026-03-18': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2026-03-19': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2026-03-20': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2026-03-22': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2026-05-06': { type: 'event', label: 'PTA Meeting' },
    '2026-05-25': { type: 'school-off', label: 'Memorial Day — School Off' },
    '2026-05-28': { type: 'islamic', label: 'Eid al-Adha Break ☽ (Subject to Moon Sighting)' },
    '2026-05-29': { type: 'school-off', label: 'Eid al-Adha Break — School Off' },
    '2026-05-30': { type: 'school-off', label: 'Eid al-Adha Break — School Off' },
    '2026-06-17': { type: 'school-end', label: 'Last Day of School' }
  },
  '2026-2027': {
    '2026-08-26': { type: 'school-start', label: 'First Day of School' },
    '2026-09-07': { type: 'school-off', label: 'Labor Day — School Off' },
    '2026-11-11': { type: 'school-off', label: 'Veterans Day — School Off' },
    '2026-11-18': { type: 'event', label: 'PTA Meeting' },
    '2026-11-26': { type: 'school-off', label: 'Thanksgiving Break — School Off' },
    '2026-11-27': { type: 'school-off', label: 'Thanksgiving Break — School Off' },
    '2026-12-24': { type: 'school-off', label: 'Winter Break — School Off' },
    '2026-12-25': { type: 'school-off', label: 'Winter Break — School Off' },
    '2026-12-28': { type: 'school-off', label: 'Winter Break — School Off' },
    '2026-12-29': { type: 'school-off', label: 'Winter Break — School Off' },
    '2026-12-30': { type: 'school-off', label: 'Winter Break — School Off' },
    '2026-12-31': { type: 'school-off', label: 'Winter Break — School Off' },
    '2027-01-01': { type: 'school-off', label: 'Winter Break — School Off' },
    '2027-01-02': { type: 'school-off', label: 'Winter Break — School Off' },
    '2027-01-03': { type: 'school-off', label: 'Winter Break — School Off' },
    '2027-01-18': { type: 'school-off', label: 'MLK Day — School Off' },
    '2027-02-07': { type: 'islamic', label: 'Start of Ramadan ☽ (Subject to Moon Sighting)' },
    '2027-03-01': { type: 'islamic', label: 'Eid / Spring Break ☽ (Subject to Moon Sighting)' },
    '2027-03-02': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2027-03-03': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2027-03-04': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2027-03-07': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2027-03-08': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2027-03-09': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2027-03-10': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2027-03-11': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2027-03-12': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2027-03-13': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2027-03-14': { type: 'school-off', label: 'Eid / Spring Break — School Off' },
    '2027-05-06': { type: 'event', label: 'PTA Meeting' },
    '2027-05-15': { type: 'islamic', label: 'Eid al-Adha Break ☽ (Subject to Moon Sighting)' },
    '2027-05-16': { type: 'school-off', label: 'Eid al-Adha Break — School Off' },
    '2027-05-17': { type: 'school-off', label: 'Eid al-Adha Break — School Off' },
    '2027-05-18': { type: 'school-off', label: 'Eid al-Adha Break — School Off' },
    '2027-05-31': { type: 'school-off', label: 'Memorial Day — School Off' },
    '2027-06-24': { type: 'school-end', label: 'Last Day of School' }
  }
};

let currentCalYear = '2026-2027';
let currentCalDate = new Date();

function initCalendar() {
  const calWrap = document.getElementById('calendar-wrap');
  if (!calWrap) return;
  const startYear = currentCalYear === '2025-2026' ? 2025 : 2026;
  currentCalDate = new Date(startYear, 8, 1);
  renderCalendar();
}

function renderCalendar() {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const year = currentCalDate.getFullYear();
  const month = currentCalDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const events = calendarEvents[currentCalYear] || {};

  const monthLabel = document.getElementById('cal-month-label');
  if (monthLabel) monthLabel.textContent = `${monthNames[month]} ${year}`;

  const cells = document.getElementById('cal-cells');
  if (!cells) return;

  let html = '';
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;

  // Previous month days
  const prevDays = new Date(year, month, 0).getDate();
  for (let i = startOffset - 1; i >= 0; i--) {
    html += `<div class="cal-cell other-month">${prevDays - i}</div>`;
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month, d);
    const dayOfWeek = dateObj.getDay();
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const event = events[dateStr];
    const isToday = dateObj.toDateString() === today.toDateString();
    const isFriday = dayOfWeek === 5;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let cls = 'cal-cell';
    let tooltip = '';

    if (event) {
      cls += ` ${event.type} has-event`;
      tooltip = event.label;
    } else if (isFriday) {
      cls += ' friday-cell';
      tooltip = 'Friday — No School';
    } else if (isWeekend) {
      cls += ' weekend';
    }
    if (isToday) cls += ' today';

    const dataAttr = tooltip ? `data-tooltip="${tooltip}"` : '';
    html += `<div class="${cls}" ${dataAttr}>${d}</div>`;
  }

  // Next month days
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  let nextDay = 1;
  for (let i = startOffset + daysInMonth; i < totalCells; i++) {
    html += `<div class="cal-cell other-month">${nextDay++}</div>`;
  }

  cells.innerHTML = html;

  // Tooltip
  const tooltip = document.getElementById('cal-tooltip');
  if (tooltip) {
    cells.querySelectorAll('[data-tooltip]').forEach(cell => {
      cell.addEventListener('mouseenter', (e) => {
        tooltip.textContent = e.target.getAttribute('data-tooltip');
        tooltip.classList.add('show');
      });
      cell.addEventListener('mousemove', (e) => {
        tooltip.style.left = (e.clientX + 12) + 'px';
        tooltip.style.top = (e.clientY - 32) + 'px';
      });
      cell.addEventListener('mouseleave', () => tooltip.classList.remove('show'));
    });
  }
}

function calPrev() {
  currentCalDate.setMonth(currentCalDate.getMonth() - 1);
  renderCalendar();
}

function calNext() {
  currentCalDate.setMonth(currentCalDate.getMonth() + 1);
  renderCalendar();
}

function switchCalYear(year) {
  currentCalYear = year;
  const startYear = year === '2025-2026' ? 2025 : 2026;
  currentCalDate = new Date(startYear, 8, 1);
  document.querySelectorAll('.cal-year-tab').forEach(t => t.classList.toggle('active', t.dataset.year === year));
  renderCalendar();
}

function printCalendar() { window.print(); }

function downloadCalendar() {
  alert('To download the calendar as PDF:\n1. Press Ctrl+P (or Cmd+P on Mac)\n2. Change destination to "Save as PDF"\n3. Click Save');
}

// ---- ENROLLMENT FORM ----
let currentStep = 1;
const totalSteps = 4;

function initAdmissionForm() {
  showStep(1);
}

function showStep(step) {
  document.querySelectorAll('.form-page').forEach((p, i) => {
    p.classList.toggle('active', i + 1 === step);
  });
  document.querySelectorAll('.step-circle').forEach((c, i) => {
    c.classList.remove('active', 'done');
    if (i + 1 < step) c.classList.add('done');
    else if (i + 1 === step) c.classList.add('active');
  });
  document.querySelectorAll('.step-connector').forEach((c, i) => {
    c.classList.toggle('done', i + 1 < step);
  });
  document.querySelectorAll('.step-label').forEach((l, i) => {
    l.classList.toggle('active', i + 1 === step);
  });
  currentStep = step;
}

function nextStep() {
  if (!validateStep(currentStep)) return;
  if (currentStep < totalSteps) showStep(currentStep + 1);
}

function prevStep() {
  if (currentStep > 1) showStep(currentStep - 1);
}

function validateStep(step) {
  const page = document.querySelector(`.form-page[data-step="${step}"]`);
  if (!page) return true;
  let valid = true;
  page.querySelectorAll('[required]').forEach(field => {
    field.style.borderColor = '';
    if (!field.value.trim()) {
      field.style.borderColor = '#c62828';
      valid = false;
    }
  });
  if (!valid) {
    const firstInvalid = page.querySelector('[required]:not([value])');
    if (firstInvalid) firstInvalid.focus();
    showFormError('Please fill in all required fields.');
  } else {
    hideFormError();
  }
  return valid;
}

function showFormError(msg) {
  let err = document.getElementById('form-error');
  if (!err) {
    err = document.createElement('div');
    err.id = 'form-error';
    err.style.cssText = 'background:#fdecea;color:#c62828;padding:10px 16px;border-radius:6px;font-size:0.85rem;margin-bottom:1rem;';
    document.querySelector('.form-page.active')?.prepend(err);
  }
  err.textContent = msg;
}

function hideFormError() {
  const err = document.getElementById('form-error');
  if (err) err.remove();
}

// ---- EMAILJS FORM SUBMISSION ----
const EMAILJS_PUBLIC_KEY = 'gYiHBKLQSOxt1Sfal';
const EMAILJS_SERVICE_ID = 'service_1g7cfrl';
const EMAILJS_ENROLLMENT_TEMPLATE = 'template_tiqzn2e';
const EMAILJS_CONTACT_TEMPLATE = 'template_aczy5tp';

function submitAdmissionForm(e) {
  e.preventDefault();
  if (!validateStep(currentStep)) return;

  const btn = document.getElementById('submit-admission-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  const params = {
    student_first_name: document.getElementById('student_first_name')?.value || '',
    student_middle_name: document.getElementById('student_middle_name')?.value || '',
    student_last_name: document.getElementById('student_last_name')?.value || '',
    gender: document.querySelector('input[name="gender"]:checked')?.value || '',
    date_of_birth: document.getElementById('date_of_birth')?.value || '',
    address: document.getElementById('address')?.value || '',
    grade: document.getElementById('grade')?.value || '',
    father_first_name: document.getElementById('father_first_name')?.value || '',
    father_middle_name: document.getElementById('father_middle_name')?.value || '',
    father_last_name: document.getElementById('father_last_name')?.value || '',
    father_email: document.getElementById('father_email')?.value || '',
    father_phone: document.getElementById('father_phone')?.value || '',
    mother_first_name: document.getElementById('mother_first_name')?.value || '',
    mother_last_name: document.getElementById('mother_last_name')?.value || '',
    mother_phone: document.getElementById('mother_phone')?.value || '',
    emergency_name: document.getElementById('emergency_name')?.value || '',
    emergency_phone: document.getElementById('emergency_phone')?.value || '',
    emergency_relationship: document.getElementById('emergency_relationship')?.value || '',
    heard_about: document.getElementById('heard_about')?.value || '',
    previous_school: document.getElementById('previous_school')?.value || '',
    special_needs: document.getElementById('special_needs')?.value || '',
    comments: document.getElementById('admission_comments')?.value || ''
  };

  emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_ENROLLMENT_TEMPLATE, params)
    .then(() => {
      document.getElementById('admission-form-wrap').style.display = 'none';
      document.getElementById('admission-success').classList.add('show');
    })
    .catch((err) => {
      console.error('EmailJS error:', err);
      if (btn) { btn.disabled = false; btn.textContent = 'Submit Admission'; }
      alert('Something went wrong. Please try again or contact us at falahacademywa@gmail.com');
    });
}

function submitContactForm(e) {
  e.preventDefault();
  const btn = document.getElementById('submit-contact-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

  const params = {
    from_name: document.getElementById('contact_name')?.value || '',
    from_email: document.getElementById('contact_email')?.value || '',
    phone: document.getElementById('contact_phone')?.value || '',
    subject: document.getElementById('contact_subject')?.value || '',
    message: document.getElementById('contact_message')?.value || ''
  };

  emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_CONTACT_TEMPLATE, params)
    .then(() => {
      document.getElementById('contact-form-wrap').style.display = 'none';
      document.getElementById('contact-success').classList.add('show');
    })
    .catch((err) => {
      console.error('EmailJS error:', err);
      if (btn) { btn.disabled = false; btn.textContent = 'Send Message'; }
      alert('Something went wrong. Please try again or contact us at falahacademywa@gmail.com');
    });
}

// ---- INIT ALL ----
document.addEventListener('DOMContentLoaded', () => {
  emailjs.init(EMAILJS_PUBLIC_KEY);
  initBanner();
  initNavbar();
  initBackToTop();
  initScrollAnimations();
  initCountdown();
  initCalendar();
  initAdmissionForm();
  initAyaat();
});

// ============================================================
// EVENT GALLERY LIGHTBOX
// ============================================================
var galleryImages = [];
var lightboxIndex = 0;

document.addEventListener('DOMContentLoaded', function() {
  var items = document.querySelectorAll('.event-gallery-item img');
  galleryImages = Array.from(items).map(function(img) { return img.src; });
});

window.openLightbox = function(index) {
  lightboxIndex = index;
  var lb = document.getElementById('event-lightbox');
  var img = document.getElementById('lightbox-img');
  if (!lb || !img || !galleryImages[index]) return;
  img.src = galleryImages[index];
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
};

window.closeLightbox = function(e) {
  if (e && e.target.tagName === 'IMG') return;
  var lb = document.getElementById('event-lightbox');
  if (lb) lb.classList.remove('open');
  document.body.style.overflow = '';
};

window.lightboxNav = function(e, dir) {
  e.stopPropagation();
  lightboxIndex = (lightboxIndex + dir + galleryImages.length) % galleryImages.length;
  document.getElementById('lightbox-img').src = galleryImages[lightboxIndex];
};

document.addEventListener('keydown', function(e) {
  var lb = document.getElementById('event-lightbox');
  if (!lb || !lb.classList.contains('open')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') lightboxNav(e, -1);
  if (e.key === 'ArrowRight') lightboxNav(e, 1);
});

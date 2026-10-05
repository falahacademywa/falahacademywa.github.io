/* ============================================
   FALAH ACADEMY — Main JavaScript
   Shared by every public page: ayaat rotator, announcement banner, navbar,
   back-to-top, scroll animations, countdown, contact form, event lightbox.
   The academic calendar lives in calendar.html (inline calData) and the
   admission form in js/popup.js — neither is duplicated here.
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
      if (!container.querySelector('.rotator')) initRotator(container);   // render once, not every second
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

// ---- IN-SESSION ROTATOR (three messages while school is running) ----
// Slow rotation (8 s), pauses on hover/touch/focus, dots to pick a slide,
// no auto-rotation for visitors who prefer reduced motion. Slide 1 stays the
// school status; the other two are standing calls to action.
const SESSION_SLIDES = [
  { icon: '📚', title: 'Alhamdulillah — School is in Session!',
    text: 'We are honored to serve our community and nurture the young Ummah of Nabi Muhammad ﷺ',
    href: 'platform/', cta: 'Family Portal →' },
  { icon: '🎓', title: 'Admissions Open for 2026–2027',
    text: 'Limited seats in Pre-K, KG and Grade 1. Qur\'an, Islamic Studies and accredited academics, Monday to Thursday.',
    href: 'admissions.html#enroll', cta: 'Apply Now →' },
  { icon: '🤝', title: 'Volunteer and Earn Lasting Reward',
    text: 'With your help we can reach more children and teach each one better. Every hour you give is sadaqah jariyah. Join us for a few hours a week.',
    href: 'volunteer.html', cta: 'Volunteer With Us →' },
];
function initRotator(container) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  container.innerHTML = `
    <div class="rotator" aria-roledescription="carousel" aria-label="School news">
      ${SESSION_SLIDES.map((s, i) => `
        <div class="rotator-slide${i === 0 ? ' active' : ''}" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${SESSION_SLIDES.length}"${i === 0 ? '' : ' aria-hidden="true"'}>
          <div class="countdown-icon">${s.icon}</div>
          <h2 class="countdown-title">${s.title}</h2>
          <p class="countdown-subtitle rotator-text">${s.text}</p>
          <a href="${s.href}" class="btn-primary rotator-cta">${s.cta}</a>
        </div>`).join('')}
    </div>
    <div class="rotator-dots" role="tablist" aria-label="Choose a message">
      ${SESSION_SLIDES.map((s, i) => `<button class="rotator-dot${i === 0 ? ' active' : ''}" role="tab" aria-selected="${i === 0}" aria-label="${s.title}"></button>`).join('')}
    </div>`;
  const slides = container.querySelectorAll('.rotator-slide');
  const dots = container.querySelectorAll('.rotator-dot');
  let current = 0, timer = null, paused = false;
  function show(i) {
    current = (i + slides.length) % slides.length;
    slides.forEach((el, k) => { el.classList.toggle('active', k === current); el.setAttribute('aria-hidden', k === current ? 'false' : 'true'); });
    dots.forEach((d, k) => { d.classList.toggle('active', k === current); d.setAttribute('aria-selected', k === current ? 'true' : 'false'); });
  }
  function start() { if (reduce || timer) return; timer = setInterval(() => { if (!paused) show(current + 1); }, 8000); }
  dots.forEach((d, i) => d.addEventListener('click', () => { show(i); paused = false; }));
  container.addEventListener('mouseenter', () => { paused = true; });
  container.addEventListener('mouseleave', () => { paused = false; });
  container.addEventListener('focusin', () => { paused = true; });
  container.addEventListener('focusout', () => { paused = false; });
  container.addEventListener('touchstart', () => { paused = true; setTimeout(() => { paused = false; }, 12000); }, { passive: true });
  document.addEventListener('visibilitychange', () => { paused = document.hidden; });
  start();
}

// ---- CONTACT FORM (EmailJS) ----
// The admission form has its own EmailJS call in js/popup.js.
const EMAILJS_PUBLIC_KEY = 'gYiHBKLQSOxt1Sfal';
const EMAILJS_SERVICE_ID = 'service_1g7cfrl';
const EMAILJS_CONTACT_TEMPLATE = 'template_aczy5tp';

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
  if (window.emailjs) emailjs.init(EMAILJS_PUBLIC_KEY);
  initBanner();
  initNavbar();
  initBackToTop();
  initScrollAnimations();
  initCountdown();
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

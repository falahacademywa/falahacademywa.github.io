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

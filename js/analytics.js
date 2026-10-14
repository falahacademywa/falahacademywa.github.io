// ============================================================
// Google Analytics 4 loader for the PUBLIC website only.
// This file is loaded by the public pages and never by /platform,
// so Family Portal usage is not tracked.
// Counts only the live site (falahacademywa.org): the dev copy on
// github.io and local testing send nothing, so test visits never
// mix with real ones. Dev and prod keep this file identical.
// Umami was removed 2026-10-13 (one tracker is enough).
// ============================================================

var GA_MEASUREMENT_ID = "G-V6DNKDR9Z8";

var GA_LIVE = /^(www\.)?falahacademywa\.org$/.test(location.hostname);

if (GA_MEASUREMENT_ID && GA_LIVE) {
  var gaScript = document.createElement("script");
  gaScript.async = true;
  gaScript.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_MEASUREMENT_ID;
  document.head.appendChild(gaScript);

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID);
}

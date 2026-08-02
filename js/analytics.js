// ============================================================
// Google Analytics 4 loader.
// To enable: set GA_MEASUREMENT_ID to the property's ID
// (Admin > Data streams > Web, looks like "G-XXXXXXXXXX").
// Leave empty to disable (e.g. while testing locally).
// ============================================================

var GA_MEASUREMENT_ID = "G-V6DNKDR9Z8";

// Don't count local testing as real visitors.
var GA_DISABLED = /^(localhost|127\.|192\.168\.)/.test(location.hostname);

if (GA_MEASUREMENT_ID && !GA_DISABLED) {
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

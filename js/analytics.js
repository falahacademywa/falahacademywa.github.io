// ============================================================
// Google Analytics 4 loader.
// To enable: set GA_MEASUREMENT_ID to the property's ID
// (Admin > Data streams > Web, looks like "G-XXXXXXXXXX").
// Leave empty to disable (e.g. while testing locally).
// ============================================================

var GA_MEASUREMENT_ID = "";

if (GA_MEASUREMENT_ID) {
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

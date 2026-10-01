/**
 * FALAH ACADEMY — Zelle receipts -> Family Portal fees (phase 21)
 *
 * Bank of America e-mails the school Gmail one alert per Zelle received:
 *   subject  "<payer> sent you $300.00"
 *   body     the memo the parent typed (e.g. "School fees"), then "View your balance"
 * Every hour this script finds alerts it has not seen, inserts one row per
 * alert into the portal's zelle_inbox (deduped by the Gmail message id) and
 * asks the database to match it (match_zelle):
 *   - known payer / one family + amount = the family's monthly total -> posted
 *   - anything else -> waits on Admin -> Fees, "Zelle received — needs a match"
 * Money in only. Parents are NOT notified (President, 2026-09-28).
 *
 * SETUP (school Google account, ~5 min):
 * 1. script.google.com > New project > paste this file > save as "Zelle fees sync".
 * 2. Project Settings > Script properties:
 *      SUPABASE_URL          e.g. https://xxxx.supabase.co   (the PROD project)
 *      SUPABASE_SERVICE_KEY  the SECRET service key (never in the website)
 *      START_AFTER           (optional) yyyy/mm/dd — alerts on or before this day are
 *                            ignored; default 2026/09/30 because September's fees were
 *                            recorded by hand before this script existed.
 * 3. Run syncZelle once by hand (authorise Gmail access), check the log.
 * 4. Triggers > Add trigger: syncZelle | Time-driven | Hour timer | Every hour.
 * Processed alerts get the Gmail label "Zelle/Processed"; remove the label
 * from an alert to make the script look at it again.
 */

var LABEL = "Zelle/Processed";
function alertQuery_(props) {
  var after = props.getProperty("START_AFTER") || "2026/09/30";
  return 'from:(ealerts.bankofamerica.com) subject:"sent you $" -label:Zelle-Processed after:' + after;
}

function syncZelle() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL");
  var key = props.getProperty("SUPABASE_SERVICE_KEY");
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY in Script properties.");
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  var threads = GmailApp.search(alertQuery_(props), 0, 50);
  var seen = 0, posted = 0, pending = 0;

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      var alert = parseAlert_(msg);
      if (!alert) return;
      seen++;
      var id = upsertInbox_(url, key, alert);
      if (!id) return;
      var r = rpc_(url, key, "match_zelle", { p_inbox: id });
      if (r && r.posted) posted++; else pending++;
      Logger.log((r && r.posted ? "POSTED  " : "PENDING ") + alert.payer + " $" + alert.amount + " (" + (r && r.reason || "ok") + ")");
    });
    thread.addLabel(label);
  });
  Logger.log("Zelle sync: " + seen + " alert(s) seen, " + posted + " posted, " + pending + " left for the office.");
}

// "<payer> sent you $1,234.56" + the memo line from the body
function parseAlert_(msg) {
  var m = String(msg.getSubject() || "").match(/^(.+?) sent you \$([\d,]+\.\d{2})\s*$/);
  if (!m) return null;
  var payer = m[1].trim();
  var amount = parseFloat(m[2].replace(/,/g, ""));
  var lines = String(msg.getPlainBody() || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  var memo = null;
  for (var i = 0; i < lines.length; i++) {
    if (/sent you \$/.test(lines[i])) {
      for (var j = i + 1; j < lines.length; j++) {
        if (/view your balance/i.test(lines[j])) break;
        if (lines[j].length < 120) { memo = lines[j]; break; }
      }
      break;
    }
  }
  return { gmail_id: msg.getId(), received_at: msg.getDate().toISOString(), payer: payer, amount: amount, memo: memo };
}

// insert (ignore if this alert is already there) and return the row id
function upsertInbox_(url, key, alert) {
  var hdr = { apikey: key, Authorization: "Bearer " + key, Prefer: "resolution=ignore-duplicates,return=representation" };
  var resp = UrlFetchApp.fetch(url + "/rest/v1/zelle_inbox?on_conflict=gmail_id", {
    method: "post", contentType: "application/json", headers: hdr,
    payload: JSON.stringify(alert), muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) throw new Error("zelle_inbox insert failed: " + resp.getContentText().slice(0, 300));
  var rows = JSON.parse(resp.getContentText() || "[]");
  if (rows.length) return rows[0].id;
  // already there: fetch its id (it will be re-matched only if still pending)
  var get = UrlFetchApp.fetch(url + "/rest/v1/zelle_inbox?select=id,status&gmail_id=eq." + encodeURIComponent(alert.gmail_id), {
    headers: { apikey: key, Authorization: "Bearer " + key }, muteHttpExceptions: true,
  });
  var found = JSON.parse(get.getContentText() || "[]");
  return found.length && found[0].status === "pending" ? found[0].id : null;
}

function rpc_(url, key, fn, args) {
  var resp = UrlFetchApp.fetch(url + "/rest/v1/rpc/" + fn, {
    method: "post", contentType: "application/json",
    headers: { apikey: key, Authorization: "Bearer " + key },
    payload: JSON.stringify(args), muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) { Logger.log(fn + " failed: " + resp.getContentText().slice(0, 300)); return null; }
  return JSON.parse(resp.getContentText() || "null");
}

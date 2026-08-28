# Platform Operations Guide

Zero-cost operations for the Falah Academy Operations Platform.

## 1. Keep-alive (prevents free-tier pausing)

Workflow: `.github/workflows/platform-keepalive.yml` (runs Mon+Thu).
One-time setup — add repo secrets (GitHub repo → Settings → Secrets and
variables → Actions → New repository secret):

- `PLATFORM_SUPABASE_URL` = `https://rlaqpzeqmmlrdeqfbjyq.supabase.co`
- `PLATFORM_SUPABASE_ANON_KEY` = the publishable key

## 2. Weekly encrypted backups (free tier has NO automatic backups)

Backups must live in a **private** repo (public-repo artifacts are publicly
downloadable). One-time setup (~10 min):

1. Create a free **private** repo under the falahacademywa account, e.g. `falah-backups`.
2. In that repo add secrets:
   - `SUPABASE_DB_URL` — Supabase Dashboard → Project Settings → Database →
     Connection string (URI). Includes the database password.
   - `BACKUP_PASSPHRASE` — any long random passphrase; store a copy in the
     school's password store. Needed to decrypt backups.
3. Add this workflow as `.github/workflows/backup.yml` in the private repo:

```yaml
name: Weekly encrypted DB backup
on:
  schedule:
    - cron: "0 10 * * 0"   # Sundays ~2-3am Pacific
  workflow_dispatch: {}
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Dump and encrypt
        run: |
          sudo apt-get -qq install -y postgresql-client
          pg_dump "${{ secrets.SUPABASE_DB_URL }}" --no-owner --no-privileges \
            | gzip \
            | openssl enc -aes-256-cbc -pbkdf2 -salt \
                -pass "pass:${{ secrets.BACKUP_PASSPHRASE }}" \
                -out "backup-$(date +%F).sql.gz.enc"
      - name: Commit backup (keep last 8)
        run: |
          git config user.name "backup-bot"
          git config user.email "backup@falahacademywa.org"
          git add backup-*.sql.gz.enc
          ls -t backup-*.sql.gz.enc | tail -n +9 | xargs -r git rm -f --ignore-unmatch
          git commit -m "Backup $(date +%F)" || echo "nothing to commit"
          git push
```

To restore: `openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:PASSPHRASE -in backup-DATE.sql.gz.enc | gunzip | psql NEW_DB_URL`

## 3. Attendance sheet — "Today sheet" design (teachers' Google Sheet → platform)

The sheet only ever holds TODAY. History lives in the platform (parents see
it on their dashboard; admin exports CSV from Reports). Column C resets
itself overnight, so the sheet never grows.

1. In the school's Google account create a spreadsheet
   "Falah Academy Attendance".
2. One tab per grade, named exactly: `Pre-K`, `KG`, `Grade 1`, `Grade 3`.
3. Each tab: fixed 4 columns —
   | StudentNo | Student Name | Today   | Note (optional) |
   |-----------|--------------|---------|-----------------|
   | 10001     | Ahmed T.     | Present |                 |
   Student numbers come from the platform's Students page.
4. Extensions → Apps Script → paste `google-apps-script/attendance-sync.gs`.
5. Project Settings → Script properties:
   - `SUPABASE_URL` = the project URL
   - `SUPABASE_SERVICE_KEY` = the **LEGACY `service_role` key** (Dashboard →
     API Keys → "Legacy anon, service_role API keys" tab → reveal). Starts
     with `eyJ`. The newer `sb_secret_...` keys DO NOT work from Apps Script
     (Supabase rejects them as "browser use", HTTP 401). The key is safe HERE
     because Apps Script runs privately inside the school's Google account —
     never put it in the website.
6. In the Apps Script editor, run the `setupSheet` function once — it adds
   the headers and Present/Late/Absent dropdowns automatically.
7. Triggers → Add trigger, twice:
   - `syncAttendance` · From spreadsheet · On change
   - `clearToday` · Time-driven · Day timer · Midnight to 1am
Teacher's daily job: open their tab, tap one dropdown per student. Done.
Past-day corrections: admin edits in the platform (same-day rule preserved).

## 4. Daily notifications + email (Phase 4)

Workflow: `.github/workflows/platform-notifications.yml` (daily ~8:30am Pacific).
It runs the fee-reminder rule and emails parents any unread portal notifications.
Setup:

1. Repo secret `PLATFORM_SUPABASE_SERVICE_KEY` = the **secret** key
   (Dashboard → API Keys). GitHub secrets are encrypted — safe there,
   never in code.
2. Free Brevo account (brevo.com, 300 emails/day) with the school email →
   SMTP & API → generate an API key → repo secret `BREVO_API_KEY`.
3. Optional deliverability: in Brevo, add falahacademywa.org as a verified
   sender domain (they give you DNS records to add in Cloudflare) so emails
   send from the school domain rather than Gmail.
Emails to `*.test.local` addresses are skipped automatically.

## 5. Assignments Drive folder (teachers upload once, portal shows it)

1. In the school's Drive create a folder **Falah Assignments** with one
   subfolder per grade, named exactly like the platform grades:
   `Pre-K`, `KG`, `Grade 1`, `Grade 3`.
2. Teachers drop files named: `2026-09-05 - Math - Worksheet p12.pdf`
   (due date - subject - title). No date = no due date shown.
3. script.google.com -> New project -> paste
   `google-apps-script/drive-assignments-sync.gs`.
4. Script properties: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
   `ASSIGNMENTS_FOLDER_ID` (the root folder's ID from its Drive URL).
5. Trigger: `syncAssignments`, time-driven, hourly.
Files are made link-viewable automatically so parents can open them.
Individual (per-student) assignments are entered in the portal instead.

## 6. Teachers (no logins — by design)

Teachers never log into the platform (PRD Principle 3). Their entire
workflow: mark attendance in the Google Sheet (§3) and drop assignment
files in the Drive folder (§5). Qur'an and academic progress entries are
made by the Administrator in Admin -> Academics & Qur'an.

## 7. Class Updates form (teacher notes + photos → parent feed)

Teachers post per-subject updates ("English: practiced 3-letter words,
homework due Thursday" + photo) via ONE Google Form. Qur'an updates may
target one student (visible only to that family). Parents get an evening
digest notification (immediate 🔔 only when a homework due date is set).

1. script.google.com → New project → paste
   `google-apps-script/class-updates-form.gs` → save as "Class Updates".
2. Script properties: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (LEGACY
   service_role `eyJ...` key), `TEACHER_EMAILS` (comma-separated allowlist
   of teacher Google addresses — submissions from others are ignored).
3. Run `createForm()` once → the log prints the form's EDIT url + teacher link.
4. MANUAL (API can't create upload questions): open the edit URL → add a
   "File upload" question titled "Photo / file (optional)", 1-3 files, 10MB.
5. Share the teacher link. Teachers must be signed into any Google account
   (their personal Gmail is fine — required by Google for file uploads).
   Optional: give each teacher a pre-filled link with their grade selected
   (form editor → ⋮ → "Get pre-filled link").
6. Roster changed? Run `refreshRoster()` to rebuild the student dropdown.

## 8. Dev vs production

- Dev: project `falah-platform-dev` — test accounts, fake data. Dev repo's
  `platform-src/src/lib/supabase.ts` points here.
- Production (at launch): create a second free project `falah-platform-prod`,
  run the same three SQL files (skip the dev seed), real accounts, and point
  the master repo's config at it. Repeat keep-alive + backup setup for prod.

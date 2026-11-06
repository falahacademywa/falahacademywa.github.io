#!/usr/bin/env python3
"""
photo_check.py — hourly Red Comet photo check (phase 31, President 2026-10-31).

Runs in GitHub Actions (.github/workflows/redcomet-photo-check.yml), free on the public repo,
so it does not need the President's PC. For every workbook photo with check_status 'pending'
it downloads the image from the private `student-work` bucket, asks CLIP (openai/clip-vit-base-patch32,
open source, runs on the runner's CPU, nothing is sent to any AI service) whether it looks
like a page of school work, and records the verdict with record_photo_check():

  ok       → the hourly pull on the office PC copies it to OneDrive as before
  flagged  → in-app notification to the uploader, the grade's teachers, every admin and
             staff with Red Comet edit, plus an e-mail through Brevo; the photo waits until
             someone deletes it or presses "It is school work"

Only the image goes into the model; names stay in the database. The runner's copy of each
image exists for the length of the run and is never written to the job log.

Env: PLATFORM_SUPABASE_URL, PLATFORM_SUPABASE_SERVICE_KEY, optional BREVO_API_KEY,
     PHOTO_CHECK_THRESHOLD (default 0.9), PHOTO_CHECK_DRY_RUN=1 (score only, write nothing)
Local test:  python scripts/photo_check.py --files a.jpg b.jpg   (prints the scores)
"""
import html
import io, json, os, sys, urllib.error, urllib.parse, urllib.request

THRESHOLD = float(os.environ.get("PHOTO_CHECK_THRESHOLD", "0.9"))   # calibrated 2026-10-31: 80 real workbook photos all >= 0.96; 17 of 18 wrong images < 0.8
MODEL = "openai/clip-vit-base-patch32"
PORTAL = "https://falahacademywa.org/platform/"

# What a workbook photo looks like …
SCHOOL = [
    "a photo of a page from a children's workbook",
    "a photo of a worksheet with a child's handwriting",
    "a photo of a notebook page with handwriting",
    "a photo of a printed school worksheet",
    "a photo of a children's coloring or activity page",
    "a photo of a math worksheet with numbers",
    "a photo of a page of a textbook or reading book",
]
# … and the usual wrong picks from a phone gallery (short name shown to the teacher)
OTHER = [
    ("a selfie", "a selfie of a person's face"),
    ("a person", "a photo of a person or a child"),
    ("a room", "a photo of a room, furniture or a wall"),
    ("outdoors", "a photo taken outdoors"),
    ("a screenshot", "a screenshot of a phone screen or an app"),
    ("food", "a photo of food"),
    ("an animal", "a photo of a pet or an animal"),
    ("blurry or dark", "a blurry or very dark photo"),
    ("an object", "a photo of a toy or an object"),
    ("a car or street", "a photo of a car or a street"),
    ("a letter or bill", "a photo of an official letter, a bill or a form"),
    ("a poster or flyer", "a colorful poster or flyer"),
    ("a classroom", "a photo of a classroom with children"),
]


class Clip:
    def __init__(self):
        import torch
        from transformers import CLIPModel, CLIPProcessor
        self.torch = torch
        torch.set_num_threads(max(1, os.cpu_count() or 1))
        self.model = CLIPModel.from_pretrained(MODEL).eval()
        self.proc = CLIPProcessor.from_pretrained(MODEL)
        prompts = SCHOOL + [p for _, p in OTHER]
        with torch.no_grad():
            t = self.proc(text=prompts, return_tensors="pt", padding=True)
            f = self.model.get_text_features(**t)
            self.text = f / f.norm(dim=-1, keepdim=True)

    def score(self, data: bytes):
        """→ (p_school, top_other_name, top_other_p)"""
        from PIL import Image, ImageOps
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
        with self.torch.no_grad():
            px = self.proc(images=img, return_tensors="pt")
            f = self.model.get_image_features(**px)
            f = f / f.norm(dim=-1, keepdim=True)
            probs = (self.model.logit_scale.exp() * f @ self.text.T).softmax(dim=-1)[0].tolist()
        n = len(SCHOOL)
        p_school = sum(probs[:n])
        others = probs[n:]
        k = max(range(len(others)), key=lambda i: others[i])
        return p_school, OTHER[k][0], others[k]


def http(url, method="GET", hdr=None, body=None):
    req = urllib.request.Request(url, data=body, method=method, headers=hdr or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def email(brevo, to, name, subject, text):
    payload = {
        "sender": {"name": "Falah Academy", "email": "falahacademywa@gmail.com"},
        "to": [{"email": to, "name": name or to}],
        "subject": "Falah Academy: " + subject,
        "htmlContent": (f"<p>Assalamu Alaikum {html.escape(name or '')},</p><p>{html.escape(text)}</p>"
                        f"<p>Open it here: <a href=\"{PORTAL}\">{PORTAL}</a> (Red Comet).</p>"
                        "<p>Muneeb Abbasi<br>Principal, Falah Academy</p>"),
    }
    st, _ = http("https://api.brevo.com/v3/smtp/email", "POST",
                 {"api-key": brevo, "Content-Type": "application/json"}, json.dumps(payload).encode())
    return st


def main():
    if "--files" in sys.argv:   # local calibration: score files, write nothing
        clip = Clip()
        for p in sys.argv[sys.argv.index("--files") + 1:]:
            s, lab, lp = clip.score(open(p, "rb").read())
            print(f"{'OK  ' if s >= THRESHOLD else 'FLAG'}  school={s:.2f}  top-other={lab} {lp:.2f}  {os.path.basename(p)}")
        return

    url = os.environ.get("PLATFORM_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("PLATFORM_SUPABASE_SERVICE_KEY", "")
    brevo = os.environ.get("BREVO_API_KEY", "")
    dry = os.environ.get("PHOTO_CHECK_DRY_RUN") == "1"
    if not url or not key:
        print("Supabase secrets not set — skipping."); return
    hdr = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    st, body = http(f"{url}/rest/v1/work_uploads?select=id,path&check_status=eq.pending&order=id&limit=300", hdr=hdr)
    if st >= 400:
        print(f"query failed {st}: {body[:200]!r} (phase 31 not run on this project?)"); return
    todo = json.loads(body)
    print(f"pending photos: {len(todo)}  threshold: {THRESHOLD}")
    if not todo:
        return
    clip = Clip()
    flagged = 0
    for r in todo:
        st, data = http(f"{url}/storage/v1/object/student-work/{urllib.parse.quote(r['path'])}", hdr=hdr)
        if st >= 400:
            print(f"  #{r['id']}: image missing ({st}) — left pending"); continue
        try:
            p, lab, lp = clip.score(data)
        except Exception as e:   # unreadable image: let a person look at it
            p, lab, lp = 0.0, "unreadable image", 1.0
            print(f"  #{r['id']}: could not read the image ({e.__class__.__name__})")
        ok = p >= THRESHOLD
        print(f"  #{r['id']}: {'ok' if ok else 'FLAGGED'}  school={p:.2f}  top-other={lab} {lp:.2f}")
        if dry:
            continue
        st, out = http(f"{url}/rest/v1/rpc/record_photo_check", "POST", hdr,
                       json.dumps({"p_id": r["id"], "p_ok": ok, "p_label": None if ok else f"looks like {lab}", "p_score": round(p, 3)}).encode())
        if st >= 400:
            print(f"    record failed {st}: {out[:200]!r}"); continue
        res = json.loads(out)
        if not res.get("flagged"):
            continue
        flagged += 1
        text = (f"A {res.get('subject') or 'workbook'} photo uploaded for {res.get('student')} ({res.get('grade')}, {res.get('taken_at')}) "
                f"does not look like a workbook page (it looks like {lab}). Please open Red Comet in the portal and either delete it "
                f"or press \"It is school work\". It will not reach the office until then.")
        for n in res.get("notifications", []):
            em = (n.get("email") or "").strip()
            if brevo and em and not em.endswith("test.local"):
                print(f"    e-mail to notification {n['id']}: HTTP {email(brevo, em, n.get('name'), 'Red Comet photo needs a look', text)}")
            http(f"{url}/rest/v1/notifications?id=eq.{n['id']}", "PATCH", {**hdr, "Prefer": "return=minimal"},
                 json.dumps({"emailed": True}).encode())
    print(f"done: {len(todo)} checked, {flagged} flagged")


if __name__ == "__main__":
    main()

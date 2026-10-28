#!/usr/bin/env python3
"""
Fee receipts (phase 27, TODO #100). Runs hourly from platform-receipts.yml.

  receipt_outbox (sent_at is null)
    kind = receipt | corrected  → receipt_data(group) → PDF → storage receipts/<year>/<no>.pdf
                                 → Brevo e-mail with the PDF attached → payments.receipt_sent_at
    kind = withdrawn            → short e-mail from the snapshot payload

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, BREVO_API_KEY (optional: no key = PDFs
stored, nothing e-mailed), PORTAL_URL. Addresses containing "test.local" are
never e-mailed (dev seed families). Footer = school information, no EIN.
"""
import base64
import io
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
BREVO = os.environ.get("BREVO_API_KEY", "")
PORTAL = os.environ.get("PORTAL_URL", "https://falahacademywa.org/platform/")
LOGO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "images", "logo.jpg")

SCHOOL = "Falah Academy"
FOOTER = "Falah Academy · 25650 101st Ave SE, Kent, WA 98030 · (301) 919-0106 · falahacademywa@gmail.com · falahacademywa.org"
NAVY = colors.HexColor("#1a2f5e")
GOLD = colors.HexColor("#c9a84c")
GREY = colors.HexColor("#555555")


def api(path, method="GET", body=None, headers=None, raw=False):
    hdr = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
    if body is not None and not raw:
        body = json.dumps(body).encode()
        hdr["Content-Type"] = "application/json"
    hdr.update(headers or {})
    req = urllib.request.Request(f"{URL}{path}", data=body, method=method, headers=hdr)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            return r.status, (json.loads(data) if data and r.headers.get("content-type", "").startswith("application/json") else data)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore")


def money(x):
    return f"${float(x):,.2f}"


def long_date(s):
    return datetime.strptime(s, "%Y-%m-%d").strftime("%B %d, %Y").replace(" 0", " ")


def render_pdf(d):
    """Return PDF bytes for one receipt (receipt_data() JSON)."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.8 * inch, rightMargin=0.8 * inch, topMargin=0.6 * inch, bottomMargin=0.7 * inch,
                            title=f"{SCHOOL} receipt {d['receipt_no']}", author=SCHOOL)
    ss = getSampleStyleSheet()
    base = ParagraphStyle("b", parent=ss["Normal"], fontName="Helvetica", fontSize=10.5, leading=14)
    small = ParagraphStyle("s", parent=base, fontSize=8.5, leading=11, textColor=GREY)
    h1 = ParagraphStyle("h1", parent=base, fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=NAVY)
    h2 = ParagraphStyle("h2", parent=base, fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=NAVY, alignment=TA_RIGHT)
    right = ParagraphStyle("r", parent=base, alignment=TA_RIGHT)
    story = []

    # letterhead
    logo = Image(LOGO, width=0.9 * inch, height=0.9 * inch) if os.path.exists(LOGO) else Paragraph("", base)
    head_left = [Paragraph(SCHOOL, h1), Paragraph("Empowering Minds, Enlightening Futures", small),
                 Paragraph("25650 101st Ave SE, Kent, WA 98030 · (301) 919-0106", small),
                 Paragraph("falahacademywa@gmail.com · falahacademywa.org", small)]
    kind = "CORRECTED RECEIPT" if d.get("kind") == "corrected" else "RECEIPT"
    head_right = [Paragraph(kind, h2), Paragraph(f"<b>{d['receipt_no']}</b>", right),
                  Paragraph(f"Date: {long_date(d['payment_date'])}", right)]
    t = Table([[logo, head_left, head_right]], colWidths=[1.0 * inch, 3.6 * inch, 2.3 * inch])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, 0), 1.2, NAVY), ("BOTTOMPADDING", (0, 0), (-1, 0), 10)]))
    story += [t, Spacer(1, 14)]

    # received from / for
    story.append(Paragraph(f"<b>Received from:</b> {d.get('to_name') or 'Parent / Guardian'}", base))
    story.append(Paragraph(f"<b>Payment method:</b> {str(d.get('method', '')).capitalize()}"
                           + (f" &nbsp;·&nbsp; <b>Reference:</b> {d['reference']}" if d.get("reference") else ""), base))
    story.append(Paragraph(f"<b>Period covered:</b> {d['period_label']}", base))
    story.append(Spacer(1, 10))

    rows = [["Student", "Grade", "Period", "Amount"]]
    for ln in d["lines"]:
        rows.append([ln["student"], ln.get("grade") or "", d["period_label"], money(ln["amount"])])
    rows.append(["", "", "Total received", money(d["total"])])
    tbl = Table(rows, colWidths=[2.9 * inch, 1.2 * inch, 1.6 * inch, 1.2 * inch])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ALIGN", (3, 1), (3, -1), "RIGHT"), ("ALIGN", (2, -1), (2, -1), "RIGHT"),
        ("FONTNAME", (2, -1), (-1, -1), "Helvetica-Bold"), ("LINEABOVE", (0, -1), (-1, -1), 0.8, NAVY),
        ("GRID", (0, 0), (-1, -2), 0.3, colors.HexColor("#d9dde6")), ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#f3f5f9")]),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story += [tbl, Spacer(1, 10)]

    bal = float(d.get("balance") or 0)
    if bal > 0:
        story.append(Paragraph(f"Balance still due for {d['period_label']}: <b>{money(bal)}</b>", base))
    else:
        story.append(Paragraph(f"Tuition for {d['period_label']} is paid in full. JazakAllah khair.", base))
    if d.get("kind") == "corrected":
        story.append(Paragraph("This corrected receipt replaces the earlier receipt with the same number.", small))
    story += [Spacer(1, 18),
              Paragraph("Thank you for your trust in Falah Academy.", base),
              Spacer(1, 26)]

    def footer(canvas, _doc):
        canvas.saveState()
        canvas.setStrokeColor(GOLD); canvas.setLineWidth(1)
        canvas.line(0.8 * inch, 0.62 * inch, letter[0] - 0.8 * inch, 0.62 * inch)
        canvas.setFont("Helvetica", 8); canvas.setFillColor(GREY)
        canvas.drawCentredString(letter[0] / 2, 0.45 * inch, FOOTER)
        canvas.drawCentredString(letter[0] / 2, 0.32 * inch, "Washington nonprofit corporation · This receipt is issued for tuition and fees.")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()


def email(to, name, subject, html, attachment=None):
    if not BREVO:
        return "no BREVO_API_KEY"
    if not to or "test.local" in to:
        return "skipped (test/no address)"
    payload = {"sender": {"name": SCHOOL, "email": "falahacademywa@gmail.com"},
               "to": [{"email": to, "name": name or "Parent"}], "subject": subject, "htmlContent": html}
    if attachment:
        fname, data = attachment
        payload["attachment"] = [{"name": fname, "content": base64.b64encode(data).decode()}]
    req = urllib.request.Request("https://api.brevo.com/v3/smtp/email", data=json.dumps(payload).encode(), method="POST",
                                 headers={"api-key": BREVO, "Content-Type": "application/json", "accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return f"sent HTTP {r.status}"
    except urllib.error.HTTPError as e:
        return f"brevo HTTP {e.code}: {e.read().decode('utf-8', 'ignore')[:120]}"


def wrap(name, body):
    return (f"<p>Assalamu Alaikum {name or ''},</p>{body}"
            f"<p>— Falah Academy</p><p style=\"color:#777;font-size:12px\">{FOOTER}</p>")


def handle_receipt(o):
    st, d = api("/rest/v1/rpc/receipt_data", "POST", {"p_group": o["receipt_group"]})
    if st >= 400:
        return f"receipt_data HTTP {st}: {str(d)[:120]}"
    if not d:
        return "no payments left in the group"
    pdf = render_pdf(d)
    year = d["payment_date"][:4]
    path = f"{year}/{d['receipt_no']}.pdf"
    st, body = api(f"/storage/v1/object/receipts/{urllib.parse.quote(path)}", "POST", pdf, raw=True,
                   headers={"Content-Type": "application/pdf", "x-upsert": "true"})
    if st >= 400:
        return f"storage HTTP {st}: {str(body)[:120]}"
    kids = ", ".join(ln["student"] for ln in d["lines"])
    corrected = d.get("kind") == "corrected"
    subject = f"{SCHOOL} {'corrected ' if corrected else ''}receipt {d['receipt_no']}"
    bal = float(d.get("balance") or 0)
    body_html = (f"<p>{'This corrected receipt replaces the earlier one with the same number. ' if corrected else 'JazakAllah khair. '}"
                 f"We received <b>{money(d['total'])}</b> by {str(d.get('method', '')).capitalize()} on {long_date(d['payment_date'])} "
                 f"for {kids}, covering {d['period_label']}. Receipt <b>{d['receipt_no']}</b> is attached.</p>"
                 + (f"<p>Balance still due for {d['period_label']}: <b>{money(bal)}</b>.</p>" if bal > 0
                    else f"<p>Tuition for {d['period_label']} is paid in full.</p>"))
    result = email(d.get("to_email"), d.get("to_name"), subject, wrap(d.get("to_name"), body_html), (f"Receipt_{d['receipt_no']}.pdf", pdf))
    api(f"/rest/v1/payments?receipt_group=eq.{o['receipt_group']}", "PATCH",
        {"receipt_sent_at": datetime.utcnow().isoformat() + "Z", "receipt_path": path}, headers={"Prefer": "return=minimal"})
    if corrected:
        for pid in d.get("parent_ids") or []:
            api("/rest/v1/notifications", "POST", {"recipient_id": pid, "title": f"Corrected receipt {d['receipt_no']}",
                "message": f"The receipt for {kids}, {d['period_label']}, was corrected to {money(d['total'])}. The new PDF is under Fees.",
                "priority": "info", "link_path": "/parent", "emailed": True}, headers={"Prefer": "return=minimal"})
    return f"{path} → {d.get('to_email') or 'no address'}: {result}"


def handle_withdrawn(o):
    p = o.get("payload") or {}
    body_html = (f"<p>The payment of <b>{money(p.get('amount', 0))}</b> dated {long_date(p['payment_date']) if p.get('payment_date') else ''} "
                 f"for {p.get('student', 'your child')} ({p.get('period_label', '')}) was removed from our records, and receipt "
                 f"<b>{o.get('receipt_no')}</b> is withdrawn. If this is unexpected, please contact the office.</p>")
    return email(p.get("to_email"), p.get("to_name"), f"{SCHOOL} receipt {o.get('receipt_no')} withdrawn", wrap(p.get("to_name"), body_html))


def main():
    if not URL or not KEY:
        print("Supabase secrets not set - skipping.")
        return 0
    st, pending = api("/rest/v1/receipt_outbox?sent_at=is.null&order=created_at&limit=50")
    if st >= 400:
        print(f"outbox query failed HTTP {st}: {str(pending)[:200]} (phase 27 not run yet?)")
        return 0
    print(f"pending: {len(pending)}")
    for o in pending:
        try:
            result = handle_withdrawn(o) if o["kind"] == "withdrawn" else handle_receipt(o)
        except Exception as e:  # noqa: BLE001
            result = f"error: {e}"
        print(f"  outbox {o['id']} {o['kind']}: {result}")
        api(f"/rest/v1/receipt_outbox?id=eq.{o['id']}", "PATCH",
            {"sent_at": datetime.utcnow().isoformat() + "Z", "result": str(result)[:300]}, headers={"Prefer": "return=minimal"})
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""
notifications.py — Alert engine. Python 3.9 compatible.
Env vars read dynamically so restarts pick up .env changes.
"""

import os, ssl, smtplib, logging, httpx
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
import db

logger = logging.getLogger(__name__)


def _cfg() -> dict:
    user = os.getenv("SMTP_USER", "")
    return {
        "host":     os.getenv("SMTP_HOST", "smtp.gmail.com"),
        "port":     int(os.getenv("SMTP_PORT", "587")),
        "user":     user,
        "password": os.getenv("SMTP_PASSWORD", ""),
        "from":     os.getenv("SMTP_FROM", user),  # must be authenticated address
        "slack":    os.getenv("SLACK_WEBHOOK_URL", ""),
    }


# ══════════════════════════════════════════════════════════════════════════════
# EMAIL
# ══════════════════════════════════════════════════════════════════════════════

def _build_email(
    contact_name: str,
    label: str,
    conf_pct: float,
    threshold_pct: int,
    filename: Optional[str],
    excerpt: str,
) -> tuple:
    """Return (subject, plain_text, html) for the alert email."""

    file_str   = filename or "manual submission"
    conf_str   = f"{conf_pct:.0f}%"
    color_bar  = "#ef4444" if conf_pct >= 80 else "#f59e0b"

    subject = f"⚠️ Safety Alert: High-Severity Incident Detected — {conf_str} Confidence"

    plain = f"""\
Hi {contact_name},

Our Safety AnalystBot has flagged a new incident report that requires your attention.

WHAT HAPPENED
The system analyzed "{file_str}" and classified it as a high-severity incident with {conf_str} confidence — above the {threshold_pct}% alert threshold set for your team.

INCIDENT SUMMARY
{excerpt}

WHAT TO DO NEXT
Please log in to the Safety AnalystBot dashboard to review the full report, verify the classification, and mark the incident as reviewed or escalate it to the appropriate team.

If this alert was triggered in error, you can adjust the confidence threshold in the Incident Tracker settings.

---
This message was sent automatically by Safety AnalystBot.
You are receiving this because you are listed as an alert contact.
To stop receiving alerts, ask your administrator to remove you from the contact list.
"""

    html = f"""\
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#161b22;border-radius:12px;border:1px solid #21262d;overflow:hidden;max-width:560px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#1a1f2e;padding:20px 28px;border-bottom:1px solid #21262d;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <p style="margin:0;font-size:12px;color:#8b949e;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">Safety AnalystBot</p>
                  <h1 style="margin:4px 0 0;font-size:18px;font-weight:700;color:#e6edf3;">⚠️ High-Severity Alert</h1>
                </td>
                <td align="right">
                  <span style="background:{color_bar};color:#fff;font-size:13px;font-weight:700;padding:6px 14px;border-radius:20px;white-space:nowrap;">{conf_str} Confidence</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:24px 28px;">

            <p style="margin:0 0 20px;font-size:15px;color:#e6edf3;">
              Hi <strong>{contact_name}</strong>,
            </p>

            <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#8b949e;">
              The Safety AnalystBot has flagged a new incident report that requires your attention. 
              The system classified it as a <strong style="color:#f87171;">high-severity incident</strong> with 
              <strong style="color:#f87171;">{conf_str} confidence</strong> — above the {threshold_pct}% alert threshold 
              configured for your team.
            </p>

            <!-- Incident card -->
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="background:#0f1117;border:1px solid #21262d;border-radius:8px;margin:0 0 24px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 4px;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">File Analyzed</p>
                  <p style="margin:0 0 16px;font-size:14px;color:#e6edf3;font-weight:600;">{file_str}</p>

                  <p style="margin:0 0 4px;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Incident Summary</p>
                  <p style="margin:0;font-size:13px;line-height:1.6;color:#c9d1d9;">{excerpt}</p>
                </td>
              </tr>
            </table>

            <!-- Confidence bar -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="padding-bottom:6px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td><span style="font-size:12px;color:#8b949e;">Confidence score</span></td>
                      <td align="right"><span style="font-size:12px;font-weight:700;color:{color_bar};">{conf_str}</span></td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td>
                  <table width="100%" cellpadding="0" cellspacing="0"
                         style="background:#21262d;border-radius:4px;height:6px;">
                    <tr>
                      <td width="{conf_pct:.0f}%" style="background:{color_bar};border-radius:4px;height:6px;"></td>
                      <td></td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td align="center">
                  <a href="#" style="display:inline-block;background:#3b82f6;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">
                    Review in Dashboard →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:13px;line-height:1.6;color:#8b949e;">
              Please review the full report, verify the AI classification, and mark the incident as 
              <em>reviewed</em> or escalate it using the Incident Tracker. If this alert seems incorrect, 
              you can raise the confidence threshold in the Alert Settings.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 28px;border-top:1px solid #21262d;background:#0d1117;">
            <p style="margin:0;font-size:11px;color:#6e7681;line-height:1.6;">
              This message was sent automatically by Safety AnalystBot. You are receiving this because 
              you are listed as an alert contact. To stop receiving alerts, ask your administrator to 
              remove you from the contact list.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
"""
    return subject, plain, html


def send_email(to_email: str, contact_name: str, label: str,
               conf_pct: float, threshold_pct: int,
               filename: Optional[str], excerpt: str) -> bool:
    cfg = _cfg()
    if not cfg["user"] or not cfg["password"]:
        logger.warning("SMTP credentials not set — skipping email to %s", to_email)
        return False

    subject, plain, html = _build_email(contact_name, label, conf_pct, threshold_pct, filename, excerpt)
    sender = cfg["user"]

    logger.info("Sending alert email to %s (%s)", to_email, contact_name)
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = cfg["from"] if cfg["from"] else sender
        msg["To"]      = to_email
        msg.attach(MIMEText(plain, "plain"))
        msg.attach(MIMEText(html,  "html"))

        ctx = ssl.create_default_context()
        with smtplib.SMTP(cfg["host"], cfg["port"], timeout=15) as s:
            s.ehlo(); s.starttls(context=ctx); s.ehlo()
            s.login(sender, cfg["password"])
            s.sendmail(sender, to_email, msg.as_string())

        logger.info("✅ Email delivered to %s", to_email)
        return True

    except smtplib.SMTPAuthenticationError as e:
        logger.error("❌ SMTP auth failed — check SMTP_USER/SMTP_PASSWORD: %s", e)
    except smtplib.SMTPRecipientsRefused as e:
        logger.error("❌ Recipient refused %s: %s", to_email, e)
    except smtplib.SMTPSenderRefused as e:
        logger.error("❌ Sender refused — check SMTP_FROM matches authenticated account: %s", e)
    except Exception as e:
        logger.error("❌ Email to %s failed: %s: %s", to_email, type(e).__name__, e)
    return False


# ══════════════════════════════════════════════════════════════════════════════
# SLACK
# ══════════════════════════════════════════════════════════════════════════════

def send_slack(message: str) -> bool:
    url = _cfg()["slack"]
    if not url: return False
    try:
        r = httpx.post(url, json={"text": message}, timeout=10)
        r.raise_for_status()
        logger.info("Slack alert sent")
        return True
    except Exception as e:
        logger.error("Slack failed: %s", e)
        return False


# ══════════════════════════════════════════════════════════════════════════════
# TRIGGER
# ══════════════════════════════════════════════════════════════════════════════

def trigger_alert(incident_text: str, filename: Optional[str],
                  severity_result: dict, threshold: float) -> dict:
    label      = severity_result.get("label", "Unknown")
    confidence = severity_result.get("confidence", 0.0)
    available  = severity_result.get("available", False)

    should_trigger = available and label == "High Severity" and confidence >= threshold

    if not should_trigger:
        logger.info("Alert suppressed — label=%s conf=%.2f threshold=%.2f",
                    label, confidence, threshold)
        aid = db.log_alert(incident_text=incident_text, filename=filename,
                           severity_label=label, confidence=confidence,
                           threshold_used=threshold, contacts_notified=[], status="suppressed")
        return {"triggered": False, "contacts_notified": 0, "alert_id": aid, "status": "suppressed"}

    conf_pct      = round(confidence * 100, 1)
    threshold_pct = round(threshold * 100)
    excerpt       = incident_text[:400] + ("…" if len(incident_text) > 400 else "")
    slack_msg     = (f"🚨 *HIGH SEVERITY ALERT* — {conf_pct:.0f}% confidence\n"
                     f"File: `{filename or 'manual'}`\n_{excerpt[:200]}_")

    contacts     = db.list_contacts()
    active       = [c for c in contacts if c.get("is_active")]
    notified_ids = []
    any_failed   = False

    logger.info("Triggering alert — notifying %d contact(s)", len(active))

    for contact in active:
        ok = send_email(
            to_email=contact["email"],
            contact_name=contact["name"],
            label=label,
            conf_pct=conf_pct,
            threshold_pct=threshold_pct,
            filename=filename,
            excerpt=excerpt,
        )
        if ok: notified_ids.append(contact["id"])
        else:  any_failed = True

    send_slack(slack_msg)

    status = "failed" if (any_failed and not notified_ids) else "sent"
    aid    = db.log_alert(incident_text=incident_text, filename=filename,
                          severity_label=label, confidence=confidence,
                          threshold_used=threshold, contacts_notified=notified_ids, status=status)

    logger.info("Alert %s — notified %d/%d (status: %s)", aid, len(notified_ids), len(active), status)
    return {"triggered": True, "contacts_notified": len(notified_ids), "alert_id": aid, "status": status}

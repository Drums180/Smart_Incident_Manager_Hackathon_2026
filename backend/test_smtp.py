"""
test_smtp.py
Run from your backend folder: python3 test_smtp.py
This will tell you exactly what's failing.
"""

import os
import ssl
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

SMTP_HOST     = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER     = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM     = os.getenv("SMTP_FROM", SMTP_USER)
TEST_TO       = SMTP_USER  # send to yourself as a test

print(f"Host:     {SMTP_HOST}:{SMTP_PORT}")
print(f"User:     {SMTP_USER}")
print(f"Password: {'*' * len(SMTP_PASSWORD)} ({len(SMTP_PASSWORD)} chars)")
print(f"Sending to: {TEST_TO}")
print()

# Check password length — App Passwords are exactly 16 chars (no spaces)
if len(SMTP_PASSWORD) == 19:
    print("⚠  Password is 19 chars — looks like you included spaces (xxxx xxxx xxxx xxxx).")
    print("   Remove the spaces. App Passwords are 16 characters with no spaces.")
    SMTP_PASSWORD = SMTP_PASSWORD.replace(" ", "")
    print(f"   Auto-stripped → now {len(SMTP_PASSWORD)} chars, retrying...\n")
elif len(SMTP_PASSWORD) != 16:
    print(f"⚠  Password is {len(SMTP_PASSWORD)} chars — Gmail App Passwords are always 16 chars.")
    print("   This might be your regular Gmail password, which won't work.")
    print("   Go to: myaccount.google.com/apppasswords and create a new App Password.\n")
else:
    print(f"✓  Password length looks correct (16 chars)\n")

msg = MIMEMultipart("alternative")
msg["Subject"] = "✅ Safety AnalystBot — SMTP Test"
msg["From"]    = SMTP_FROM
msg["To"]      = TEST_TO
msg.attach(MIMEText("SMTP is working. You will receive real alert emails.", "plain"))

try:
    print("Connecting to SMTP server...")
    context = ssl.create_default_context()
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
        server.set_debuglevel(1)   # show full SMTP conversation
        server.ehlo()
        print("STARTTLS...")
        server.starttls(context=context)
        server.ehlo()
        print(f"Logging in as {SMTP_USER}...")
        server.login(SMTP_USER, SMTP_PASSWORD)
        print("Sending message...")
        server.sendmail(SMTP_FROM, TEST_TO, msg.as_string())
    print()
    print("✅ SUCCESS — check your inbox for the test email.")

except smtplib.SMTPAuthenticationError as e:
    print()
    print("❌ AUTH FAILED — wrong credentials.")
    print(f"   Error: {e}")
    print()
    print("Most likely causes:")
    print("  1. You used your regular Gmail password instead of an App Password")
    print("     → Go to myaccount.google.com/apppasswords")
    print("     → Create an App Password named 'Safety AnalystBot'")
    print("     → Use the 16-char code in .env (no spaces)")
    print()
    print("  2. 2-Step Verification is not enabled on your Google account")
    print("     → App Passwords only appear AFTER 2FA is enabled")
    print("     → Go to myaccount.google.com/security → enable 2-Step Verification first")

except smtplib.SMTPException as e:
    print(f"❌ SMTP error: {e}")

except TimeoutError:
    print("❌ Connection timed out — port 587 may be blocked by your network/firewall.")
    print("   Try on a different network or use port 465 with SSL instead.")

except Exception as e:
    print(f"❌ Unexpected error: {type(e).__name__}: {e}")

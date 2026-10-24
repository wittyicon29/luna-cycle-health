from html import escape

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from ..core.config import settings

router = APIRouter(tags=["Legal"], include_in_schema=False)


@router.get("/account-deletion", response_class=HTMLResponse)
def account_deletion_page():
    contact = escape(settings.SUPPORT_EMAIL) if settings.SUPPORT_EMAIL else "our support team"
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Delete your Luna Health account</title></head>
<body style="font-family: sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem;">
<h1>Delete your Luna Health account</h1>
<h2>In the app</h2>
<p>Open <strong>Profile</strong> &rarr; <strong>Delete account</strong>, then type DELETE to confirm.
Your account and all linked data (cycle logs, health profile, chat history, analyses, consent records)
are permanently erased immediately.</p>
<h2>Without the app</h2>
<p>Email {contact} from the address you registered with, with the subject "Delete account".
We will delete your data within 30 days and confirm by email.</p>
</body></html>"""

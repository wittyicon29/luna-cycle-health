import smtplib
from email.message import EmailMessage
import logging
from ..core.config import settings

logger = logging.getLogger(__name__)

def create_email_template(subject: str, content: str, is_html: bool = False) -> EmailMessage:
    """Create an email message with proper headers and formatting."""
    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL or settings.SMTP_USER}>"
    
    if is_html:
        msg.set_content(content, subtype='html')
    else:
        msg.set_content(content)
    
    return msg

def validate_email_config() -> bool:
    """Validate that required email configuration is present."""
    required_fields = [settings.SMTP_SERVER, settings.SMTP_USER, settings.SMTP_PASSWORD]
    return all(required_fields)

async def send_email(to_email: str, subject: str, content: str, is_html: bool = False) -> bool:
    """
    Send an email using configured SMTP settings.
    
    Args:
        to_email: Recipient email address
        subject: Email subject
        content: Email content (plain text or HTML)
        is_html: Whether content is HTML format
        
    Returns:
        bool: True if email was sent successfully, False otherwise
    """
    if not validate_email_config():
        if settings.APP_ENV != "development":
            logger.warning("Email not sent: SMTP not configured")
            return False
        # Local development only: show the mail (it carries the verification/reset link) so the
        # flow can be completed without SMTP. Never reached in testing or production.
        logger.warning(
            "MOCK EMAIL (development only)\nTo: %s\nSubject: %s\nHTML: %s\n%s",
            to_email, subject, is_html, content,
        )
        return False

    try:
        msg = create_email_template(subject, content, is_html)
        msg['To'] = to_email

        with smtplib.SMTP(settings.SMTP_SERVER, settings.SMTP_PORT) as server:
            if settings.SMTP_USE_TLS:
                server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)
            logger.info("Email sent")
            return True
    except Exception as e:
        logger.error("Email send failed: %s", type(e).__name__)
        return False

async def send_welcome_email(to_email: str, user_name: str = None) -> bool:
    """Send welcome email to new users."""
    content = f"""Welcome to Luna Health!

We're excited to have you on board. Luna Health is your personal menstrual health companion, designed to help you:

• Track your menstrual cycles and symptoms
• Get personalized health insights
• Understand your body's patterns
• Receive evidence-based guidance

Getting started is easy:
1. Fill out your health questionnaire
2. Log your first period
3. Explore your personalized cycle insights

Your privacy is our priority. All your health data is encrypted and secure.

If you have any questions or need support, don't hesitate to reach out.

Here's to understanding your body better!

The Luna Health Team
"""
    
    greeting = f"Hello {user_name}," if user_name else "Hello,"
    subject = "Welcome to Luna Health"
    full_content = f"{greeting}\n\n{content}"
    
    return await send_email(to_email, subject, full_content)

async def send_login_alert(to_email: str, login_time: str = None, device_info: str = None) -> bool:
    """Send security alert for new login."""
    import datetime
    
    if not login_time:
        login_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC")
    
    content = f"""We noticed a new login to your Luna Health account.

Login Details:
• Time: {login_time}
• Device: {device_info or 'Unknown'}

If this was you, you can safely ignore this email.

If you don't recognize this login, please:
1. Change your password immediately
2. Contact our support team

For your security, we recommend:
• Using a strong, unique password
• Enabling two-factor authentication (coming soon)
• Never sharing your login credentials

Stay safe and healthy!

The Luna Health Security Team
"""
    
    subject = "New Login to Luna Health Account"
    return await send_email(to_email, subject, content)

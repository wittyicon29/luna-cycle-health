import * as i18n from './i18n';
import { t } from './i18n';

// Server text arrives as plain English. Known fixed messages are in the Hindi catalog; anything else
// (validation text with values, dynamic details) is returned unchanged.
// Pydantic prefixes validator errors with "Value error, "; the catalog key is the bare message.
export const translateServer = text => i18n.t(typeof text === 'string' ? text.replace(/^Value error, /, '') : text);

export const errorStatusMessage = status => t('Error {status}', { status });
export const connectionProblemMessage = () => t('Connection problem. Please try again.');
export const consentRequiredMessage = () => t('Please review and accept the required consent to continue.');

// The backend's fixed user-facing messages (backend/app/api/*.py). They are looked up dynamically through
// translateServer, so the literals are listed here for `npm run i18n:check` and the review sheet.
// backendMessages.test.js keeps this list in step with the backend.
export function serverMessageCatalog() {
  return [
    // auth
    t('Email already registered'),
    t('Please verify your email before logging in. Check your inbox for the verification link.'),
    // i18n-note: deliberately vague on whether the email or the password is wrong; keep it that way in Hindi
    t('Invalid credentials'),
    t('Invalid or expired reset token'),
    t('Please verify your email to continue.'),
    t('Registration successful! Please check your email to verify your account.'),
    t('If an account with this email exists, a password reset link has been sent.'),
    t('Password reset successfully! You can now log in.'),
    // email verification
    t('This link is invalid, expired or already used. If you already chose a password, please log in.'),
    t('Please wait before requesting another verification email.'),
    t('If an account with this email exists, a verification email has been sent.'),
    t('Email is already verified.'),
    t('Verification email sent successfully.'),
    // chat
    t("You've reached today's chat limit. It resets at midnight IST."),
    t('Luna is unavailable right now. Please try again in a moment.'),
    // analysis
    t('Log at least two periods (about a month apart) so Luna can find your pattern.'),
    t('No analysis found'),
    // account (deletion): literal on purpose
    // i18n-note: account deletion; "DELETE" stays in Latin because the server expects that exact word
    t('Type DELETE to confirm account deletion'),
    t('Your account and all associated data have been permanently deleted.'),
    // daily logs
    t('Date is out of range'),
    t('Choose a range of at most 400 days'),
    t('Unknown medication'),
    // medications
    t('Medication not found'),
    t('You already have a medication with that name'),
    t('You can keep up to 30 medications. Remove or archive one first.'),
    // periods
    t('Period not found'),
    t('Period deleted'),
    // questionnaire
    // i18n-note: consent wording, translated literally
    t('Data consent is required to submit questionnaire'),
    t('No questionnaire found'),
    // validation (backend/app/schemas) and Google sign-in (backend/app/services)
    t('Only Gmail addresses are supported for registration'),
    t('Invalid Gmail address format'),
    t('You must accept the Privacy Policy and Terms to create an account'),
    t('Luna Health is for users aged 18 and over'),
    t('Password must be at most 72 bytes'),
    t('end_date cannot be before start_date'),
    t('start_date cannot be in the future'),
    t('Nothing to update'),
    t('Sleep must be in half-hour steps'),
    t('Note must be at most 1000 characters'),
    // i18n-note: consent wording, translated literally
    t('Data consent is required to proceed'),
    t('Failed to exchange authorization code'),
    t('Failed to get user information from Google'),
    t('Your Google email is not verified'),
    t('Could not get email from Google'),
    t('Google sign-in could not be verified'),
    t('Only Gmail addresses are supported'),
    t('Google sign-in is temporarily unavailable'),
    t('Google sign-in is not configured'),
  ];
}

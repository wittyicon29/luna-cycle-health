import { useState } from 'react';
import { t, useLanguage, intlLocale } from '../i18n';
import { isNative } from '../platform';
import useBilling from './useBilling';

// Server datetimes are UTC; one without a zone ("2026-12-01T05:00:00") is read as UTC, then shown as a local date.
export function formatExpiry(value) {
  if (!value) return '';
  const text = String(value);
  const zoned = /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text) ? `${text}Z` : text;
  const d = new Date(zoned);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(intlLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
}

const HELD_LINES = {
  SUBSCRIPTION_STATE_ON_HOLD: () => t('Payment on hold'),
  SUBSCRIPTION_STATE_PAUSED: () => t('Paused'),
};

// Profile → "Luna AI plan": hidden entirely while billing is off, so the Profile screen is unchanged.
export default function PlanRow({ onUpgrade }) {
  useLanguage();
  const billing = useBilling();
  const [failed, setFailed] = useState(null);
  if (!billing.enabled || !billing.status) return null;
  const { status, hasPlan } = billing;
  const date = status.active ? formatExpiry(status.expires_at) : '';
  // On hold / paused: the plan is not active but still exists in Play (it can bill again or resume): Manage, not Upgrade.
  const held = !status.active && HELD_LINES[status.state];
  const line = status.active ? (date ? t('Active until {date}', { date }) : t('Active')) : held ? held() : t('Free plan');
  const canManage = hasPlan && isNative();

  return (
    <>
      <div className="plan-row">
        <div className="plan-row-text">
          <div className="ins-lbl">{t('Luna AI plan')}</div>
          <div className="plan-row-status">{line}</div>
        </div>
        <div className="plan-row-actions">
          {!status.active && !held && (
            <button type="button" className="btn btn-p pay-btn" onClick={() => { if (onUpgrade) onUpgrade(); }}>{t('Upgrade')}</button>
          )}
          {canManage && (
            <button type="button" className="btn btn-g pay-btn" onClick={async () => { setFailed(null); setFailed(await billing.manage()); }}>{t('Manage subscription')}</button>
          )}
        </div>
      </div>
      {failed && <div className="err" role="alert">⚠ {failed.text}</div>}
      <div className="divider" />
    </>
  );
}

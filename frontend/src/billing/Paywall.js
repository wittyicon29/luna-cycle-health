import { useEffect, useRef, useState } from 'react';
import Modal from '../Modal';
import { t, useLanguage } from '../i18n';
import { isNative } from '../platform';
import useBilling from './useBilling';

const planKey = plan => `${plan.id}\u0000${plan.planId || ''}`;

function Notice({ notice }) {
  if (!notice) return null;
  if (notice.kind === 'error') {
    return (
      <div className="pay-notice">
        <div className="err" role="alert">⚠ {notice.text}</div>
        {notice.hint && <p className="pay-note">{notice.hint}</p>}
      </div>
    );
  }
  // Cancelled, pending and "finish when back online" are neutral: not an error, nothing went wrong for the user.
  return <p className={`pay-note pay-note-${notice.kind}`} role="status">{notice.text}</p>;
}

// Plans as a radio group: one card per Play base plan, each announced with its price and billing period.
function PlanCards({ plans, selected, onSelect, disabled }) {
  const refs = useRef([]);
  const move = (index, delta) => {
    const next = (index + delta + plans.length) % plans.length;
    onSelect(planKey(plans[next]));
    if (refs.current[next]) refs.current[next].focus();
  };
  const onKey = (e, index) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); move(index, 1); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); move(index, -1); }
  };
  return (
    <div className="pay-plans" role="radiogroup" aria-label={t('Choose a plan')}>
      {plans.map((plan, index) => {
        const key = planKey(plan);
        const on = key === selected;
        return (
          <button
            key={key}
            ref={node => { refs.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={`pay-plan${on ? ' on' : ''}`}
            disabled={disabled}
            onClick={() => onSelect(key)}
            onKeyDown={e => onKey(e, index)}
          >
            <span className="pay-price">{t('{price} per {period}', { price: plan.priceString, period: plan.periodLabel })}</span>
            {plan.trial && plan.trial.text && <span className="pay-trial">{plan.trial.text}</span>}
          </button>
        );
      })}
    </div>
  );
}

// The Luna AI plan paywall. `onUnlocked` runs once the SERVER says access is allowed (billing off, or the plan is
// active, e.g. right after a verified purchase); nothing here unlocks on the client's word.
export default function Paywall({ onClose, onUnlocked, returnFocus }) {
  useLanguage();
  const billing = useBilling();
  const { status, statusState, checking, products, productsState, available, busy, slow, notice, online, hasPlan, canPurchase } = billing;
  const native = isNative();
  const [selected, setSelected] = useState(null);

  const billingRef = useRef(billing);
  billingRef.current = billing;
  const unlockedRef = useRef(onUnlocked);
  unlockedRef.current = onUnlocked;
  const done = useRef(false);

  const allowed = !!status && (!status.enabled || status.active);
  useEffect(() => {
    if (done.current || checking || !allowed) return;
    done.current = true;
    unlockedRef.current();
  }, [allowed, checking]);

  const wantsPlans = !!status && status.enabled && !status.active;
  useEffect(() => { if (wantsPlans) billingRef.current.loadProducts(); }, [wantsPlans]);
  useEffect(() => () => billingRef.current.clearNotice(), []);

  const plan = products.find(p => planKey(p) === selected) || products[0] || null;
  const selectedKey = plan ? planKey(plan) : null;

  // Closing never waits for Play: a purchase that did not come back stops blocking the screen (it is still verified
  // if it ever returns a purchase).
  const close = () => { billing.cancelBusy(); onClose(); };

  let body;
  if (!status) {
    body = statusState === 'loading' || checking
      ? <p className="pay-note" role="status">{t('Checking your plan…')}</p>
      : (
        <div className="pay-stack">
          <p className="pay-note">{t("We couldn't check your Luna AI plan. Please try again.")}</p>
          <button type="button" className="btn btn-g pay-btn" onClick={() => billing.retryStatus()}>{t('Retry')}</button>
        </div>
      );
  } else if (allowed) {
    body = null;
  } else if (available === false && !native) {
    body = <p className="pay-note">{t('The Luna AI plan is purchased in the Android app. Sign in with the same account here to use it.')}</p>;
  } else if (available === false) {
    body = <p className="pay-note">{t("Google Play billing isn't available on this device right now.")}</p>;
  } else if (productsState === 'error') {
    body = (
      <div className="pay-stack">
        <p className="pay-note">{t("Plans couldn't be loaded. Please try again.")}</p>
        <button type="button" className="btn btn-g pay-btn" onClick={() => billing.loadProducts(true)} disabled={!online}>{t('Retry')}</button>
      </div>
    );
  } else if (productsState !== 'ready') {
    body = <p className="pay-note" role="status">{t('Loading plans…')}</p>;
  } else if (!products.length) {
    body = <p className="pay-note">{t('No plans are available right now. Please try again later.')}</p>;
  } else {
    body = (
      <div className="pay-stack">
        <PlanCards plans={products} selected={selectedKey} onSelect={setSelected} disabled={!!busy} />
        <p className="pay-note" id="pay-terms">
          {t('Renews automatically until cancelled.')} {t('Cancel anytime in Google Play with Manage subscription.')}
        </p>
        <button type="button" className="btn btn-p pay-btn pay-buy" aria-describedby="pay-terms"
          disabled={!canPurchase || !plan} onClick={() => billing.buy(plan)}>
          {busy === 'buy' ? t('Opening Google Play…') : t('Subscribe')}
        </button>
      </div>
    );
  }

  const storeShown = !!status && status.enabled && !status.active && available === true;
  return (
    <Modal dialog returnFocus={returnFocus} title={t('Luna AI plan')} onClose={close}
      footer={<button type="button" className="btn btn-g pay-btn" onClick={close}>{t('Not now')}</button>}>
      <div className="pay">
        <p className="pay-lead">{t('Get more from Luna with Insights and Chat. Cycle tracking stays free.')}</p>
        {body}
        {storeShown && !online && <p className="pay-note" role="status">{t("You're offline. Connect to the internet to subscribe.")}</p>}
        {slow && busy === 'buy' && (
          <p className="pay-note" role="status">{t('This is taking longer than usual. You can close this; if you paid, tap Restore purchases later.')}</p>
        )}
        <Notice notice={notice} />
        {storeShown && (
          <div className="pay-actions">
            <button type="button" className="btn btn-g pay-btn" disabled={!!busy || !online} onClick={() => billing.restore()}>
              {busy === 'restore' ? t('Restoring…') : t('Restore purchases')}
            </button>
            {hasPlan && native && (
              <button type="button" className="btn btn-g pay-btn" onClick={() => billing.manage()}>{t('Manage subscription')}</button>
            )}
          </div>
        )}
        <div className="pay-legal">
          <a className="legal-link" href="/terms" target="_blank" rel="noreferrer">{t('Terms')}</a>
          <a className="legal-link" href="/privacy" target="_blank" rel="noreferrer">{t('Privacy Policy')}</a>
        </div>
      </div>
    </Modal>
  );
}

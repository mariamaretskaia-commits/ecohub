/**
 * Trust score (порт из app/services/trust_score.py).
 * Формула 0–100, уровни low/medium/high. Одинаковая для любой среды.
 */
export const BONUS_AGE_OLD = 10;
export const AGE_7D_PENALTY = 25;
export const AGE_30D_PENALTY = 10;
export const PROFILE_PENALTY = 10;
export const PROFILE_BONUS = 10;
export const REPORT_PENALTY = 15;
export const REPORT_PENALTY_UNCONFIRMED_FACTOR = 0.5;
export const DEAL_BONUS = 5;
export const DEAL_BONUS_CAP = 6;
export const CANCEL_PENALTY = 5;
export const CANCEL_PENALTY_CAP = 4;
export const FIRST_MSG_PENALTY = 20;

export const DEFAULT_TRUST_BASE = 50;
export const DEFAULT_TRUST_LOW_MIN = 70;
export const DEFAULT_TRUST_HIGH_MAX = 40;

export function trustThresholds() {
  return {
    base: numberEnv('TRUST_BASE', DEFAULT_TRUST_BASE),
    lowMin: numberEnv('TRUST_LOW_MIN', DEFAULT_TRUST_LOW_MIN),
    highMax: numberEnv('TRUST_HIGH_MAX', DEFAULT_TRUST_HIGH_MAX),
  };
}

function numberEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

export function levelFor(score) {
  const { lowMin, highMax } = trustThresholds();
  if (score >= lowMin) return 'low';
  if (score < highMax) return 'high';
  return 'medium';
}

export function trustSignalsSnapshot(signals) {
  return {
    acct_age_days: signals.acct_age_days || 0,
    has_avatar: Boolean(signals.has_avatar),
    has_username: Boolean(signals.has_username),
    reports_30d: signals.reports_30d || 0,
    confirmed_reports_30d: signals.confirmed_reports_30d || 0,
    completed_deals: signals.completed_deals || 0,
    cancelled_items: signals.cancelled_items || 0,
    suspicious_first_msg: Boolean(signals.suspicious_first_msg),
    first_msg_penalty_applied: Boolean(signals.first_msg_penalty_applied),
  };
}

export function compute(signals) {
  const { base } = trustThresholds();
  let score = base;

  if (signals.acct_age_days < 7) score -= AGE_7D_PENALTY;
  else if (signals.acct_age_days <= 30) score -= AGE_30D_PENALTY;
  else if (signals.acct_age_days > 90) score += BONUS_AGE_OLD;

  if (!signals.has_avatar && !signals.has_username) score -= PROFILE_PENALTY;
  else if (signals.has_avatar && signals.has_username) score += PROFILE_BONUS;

  const confirmed = Math.min(signals.confirmed_reports_30d || 0, 3);
  const unconfirmed = Math.min(Math.max((signals.reports_30d || 0) - (signals.confirmed_reports_30d || 0), 0), 3);
  score -= REPORT_PENALTY * confirmed;
  score -= REPORT_PENALTY * REPORT_PENALTY_UNCONFIRMED_FACTOR * unconfirmed;

  score += DEAL_BONUS * Math.min(signals.completed_deals || 0, DEAL_BONUS_CAP);
  score -= CANCEL_PENALTY * Math.min(signals.cancelled_items || 0, CANCEL_PENALTY_CAP);

  if (signals.suspicious_first_msg && !signals.first_msg_penalty_applied) {
    score -= FIRST_MSG_PENALTY;
  }

  score = Math.max(0, Math.min(100, score));
  const rounded = Math.round(score);
  return [rounded, levelFor(rounded)];
}

export function details(signals) {
  const lines = [];
  if (signals.acct_age_days < 7) {
    lines.push({ rule: 'account_age_lt_7d', impact: -25, value: signals.acct_age_days });
  } else if (signals.acct_age_days > 90) {
    lines.push({ rule: 'account_age_gt_90d', impact: 10, value: signals.acct_age_days });
  }
  if (!signals.has_avatar && !signals.has_username) {
    lines.push({ rule: 'no_profile', impact: -10 });
  } else if (signals.has_avatar && signals.has_username) {
    lines.push({ rule: 'full_profile', impact: 10 });
  }
  const confirmed = Math.min(signals.confirmed_reports_30d || 0, 3);
  const unconfirmed = Math.min(Math.max((signals.reports_30d || 0) - (signals.confirmed_reports_30d || 0), 0), 3);
  if (confirmed) lines.push({ rule: 'confirmed_reports_30d', impact: -15 * confirmed, value: signals.confirmed_reports_30d });
  if (unconfirmed) lines.push({ rule: 'unconfirmed_reports_30d', impact: -15 * 0.5 * unconfirmed, value: signals.reports_30d });
  const deals = Math.min(signals.completed_deals || 0, DEAL_BONUS_CAP);
  if (deals) lines.push({ rule: 'completed_deals', impact: 5 * deals, value: signals.completed_deals });
  const canc = Math.min(signals.cancelled_items || 0, CANCEL_PENALTY_CAP);
  if (canc) lines.push({ rule: 'cancelled_items', impact: -5 * canc, value: signals.cancelled_items });
  if (signals.suspicious_first_msg && !signals.first_msg_penalty_applied) {
    lines.push({ rule: 'suspicious_first_msg', impact: -20 });
  }
  return lines;
}
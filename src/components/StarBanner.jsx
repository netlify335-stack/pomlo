// v1.10.75 - a slim "star us on GitHub" line at the top of the app. Asked
// for by the maintainer: closable like a notification, at most once a month.
// First shown 3 days after the app was first opened in this browser, never
// to someone on day one. ✕ hides it for 30 days; "Star on GitHub" or
// "Already starred" hides it for good. Per browser (localStorage), which is
// fine for a reminder: losing it only means one more polite line.
import { useState } from 'react';
import { Star, X } from 'lucide-react';

const KEY = 'freegstbill_starBanner';
const REPO = 'https://github.com/IamRamgarhia/Free-GST-Billing-Software';
const DAY = 86400000;
const FIRST_AFTER_DAYS = 3;
const EVERY_DAYS = 30;

const load = () => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* blocked storage: treat as new */ }
  if (!s.firstSeen) {
    s = { ...s, firstSeen: Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
  }
  return s;
};

const due = (s, now = Date.now()) => !s.done && (s.closedAt
  ? now - s.closedAt >= EVERY_DAYS * DAY
  : now - s.firstSeen >= FIRST_AFTER_DAYS * DAY);

export default function StarBanner() {
  return null;
}

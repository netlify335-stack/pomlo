// v1.10.80 - the daily support card on the Dashboard (was a 50-invoice
// milestone card every 120 days). The maintainer asked to be in front of
// users every day: once a business has made a few invoices, the card shows
// once a day with the live supporters total. "Not today" hides it until
// tomorrow, "Hide for 30 days" for a month. Never a popup, never blocks work,
// never printed on an invoice. Per browser (localStorage), which is fine for a
// reminder: losing it only means one more card.
import { useState } from 'react';
import { Heart } from 'lucide-react';
import useSupporters from './useSupporters';
import { shouldShowSupportNudge, localDay, SNOOZE_DAYS } from '../utils/supporters';

const KEY = 'freegstbill_supportNudge';

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };
const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

// A different line each day, so the card doesn't read as the same banner.
const LINES = [
  'Free GST Billing is free, with no ads and no paid version. It keeps going because users chip in.',
  'One developer builds this app in spare hours. A small UPI payment pays for the next fix.',
  'No subscription, no locked features. If the app saves you time, help keep it free for everyone.',
  'Every bug you report and every rupee you send goes into the next update.',
];

export default function SupportNudge() {
  return null;
}

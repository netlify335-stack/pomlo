// v1.10.75 - a small line at the end of the Dashboard only (on other screens
// it took working space; floating, it covered the table - #83): the app's
// name and version, who makes it, and the Support page. Only the user sees
// it; it is never printed on an invoice. The version comes from the local
// server, so it works offline.
import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';

export default function AppFooter({ onOpenSupport }) {
  const [version, setVersion] = useState('');
  useEffect(() => {
    let live = true;
    fetch('/api/version').then((r) => r.json()).then((d) => { if (live && d?.current) setVersion(d.current); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const link = { color: 'inherit', textDecoration: 'none', fontWeight: 600 };
  return (
    <footer style={{
      // v1.10.76 (#83) - below the invoice table, not floating over it.
      marginTop: 'auto', paddingTop: '1.5rem',
      textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)',
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', justifyContent: 'center',
        padding: '0.3rem 0.85rem', borderRadius: 999, background: 'var(--card-bg)', border: '1px solid var(--border)',
        backdropFilter: 'blur(12px)',
      }}>
        <span>Pomelo Accounts{version ? ` v${version}` : ''}</span>
      </span>
    </footer>
  );
}

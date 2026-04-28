import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import PageContainer from '../components/PageContainer';
import SkeletonBlock from '../components/SkeletonBlock';

export default function Reconcile() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [continuing, setContinuing] = useState(false);

  useEffect(() => { document.title = 'Reconcile — Damage'; }, []);

  useEffect(() => {
    async function load() {
      setError('');
      try {
      const q = query(collection(db, 'sessions'), where('status', '==', 'locked'));
      const snap = await getDocs(q);

      const sessionList = await Promise.all(
        snap.docs.map(async d => {
          const data = d.data();
          const [membersSnap, venuesSnap] = await Promise.all([
            getDocs(collection(db, 'sessions', d.id, 'members')),
            getDocs(collection(db, 'sessions', d.id, 'venues')),
          ]);

          let total = 0;
          for (const vDoc of venuesSnap.docs) {
            const vData = vDoc.data();
            const iSnap = await getDocs(collection(db, 'sessions', d.id, 'venues', vDoc.id, 'items'));
            total += iSnap.docs.reduce((s, iDoc) => {
              const item = iDoc.data();
              return s + (item.unitPrice ?? 0) * (item.quantity ?? 1);
            }, 0) + (vData.gstAmount || 0) + (vData.serviceChargeAmount || 0);
          }

          let billPayerName = null;
          if (data.billPayer) {
            const bp = membersSnap.docs.find(m => m.id === data.billPayer);
            billPayerName = bp?.data()?.name ?? null;
          }

          return {
            id: d.id,
            name: data.name,
            date: data.date,
            memberCount: membersSnap.size,
            total,
            billPayerName,
          };
        })
      );

      setSessions(sessionList);
      setLoading(false);
      } catch (err) {
        console.error(err);
        setError('Sessions couldn\'t load. Check your connection and try again.');
        setLoading(false);
      }
    }
    load();
  }, []);

  function toggle(id) {
    setSelected(p => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleContinue() {
    if (selected.size < 2 || continuing) return;
    setContinuing(true);
    navigate('/reconcile/map-people', { state: { sessionIds: [...selected] } });
  }

  const canContinue = selected.size >= 2;

  const formattedDate = dateStr => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-SG', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    } catch { return dateStr; }
  };

  if (loading) return (
    <PageContainer>
      <div style={s.header}>
        <button style={s.back} onClick={() => navigate('/')}>←</button>
        <div style={s.headerText}>
          <div style={s.title}>Reconcile sessions</div>
        </div>
      </div>
      {[...Array(3)].map((_, i) => (
        <SkeletonBlock key={i} height="60px" borderRadius="12px" style={{ marginBottom: '8px' }} />
      ))}
    </PageContainer>
  );

  if (error) return (
    <PageContainer>
      <div style={s.header}>
        <button style={s.back} onClick={() => navigate('/')}>←</button>
        <div style={s.headerText}><div style={s.title}>Reconcile sessions</div></div>
      </div>
      <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', textAlign: 'center', padding: '40px 0 20px' }}>{error}</div>
      <button style={s.btn} onClick={() => { setLoading(true); setError(''); }}>Retry</button>
    </PageContainer>
  );

  return (
    <PageContainer>
      <div style={s.header}>
        <button style={s.back} onClick={() => navigate('/')}>←</button>
        <div style={s.headerText}>
          <div style={s.title}>Reconcile sessions</div>
          <div style={s.subtitle}>Select locked sessions to combine</div>
        </div>
      </div>

      <div style={s.helper}>
        Select two or more locked sessions to reconcile debts across them.
      </div>

      {sessions.length === 0 ? (
        <div style={s.empty}>
          No locked sessions found. Lock a session first.
        </div>
      ) : (
        sessions.map(session => {
          const sel = selected.has(session.id);
          return (
            <div
              key={session.id}
              style={{ ...s.row, border: sel ? '1.5px solid var(--text-primary)' : '0.5px solid var(--border-color)' }}
              onClick={() => toggle(session.id)}
            >
              <div style={{ ...s.checkbox, ...(sel ? s.checkboxSel : {}) }}>
                {sel && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="var(--bg-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <div style={s.info}>
                <div style={s.name}>{session.name}</div>
                <div style={s.meta}>
                  {formattedDate(session.date)}
                  {' · '}
                  {session.memberCount} {session.memberCount === 1 ? 'person' : 'people'}
                  {' · '}
                  ${session.total.toFixed(2)}
                  {' · '}
                  <span style={{ color: session.billPayerName ? undefined : 'var(--text-tertiary)' }}>
                    Paid by {session.billPayerName ?? 'unknown'}
                  </span>
                </div>
              </div>
            </div>
          );
        })
      )}

      <div style={{ marginTop: '16px' }}>
        <button
          style={{ ...s.btn, opacity: canContinue ? (continuing ? 0.6 : 1) : 0.4 }}
          onClick={handleContinue}
          disabled={!canContinue || continuing}
        >
          {continuing ? 'Loading…' : `Continue with ${selected.size} session${selected.size !== 1 ? 's' : ''} →`}
        </button>
      </div>
    </PageContainer>
  );
}

const s = {
  header: { display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' },
  back: { background: 'none', border: 'none', fontSize: '20px', color: 'var(--text-primary)', cursor: 'pointer', padding: '0', lineHeight: 1.6 },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: '20px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  subtitle: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px' },
  helper: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '12px' },
  empty: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', textAlign: 'center', padding: '48px 0' },
  row: { borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', backgroundColor: 'var(--bg-primary)' },
  checkbox: { width: '18px', height: '18px', borderRadius: '4px', border: '1px solid var(--border-color)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  checkboxSel: { backgroundColor: 'var(--text-primary)', borderColor: 'var(--text-primary)' },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  meta: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px' },
  btn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer' },
};

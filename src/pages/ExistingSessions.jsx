import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SkeletonBlock from '../components/SkeletonBlock';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import PageContainer from '../components/PageContainer';
import { BRAND_NAME } from '../brand';
import { clickKey } from '../utils/a11y';

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-SG', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return dateStr; }
}

function StatusBadge({ status }) {
  if (status === 'open') return <span style={s.badgeOpen}>Open</span>;
  if (status === 'locked') return <span style={s.badgeLocked}>Locked</span>;
  if (status === 'closed') return <span style={s.badgeClosed}>Closed</span>;
  return <span style={s.badgeLocked}>{status}</span>;
}

export default function ExistingSessions() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { document.title = `Sessions — ${BRAND_NAME}`; }, []);

  useEffect(() => {
    async function load() {
      const snap = await getDocs(collection(db, 'sessions'));
      const list = await Promise.all(
        snap.docs.map(async d => {
          const data = d.data();
          const [membersSnap, venuesSnap] = await Promise.all([
            getDocs(collection(db, 'sessions', d.id, 'members')),
            getDocs(collection(db, 'sessions', d.id, 'venues')),
          ]);
          const total = venuesSnap.docs.reduce((sum, v) => sum + (v.data().receiptTotal || 0), 0);
          let billPayerName = null;
          if (data.billPayer) {
            const bp = membersSnap.docs.find(m => m.id === data.billPayer);
            billPayerName = bp?.data()?.name ?? null;
          }
          return {
            id: d.id,
            name: data.name,
            date: data.date,
            status: data.status ?? 'open',
            memberCount: membersSnap.size,
            total,
            billPayerName,
            createdAt: data.createdAt?.seconds ?? 0,
          };
        })
      );
      list.sort((a, b) => b.createdAt - a.createdAt);
      setSessions(list);
      setLoading(false);
    }
    load();
  }, []);

  function handleTap(session) {
    if (session.status === 'closed') {
      navigate(`/session/${session.id}/breakdown`);
    } else {
      navigate(`/s/${session.id}`, { state: { from: 'existing-sessions' } });
    }
  }

  if (loading) return (
    <PageContainer>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '20px' }}>
        <SkeletonBlock width="20px" height="20px" borderRadius="4px" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <SkeletonBlock width="140px" height="20px" />
          <SkeletonBlock width="220px" height="12px" />
        </div>
      </div>
      {[0,1,2,3].map(i => (
        <div key={i} style={{ border: '0.5px solid var(--border-color)', borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <SkeletonBlock width={`${120 + i * 30}px`} height="13px" />
            <SkeletonBlock width="140px" height="11px" />
          </div>
          <SkeletonBlock width="50px" height="20px" borderRadius="20px" />
        </div>
      ))}
    </PageContainer>
  );

  return (
    <PageContainer>
      <div style={s.header}>
        <button style={s.back} onClick={() => navigate('/')}>←</button>
        <div style={s.headerText}>
          <div style={s.title}>Existing sessions</div>
          <div style={s.subtitle}>Tap any session to continue — you'll be asked who you are.</div>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div style={s.empty}>No sessions yet. Create one from the home screen.</div>
      ) : (
        sessions.map(session => (
          <div
            key={session.id}
            role="button"
            tabIndex={0}
            aria-label={`Open session ${session.name}`}
            style={s.row}
            onClick={() => handleTap(session)}
            onKeyDown={clickKey(() => handleTap(session))}
          >
            <div style={s.rowLeft}>
              <div style={s.name}>{session.name}</div>
              <div style={s.meta}>
                {formatDate(session.date)}
                {session.memberCount > 0 && ` · ${session.memberCount} ${session.memberCount === 1 ? 'person' : 'people'}`}
                {session.total > 0 && ` · $${session.total.toFixed(2)}`}
                {session.billPayerName && ` · Paid by ${session.billPayerName}`}
              </div>
            </div>
            <div style={s.rowRight}>
              <StatusBadge status={session.status} />
              <span style={s.chevron}>›</span>
            </div>
          </div>
        ))
      )}
    </PageContainer>
  );
}

const s = {
  header: { display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '20px' },
  back: { background: 'none', border: 'none', fontSize: '20px', color: 'var(--text-primary)', cursor: 'pointer', padding: '0', lineHeight: 1.6 },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: '20px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  subtitle: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '3px' },
  empty: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', textAlign: 'center', padding: '48px 0' },
  row: { border: '0.5px solid var(--border-color)', borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'var(--bg-primary)' },
  rowLeft: { flex: 1, minWidth: 0 },
  name: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  meta: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px' },
  rowRight: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 },
  badgeOpen: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', backgroundColor: '#FAEEDA', color: '#633806', fontFamily: 'system-ui, -apple-system, sans-serif' },
  badgeLocked: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '0.5px solid var(--border-color)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  badgeClosed: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', backgroundColor: '#EAF3DE', color: '#27500A', fontFamily: 'system-ui, -apple-system, sans-serif' },
  chevron: { fontSize: '18px', color: 'var(--text-tertiary)', lineHeight: 1 },
};

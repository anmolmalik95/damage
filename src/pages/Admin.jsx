import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

const PASS = import.meta.env.VITE_ADMIN_PASSWORD || 'fucked';
const TABS = ['all', 'open', 'locked', 'closed'];

function StatusBadge({ status }) {
  if (status === 'open') return <span style={b.badgeOpen}>Open</span>;
  if (status === 'locked') return <span style={b.badgeLocked}>Locked</span>;
  if (status === 'closed') return <span style={b.badgeClosed}>Closed</span>;
  return <span style={b.badgeLocked}>{status}</span>;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-SG', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return dateStr; }
}

export default function Admin() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(() => sessionStorage.getItem('adminAuth') === 'true');

  useEffect(() => { document.title = 'Admin — Unfuck'; }, []);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');

  // Dashboard data
  useEffect(() => {
    if (!authed) return;
    const unsub = onSnapshot(collection(db, 'sessions'), async snap => {
      const list = await Promise.all(
        snap.docs.map(async d => {
          const data = d.data();
          const [membersSnap, venuesSnap] = await Promise.all([
            getDocs(collection(db, 'sessions', d.id, 'members')),
            getDocs(collection(db, 'sessions', d.id, 'venues')),
          ]);
          const total = venuesSnap.docs.reduce((s, v) => s + (v.data().receiptTotal || 0), 0);
          return {
            id: d.id,
            name: data.name,
            date: data.date,
            status: data.status ?? 'open',
            memberCount: membersSnap.size,
            venueCount: venuesSnap.size,
            total,
            createdAt: data.createdAt?.seconds ?? 0,
          };
        })
      );
      list.sort((a, b) => b.createdAt - a.createdAt);
      setSessions(list);
      setLoading(false);
    });
    return () => unsub();
  }, [authed]);

  function handleLogin(e) {
    e.preventDefault();
    if (input === PASS) {
      sessionStorage.setItem('adminAuth', 'true');
      setAuthed(true);
      setError('');
    } else {
      setError('Incorrect password');
      setShaking(true);
      setTimeout(() => setShaking(false), 400);
    }
  }

  function handleSignOut() {
    sessionStorage.removeItem('adminAuth');
    setAuthed(false);
    setInput('');
    setError('');
  }

  async function handleReopen(sessionId) {
    try {
      await updateDoc(doc(db, 'sessions', sessionId), { status: 'locked' });
    } catch (err) { console.error(err); }
  }

  // --- LOGIN SCREEN ---
  if (!authed) {
    return (
      <>
        <style>{`@keyframes adminShake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
        <div style={l.page}>
          <h1 style={l.wordmark}>UNFUCK</h1>
          <div style={l.adminLabel}>Admin</div>
          <form onSubmit={handleLogin} style={l.form}>
            <input
              type="password"
              placeholder="Password"
              value={input}
              onChange={e => setInput(e.target.value)}
              autoFocus
              style={{ ...l.input, animation: shaking ? 'adminShake 0.4s ease' : 'none' }}
            />
            {error && <div style={l.error}>{error}</div>}
            <button type="submit" style={l.btn}>Enter</button>
          </form>
        </div>
      </>
    );
  }

  // --- DASHBOARD ---
  const filtered = activeTab === 'all' ? sessions : sessions.filter(s => s.status === activeTab);
  const totalBilled = sessions.reduce((s, x) => s + x.total, 0);
  const openCount = sessions.filter(s => s.status === 'open').length;

  return (
    <div style={d.page}>
      {/* Header */}
      <div style={d.header}>
        <div style={d.headerLeft}>
          <span style={d.wordmark}>UNFUCK</span>
          <span style={d.adminLabel}>Admin</span>
        </div>
        <div style={d.headerRight}>
          <div style={d.tabs}>
            {TABS.map(tab => (
              <button
                key={tab}
                style={{ ...d.tab, ...(activeTab === tab ? d.tabActive : {}) }}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <button style={d.signOut} onClick={handleSignOut}>Sign out</button>
        </div>
      </div>

      {/* Stats */}
      <div style={d.statsGrid}>
        <div style={d.statCard}>
          <div style={d.statValue}>{sessions.length}</div>
          <div style={d.statLabel}>Total sessions</div>
        </div>
        <div style={d.statCard}>
          <div style={d.statValue}>{openCount}</div>
          <div style={d.statLabel}>Open</div>
        </div>
        <div style={d.statCard}>
          <div style={d.statValue}>${totalBilled.toFixed(2)}</div>
          <div style={d.statLabel}>Total billed</div>
        </div>
        <div style={d.statCard}>
          <div style={d.statValue}>
            {sessions.length > 0 ? `$${(totalBilled / sessions.length).toFixed(2)}` : '—'}
          </div>
          <div style={d.statLabel}>Avg per session</div>
        </div>
      </div>

      {/* Table */}
      <div style={d.tableWrap}>
        <div style={d.tableHeader}>
          <div style={{ ...d.th, gridColumn: '1' }}>Session</div>
          <div style={{ ...d.th, gridColumn: '2' }}>People</div>
          <div style={{ ...d.th, gridColumn: '3' }}>Total</div>
          <div style={{ ...d.th, gridColumn: '4' }}>Status</div>
          <div style={{ ...d.th, gridColumn: '5' }}>Actions</div>
        </div>

        {loading ? (
          <div style={d.tableEmpty}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={d.tableEmpty}>No sessions found.</div>
        ) : (
          filtered.map((session, idx) => (
            <div
              key={session.id}
              style={{ ...d.row, borderBottom: idx < filtered.length - 1 ? '0.5px solid var(--border-color)' : 'none' }}
            >
              <div style={d.td}>
                <div style={d.sessionName}>{session.name}</div>
                <div style={d.sessionMeta}>
                  {formatDate(session.date)}{session.venueCount > 0 ? ` · ${session.venueCount} venue${session.venueCount !== 1 ? 's' : ''}` : ''}
                </div>
              </div>
              <div style={d.td}>
                <span style={d.tdText}>{session.memberCount}</span>
              </div>
              <div style={d.td}>
                <span style={d.tdText}>${session.total.toFixed(2)}</span>
              </div>
              <div style={d.td}>
                <StatusBadge status={session.status} />
              </div>
              <div style={{ ...d.td, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  style={d.viewBtn}
                  onClick={() => window.open(`/session/${session.id}/breakdown`, '_blank')}
                >
                  View
                </button>
                {session.status === 'closed' && (
                  <button style={d.reopenBtn} onClick={() => handleReopen(session.id)}>
                    Reopen
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const l = {
  page: { minHeight: '100vh', backgroundColor: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 24px' },
  wordmark: { fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: '48px', letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1, marginBottom: '6px' },
  adminLabel: { fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '40px' },
  form: { display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '320px' },
  input: { padding: '12px 14px', fontSize: '14px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '8px', outline: 'none', width: '100%', boxSizing: 'border-box' },
  error: { fontSize: '12px', color: 'var(--color-danger)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  btn: { padding: '13px', fontSize: '14px', fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer' },
};

const d = {
  page: { minHeight: '100vh', backgroundColor: 'var(--bg-primary)', padding: '24px 32px' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' },
  headerLeft: { display: 'flex', alignItems: 'baseline', gap: '10px' },
  wordmark: { fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: '28px', letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1 },
  adminLabel: { fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '16px' },
  tabs: { display: 'flex', gap: '6px' },
  tab: { padding: '5px 12px', fontSize: '12px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', borderRadius: '20px', border: '0.5px solid var(--border-color)', backgroundColor: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' },
  tabActive: { backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', border: '0.5px solid var(--text-primary)' },
  signOut: { background: 'none', border: 'none', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer', padding: '0' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' },
  statCard: { backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', padding: '12px 16px' },
  statValue: { fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', lineHeight: 1.2 },
  statLabel: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '4px' },
  tableWrap: { border: '0.5px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' },
  tableHeader: { backgroundColor: 'var(--bg-secondary)', padding: '10px 16px', display: 'grid', gridTemplateColumns: '2fr 60px 80px 80px 160px', gap: '16px', alignItems: 'center' },
  th: { fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  row: { display: 'grid', gridTemplateColumns: '2fr 60px 80px 80px 160px', gap: '16px', padding: '14px 16px', alignItems: 'center', backgroundColor: 'var(--bg-primary)' },
  td: { minWidth: 0 },
  tdText: { fontSize: '13px', color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  sessionName: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sessionMeta: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px' },
  tableEmpty: { padding: '32px 16px', fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', textAlign: 'center' },
  viewBtn: { padding: '5px 10px', fontSize: '11px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer' },
  reopenBtn: { padding: '5px 10px', fontSize: '11px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', color: 'var(--color-danger)', border: '0.5px solid var(--color-danger)', borderRadius: '6px', cursor: 'pointer' },
};

const b = {
  badgeOpen: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', backgroundColor: '#FAEEDA', color: '#633806', fontFamily: 'system-ui, -apple-system, sans-serif' },
  badgeLocked: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '0.5px solid var(--border-color)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  badgeClosed: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', backgroundColor: '#EAF3DE', color: '#27500A', fontFamily: 'system-ui, -apple-system, sans-serif' },
};

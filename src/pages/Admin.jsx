import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useToast } from '../context/ToastContext';
import { useIsDesktop } from '../hooks/useIsDesktop';

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

function Checkbox({ checked }) {
  return (
    <div style={{
      width: 20, height: 20, borderRadius: 4, flexShrink: 0,
      border: `1px solid ${checked ? '#A32D2D' : 'var(--border-color)'}`,
      backgroundColor: checked ? '#A32D2D' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {checked && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </div>
  );
}

export default function Admin() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { showToast } = useToast();

  const [authed, setAuthed] = useState(() => sessionStorage.getItem('adminAuth') === 'true');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleteSheet, setDeleteSheet] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { document.title = 'Admin — Damage'; }, []);

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
      await updateDoc(doc(db, 'sessions', sessionId), { status: 'open' });
    } catch (err) { console.error(err); }
  }

  function toggleSelect(sessionId) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(sessionId) ? next.delete(sessionId) : next.add(sessionId);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function handleDeleteConfirmed() {
    setDeleting(true);
    try {
      const idsToDelete = [...selectedIds];
      for (const sessionId of idsToDelete) {
        const venuesSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues'));
        for (const vDoc of venuesSnap.docs) {
          const itemsSnap = await getDocs(
            collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items')
          );
          for (const iDoc of itemsSnap.docs) {
            await deleteDoc(doc(db, 'sessions', sessionId, 'venues', vDoc.id, 'items', iDoc.id));
          }
          await deleteDoc(doc(db, 'sessions', sessionId, 'venues', vDoc.id));
        }
        const membersSnap = await getDocs(collection(db, 'sessions', sessionId, 'members'));
        for (const mDoc of membersSnap.docs) {
          await deleteDoc(doc(db, 'sessions', sessionId, 'members', mDoc.id));
        }
        const claimsSnap = await getDocs(collection(db, 'sessions', sessionId, 'claims'));
        for (const cDoc of claimsSnap.docs) {
          await deleteDoc(doc(db, 'sessions', sessionId, 'claims', cDoc.id));
        }
        const breakdownSnap = await getDocs(collection(db, 'sessions', sessionId, 'breakdown'));
        for (const bDoc of breakdownSnap.docs) {
          await deleteDoc(doc(db, 'sessions', sessionId, 'breakdown', bDoc.id));
        }
        await deleteDoc(doc(db, 'sessions', sessionId));
      }
      const count = idsToDelete.length;
      exitSelectMode();
      setDeleteSheet(0);
      showToast(`${count} session${count !== 1 ? 's' : ''} deleted`, 'success');
    } catch (err) {
      console.error('Delete error:', err);
    } finally {
      setDeleting(false);
    }
  }

  // --- LOGIN SCREEN ---
  if (!authed) {
    return (
      <>
        <style>{`@keyframes adminShake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
        <div style={l.page}>
          <h1 style={l.wordmark}>DAMAGE</h1>
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
  const gridCols = selectMode ? '28px 2fr 60px 80px 80px 160px' : '2fr 60px 80px 80px 160px';

  const tabButtons = TABS.map(tab => (
    <button
      key={tab}
      style={{ ...d.tab, ...(activeTab === tab ? d.tabActive : {}) }}
      onClick={() => setActiveTab(tab)}
    >
      {tab.charAt(0).toUpperCase() + tab.slice(1)}
    </button>
  ));

  return (
    <div style={{ ...d.page, paddingBottom: selectMode ? '80px' : (isDesktop ? '24px' : '16px') }}>

      {/* Header */}
      {isDesktop ? (
        <div style={d.header}>
          <div style={d.headerLeft}>
            <span style={d.wordmark}>DAMAGE</span>
            <span style={d.adminLabel}>Admin</span>
          </div>
          <div style={d.headerRight}>
            <div style={d.tabs}>{tabButtons}</div>
            <button style={d.selectBtn} onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}>
              {selectMode ? 'Cancel' : 'Select'}
            </button>
            <button style={d.signOut} onClick={handleSignOut}>Sign out</button>
          </div>
        </div>
      ) : (
        <div style={d.headerMobile}>
          <div style={d.headerTopRow}>
            <div style={d.headerLeft}>
              <span style={d.wordmark}>DAMAGE</span>
              <span style={d.adminLabel}>Admin</span>
            </div>
            <div style={d.headerActions}>
              <button style={d.selectBtn} onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}>
                {selectMode ? 'Cancel' : 'Select'}
              </button>
              <button style={d.signOut} onClick={handleSignOut}>Sign out</button>
            </div>
          </div>
          <div style={d.tabsMobile}>{tabButtons}</div>
        </div>
      )}

      {/* Stats */}
      <div style={{ ...d.statsGrid, gridTemplateColumns: isDesktop ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)' }}>
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

      {/* Session list */}
      <div style={d.tableWrap}>
        {/* Desktop table header — hidden on mobile */}
        {isDesktop && (
          <div style={{ ...d.tableHeader, gridTemplateColumns: gridCols }}>
            {selectMode && <div />}
            <div style={d.th}>Session</div>
            <div style={d.th}>People</div>
            <div style={d.th}>Total</div>
            <div style={d.th}>Status</div>
            <div style={d.th}>Actions</div>
          </div>
        )}

        {loading ? (
          <div style={d.tableEmpty}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={d.tableEmpty}>No sessions found.</div>
        ) : filtered.map((session, idx) => {
          const isSelected = selectedIds.has(session.id);
          const isLast = idx === filtered.length - 1;

          if (!isDesktop) {
            return (
              <div
                key={session.id}
                style={{
                  ...d.mobileCard,
                  borderBottom: isLast ? 'none' : '0.5px solid var(--border-color)',
                  backgroundColor: isSelected ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                  cursor: selectMode ? 'pointer' : 'default',
                }}
                onClick={() => selectMode && toggleSelect(session.id)}
              >
                <div style={d.mobileCardTop}>
                  {selectMode && <Checkbox checked={isSelected} />}
                  <div style={d.mobileCardInfo}>
                    <div style={d.sessionName}>{session.name}</div>
                    <div style={d.sessionMeta}>
                      {formatDate(session.date)}
                      {session.venueCount > 0 ? ` · ${session.venueCount} venue${session.venueCount !== 1 ? 's' : ''}` : ''}
                      {session.memberCount > 0 ? ` · ${session.memberCount} ${session.memberCount === 1 ? 'person' : 'people'}` : ''}
                    </div>
                  </div>
                </div>
                <div style={d.mobileCardBottom}>
                  <span style={d.tdText}>${session.total.toFixed(2)}</span>
                  <StatusBadge status={session.status} />
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                    {!selectMode && (
                      <>
                        <button
                          style={d.viewBtn}
                          onClick={e => { e.stopPropagation(); window.open(`/session/${session.id}/breakdown`, '_blank'); }}
                        >
                          View
                        </button>
                        {session.status === 'closed' && (
                          <button
                            style={d.reopenBtn}
                            onClick={e => { e.stopPropagation(); handleReopen(session.id); }}
                          >
                            Reopen
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          // Desktop row
          return (
            <div
              key={session.id}
              style={{
                ...d.row,
                gridTemplateColumns: gridCols,
                borderBottom: isLast ? 'none' : '0.5px solid var(--border-color)',
                cursor: selectMode ? 'pointer' : 'default',
                backgroundColor: isSelected ? 'var(--bg-secondary)' : 'var(--bg-primary)',
              }}
              onClick={() => selectMode && toggleSelect(session.id)}
            >
              {selectMode && <div style={{ display: 'flex', alignItems: 'center' }}><Checkbox checked={isSelected} /></div>}
              <div style={d.td}>
                <div style={d.sessionName}>{session.name}</div>
                <div style={d.sessionMeta}>
                  {formatDate(session.date)}{session.venueCount > 0 ? ` · ${session.venueCount} venue${session.venueCount !== 1 ? 's' : ''}` : ''}
                </div>
              </div>
              <div style={d.td}><span style={d.tdText}>{session.memberCount}</span></div>
              <div style={d.td}><span style={d.tdText}>${session.total.toFixed(2)}</span></div>
              <div style={d.td}><StatusBadge status={session.status} /></div>
              <div style={{ ...d.td, display: 'flex', alignItems: 'center', gap: '8px' }}>
                {!selectMode && (
                  <>
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
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Fixed selection bar */}
      {selectMode && (
        <div style={d.selectionBar}>
          <span style={d.selectionCount}>
            {selectedIds.size} session{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <button
            style={d.selectAllBtn}
            onClick={() => setSelectedIds(new Set(filtered.map(s => s.id)))}
          >
            Select all
          </button>
          <button
            style={{ ...d.deleteSelectedBtn, opacity: selectedIds.size === 0 ? 0.4 : 1 }}
            disabled={selectedIds.size === 0}
            onClick={() => selectedIds.size > 0 && setDeleteSheet(1)}
          >
            Delete selected
          </button>
        </div>
      )}

      {/* Confirmation sheet 1 */}
      {deleteSheet === 1 && (
        <>
          <div style={d.backdrop} onClick={() => setDeleteSheet(0)} />
          <div style={d.sheet}>
            <div style={d.sheetHandle} />
            <div style={d.sheetTitle}>
              Delete {selectedIds.size} session{selectedIds.size !== 1 ? 's' : ''}?
            </div>
            <div style={d.sheetBody}>
              This will permanently delete the selected sessions and all their data including items, claims, and member records.
            </div>
            <div style={{ marginBottom: '20px' }}>
              {[...selectedIds].slice(0, 5).map(id => {
                const sess = sessions.find(s => s.id === id);
                return <div key={id} style={d.sheetSessionName}>{sess?.name ?? id}</div>;
              })}
              {selectedIds.size > 5 && (
                <div style={d.sheetMore}>+ {selectedIds.size - 5} more</div>
              )}
            </div>
            <div style={d.sheetBtns}>
              <button style={d.sheetCancelBtn} onClick={() => setDeleteSheet(0)}>Cancel</button>
              <button style={d.sheetDeleteBtn} onClick={() => setDeleteSheet(2)}>Yes, delete</button>
            </div>
          </div>
        </>
      )}

      {/* Confirmation sheet 2 */}
      {deleteSheet === 2 && (
        <>
          <div style={d.backdrop} onClick={() => setDeleteSheet(1)} />
          <div style={d.sheet}>
            <div style={d.sheetHandle} />
            <div style={{ ...d.sheetTitle, color: '#A32D2D' }}>Are you really sure?</div>
            <div style={d.sheetBody}>
              This cannot be undone. All session data will be permanently deleted.
            </div>
            <div style={d.sheetBtns}>
              <button style={d.sheetCancelBtn} onClick={() => setDeleteSheet(1)}>Cancel</button>
              <button
                style={{ ...d.sheetPermanentDeleteBtn, opacity: deleting ? 0.6 : 1 }}
                onClick={handleDeleteConfirmed}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Permanently delete'}
              </button>
            </div>
          </div>
        </>
      )}
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
  page: { minHeight: '100vh', backgroundColor: 'var(--bg-primary)', padding: '24px 16px' },

  // Desktop header
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', gap: '16px' },
  headerLeft: { display: 'flex', alignItems: 'baseline', gap: '10px', flexShrink: 0 },
  wordmark: { fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: '28px', letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1 },
  adminLabel: { fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },

  // Mobile header
  headerMobile: { display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' },
  headerTopRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { display: 'flex', alignItems: 'center', gap: '12px' },

  // Tabs
  tabs: { display: 'flex', gap: '6px' },
  tabsMobile: { display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px', WebkitOverflowScrolling: 'touch' },
  tab: { padding: '5px 12px', fontSize: '12px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', borderRadius: '20px', border: '0.5px solid var(--border-color)', backgroundColor: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 },
  tabActive: { backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', border: '0.5px solid var(--text-primary)' },

  selectBtn: { background: 'none', border: '0.5px solid var(--border-color)', borderRadius: '6px', padding: '5px 10px', fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer', whiteSpace: 'nowrap' },
  signOut: { background: 'none', border: 'none', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer', padding: '0', whiteSpace: 'nowrap' },

  // Stats
  statsGrid: { display: 'grid', gap: '12px', marginBottom: '20px' },
  statCard: { backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', padding: '12px 16px' },
  statValue: { fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', lineHeight: 1.2 },
  statLabel: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '4px' },

  // Table / list
  tableWrap: { border: '0.5px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' },
  tableHeader: { backgroundColor: 'var(--bg-secondary)', padding: '10px 16px', display: 'grid', gap: '16px', alignItems: 'center' },
  th: { fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  row: { display: 'grid', gap: '16px', padding: '14px 16px', alignItems: 'center' },
  td: { minWidth: 0 },
  tdText: { fontSize: '13px', color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  sessionName: { fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sessionMeta: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px' },
  tableEmpty: { padding: '32px 16px', fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', textAlign: 'center' },

  // Mobile card
  mobileCard: { padding: '12px 14px' },
  mobileCardTop: { display: 'flex', alignItems: 'flex-start', gap: '10px' },
  mobileCardInfo: { flex: 1, minWidth: 0 },
  mobileCardBottom: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' },

  viewBtn: { padding: '5px 10px', fontSize: '11px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer' },
  reopenBtn: { padding: '5px 10px', fontSize: '11px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', color: 'var(--color-danger)', border: '0.5px solid var(--color-danger)', borderRadius: '6px', cursor: 'pointer' },

  // Selection bar
  selectionBar: {
    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
    backgroundColor: 'var(--bg-primary)', borderTop: '0.5px solid var(--border-color)',
    padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px',
  },
  selectionCount: { fontSize: '13px', color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', flex: 1, whiteSpace: 'nowrap' },
  selectAllBtn: { background: 'none', border: 'none', fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer', padding: '0', textDecoration: 'underline', whiteSpace: 'nowrap' },
  deleteSelectedBtn: { padding: '10px 16px', fontSize: '13px', fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: '#A32D2D', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', whiteSpace: 'nowrap' },

  // Sheets
  backdrop: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100 },
  sheet: { position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101, backgroundColor: 'var(--bg-primary)', borderRadius: '20px 20px 0 0', padding: '12px 20px 40px', maxHeight: '80vh', overflowY: 'auto' },
  sheetHandle: { width: '36px', height: '4px', borderRadius: '2px', backgroundColor: 'var(--border-color)', margin: '0 auto 16px' },
  sheetTitle: { fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '8px' },
  sheetBody: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '16px', lineHeight: 1.5 },
  sheetSessionName: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '6px 0', borderBottom: '0.5px solid var(--border-color)' },
  sheetMore: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '6px 0' },
  sheetBtns: { display: 'flex', gap: '10px', marginTop: '4px' },
  sheetCancelBtn: { flex: 1, padding: '12px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer' },
  sheetDeleteBtn: { flex: 1, padding: '12px', fontSize: '14px', fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: '#A32D2D', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' },
  sheetPermanentDeleteBtn: { flex: 1, padding: '12px', fontSize: '14px', fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: '#A32D2D', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' },
};

const b = {
  badgeOpen: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', backgroundColor: '#FAEEDA', color: '#633806', fontFamily: 'system-ui, -apple-system, sans-serif' },
  badgeLocked: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '0.5px solid var(--border-color)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  badgeClosed: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', backgroundColor: '#EAF3DE', color: '#27500A', fontFamily: 'system-ui, -apple-system, sans-serif' },
};

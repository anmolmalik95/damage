import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import PageContainer from '../components/PageContainer';
import SkeletonBlock from '../components/SkeletonBlock';
import { clusterMembers, fetchSessionData } from '../utils/reconcileUtils';

export default function MapPeople() {
  const navigate = useNavigate();
  const location = useLocation();
  const sessionIds = location.state?.sessionIds ?? [];

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [initialGroups, setInitialGroups] = useState([]);

  // Card-by-card state
  const [currentIdx, setCurrentIdx] = useState(0);
  // cardSelections: { [groupIdx]: { [sessionId]: memberId } }
  const [cardSelections, setCardSelections] = useState({});
  // canonicalNames: { [groupIdx]: string }
  const [canonicalNames, setCanonicalNames] = useState({});
  // confirmedGroups: array of group arrays we're keeping
  const [confirmedGroups, setConfirmedGroups] = useState([]);
  const confirmedGroupsRef = useRef([]);

  useEffect(() => { document.title = 'Reconcile — Damage'; }, []);

  useEffect(() => {
    if (!sessionIds.length) { navigate('/reconcile', { replace: true }); return; }

    async function load() {
      setError('');
      try {
      const sessionData = (await Promise.all(sessionIds.map(fetchSessionData))).filter(Boolean);
      setSessions(sessionData);

      const allMembers = sessionData.flatMap(s =>
        s.members.map(m => ({ sessionId: s.id, memberId: m.id, name: m.name }))
      );

      const clusters = clusterMembers(allMembers);
      setInitialGroups(clusters);

      const initSel = {};
      const initNames = {};
      clusters.forEach((group, idx) => {
        initSel[idx] = {};
        group.forEach(m => {
          if (!initSel[idx][m.sessionId]) initSel[idx][m.sessionId] = m.memberId;
        });
        const first = group[0];
        const session = sessionData.find(s => s.id === first.sessionId);
        initNames[idx] = session?.members.find(m => m.id === first.memberId)?.name ?? '';
      });
      setCardSelections(initSel);
      setCanonicalNames(initNames);

      // Restore progress if coming back from settlement
      const savedRaw = sessionStorage.getItem('reconcile_progress');
      if (savedRaw) {
        try {
          const { confirmedGroups: saved, nextIdx } = JSON.parse(savedRaw);
          if (Array.isArray(saved)) {
            confirmedGroupsRef.current = saved;
            setConfirmedGroups(saved);
            setCurrentIdx(Math.min(nextIdx ?? saved.length, clusters.length - 1));
          }
        } catch {}
      }

      setLoading(false);
      } catch (err) {
        console.error(err);
        setError('Couldn\'t load sessions. Check your connection and try again.');
        setLoading(false);
      }
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleConfirm() {
    const group = initialGroups[currentIdx];
    const sel = cardSelections[currentIdx] ?? {};
    const seen = new Set();
    const resolved = group
      .map(m => ({ sessionId: m.sessionId, memberId: sel[m.sessionId] ?? m.memberId }))
      .filter(({ sessionId, memberId }) => {
        if (memberId === 'none' || seen.has(sessionId)) return false;
        seen.add(sessionId);
        return true;
      });

    if (resolved.length >= 2) {
      const newGroups = [...confirmedGroupsRef.current, { group: resolved, name: canonicalNames[currentIdx] ?? '' }];
      confirmedGroupsRef.current = newGroups;
      setConfirmedGroups(newGroups);
      sessionStorage.setItem('reconcile_progress', JSON.stringify({ confirmedGroups: newGroups, nextIdx: currentIdx + 1 }));
    } else {
      sessionStorage.setItem('reconcile_progress', JSON.stringify({ confirmedGroups: confirmedGroupsRef.current, nextIdx: currentIdx + 1 }));
    }
    advance();
  }

  function handleSkip() {
    sessionStorage.setItem('reconcile_progress', JSON.stringify({ confirmedGroups: confirmedGroupsRef.current, nextIdx: currentIdx + 1 }));
    advance();
  }

  function advance() {
    if (currentIdx >= initialGroups.length - 1) {
      sessionStorage.removeItem('reconcile_progress');
      const finalGroups = confirmedGroupsRef.current.map(cg => cg.group);
      const finalNames = confirmedGroupsRef.current.map(cg => cg.name);
      navigate('/reconcile/settlement', { state: { sessions, canonicalGroups: finalGroups, canonicalNames: finalNames } });
    } else {
      setCurrentIdx(prev => prev + 1);
    }
  }

  if (loading) return (
    <PageContainer>
      <div style={s.header}>
        <button style={s.back} onClick={() => navigate('/reconcile')}>←</button>
        <div style={s.headerText}><div style={s.title}>Match people</div></div>
      </div>
      <SkeletonBlock height="120px" borderRadius="12px" style={{ marginBottom: '16px' }} />
      <SkeletonBlock height="44px" borderRadius="8px" style={{ marginBottom: '8px' }} />
      <SkeletonBlock height="44px" borderRadius="8px" />
    </PageContainer>
  );

  if (error) return (
    <PageContainer>
      <div style={s.header}>
        <button style={s.back} onClick={() => { sessionStorage.removeItem('reconcile_progress'); navigate('/reconcile'); }}>←</button>
        <div style={s.headerText}><div style={s.title}>Match people</div></div>
      </div>
      <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', textAlign: 'center', padding: '40px 0 20px' }}>{error}</div>
      <button style={s.confirmBtn} onClick={() => { setLoading(true); setError(''); }}>Retry</button>
    </PageContainer>
  );

  // If no groups, go straight to settlement
  if (initialGroups.length === 0) {
    navigate('/reconcile/settlement', { state: { sessions, canonicalGroups: [], canonicalNames: [] } });
    return null;
  }

  const sessionMap = Object.fromEntries(sessions.map(s => [s.id, s]));
  const group = initialGroups[currentIdx];
  const sel = cardSelections[currentIdx] ?? {};
  const sessionIdsInGroup = [...new Set(group.map(m => m.sessionId))];
  const progress = currentIdx / initialGroups.length;

  return (
    <PageContainer>
      <div style={s.header}>
        <button style={s.back} onClick={() => { sessionStorage.removeItem('reconcile_progress'); navigate('/reconcile'); }}>←</button>
        <div style={s.headerText}>
          <div style={s.title}>Match people</div>
          <div style={s.subtitle}>Confirm who's the same person across sessions</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={s.progressOuter}>
        <div style={{ ...s.progressFill, width: `${Math.min(progress * 100, 100)}%` }} />
      </div>
      <div style={s.progressLabel}>{currentIdx + 1} of {initialGroups.length}</div>

      {/* Card */}
      <div style={s.card}>
        <div style={s.cardTitle}>Possible match</div>
        <div style={s.cardSubtitle}>Are these the same person across sessions?</div>

        <div style={s.sessionRows}>
          {sessionIdsInGroup.map(sid => {
            const sessionMembers = sessionMap[sid]?.members ?? [];
            const defaultMemberId = group.find(m => m.sessionId === sid)?.memberId ?? 'none';
            const curVal = sel[sid] !== undefined ? sel[sid] : defaultMemberId;
            return (
              <div key={sid} style={s.sessionRow}>
                <div style={s.sessionName}>{sessionMap[sid]?.name ?? sid}</div>
                <select
                  style={s.dropdown}
                  value={curVal}
                  onChange={e => setCardSelections(p => ({ ...p, [currentIdx]: { ...(p[currentIdx] ?? {}), [sid]: e.target.value } }))}
                >
                  <option value="none">None — different person</option>
                  {sessionMembers.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        <div style={s.canonicalRow}>
          <label style={s.canonicalLabel}>Canonical name</label>
          <input
            style={s.canonicalInput}
            type="text"
            value={canonicalNames[currentIdx] ?? ''}
            onChange={e => setCanonicalNames(p => ({ ...p, [currentIdx]: e.target.value }))}
            placeholder="Name to use in settlement"
          />
        </div>
      </div>

      <div style={s.actions}>
        <button style={s.skipBtn} onClick={handleSkip}>Skip — different people</button>
        <button style={s.confirmBtn} onClick={handleConfirm}>Confirm match →</button>
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
  progressOuter: { height: '4px', backgroundColor: 'var(--bg-secondary)', borderRadius: '2px', overflow: 'hidden', marginBottom: '4px' },
  progressFill: { height: '100%', backgroundColor: 'var(--text-primary)', borderRadius: '2px', transition: 'width 0.3s ease' },
  progressLabel: { fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '16px' },
  card: { border: '0.5px solid var(--border-color)', borderRadius: '12px', padding: '16px', backgroundColor: 'var(--bg-primary)', marginBottom: '16px' },
  cardTitle: { fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '4px' },
  cardSubtitle: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '14px' },
  sessionRows: { display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' },
  sessionRow: { display: 'flex', flexDirection: 'column', gap: '4px' },
  sessionName: { fontSize: '10px', fontWeight: 500, color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', textTransform: 'uppercase', letterSpacing: '0.05em' },
  dropdown: { border: '0.5px solid var(--border-color)', borderRadius: '6px', padding: '8px 10px', fontSize: '13px', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', outline: 'none', cursor: 'pointer', colorScheme: 'light dark', width: '100%' },
  canonicalRow: { display: 'flex', flexDirection: 'column', gap: '4px', borderTop: '0.5px solid var(--border-color)', paddingTop: '12px' },
  canonicalLabel: { fontSize: '10px', fontWeight: 500, color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', textTransform: 'uppercase', letterSpacing: '0.05em' },
  canonicalInput: { border: '0.5px solid var(--border-color)', borderRadius: '6px', padding: '8px 10px', fontSize: '13px', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', outline: 'none', width: '100%', boxSizing: 'border-box', colorScheme: 'light dark' },
  actions: { display: 'flex', flexDirection: 'column', gap: '8px' },
  skipBtn: { width: '100%', padding: '12px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', color: 'var(--text-secondary)', border: '0.5px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer' },
  confirmBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer' },
};

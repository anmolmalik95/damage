import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import PageContainer from '../components/PageContainer';
import { clusterMembers, fetchSessionData } from '../utils/reconcileUtils';

export default function MapPeople() {
  const navigate = useNavigate();
  const location = useLocation();
  const sessionIds = location.state?.sessionIds ?? [];

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  // initialGroups: [{ sessionId, memberId, name }[]] — from fuzzy clustering
  const [initialGroups, setInitialGroups] = useState([]);
  // selections: { [groupIdx]: { [sessionId]: memberId | 'none' } }
  const [selections, setSelections] = useState({});

  useEffect(() => { document.title = 'Reconcile — Unfuck'; }, []);

  useEffect(() => {
    if (!sessionIds.length) { navigate('/reconcile', { replace: true }); return; }

    async function load() {
      const sessionData = (await Promise.all(sessionIds.map(fetchSessionData))).filter(Boolean);
      setSessions(sessionData);

      const allMembers = sessionData.flatMap(s =>
        s.members.map(m => ({ sessionId: s.id, memberId: m.id, name: m.name }))
      );

      const clusters = clusterMembers(allMembers);
      setInitialGroups(clusters);

      const initSel = {};
      clusters.forEach((group, idx) => {
        initSel[idx] = {};
        group.forEach(m => {
          if (!initSel[idx][m.sessionId]) initSel[idx][m.sessionId] = m.memberId;
        });
      });
      setSelections(initSel);
      setLoading(false);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function setSelection(groupIdx, sessionId, value) {
    setSelections(p => ({ ...p, [groupIdx]: { ...(p[groupIdx] ?? {}), [sessionId]: value } }));
  }

  function handleConfirm() {
    const canonicalGroups = initialGroups.map((group, idx) => {
      const sel = selections[idx] ?? {};
      const seen = new Set();
      return group
        .map(m => ({ sessionId: m.sessionId, memberId: sel[m.sessionId] ?? m.memberId }))
        .filter(({ sessionId, memberId }) => {
          if (memberId === 'none' || seen.has(sessionId)) return false;
          seen.add(sessionId);
          return true;
        });
    }).filter(g => g.length >= 2);

    navigate('/reconcile/settlement', { state: { sessions, canonicalGroups } });
  }

  if (loading) return null;

  const sessionMap = Object.fromEntries(sessions.map(s => [s.id, s]));

  // Compute matched keys dynamically from current selections
  const matchedKeys = new Set();
  initialGroups.forEach((group, idx) => {
    const sel = selections[idx] ?? {};
    group.forEach(m => {
      const val = sel[m.sessionId] !== undefined ? sel[m.sessionId] : m.memberId;
      if (val !== 'none') matchedKeys.add(`${m.sessionId}:${val}`);
    });
  });

  // Unmatched = all members not currently matched in any group
  const unmatched = sessions.flatMap(s =>
    s.members
      .filter(m => !matchedKeys.has(`${s.id}:${m.id}`))
      .map(m => ({ name: m.name, sessionName: s.name }))
  );

  return (
    <PageContainer>
      <div style={s.header}>
        <button style={s.back} onClick={() => navigate('/reconcile')}>←</button>
        <div style={s.headerText}>
          <div style={s.title}>Match people</div>
          <div style={s.subtitle}>Confirm who's the same person across sessions</div>
        </div>
      </div>

      <div style={s.helper}>
        Possible matches are flagged below. Use the dropdowns to confirm or set to None if they are different people.
      </div>

      {initialGroups.length === 0 && (
        <div style={s.noMatches}>
          No automatic matches found — all people will be treated as distinct.
        </div>
      )}

      {initialGroups.map((group, idx) => {
        const sessionIdsInGroup = [...new Set(group.map(m => m.sessionId))];
        const sel = selections[idx] ?? {};

        return (
          <div key={idx} style={s.card}>
            <div style={s.colHeaders}>
              {sessionIdsInGroup.map(sid => (
                <div key={sid} style={s.colHeader}>
                  {sessionMap[sid]?.name ?? sid}
                </div>
              ))}
            </div>
            <div style={s.dropdownRow}>
              {sessionIdsInGroup.map(sid => {
                const sessionMembers = sessionMap[sid]?.members ?? [];
                const defaultMemberId = group.find(m => m.sessionId === sid)?.memberId ?? 'none';
                const curVal = sel[sid] !== undefined ? sel[sid] : defaultMemberId;
                return (
                  <select
                    key={sid}
                    style={s.dropdown}
                    value={curVal}
                    onChange={e => setSelection(idx, sid, e.target.value)}
                  >
                    <option value="none">None</option>
                    {sessionMembers.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                );
              })}
            </div>
          </div>
        );
      })}

      {unmatched.length > 0 && (
        <div style={s.unmatchedSection}>
          <span style={s.unmatchedLabel}>No matches found for: </span>
          {unmatched.map((m, i) => (
            <span key={i} style={s.unmatchedName}>
              {m.name} ({m.sessionName}){i < unmatched.length - 1 ? ', ' : ''}
            </span>
          ))}
        </div>
      )}

      <div style={{ marginTop: '16px', paddingBottom: '16px' }}>
        <button style={s.confirmBtn} onClick={handleConfirm}>
          Confirm matches →
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
  helper: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '16px' },
  noMatches: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '12px' },
  card: { border: '0.5px solid var(--border-color)', borderRadius: '12px', padding: '14px', marginBottom: '10px', backgroundColor: 'var(--bg-primary)' },
  colHeaders: { display: 'flex', gap: '8px', marginBottom: '8px' },
  colHeader: { flex: 1, fontSize: '10px', fontWeight: 500, color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', textTransform: 'uppercase', letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dropdownRow: { display: 'flex', gap: '8px' },
  dropdown: { flex: 1, border: '0.5px solid var(--border-color)', borderRadius: '6px', padding: '8px 10px', fontSize: '13px', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', outline: 'none', cursor: 'pointer', colorScheme: 'light dark', minWidth: 0, width: '100%' },
  unmatchedSection: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '4px', marginBottom: '4px', lineHeight: 1.6 },
  unmatchedLabel: { fontWeight: 500 },
  unmatchedName: {},
  confirmBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer' },
};

import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import PageContainer from '../components/PageContainer';
import SkeletonBlock from '../components/SkeletonBlock';
import { clusterMembers, fetchSessionData, buildCanonical, simplifyDebts } from '../utils/reconcileUtils';
import { useToast } from '../context/ToastContext';
import { BRAND_NAME } from '../brand';

function autoCanonicalGroups(sessions) {
  const allMembers = sessions.flatMap(s =>
    s.members.map(m => ({ sessionId: s.id, memberId: m.id, name: m.name }))
  );
  const clusters = clusterMembers(allMembers);
  return clusters.map(group => {
    const seen = new Set();
    return group.filter(m => {
      if (seen.has(m.sessionId)) return false;
      seen.add(m.sessionId);
      return true;
    }).map(m => ({ sessionId: m.sessionId, memberId: m.memberId }));
  }).filter(g => g.length >= 2);
}

function buildSubtitle(sessions) {
  if (sessions.length <= 2) return sessions.map(s => s.name).join(' + ');
  return `${sessions[0].name} + ${sessions[1].name} + ${sessions.length - 2} more`;
}

export default function ReconcileSettlement() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();

  const [sessions, setSessions] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { document.title = `Reconcile — ${BRAND_NAME}`; }, []);

  useEffect(() => {
    async function loadFromState(stateSessions, stateGroups, stateNames) {
      try {
        setSessions(stateSessions);
        const { memberToCanonical, canonicals } = buildCanonical(stateSessions, stateGroups, stateNames ?? []);
        setTransactions(simplifyDebts(stateSessions, memberToCanonical, canonicals));
        setLoading(false);
      } catch (err) {
        console.error(err);
        setError('Settlement couldn\'t load. Check your connection and try again.');
        setLoading(false);
      }
    }

    async function loadFromUrl(sessionIds) {
      try {
        const sessionData = (await Promise.all(sessionIds.map(fetchSessionData))).filter(Boolean);
        setSessions(sessionData);
        const groups = autoCanonicalGroups(sessionData);
        const { memberToCanonical, canonicals } = buildCanonical(sessionData, groups);
        setTransactions(simplifyDebts(sessionData, memberToCanonical, canonicals));
        setLoading(false);
      } catch (err) {
        console.error(err);
        setError('Settlement couldn\'t load. Check your connection and try again.');
        setLoading(false);
      }
    }

    const stateData = location.state;
    if (stateData?.sessions?.length) {
      loadFromState(stateData.sessions, stateData.canonicalGroups ?? [], stateData.canonicalNames);
    } else {
      const ids = searchParams.get('sessions')?.split(',').filter(Boolean) ?? [];
      if (ids.length >= 2) {
        loadFromUrl(ids);
      } else {
        navigate('/reconcile', { replace: true });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleBack() {
    if (location.state?.canonicalGroups) {
      sessionStorage.setItem('reconcile_progress', JSON.stringify({
        confirmedGroups: location.state.canonicalGroups.map((group, i) => ({
          group,
          name: location.state.canonicalNames?.[i] ?? '',
        })),
        nextIdx: location.state.canonicalGroups.length,
      }));
    }
    sessionStorage.setItem('reconcile_session_ids', JSON.stringify(sessions.map(s => s.id)));
    navigate('/reconcile/map-people', { state: { sessionIds: sessions.map(s => s.id) } });
  }

  async function handleCopyLink() {
    const ids = sessions.map(s => s.id).join(',');
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/reconcile/settlement?sessions=${ids}`);
    } catch {
      const el = document.createElement('textarea');
      el.value = `${window.location.origin}/reconcile/settlement?sessions=${ids}`;
      document.body.appendChild(el); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    }
    showToast('Copied!', 'success');
  }

  if (loading) return (
    <PageContainer>
      <div style={s.header}>
        <button style={s.back} onClick={handleBack}>←</button>
        <div style={s.headerText}><div style={s.title}>Settlement</div></div>
      </div>
      <div style={{ border: '0.5px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden', marginBottom: '12px' }}>
        {[...Array(3)].map((_, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: i < 2 ? '0.5px solid var(--border-color)' : 'none' }}>
            <SkeletonBlock width="55%" height="14px" />
            <SkeletonBlock width="60px" height="14px" />
          </div>
        ))}
      </div>
    </PageContainer>
  );

  if (error) return (
    <PageContainer>
      <div style={s.header}>
        <button style={s.back} onClick={handleBack}>←</button>
        <div style={s.headerText}><div style={s.title}>Settlement</div></div>
      </div>
      <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', textAlign: 'center', padding: '40px 0 20px' }}>{error}</div>
      <button style={s.shareBtn} onClick={() => { setLoading(true); setError(''); }}>Retry</button>
    </PageContainer>
  );

  const subtitle = buildSubtitle(sessions);

  return (
    <PageContainer>
      <div style={s.header}>
        <button style={s.back} onClick={handleBack}>←</button>
        <div style={s.headerText}>
          <div style={s.title}>Settlement</div>
          <div style={s.subtitle}>{subtitle}</div>
        </div>
      </div>

      <div style={s.helper}>
        We've minimised the number of payments needed.
      </div>

      {transactions.length > 0 && (
        <div style={s.settledSummary}>
          Settled in {transactions.length} payment{transactions.length !== 1 ? 's' : ''}
        </div>
      )}

      {transactions.length === 0 ? (
        <div style={s.allSettled}>
          All settled! No payments needed.
        </div>
      ) : (
        <div style={s.txCard}>
          {transactions.map((tx, i) => (
            <div
              key={i}
              style={{
                ...s.txRow,
                borderBottom: i < transactions.length - 1 ? '0.5px solid var(--border-color)' : 'none',
              }}
            >
              <div style={s.txLabel}>
                <span style={s.txName}>{tx.from}</span>
                <span style={s.txVerb}> pays </span>
                <span style={s.txName}>{tx.to}</span>
              </div>
              <div style={s.txAmt}>${tx.amount.toFixed(2)}</div>
            </div>
          ))}
        </div>
      )}

      <div style={s.statusCard}>
        <div style={s.statusTitle}>Session statuses</div>
        {sessions.map(session => (
          <div key={session.id} style={s.statusRow}>
            <span style={s.statusName}>{session.name}</span>
            <span style={session.status === 'closed' ? s.closedTag : s.lockedTag}>
              {session.status === 'closed' ? 'Closed' : 'Locked'}
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '16px', paddingBottom: '16px' }}>
        <button style={s.shareBtn} onClick={handleCopyLink}>
          Copy settlement link
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
  subtitle: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  helper: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '8px' },
  settledSummary: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '12px' },
  allSettled: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', textAlign: 'center', padding: '32px 0', border: '0.5px solid var(--border-color)', borderRadius: '12px', marginBottom: '12px' },
  txCard: { border: '0.5px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden', marginBottom: '12px' },
  txRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', backgroundColor: 'var(--bg-primary)' },
  txLabel: { fontSize: '14px', fontFamily: 'system-ui, -apple-system, sans-serif', color: 'var(--text-primary)', flex: 1, minWidth: 0 },
  txName: { fontWeight: 500 },
  txVerb: { color: 'var(--text-secondary)', fontWeight: 400 },
  txAmt: { fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', flexShrink: 0, marginLeft: '12px' },
  statusCard: { backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', padding: '12px 14px' },
  statusTitle: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '8px', fontWeight: 500 },
  statusRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' },
  statusName: { fontSize: '12px', color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  lockedTag: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '0.5px solid var(--border-color)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  closedTag: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  shareBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer' },
};

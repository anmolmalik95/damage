import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import SkeletonBlock from '../components/SkeletonBlock';
import { doc, getDoc, getDocs, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

import PageContainer from '../components/PageContainer';
import { useNavigation } from '../context/NavigationContext';
import { BRAND_NAME } from '../brand';

const AVATAR_COLORS = ['#5b9bd5', '#3dba8a', '#e8a03a', '#e07060', '#9070d0', '#4db8b8'];

export default function WhoAreYou() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { navigateForward, navigateBack } = useNavigation();
  const from = location.state?.from;

  const [session, setSession] = useState(null);
  const [members, setMembers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [memberCount, setMemberCount] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);

  useEffect(() => {
    async function load() {
      const snap = await getDoc(doc(db, 'sessions', sessionId));
      if (!snap.exists()) { setLoading(false); return; }
      const data = snap.data();
      setSession(data);

      const existingId = localStorage.getItem(`member_${sessionId}`);
      // If the user came from Breakdown's back button (allowSwitch flag),
      // skip the auto-redirect so they can re-pick their identity.
      if (existingId && !location.state?.allowSwitch) {
        if (data.status === 'locked' || data.status === 'closed') {
          navigateForward(`/session/${sessionId}/breakdown`, { replace: true });
        } else {
          navigateForward(`/session/${sessionId}/claim`, { replace: true });
        }
        return;
      }

      const mSnap = await getDocs(collection(db, 'sessions', sessionId, 'members'));
      setMembers(mSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setMemberCount(mSnap.docs.length);
      // Pre-select the current identity if the user came back to switch.
      if (existingId) setSelectedId(existingId);

      let total = 0;
      try {
        const vSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues'));
        for (const vDoc of vSnap.docs) {
          const vData = vDoc.data();
          const iSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items'));
          total += iSnap.docs.reduce((s, d) => {
            const item = d.data();
            return s + (item.unitPrice ?? 0) * (item.quantity ?? 1);
          }, 0) + (vData.gstAmount || 0) + (vData.serviceChargeAmount || 0);
        }
      } catch {}
      setSessionTotal(total);
      setLoading(false);
    }

    load();
  }, [sessionId]);

  async function handleAddNew() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const ref = await addDoc(collection(db, 'sessions', sessionId, 'members'), {
        name, joinedAt: serverTimestamp(), isCreator: false,
      });
      const newMember = { id: ref.id, name, isCreator: false };
      setMembers(prev => [...prev, newMember]);
      setShowNewInput(false);
      setNewName('');
      chooseMember(newMember);
    } catch (err) {
      console.error(err);
    } finally {
      setAdding(false);
    }
  }

  async function chooseMember(member) {
    if (!member || continuing) return;
    setSelectedId(member.id);
    setContinuing(true);
    localStorage.setItem(`member_${sessionId}`, member.id);
    localStorage.setItem(`memberName_${sessionId}`, member.name);

    if (session?.status === 'locked' || session?.status === 'closed' || location.state?.returnTo === 'breakdown') {
      navigateForward(`/session/${sessionId}/breakdown`, { state: { from: 'who-are-you' } });
      return;
    }

    try {
      const claimsSnap = await getDocs(collection(db, 'sessions', sessionId, 'claims'));
      const hasClaimsForUser = claimsSnap.docs.some(d => {
        const data = d.data();
        return data.memberId === member.id || data.sharedWith?.includes(member.id);
      });
      navigateForward(`/session/${sessionId}/${hasClaimsForUser ? 'joining' : 'claim'}`, { state: { from: 'who-are-you' } });
    } catch {
      navigateForward(`/session/${sessionId}/claim`);
    }
  }

  useEffect(() => {
    document.title = session?.name ? `${session.name} — ${BRAND_NAME}` : BRAND_NAME;
  }, [session?.name]);

  const formattedDate = session?.date
    ? new Date(session.date + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  if (loading) return (
    <PageContainer>
      <div style={{ marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <SkeletonBlock width="180px" height="22px" />
        <SkeletonBlock width="100px" height="13px" />
      </div>
      <SkeletonBlock width="80px" height="16px" style={{ marginBottom: '4px' }} />
      <SkeletonBlock width="160px" height="12px" style={{ marginBottom: '16px' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 12px 12px 10px' }}>
            <SkeletonBlock width="26px" height="26px" borderRadius="50%" />
            <SkeletonBlock width={`${80 + i * 20}px`} height="13px" />
          </div>
        ))}
      </div>
    </PageContainer>
  );

  return (
    <PageContainer>
      <div style={styles.header}>
        <button style={styles.back} onClick={() => navigateBack(from === 'existing-sessions' ? '/existing-sessions' : '/')}>←</button>
        <div>
          <div style={styles.sessionName}>{session?.name}</div>
          {formattedDate && <div style={styles.sessionDate}>{formattedDate}</div>}
        </div>
      </div>

      <div style={styles.prompt}>Who are you?</div>
      <div style={styles.helper}>
        Pick your name to start claiming your items.
        {memberCount > 0 && (
          <span style={styles.helperMeta}>
            {' '}· {memberCount} {memberCount === 1 ? 'person' : 'people'}{sessionTotal > 0 ? ` · $${sessionTotal.toFixed(2)}` : ''}
          </span>
        )}
      </div>

      <div style={styles.memberList}>
        {members.map((member, idx) => {
          const isSelected = selectedId === member.id;
          return (
            <div
              key={member.id}
              style={{
                ...styles.memberRow,
                backgroundColor: isSelected ? 'var(--bg-secondary)' : 'transparent',
                borderLeft: isSelected ? '3px solid var(--text-primary)' : '3px solid transparent',
                opacity: continuing && !isSelected ? 0.4 : 1,
                pointerEvents: continuing ? 'none' : 'auto',
              }}
              onClick={() => { setShowNewInput(false); chooseMember(member); }}
            >
              <div style={{ ...styles.avatar, backgroundColor: AVATAR_COLORS[idx % AVATAR_COLORS.length] }}>
                {member.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={styles.memberName}>{member.name}</div>
                {isSelected && continuing && <div style={styles.selectedLabel}>Loading…</div>}
              </div>
            </div>
          );
        })}

        {showNewInput ? (
          <div style={styles.newInputRow}>
            <input
              autoFocus
              style={styles.newInput}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Your name..."
              onKeyDown={e => e.key === 'Enter' && handleAddNew()}
            />
            <button style={styles.addBtn} onClick={handleAddNew} disabled={adding}>
              {adding ? '…' : 'Add'}
            </button>
          </div>
        ) : session?.status !== 'locked' && session?.status !== 'closed' ? (
          <div
            style={styles.newPersonRow}
            onClick={() => { setShowNewInput(true); setSelectedId(null); }}
          >
            <div style={styles.avatarDashed}>+</div>
            <div style={{ ...styles.memberName, color: 'var(--text-secondary)' }}>+ Add myself</div>
          </div>
        ) : null}
      </div>

    </PageContainer>
  );
}

const styles = {
  header: { display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '24px' },
  back: {
    background: 'none', border: 'none', fontSize: '20px', color: 'var(--text-primary)',
    cursor: 'pointer', padding: '0', lineHeight: 1.6, flexShrink: 0,
  },
  sessionName: {
    fontSize: '22px', fontWeight: 500, color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  sessionDate: {
    fontSize: '13px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px',
  },
  prompt: {
    fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '4px',
  },
  helper: {
    fontSize: '12px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '16px',
  },
  helperMeta: {
    color: 'var(--text-tertiary)',
  },
  memberList: { display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '24px' },
  memberRow: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '12px 12px 12px 10px', borderRadius: '10px', cursor: 'pointer',
    transition: 'background 0.1s',
  },
  avatar: {
    width: '26px', height: '26px', borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '11px', fontWeight: 700, color: '#fff', flexShrink: 0,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  memberName: {
    fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  selectedLabel: {
    fontSize: '11px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '1px',
  },
  newPersonRow: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '12px 12px 12px 13px', cursor: 'pointer',
  },
  avatarDashed: {
    width: '26px', height: '26px', borderRadius: '50%',
    border: '1.5px dashed var(--border-color)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '16px', color: 'var(--text-secondary)', flexShrink: 0,
  },
  newInputRow: { display: 'flex', gap: '8px', padding: '8px 0' },
  newInput: {
    flex: 1, padding: '10px 12px', fontSize: '14px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)',
    border: '0.5px solid var(--border-color)', borderRadius: '8px', outline: 'none',
  },
  addBtn: {
    padding: '10px 16px', fontSize: '14px', fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)',
    border: 'none', borderRadius: '8px', cursor: 'pointer',
  },
  continueBtn: {
    width: '100%', padding: '13px', fontSize: '14px', fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)',
    border: 'none', borderRadius: '8px', cursor: 'pointer',
  },
};

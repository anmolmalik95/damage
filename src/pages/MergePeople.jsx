import { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, addDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import PageContainer from '../components/PageContainer';
import SkeletonBlock from '../components/SkeletonBlock';
import { BRAND_NAME } from '../brand';

export default function MergePeople() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromId = searchParams.get('from');
  const intoId = searchParams.get('into');

  const [sessionName, setSessionName] = useState(null);
  const [fromMember, setFromMember] = useState(null);
  const [intoMember, setIntoMember] = useState(null);

  useEffect(() => {
    document.title = sessionName ? `Merge people · ${sessionName} — ${BRAND_NAME}` : BRAND_NAME;
  }, [sessionName]);
  const [fromClaims, setFromClaims] = useState([]);
  const [intoClaims, setIntoClaims] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [checkedClaims, setCheckedClaims] = useState(new Set());
  const [mergedName, setMergedName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const [sessionSnap, membersSnap, claimsSnap, venuesSnap] = await Promise.all([
        getDoc(doc(db, 'sessions', sessionId)),
        getDocs(collection(db, 'sessions', sessionId, 'members')),
        getDocs(collection(db, 'sessions', sessionId, 'claims')),
        getDocs(collection(db, 'sessions', sessionId, 'venues')),
      ]);
      if (sessionSnap.exists()) setSessionName(sessionSnap.data().name ?? null);

      const membersData = membersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const from = membersData.find(m => m.id === fromId);
      const into = membersData.find(m => m.id === intoId);
      setFromMember(from);
      setIntoMember(into);
      setMergedName(from?.name ?? '');

      const allClaims = claimsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const fc = allClaims.filter(c => c.memberId === fromId || c.sharedWith?.includes(fromId));
      const ic = allClaims.filter(c => c.memberId === intoId || c.sharedWith?.includes(intoId));
      setFromClaims(fc);
      setIntoClaims(ic);
      setCheckedClaims(new Set([...fc.map(c => c.id), ...ic.map(c => c.id)]));

      const items = (await Promise.all(
        venuesSnap.docs.map(async vDoc => {
          const iSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items'));
          return iSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        })
      )).flat();
      setAllItems(items);
      setLoading(false);
    }
    load().catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, [sessionId, fromId, intoId]);

  function toggleClaim(id) {
    setCheckedClaims(p => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function handleConfirm() {
    const name = mergedName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const newMemberRef = await addDoc(collection(db, 'sessions', sessionId, 'members'), {
        name, joinedAt: serverTimestamp(),
        isCreator: fromMember?.isCreator || intoMember?.isCreator || false,
      });

      const batch = writeBatch(db);
      const allClaims = [...fromClaims, ...intoClaims];
      // Deduplicate (a claim could appear in both lists if somehow shared across both members)
      const seen = new Set();
      allClaims.forEach(claim => {
        if (seen.has(claim.id)) return;
        seen.add(claim.id);
        const claimRef = doc(db, 'sessions', sessionId, 'claims', claim.id);
        if (checkedClaims.has(claim.id)) {
          const updates = {};
          if (claim.memberId === fromId || claim.memberId === intoId) {
            updates.memberId = newMemberRef.id;
          }
          if (claim.sharedWith?.some(mid => mid === fromId || mid === intoId)) {
            updates.sharedWith = [...new Set(
              claim.sharedWith.map(mid => (mid === fromId || mid === intoId) ? newMemberRef.id : mid)
            )];
          }
          if (Object.keys(updates).length) batch.update(claimRef, updates);
        } else {
          batch.delete(claimRef);
        }
      });

      batch.delete(doc(db, 'sessions', sessionId, 'members', fromId));
      batch.delete(doc(db, 'sessions', sessionId, 'members', intoId));
      await batch.commit();
      navigate(`/session/${sessionId}/manage-people`);
    } catch (err) {
      console.error(err);
      setSaving(false);
    }
  }

  if (loading) return (
    <PageContainer>
      <div style={st.header}>
        <button style={st.back} onClick={() => navigate(-1)}>←</button>
        <div><div style={st.title}>Merge people</div></div>
      </div>
      <div style={st.twoCol}>
        {[...Array(2)].map((_, ci) => (
          <div key={ci} style={st.col}>
            <SkeletonBlock height="36px" borderRadius="0" />
            {[...Array(3)].map((_, ri) => (
              <div key={ri} style={{ padding: '8px 10px', borderBottom: '0.5px solid var(--border-color)' }}>
                <SkeletonBlock height="13px" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </PageContainer>
  );

  function ClaimRow({ claim }) {
    const item = allItems.find(i => i.id === claim.itemId);
    const checked = checkedClaims.has(claim.id);
    return (
      <div style={{ ...st.claimRow, opacity: checked ? 1 : 0.35 }} onClick={() => toggleClaim(claim.id)}>
        <div style={{ ...st.checkbox, backgroundColor: checked ? 'var(--text-primary)' : 'transparent', border: checked ? 'none' : '1.5px solid var(--border-color)' }}>
          {checked && <span style={st.checkmark}>✓</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={st.claimName}>{item?.name ?? '?'}</div>
          {claim.type === 'shared' && <div style={st.claimShared}>shared</div>}
        </div>
        <div style={st.claimAmt}>${(item?.unitPrice ?? 0).toFixed(2)}</div>
      </div>
    );
  }

  return (
    <PageContainer>
      <div style={st.header}>
        <button style={st.back} onClick={() => navigate(-1)}>←</button>
        <div>
          <div style={st.title}>Merge people</div>
          <div style={st.subtitle}>{fromMember?.name} + {intoMember?.name}</div>
        </div>
      </div>

      <div style={st.helper}>
        Select which claims to keep. Unselected claims return to the unclaimed pool. Choose a name for the merged account.
      </div>

      <div style={st.twoCol}>
        <div style={st.col}>
          <div style={st.colHeader}>{fromMember?.name}</div>
          {fromClaims.length === 0
            ? <div style={st.colEmpty}>No claims</div>
            : fromClaims.map(c => <ClaimRow key={c.id} claim={c} />)
          }
        </div>
        <div style={st.col}>
          <div style={st.colHeader}>{intoMember?.name}</div>
          {intoClaims.length === 0
            ? <div style={st.colEmpty}>No claims</div>
            : intoClaims.map(c => <ClaimRow key={c.id} claim={c} />)
          }
        </div>
      </div>

      <div style={st.nameSection}>
        <div style={st.nameLabel}>Merged name</div>
        <input
          style={st.nameInput}
          value={mergedName}
          onChange={e => setMergedName(e.target.value)}
          placeholder="Enter name…"
        />
      </div>

      <div style={st.btns}>
        <button style={st.cancelBtn} onClick={() => navigate(-1)} disabled={saving}>Cancel</button>
        <button
          style={{ ...st.confirmBtn, opacity: saving || !mergedName.trim() ? 0.6 : 1 }}
          onClick={handleConfirm}
          disabled={saving || !mergedName.trim()}
        >
          {saving ? 'Merging…' : 'Confirm merge'}
        </button>
      </div>
    </PageContainer>
  );
}

const st = {
  header: { display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' },
  back: { background: 'none', border: 'none', fontSize: '20px', color: 'var(--text-primary)', cursor: 'pointer', padding: '0', lineHeight: 1.6 },
  title: { fontSize: '20px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  subtitle: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px' },
  helper: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '16px' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' },
  col: { border: '0.5px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden' },
  colHeader: { fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '8px 10px', backgroundColor: 'var(--bg-secondary)', borderBottom: '0.5px solid var(--border-color)' },
  colEmpty: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '12px 10px', textAlign: 'center' },
  claimRow: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 10px', cursor: 'pointer', borderBottom: '0.5px solid var(--border-color)' },
  checkbox: { width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '1px' },
  checkmark: { fontSize: '10px', color: 'var(--bg-primary)', fontWeight: 700 },
  claimName: { fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  claimShared: { fontSize: '10px', color: '#534AB7', fontFamily: 'system-ui, -apple-system, sans-serif' },
  claimAmt: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', flexShrink: 0 },
  nameSection: { marginBottom: '20px' },
  nameLabel: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '6px' },
  nameInput: { width: '100%', padding: '10px 12px', fontSize: '14px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '8px', outline: 'none', colorScheme: 'light dark', boxSizing: 'border-box' },
  btns: { display: 'flex', gap: '10px' },
  cancelBtn: { flex: 1, padding: '12px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer' },
  confirmBtn: { flex: 1, padding: '12px', fontSize: '14px', fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer' },
};

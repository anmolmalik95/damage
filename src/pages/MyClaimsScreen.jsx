import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getDocs, getDoc, doc, collection, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import PageContainer from '../components/PageContainer';
import SkeletonBlock from '../components/SkeletonBlock';
import { useNavigation } from '../context/NavigationContext';

export default function MyClaimsScreen() {
  const { sessionId } = useParams();
  const { navigateForward, navigateBack } = useNavigation();

  const currentMemberId = localStorage.getItem(`member_${sessionId}`);
  const currentMemberName = localStorage.getItem(`memberName_${sessionId}`);

  const [sessionName, setSessionName] = useState(null);
  const [venues, setVenues] = useState([]);
  const [myClaims, setMyClaims] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = sessionName ? `My claims · ${sessionName} — Unfuck` : 'Unfuck';
  }, [sessionName]);

  useEffect(() => {
    if (!currentMemberId) {
      navigateBack(`/s/${sessionId}`);
      return;
    }

    async function load() {
      const [sessionSnap, membersSnap, claimsSnap, venuesSnap] = await Promise.all([
        getDoc(doc(db, 'sessions', sessionId)),
        getDocs(collection(db, 'sessions', sessionId, 'members')),
        getDocs(collection(db, 'sessions', sessionId, 'claims')),
        getDocs(collection(db, 'sessions', sessionId, 'venues')),
      ]);

      if (sessionSnap.exists()) setSessionName(sessionSnap.data().name ?? null);
      setMembers(membersSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const allClaims = claimsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMyClaims(allClaims.filter(c =>
        c.memberId === currentMemberId || c.sharedWith?.includes(currentMemberId)
      ));

      const venueList = await Promise.all(
        venuesSnap.docs.map(async vDoc => {
          const itemsSnap = await getDocs(
            collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items')
          );
          return {
            id: vDoc.id, ...vDoc.data(),
            items: itemsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          };
        })
      );
      setVenues(venueList);
      setLoading(false);
    }
    load().catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, [sessionId, currentMemberId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleStillClaiming() {
    try {
      await updateDoc(doc(db, 'sessions', sessionId, 'members', currentMemberId), { doneClaiming: false });
      navigateBack(`/session/${sessionId}/claim`);
    } catch (err) { console.error(err); }
  }

  function handleSwitch() {
    localStorage.removeItem(`member_${sessionId}`);
    localStorage.removeItem(`memberName_${sessionId}`);
    navigateForward(`/s/${sessionId}`);
  }

  if (loading) return (
    <PageContainer>
      {[...Array(3)].map((_, vi) => (
        <div key={vi} style={{ border: '0.5px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden', marginBottom: '16px' }}>
          <SkeletonBlock height="36px" borderRadius="0" />
          {[...Array(3)].map((_, ri) => (
            <div key={ri} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderTop: '0.5px solid var(--border-color)' }}>
              <SkeletonBlock width="50%" height="13px" />
              <SkeletonBlock width="50px" height="13px" />
            </div>
          ))}
        </div>
      ))}
    </PageContainer>
  );

  const allItems = venues.flatMap(v =>
    v.items.map(i => ({ ...i, venueId: v.id, venueName: v.name }))
  );

  const venueGroups = {};
  myClaims.forEach(claim => {
    const item = allItems.find(i => i.id === claim.itemId);
    if (!item) return;
    if (!venueGroups[item.venueId]) venueGroups[item.venueId] = { name: item.venueName, wholeMap: {}, sharedRows: [] };
    if (claim.type === 'shared') {
      venueGroups[item.venueId].sharedRows.push({ claim, item });
    } else {
      if (!venueGroups[item.venueId].wholeMap[claim.itemId]) {
        venueGroups[item.venueId].wholeMap[claim.itemId] = { item, claims: [] };
      }
      venueGroups[item.venueId].wholeMap[claim.itemId].claims.push(claim);
    }
  });

  const totalAmount = myClaims.reduce((sum, claim) => {
    const item = allItems.find(i => i.id === claim.itemId);
    if (!item) return sum;
    return sum + (claim.type === 'shared'
      ? (item.unitPrice ?? 0) / (claim.sharedWith?.length || 1)
      : (item.unitPrice ?? 0));
  }, 0);

  return (
    <PageContainer>
      <div style={st.header}>
        <div>
          <div style={st.title}>My claims</div>
          <div style={st.subtitle}>{currentMemberName} · {sessionName}</div>
        </div>
        <button style={st.switchBtn} onClick={handleSwitch}>Not you?</button>
      </div>

      {myClaims.length === 0 ? (
        <div style={st.empty}>Nothing claimed yet.</div>
      ) : (
        <div style={st.claimList}>
          {Object.values(venueGroups).map(({ name: venueName, wholeMap, sharedRows }) => (
            <div key={venueName} style={st.venueGroup}>
              <div style={st.venueLabel}>{venueName.toUpperCase()}</div>
              {Object.values(wholeMap).map(({ item, claims }) => {
                const qty = claims.length;
                const total = (item.unitPrice ?? 0) * qty;
                return (
                  <div key={item.id} style={st.claimRow}>
                    <div style={st.claimLeft}>
                      <div style={st.claimName}>{item.name}{qty > 1 ? ` ×${qty}` : ''}</div>
                    </div>
                    <div style={st.claimAmt}>${total.toFixed(2)}</div>
                  </div>
                );
              })}
              {sharedRows.map(({ claim, item }) => {
                const amount = (item.unitPrice ?? 0) / (claim.sharedWith?.length || 1);
                const claimedByLabel = claim.claimedBy === currentMemberId ? 'you' : (claim.claimedByName ?? members.find(m => m.id === claim.claimedBy)?.name ?? '?');
                return (
                  <div key={claim.id} style={st.claimRow}>
                    <div style={st.claimLeft}>
                      <div style={st.claimName}>{item.name}</div>
                      <div style={st.claimMeta}>shared by {claimedByLabel}</div>
                    </div>
                    <div style={st.claimAmt}>${amount.toFixed(2)}</div>
                  </div>
                );
              })}
            </div>
          ))}
          <div style={st.totalRow}>
            Your total: <span style={st.totalAmt}>${totalAmount.toFixed(2)}</span> <span style={st.totalNote}>(pre-tax)</span>
          </div>
        </div>
      )}

      <div style={st.btnWrap}>
        <button style={st.editBtn} onClick={() => navigateBack(`/session/${sessionId}/claim`)}>
          Edit claims
        </button>
        <button style={st.stillBtn} onClick={handleStillClaiming}>
          Still claiming
        </button>
      </div>
    </PageContainer>
  );
}

const st = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' },
  title: { fontSize: '20px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  subtitle: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '3px' },
  switchBtn: { background: 'none', border: 'none', fontSize: '12px', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '4px 0', fontFamily: 'system-ui, -apple-system, sans-serif', textDecoration: 'underline', flexShrink: 0, alignSelf: 'flex-start', marginTop: '4px' },
  empty: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', textAlign: 'center', padding: '40px 0' },
  claimList: { border: '0.5px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden', marginBottom: '24px' },
  venueGroup: {},
  venueLabel: { fontSize: '11px', fontWeight: 500, color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '0.06em', padding: '10px 14px 6px', backgroundColor: 'var(--bg-secondary)' },
  claimRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '0.5px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' },
  claimLeft: { flex: 1, minWidth: 0, paddingRight: '12px' },
  claimName: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  claimMeta: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px' },
  claimAmt: { fontSize: '13px', color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', flexShrink: 0 },
  totalRow: { fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '12px 14px', backgroundColor: 'var(--bg-secondary)' },
  totalAmt: { color: 'var(--text-primary)' },
  totalNote: { fontWeight: 400, color: 'var(--text-tertiary)' },
  btnWrap: { marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' },
  editBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer' },
  stillBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', color: 'var(--text-secondary)', border: '0.5px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer' },
};

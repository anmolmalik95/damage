import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getDocs, getDoc, doc, collection } from 'firebase/firestore';
import { db } from '../firebase';
import PageContainer from '../components/PageContainer';
import SkeletonBlock from '../components/SkeletonBlock';
import { useNavigation } from '../context/NavigationContext';
import { BRAND_NAME } from '../brand';

export default function JoiningScreen() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { navigateForward, navigateBack } = useNavigation();

  const currentMemberId = localStorage.getItem(`member_${sessionId}`);
  const currentMemberName = localStorage.getItem(`memberName_${sessionId}`);

  const [sessionName, setSessionName] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [venues, setVenues] = useState([]);
  const [members, setMembers] = useState([]);
  const [myClaims, setMyClaims] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = sessionName ? `${sessionName} — ${BRAND_NAME}` : BRAND_NAME;
  }, [sessionName]);

  useEffect(() => {
    if (!currentMemberId) {
      navigate(`/s/${sessionId}`, { replace: true });
      return;
    }

    async function load() {
      const [sessionSnap, membersSnap, claimsSnap, venuesSnap] = await Promise.all([
        getDoc(doc(db, 'sessions', sessionId)),
        getDocs(collection(db, 'sessions', sessionId, 'members')),
        getDocs(collection(db, 'sessions', sessionId, 'claims')),
        getDocs(collection(db, 'sessions', sessionId, 'venues')),
      ]);
      if (sessionSnap.exists()) {
        setSessionName(sessionSnap.data().name ?? null);
        setSessionStatus(sessionSnap.data().status ?? null);
      }

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
            id: vDoc.id,
            ...vDoc.data(),
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
  }, [sessionId, currentMemberId, navigate]);

  function handleBack() {
    localStorage.removeItem(`member_${sessionId}`);
    navigateBack(`/s/${sessionId}`);
  }

  function handleGotIt() {
    if (sessionStatus === 'locked' || sessionStatus === 'closed') {
      navigateForward(`/session/${sessionId}/breakdown`);
    } else {
      navigateForward(`/session/${sessionId}/claim`);
    }
  }

  if (loading) return (
    <PageContainer>
      {[...Array(4)].map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <SkeletonBlock width="26px" height="26px" borderRadius="50%" />
          <SkeletonBlock width="120px" height="14px" />
        </div>
      ))}
    </PageContainer>
  );

  const allItems = venues.flatMap(v =>
    v.items.map(i => ({ ...i, venueId: v.id, venueName: v.name }))
  );

  // Group claims by venue, consolidating whole claims of same itemId
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
      <div style={styles.header}>
        <button style={styles.back} onClick={handleBack}>←</button>
        <div style={styles.title}>Welcome, {currentMemberName}!</div>
        {myClaims.length === 0 ? (
          <div style={styles.subtitle}>Nothing has been claimed for you yet — head to the next screen to start claiming.</div>
        ) : (
          <>
            <div style={styles.subtitle}>Here's what's already been claimed for you.</div>
            <div style={styles.helper}>You can add or remove items on the next screen.</div>
          </>
        )}
      </div>

      {myClaims.length > 0 && (
        <div style={styles.claimList}>
          {Object.values(venueGroups).map(({ name: venueName, wholeMap, sharedRows }) => (
            <div key={venueName} style={styles.venueGroup}>
              <div style={styles.venueLabel}>{venueName.toUpperCase()}</div>
              {Object.values(wholeMap).map(({ item, claims }) => {
                const qty = claims.length;
                const total = (item.unitPrice ?? 0) * qty;
                const uniqueClaimers = [...new Set(claims.map(c => c.claimedBy))];
                let meta;
                if (uniqueClaimers.length === 1) {
                  const claimedByLabel = uniqueClaimers[0] === currentMemberId ? 'you' : (claims[0].claimedByName ?? members.find(m => m.id === uniqueClaimers[0])?.name ?? '?');
                  meta = uniqueClaimers[0] === currentMemberId ? 'claimed by you' : `claimed by ${claimedByLabel} for you`;
                } else {
                  meta = 'claimed by multiple people';
                }
                return (
                  <div key={item.id} style={styles.claimRow}>
                    <div style={styles.claimLeft}>
                      <div style={styles.claimName}>{item.name}{qty > 1 ? ` ×${qty}` : ''}</div>
                      <div style={styles.claimMeta}>{meta}</div>
                    </div>
                    <div style={styles.claimAmt}>${total.toFixed(2)}</div>
                  </div>
                );
              })}
              {sharedRows.map(({ claim, item }) => {
                const amount = (item.unitPrice ?? 0) / (claim.sharedWith?.length || 1);
                const claimedByLabel = claim.claimedBy === currentMemberId ? 'you' : (claim.claimedByName ?? members.find(m => m.id === claim.claimedBy)?.name ?? '?');
                const meta = `shared by ${claimedByLabel}`;
                return (
                  <div key={claim.id} style={styles.claimRow}>
                    <div style={styles.claimLeft}>
                      <div style={styles.claimName}>{item.name}</div>
                      <div style={styles.claimMeta}>{meta}</div>
                    </div>
                    <div style={styles.claimAmt}>${amount.toFixed(2)}</div>
                  </div>
                );
              })}
            </div>
          ))}

          <div style={styles.totalRow}>
            Your current total: <span style={styles.totalAmt}>${totalAmount.toFixed(2)}</span> (pre-tax)
          </div>
        </div>
      )}

      <div style={styles.btnWrap}>
        <button style={styles.btn} onClick={handleGotIt}>Got it — start claiming →</button>
      </div>
    </PageContainer>
  );
}

const styles = {
  header: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' },
  back: {
    background: 'none', border: 'none', fontSize: '20px', color: 'var(--text-primary)',
    cursor: 'pointer', padding: '0', lineHeight: 1, flexShrink: 0,
  },
  title: {
    fontSize: '20px', fontWeight: 500, color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  subtitle: {
    fontSize: '13px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '4px',
  },
  helper: {
    fontSize: '13px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '4px',
  },
  claimList: {
    border: '0.5px solid var(--border-color)', borderRadius: '12px',
    overflow: 'hidden', marginBottom: '24px',
  },
  venueGroup: {},
  venueLabel: {
    fontSize: '11px', fontWeight: 500, color: 'var(--text-tertiary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    letterSpacing: '0.06em', padding: '10px 14px 6px',
    backgroundColor: 'var(--bg-secondary)',
  },
  claimRow: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '10px 14px', borderBottom: '0.5px solid var(--border-color)',
    backgroundColor: 'var(--bg-primary)',
  },
  claimLeft: { flex: 1, minWidth: 0, paddingRight: '12px' },
  claimName: {
    fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  claimMeta: {
    fontSize: '11px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px',
  },
  claimAmt: {
    fontSize: '13px', color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', flexShrink: 0,
  },
  totalRow: {
    fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '12px 14px', backgroundColor: 'var(--bg-secondary)',
  },
  totalAmt: {
    color: 'var(--text-primary)',
  },
  btnWrap: { marginTop: 'auto' },
  btn: {
    width: '100%', padding: '13px', fontSize: '14px', fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)',
    border: 'none', borderRadius: '8px', cursor: 'pointer',
  },
};

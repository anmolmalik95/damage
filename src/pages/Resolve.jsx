import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SkeletonBlock from '../components/SkeletonBlock';
import { collection, doc, getDoc, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import PageContainer from '../components/PageContainer';

const AVATAR_COLORS = ['#5b9bd5', '#3dba8a', '#e8a03a', '#e07060', '#9070d0', '#4db8b8'];

export default function Resolve() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [sessionName, setSessionName] = useState(null);
  const [members, setMembers] = useState([]);
  const [unresolved, setUnresolved] = useState([]);
  const [overclaimed, setOverclaimed] = useState([]);
  const [resolutions, setResolutions] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = sessionName ? `Resolve · ${sessionName} — Unfuck` : 'Unfuck';
  }, [sessionName]);

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
      setMembers(membersData);
      const allClaims = claimsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const unresolvedList = [];
      const overclaimedList = [];

      await Promise.all(venuesSnap.docs.map(async vDoc => {
        const vData = vDoc.data();
        const iSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items'));
        iSnap.docs.forEach(iDoc => {
          const item = { id: iDoc.id, ...iDoc.data() };
          const qty = item.quantity ?? 1;
          const itemClaims = allClaims.filter(c => c.itemId === item.id);
          const claimedNums = new Set(itemClaims.map(c => c.instanceNumber));

          const unclaimed = [];
          for (let n = 1; n <= qty; n++) if (!claimedNums.has(n)) unclaimed.push(n);

          if (unclaimed.length > 0) {
            unresolvedList.push({
              itemId: item.id,
              itemName: item.name,
              unitPrice: item.unitPrice ?? 0,
              venueName: vData.name,
              unclaimedInstances: unclaimed,
            });
          }
          if (itemClaims.length > qty) {
            overclaimedList.push({
              itemId: item.id,
              itemName: item.name,
              unitPrice: item.unitPrice ?? 0,
              venueName: vData.name,
              qty,
              claimerClaims: itemClaims.map(c => ({
                claim: c,
                member: membersData.find(m => m.id === c.memberId),
              })),
            });
          }
        });
      }));

      if (unresolvedList.length === 0 && overclaimedList.length === 0) {
        navigate(`/session/${sessionId}/breakdown`, { replace: true });
        return;
      }

      setUnresolved(unresolvedList);
      setOverclaimed(overclaimedList);
      setLoading(false);
    }
    load();
  }, [sessionId, navigate]);

  function setRes(itemId, type, memberId) {
    setResolutions(p => ({ ...p, [itemId]: { type, memberId, selectedIds: new Set() } }));
  }

  function toggleChoose(itemId, memberId) {
    setResolutions(p => {
      const cur = p[itemId] ?? { type: 'choose', selectedIds: new Set() };
      const ids = new Set(cur.selectedIds);
      ids.has(memberId) ? ids.delete(memberId) : ids.add(memberId);
      return { ...p, [itemId]: { type: 'choose', memberId: undefined, selectedIds: ids } };
    });
  }

  function setOcRes(itemId, keepId) {
    setResolutions(p => ({ ...p, [`oc_${itemId}`]: { type: 'keep', keepClaimId: keepId } }));
  }

  const allResolved =
    unresolved.every(u => {
      const r = resolutions[u.itemId];
      if (!r) return false;
      if (r.type === 'choose') return (r.selectedIds?.size ?? 0) > 0;
      return true;
    }) &&
    overclaimed.every(o => !!resolutions[`oc_${o.itemId}`]);

  async function handleConfirm() {
    setSaving(true);
    try {
      const batch = writeBatch(db);

      for (const u of unresolved) {
        const r = resolutions[u.itemId];
        if (!r) continue;
        for (const instanceNumber of u.unclaimedInstances) {
          const ref = doc(collection(db, 'sessions', sessionId, 'claims'));
          if (r.type === 'member') {
            batch.set(ref, {
              itemId: u.itemId, instanceNumber,
              memberId: r.memberId, claimedBy: 'resolve', claimedByName: 'Resolution',
              type: 'whole', sharedWith: [], createdAt: serverTimestamp(),
            });
          } else if (r.type === 'split') {
            const ids = members.map(m => m.id);
            batch.set(ref, {
              itemId: u.itemId, instanceNumber,
              memberId: ids[0], claimedBy: 'resolve', claimedByName: 'Resolution',
              type: 'shared', sharedWith: ids, createdAt: serverTimestamp(),
            });
          } else if (r.type === 'choose') {
            const ids = [...r.selectedIds];
            batch.set(ref, {
              itemId: u.itemId, instanceNumber,
              memberId: ids[0], claimedBy: 'resolve', claimedByName: 'Resolution',
              type: 'shared', sharedWith: ids, createdAt: serverTimestamp(),
            });
          }
        }
      }

      for (const o of overclaimed) {
        const r = resolutions[`oc_${o.itemId}`];
        if (!r) continue;
        o.claimerClaims.forEach(({ claim }) => {
          if (claim.id !== r.keepClaimId) {
            batch.delete(doc(db, 'sessions', sessionId, 'claims', claim.id));
          }
        });
      }

      await batch.commit();
      navigate(`/session/${sessionId}/breakdown`, { state: { from: 'claim' } });
    } catch (err) {
      console.error(err);
      setSaving(false);
    }
  }

  if (loading) return (
    <PageContainer>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '20px' }}>
        <SkeletonBlock width="20px" height="20px" borderRadius="4px" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <SkeletonBlock width="130px" height="20px" />
          <SkeletonBlock width="160px" height="13px" />
        </div>
      </div>
      <div style={{ border: '0.5px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
        {[0,1,2].map((i, idx, arr) => (
          <div key={i} style={{ padding: '14px', borderBottom: idx < arr.length - 1 ? '0.5px solid var(--border-color)' : 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <SkeletonBlock width="60%" height="14px" />
            <SkeletonBlock width="40%" height="11px" />
            <div style={{ display: 'flex', gap: '6px' }}>
              <SkeletonBlock width="70px" height="28px" borderRadius="20px" />
              <SkeletonBlock width="70px" height="28px" borderRadius="20px" />
              <SkeletonBlock width="90px" height="28px" borderRadius="20px" />
            </div>
          </div>
        ))}
      </div>
    </PageContainer>
  );

  const totalCount = unresolved.length + overclaimed.length;

  function handleAutoResolve() {
    const newRes = { ...resolutions };
    unresolved.forEach(u => {
      if (!newRes[u.itemId]) {
        newRes[u.itemId] = { type: 'split', memberId: undefined, selectedIds: new Set() };
      }
    });
    setResolutions(newRes);
  }

  return (
    <PageContainer>
      <div style={s.header}>
        <button style={s.back} onClick={() => navigate(`/session/${sessionId}/claim`)}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.title}>Almost done</div>
          <div style={s.subtitle}>{totalCount} item{totalCount !== 1 ? 's' : ''} need assigning</div>
        </div>
        {unresolved.length > 0 && (
          <button style={s.autoResolveBtn} onClick={handleAutoResolve}>Auto-resolve all</button>
        )}
      </div>

      <div style={s.card}>
        {unresolved.map((u, idx) => {
          const r = resolutions[u.itemId];
          const isLast = idx === unresolved.length - 1 && overclaimed.length === 0;
          return (
            <div key={u.itemId} style={{ ...s.itemBlock, borderBottom: isLast ? 'none' : '0.5px solid var(--border-color)' }}>
              <div style={s.itemTopRow}>
                <div style={s.itemLeft}>
                  <span style={s.itemName}>{u.itemName}</span>
                  <span style={s.unclaimedTag}>Unclaimed{u.unclaimedInstances.length > 1 ? ` ×${u.unclaimedInstances.length}` : ''}</span>
                </div>
                <span style={s.itemPrice}>${(u.unitPrice * u.unclaimedInstances.length).toFixed(2)}</span>
              </div>

              <div style={s.itemMeta}>
                ${u.unitPrice.toFixed(2)} per unit · {u.unclaimedInstances.length} unit{u.unclaimedInstances.length !== 1 ? 's' : ''} unclaimed
              </div>

              <div style={s.chips}>
                {members.map(m => {
                  const sel = r?.type === 'member' && r.memberId === m.id;
                  return (
                    <div key={m.id} style={{ ...s.chip, ...(sel ? s.chipSel : {}) }} onClick={() => setRes(u.itemId, 'member', m.id)}>
                      {m.name}
                    </div>
                  );
                })}
                <div style={{ ...s.chip, ...(r?.type === 'split' ? s.chipSel : {}) }} onClick={() => setRes(u.itemId, 'split')}>
                  Split among all
                </div>
                <div style={{ ...s.chip, ...(r?.type === 'choose' ? s.chipSel : {}) }} onClick={() => setRes(u.itemId, 'choose')}>
                  Custom split
                </div>
              </div>

              {r?.type === 'choose' && (
                <div style={s.chooseGrid}>
                  {members.map((m, mi) => {
                    const sel = r.selectedIds?.has(m.id);
                    return (
                      <div
                        key={m.id}
                        style={{
                          ...s.chooseTile,
                          border: sel ? '1.5px solid var(--text-primary)' : '1.5px solid transparent',
                          backgroundColor: sel ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                        }}
                        onClick={() => toggleChoose(u.itemId, m.id)}
                      >
                        <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: AVATAR_COLORS[mi % AVATAR_COLORS.length], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', fontFamily: 'system-ui, -apple-system, sans-serif', flexShrink: 0 }}>
                          {m.name.charAt(0).toUpperCase()}
                        </div>
                        <span style={{ ...s.chooseTileName, color: sel ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{m.name}</span>
                        {sel && <div style={s.chooseCheck}>✓</div>}
                      </div>
                    );
                  })}
                </div>
              )}

              {r && r.type !== 'choose' && (
                <div style={s.preview}>
                  {r.type === 'split'
                    ? `Split among ${members.length} people · $${(u.unitPrice / members.length).toFixed(2)} each`
                    : `Assigned to ${members.find(m => m.id === r.memberId)?.name ?? '?'} · $${u.unitPrice.toFixed(2)}`}
                </div>
              )}
              {r?.type === 'choose' && (r.selectedIds?.size ?? 0) > 0 && (
                <div style={s.preview}>
                  Split between {r.selectedIds.size} {r.selectedIds.size === 1 ? 'person' : 'people'} · ${(u.unitPrice / r.selectedIds.size).toFixed(2)} each
                </div>
              )}
            </div>
          );
        })}

        {overclaimed.map((o, idx) => {
          const r = resolutions[`oc_${o.itemId}`];
          const isLast = idx === overclaimed.length - 1;
          return (
            <div key={o.itemId} style={{ ...s.itemBlock, borderBottom: isLast ? 'none' : '0.5px solid var(--border-color)' }}>
              <div style={s.itemTopRow}>
                <div style={s.itemLeft}>
                  <span style={s.itemName}>{o.itemName}</span>
                  <span style={s.overTag}>Overclaimed</span>
                </div>
                <span style={s.itemPrice}>${o.unitPrice.toFixed(2)}</span>
              </div>
              <div style={s.itemMeta}>Claimed by {o.claimerClaims.length} people — who actually had this unit?</div>
              <div style={s.chips}>
                {o.claimerClaims.map(({ claim, member }) => {
                  const sel = r?.keepClaimId === claim.id;
                  return (
                    <div key={claim.id} style={{ ...s.chip, ...(sel ? s.chipSel : {}) }} onClick={() => setOcRes(o.itemId, claim.id)}>
                      {member?.name ?? '?'}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: '16px', paddingBottom: '16px' }}>
        <button
          style={{ ...s.confirmBtn, opacity: allResolved && !saving ? 1 : 0.4 }}
          onClick={handleConfirm}
          disabled={!allResolved || saving}
        >
          {saving ? 'Saving…' : 'Confirm & generate breakdown →'}
        </button>
        {!allResolved && (
          <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            Assign all unclaimed items to continue
          </div>
        )}
      </div>
    </PageContainer>
  );
}

const s = {
  header: { display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px', flexWrap: 'nowrap' },
  autoResolveBtn: { fontSize: '12px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', color: 'var(--text-primary)', backgroundColor: 'var(--bg-secondary)', border: '0.5px solid var(--border-color)', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, alignSelf: 'center' },
  back: { background: 'none', border: 'none', fontSize: '20px', color: 'var(--text-primary)', cursor: 'pointer', padding: '0', lineHeight: 1.6 },
  title: { fontSize: '20px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  subtitle: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px' },
  helper: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '12px' },
  card: { border: '0.5px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' },
  itemBlock: { padding: '12px 14px', backgroundColor: 'var(--bg-primary)' },
  itemTopRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '4px' },
  itemLeft: { display: 'flex', alignItems: 'center', gap: '8px', flex: 1, flexWrap: 'wrap' },
  itemName: { fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  itemPrice: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', flexShrink: 0 },
  unclaimedTag: { fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', backgroundColor: '#FCEBEB', color: '#A32D2D', fontFamily: 'system-ui, -apple-system, sans-serif' },
  overTag: { fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', backgroundColor: '#FEF3DC', color: '#7A4800', fontFamily: 'system-ui, -apple-system, sans-serif' },
  itemMeta: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '10px', marginTop: '2px' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '4px' },
  chip: { padding: '5px 12px', borderRadius: '20px', fontSize: '12px', border: '0.5px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif', color: 'var(--text-primary)' },
  chipSel: { backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', borderColor: 'var(--text-primary)' },
  chooseGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 100px))', gap: '8px', marginTop: '8px', marginBottom: '4px' },
  chooseTile: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', padding: '10px 8px', borderRadius: '10px', cursor: 'pointer', position: 'relative' },
  chooseTileName: { fontSize: '11px', textAlign: 'center', fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80px' },
  chooseCheck: { position: 'absolute', top: '5px', right: '5px', width: '14px', height: '14px', borderRadius: '50%', backgroundColor: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: 'var(--bg-primary)', fontWeight: 700 },
  preview: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '6px' },
  confirmBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer' },
};

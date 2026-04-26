import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, writeBatch, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import PageContainer from '../components/PageContainer';

const AVATAR_COLORS = ['#5b9bd5', '#3dba8a', '#e8a03a', '#e07060', '#9070d0', '#4db8b8'];

function Avatar({ name, index, size = 28 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length],
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.42), fontWeight: 700, color: '#fff',
      flexShrink: 0, fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {name?.charAt(0)?.toUpperCase() ?? '?'}
    </div>
  );
}

export default function ManagePeople() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [members, setMembers] = useState([]);
  const [claims, setClaims] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [mergeTarget, setMergeTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      const [sessionSnap, membersSnap, claimsSnap, venuesSnap] = await Promise.all([
        getDoc(doc(db, 'sessions', sessionId)),
        getDocs(collection(db, 'sessions', sessionId, 'members')),
        getDocs(collection(db, 'sessions', sessionId, 'claims')),
        getDocs(collection(db, 'sessions', sessionId, 'venues')),
      ]);
      if (sessionSnap.exists()) setSession({ id: sessionSnap.id, ...sessionSnap.data() });
      setMembers(membersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setClaims(claimsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      const items = (await Promise.all(
        venuesSnap.docs.map(async vDoc => {
          const iSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items'));
          return iSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        })
      )).flat();
      setAllItems(items);
      setLoading(false);
    }
    load();
  }, [sessionId]);

  function memberStats(memberId) {
    const mc = claims.filter(c => c.memberId === memberId || c.sharedWith?.includes(memberId));
    const total = mc.reduce((sum, c) => {
      const item = allItems.find(i => i.id === c.itemId);
      if (!item) return sum;
      return sum + (c.type === 'shared'
        ? (item.unitPrice ?? 0) / (c.sharedWith?.length || 1)
        : (item.unitPrice ?? 0));
    }, 0);
    return { count: mc.length, total };
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    const deletedId = deleteTarget.id;
    try {
      const batch = writeBatch(db);

      // Delete claims where this member is the primary claimer
      claims.filter(c => c.memberId === deletedId).forEach(c => {
        batch.delete(doc(db, 'sessions', sessionId, 'claims', c.id));
      });

      // Clean up sharedWith arrays in other claims
      claims
        .filter(c => c.memberId !== deletedId && c.sharedWith?.includes(deletedId))
        .forEach(c => {
          const newSharedWith = c.sharedWith.filter(id => id !== deletedId);
          if (newSharedWith.length === 0) {
            batch.delete(doc(db, 'sessions', sessionId, 'claims', c.id));
          } else {
            batch.update(doc(db, 'sessions', sessionId, 'claims', c.id), { sharedWith: newSharedWith });
          }
        });

      batch.delete(doc(db, 'sessions', sessionId, 'members', deletedId));
      await batch.commit();

      setMembers(p => p.filter(m => m.id !== deletedId));
      setClaims(p =>
        p
          .filter(c => c.memberId !== deletedId)
          .map(c => {
            if (!c.sharedWith?.includes(deletedId)) return c;
            const newSharedWith = c.sharedWith.filter(id => id !== deletedId);
            return newSharedWith.length === 0 ? null : { ...c, sharedWith: newSharedWith };
          })
          .filter(Boolean)
      );
      setDeleteTarget(null);
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    document.title = session?.name ? `Manage people · ${session.name} — Unfuck` : 'Unfuck';
  }, [session?.name]);

  if (loading) return null;

  return (
    <PageContainer>
      <div style={st.header}>
        <button style={st.back} onClick={() => navigate(-1)}>←</button>
        <div>
          <div style={st.title}>Manage people</div>
          {session && <div style={st.subtitle}>{session.name}</div>}
        </div>
      </div>

      <div style={st.helper}>
        Deleting a person returns all their claims to unclaimed. Merging combines two accounts.
      </div>

      <div style={st.memberList}>
        {members.map((member, idx) => {
          const stats = memberStats(member.id);
          return (
            <div
              key={member.id}
              style={{ ...st.memberRow, borderBottom: idx < members.length - 1 ? '0.5px solid var(--border-color)' : 'none' }}
            >
              <Avatar name={member.name} index={idx} />
              <div style={st.memberInfo}>
                <div style={st.memberName}>{member.name}</div>
                <div style={st.memberStats}>{stats.count} items · ${stats.total.toFixed(2)}</div>
              </div>
              <div style={st.memberActions}>
                <button style={st.mergeBtn} onClick={() => setMergeTarget(member)}>Merge</button>
                <button style={st.deleteBtn} onClick={() => setDeleteTarget(member)}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Delete confirmation sheet */}
      {deleteTarget && (
        <>
          <div style={st.backdrop} onClick={() => !deleting && setDeleteTarget(null)} />
          <div style={st.sheet}>
            <div style={st.sheetHandle} />
            <div style={st.sheetTitle}>Delete {deleteTarget.name}?</div>
            <div style={st.sheetSubtitle}>Their claims will return to unclaimed.</div>
            <div style={st.sheetBtns}>
              <button style={st.cancelBtn} onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
              <button
                style={{ ...st.confirmBtn, backgroundColor: '#e24b4a', opacity: deleting ? 0.6 : 1 }}
                onClick={handleDeleteConfirm}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Merge picker sheet */}
      {mergeTarget && (
        <>
          <div style={st.backdrop} onClick={() => setMergeTarget(null)} />
          <div style={st.sheet}>
            <div style={st.sheetHandle} />
            <div style={st.sheetTitle}>Who do you want to merge {mergeTarget.name} with?</div>
            {members
              .filter(m => m.id !== mergeTarget.id)
              .map((member, idx) => (
                <div
                  key={member.id}
                  style={st.sheetMemberRow}
                  onClick={() => {
                    setMergeTarget(null);
                    navigate(`/session/${sessionId}/merge-people?from=${mergeTarget.id}&into=${member.id}`);
                  }}
                >
                  <Avatar name={member.name} index={members.indexOf(member)} />
                  <span style={st.sheetMemberName}>{member.name}</span>
                </div>
              ))}
          </div>
        </>
      )}
    </PageContainer>
  );
}

const st = {
  header: { display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' },
  back: { background: 'none', border: 'none', fontSize: '20px', color: 'var(--text-primary)', cursor: 'pointer', padding: '0', lineHeight: 1.6 },
  title: { fontSize: '20px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  subtitle: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px' },
  helper: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '16px' },
  memberList: { border: '0.5px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' },
  memberRow: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', backgroundColor: 'var(--bg-primary)' },
  memberInfo: { flex: 1, minWidth: 0 },
  memberName: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  memberStats: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '1px' },
  memberActions: { display: 'flex', gap: '6px', flexShrink: 0 },
  deleteBtn: { fontSize: '11px', color: '#e24b4a', border: '0.5px solid #e24b4a', borderRadius: '6px', padding: '4px 10px', backgroundColor: 'transparent', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' },
  mergeBtn: { fontSize: '11px', color: 'var(--text-secondary)', border: '0.5px solid var(--border-color)', borderRadius: '6px', padding: '4px 10px', backgroundColor: 'transparent', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' },
  backdrop: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100 },
  sheet: { position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101, backgroundColor: 'var(--bg-primary)', borderRadius: '20px 20px 0 0', padding: '12px 20px 40px', maxHeight: '80vh', overflowY: 'auto' },
  sheetHandle: { width: '36px', height: '4px', borderRadius: '2px', backgroundColor: 'var(--border-color)', margin: '0 auto 16px' },
  sheetTitle: { fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '4px' },
  sheetSubtitle: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '16px' },
  sheetMemberRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderBottom: '0.5px solid var(--border-color)', cursor: 'pointer' },
  sheetMemberName: { fontSize: '14px', color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  sheetBtns: { display: 'flex', gap: '10px' },
  cancelBtn: { flex: 1, padding: '12px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer' },
  confirmBtn: { flex: 1, padding: '12px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' },
};

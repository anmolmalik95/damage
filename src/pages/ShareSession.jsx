import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { doc, getDoc, getDocs, updateDoc, collection, addDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useToast } from '../context/ToastContext';
import PageContainer from '../components/PageContainer';

const BASE_URL = 'https://unfuck.malik.codes/s';
const membersDraftKey = id => `draft_share_${id}`;

export default function ShareSession() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const currentMemberId = localStorage.getItem(`member_${sessionId}`);
  const currentMemberName = localStorage.getItem(`memberName_${sessionId}`);

  const [session, setSession] = useState(null);
  const [sessionTotal, setSessionTotal] = useState(() => location.state?.total ?? 0);
  const [billPayer, setBillPayer] = useState(currentMemberId);
  const [newName, setNewName] = useState('');
  const [members, setMembers] = useState(() => {
    try {
      const draft = JSON.parse(sessionStorage.getItem(membersDraftKey(sessionId)));
      if (Array.isArray(draft)) return draft;
    } catch {}
    return [];
  });
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const nameInputRef = useRef(null);
  const instrDebounceRef = useRef(null);
  const { showToast } = useToast();

  useEffect(() => {
    document.title = session?.name ? `Share · ${session.name} — Unfuck` : 'Unfuck';
  }, [session?.name]);

  useEffect(() => {
    async function load() {
      const snap = await getDoc(doc(db, 'sessions', sessionId));
      if (!snap.exists()) return;
      const data = snap.data();
      setSession(data);
      if (data.billPayer) setBillPayer(data.billPayer);
      if (data.paymentInstructions != null) setPaymentInstructions(data.paymentInstructions);

      if (!location.state?.total) {
        const vSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues'));
        let total = 0;
        for (const vDoc of vSnap.docs) {
          const vData = vDoc.data();
          const iSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items'));
          const itemsTotal = iSnap.docs.reduce((s, d) => {
            const item = d.data();
            return s + (item.unitPrice ?? 0) * (item.quantity ?? 1);
          }, 0);
          total += itemsTotal + (vData.gstAmount || 0) + (vData.serviceChargeAmount || 0);
        }
        setSessionTotal(total);
      }
    }
    load();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  function sessionUrl() { return `${BASE_URL}/${sessionId}`; }

  async function handleCopy() {
    const url = sessionUrl();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    showToast('Copied!', 'success');
  }

  async function handleAddMember() {
    const name = newName.trim();
    if (!name) return;
    const ref = await addDoc(collection(db, 'sessions', sessionId, 'members'), {
      name, joinedAt: serverTimestamp(), isCreator: false,
    });
    setMembers(prev => {
      const updated = [...prev, { id: ref.id, name }];
      sessionStorage.setItem(membersDraftKey(sessionId), JSON.stringify(updated));
      return updated;
    });
    setNewName('');
    setTimeout(() => nameInputRef.current?.focus(), 50);
  }

  function handleInstructionsChange(val) {
    if (val.length > 200) return;
    setPaymentInstructions(val);
    clearTimeout(instrDebounceRef.current);
    instrDebounceRef.current = setTimeout(async () => {
      try { await updateDoc(doc(db, 'sessions', sessionId), { paymentInstructions: val }); }
      catch (err) { console.error(err); }
    }, 1000);
  }

  async function handleRemoveMember(memberId) {
    await deleteDoc(doc(db, 'sessions', sessionId, 'members', memberId));
    setMembers(prev => {
      const updated = prev.filter(m => m.id !== memberId);
      sessionStorage.setItem(membersDraftKey(sessionId), JSON.stringify(updated));
      return updated;
    });
  }

  async function handleSetBillPayer(memberId) {
    setBillPayer(memberId);
    try {
      await updateDoc(doc(db, 'sessions', sessionId), { billPayer: memberId });
    } catch (err) { console.error(err); }
  }

  async function handleOpen() {
    setError('');
    setOpening(true);
    try {
      await updateDoc(doc(db, 'sessions', sessionId), { status: 'open' });
      sessionStorage.removeItem(membersDraftKey(sessionId));
      sessionStorage.removeItem(`draft_confirm_${sessionId}`);
      navigate(`/session/${sessionId}/claim`);
    } catch (err) {
      setError('Something went wrong — please try again.');
      console.error(err);
      setOpening(false);
    }
  }

  const displayTotal = sessionTotal > 0 ? ` · $${sessionTotal.toFixed(2)}` : '';
  const allChipMembers = [
    { id: currentMemberId, name: currentMemberName ?? session?.creatorName ?? 'You' },
    ...members,
  ];

  return (
    <PageContainer>
      <div style={styles.header}>
        <button style={styles.back} onClick={() => navigate(`/session/${sessionId}/confirm`)}>←</button>
        <div>
          <div style={styles.title}>Share with the group</div>
          {session && <div style={styles.subtitle}>{session.name}{displayTotal}</div>}
        </div>
      </div>

      {/* Link card */}
      <div style={styles.linkCard}>
        <div style={styles.linkIcon}>🔗</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.linkUrl}>{sessionUrl()}</div>
          <div style={styles.linkHint}>Send this to your group — they can join and claim their items.</div>
        </div>
      </div>

      <button style={styles.btnPrimary} onClick={handleCopy}>
        Copy link to clipboard
      </button>

      {/* Bill payer — before the divider */}
      <div style={styles.billPayerSection}>
        <div style={styles.billPayerTitle}>Who paid the bill?</div>
        <div style={styles.billPayerSubtitle}>Select the person who fronted the money.</div>
        <div style={styles.chipRow}>
          {allChipMembers.map(m => {
            const sel = billPayer === m.id;
            return (
              <button
                key={m.id}
                style={{ ...styles.chip, ...(sel ? styles.chipSel : {}) }}
                onClick={() => handleSetBillPayer(m.id)}
              >
                {m.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Payment instructions */}
      <div style={styles.instrSection}>
        <div style={styles.instrLabel}>Payment instructions</div>
        <div style={styles.instrSub}>e.g. "PayNow to +65 9xxx xxxx — save to contacts as John"</div>
        <textarea
          style={styles.instrTextarea}
          value={paymentInstructions}
          onChange={e => handleInstructionsChange(e.target.value)}
          placeholder="Leave blank to skip..."
          rows={3}
          maxLength={200}
        />
        <div style={styles.instrCounter}>{paymentInstructions.length}/200</div>
      </div>

      {/* Divider */}
      <div style={styles.dividerRow}>
        <div style={styles.dividerLine} />
        <span style={styles.dividerText}>Or add people manually</span>
        <div style={styles.dividerLine} />
      </div>

      {/* Manual add */}
      <div style={styles.addRow}>
        <input
          ref={nameInputRef}
          style={styles.nameInput}
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Add name..."
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddMember(); } }}
        />
        <button style={styles.addBtn} onClick={handleAddMember}>Add</button>
      </div>

      {members.length > 0 && (
        <div style={styles.memberList}>
          {members.map(m => (
            <div key={m.id} style={styles.memberRow}>
              <span style={styles.memberName}>{m.name}</span>
              <button style={styles.removeBtn} onClick={() => handleRemoveMember(m.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.openButtonWrap}>
        <button
          style={{ ...styles.btnPrimary, opacity: opening ? 0.6 : 1 }}
          onClick={handleOpen}
          disabled={opening}
        >
          {opening ? 'Opening...' : 'Open session →'}
        </button>
      </div>
    </PageContainer>
  );
}

const styles = {
  header: { display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '24px' },
  back: { background: 'none', border: 'none', fontSize: '20px', color: 'var(--text-primary)', cursor: 'pointer', padding: '0', lineHeight: 1.6 },
  title: { fontSize: '20px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  subtitle: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px' },
  linkCard: { display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', padding: '14px', marginBottom: '12px' },
  linkIcon: { fontSize: '20px', flexShrink: 0 },
  linkUrl: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '2px' },
  linkHint: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  btnPrimary: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', borderRadius: '8px', cursor: 'pointer' },
  dividerRow: { display: 'flex', alignItems: 'center', gap: '10px', margin: '20px 0' },
  dividerLine: { flex: 1, height: '0.5px', backgroundColor: 'var(--border-color)' },
  dividerText: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', whiteSpace: 'nowrap' },
  addRow: { display: 'flex', gap: '8px', marginBottom: '12px' },
  nameInput: { flex: 1, padding: '10px 12px', fontSize: '14px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '8px', outline: 'none', colorScheme: 'light dark' },
  addBtn: { padding: '10px 16px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', borderRadius: '8px', cursor: 'pointer', flexShrink: 0 },
  memberList: { display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '16px' },
  memberRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px' },
  memberName: { fontSize: '14px', color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  removeBtn: { background: 'none', border: 'none', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px' },
  billPayerSection: { marginTop: '20px', marginBottom: '8px' },
  billPayerTitle: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '8px' },
  billPayerSubtitle: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '12px' },
  chipRow: { display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' },
  chip: { padding: '8px 16px', borderRadius: '20px', fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif', border: '0.5px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 },
  chipSel: { backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', border: '0.5px solid var(--text-primary)' },
  openButtonWrap: { marginTop: '16px' },
  error: { fontSize: '12px', color: 'var(--color-danger)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '8px' },
  instrSection: { marginTop: '20px', marginBottom: '8px' },
  instrLabel: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '4px' },
  instrSub: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '8px' },
  instrTextarea: { width: '100%', padding: '10px 12px', fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '8px', outline: 'none', resize: 'none', boxSizing: 'border-box', colorScheme: 'light dark' },
  instrCounter: { fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', textAlign: 'right', marginTop: '4px' },
};

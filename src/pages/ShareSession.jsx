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

  // Who paid state — starts null (no autofill)
  const [billPayer, setBillPayer] = useState(null);
  const [multiPayer, setMultiPayer] = useState(false);

  // Per-venue payers (non-transport)
  const [venues, setVenues] = useState([]);
  const [venuePayers, setVenuePayers] = useState({});

  // Transport
  const [transportVenueId, setTransportVenueId] = useState(null);
  const [transportItems, setTransportItems] = useState([]);
  const [allCabPayer, setAllCabPayer] = useState(null);
  const [cabPayers, setCabPayers] = useState({});
  const [cabsExpanded, setCabsExpanded] = useState(false);

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
      if (data.multiPayer) setMultiPayer(true);
      if (data.paymentInstructions != null) setPaymentInstructions(data.paymentInstructions);

      if (!location.state?.total) {
        const vSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues'));
        let total = 0;
        for (const vDoc of vSnap.docs) {
          const vData = vDoc.data();
          const iSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items'));
          total += iSnap.docs.reduce((s, d) => {
            const item = d.data();
            return s + (item.unitPrice ?? 0) * (item.quantity ?? 1);
          }, 0) + (vData.gstAmount || 0) + (vData.serviceChargeAmount || 0);
        }
        setSessionTotal(total);
      }
    }
    load();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function loadVenues() {
      const vSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues'));
      const allVenues = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const nonTransport = allVenues.filter(v => v.name !== 'Transport' && !v.isTransport);
      const transport = allVenues.find(v => v.name === 'Transport' || v.isTransport);

      const sorted = [...nonTransport].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setVenues(sorted);

      const initial = {};
      sorted.forEach(v => { if (v.billPayer) initial[v.id] = v.billPayer; });
      setVenuePayers(initial);

      if (transport) {
        setTransportVenueId(transport.id);
        const iSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues', transport.id, 'items'));
        const items = iSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setTransportItems(items);
        // Pre-fill per-cab payers if already set
        const cabInitial = {};
        items.forEach(item => { if (item.billPayer) cabInitial[item.id] = item.billPayer; });
        if (Object.keys(cabInitial).length > 0) {
          setCabPayers(cabInitial);
        }
        // Pre-fill allCabPayer if all cabs have same payer
        const uniquePayers = [...new Set(Object.values(cabInitial))];
        if (uniquePayers.length === 1) setAllCabPayer(uniquePayers[0]);
      }
    }
    loadVenues();
  }, [sessionId]);

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
      try {
        await updateDoc(doc(db, 'sessions', sessionId), { paymentInstructions: val });
        if (billPayer) {
          await updateDoc(doc(db, 'sessions', sessionId, 'members', billPayer), { paymentInstructions: val }).catch(() => {});
        }
      } catch (err) { console.error(err); }
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

  async function handleOpen() {
    setError('');
    setOpening(true);
    try {
      if (multiPayer) {
        await updateDoc(doc(db, 'sessions', sessionId), { status: 'open', multiPayer: true });
        // Write per-venue payers
        await Promise.all(
          venues
            .filter(v => venuePayers[v.id])
            .map(v => updateDoc(doc(db, 'sessions', sessionId, 'venues', v.id), { billPayer: venuePayers[v.id] }))
        );
        // Write per-cab payers
        if (transportVenueId && transportItems.length > 0) {
          if (cabsExpanded) {
            await Promise.all(
              transportItems
                .filter(item => cabPayers[item.id])
                .map(item => updateDoc(doc(db, 'sessions', sessionId, 'venues', transportVenueId, 'items', item.id), { billPayer: cabPayers[item.id] }))
            );
          } else if (allCabPayer) {
            await Promise.all(
              transportItems.map(item =>
                updateDoc(doc(db, 'sessions', sessionId, 'venues', transportVenueId, 'items', item.id), { billPayer: allCabPayer })
              )
            );
          }
        }
      } else {
        // Single payer: write to session AND all venues
        await updateDoc(doc(db, 'sessions', sessionId), { status: 'open', billPayer, multiPayer: false });
        const allVenueSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues'));
        await Promise.all(allVenueSnap.docs.map(d => updateDoc(d.ref, { billPayer })));
      }
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

  const transportCovered = transportItems.length === 0 ||
    (cabsExpanded ? transportItems.every(item => !!cabPayers[item.id]) : !!allCabPayer);

  const canOpen = multiPayer
    ? venues.every(v => !!venuePayers[v.id]) && transportCovered
    : !!billPayer;

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

      {/* Who paid */}
      <div style={styles.billPayerSection}>
        <div style={styles.billPayerTitle}>Who paid the bill?</div>

        {!multiPayer ? (
          <>
            <div style={styles.chipRow}>
              {allChipMembers.map(m => {
                const sel = billPayer === m.id;
                return (
                  <button
                    key={m.id}
                    style={{ ...styles.chip, ...(sel ? styles.chipSel : {}) }}
                    onClick={() => setBillPayer(m.id)}
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
            <button style={styles.multiPayerLink} onClick={() => setMultiPayer(true)}>
              Multiple people paid for different things ›
            </button>
          </>
        ) : (
          <>
            <button style={styles.multiPayerLink} onClick={() => { setMultiPayer(false); setVenuePayers({}); setCabPayers({}); setCabsExpanded(false); setAllCabPayer(null); }}>
              ← Single payer
            </button>
            <div style={styles.venuePayersSection}>
              {venues.map(venue => (
                <div key={venue.id} style={styles.venuePayerBlock}>
                  <div style={styles.venuePayerLabel}>{venue.name}</div>
                  <div style={styles.chipRow}>
                    {allChipMembers.map(m => {
                      const sel = venuePayers[venue.id] === m.id;
                      return (
                        <button
                          key={m.id}
                          style={{ ...styles.chip, ...(sel ? styles.chipSel : {}) }}
                          onClick={() => setVenuePayers(p => ({ ...p, [venue.id]: m.id }))}
                        >
                          {m.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {transportItems.length > 0 && (
                <div style={styles.venuePayerBlock}>
                  <div style={styles.venuePayerLabel}>Transport</div>
                  {!cabsExpanded ? (
                    <>
                      <div style={styles.chipRow}>
                        {allChipMembers.map(m => {
                          const sel = allCabPayer === m.id;
                          return (
                            <button
                              key={m.id}
                              style={{ ...styles.chip, ...(sel ? styles.chipSel : {}) }}
                              onClick={() => setAllCabPayer(m.id)}
                            >
                              {m.name}
                            </button>
                          );
                        })}
                      </div>
                      <button style={styles.expandCabsLink} onClick={() => setCabsExpanded(true)}>
                        Different people paid for different cabs ›
                      </button>
                    </>
                  ) : (
                    <>
                      {transportItems.map(item => (
                        <div key={item.id} style={{ marginBottom: '12px' }}>
                          <div style={styles.cabItemLabel}>{item.name}</div>
                          <div style={styles.chipRow}>
                            {allChipMembers.map(m => {
                              const sel = cabPayers[item.id] === m.id;
                              return (
                                <button
                                  key={m.id}
                                  style={{ ...styles.chip, ...(sel ? styles.chipSel : {}) }}
                                  onClick={() => setCabPayers(p => ({ ...p, [item.id]: m.id }))}
                                >
                                  {m.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      <button style={styles.expandCabsLink} onClick={() => { setCabsExpanded(false); setCabPayers({}); }}>
                        ← All cabs same payer
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Payment instructions — single-payer mode only */}
      {!multiPayer && (
        <div style={styles.instrSection}>
          <div style={styles.instrLabel}>Payment instructions</div>
          <div style={styles.instrSub}>e.g. "PayNow to +65 9xxx xxxx — save to contacts as John"</div>
          <textarea
            style={styles.instrTextarea}
            value={paymentInstructions}
            onChange={e => handleInstructionsChange(e.target.value)}
            placeholder="PayNow to 9XXX XXXX"
            rows={3}
            maxLength={200}
          />
          <div style={styles.instrCounter}>{paymentInstructions.length}/200</div>
        </div>
      )}

      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.openButtonWrap}>
        <button
          style={{ ...styles.btnPrimary, opacity: (opening || !canOpen) ? 0.4 : 1 }}
          onClick={handleOpen}
          disabled={opening || !canOpen}
        >
          {opening ? 'Opening...' : 'Open session →'}
        </button>
        {!canOpen && !opening && (
          <div style={styles.tipText}>
            {multiPayer ? 'Select a bill payer for each venue to continue' : 'Select who paid the bill to continue'}
          </div>
        )}
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
  billPayerTitle: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '12px' },
  multiPayerLink: { background: 'none', border: 'none', padding: '0', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer', textDecoration: 'underline', marginTop: '10px', display: 'block' },
  chipRow: { display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' },
  chip: { padding: '8px 16px', borderRadius: '20px', fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif', border: '0.5px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 },
  chipSel: { backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', border: '0.5px solid var(--text-primary)' },
  venuePayersSection: { display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' },
  venuePayerBlock: {},
  venuePayerLabel: { fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' },
  expandCabsLink: { background: 'none', border: 'none', padding: '0', fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer', textDecoration: 'underline', marginTop: '8px', display: 'block' },
  cabItemLabel: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '6px' },
  openButtonWrap: { marginTop: '20px' },
  tipText: { textAlign: 'center', marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  error: { fontSize: '12px', color: 'var(--color-danger)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '8px' },
  instrSection: { marginTop: '20px', marginBottom: '8px' },
  instrLabel: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '4px' },
  instrSub: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '8px' },
  instrTextarea: { width: '100%', padding: '10px 12px', fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '8px', outline: 'none', resize: 'none', boxSizing: 'border-box', colorScheme: 'light dark' },
  instrCounter: { fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', textAlign: 'right', marginTop: '4px' },
};

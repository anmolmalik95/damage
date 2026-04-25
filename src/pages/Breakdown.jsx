import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import SkeletonBlock from '../components/SkeletonBlock';
import {
  collection, doc, getDocs, onSnapshot, setDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import PageContainer from '../components/PageContainer';

const AVATAR_COLORS = ['#5b9bd5', '#3dba8a', '#e8a03a', '#e07060', '#9070d0', '#4db8b8'];

export default function Breakdown() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();

  const currentMemberId = localStorage.getItem(`member_${sessionId}`);
  const isReadOnly = !currentMemberId;

  const [session, setSession] = useState(null);
  const [members, setMembers] = useState([]);
  const [venues, setVenues] = useState([]);
  const [claims, setClaims] = useState([]);
  const [paidStatus, setPaidStatus] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedCards, setExpandedCards] = useState(() => new Set(currentMemberId ? [currentMemberId] : []));
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [closeStep, setCloseStep] = useState(0);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instrSheetOpen, setInstrSheetOpen] = useState(false);
  const [instrSheetDraft, setInstrSheetDraft] = useState('');
  const [billPayersSheetOpen, setBillPayersSheetOpen] = useState(false);
  const [venueBillPayers, setVenueBillPayers] = useState({});

  useEffect(() => {
    document.title = session?.name ? `Breakdown · ${session.name} — Unfuck` : 'Unfuck';
  }, [session?.name]);

  useEffect(() => {
    if (!currentMemberId) {
      navigate(`/s/${sessionId}`, { replace: true, state: { returnTo: 'breakdown' } });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleCard(memberId) {
    setExpandedCards(p => { const n = new Set(p); n.has(memberId) ? n.delete(memberId) : n.add(memberId); return n; });
  }

  const loadStateRef = useRef({ session: false, venues: false });
  function checkLoaded() {
    if (loadStateRef.current.session && loadStateRef.current.venues) setLoading(false);
  }

  useEffect(() => {
    const unsubs = [
      onSnapshot(doc(db, 'sessions', sessionId), snap => {
        if (snap.exists()) {
          const data = snap.data();
          setSession({ id: snap.id, ...data });
          setPaymentInstructions(data.paymentInstructions ?? '');
          if (!loadStateRef.current.session) { loadStateRef.current.session = true; checkLoaded(); }
        }
      }),
      onSnapshot(collection(db, 'sessions', sessionId, 'members'), snap => {
        setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }),
      onSnapshot(collection(db, 'sessions', sessionId, 'claims'), snap => {
        setClaims(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }),
      onSnapshot(collection(db, 'sessions', sessionId, 'breakdown'), snap => {
        const st = {};
        snap.docs.forEach(d => { st[d.id] = d.data(); });
        setPaidStatus(st);
      }),
    ];

    getDocs(collection(db, 'sessions', sessionId, 'venues')).then(async venuesSnap => {
      const venueList = await Promise.all(
        venuesSnap.docs.map(async vDoc => {
          const itemsSnap = await getDocs(
            collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items')
          );
          return { id: vDoc.id, ...vDoc.data(), items: itemsSnap.docs.map(d => ({ id: d.id, ...d.data() })) };
        })
      );
      setVenues(venueList);
      const initial = {};
      venueList.forEach(v => { if (v.billPayer) initial[v.id] = v.billPayer; });
      setVenueBillPayers(initial);
      loadStateRef.current.venues = true;
      checkLoaded();
    });

    return () => unsubs.forEach(u => u());
  }, [sessionId]);

  // Compute per-venue per-member breakdown data
  function computeVenueData(venue) {
    const memberSubtotals = {};
    const claimsForItem = {};

    for (const item of venue.items) {
      const itemClaims = claims.filter(c => c.itemId === item.id);
      claimsForItem[item.id] = itemClaims;
      for (const claim of itemClaims) {
        if (claim.type === 'whole') {
          memberSubtotals[claim.memberId] = (memberSubtotals[claim.memberId] || 0) + (item.unitPrice ?? 0);
        } else if (claim.type === 'shared') {
          const n = claim.sharedWith?.length || 1;
          (claim.sharedWith || []).forEach(mid => {
            memberSubtotals[mid] = (memberSubtotals[mid] || 0) + (item.unitPrice ?? 0) / n;
          });
        }
      }
    }

    const totalSub = Object.values(memberSubtotals).reduce((a, b) => a + b, 0);
    const result = {};

    for (const [memberId, sub] of Object.entries(memberSubtotals)) {
      if (!sub) continue;
      const ratio = totalSub > 0 ? sub / totalSub : 0;
      const gst = ratio * (venue.gstAmount || 0);
      const sc = ratio * (venue.serviceChargeAmount || 0);

      const itemRows = [];
      for (const item of venue.items) {
        const myWhole = (claimsForItem[item.id] || []).filter(c => c.type === 'whole' && c.memberId === memberId);
        const myShared = (claimsForItem[item.id] || []).filter(c => c.type === 'shared' && c.sharedWith?.includes(memberId));
        if (myWhole.length > 0) {
          itemRows.push({ name: item.name, amount: (item.unitPrice ?? 0) * myWhole.length, count: myWhole.length });
        }
        for (const claim of myShared) {
          const otherNames = (claim.sharedWith || [])
            .filter(mid => mid !== memberId)
            .map(mid => members.find(m => m.id === mid)?.name ?? '?');
          itemRows.push({ name: item.name, amount: (item.unitPrice ?? 0) / (claim.sharedWith?.length || 1), otherNames });
        }
      }

      result[memberId] = { subtotal: sub, gst, sc, total: sub + gst + sc, itemRows };
    }
    return result;
  }

  async function togglePaid(memberId) {
    const cur = paidStatus[memberId]?.paid ?? false;
    await setDoc(doc(db, 'sessions', sessionId, 'breakdown', memberId), {
      paid: !cur,
      paidAt: !cur ? serverTimestamp() : null,
    });
  }

  async function handleSelfReportPaid() {
    const myData = paidStatus[currentMemberId] ?? {};
    const isPaid = myData.paid ?? false;
    const isSelfReported = myData.selfReported ?? false;
    if (isPaid && isSelfReported) {
      await setDoc(doc(db, 'sessions', sessionId, 'breakdown', currentMemberId), {
        paid: false, selfReported: false, paidAt: null,
      });
    } else {
      await setDoc(doc(db, 'sessions', sessionId, 'breakdown', currentMemberId), {
        paid: true, selfReported: true, paidAt: serverTimestamp(),
      });
    }
  }

  async function handleClose() {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'sessions', sessionId), { status: 'closed', closedAt: serverTimestamp() });
      setCloseStep(0);
    } catch (err) { console.error(err); }
    setSaving(false);
  }

  async function handleSaveInstructions() {
    try {
      await updateDoc(doc(db, 'sessions', sessionId), { paymentInstructions });
      setEditingInstructions(false);
      showToast('Payment instructions saved', 'success');
    } catch (err) { console.error(err); }
  }

  async function handleSaveInstrSheet() {
    try {
      await updateDoc(doc(db, 'sessions', sessionId), { paymentInstructions: instrSheetDraft });
      if (session?.billPayer) {
        await updateDoc(doc(db, 'sessions', sessionId, 'members', session.billPayer), { paymentInstructions: instrSheetDraft }).catch(() => {});
      }
      setPaymentInstructions(instrSheetDraft);
      setInstrSheetOpen(false);
      showToast('Payment instructions saved', 'success');
    } catch (err) { console.error(err); }
  }

  async function handleReopen() {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'sessions', sessionId), { status: 'open' });
      navigate(`/session/${sessionId}/claim`);
    } catch (err) { console.error(err); }
    setSaving(false);
  }

  async function handleSetVenueBillPayer(venueId, memberId) {
    setVenueBillPayers(prev => ({ ...prev, [venueId]: memberId }));
    try {
      await updateDoc(doc(db, 'sessions', sessionId, 'venues', venueId), { billPayer: memberId });
    } catch (err) { console.error(err); }
  }

  async function handleRenameSave() {
    const name = renameValue.trim();
    if (!name) return;
    try {
      await updateDoc(doc(db, 'sessions', sessionId), { name });
      setRenameOpen(false);
      showToast('Session renamed', 'success');
    } catch (err) { console.error(err); }
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(`https://unfuck.malik.codes/session/${sessionId}/breakdown`);
    showToast('Copied!', 'success');
  }

  if (loading || !session) return (
    <PageContainer>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '24px' }}>
        <SkeletonBlock width="20px" height="20px" borderRadius="4px" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <SkeletonBlock width="120px" height="20px" />
          <SkeletonBlock width="180px" height="13px" />
        </div>
      </div>
      {[0,1,2].map(i => (
        <div key={i} style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', padding: '12px', marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <SkeletonBlock width="24px" height="24px" borderRadius="50%" />
              <SkeletonBlock width="90px" height="15px" />
            </div>
            <SkeletonBlock width="50px" height="17px" />
          </div>
          <SkeletonBlock width="70%" height="13px" />
          <SkeletonBlock width="50%" height="13px" />
        </div>
      ))}
    </PageContainer>
  );

  const currentMember = members.find(m => m.id === currentMemberId);
  const isBillPayer = !isReadOnly && !!session.billPayer && session.billPayer === currentMemberId;
  const isAdmin = !isReadOnly && (currentMember?.isCreator === true || isBillPayer);
  const isClosed = session.status === 'closed';
  const totalBill = venues.reduce((sum, v) => {
    const itemsTotal = v.items.reduce((s, i) => s + (i.unitPrice ?? 0) * (i.quantity ?? 1), 0);
    return sum + itemsTotal + (v.gstAmount || 0) + (v.serviceChargeAmount || 0);
  }, 0);

  // Pre-compute all venue data for rendering
  const venueDataMap = venues.map(v => ({ venue: v, memberData: computeVenueData(v) }));

  // Grand totals with penny-rounding adjustment
  const grandTotals = {};
  for (const { memberData } of venueDataMap) {
    for (const [mid, d] of Object.entries(memberData)) {
      grandTotals[mid] = (grandTotals[mid] || 0) + d.total;
    }
  }
  const computedSum = Object.values(grandTotals).reduce((a, b) => a + b, 0);
  const discrepancyCents = Math.round((totalBill - computedSum) * 100);
  if (discrepancyCents !== 0 && members.length > 0) {
    const firstMember = [...members].sort((a, b) => a.name.localeCompare(b.name))[0];
    if (grandTotals[firstMember.id] !== undefined) {
      grandTotals[firstMember.id] += discrepancyCents / 100;
    }
  }

  // Build debt transactions: single-payer or multi-payer debt graph
  function buildDebtTransactions() {
    if (!session.multiPayer) return [];

    const netBalances = {};
    for (const { venue, memberData } of venueDataMap) {
      const vBillPayer = venue.billPayer;
      if (!vBillPayer) continue;
      for (const [memberId, data] of Object.entries(memberData)) {
        if (memberId === vBillPayer) continue;
        netBalances[memberId] = (netBalances[memberId] || 0) - data.total;
        netBalances[vBillPayer] = (netBalances[vBillPayer] || 0) + data.total;
      }
    }
    const people = Object.entries(netBalances).map(([id, bal]) => ({ id, bal }));
    const transactions = [];
    for (let i = 0; i < 500; i++) {
      const creditor = people.reduce((a, b) => b.bal > a.bal ? b : a);
      const debtor = people.reduce((a, b) => b.bal < a.bal ? b : a);
      if (creditor.bal < 0.005 || debtor.bal > -0.005) break;
      const amount = Math.min(creditor.bal, -debtor.bal);
      transactions.push({ fromId: debtor.id, toId: creditor.id, amount: Math.round(amount * 100) / 100 });
      creditor.bal -= amount;
      debtor.bal += amount;
    }
    return transactions;
  }

  const debtTransactions = buildDebtTransactions();

  const memberIndex = Object.fromEntries(members.map((m, i) => [m.id, i]));
  const sortedVenueDataMap = [...venueDataMap].sort((a, b) => {
    const ao = a.venue.order ?? (a.venue.isTransport || a.venue.name === 'Transport' ? 9999 : 0);
    const bo = b.venue.order ?? (b.venue.isTransport || b.venue.name === 'Transport' ? 9999 : 0);
    return ao - bo;
  });

  return (
    <PageContainer>
      {/* Header */}
      <div style={s.header}>
        <button style={s.back} onClick={() => navigate(location.state?.from === 'claim' ? `/session/${sessionId}/claim` : '/existing-sessions')}>←</button>
        <div style={s.headerText}>
          <div style={s.title}>Bill breakdown</div>
          <div style={s.subtitle}>{session.name} · ${totalBill.toFixed(2)}</div>
        </div>
        <button style={s.menuBtn} onClick={() => setMenuOpen(true)}>•••</button>
      </div>

      {/* Status badge + helper */}
      <div style={s.statusRow}>
        <span style={isClosed ? s.closedBadge : s.lockedBadge}>
          {isClosed ? 'Closed' : '🔒 Locked'}
        </span>
        <span style={s.taxHelper}>Tax split proportionally per venue.</span>
        <button style={s.receiptsBtn} onClick={() => navigate(`/session/${sessionId}/receipts`)}>
          Receipts 🧾
        </button>
      </div>

      {/* Single-payer: Pay [Name] / You owe $X card */}
      {!isReadOnly && !session.multiPayer && session.billPayer && currentMemberId !== session.billPayer && (
        <div style={s.owesCard}>
          <div style={s.owesPayName}>
            Pay {members.find(m => m.id === session.billPayer)?.name ?? '?'}
          </div>
          {grandTotals[currentMemberId] != null && (
            <div style={s.owesAmount}>
              You owe ${grandTotals[currentMemberId].toFixed(2)}
            </div>
          )}
          {(() => {
            const payer = members.find(m => m.id === session.billPayer);
            const instr = payer?.paymentInstructions ?? session.paymentInstructions;
            return instr ? <div style={s.owesInstr}>💬 {instr}</div> : null;
          })()}
        </div>
      )}

      {/* Multi-payer: per-creditor debt cards */}
      {!isReadOnly && session.multiPayer && debtTransactions.length > 0 && (
        <>
          {debtTransactions
            .filter(t => t.fromId === currentMemberId || t.toId === currentMemberId)
            .map((t, i) => {
              const isOwing = t.fromId === currentMemberId;
              const other = members.find(m => m.id === (isOwing ? t.toId : t.fromId));
              const instr = other?.paymentInstructions;
              return (
                <div key={i} style={{ ...s.owesCard, marginBottom: '12px' }}>
                  <div style={s.owesPayName}>{isOwing ? `Pay ${other?.name ?? '?'}` : `${other?.name ?? '?'} owes you`}</div>
                  <div style={s.owesAmount}>{isOwing ? 'You owe' : "You're owed"} ${t.amount.toFixed(2)}</div>
                  {isOwing && instr ? <div style={s.owesInstr}>💬 {instr}</div> : null}
                </div>
              );
            })}
        </>
      )}

      {/* Payment instructions — for admin/bill payer editing, or read-only users */}
      {(isAdmin || isBillPayer) && (
        editingInstructions ? (
          <div style={s.instrEditCard}>
            <textarea
              autoFocus
              style={s.instrTextarea}
              value={paymentInstructions}
              onChange={e => setPaymentInstructions(e.target.value)}
              placeholder="Payment instructions (e.g. PayNow to +65 9xxx xxxx)"
              rows={2}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button style={s.instrCancelBtn} onClick={() => { setEditingInstructions(false); setPaymentInstructions(session.paymentInstructions ?? ''); }}>Cancel</button>
              <button style={s.instrSaveBtn} onClick={handleSaveInstructions}>Save</button>
            </div>
          </div>
        ) : !session.paymentInstructions ? (
          <button style={s.instrAddBtn} onClick={() => setEditingInstructions(true)}>
            + Add payment instructions
          </button>
        ) : null
      )}

      {/* Payment instructions card — read-only users (not a member) */}
      {isReadOnly && session.paymentInstructions ? (
        <div style={s.instrCard}>
          <span style={s.instrIcon}>💬</span>
          <div style={{ flex: 1 }}>
            <div style={s.instrText}>{session.paymentInstructions}</div>
          </div>
        </div>
      ) : null}

      {/* Person cards — one per member, all venues combined */}
      {members.map(member => {
        if (!grandTotals[member.id]) return null;
        const grandTotal = grandTotals[member.id];
        const paid = paidStatus[member.id]?.paid ?? false;
        const isMe = member.id === currentMemberId;
        const avatarIdx = memberIndex[member.id] ?? 0;
        const avatarCol = AVATAR_COLORS[avatarIdx % AVATAR_COLORS.length];
        const isExpanded = expandedCards.has(member.id);
        const memberVenueData = sortedVenueDataMap
          .map(({ venue, memberData }) => ({ venue, data: memberData[member.id] }))
          .filter(({ data }) => !!data);

        return (
          <div
            key={member.id}
            style={{ ...s.memberCard, ...(paid ? { border: '0.5px solid #27500A' } : {}) }}
          >
            <div style={{ ...s.cardHeader, cursor: 'pointer' }} onClick={() => toggleCard(member.id)}>
              <div style={s.cardLeft}>
                <div style={{ ...s.avatar, backgroundColor: avatarCol }}>
                  {member.name.charAt(0).toUpperCase()}
                </div>
                <span style={s.memberName}>
                  {member.name}{isMe ? ' (you)' : ''}
                </span>
                {session.billPayer === member.id && (
                  <span style={s.billPayerPill}>Bill Payer</span>
                )}

              </div>
              <div style={s.cardRight}>
                <span style={s.venueTotal}>${grandTotal.toFixed(2)}</span>
                <motion.div
                  animate={{ rotate: isExpanded ? 90 : 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                  style={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'var(--text-tertiary)' }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </motion.div>
                {!isReadOnly && isAdmin && !isClosed && (
                  <button
                    style={paid ? s.paidBtn : s.markPaidBtn}
                    onClick={e => { e.stopPropagation(); togglePaid(member.id); }}
                  >
                    {paid ? 'Paid ✓' : 'Mark paid'}
                  </button>
                )}
                {(isReadOnly || !isAdmin) && paid && (
                  <span style={s.paidTag}>Paid ✓</span>
                )}
              </div>
            </div>

            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.div
                  key="expanded-content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={s.expandedContent}>
                    {memberVenueData.map(({ venue, data }, vi) => (
                      <div key={venue.id} style={vi > 0 ? { marginTop: '12px' } : {}}>
                        <div style={s.venueSubLabel}>{venue.name.toUpperCase()}</div>
                        {data.itemRows.map((row, i) => (
                          <div key={i} style={s.itemRow}>
                            <div style={s.itemLeft}>
                              <span style={s.itemName}>
                                {row.name}{row.count > 1 ? ` ×${row.count}` : ''}
                              </span>
                              {row.otherNames?.length > 0 && (
                                <span style={s.sharedWith}>with {row.otherNames.join(', ')}</span>
                              )}
                            </div>
                            <span style={s.itemAmt}>${row.amount.toFixed(2)}</span>
                          </div>
                        ))}
                        {(data.gst > 0.005 || data.sc > 0.005) && (
                          <div style={s.taxRows}>
                            {data.gst > 0.005 && (
                              <div style={s.taxRow}>
                                <span style={s.taxLabel}>
                                  GST{venue.gstPercent != null ? ` (${venue.gstPercent}%)` : ''}
                                </span>
                                <span style={s.taxAmt}>${data.gst.toFixed(2)}</span>
                              </div>
                            )}
                            {data.sc > 0.005 && (
                              <div style={s.taxRow}>
                                <span style={s.taxLabel}>
                                  Service charge{venue.serviceChargePercent != null ? ` (${venue.serviceChargePercent}%)` : ''}
                                </span>
                                <span style={s.taxAmt}>${data.sc.toFixed(2)}</span>
                              </div>
                            )}
                          </div>
                        )}
                        <div style={s.venueSubtotalRow}>
                          <span style={s.venueSubtotalLabel}>Venue subtotal</span>
                          <span style={s.venueSubtotalAmt}>${data.total.toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* I've paid — non-bill-payer, non-admin only */}
      {(() => {
        if (isReadOnly || isAdmin || isBillPayer) return null;
        const myData = paidStatus[currentMemberId] ?? {};
        const myPaid = myData.paid ?? false;
        const mySelfReported = myData.selfReported ?? false;
        if (myPaid && !mySelfReported) return null;
        const billPayerName = members.find(m => m.id === session?.billPayer)?.name ?? 'the bill payer';
        return (
          <div style={s.selfPaidWrap}>
            <button
              style={myPaid && mySelfReported ? s.selfPaidDoneBtn : s.selfPaidBtn}
              onClick={handleSelfReportPaid}
            >
              {myPaid && mySelfReported ? "Marked as paid ✓ · Undo" : "I've paid"}
            </button>
            {!(myPaid && mySelfReported) && (
              <div style={s.selfPaidHint}>Let {billPayerName} know you've settled up.</div>
            )}
          </div>
        );
      })()}

      {/* Bottom buttons */}
      <div style={s.bottomBtns}>
        <button style={s.shareBtn} onClick={handleCopyLink}>
          Share breakdown link
        </button>

        {!isReadOnly && isAdmin && !isClosed && (
          <button style={s.reopenBtn} onClick={() => setReopenOpen(true)}>
            Reopen for changes
          </button>
        )}
        {!isReadOnly && isAdmin && isClosed && (
          <button style={s.reopenBtn} onClick={() => setReopenOpen(true)}>
            Reopen for changes
          </button>
        )}
        {!isReadOnly && isAdmin && !isClosed && (
          <button style={s.closeBtn} onClick={() => setCloseStep(1)}>
            Close session
          </button>
        )}
      </div>

      {/* Reopen confirmation sheet */}
      {reopenOpen && (
        <div style={s.backdrop} onClick={() => setReopenOpen(false)}>
          <div style={s.sheet} onClick={e => e.stopPropagation()}>
            <div style={s.sheetHandle} />
            <div style={s.sheetTitle}>Reopen for changes?</div>
            <div style={s.sheetBody}>
              Members will be able to edit their claims again.
            </div>
            <button
              style={{ ...s.sheetBtn, backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', opacity: saving ? 0.6 : 1 }}
              onClick={handleReopen}
              disabled={saving}
            >
              {saving ? 'Reopening…' : 'Yes, reopen'}
            </button>
            <button
              style={{ ...s.sheetBtn, backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', marginTop: '8px' }}
              onClick={() => setReopenOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Close session — step 1 */}
      {closeStep === 1 && (
        <div style={s.backdrop} onClick={() => setCloseStep(0)}>
          <div style={s.sheet} onClick={e => e.stopPropagation()}>
            <div style={s.sheetHandle} />
            <div style={s.sheetTitle}>Close this session?</div>
            <div style={s.sheetBody}>
              Once closed, members can no longer view or change claims. The breakdown will be locked permanently.
            </div>
            <button
              style={{ ...s.sheetBtn, backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)' }}
              onClick={() => setCloseStep(2)}
            >
              Continue
            </button>
            <button
              style={{ ...s.sheetBtn, backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', marginTop: '8px' }}
              onClick={() => setCloseStep(0)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Close session — step 2 (final confirmation) */}
      {closeStep === 2 && (
        <div style={s.backdrop} onClick={() => setCloseStep(0)}>
          <div style={s.sheet} onClick={e => e.stopPropagation()}>
            <div style={s.sheetHandle} />
            <div style={s.sheetTitle}>Are you absolutely sure?</div>
            <div style={s.sheetBody}>
              This cannot be undone without reopening the session manually.
            </div>
            <button
              style={{ ...s.sheetBtn, backgroundColor: 'var(--color-danger)', color: '#fff', opacity: saving ? 0.6 : 1 }}
              onClick={handleClose}
              disabled={saving}
            >
              {saving ? 'Closing…' : 'Yes, close session'}
            </button>
            <button
              style={{ ...s.sheetBtn, backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', marginTop: '8px' }}
              onClick={() => setCloseStep(0)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {/* Three-dot menu sheet */}
      {menuOpen && (() => {
        const menuItems = [
          { icon: '🔗', label: 'Copy session link', action: () => { setMenuOpen(false); handleCopyLink(); } },
          ...(isAdmin ? [
            { icon: '✏️', label: 'Rename session', action: () => { setMenuOpen(false); setRenameValue(session.name ?? ''); setRenameOpen(true); } },
          ] : []),
          ...((isAdmin || isBillPayer) ? [
            { icon: '💬', label: 'Edit payment instructions', action: () => { setMenuOpen(false); setInstrSheetDraft(paymentInstructions); setInstrSheetOpen(true); } },
            { icon: '🏦', label: 'Manage bill payers', action: () => { setMenuOpen(false); setBillPayersSheetOpen(true); } },
          ] : []),
        ];
        return (
          <>
            <div style={s.sheetBackdrop} onClick={() => setMenuOpen(false)} />
            <div style={s.menuSheet}>
              <div style={s.sheetHandle} />
              {menuItems.map((item, i) => (
                <div
                  key={i}
                  style={{ ...s.menuOption, borderBottom: i < menuItems.length - 1 ? '0.5px solid var(--border-color)' : 'none' }}
                  onClick={item.action}
                >
                  <span style={s.menuOptionIcon}>{item.icon}</span>
                  <span style={s.menuOptionLabel}>{item.label}</span>
                </div>
              ))}
            </div>
          </>
        );
      })()}

      {/* Edit payment instructions sheet */}
      {instrSheetOpen && (
        <>
          <div style={s.sheetBackdrop} onClick={() => setInstrSheetOpen(false)} />
          <div style={s.menuSheet}>
            <div style={s.sheetHandle} />
            <div style={s.renameTitle}>Payment instructions</div>
            <textarea
              autoFocus
              style={{ ...s.instrTextarea, marginBottom: '6px' }}
              value={instrSheetDraft}
              maxLength={200}
              onChange={e => setInstrSheetDraft(e.target.value)}
              placeholder="e.g. PayNow to +65 9xxx xxxx"
              rows={3}
            />
            <div style={s.renameCounter}>{instrSheetDraft.length}/200</div>
            <div style={s.renameBtns}>
              <button style={s.cancelBtn} onClick={() => setInstrSheetOpen(false)}>Cancel</button>
              <button style={s.saveBtn} onClick={handleSaveInstrSheet}>Save</button>
            </div>
          </div>
        </>
      )}

      {/* Manage bill payers sheet */}
      {billPayersSheetOpen && (
        <>
          <div style={s.sheetBackdrop} onClick={() => setBillPayersSheetOpen(false)} />
          <div style={s.menuSheet}>
            <div style={s.sheetHandle} />
            <div style={s.renameTitle}>Manage bill payers</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '16px' }}>
              Set who paid for each venue.
            </div>
            {venues.map(venue => (
              <div key={venue.id} style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                  {venue.name}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {members.map(m => {
                    const sel = venueBillPayers[venue.id] === m.id;
                    return (
                      <button
                        key={m.id}
                        style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontFamily: 'system-ui, -apple-system, sans-serif', border: '0.5px solid var(--border-color)', backgroundColor: sel ? 'var(--text-primary)' : 'var(--bg-secondary)', color: sel ? 'var(--bg-primary)' : 'var(--text-primary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        onClick={() => handleSetVenueBillPayer(venue.id, m.id)}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <button
              style={{ ...s.saveBtn, width: '100%', padding: '12px' }}
              onClick={() => setBillPayersSheetOpen(false)}
            >
              Done
            </button>
          </div>
        </>
      )}

      {/* Rename session sheet */}
      {renameOpen && (
        <>
          <div style={s.sheetBackdrop} onClick={() => setRenameOpen(false)} />
          <div style={s.menuSheet}>
            <div style={s.sheetHandle} />
            <div style={s.renameTitle}>Rename session</div>
            <input
              autoFocus
              style={s.renameInput}
              value={renameValue}
              maxLength={50}
              onChange={e => setRenameValue(e.target.value)}
              placeholder="Session name"
              onKeyDown={e => e.key === 'Enter' && handleRenameSave()}
            />
            <div style={s.renameCounter}>{renameValue.length}/50</div>
            <div style={s.renameBtns}>
              <button style={s.cancelBtn} onClick={() => setRenameOpen(false)}>Cancel</button>
              <button style={s.saveBtn} onClick={handleRenameSave}>Save</button>
            </div>
          </div>
        </>
      )}
    </PageContainer>
  );
}

const s = {
  header: { display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' },
  back: { background: 'none', border: 'none', fontSize: '20px', color: 'var(--text-primary)', cursor: 'pointer', padding: '0', lineHeight: 1.6 },
  menuBtn: { background: 'none', border: 'none', fontSize: '14px', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '1px', padding: '4px', alignSelf: 'center' },
  sheetBackdrop: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100 },
  menuSheet: { position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101, backgroundColor: 'var(--bg-primary)', borderRadius: '20px 20px 0 0', padding: '12px 20px 40px' },
  menuOption: { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 0', cursor: 'pointer' },
  menuOptionIcon: { fontSize: '16px', width: '22px', textAlign: 'center', flexShrink: 0 },
  menuOptionLabel: { fontSize: '14px', fontFamily: 'system-ui, -apple-system, sans-serif', color: 'var(--text-primary)' },
  renameTitle: { fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '12px' },
  renameInput: { width: '100%', padding: '10px 12px', fontSize: '15px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '8px', outline: 'none', boxSizing: 'border-box', colorScheme: 'light dark', marginBottom: '6px' },
  renameCounter: { fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', textAlign: 'right', marginBottom: '16px' },
  renameBtns: { display: 'flex', gap: '10px' },
  cancelBtn: { flex: 1, padding: '12px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer' },
  saveBtn: { flex: 1, padding: '12px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', borderRadius: '8px', cursor: 'pointer' },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: '20px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  subtitle: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '3px' },
  statusRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' },
  lockedBadge: { fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '20px', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '0.5px solid var(--border-color)', fontFamily: 'system-ui, -apple-system, sans-serif', flexShrink: 0 },
  closedBadge: { fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '20px', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', flexShrink: 0 },
  taxHelper: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  receiptsBtn: { background: 'none', border: 'none', fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '0', marginLeft: 'auto', flexShrink: 0 },
  instrTextarea: { width: '100%', padding: '8px 10px', fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '6px', outline: 'none', resize: 'none', boxSizing: 'border-box', colorScheme: 'light dark' },
  owesCard: { backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', padding: '14px 16px', marginBottom: '16px', border: '0.5px solid var(--border-color)' },
  owesPayName: { fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  owesAmount: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px' },
  owesInstr: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '8px', paddingTop: '8px', borderTop: '0.5px solid var(--border-color)' },
  instrCard: { display: 'flex', alignItems: 'flex-start', gap: '10px', backgroundColor: '#FAEEDA', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px' },
  instrIcon: { fontSize: '16px', flexShrink: 0, marginTop: '1px' },
  instrText: { fontSize: '13px', color: '#633806', fontFamily: 'system-ui, -apple-system, sans-serif', lineHeight: 1.4 },
  instrEditBtn: { background: 'none', border: 'none', fontSize: '11px', color: '#633806', cursor: 'pointer', padding: '4px 0 0', fontFamily: 'system-ui, -apple-system, sans-serif', textDecoration: 'underline', display: 'block' },
  instrEditCard: { backgroundColor: 'var(--bg-secondary)', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px', border: '0.5px solid var(--border-color)' },
  instrTextarea: { width: '100%', padding: '8px 10px', fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '6px', outline: 'none', resize: 'none', boxSizing: 'border-box', colorScheme: 'light dark' },
  instrCancelBtn: { flex: 1, padding: '8px', fontSize: '13px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer' },
  instrSaveBtn: { flex: 1, padding: '8px', fontSize: '13px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  instrAddBtn: { width: '100%', padding: '10px', fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif', color: 'var(--text-secondary)', backgroundColor: 'transparent', border: '0.5px dashed var(--border-color)', borderRadius: '10px', cursor: 'pointer', marginBottom: '16px', textAlign: 'center' },
  venueGroup: { marginBottom: '20px' },
  venueLabel: { fontSize: '11px', fontWeight: 500, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '8px' },
  memberCard: { backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', padding: '12px', marginBottom: '8px', overflow: 'hidden' },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  doneClaimingPill: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px', backgroundColor: '#EAF3DE', color: '#27500A', fontFamily: 'system-ui, -apple-system, sans-serif', display: 'inline-block', verticalAlign: 'middle', marginLeft: '4px', flexShrink: 0, whiteSpace: 'nowrap' },
  expandedContent: { borderTop: '0.5px solid var(--border-color)', marginTop: '8px', paddingTop: '4px' },
  venueSubLabel: { fontSize: '10px', fontWeight: 500, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '8px 0 4px' },
  venueSubtotalRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '0.5px solid var(--border-color)', paddingTop: '6px', marginTop: '4px' },
  venueSubtotalLabel: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', fontWeight: 500 },
  venueSubtotalAmt: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', fontWeight: 500 },
  cardLeft: { display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, overflow: 'hidden' },
  cardRight: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 },
  cardChevron: { fontSize: '16px', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', lineHeight: 1, flexShrink: 0 },
  avatar: { width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: '#fff', flexShrink: 0, fontFamily: 'system-ui, -apple-system, sans-serif' },
  memberName: { fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  billPayerPill: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px', backgroundColor: '#FAEEDA', color: '#633806', fontFamily: 'system-ui, -apple-system, sans-serif', display: 'inline-block', verticalAlign: 'middle', marginLeft: '6px', flexShrink: 0, whiteSpace: 'nowrap' },
  venueTotal: { fontSize: '17px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', flexShrink: 0 },
  markPaidBtn: { backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 14px', fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer', flexShrink: 0 },
  paidBtn: { backgroundColor: '#EAF3DE', border: 'none', borderRadius: '6px', padding: '6px 14px', fontSize: '12px', fontWeight: 500, color: '#27500A', fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer', flexShrink: 0 },
  paidTag: { fontSize: '12px', fontWeight: 500, padding: '6px 14px', borderRadius: '6px', backgroundColor: '#EAF3DE', color: '#27500A', fontFamily: 'system-ui, -apple-system, sans-serif', flexShrink: 0 },
  itemRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '5px' },
  itemLeft: { display: 'flex', flexDirection: 'column', flex: 1, paddingRight: '8px' },
  itemName: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  sharedWith: { fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '1px' },
  itemAmt: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', flexShrink: 0 },
  taxRows: { borderTop: '0.5px solid var(--border-color)', marginTop: '6px', paddingTop: '6px' },
  taxRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' },
  taxLabel: { fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  taxAmt: { fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  selfPaidWrap: { marginTop: '8px', marginBottom: '4px' },
  selfPaidBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer' },
  selfPaidDoneBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: '#EAF3DE', color: '#27500A', border: 'none', borderRadius: '8px', cursor: 'pointer' },
  selfPaidHint: { textAlign: 'center', fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '6px' },
  bottomBtns: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', paddingBottom: '16px' },
  shareBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer' },
  reopenBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer' },
  closeBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', color: 'var(--color-danger)', border: '0.5px solid var(--color-danger)', borderRadius: '8px', cursor: 'pointer' },
  backdrop: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  sheet: { width: '100%', maxWidth: '480px', backgroundColor: 'var(--bg-primary)', borderRadius: '16px 16px 0 0', padding: '12px 16px 36px' },
  sheetHandle: { width: '36px', height: '4px', borderRadius: '2px', backgroundColor: 'var(--border-color)', margin: '0 auto 16px' },
  sheetTitle: { fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '8px' },
  sheetBody: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '20px', lineHeight: 1.5 },
  sheetBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'block' },
};

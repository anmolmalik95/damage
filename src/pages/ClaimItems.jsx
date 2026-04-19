import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import {
  doc, collection, onSnapshot, addDoc, deleteDoc, updateDoc,
  getDocs, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import PageContainer from '../components/PageContainer';

const AVATAR_COLORS = ['#5b9bd5', '#3dba8a', '#e8a03a', '#e07060', '#9070d0', '#4db8b8'];

function avatarColor(idx) { return AVATAR_COLORS[idx % AVATAR_COLORS.length]; }

function Avatar({ name, index, size = 26 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      backgroundColor: avatarColor(index),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.42), fontWeight: 700, color: '#fff',
      flexShrink: 0, fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {name?.charAt(0)?.toUpperCase() ?? '?'}
    </div>
  );
}

function BottomSheet({ title, subtitle, onClose, children }) {
  return (
    <>
      <div style={s.backdrop} onClick={onClose} />
      <div style={s.sheet}>
        <div style={s.sheetHandle} />
        {title && <div style={s.sheetTitle}>{title}</div>}
        {subtitle && <div style={s.sheetSubtitle}>{subtitle}</div>}
        {children}
      </div>
    </>
  );
}

export default function ClaimItems() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const currentMemberId = localStorage.getItem(`member_${sessionId}`);
  const currentMemberName = localStorage.getItem(`memberName_${sessionId}`);

  const [session, setSession] = useState(null);
  const [venues, setVenues] = useState([]);
  const [claims, setClaims] = useState([]);
  const [members, setMembers] = useState([]);

  const [claimingForId, setClaimingForId] = useState(null);
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [expandedPersons, setExpandedPersons] = useState(() => new Set(currentMemberId ? [currentMemberId] : []));
  const [switchSheetOpen, setSwitchSheetOpen] = useState(false);
  const [sharedSheet, setSharedSheet] = useState(null);
  const [sharedSelected, setSharedSelected] = useState([]);
  const [sharedNewName, setSharedNewName] = useState('');
  const [showNewPersonInput, setShowNewPersonInput] = useState(false);
  const [finaliseLoading, setFinaliseLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [billPayerPickerOpen, setBillPayerPickerOpen] = useState(false);
  const [endSessionConfirmOpen, setEndSessionConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const { showToast } = useToast();

  useEffect(() => {
    document.title = session?.name ? `Claiming · ${session.name} — Unfuck` : 'Unfuck';
  }, [session?.name]);

  // Redirect if no identity
  useEffect(() => {
    if (!currentMemberId) navigate(`/s/${sessionId}`, { replace: true });
  }, [sessionId, currentMemberId, navigate]);

  // Firestore listeners
  useEffect(() => {
    if (!currentMemberId) return;

    const unsubSession = onSnapshot(doc(db, 'sessions', sessionId), snap => {
      if (snap.exists()) setSession({ id: snap.id, ...snap.data() });
    });
    const unsubMembers = onSnapshot(collection(db, 'sessions', sessionId, 'members'), snap => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubClaims = onSnapshot(collection(db, 'sessions', sessionId, 'claims'), snap => {
      setClaims(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // Venues + items are static after confirm — one-time fetch
    getDocs(collection(db, 'sessions', sessionId, 'venues')).then(async vSnap => {
      const list = await Promise.all(
        vSnap.docs.map(async vDoc => {
          const iSnap = await getDocs(
            collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items')
          );
          return {
            id: vDoc.id, ...vDoc.data(),
            items: iSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          };
        })
      );
      setVenues(list);
    });

    return () => { unsubSession(); unsubMembers(); unsubClaims(); };
  }, [sessionId, currentMemberId]);

  const targetId = claimingForId || currentMemberId;
  const allItems = venues.flatMap(v => v.items.map(i => ({ ...i, venueId: v.id })));

  const totalUnits = allItems.reduce((s, i) => s + (i.quantity ?? 1), 0);
  const claimedUnits = new Set(claims.map(c => `${c.itemId}_${c.instanceNumber}`)).size;
  const progress = totalUnits > 0 ? Math.round((claimedUnits / totalUnits) * 100) : 0;

  function claimsFor(itemId) { return claims.filter(c => c.itemId === itemId); }
  function instanceClaim(itemId, n) {
    return claims.find(c => c.itemId === itemId && c.instanceNumber === n) ?? null;
  }
  function myCount(itemId) {
    return claims.filter(c =>
      c.itemId === itemId &&
      (c.memberId === targetId || c.sharedWith?.includes(targetId))
    ).length;
  }

  function claimAttribution(itemId) {
    const itemClaims = claimsFor(itemId);
    if (!itemClaims.length) return null;
    const wholeCounts = {};
    const sharedMemberIds = new Set();
    itemClaims.forEach(c => {
      if (c.type === 'whole') {
        wholeCounts[c.memberId] = (wholeCounts[c.memberId] || 0) + 1;
      } else if (c.type === 'shared') {
        c.sharedWith?.forEach(mid => sharedMemberIds.add(mid));
      }
    });
    const name = mid => mid === currentMemberId ? 'You' : (members.find(m => m.id === mid)?.name ?? '?');
    const wholeParts = Object.entries(wholeCounts).map(([mid, count]) => {
      const label = name(mid);
      return count > 1 ? `${label} ×${count}` : label;
    });
    const sharedParts = [...sharedMemberIds].map(mid => name(mid));
    if (!wholeParts.length && !sharedParts.length) return null;
    if (!sharedParts.length) return wholeParts.join(', ');
    if (!wholeParts.length) return `shared: ${sharedParts.join(', ')}`;
    return `${wholeParts.join(', ')} · shared: ${sharedParts.join(', ')}`;
  }

  async function handleClaim(item) {
    const taken = new Set(claimsFor(item.id).map(c => c.instanceNumber));
    let n = null;
    for (let i = 1; i <= (item.quantity ?? 1); i++) {
      if (!taken.has(i)) { n = i; break; }
    }
    if (n === null) return;

    const tempId = `temp_${Date.now()}_${Math.random()}`;
    const optimistic = { id: tempId, itemId: item.id, instanceNumber: n, memberId: targetId, claimedBy: currentMemberId, claimedByName: currentMemberName, type: 'whole', sharedWith: [] };
    setClaims(p => [...p, optimistic]);
    try {
      const ref = await addDoc(collection(db, 'sessions', sessionId, 'claims'), {
        itemId: item.id, instanceNumber: n, memberId: targetId,
        claimedBy: currentMemberId, claimedByName: currentMemberName,
        type: 'whole', sharedWith: [], createdAt: serverTimestamp(),
      });
      setClaims(p => p.map(c => c.id === tempId ? { ...c, id: ref.id } : c));
    } catch (err) {
      setClaims(p => p.filter(c => c.id !== tempId));
      console.error('Claim failed:', err);
    }
  }

  async function handleUnclaim(item) {
    const mine = claims.filter(c => c.itemId === item.id && c.memberId === targetId && c.type === 'whole');
    if (!mine.length) return;
    const toDelete = mine[mine.length - 1];
    setClaims(p => p.filter(c => c.id !== toDelete.id));
    try {
      await deleteDoc(doc(db, 'sessions', sessionId, 'claims', toDelete.id));
    } catch (err) {
      setClaims(p => [...p, toDelete]);
      console.error('Unclaim failed:', err);
    }
  }

  function toggleItem(id) {
    setExpandedItems(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function togglePerson(id) {
    setExpandedPersons(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function openSharedSheet(itemId, instanceNumber, itemName, unitPrice) {
    const existing = instanceClaim(itemId, instanceNumber);
    setSharedSelected(existing?.type === 'shared' ? [...existing.sharedWith] : [currentMemberId]);
    setSharedSheet({ itemId, instanceNumber, itemName, unitPrice, existingId: existing?.id ?? null });
    setShowNewPersonInput(false);
    setSharedNewName('');
  }

  async function confirmShared() {
    if (!sharedSheet || sharedSelected.length === 0) return;
    const { itemId, instanceNumber, existingId } = sharedSheet;
    const batch = writeBatch(db);
    if (existingId) batch.delete(doc(db, 'sessions', sessionId, 'claims', existingId));
    const newRef = doc(collection(db, 'sessions', sessionId, 'claims'));
    batch.set(newRef, {
      itemId, instanceNumber, memberId: sharedSelected[0],
      claimedBy: currentMemberId, claimedByName: currentMemberName,
      type: 'shared', sharedWith: [...sharedSelected], createdAt: serverTimestamp(),
    });
    const optimistic = {
      id: newRef.id, itemId, instanceNumber, memberId: sharedSelected[0],
      claimedBy: currentMemberId, claimedByName: currentMemberName,
      type: 'shared', sharedWith: [...sharedSelected],
    };
    setClaims(p => [...p.filter(c => c.id !== existingId), optimistic]);
    setSharedSheet(null);
    try { await batch.commit(); }
    catch (err) { console.error('Shared claim failed:', err); }
  }

  async function addMemberToShared() {
    const name = sharedNewName.trim();
    if (!name) return;
    try {
      const ref = await addDoc(collection(db, 'sessions', sessionId, 'members'), {
        name, joinedAt: serverTimestamp(), isCreator: false,
      });
      setMembers(p => [...p, { id: ref.id, name, isCreator: false }]);
      setSharedSelected(p => [...p, ref.id]);
      setSharedNewName('');
    } catch (err) { console.error(err); }
  }

  async function handleFinalise() {
    setFinaliseLoading(true);
    try {
      await updateDoc(doc(db, 'sessions', sessionId), { status: 'locked' });

      const [claimsSnap, venuesSnap] = await Promise.all([
        getDocs(collection(db, 'sessions', sessionId, 'claims')),
        getDocs(collection(db, 'sessions', sessionId, 'venues')),
      ]);
      const allClaims = claimsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      let needsResolve = false;
      await Promise.all(venuesSnap.docs.map(async vDoc => {
        const iSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items'));
        iSnap.docs.forEach(iDoc => {
          const item = iDoc.data();
          const qty = item.quantity ?? 1;
          const itemClaims = allClaims.filter(c => c.itemId === iDoc.id);
          if (itemClaims.length > qty) { needsResolve = true; return; }
          const claimedNums = new Set(itemClaims.map(c => c.instanceNumber));
          for (let n = 1; n <= qty; n++) {
            if (!claimedNums.has(n)) { needsResolve = true; break; }
          }
        });
      }));

      navigate(`/session/${sessionId}/${needsResolve ? 'resolve' : 'breakdown'}`, { state: { from: 'claim' } });
    } catch (err) {
      console.error(err);
      setFinaliseLoading(false);
    }
  }

  async function handleCopyLink() {
    const url = `https://unfuck.malik.codes/s/${sessionId}`;
    try { await navigator.clipboard.writeText(url); }
    catch {
      const el = document.createElement('textarea');
      el.value = url; document.body.appendChild(el); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    }
    setMenuOpen(false);
    showToast('Copied!', 'success');
  }

  function handleExport() {
    setMenuOpen(false);
    const sessionName = session?.name ?? 'Session';
    let text = `${sessionName}\n${session?.date ?? ''}\n\n`;
    venues.forEach(venue => {
      text += `=== ${venue.name} ===\n`;
      venue.items.forEach(item => {
        text += `${item.name} ×${item.quantity ?? 1} — $${(item.unitPrice ?? 0).toFixed(2)}\n`;
      });
      text += '\n';
    });
    text += '=== Per Person Breakdown ===\n';
    members.forEach(member => {
      const mc = claims.filter(c => c.memberId === member.id || c.sharedWith?.includes(member.id));
      let total = 0;
      text += `\n${member.name}:\n`;
      mc.forEach(c => {
        const item = allItems.find(i => i.id === c.itemId);
        if (!item) return;
        const amt = c.type === 'shared' ? (item.unitPrice ?? 0) / (c.sharedWith?.length || 1) : (item.unitPrice ?? 0);
        total += amt;
        text += `  ${item.name}${c.type === 'shared' ? ' (shared)' : ''} — $${amt.toFixed(2)}\n`;
      });
      text += `  Total (pre-tax): $${total.toFixed(2)}\n`;
    });
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${sessionName.replace(/[^a-z0-9]/gi, '_')}_order_log.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Order log downloaded', 'success');
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

  async function handleChangeBillPayer(memberId) {
    await updateDoc(doc(db, 'sessions', sessionId), { billPayer: memberId });
    setBillPayerPickerOpen(false);
    showToast('Bill payer updated', 'success');
  }

  async function handleEndSessionFromMenu() {
    try {
      await updateDoc(doc(db, 'sessions', sessionId), { status: 'locked' });
      setEndSessionConfirmOpen(false);
      navigate(`/session/${sessionId}/resolve`);
    } catch (err) { console.error(err); }
  }

  function calcTotals() {
    const t = {};
    members.forEach(m => { t[m.id] = 0; });
    claims.forEach(c => {
      const item = allItems.find(i => i.id === c.itemId);
      if (!item) return;
      if (c.type === 'whole') {
        t[c.memberId] = (t[c.memberId] || 0) + (item.unitPrice ?? 0);
      } else if (c.type === 'shared' && c.sharedWith?.length) {
        const share = (item.unitPrice ?? 0) / c.sharedWith.length;
        c.sharedWith.forEach(mid => { t[mid] = (t[mid] || 0) + share; });
      }
    });
    return t;
  }

  const personTotals = calcTotals();
  const isCreator = members.find(m => m.id === currentMemberId)?.isCreator === true;
  const claimingForMember = claimingForId ? members.find(m => m.id === claimingForId) : null;

  return (
    <PageContainer>
      {/* Header */}
      <div style={s.header}>
        <button style={s.backBtn} onClick={() => navigate(-1)}>←</button>
        <span style={s.headerTitle}>{session?.name ?? ''}</span>
        <button style={s.menuBtn} onClick={() => setMenuOpen(true)}>•••</button>
      </div>

      {/* You-bar */}
      <div style={s.youBar}>
        <div>
          <div style={s.youBarLabel}>Claiming as</div>
          <div style={s.youBarName}>{currentMemberName}</div>
          {claimingForMember && (
            <div style={s.claimingFor}>
              · claiming for {claimingForMember.name}
              <button style={s.claimingForX} onClick={() => setClaimingForId(null)}>✕</button>
            </div>
          )}
        </div>
        <button style={s.switchBtn} onClick={() => setSwitchSheetOpen(true)}>switch</button>
      </div>

      {/* Progress */}
      <div style={s.progressWrap}>
        <div style={s.progressTrack}>
          <div style={{ ...s.progressFill, width: `${progress}%` }} />
        </div>
        <div style={s.progressHint}>
          Tap + to claim · tap › to expand and split individual units
        </div>
      </div>

      {/* Venue blocks */}
      {venues.map(venue => (
        <div key={venue.id} style={s.venueBlock}>
          <div style={s.venueHeader}>{venue.name}</div>
          {venue.items.map(item => {
            const itemClaims = claimsFor(item.id);
            const totalClaimed = itemClaims.length;
            const qty = item.quantity ?? 1;
            const allClaimed = totalClaimed >= qty;
            const myCnt = myCount(item.id);
            const isExpanded = expandedItems.has(item.id);
            const attribution = claimAttribution(item.id);

            return (
              <div key={item.id}>
                <div style={s.itemRow}>
                  <div style={s.itemLeft}>
                    <div style={s.itemNameRow}>
                      <span style={s.itemName}>{item.name}</span>
                      <span style={{
                        ...s.claimTag,
                        ...(totalClaimed === 0
                          ? { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '0.5px solid var(--border-color)' }
                          : allClaimed
                          ? { backgroundColor: '#EAF3DE', color: '#27500A' }
                          : { backgroundColor: '#EEEDFE', color: '#3C3489' }),
                      }}>
                        {totalClaimed}/{qty}
                      </span>
                    </div>
                    {attribution && <div style={s.itemAttribution}>{attribution}</div>}
                  </div>
                  <div style={s.itemControls}>
                    <span
                      style={{ ...s.ctrlBtn, opacity: myCnt === 0 ? 0.25 : 1 }}
                      onClick={() => myCnt > 0 && handleUnclaim(item)}
                    >−</span>
                    <span style={s.ctrlCount}>{myCnt}</span>
                    <span
                      style={{ ...s.ctrlBtn, opacity: allClaimed ? 0.25 : 1 }}
                      onClick={() => !allClaimed && handleClaim(item)}
                    >+</span>
                    <span style={s.chevron} onClick={() => toggleItem(item.id)}>
                      {isExpanded ? '⌄' : '›'}
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={s.expandedView}>
                    {Array.from({ length: qty }, (_, i) => i + 1).map(n => {
                      const claim = instanceClaim(item.id, n);
                      const claimer = claim ? members.find(m => m.id === claim.memberId) : null;
                      const isMe = claim?.memberId === currentMemberId || claim?.sharedWith?.includes(currentMemberId);
                      return (
                        <div key={n} style={s.unitRow}>
                          <span style={s.unitLabel}>{item.name} #{n}</span>
                          {claim ? (
                            claim.type === 'shared' ? (
                              <span
                                style={s.sharedBadge}
                                onClick={() => openSharedSheet(item.id, n, item.name, item.unitPrice)}
                              >
                                Shared ›
                              </span>
                            ) : (
                              <span style={{ ...s.claimedBadge, color: isMe ? '#3dba8a' : 'var(--text-secondary)', backgroundColor: isMe ? '#e8f5ee' : 'var(--bg-secondary)' }}>
                                {claim.memberId === currentMemberId ? 'You' : (claimer?.name ?? '?')} ✓
                              </span>
                            )
                          ) : (
                            <div style={s.unitActions}>
                              <span style={s.unitClaimBtn} onClick={() => handleClaim(item)}>+</span>
                              <span style={s.unitSplitBtn} onClick={() => openSharedSheet(item.id, n, item.name, item.unitPrice)}>Split</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* Running totals */}
      {members.length > 0 && (
        <div style={s.totalsSection}>
          <div style={s.totalsTitle}>Running totals (pre-tax)</div>
          <div style={s.totalsContainer}>
          {members.map((member, idx) => {
            const total = personTotals[member.id] ?? 0;
            const isExp = expandedPersons.has(member.id);
            const isLast = idx === members.length - 1;
            const memberClaims = claims.filter(c =>
              c.memberId === member.id || c.sharedWith?.includes(member.id)
            );
            return (
              <div key={member.id} style={{ ...s.personBlock, borderBottom: isLast ? 'none' : '0.5px solid var(--border-color)' }}>
                <div style={s.personHeader} onClick={() => togglePerson(member.id)}>
                  <div style={s.personLeft}>
                    <Avatar name={member.name} index={idx} />
                    <span style={s.personName}>{member.name}</span>
                    {session?.billPayer === member.id && (
                      <span style={s.billPayerPill}>Bill Payer</span>
                    )}
                  </div>
                  <div style={s.personRight}>
                    <span style={s.personTotal}>${total.toFixed(2)}</span>
                    <span style={s.personChevron}>{isExp ? '⌄' : '›'}</span>
                  </div>
                </div>
                {isExp && (
                  <div style={s.personItems}>
                    {memberClaims.length === 0
                      ? <div style={s.noItems}>Nothing claimed yet</div>
                      : (() => {
                        const wholeClaims = memberClaims.filter(c => c.type === 'whole' && c.memberId === member.id);
                        const sharedClaims = memberClaims.filter(c => c.type === 'shared');
                        const wholeGroups = {};
                        wholeClaims.forEach(c => { wholeGroups[c.itemId] = (wholeGroups[c.itemId] || 0) + 1; });
                        return [
                          ...Object.entries(wholeGroups).map(([itemId, count]) => {
                            const item = allItems.find(i => i.id === itemId);
                            if (!item) return null;
                            return (
                              <div key={`whole_${itemId}`} style={s.personItem}>
                                <div style={s.personItemName}>{item.name}{count > 1 ? ` ×${count}` : ''}</div>
                                <span style={s.personItemAmt}>${((item.unitPrice ?? 0) * count).toFixed(2)}</span>
                              </div>
                            );
                          }),
                          ...sharedClaims.map(claim => {
                            const item = allItems.find(i => i.id === claim.itemId);
                            if (!item) return null;
                            const amount = (item.unitPrice ?? 0) / (claim.sharedWith?.length || 1);
                            const sharedNames = claim.sharedWith.map(mid =>
                              mid === member.id ? 'you' : (members.find(m => m.id === mid)?.name ?? '?')
                            ).join(', ');
                            return (
                              <div key={claim.id} style={s.personItem}>
                                <div>
                                  <div style={s.personItemName}>{item.name}</div>
                                  <div style={s.sharedWithText}>with {sharedNames}</div>
                                </div>
                                <span style={s.personItemAmt}>${amount.toFixed(2)}</span>
                              </div>
                            );
                          }),
                        ];
                      })()}
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}

      {/* Finalise — creator only */}
      {isCreator && (
        <button
          style={{ ...s.finaliseBtn, opacity: finaliseLoading ? 0.6 : 1, marginTop: '16px' }}
          onClick={handleFinalise}
          disabled={finaliseLoading}
        >
          {finaliseLoading ? 'Finalising…' : 'Finalise & lock session'}
        </button>
      )}

      {/* Three-dot menu sheet */}
      {menuOpen && (() => {
        const menuItems = [
          { icon: '🔗', label: 'Copy link to session', action: handleCopyLink },
          ...(isCreator ? [
            { icon: '✏️', label: 'Rename session', action: () => { setMenuOpen(false); setRenameValue(session?.name ?? ''); setRenameOpen(true); } },
            { icon: '👥', label: 'Manage people', action: () => { setMenuOpen(false); navigate(`/session/${sessionId}/manage-people`); } },
            { icon: '👤', label: 'Change bill payer', action: () => { setMenuOpen(false); setBillPayerPickerOpen(true); } },
            { icon: '📤', label: 'Export order log', action: handleExport },
            { icon: '✕', label: 'End session', action: () => { setMenuOpen(false); setEndSessionConfirmOpen(true); }, danger: true },
          ] : []),
        ];
        return (
          <>
            <div style={s.backdrop} onClick={() => setMenuOpen(false)} />
            <div style={s.sheet}>
              <div style={s.sheetHandle} />
              {menuItems.map((item, i) => (
                <div
                  key={i}
                  style={{
                    ...s.menuOption,
                    borderBottom: i < menuItems.length - 1 ? '0.5px solid var(--border-color)' : 'none',
                    color: item.danger ? '#e24b4a' : 'var(--text-primary)',
                  }}
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

      {/* Bill payer picker sheet */}
      {billPayerPickerOpen && (
        <>
          <div style={s.backdrop} onClick={() => setBillPayerPickerOpen(false)} />
          <div style={s.sheet}>
            <div style={s.sheetHandle} />
            <div style={s.sheetTitle}>Change bill payer</div>
            <div style={s.sheetSubtitle}>Select who paid the bill for this session.</div>
            {members.map((member, idx) => (
              <div key={member.id} style={s.sheetMemberRow} onClick={() => handleChangeBillPayer(member.id)}>
                <Avatar name={member.name} index={idx} />
                <span style={s.sheetMemberName}>{member.name}</span>
                {session?.billPayer === member.id && <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginLeft: 'auto' }}>Current</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* End session confirmation sheet */}
      {endSessionConfirmOpen && (
        <>
          <div style={s.backdrop} onClick={() => setEndSessionConfirmOpen(false)} />
          <div style={s.sheet}>
            <div style={s.sheetHandle} />
            <div style={s.sheetTitle}>End this session?</div>
            <div style={s.sheetSubtitle}>All claiming will stop. Members will see a final breakdown.</div>
            <div style={s.sheetBtns}>
              <button style={s.sheetCancelBtn} onClick={() => setEndSessionConfirmOpen(false)}>Cancel</button>
              <button style={{ ...s.sheetConfirmBtn, backgroundColor: '#e24b4a' }} onClick={handleEndSessionFromMenu}>End session</button>
            </div>
          </div>
        </>
      )}

      {/* Rename session sheet */}
      {renameOpen && (
        <>
          <div style={s.backdrop} onClick={() => setRenameOpen(false)} />
          <div style={s.sheet}>
            <div style={s.sheetHandle} />
            <div style={s.sheetTitle}>Rename session</div>
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
            <div style={s.sheetBtns}>
              <button style={s.sheetCancelBtn} onClick={() => setRenameOpen(false)}>Cancel</button>
              <button style={s.sheetConfirmBtn} onClick={handleRenameSave}>Save</button>
            </div>
          </div>
        </>
      )}

      {/* Switch claiming sheet */}
      {switchSheetOpen && (
        <BottomSheet title="Claim on behalf of…" onClose={() => setSwitchSheetOpen(false)}>
          {members.filter(m => m.id !== currentMemberId).map((member, idx) => (
            <div
              key={member.id}
              style={s.sheetMemberRow}
              onClick={() => { setClaimingForId(member.id); setSwitchSheetOpen(false); }}
            >
              <Avatar name={member.name} index={members.indexOf(member)} />
              <span style={s.sheetMemberName}>{member.name}</span>
            </div>
          ))}
          {members.filter(m => m.id !== currentMemberId).length === 0 && (
            <div style={{ padding: '12px 0', color: 'var(--text-secondary)', fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
              No other members yet.
            </div>
          )}
        </BottomSheet>
      )}

      {/* Shared item sheet */}
      {sharedSheet && (
        <>
          <div style={s.backdrop} onClick={() => setSharedSheet(null)} />
          <div style={s.sharedSheetPanel}>
            <div style={s.sheetHandle} />
            <div style={s.sharedSheetInner}>
            <div style={s.sheetTitle}>{sharedSheet.itemName} · ${(sharedSheet.unitPrice ?? 0).toFixed(2)}</div>
            <div style={s.sheetSubtitle}>Who shared this? Select everyone who was in on it.</div>

            <div style={s.sharedGridWrap}><div style={s.sharedGrid}>
              {members.map((member, idx) => {
                const sel = sharedSelected.includes(member.id);
                return (
                  <div
                    key={member.id}
                    style={{
                      ...s.sharedTile,
                      border: sel ? '1.5px solid var(--text-primary)' : '1.5px solid transparent',
                      backgroundColor: sel ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                    }}
                    onClick={() => setSharedSelected(p => sel ? p.filter(id => id !== member.id) : [...p, member.id])}
                  >
                    <Avatar name={member.name} index={idx} size={32} />
                    <span style={{ ...s.sharedTileName, color: sel ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {member.name}
                    </span>
                    {sel && <div style={s.sharedCheckCircle}>✓</div>}
                  </div>
                );
              })}
              <div style={s.sharedNewTile} onClick={() => setShowNewPersonInput(p => !p)}>
                <div style={s.dashedAvatar}>+</div>
                <span style={{ ...s.sharedTileName, color: 'var(--text-secondary)' }}>New</span>
              </div>
            </div></div>

            {showNewPersonInput && (
              <div style={s.sharedAddRow}>
                <input
                  autoFocus
                  style={s.sharedAddInput}
                  value={sharedNewName}
                  onChange={e => setSharedNewName(e.target.value)}
                  placeholder="Add person…"
                  onKeyDown={e => e.key === 'Enter' && addMemberToShared()}
                />
                <button style={s.sharedAddBtn} onClick={addMemberToShared}>Add</button>
              </div>
            )}

            {sharedSelected.length > 0 && (
              <div style={s.splitSummary}>
                <span style={s.splitSummaryText}>Split evenly between {sharedSelected.length} {sharedSelected.length === 1 ? 'person' : 'people'} · </span>
                <span style={s.splitSummaryAmt}>${((sharedSheet.unitPrice ?? 0) / sharedSelected.length).toFixed(2)} each</span>
              </div>
            )}

            <div style={s.sheetBtns}>
              <button style={s.sheetCancelBtn} onClick={() => setSharedSheet(null)}>Cancel</button>
              <button style={s.sheetConfirmBtn} onClick={confirmShared}>Confirm</button>
            </div>
            </div>
          </div>
        </>
      )}
    </PageContainer>
  );
}

const s = {
  header: {
    display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px',
  },
  backBtn: {
    background: 'none', border: 'none', fontSize: '20px', color: 'var(--text-primary)',
    cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0,
  },
  headerTitle: {
    fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', flex: 1,
  },
  menuBtn: {
    background: 'none', border: 'none', fontSize: '14px', color: 'var(--text-secondary)',
    cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif',
    letterSpacing: '1px', padding: '4px',
  },
  menuOption: {
    display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', cursor: 'pointer',
  },
  menuOptionIcon: { fontSize: '16px', width: '22px', textAlign: 'center', flexShrink: 0 },
  menuOptionLabel: {
    fontSize: '14px', fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  youBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    backgroundColor: 'var(--bg-secondary)', padding: '8px 16px',
    borderRadius: '10px', marginBottom: '12px',
  },
  youBarLabel: {
    fontSize: '11px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  youBarName: {
    fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  claimingFor: {
    fontSize: '11px', color: '#534AB7',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px',
  },
  claimingForX: {
    background: 'none', border: 'none', fontSize: '11px', color: '#534AB7',
    cursor: 'pointer', padding: '0 2px',
  },
  switchBtn: {
    background: 'none', border: 'none', fontSize: '11px', color: 'var(--text-secondary)',
    cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '4px 0', alignSelf: 'center', textDecoration: 'underline',
  },
  progressWrap: { marginBottom: '16px' },
  progressTrack: {
    height: '4px', backgroundColor: 'var(--bg-secondary)',
    borderRadius: '2px', overflow: 'hidden', marginBottom: '6px',
  },
  progressFill: {
    height: '100%', backgroundColor: 'var(--text-primary)',
    borderRadius: '2px', transition: 'width 0.3s ease',
  },
  progressHint: {
    fontSize: '11px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  venueBlock: {
    borderRadius: '12px', overflow: 'hidden',
    border: '0.5px solid var(--border-color)', marginBottom: '16px',
  },
  venueHeader: {
    backgroundColor: 'var(--bg-secondary)', padding: '8px 12px',
    fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  itemRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '11px 12px 11px 16px', borderBottom: '0.5px solid var(--border-color)',
    backgroundColor: 'var(--bg-primary)',
  },
  itemLeft: { display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px', flex: 1, minWidth: 0 },
  itemNameRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  itemName: {
    fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  itemAttribution: {
    fontSize: '11px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    marginTop: '2px',
  },
  claimTag: {
    fontSize: '11px', fontWeight: 600, padding: '2px 6px',
    borderRadius: '20px', flexShrink: 0,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  itemControls: { display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 },
  ctrlBtn: {
    fontSize: '20px', color: 'var(--text-primary)', cursor: 'pointer',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    userSelect: 'none', lineHeight: 1, padding: '2px',
  },
  ctrlCount: {
    fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    minWidth: '16px', textAlign: 'center',
  },
  chevron: {
    fontSize: '16px', color: 'var(--text-secondary)', cursor: 'pointer',
    fontFamily: 'system-ui, -apple-system, sans-serif', paddingLeft: '4px',
  },
  expandedView: {
    backgroundColor: 'var(--bg-secondary)',
    borderBottom: '0.5px solid var(--border-color)',
  },
  unitRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px 8px 20px', borderBottom: '0.5px solid var(--border-color)',
  },
  unitLabel: {
    fontSize: '12px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  claimedBadge: {
    fontSize: '11px', fontWeight: 500, padding: '3px 8px',
    borderRadius: '20px', fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  sharedBadge: {
    fontSize: '11px', fontWeight: 500, padding: '3px 8px',
    borderRadius: '20px', backgroundColor: '#f0eeff', color: '#534AB7',
    fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer',
  },
  unitActions: { display: 'flex', gap: '8px', alignItems: 'center' },
  unitClaimBtn: {
    fontSize: '18px', color: 'var(--text-primary)', cursor: 'pointer',
    fontFamily: 'system-ui, -apple-system, sans-serif', userSelect: 'none',
  },
  unitSplitBtn: {
    fontSize: '11px', color: '#534AB7', cursor: 'pointer',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '3px 8px', borderRadius: '20px', backgroundColor: '#f0eeff',
  },
  totalsSection: { marginTop: '8px', marginBottom: '8px' },
  totalsTitle: {
    fontSize: '11px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '8px',
  },
  totalsContainer: {
    backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', overflow: 'hidden',
  },
  personBlock: {
    overflow: 'hidden',
  },
  personHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '7px 10px', cursor: 'pointer',
  },
  personLeft: { display: 'flex', alignItems: 'center', gap: '8px' },
  personName: {
    fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  billPayerPill: {
    fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px',
    backgroundColor: '#FAEEDA', color: '#633806',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    display: 'inline-block', verticalAlign: 'middle', marginLeft: '6px', flexShrink: 0,
  },
  personRight: { display: 'flex', alignItems: 'center', gap: '8px' },
  personTotal: {
    fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  personChevron: {
    fontSize: '14px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  personItems: { borderTop: '0.5px solid var(--border-color)', padding: '4px 10px 8px' },
  personItem: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '5px 0',
  },
  personItemName: {
    fontSize: '12px', color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  sharedWithText: {
    fontSize: '10px', color: '#534AB7',
    fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '1px',
  },
  personItemAmt: {
    fontSize: '12px', color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', flexShrink: 0,
  },
  noItems: {
    fontSize: '12px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', padding: '6px 0',
  },
  finaliseBtn: {
    width: '100%', padding: '13px', fontSize: '14px', fontWeight: 600,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)',
    border: 'none', borderRadius: '8px', cursor: 'pointer',
  },
  // Bottom sheet (switch sheet)
  backdrop: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100,
  },
  sheet: {
    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101,
    backgroundColor: 'var(--bg-primary)', borderRadius: '20px 20px 0 0',
    padding: '12px 20px 40px', maxHeight: '80vh', overflowY: 'auto',
  },
  // Shared item sheet (dedicated panel)
  sharedSheetPanel: {
    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101,
    backgroundColor: 'var(--bg-primary)', borderRadius: '20px 20px 0 0',
    padding: '20px 16px 32px', maxHeight: '85vh', overflowY: 'auto',
  },
  sharedSheetInner: {
    maxWidth: '480px', margin: '0 auto',
  },
  sharedGridWrap: {
    maxWidth: '420px', margin: '0 auto',
  },
  sheetHandle: {
    width: '36px', height: '4px', borderRadius: '2px',
    backgroundColor: 'var(--border-color)', margin: '0 auto 16px',
  },
  sheetTitle: {
    fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '4px',
  },
  sheetSubtitle: {
    fontSize: '12px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '4px', marginBottom: '16px',
  },
  sheetMemberRow: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '12px 0', borderBottom: '0.5px solid var(--border-color)',
    cursor: 'pointer',
  },
  sheetMemberName: {
    fontSize: '14px', color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  sharedGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 120px))',
    gap: '10px', justifyContent: 'start',
  },
  sharedTile: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: '6px', padding: '12px 8px', borderRadius: '10px',
    cursor: 'pointer', position: 'relative',
    backgroundColor: 'var(--bg-secondary)',
  },
  sharedNewTile: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: '6px', padding: '12px 8px', borderRadius: '10px',
    cursor: 'pointer', position: 'relative',
    border: '1px dashed var(--border-color)', backgroundColor: 'transparent',
  },
  sharedTileName: {
    fontSize: '11px', textAlign: 'center',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    maxWidth: '80px',
  },
  sharedCheckCircle: {
    position: 'absolute', top: '6px', right: '6px',
    width: '16px', height: '16px', borderRadius: '50%',
    backgroundColor: 'var(--text-primary)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '10px', color: 'var(--bg-primary)', fontWeight: 700,
  },
  dashedAvatar: {
    width: '32px', height: '32px', borderRadius: '50%',
    border: '1.5px dashed var(--border-color)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '20px', color: 'var(--text-secondary)',
  },
  sharedAddRow: { display: 'flex', gap: '8px', marginTop: '12px' },
  sharedAddInput: {
    flex: 1, padding: '10px 12px', fontSize: '14px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)',
    border: '0.5px solid var(--border-color)', borderRadius: '8px', outline: 'none',
    colorScheme: 'light dark',
  },
  sharedAddBtn: {
    padding: '10px 16px', fontSize: '14px', fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)',
    border: 'none', borderRadius: '8px', cursor: 'pointer', flexShrink: 0,
  },
  splitSummary: {
    marginTop: '12px', marginBottom: '16px',
    backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', padding: '10px 12px',
  },
  splitSummaryText: {
    fontSize: '13px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  splitSummaryAmt: {
    fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  renameInput: {
    width: '100%', padding: '10px 12px', fontSize: '15px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)',
    border: '0.5px solid var(--border-color)', borderRadius: '8px', outline: 'none',
    boxSizing: 'border-box', colorScheme: 'light dark', marginBottom: '6px',
  },
  renameCounter: {
    fontSize: '11px', color: 'var(--text-tertiary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    textAlign: 'right', marginBottom: '16px',
  },
  sheetBtns: { display: 'flex', gap: '10px' },
  sheetCancelBtn: {
    flex: 1, padding: '12px', fontSize: '14px', fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'transparent', color: 'var(--text-primary)',
    border: '0.5px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer',
  },
  sheetConfirmBtn: {
    flex: 1, padding: '12px', fontSize: '14px', fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)',
    border: 'none', borderRadius: '8px', cursor: 'pointer',
  },
};

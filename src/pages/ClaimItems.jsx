import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { useNavigation } from '../context/NavigationContext';
import { useToast } from '../context/ToastContext';
import {
  doc, collection, onSnapshot, addDoc, deleteDoc, updateDoc,
  getDocs, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import PageContainer from '../components/PageContainer';
import { BRAND_NAME } from '../brand';

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
  const { navigateForward, navigateBack } = useNavigation();

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
  const [billPayersSheetOpen, setBillPayersSheetOpen] = useState(false);
  const [venueBillPayers, setVenueBillPayers] = useState({});
  const [cabItemPayers, setCabItemPayers] = useState({});
  const [endSessionConfirmOpen, setEndSessionConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const { showToast } = useToast();

  useEffect(() => {
    document.title = session?.name ? `Claiming · ${session.name} — ${BRAND_NAME}` : BRAND_NAME;
  }, [session?.name]);

  // Redirect if no identity
  useEffect(() => {
    if (!currentMemberId) navigate(`/s/${sessionId}`, { replace: true });
  }, [sessionId, currentMemberId, navigate]);

  // Firestore listeners
  useEffect(() => {
    if (!currentMemberId) return;

    const unsubSession = onSnapshot(doc(db, 'sessions', sessionId), snap => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.status === 'locked' || data.status === 'closed') {
          navigateForward(`/session/${sessionId}/breakdown`, { replace: true });
          return;
        }
        setSession({ id: snap.id, ...data });
      }
    });
    const unsubMembers = onSnapshot(collection(db, 'sessions', sessionId, 'members'), snap => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubClaims = onSnapshot(collection(db, 'sessions', sessionId, 'claims'), snap => {
      setClaims(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // Realtime venues + items listeners
    const itemUnsubsRef = { current: [] };
    const venueBaseMap = {};
    const itemDataMap = {};

    function rebuildVenues(vDocs) {
      const result = vDocs.map(vDoc => ({
        ...venueBaseMap[vDoc.id],
        items: itemDataMap[vDoc.id] ?? [],
      }));
      setVenues(result);
      const newVenPayers = {};
      result.forEach(v => { if (v.billPayer) newVenPayers[v.id] = v.billPayer; });
      setVenueBillPayers(newVenPayers);
      const newCabPayers = {};
      const tv = result.find(v => v.name === 'Transport' || v.isTransport);
      if (tv) tv.items.forEach(item => { if (item.billPayer) newCabPayers[item.id] = item.billPayer; });
      setCabItemPayers(newCabPayers);
    }

    const unsubVenues = onSnapshot(collection(db, 'sessions', sessionId, 'venues'), venuesSnap => {
      venuesSnap.docs.forEach(vDoc => {
        venueBaseMap[vDoc.id] = { id: vDoc.id, ...vDoc.data() };
      });
      Object.keys(itemDataMap).forEach(vId => {
        if (!venuesSnap.docs.find(d => d.id === vId)) delete itemDataMap[vId];
      });

      itemUnsubsRef.current.forEach(u => u());
      itemUnsubsRef.current = [];

      venuesSnap.docs.forEach(vDoc => {
        const unsub = onSnapshot(
          collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items'),
          itemsSnap => {
            itemDataMap[vDoc.id] = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            rebuildVenues(venuesSnap.docs);
          }
        );
        itemUnsubsRef.current.push(unsub);
      });

      rebuildVenues(venuesSnap.docs);
    });

    return () => { unsubSession(); unsubMembers(); unsubClaims(); unsubVenues(); itemUnsubsRef.current.forEach(u => u()); };
  }, [sessionId, currentMemberId]);

  const targetId = claimingForId || currentMemberId;
  const allItems = venues.flatMap(v => v.items.map(i => ({ ...i, venueId: v.id })));

  const grandTotal = allItems.reduce((s, i) => s + (i.unitPrice ?? 0) * (i.quantity ?? 1), 0);
  const claimedInstances = new Set(claims.map(c => `${c.itemId}_${c.instanceNumber}`));
  let claimedTotal = 0;
  allItems.forEach(item => {
    for (let n = 1; n <= (item.quantity ?? 1); n++) {
      if (claimedInstances.has(`${item.id}_${n}`)) claimedTotal += item.unitPrice ?? 0;
    }
  });
  const fillPct = grandTotal > 0 ? (claimedTotal / grandTotal) * 100 : 0;
  const allItemsClaimed = grandTotal > 0 && claimedTotal >= grandTotal;

  const isDoneClaiming = members.find(m => m.id === currentMemberId)?.doneClaiming === true;

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

      navigateForward(`/session/${sessionId}/${needsResolve ? 'resolve' : 'breakdown'}`, { state: { from: 'claim' } });
    } catch (err) {
      console.error(err);
      setFinaliseLoading(false);
    }
  }

  async function handleCopyLink() {
    const url = `${window.location.origin}/s/${sessionId}`;
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

  async function handleDoneClaiming() {
    const newVal = !isDoneClaiming;
    try {
      await updateDoc(doc(db, 'sessions', sessionId, 'members', currentMemberId), { doneClaiming: newVal });
      if (newVal) navigateForward(`/session/${sessionId}/my-claims`);
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

  async function handleSetVenueBillPayer(venueId, memberId) {
    setVenueBillPayers(prev => ({ ...prev, [venueId]: memberId }));
    try {
      await updateDoc(doc(db, 'sessions', sessionId, 'venues', venueId), { billPayer: memberId });
    } catch (err) { console.error(err); }
  }

  async function handleSetCabItemPayer(transportVenueId, itemId, memberId) {
    setCabItemPayers(prev => ({ ...prev, [itemId]: memberId }));
    try {
      await updateDoc(doc(db, 'sessions', sessionId, 'venues', transportVenueId, 'items', itemId), { billPayer: memberId });
    } catch (err) { console.error(err); }
  }

  async function handleEndSessionFromMenu() {
    setEndSessionConfirmOpen(false);
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

      navigateForward(`/session/${sessionId}/${needsResolve ? 'resolve' : 'breakdown'}`, { state: { from: 'claim' } });
    } catch (err) {
      console.error(err);
      setFinaliseLoading(false);
    }
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
        <button style={s.backBtn} onClick={() => { localStorage.removeItem(`member_${sessionId}`); navigateBack(`/s/${sessionId}`); }}>←</button>
        <span style={s.headerTitle}>{session?.name ?? ''}</span>
        <button style={s.menuBtn} onClick={() => setMenuOpen(true)}>•••</button>
      </div>

      {/* You-bar */}
      <div style={s.youBar}>
        <div>
          <div style={s.youBarLabel}>Claiming as</div>
          <div style={s.youBarName}>{currentMemberName}</div>
          <button style={s.notYouBtn} onClick={() => { localStorage.removeItem(`member_${sessionId}`); navigateBack(`/s/${sessionId}`); }}>Not you?</button>
          {claimingForMember && (
            <div style={s.claimingFor}>
              · claiming for {claimingForMember.name}
              <button style={s.claimingForX} onClick={() => setClaimingForId(null)}>✕</button>
            </div>
          )}
        </div>
        <button style={s.switchBtn} onClick={() => setSwitchSheetOpen(true)}>switch</button>
      </div>

      {/* Frozen banner */}
      {isDoneClaiming && (
        <div style={s.frozenBanner}>
          You've marked yourself as done. Tap "Resume claiming" to make changes.
        </div>
      )}

      {/* Progress */}
      <div style={s.progressWrap}>
        <div style={s.progressOuter}>
          <div style={{ ...s.progressFill, width: `${Math.min(fillPct, 100)}%`, backgroundColor: allItemsClaimed ? '#27500A' : 'var(--text-primary)' }}>
            {fillPct >= 30 && (
              <span style={{ ...s.progressTextInside, color: allItemsClaimed ? '#fff' : 'var(--bg-primary)' }}>
                {allItemsClaimed ? 'All items claimed ✓' : `$${claimedTotal.toFixed(0)} / $${grandTotal.toFixed(0)} claimed`}
              </span>
            )}
          </div>
          {fillPct < 30 && grandTotal > 0 && (
            <span style={s.progressTextOutside}>${claimedTotal.toFixed(0)} / ${grandTotal.toFixed(0)} claimed</span>
          )}
        </div>
        <div style={s.progressHint}>
          Tap + to claim · tap › to expand and split individual units
        </div>
      </div>

      {/* Venue blocks */}
      {[...venues].sort((a, b) => {
        const ao = a.order ?? (a.name === 'Transport' || a.isTransport ? 9999 : 0);
        const bo = b.order ?? (b.name === 'Transport' || b.isTransport ? 9999 : 0);
        return ao - bo;
      }).map(venue => {
        const isVenueFullyClaimed = venue.items.length > 0 && venue.items.every(
          item => claimsFor(item.id).length >= (item.quantity ?? 1)
        );
        return (
        <div key={venue.id} style={s.venueBlock}>
          <div style={s.venueHeader}>
            <span>{venue.name}</span>
            {isVenueFullyClaimed && (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" fill="#EAF3DE"/>
                <path d="M5 8L7 10L11 6" stroke="#27500A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
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
                <div style={{ ...s.itemRow, cursor: 'pointer' }} onClick={() => toggleItem(item.id)}>
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
                      style={{ ...s.ctrlBtn, opacity: (myCnt === 0 || isDoneClaiming) ? 0.25 : 1 }}
                      onClick={e => { e.stopPropagation(); !isDoneClaiming && myCnt > 0 && handleUnclaim(item); }}
                    >−</span>
                    <span style={s.ctrlCount}>{myCnt}</span>
                    <span
                      style={{ ...s.ctrlBtn, opacity: (allClaimed || isDoneClaiming) ? 0.25 : 1 }}
                      onClick={e => { e.stopPropagation(); !isDoneClaiming && !allClaimed && handleClaim(item); }}
                    >+</span>
                    <span style={s.chevron}>
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
        );
      })}

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
                    {member.doneClaiming && (
                      <span style={s.doneClaimingPill}>Done claiming</span>
                    )}
                  </div>
                  <div style={s.personRight}>
                    <span style={s.personTotal}>${total.toFixed(2)}</span>
                    <motion.div
                      animate={{ rotate: isExp ? 90 : 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      style={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'var(--text-tertiary)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </motion.div>
                  </div>
                </div>
                <AnimatePresence initial={false}>
                {isExp && (
                  <motion.div
                    key="person-items"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
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
                  </motion.div>
                )}
                </AnimatePresence>
              </div>
            );
          })}
          </div>
        </div>
      )}

      {/* Done claiming — non-creator only */}
      {!isCreator && currentMemberId && (
        <button
          style={{
            ...s.finaliseBtn,
            marginTop: '16px',
            backgroundColor: isDoneClaiming ? 'var(--bg-secondary)' : 'var(--text-primary)',
            color: isDoneClaiming ? 'var(--text-primary)' : 'var(--bg-primary)',
            border: isDoneClaiming ? '0.5px solid var(--border-color)' : 'none',
          }}
          onClick={handleDoneClaiming}
        >
          {isDoneClaiming ? 'Resume claiming' : 'Done claiming'}
        </button>
      )}

      {/* Finalise — creator only */}
      {isCreator && (
        <div style={{ marginTop: '16px' }}>
          <button
            style={{ ...s.finaliseBtn, opacity: (finaliseLoading || session?.editingItems) ? 0.6 : 1 }}
            onClick={handleFinalise}
            disabled={finaliseLoading || !!session?.editingItems}
          >
            {finaliseLoading ? 'Finalising…' : 'Finalise & lock session'}
          </button>
          {session?.editingItems && !finaliseLoading && (
            <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
              Items are being edited — wait for changes to be saved
            </div>
          )}
        </div>
      )}

      {/* Editing overlay — shown to everyone except the person editing */}
      {session?.editingItems && session?.editingBy !== currentMemberId && (
        <div style={s.editingOverlay}>
          <div style={s.editingOverlayCard}>
            <div style={s.editingOverlayTitle}>{session.name}</div>
            <div style={s.editingOverlayBody}>
              Items are being updated by {session.editingByName ?? 'someone'}. The session will resume shortly.
            </div>
          </div>
        </div>
      )}

      {/* Three-dot menu sheet */}
      {menuOpen && (() => {
        const menuItems = [
          { icon: '🔗', label: 'Copy link to session', action: handleCopyLink },
          ...(isCreator ? [
            { icon: '✏️', label: 'Rename session', action: () => { setMenuOpen(false); setRenameValue(session?.name ?? ''); setRenameOpen(true); } },
            { icon: '👥', label: 'Manage people', action: () => { setMenuOpen(false); navigateForward(`/session/${sessionId}/manage-people`); } },
            { icon: '🏦', label: 'Manage bill payers', action: () => { setMenuOpen(false); setBillPayersSheetOpen(true); } },
            { icon: '📤', label: 'Export order log', action: handleExport },
            { icon: '🖊️', label: 'Edit items', action: async () => {
              setMenuOpen(false);
              try {
                await updateDoc(doc(db, 'sessions', sessionId), { editingItems: true, editingBy: currentMemberId, editingByName: currentMemberName });
                navigateForward(`/session/${sessionId}/edit-items`);
              } catch (err) { console.error(err); }
            }},
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

      {/* Manage bill payers sheet */}
      {billPayersSheetOpen && (
        <>
          <div style={s.backdrop} onClick={() => setBillPayersSheetOpen(false)} />
          <div style={s.sheet}>
            <div style={s.sheetHandle} />
            <div style={s.sheetTitle}>Manage bill payers</div>
            <div style={s.sheetSubtitle}>Set who paid for each venue.</div>
            {(() => {
              const nonTransportVenues = venues.filter(v => v.name !== 'Transport' && !v.isTransport);
              const transportVenue = venues.find(v => v.name === 'Transport' || v.isTransport);
              return (
                <>
                  {nonTransportVenues.map(venue => (
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
                  {transportVenue && transportVenue.items.map(item => (
                    <div key={item.id} style={{ marginBottom: '16px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                        {item.name}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {members.map(m => {
                          const sel = cabItemPayers[item.id] === m.id;
                          return (
                            <button
                              key={m.id}
                              style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontFamily: 'system-ui, -apple-system, sans-serif', border: '0.5px solid var(--border-color)', backgroundColor: sel ? 'var(--text-primary)' : 'var(--bg-secondary)', color: sel ? 'var(--bg-primary)' : 'var(--text-primary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                              onClick={() => handleSetCabItemPayer(transportVenue.id, item.id, m.id)}
                            >
                              {m.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </>
              );
            })()}
            <button style={s.sheetConfirmBtn} onClick={() => setBillPayersSheetOpen(false)}>Done</button>
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

            <button
              style={{
                width: '100%', backgroundColor: 'transparent',
                border: '1px solid var(--border-color)', borderRadius: '8px',
                padding: '10px', fontSize: '13px', fontWeight: 500,
                color: 'var(--text-primary)', cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '12px',
              }}
              onClick={() => {
                const allSelected = members.every(m => sharedSelected.includes(m.id));
                setSharedSelected(allSelected ? [] : members.map(m => m.id));
              }}
            >
              {members.every(m => sharedSelected.includes(m.id)) ? 'Deselect all' : 'Split between all'}
            </button>

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
  notYouBtn: {
    background: 'none', border: 'none', fontSize: '10px', color: 'var(--text-tertiary)',
    textDecoration: 'underline', cursor: 'pointer', padding: '1px 0 0',
    fontFamily: 'system-ui, -apple-system, sans-serif', display: 'block',
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
  progressOuter: {
    height: '28px', backgroundColor: 'var(--bg-secondary)',
    borderRadius: '14px', overflow: 'hidden', marginBottom: '6px',
    position: 'relative', display: 'flex', alignItems: 'center',
  },
  progressFill: {
    height: '100%', backgroundColor: 'var(--text-primary)',
    borderRadius: '14px', transition: 'width 0.3s ease',
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
    paddingRight: '10px', boxSizing: 'border-box', minWidth: 0,
    position: 'relative',
  },
  progressTextInside: {
    fontSize: '11px', fontWeight: 600, color: 'var(--bg-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    whiteSpace: 'nowrap', overflow: 'hidden',
  },
  progressTextOutside: {
    fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    paddingLeft: '12px', whiteSpace: 'nowrap',
    position: 'absolute', left: 0,
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
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
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
  doneClaimingPill: {
    fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px',
    backgroundColor: '#EAF3DE', color: '#27500A',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    display: 'inline-block', verticalAlign: 'middle', marginLeft: '4px', flexShrink: 0,
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
  frozenBanner: {
    backgroundColor: '#FAEEDA',
    color: '#633806',
    fontSize: '12px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '10px 14px',
    borderRadius: '8px',
    marginBottom: '12px',
    lineHeight: 1.4,
  },
  editingOverlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
    zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '24px',
  },
  editingOverlayCard: {
    backgroundColor: 'var(--bg-primary)', borderRadius: '16px',
    padding: '24px', maxWidth: '320px', width: '100%', textAlign: 'center',
  },
  editingOverlayTitle: {
    fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '10px',
  },
  editingOverlayBody: {
    fontSize: '14px', color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif', lineHeight: 1.5,
  },
};

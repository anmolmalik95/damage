import { useState, useEffect, useRef, Fragment } from 'react';
import { useParams } from 'react-router-dom';
import { useNavigation } from '../context/NavigationContext';
import {
  doc, getDocs, collection, updateDoc, deleteDoc, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import PageContainer from '../components/PageContainer';

export default function EditItems() {
  const { sessionId } = useParams();
  const { navigateForward, navigateBack } = useNavigation();

  const currentMemberId = localStorage.getItem(`member_${sessionId}`);

  const [venues, setVenues] = useState([]);
  const [cabs, setCabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletedItemIds, setDeletedItemIds] = useState({}); // { [venueId]: Set<firestoreId> }
  const [editingKey, setEditingKey] = useState(null);
  const [rescanStep, setRescanStep] = useState(0);

  const hasExplicitlyClearedRef = useRef(false);

  useEffect(() => {
    async function load() {
      const venuesSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues'));
      const venueList = await Promise.all(
        venuesSnap.docs.map(async vDoc => {
          const itemsSnap = await getDocs(
            collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items')
          );
          return {
            id: vDoc.id,
            ...vDoc.data(),
            items: itemsSnap.docs.map(d => ({
              firestoreId: d.id,
              id: d.id,
              name: d.data().name ?? '',
              quantity: d.data().quantity ?? 1,
              unitPrice: d.data().unitPrice ?? 0,
              originalQuantity: d.data().quantity ?? 1,
            })),
          };
        })
      );
      setVenues(venueList);
      setLoading(false);
    }
    load();

    return () => {
      if (!hasExplicitlyClearedRef.current) {
        updateDoc(doc(db, 'sessions', sessionId), {
          editingItems: false, editingBy: null, editingByName: null,
        }).catch(() => {});
      }
    };
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateItem(venueId, itemId, field, value) {
    setVenues(prev => prev.map(v =>
      v.id !== venueId ? v : {
        ...v,
        items: v.items.map(i => i.id === itemId ? { ...i, [field]: value } : i),
      }
    ));
  }

  function deleteItem(venueId, itemId) {
    const venue = venues.find(v => v.id === venueId);
    const item = venue?.items.find(i => i.id === itemId);
    if (!item) return;

    if (item.firestoreId) {
      setDeletedItemIds(prev => {
        const s = new Set(prev[venueId] ?? []);
        s.add(item.firestoreId);
        return { ...prev, [venueId]: s };
      });
    }
    setVenues(prev => prev.map(v =>
      v.id !== venueId ? v : { ...v, items: v.items.filter(i => i.id !== itemId) }
    ));
    setEditingKey(null);
  }

  function addCab() {
    setCabs(prev => [...prev, { id: `cab_${Date.now()}`, from: '', to: '', price: '', paidByName: '' }]);
  }

  function updateCab(id, field, value) {
    setCabs(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  }

  function removeCab(id) {
    setCabs(prev => prev.filter(c => c.id !== id));
  }

  function cabName(cab) {
    const from = cab.from.trim();
    const to = cab.to.trim();
    if (from && to) return `Cab from ${from} to ${to}`;
    if (from) return `Cab from ${from}`;
    if (to) return `Cab to ${to}`;
    return 'Cab';
  }

  function addItem(venueId) {
    const newId = `new_${Date.now()}`;
    setVenues(prev => prev.map(v =>
      v.id !== venueId ? v : {
        ...v,
        items: [...v.items, { id: newId, firestoreId: null, name: '', quantity: 1, unitPrice: 0, originalQuantity: 0 }],
      }
    ));
    setEditingKey(`${venueId}_${newId}`);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const claimsSnap = await getDocs(collection(db, 'sessions', sessionId, 'claims'));
      const allClaims = claimsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const batch = writeBatch(db);

      for (const venue of venues) {
        const deletedIds = deletedItemIds[venue.id] ?? new Set();

        // Handle deleted items (already removed from UI state, but we need to write deletes)
        for (const deletedId of deletedIds) {
          batch.delete(doc(db, 'sessions', sessionId, 'venues', venue.id, 'items', deletedId));
          const itemClaims = allClaims.filter(c => c.itemId === deletedId);
          itemClaims.forEach(c => batch.delete(doc(db, 'sessions', sessionId, 'claims', c.id)));
        }

        for (const item of venue.items) {
          if (!item.firestoreId) {
            // New item
            if (!item.name.trim()) continue;
            const newRef = doc(collection(db, 'sessions', sessionId, 'venues', venue.id, 'items'));
            batch.set(newRef, {
              name: item.name.trim(),
              quantity: Number(item.quantity) || 1,
              unitPrice: Number(item.unitPrice) || 0,
              totalPrice: (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0),
            });
          } else {
            // Existing item — check if quantity reduced
            const itemClaims = allClaims.filter(c => c.itemId === item.firestoreId);
            const newQty = Number(item.quantity) || 1;
            if (itemClaims.length > newQty) {
              // Sort: whole first, newest first within type, then delete excess
              const sorted = [...itemClaims].sort((a, b) => {
                if (a.type !== b.type) return a.type === 'whole' ? -1 : 1;
                return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
              });
              const toDelete = sorted.slice(0, itemClaims.length - newQty);
              toDelete.forEach(c => batch.delete(doc(db, 'sessions', sessionId, 'claims', c.id)));
            }
            batch.update(doc(db, 'sessions', sessionId, 'venues', venue.id, 'items', item.firestoreId), {
              name: item.name.trim() || item.name,
              quantity: newQty,
              unitPrice: Number(item.unitPrice) || 0,
              totalPrice: newQty * (Number(item.unitPrice) || 0),
            });
          }
        }
      }

      // Add new cabs to Transport venue
      const validCabs = cabs.filter(c => parseFloat(c.price) > 0);
      if (validCabs.length > 0) {
        const transportVenue = venues.find(v => v.name === 'Transport' || v.isTransport);
        if (transportVenue) {
          for (const cab of validCabs) {
            const cabRef = doc(collection(db, 'sessions', sessionId, 'venues', transportVenue.id, 'items'));
            batch.set(cabRef, {
              name: cabName(cab),
              quantity: 1,
              unitPrice: parseFloat(cab.price) || 0,
              totalPrice: parseFloat(cab.price) || 0,
              ...(cab.paidByName.trim() ? { paidByName: cab.paidByName.trim() } : {}),
            });
          }
        } else {
          const tvRef = doc(collection(db, 'sessions', sessionId, 'venues'));
          batch.set(tvRef, {
            name: 'Transport', isTransport: true, gstPercent: null, gstAmount: 0,
            serviceChargePercent: null, serviceChargeAmount: 0, receiptTotal: 0,
            createdAt: serverTimestamp(),
          });
          for (const cab of validCabs) {
            const cabRef = doc(collection(db, 'sessions', sessionId, 'venues', tvRef.id, 'items'));
            batch.set(cabRef, {
              name: cabName(cab),
              quantity: 1,
              unitPrice: parseFloat(cab.price) || 0,
              totalPrice: parseFloat(cab.price) || 0,
              ...(cab.paidByName.trim() ? { paidByName: cab.paidByName.trim() } : {}),
            });
          }
        }
      }

      batch.update(doc(db, 'sessions', sessionId), {
        editingItems: false, editingBy: null, editingByName: null,
      });

      await batch.commit();
      hasExplicitlyClearedRef.current = true;
      navigateBack(`/session/${sessionId}/claim`);
    } catch (err) {
      console.error(err);
      setSaving(false);
    }
  }

  async function handleRescanConfirm() {
    try {
      await updateDoc(doc(db, 'sessions', sessionId), {
        editingItems: false, editingBy: null, editingByName: null,
      });
      hasExplicitlyClearedRef.current = true;
      navigateForward(`/session/${sessionId}/upload`);
    } catch (err) { console.error(err); }
  }

  if (loading) return null;

  return (
    <PageContainer>
      <div style={st.header}>
        <div>
          <div style={st.title}>Edit items</div>
          <div style={st.subtitle}>Tap any item to edit. Changes apply immediately on save.</div>
        </div>
      </div>

      {venues.map(venue => (
        <Fragment key={venue.id}>
          <div style={st.venueBlock}>
            <div style={st.venueHeader}>
              <span style={st.venueName}>{venue.name}</span>
            </div>

            {venue.items.map(item => {
              const key = `${venue.id}_${item.id}`;
              const isEditing = editingKey === key;

              if (!isEditing) {
                return (
                  <div key={item.id} style={st.itemRow} onClick={() => setEditingKey(key)}>
                    <div style={{ flex: 1 }}>
                      <div style={st.itemName}>{item.name || 'Unnamed item'}</div>
                      <div style={st.itemMeta}>×{item.quantity} · ${Number(item.unitPrice).toFixed(2)}</div>
                    </div>
                    <button style={st.editBtn} onClick={e => { e.stopPropagation(); setEditingKey(key); }}>✎</button>
                  </div>
                );
              }

              return (
                <div key={item.id} style={st.itemRowEdit}>
                  <input
                    autoFocus
                    style={st.itemNameInput}
                    value={item.name}
                    onChange={e => updateItem(venue.id, item.id, 'name', e.target.value)}
                    placeholder="Item name"
                  />
                  <div style={st.editRow}>
                    <span style={st.editLabel}>Qty</span>
                    <div style={st.qtyControls}>
                      <button
                        style={{ ...st.qtyBtn, opacity: item.quantity <= 1 ? 0.25 : 1 }}
                        onClick={() => { const q = Number(item.quantity) - 1; if (q >= 1) updateItem(venue.id, item.id, 'quantity', q); }}
                      >−</button>
                      <span style={st.qtyCount}>{item.quantity}</span>
                      <button
                        style={st.qtyBtn}
                        onClick={() => updateItem(venue.id, item.id, 'quantity', Number(item.quantity) + 1)}
                      >+</button>
                    </div>
                  </div>
                  <div style={st.editRow}>
                    <span style={st.editLabel}>Unit price</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      style={st.priceInput}
                      value={item.unitPrice}
                      onChange={e => updateItem(venue.id, item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div style={st.editActions}>
                    <button style={st.deleteLink} onClick={() => deleteItem(venue.id, item.id)}>Delete item</button>
                    <button style={st.doneLink} onClick={() => setEditingKey(null)}>Done</button>
                  </div>
                </div>
              );
            })}

            <button style={st.addItemLink} onClick={() => addItem(venue.id)}>
              + Add item to {venue.name}
            </button>
          </div>
        </Fragment>
      ))}

      {/* Add cabs */}
      {cabs.length > 0 && (
        <div style={st.cabsBlock}>
          <div style={st.cabsHeader}>Add cabs / transport</div>
          {cabs.map(cab => (
            <div key={cab.id} style={{ marginBottom: '8px' }}>
              <div style={st.cabRow}>
                <input style={{ ...st.cabInput, flex: 1 }} type="text" value={cab.from} onChange={e => updateCab(cab.id, 'from', e.target.value)} placeholder="From" />
                <input style={{ ...st.cabInput, flex: 1 }} type="text" value={cab.to} onChange={e => updateCab(cab.id, 'to', e.target.value)} placeholder="To" />
                <input style={{ ...st.cabInput, width: '72px' }} type="number" value={cab.price} step="0.01" min="0" onChange={e => updateCab(cab.id, 'price', e.target.value)} placeholder="$0.00" />
                <button style={st.cabRemoveBtn} onClick={() => removeCab(cab.id)}>×</button>
              </div>
              <div style={st.cabPayerRow}>
                <span style={st.cabPayerLabel}>Paid by</span>
                <input style={st.cabPayerInput} type="text" value={cab.paidByName} onChange={e => updateCab(cab.id, 'paidByName', e.target.value)} placeholder="Name" />
              </div>
            </div>
          ))}
        </div>
      )}
      <button style={st.addCabBtn} onClick={addCab}>+ Add cab</button>

      <div style={st.bottomBtns}>
        <button
          style={{ ...st.saveBtn, opacity: saving ? 0.6 : 1 }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button style={st.rescanBtn} onClick={() => setRescanStep(1)}>
          Re-scan receipt
        </button>
      </div>

      {/* Re-scan confirmation */}
      {rescanStep === 1 && (
        <div style={st.backdrop} onClick={() => setRescanStep(0)}>
          <div style={st.sheet} onClick={e => e.stopPropagation()}>
            <div style={st.sheetHandle} />
            <div style={st.sheetTitle}>Re-scan receipt?</div>
            <div style={st.sheetBody}>
              This will take you back to the upload screen. All current items will be overwritten when you confirm the new scan.
            </div>
            <button style={{ ...st.sheetBtn, backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)' }} onClick={() => setRescanStep(2)}>
              Continue
            </button>
            <button style={{ ...st.sheetBtn, backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', marginTop: '8px' }} onClick={() => setRescanStep(0)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {rescanStep === 2 && (
        <div style={st.backdrop} onClick={() => setRescanStep(0)}>
          <div style={st.sheet} onClick={e => e.stopPropagation()}>
            <div style={st.sheetHandle} />
            <div style={st.sheetTitle}>Are you sure?</div>
            <div style={st.sheetBody}>
              All existing items and claims will be replaced once you confirm the new receipts.
            </div>
            <button style={{ ...st.sheetBtn, backgroundColor: 'var(--color-danger)', color: '#fff' }} onClick={handleRescanConfirm}>
              Yes, re-scan
            </button>
            <button style={{ ...st.sheetBtn, backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', marginTop: '8px' }} onClick={() => setRescanStep(0)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

const st = {
  header: { marginBottom: '20px' },
  title: { fontSize: '20px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  subtitle: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '4px' },
  venueBlock: { borderRadius: '12px', overflow: 'hidden', border: '0.5px solid var(--border-color)', marginBottom: '16px' },
  venueHeader: { backgroundColor: 'var(--bg-secondary)', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  venueName: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  itemRow: { display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '0.5px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', cursor: 'pointer', gap: '8px' },
  itemRowEdit: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 14px', borderBottom: '0.5px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' },
  itemName: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '2px' },
  itemMeta: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  editBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--text-tertiary)', flexShrink: 0, padding: '4px' },
  itemNameInput: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', border: 'none', borderBottom: '1px solid var(--border-color)', backgroundColor: 'transparent', outline: 'none', width: '100%', padding: '0 0 3px' },
  editRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  editLabel: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  qtyControls: { display: 'flex', alignItems: 'center', gap: '14px' },
  qtyBtn: { background: 'none', border: 'none', fontSize: '18px', color: 'var(--text-primary)', cursor: 'pointer', padding: '0', lineHeight: 1 },
  qtyCount: { fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', minWidth: '20px', textAlign: 'center' },
  priceInput: { border: 'none', borderBottom: '1px solid var(--border-color)', backgroundColor: 'transparent', outline: 'none', textAlign: 'right', fontSize: '13px', color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', width: '80px', padding: '0 0 2px', colorScheme: 'light dark' },
  editActions: { display: 'flex', justifyContent: 'space-between' },
  deleteLink: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--color-danger)', fontFamily: 'system-ui, -apple-system, sans-serif', padding: 0 },
  doneLink: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', padding: 0 },
  addItemLink: { display: 'block', width: '100%', padding: '10px 14px', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--bg-primary)', border: 'none', borderTop: '0.5px dashed var(--border-color)', textAlign: 'center', cursor: 'pointer', boxSizing: 'border-box' },
  cabsBlock: { backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', padding: '12px 14px', marginBottom: '8px' },
  cabsHeader: { fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' },
  cabRow: { display: 'flex', gap: '6px', alignItems: 'center' },
  cabInput: { padding: '7px 8px', fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '6px', outline: 'none', colorScheme: 'light dark', minWidth: 0 },
  cabRemoveBtn: { width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '0.5px solid var(--border-color)', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
  cabPayerRow: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' },
  cabPayerLabel: { fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', flexShrink: 0, minWidth: '44px' },
  cabPayerInput: { padding: '5px 8px', fontSize: '12px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '6px', outline: 'none', colorScheme: 'light dark', flex: 1 },
  addCabBtn: { width: '100%', padding: '10px', fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif', color: 'var(--text-secondary)', backgroundColor: 'transparent', border: '0.5px dashed var(--border-color)', borderRadius: '8px', cursor: 'pointer', marginBottom: '8px', textAlign: 'center' },
  bottomBtns: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', paddingBottom: '16px' },
  saveBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', borderRadius: '8px', cursor: 'pointer' },
  rescanBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', color: 'var(--text-secondary)', border: '0.5px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer' },
  backdrop: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  sheet: { width: '100%', maxWidth: '480px', backgroundColor: 'var(--bg-primary)', borderRadius: '16px 16px 0 0', padding: '12px 16px 36px' },
  sheetHandle: { width: '36px', height: '4px', borderRadius: '2px', backgroundColor: 'var(--border-color)', margin: '0 auto 16px' },
  sheetTitle: { fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '8px' },
  sheetBody: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '20px', lineHeight: 1.5 },
  sheetBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'block' },
};

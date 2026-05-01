import { useState, useEffect, useRef, Fragment } from 'react';
import { useParams } from 'react-router-dom';
import { useNavigation } from '../context/NavigationContext';
import {
  doc, getDocs, collection, updateDoc, deleteDoc, writeBatch, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import PageContainer from '../components/PageContainer';
import SkeletonBlock from '../components/SkeletonBlock';

function parseCabName(name) {
  const fromToMatch = name.match(/^Cab from (.+?) to (.+)$/);
  if (fromToMatch) return { from: fromToMatch[1], to: fromToMatch[2] };
  const fromMatch = name.match(/^Cab from (.+)$/);
  if (fromMatch) return { from: fromMatch[1], to: '' };
  const toMatch = name.match(/^Cab to (.+)$/);
  if (toMatch) return { from: '', to: toMatch[1] };
  return { from: '', to: '' };
}

function buildCabName(from, to) {
  const f = from.trim(), t = to.trim();
  if (f && t) return `Cab from ${f} to ${t}`;
  if (f) return `Cab from ${f}`;
  if (t) return `Cab to ${t}`;
  return 'Cab';
}

export default function EditItems() {
  const { sessionId } = useParams();
  const { navigateForward, navigateBack } = useNavigation();

  const currentMemberId = localStorage.getItem(`member_${sessionId}`);
  const currentMemberName = localStorage.getItem(`memberName_${sessionId}`);

  const [venues, setVenues] = useState([]);
  const [newCabs, setNewCabs] = useState([]); // new cabs to add to transport
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletedItemIds, setDeletedItemIds] = useState({}); // { [venueId]: Set<firestoreId> }
  const [deletedVenueIds, setDeletedVenueIds] = useState(() => new Set());
  const [editingKey, setEditingKey] = useState(null);
  const [editingVenueNameId, setEditingVenueNameId] = useState(null);
  const [editingVenueNameValue, setEditingVenueNameValue] = useState('');
  const [deleteConfirmVenueId, setDeleteConfirmVenueId] = useState(null);
  const [rescanStep, setRescanStep] = useState(0);

  const hasExplicitlyClearedRef = useRef(false);

  useEffect(() => {
    async function load() {
      const venuesSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues'));
      const venueList = await Promise.all(
        venuesSnap.docs.map(async vDoc => {
          const isTransport = vDoc.data().name === 'Transport' || vDoc.data().isTransport;
          const itemsSnap = await getDocs(
            collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items')
          );
          return {
            id: vDoc.id,
            ...vDoc.data(),
            isRenamed: false,
            isNew: false,
            items: itemsSnap.docs.map(d => {
              const base = {
                firestoreId: d.id,
                id: d.id,
                name: d.data().name ?? '',
                quantity: d.data().quantity ?? 1,
                unitPrice: d.data().unitPrice ?? 0,
                originalQuantity: d.data().quantity ?? 1,
              };
              if (isTransport) {
                const { from, to } = parseCabName(base.name);
                return { ...base, _from: from, _to: to };
              }
              return base;
            }),
          };
        })
      );
      setVenues(venueList);
      setLoading(false);
    }
    load().catch(err => {
      console.error(err);
      setError(true);
      setLoading(false);
    });

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

  function updateCabField(venueId, itemId, field, value) {
    setVenues(prev => prev.map(v =>
      v.id !== venueId ? v : {
        ...v,
        items: v.items.map(i => {
          if (i.id !== itemId) return i;
          const newFrom = field === 'from' ? value : (i._from ?? '');
          const newTo = field === 'to' ? value : (i._to ?? '');
          return { ...i, [field === 'from' ? '_from' : '_to']: value, name: buildCabName(newFrom, newTo) };
        }),
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

  function addNewCab() {
    setNewCabs(prev => [...prev, { id: `cab_${Date.now()}`, from: '', to: '', price: '' }]);
  }

  function updateNewCab(id, field, value) {
    setNewCabs(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  }

  function removeNewCab(id) {
    setNewCabs(prev => prev.filter(c => c.id !== id));
  }

  function addVenue() {
    const tempId = `new_venue_${Date.now()}`;
    setVenues(prev => [...prev, {
      id: tempId, name: '', isNew: true, isRenamed: false,
      gstPercent: null, gstAmount: 0, serviceChargePercent: null, serviceChargeAmount: 0,
      receiptTotal: 0, items: [],
    }]);
    setEditingVenueNameId(tempId);
    setEditingVenueNameValue('');
  }

  function startRenameVenue(venueId, currentName) {
    setEditingVenueNameId(venueId);
    setEditingVenueNameValue(currentName);
  }

  function commitRenameVenue(venueId) {
    setVenues(prev => prev.map(v =>
      v.id !== venueId ? v : { ...v, name: editingVenueNameValue.trim() || v.name, isRenamed: true }
    ));
    setEditingVenueNameId(null);
  }

  function confirmDeleteVenue(venueId) {
    const venue = venues.find(v => v.id === venueId);
    if (!venue) return;
    setVenues(prev => prev.filter(v => v.id !== venueId));
    if (!venue.isNew) {
      setDeletedVenueIds(prev => new Set([...prev, venueId]));
    }
    setDeleteConfirmVenueId(null);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const claimsSnap = await getDocs(collection(db, 'sessions', sessionId, 'claims'));
      const allClaims = claimsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const batch = writeBatch(db);

      // Delete entire venues (cascade: items → claims → venue)
      for (const venueId of deletedVenueIds) {
        const itemsSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues', venueId, 'items'));
        for (const itemDoc of itemsSnap.docs) {
          const itemClaims = allClaims.filter(c => c.itemId === itemDoc.id);
          itemClaims.forEach(c => batch.delete(doc(db, 'sessions', sessionId, 'claims', c.id)));
          batch.delete(itemDoc.ref);
        }
        batch.delete(doc(db, 'sessions', sessionId, 'venues', venueId));
      }

      for (const venue of venues) {
        if (venue.isNew) {
          // Create new venue
          if (!venue.name.trim()) continue;
          const newVenueRef = doc(collection(db, 'sessions', sessionId, 'venues'));
          batch.set(newVenueRef, {
            name: venue.name.trim(),
            gstPercent: null, gstAmount: 0,
            serviceChargePercent: null, serviceChargeAmount: 0,
            receiptTotal: 0, order: 999,
            createdAt: serverTimestamp(),
          });
          for (const item of venue.items.filter(i => i.name.trim())) {
            batch.set(doc(collection(db, 'sessions', sessionId, 'venues', newVenueRef.id, 'items')), {
              name: item.name.trim(),
              quantity: Number(item.quantity) || 1,
              unitPrice: Number(item.unitPrice) || 0,
              totalPrice: (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0),
            });
          }
          continue;
        }

        // Rename existing venue
        if (venue.isRenamed && venue.name.trim()) {
          batch.update(doc(db, 'sessions', sessionId, 'venues', venue.id), { name: venue.name.trim() });
        }

        const deletedIds = deletedItemIds[venue.id] ?? new Set();

        for (const deletedId of deletedIds) {
          batch.delete(doc(db, 'sessions', sessionId, 'venues', venue.id, 'items', deletedId));
          const itemClaims = allClaims.filter(c => c.itemId === deletedId);
          itemClaims.forEach(c => batch.delete(doc(db, 'sessions', sessionId, 'claims', c.id)));
        }

        for (const item of venue.items) {
          if (!item.firestoreId) {
            if (!item.name.trim()) continue;
            const newRef = doc(collection(db, 'sessions', sessionId, 'venues', venue.id, 'items'));
            batch.set(newRef, {
              name: item.name.trim(),
              quantity: Number(item.quantity) || 1,
              unitPrice: Number(item.unitPrice) || 0,
              totalPrice: (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0),
            });
          } else {
            const itemClaims = allClaims.filter(c => c.itemId === item.firestoreId);
            const newQty = Number(item.quantity) || 1;
            if (itemClaims.length > newQty) {
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
      const validNewCabs = newCabs.filter(c => parseFloat(c.price) > 0);
      if (validNewCabs.length > 0) {
        const transportVenue = venues.find(v => v.name === 'Transport' || v.isTransport);
        let transportId = transportVenue?.id;

        if (transportVenue && !transportVenue.isNew) {
          for (const cab of validNewCabs) {
            batch.set(doc(collection(db, 'sessions', sessionId, 'venues', transportId, 'items')), {
              name: buildCabName(cab.from, cab.to),
              quantity: 1,
              unitPrice: parseFloat(cab.price) || 0,
              totalPrice: parseFloat(cab.price) || 0,
            });
          }
        } else {
          const tvRef = doc(collection(db, 'sessions', sessionId, 'venues'));
          batch.set(tvRef, {
            name: 'Transport', isTransport: true, gstPercent: null, gstAmount: 0,
            serviceChargePercent: null, serviceChargeAmount: 0, receiptTotal: 0,
            order: 9999, createdAt: serverTimestamp(),
          });
          for (const cab of validNewCabs) {
            batch.set(doc(collection(db, 'sessions', sessionId, 'venues', tvRef.id, 'items')), {
              name: buildCabName(cab.from, cab.to),
              quantity: 1,
              unitPrice: parseFloat(cab.price) || 0,
              totalPrice: parseFloat(cab.price) || 0,
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

  if (loading || error) return (
    <PageContainer>
      <div style={st.header}>
        <div><div style={st.title}>Edit items</div></div>
      </div>
      {error ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '16px' }}>Failed to load items.</div>
          <button style={{ fontSize: '13px', color: 'var(--text-primary)', background: 'none', border: '0.5px solid var(--border-color)', borderRadius: '8px', padding: '8px 20px', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' }} onClick={() => { setError(false); setLoading(true); }}>Retry</button>
        </div>
      ) : (
        <>
          {[0, 1].map(vi => (
            <div key={vi} style={{ ...st.venueBlock, marginBottom: '16px' }}>
              <div style={{ ...st.venueHeader }}>
                <SkeletonBlock width="100px" height="13px" />
              </div>
              {[0, 1, 2, 3].map(ri => (
                <div key={ri} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '0.5px solid var(--border-color)', gap: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <SkeletonBlock width="60%" height="13px" style={{ marginBottom: '4px' }} />
                    <SkeletonBlock width="40%" height="11px" />
                  </div>
                  <SkeletonBlock width="20px" height="20px" borderRadius="4px" />
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </PageContainer>
  );

  const isTransportVenue = v => v.name === 'Transport' || v.isTransport;

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
              {editingVenueNameId === venue.id ? (
                <input
                  autoFocus
                  style={st.venueNameInput}
                  value={editingVenueNameValue}
                  onChange={e => setEditingVenueNameValue(e.target.value)}
                  onBlur={() => commitRenameVenue(venue.id)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRenameVenue(venue.id); }}
                  placeholder="Venue name"
                />
              ) : (
                <button
                  style={st.venueNameBtn}
                  onClick={() => !isTransportVenue(venue) && startRenameVenue(venue.id, venue.name)}
                >
                  {venue.name || 'Untitled venue'}
                  {!isTransportVenue(venue) && <span style={st.editVenueHint}> ✎</span>}
                </button>
              )}
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                {!isTransportVenue(venue) && (
                  <button style={st.rescanVenueBtn} onClick={() => setRescanStep(1)}>Re-scan</button>
                )}
                <button style={st.deleteVenueBtn} onClick={() => setDeleteConfirmVenueId(venue.id)}>
                  ✕ Remove
                </button>
              </div>
            </div>

            {isTransportVenue(venue) ? (
              <>
                {venue.items.map(item => (
                  <div key={item.id} style={st.cabEditRow}>
                    <input
                      style={{ ...st.cabInput, flex: 1 }}
                      type="text"
                      value={item._from ?? ''}
                      onChange={e => updateCabField(venue.id, item.id, 'from', e.target.value)}
                      placeholder="From"
                    />
                    <input
                      style={{ ...st.cabInput, flex: 1 }}
                      type="text"
                      value={item._to ?? ''}
                      onChange={e => updateCabField(venue.id, item.id, 'to', e.target.value)}
                      placeholder="To"
                    />
                    <input
                      style={{ ...st.cabInput, width: '70px' }}
                      type="number"
                      value={item.unitPrice}
                      step="0.01"
                      min="0"
                      onChange={e => updateItem(venue.id, item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                      placeholder="$0.00"
                    />
                    <button style={st.cabRemoveBtn} onClick={() => deleteItem(venue.id, item.id)}>×</button>
                  </div>
                ))}
                {newCabs.map(cab => (
                  <div key={cab.id} style={st.cabEditRow}>
                    <input
                      style={{ ...st.cabInput, flex: 1 }}
                      type="text"
                      value={cab.from}
                      onChange={e => updateNewCab(cab.id, 'from', e.target.value)}
                      placeholder="From"
                    />
                    <input
                      style={{ ...st.cabInput, flex: 1 }}
                      type="text"
                      value={cab.to}
                      onChange={e => updateNewCab(cab.id, 'to', e.target.value)}
                      placeholder="To"
                    />
                    <input
                      style={{ ...st.cabInput, width: '70px' }}
                      type="number"
                      value={cab.price}
                      step="0.01"
                      min="0"
                      onChange={e => updateNewCab(cab.id, 'price', e.target.value)}
                      placeholder="$0.00"
                    />
                    <button style={st.cabRemoveBtn} onClick={() => removeNewCab(cab.id)}>×</button>
                  </div>
                ))}
                <button style={st.addItemLink} onClick={addNewCab}>+ Add cab</button>
              </>
            ) : (
              <>
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
                  + Add item to {venue.name || 'venue'}
                </button>
              </>
            )}
          </div>
        </Fragment>
      ))}

      <button style={st.addVenueBtn} onClick={addVenue}>+ Add venue</button>

      <div style={st.bottomBtns}>
        <button
          style={{ ...st.saveBtn, opacity: saving ? 0.6 : 1 }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {/* Delete venue confirmation */}
      {deleteConfirmVenueId && (
        <div style={st.backdrop} onClick={() => setDeleteConfirmVenueId(null)}>
          <div style={st.sheet} onClick={e => e.stopPropagation()}>
            <div style={st.sheetHandle} />
            <div style={st.sheetTitle}>Remove this venue?</div>
            <div style={st.sheetBody}>
              All items and claims for this venue will be permanently deleted.
            </div>
            <button style={{ ...st.sheetBtn, backgroundColor: 'var(--color-danger)', color: '#fff' }} onClick={() => confirmDeleteVenue(deleteConfirmVenueId)}>
              Yes, remove venue
            </button>
            <button style={{ ...st.sheetBtn, backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', marginTop: '8px' }} onClick={() => setDeleteConfirmVenueId(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

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
  venueHeader: { backgroundColor: 'var(--bg-secondary)', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
  venueNameBtn: { background: 'none', border: 'none', padding: '0', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer', textAlign: 'left', flex: 1 },
  editVenueHint: { fontSize: '11px', color: 'var(--text-tertiary)' },
  venueNameInput: { flex: 1, padding: '4px 8px', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', border: '0.5px solid var(--border-color)', borderRadius: '6px', backgroundColor: 'var(--bg-primary)', outline: 'none', colorScheme: 'light dark' },
  rescanVenueBtn: { background: 'none', border: 'none', fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer', padding: '0', textDecoration: 'underline', flexShrink: 0 },
  deleteVenueBtn: { background: 'none', border: 'none', fontSize: '11px', color: 'var(--color-danger)', fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer', padding: '0', flexShrink: 0 },
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
  cabEditRow: { display: 'flex', gap: '6px', alignItems: 'center', padding: '8px 14px', borderBottom: '0.5px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' },
  cabInput: { padding: '7px 8px', fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '6px', outline: 'none', colorScheme: 'light dark', minWidth: 0 },
  cabRemoveBtn: { width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '0.5px solid var(--border-color)', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
  addVenueBtn: { width: '100%', padding: '11px', fontSize: '13px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', color: 'var(--text-primary)', backgroundColor: 'transparent', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer', marginBottom: '16px', textAlign: 'center' },
  bottomBtns: { display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '16px' },
  saveBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', borderRadius: '8px', cursor: 'pointer' },
  backdrop: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  sheet: { width: '100%', maxWidth: '480px', backgroundColor: 'var(--bg-primary)', borderRadius: '16px 16px 0 0', padding: '12px 16px 36px', paddingBottom: 'calc(36px + env(safe-area-inset-bottom))' },
  sheetHandle: { width: '36px', height: '4px', borderRadius: '2px', backgroundColor: 'var(--border-color)', margin: '0 auto 16px' },
  sheetTitle: { fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '8px' },
  sheetBody: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '20px', lineHeight: 1.5 },
  sheetBtn: { width: '100%', padding: '13px', fontSize: '14px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'block' },
};

import { useState, useEffect, useRef, Fragment } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { doc, getDoc, getDocs, collection, addDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import PageContainer from '../components/PageContainer';

const draftKey = id => `draft_confirm_${id}`;

function parsedToVenues(parsed) {
  return parsed.venues.map(v => ({
    name: v.venueName || v.name,
    gst: v.gst?.present ? v.gst : null,
    serviceCharge: v.serviceCharge?.present ? v.serviceCharge : null,
    receiptTotal: v.receiptTotal ?? 0,
    userReceiptTotal: String(v.receiptTotal ?? ''),
    items: (v.items || []).map((item, idx) => ({
      id: idx,
      name: item.name,
      quantity: item.quantity ?? 1,
      unitPrice: item.unitPrice ?? 0,
    })),
  }));
}

export default function ConfirmItems() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [session, setSession] = useState(null);
  const photoUrlsByVenue = location.state?.photoUrlsByVenue ?? {};
  const canRestore = sessionStorage.getItem(`canRestore_confirm_${sessionId}`) === 'true';
  const [venues, setVenues] = useState(() => {
    if (!canRestore) return [];
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey(sessionId)));
      if (Array.isArray(draft) && draft.length > 0) return draft;
    } catch {}
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingKey, setEditingKey] = useState(null);

  const venuesRef = useRef(venues);
  const editingValuesRef = useRef({ quantity: 0, unitPrice: 0, name: '' });
  const prevEditingKeyRef = useRef(null);

  // Keep venuesRef current so the editingKey effect can read live state without a stale closure.
  useEffect(() => { venuesRef.current = venues; }, [venues]);

  // Commit edited values to state whenever edit mode closes or switches to a different item.
  useEffect(() => {
    const prevKey = prevEditingKeyRef.current;
    if (prevKey !== null && prevKey !== editingKey) {
      const sep = prevKey.indexOf('_');
      const vi = parseInt(prevKey.slice(0, sep), 10);
      const itemId = parseInt(prevKey.slice(sep + 1), 10);
      const { quantity, unitPrice, name } = editingValuesRef.current;
      setVenues(prev => prev.map((v, i) =>
        i !== vi ? v : {
          ...v,
          items: v.items.map(item =>
            item.id !== itemId ? item : {
              ...item,
              quantity: Number(quantity),
              unitPrice: Number(unitPrice),
              name,
            }
          ),
        }
      ));
    }
    if (editingKey !== null) {
      const sep = editingKey.indexOf('_');
      const vi = parseInt(editingKey.slice(0, sep), 10);
      const itemId = parseInt(editingKey.slice(sep + 1), 10);
      const item = venuesRef.current[vi]?.items.find(i => i.id === itemId);
      if (item) {
        editingValuesRef.current = { quantity: item.quantity, unitPrice: item.unitPrice, name: item.name };
      }
    }
    prevEditingKeyRef.current = editingKey;
  }, [editingKey]);

  useEffect(() => {
    document.title = session?.name ? `Confirm items · ${session.name} — Unfuck` : 'Unfuck';
  }, [session?.name]);

  useEffect(() => {
    sessionStorage.removeItem(`canRestore_confirm_${sessionId}`);
    getDoc(doc(db, 'sessions', sessionId)).then(snap => {
      if (snap.exists()) setSession(snap.data());
    });
  }, [sessionId]);

  // If no draft: try Firestore, then fall back to navigation state
  useEffect(() => {
    if (venues.length > 0) return;

    async function load() {
      const vSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues'));
      if (!vSnap.empty) {
        const loaded = await Promise.all(
          vSnap.docs.map(async (vDoc, idx) => {
            const d = vDoc.data();
            const iSnap = await getDocs(collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items'));
            return {
              name: d.name,
              gst: d.gstPercent != null ? { percent: d.gstPercent, amount: d.gstAmount ?? null } : null,
              serviceCharge: d.serviceChargePercent != null ? { percent: d.serviceChargePercent, amount: d.serviceChargeAmount ?? null } : null,
              receiptTotal: d.receiptTotal ?? 0,
              userReceiptTotal: String(d.receiptTotal ?? ''),
              items: iSnap.docs.map((iDoc, iIdx) => ({
                id: iIdx,
                name: iDoc.data().name,
                quantity: iDoc.data().quantity ?? 1,
                unitPrice: iDoc.data().unitPrice ?? 0,
              })),
            };
          })
        );
        setVenues(loaded);
        return;
      }

      // Last resort: navigation state (raw parsed data)
      const { parsed } = location.state || {};
      if (parsed?.venues) setVenues(parsedToVenues(parsed));
    }

    load();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist every edit to sessionStorage
  useEffect(() => {
    if (venues.length > 0) {
      sessionStorage.setItem(draftKey(sessionId), JSON.stringify(venues));
    }
  }, [venues, sessionId]);

  function updateItem(vi, itemId, field, value) {
    setVenues(prev => prev.map((v, i) =>
      i !== vi ? v : {
        ...v,
        items: v.items.map(item =>
          item.id !== itemId ? item : { ...item, [field]: value }
        ),
      }
    ));
  }

  function deleteItem(vi, itemId) {
    setVenues(prev => prev.map((v, i) =>
      i !== vi ? v : { ...v, items: v.items.filter(item => item.id !== itemId) }
    ));
  }

  function addItem(vi) {
    const newId = Date.now();
    setVenues(prev => prev.map((v, i) =>
      i !== vi ? v : {
        ...v,
        items: [...v.items, { id: newId, name: '', quantity: 1, unitPrice: 0 }],
      }
    ));
    setEditingKey(`${vi}_${newId}`);
  }

  function toggleEdit(vi, itemId) {
    const key = `${vi}_${itemId}`;
    setEditingKey(prev => prev === key ? null : key);
  }

  function handleEditChange(field, value) {
    editingValuesRef.current = { ...editingValuesRef.current, [field]: value };
  }

  function updateVenueReceiptTotal(vi, value) {
    setVenues(prev => prev.map((v, i) =>
      i !== vi ? v : { ...v, userReceiptTotal: value }
    ));
  }

  function venueSubtotal(venue) {
    return venue.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  }

  function venueGstAmount(venue) {
    if (!venue.gst) return 0;
    if (venue.gst.amount != null) return venue.gst.amount;
    if (venue.gst.percent != null) return venueSubtotal(venue) * venue.gst.percent / 100;
    return 0;
  }

  function venueScAmount(venue) {
    if (!venue.serviceCharge) return 0;
    if (venue.serviceCharge.amount != null) return venue.serviceCharge.amount;
    if (venue.serviceCharge.percent != null) return venueSubtotal(venue) * venue.serviceCharge.percent / 100;
    return 0;
  }

  function venueTaxedTotal(venue) {
    return venueSubtotal(venue) + venueGstAmount(venue) + venueScAmount(venue);
  }

  async function handleConfirm() {
    setError('');
    setLoading(true);
    try {
      // Delete all existing venues and their items first (clean overwrite)
      const existingVenues = await getDocs(collection(db, 'sessions', sessionId, 'venues'));
      await Promise.all(
        existingVenues.docs.map(async venueDoc => {
          const items = await getDocs(collection(db, 'sessions', sessionId, 'venues', venueDoc.id, 'items'));
          await Promise.all(items.docs.map(d => deleteDoc(d.ref)));
          await deleteDoc(venueDoc.ref);
        })
      );

      // Write fresh data
      const total = venues.reduce((s, v) => s + venueTaxedTotal(v), 0);
      await Promise.all(
        venues.map(async venue => {
          const venueRef = await addDoc(collection(db, 'sessions', sessionId, 'venues'), {
            name: venue.name,
            gstPercent: venue.gst?.percent ?? null,
            gstAmount: venueGstAmount(venue),
            serviceChargePercent: venue.serviceCharge?.percent ?? null,
            serviceChargeAmount: venueScAmount(venue),
            receiptTotal: parseFloat(venue.userReceiptTotal) || venueTaxedTotal(venue),
            photoUrls: photoUrlsByVenue[venue.name] ?? [],
            createdAt: serverTimestamp(),
          });

          await Promise.all(
            venue.items.map(item =>
              addDoc(collection(db, 'sessions', sessionId, 'venues', venueRef.id, 'items'), {
                name: item.name,
                quantity: Number(item.quantity),
                unitPrice: Number(item.unitPrice),
                totalPrice: Number(item.quantity) * Number(item.unitPrice),
              })
            )
          );
        })
      );

      sessionStorage.setItem(`canRestore_confirm_${sessionId}`, 'true');
      navigate(`/session/${sessionId}/share`, { state: { total } });
    } catch (err) {
      setError('Failed to save. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageContainer>
      <div style={styles.header}>
        <button style={styles.back} onClick={() => navigate(`/session/${sessionId}/upload`)}>←</button>
        <div>
          <div style={styles.title}>Confirm items</div>
          {session && <div style={styles.subtitle}>{session.name}</div>}
        </div>
      </div>

      {venues
        .map((venue, vi) => ({ venue, vi }))
        .sort(({ venue: a }, { venue: b }) => {
          if (a.name === 'Transport' || a.isTransport) return 1;
          if (b.name === 'Transport' || b.isTransport) return -1;
          return 0;
        })
        .map(({ venue, vi }) => {
        const vParsed = venueTaxedTotal(venue);
        const vReceipt = parseFloat(venue.userReceiptTotal) || 0;
        const vDiff = Math.abs(vParsed - vReceipt);
        const vDiffOk = vDiff < 0.005;
        return (
          <Fragment key={vi}>
            <div style={styles.venueBlock}>
              <div style={styles.venueHeader}>
                <span style={styles.venueHeaderText}>{venue.name}</span>
                <span style={styles.venueEditHint}>Tap any item to edit</span>
              </div>

              {venue.items.map(item => (
                <ItemRow
                  key={item.id}
                  item={item}
                  isEditing={editingKey === `${vi}_${item.id}`}
                  onToggleEdit={() => toggleEdit(vi, item.id)}
                  onUpdate={(field, val) => updateItem(vi, item.id, field, val)}
                  onEditChange={handleEditChange}
                  onDelete={() => { deleteItem(vi, item.id); setEditingKey(null); }}
                />
              ))}

              <button style={styles.addItemLink} onClick={() => addItem(vi)}>
                + Add item to {venue.name}
              </button>

              <div style={styles.venueTotals}>
                <TotalRow label="Subtotal" value={venueSubtotal(venue)} />
                {venue.gst != null && (
                  <TotalRow
                    label={venue.gst.percent != null ? `GST (${venue.gst.percent}%)` : 'GST'}
                    value={venueGstAmount(venue)}
                  />
                )}
                {venue.serviceCharge != null && (
                  <TotalRow
                    label={venue.serviceCharge.percent != null ? `Service charge (${venue.serviceCharge.percent}%)` : 'Service charge'}
                    value={venueScAmount(venue)}
                  />
                )}
                <TotalRow label="Total" value={venueTaxedTotal(venue)} bold />
              </div>
            </div>

            {venue.name !== 'Transport' && (
              <div style={styles.compCard}>
                <div style={styles.compRow}>
                  <span style={styles.compLabel}>Parsed total</span>
                  <span style={styles.compValue}>${vParsed.toFixed(2)}</span>
                </div>
                <div style={styles.compRow}>
                  <span style={styles.compLabel}>Receipt total</span>
                  <input
                    style={styles.receiptInput}
                    type="number"
                    step="0.01"
                    value={venue.userReceiptTotal}
                    onChange={e => updateVenueReceiptTotal(vi, e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div style={styles.compRow}>
                  <span style={styles.compLabel}>Difference</span>
                  <span style={{ ...styles.compDiff, color: vDiffOk ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {vDiffOk ? '✓' : '✗'} ${vDiff.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </Fragment>
        );
      })}

      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.bottomButtons}>
        <button style={styles.btnSecondary} onClick={() => navigate(-1)}>
          Retake photos
        </button>
        <button
          style={{ ...styles.btnPrimary, opacity: loading ? 0.6 : 1 }}
          onClick={handleConfirm}
          disabled={loading}
        >
          {loading ? 'Saving...' : 'Looks right — continue'}
        </button>
      </div>
    </PageContainer>
  );
}

function ItemRow({ item, isEditing, onToggleEdit, onUpdate, onEditChange, onDelete }) {
  const rowRef = useRef(null);
  const [priceStr, setPriceStr] = useState(() => Number(item.unitPrice).toFixed(2));
  const [priceFocused, setPriceFocused] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setPriceStr(Number(item.unitPrice).toFixed(2));
      setPriceFocused(false);
    }
  }, [isEditing, item.unitPrice]);

  useEffect(() => {
    if (!isEditing) return;
    function outside(e) {
      if (rowRef.current && !rowRef.current.contains(e.target)) onToggleEdit();
    }
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('touchstart', outside);
    };
  }, [isEditing, onToggleEdit]);

  if (!isEditing) {
    return (
      <div ref={rowRef} style={{ ...styles.itemRow, cursor: 'pointer' }} onClick={onToggleEdit}>
        <div style={{ flex: 1 }}>
          <div style={styles.itemName}>{item.name || 'Unnamed item'}</div>
          <div style={styles.itemMetaLabel}>×{item.quantity} · ${Number(item.unitPrice).toFixed(2)}</div>
        </div>
        <button style={styles.editBtn} onClick={e => { e.stopPropagation(); onToggleEdit(); }}>✎</button>
      </div>
    );
  }

  const priceDisplay = priceFocused ? priceStr : `$${parseFloat(priceStr || '0').toFixed(2)}`;

  return (
    <div ref={rowRef} style={styles.itemRowEdit}>
      <input
        autoFocus
        style={styles.itemNameInput}
        value={item.name}
        onChange={e => { onUpdate('name', e.target.value); onEditChange('name', e.target.value); }}
        placeholder="Item name"
      />

      <div style={styles.editRow}>
        <span style={styles.editLabel}>Qty</span>
        <div style={styles.qtyControls}>
          <button
            style={{ ...styles.qtyBtn, opacity: item.quantity <= 1 ? 0.25 : 1 }}
            onClick={() => { const q = Number(item.quantity) - 1; if (q >= 1) { onUpdate('quantity', q); onEditChange('quantity', q); } }}
          >−</button>
          <span style={styles.qtyCount}>{item.quantity}</span>
          <button
            style={styles.qtyBtn}
            onClick={() => { const q = Number(item.quantity) + 1; onUpdate('quantity', q); onEditChange('quantity', q); }}
          >+</button>
        </div>
      </div>

      <div style={styles.editRow}>
        <span style={styles.editLabel}>Unit price</span>
        <input
          type="text"
          inputMode="decimal"
          style={styles.priceInput}
          value={priceDisplay}
          onFocus={() => setPriceFocused(true)}
          onChange={e => {
            const raw = e.target.value.replace(/[^0-9.]/g, '');
            setPriceStr(raw);
            onEditChange('unitPrice', parseFloat(raw) || 0);
          }}
          onBlur={() => {
            const val = parseFloat(priceStr) || 0;
            setPriceStr(val.toFixed(2));
            setPriceFocused(false);
          }}
        />
      </div>

      <button style={styles.deleteItemLink} onClick={onDelete}>Delete item</button>
    </div>
  );
}

function TotalRow({ label, value, bold }) {
  return (
    <div style={styles.totalRow}>
      <span style={{ ...styles.totalLabel, fontWeight: bold ? 500 : 400, fontSize: bold ? '13px' : '12px' }}>{label}</span>
      <span style={{ ...styles.totalValue, fontWeight: bold ? 500 : 400, fontSize: bold ? '13px' : '12px' }}>${value.toFixed(2)}</span>
    </div>
  );
}

const styles = {
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    marginBottom: '24px',
  },
  back: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    padding: '0',
    lineHeight: 1.4,
  },
  title: {
    fontSize: '20px',
    fontWeight: 500,
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  subtitle: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    marginTop: '2px',
  },
  venueBlock: {
    borderRadius: '12px',
    overflow: 'hidden',
    marginBottom: 0,
    border: '0.5px solid var(--border-color)',
  },
  venueHeader: {
    backgroundColor: 'var(--bg-secondary)',
    padding: '10px 14px',
    borderRadius: '12px 12px 0 0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  venueHeaderText: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  venueEditHint: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  itemRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 14px',
    borderBottom: '0.5px solid var(--border-color)',
    backgroundColor: 'var(--bg-primary)',
    gap: '8px',
  },
  itemRowEdit: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '12px 14px',
    borderBottom: '0.5px solid var(--border-color)',
    backgroundColor: 'var(--bg-primary)',
  },
  itemName: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    marginBottom: '2px',
  },
  itemNameInput: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    border: 'none',
    borderBottom: '1px solid var(--border-color)',
    backgroundColor: 'transparent',
    outline: 'none',
    width: '100%',
    padding: '0 0 3px',
  },
  itemMetaLabel: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  editBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    color: 'var(--text-tertiary)',
    flexShrink: 0,
    padding: '4px',
    lineHeight: 1,
  },
  editRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editLabel: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  qtyControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  qtyBtn: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    padding: '0',
    lineHeight: 1,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  qtyCount: {
    fontSize: '15px',
    fontWeight: 500,
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    minWidth: '20px',
    textAlign: 'center',
  },
  priceInput: {
    border: 'none',
    borderBottom: '1px solid var(--border-color)',
    backgroundColor: 'transparent',
    outline: 'none',
    textAlign: 'right',
    fontSize: '13px',
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    width: '80px',
    padding: '0 0 2px',
  },
  deleteItemLink: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    color: 'var(--color-danger)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '0',
    textAlign: 'left',
  },
  addItemLink: {
    display: 'block',
    width: '100%',
    padding: '10px 14px',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--bg-primary)',
    border: 'none',
    borderTop: '0.5px dashed var(--border-color)',
    textAlign: 'center',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  venueTotals: {
    backgroundColor: 'var(--bg-secondary)',
    borderRadius: '0 0 12px 12px',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '3px 0',
  },
  totalLabel: {
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  totalValue: {
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  compCard: {
    backgroundColor: 'var(--bg-secondary)',
    borderRadius: '8px',
    padding: '10px 12px',
    marginTop: '8px',
    marginBottom: '16px',
  },
  compRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '3px 0',
  },
  compLabel: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  compValue: {
    fontSize: '12px',
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  compDiff: {
    fontSize: '12px',
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  receiptInput: {
    border: 'none',
    borderBottom: '1px solid var(--border-color)',
    backgroundColor: 'transparent',
    outline: 'none',
    textAlign: 'right',
    fontSize: '12px',
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    width: '72px',
    colorScheme: 'light dark',
    padding: '0 0 1px',
  },
  error: {
    fontSize: '12px',
    color: 'var(--color-danger)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    marginBottom: '12px',
  },
  bottomButtons: {
    display: 'flex',
    gap: '10px',
    marginTop: '16px',
  },
  btnPrimary: {
    flex: 1,
    padding: '13px',
    fontSize: '14px',
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--btn-primary-bg)',
    color: 'var(--btn-primary-text)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  btnSecondary: {
    flex: 1,
    padding: '13px',
    fontSize: '14px',
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'transparent',
    color: 'var(--text-primary)',
    border: '0.5px solid var(--border-color)',
    borderRadius: '8px',
    cursor: 'pointer',
  },
};

import { useState, useEffect, useRef, Fragment } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { doc, getDoc, getDocs, collection, addDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import PageContainer from '../components/PageContainer';
import PhotoThumbnail from '../components/PhotoThumbnail';
import { BRAND_NAME } from '../brand';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function capImageSize(file, maxWidth = 1200) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      if (img.width <= maxWidth) { resolve(file); return; }
      const canvas = document.createElement('canvas');
      const ratio = maxWidth / img.width;
      canvas.width = maxWidth;
      canvas.height = img.height * ratio;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => resolve(new File([blob], file.name, { type: 'image/jpeg' })), 'image/jpeg', 0.85);
    };
    img.src = URL.createObjectURL(file);
  });
}

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
      ...(item.paidByName ? { paidByName: item.paidByName } : {}),
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

  // Add venue sheet state
  const [addVenueOpen, setAddVenueOpen] = useState(false);
  const [addVenueStep, setAddVenueStep] = useState('upload');
  const [newVenueName, setNewVenueName] = useState('');
  const [newVenuePhotos, setNewVenuePhotos] = useState([]);
  const [newVenueManualItems, setNewVenueManualItems] = useState([]);
  const [newVenueItems, setNewVenueItems] = useState([]);
  const [newVenueGst, setNewVenueGst] = useState(null);
  const [newVenueSc, setNewVenueSc] = useState(null);
  const [newVenueReceiptTotal, setNewVenueReceiptTotal] = useState(0);
  const [newVenueUserReceiptTotal, setNewVenueUserReceiptTotal] = useState('');
  const [newVenueLoading, setNewVenueLoading] = useState(false);
  const [newVenueError, setNewVenueError] = useState('');
  const [sheetEditingKey, setSheetEditingKey] = useState(null);

  const venuesRef = useRef(venues);
  const editingValuesRef = useRef({ quantity: 0, unitPrice: 0, name: '' });
  const prevEditingKeyRef = useRef(null);
  const sheetEditValuesRef = useRef({ quantity: 1, unitPrice: 0, name: '' });
  const prevSheetEditingKeyRef = useRef(null);
  const newVenueItemsRef = useRef([]);
  const sheetPhotoRef = useRef(null);

  // Keep venuesRef current so the editingKey effect can read live state without a stale closure.
  useEffect(() => { venuesRef.current = venues; }, [venues]);
  useEffect(() => { newVenueItemsRef.current = newVenueItems; }, [newVenueItems]);

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

  // Commit sheet item edits when editing key changes
  useEffect(() => {
    const prevKey = prevSheetEditingKeyRef.current;
    if (prevKey !== null && prevKey !== sheetEditingKey) {
      const itemId = Number(prevKey);
      const { quantity, unitPrice, name } = sheetEditValuesRef.current;
      setNewVenueItems(prev => prev.map(item =>
        item.id !== itemId ? item : { ...item, quantity: Number(quantity), unitPrice: Number(unitPrice), name }
      ));
    }
    if (sheetEditingKey !== null) {
      const itemId = Number(sheetEditingKey);
      const item = newVenueItemsRef.current.find(i => i.id === itemId);
      if (item) sheetEditValuesRef.current = { quantity: item.quantity, unitPrice: item.unitPrice, name: item.name };
    }
    prevSheetEditingKeyRef.current = sheetEditingKey;
  }, [sheetEditingKey]);

  useEffect(() => {
    document.title = session?.name ? `Confirm items · ${session.name} — ${BRAND_NAME}` : BRAND_NAME;
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

  function resetAddVenueSheet() {
    setAddVenueOpen(false);
    setAddVenueStep('upload');
    setNewVenueName('');
    setNewVenuePhotos([]);
    setNewVenueManualItems([]);
    setNewVenueItems([]);
    setNewVenueGst(null);
    setNewVenueSc(null);
    setNewVenueReceiptTotal(0);
    setNewVenueUserReceiptTotal('');
    setNewVenueError('');
    setSheetEditingKey(null);
  }

  function sheetSubtotal() {
    return newVenueItems.reduce((s, item) => s + item.quantity * item.unitPrice, 0);
  }
  function sheetGstAmount() {
    if (!newVenueGst) return 0;
    if (newVenueGst.amount != null) return newVenueGst.amount;
    if (newVenueGst.percent != null) return sheetSubtotal() * newVenueGst.percent / 100;
    return 0;
  }
  function sheetScAmount() {
    if (!newVenueSc) return 0;
    if (newVenueSc.amount != null) return newVenueSc.amount;
    if (newVenueSc.percent != null) return sheetSubtotal() * newVenueSc.percent / 100;
    return 0;
  }
  function sheetTaxedTotal() {
    return sheetSubtotal() + sheetGstAmount() + sheetScAmount();
  }

  async function handleSheetParse() {
    const name = newVenueName.trim();
    const hasPhoto = newVenuePhotos.length > 0 && !!name;
    const validManual = newVenueManualItems.filter(i => i.name.trim());
    if (!name) { setNewVenueError('Enter a venue name.'); return; }
    if (!hasPhoto && !validManual.length) { setNewVenueError('Add a photo or at least one item.'); return; }
    setNewVenueError('');
    setNewVenueLoading(true);
    try {
      let parsedVenue = { items: [], gst: null, serviceCharge: null, receiptTotal: 0 };
      if (hasPhoto) {
        const cappedPhotos = await Promise.all(newVenuePhotos.map(f => capImageSize(f)));
        const photos = await Promise.all(cappedPhotos.map(fileToBase64));
        const apiUrl = import.meta.env.DEV ? 'http://localhost:3001/api/parse-receipt' : '/api/parse-receipt';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 55000);
        try {
          const res = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, venues: [{ venueName: name, photos }] }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(d.error || `Server error: ${res.status}`);
          }
          const result = await res.json();
          parsedVenue = result.venues?.[0] ?? parsedVenue;
        } catch (err) {
          clearTimeout(timeoutId);
          if (err.name === 'AbortError') throw new Error('Request timed out — please try again');
          throw err;
        }
      }
      let items = (parsedVenue.items || []).map((item, idx) => ({
        id: idx + 1,
        name: item.name,
        quantity: item.quantity ?? 1,
        unitPrice: item.unitPrice ?? 0,
      }));
      if (validManual.length > 0) {
        const offset = items.length;
        items = [...items, ...validManual.map((i, idx) => ({
          id: offset + idx + 1,
          name: i.name.trim(),
          quantity: Math.max(1, parseInt(i.qty) || 1),
          unitPrice: parseFloat(i.price) || 0,
        }))];
      }
      setNewVenueItems(items);
      setNewVenueGst(parsedVenue.gst?.present ? parsedVenue.gst : null);
      setNewVenueSc(parsedVenue.serviceCharge?.present ? parsedVenue.serviceCharge : null);
      const rt = parsedVenue.receiptTotal ?? 0;
      setNewVenueReceiptTotal(rt);
      setNewVenueUserReceiptTotal(rt ? String(rt) : '');
      setAddVenueStep('review');
    } catch (err) {
      setNewVenueError(err.message || 'Something went wrong.');
      console.error(err);
    }
    setNewVenueLoading(false);
  }

  function handleSheetAddVenue() {
    const name = newVenueName.trim();
    if (!name || newVenueItems.length === 0) return;
    const newVenue = {
      name,
      gst: newVenueGst,
      serviceCharge: newVenueSc,
      receiptTotal: newVenueReceiptTotal,
      userReceiptTotal: newVenueUserReceiptTotal || String(newVenueReceiptTotal || ''),
      items: newVenueItems.map((item, idx) => ({ ...item, id: Date.now() + idx })),
    };
    setVenues(prev => {
      const transportIdx = prev.findIndex(v => v.name === 'Transport' || v.isTransport);
      return transportIdx === -1 ? [...prev, newVenue] : [...prev.slice(0, transportIdx), newVenue, ...prev.slice(transportIdx)];
    });
    resetAddVenueSheet();
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
        venues.map(async (venue, vi) => {
          const isTransport = venue.name === 'Transport' || venue.isTransport;
          const venueRef = await addDoc(collection(db, 'sessions', sessionId, 'venues'), {
            name: venue.name,
            gstPercent: venue.gst?.percent ?? null,
            gstAmount: venueGstAmount(venue),
            serviceChargePercent: venue.serviceCharge?.percent ?? null,
            serviceChargeAmount: venueScAmount(venue),
            receiptTotal: parseFloat(venue.userReceiptTotal) || venueTaxedTotal(venue),
            photoUrls: photoUrlsByVenue[venue.name] ?? [],
            order: isTransport ? 9999 : vi,
            createdAt: serverTimestamp(),
          });

          await Promise.all(
            venue.items.map((item, ii) =>
              addDoc(collection(db, 'sessions', sessionId, 'venues', venueRef.id, 'items'), {
                name: item.name,
                quantity: Number(item.quantity),
                unitPrice: Number(item.unitPrice),
                totalPrice: Number(item.quantity) * Number(item.unitPrice),
                order: ii,
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

      {(() => {
        const indexed = venues.map((venue, vi) => ({ venue, vi }));
        const nonTransport = indexed.filter(({ venue }) => venue.name !== 'Transport' && !venue.isTransport);
        const transport = indexed.filter(({ venue }) => venue.name === 'Transport' || venue.isTransport);
        const renderEntry = ({ venue, vi }) => {
          const vParsed = venueTaxedTotal(venue);
          const vReceipt = parseFloat(venue.userReceiptTotal) || 0;
          const vDiff = Math.abs(vParsed - vReceipt);
          const vDiffOk = vDiff < 0.005;
          const isParsedVenue = (venue.receiptTotal ?? 0) > 0;
          const allItemsValid = venue.items.length > 0 && venue.items.every(
            item => item.name?.trim() && Number(item.quantity) > 0 && Number(item.unitPrice) > 0
          );
          const isVenueComplete = allItemsValid && (!isParsedVenue || vDiffOk);
          return (
            <Fragment key={vi}>
              <div style={{ ...styles.venueBlock, ...(isVenueComplete ? { border: '0.5px solid #27500A' } : {}) }}>
                <div style={styles.venueHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={styles.venueHeaderText}>{venue.name}</span>
                    {isVenueComplete && (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="7" fill="#EAF3DE"/>
                        <path d="M5 8L7 10L11 6" stroke="#27500A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
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

              {venue.name !== 'Transport' && !venue.isTransport && isParsedVenue && (
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
                      inputMode="decimal"
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
        };
        return (
          <>
            {nonTransport.map(renderEntry)}
            <button style={styles.addVenueBtn} onClick={() => setAddVenueOpen(true)}>
              + Add venue
            </button>
            {transport.map(renderEntry)}
          </>
        );
      })()}

      {error && <p style={styles.error}>{error}</p>}

      {(() => {
        const hasSignificantDiff = venues.some(v => {
          if (v.name === 'Transport' || v.isTransport) return false;
          const vReceipt = parseFloat(v.userReceiptTotal) || 0;
          if (!vReceipt) return false;
          return Math.abs(venueTaxedTotal(v) - vReceipt) >= 0.005;
        });
        return (
          <div style={styles.bottomButtons}>
            <button style={styles.btnSecondary} onClick={() => navigate(-1)}>
              Retake photos
            </button>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button
                style={{ ...styles.btnPrimary, opacity: (loading || hasSignificantDiff) ? 0.6 : 1 }}
                onClick={handleConfirm}
                disabled={loading || hasSignificantDiff}
              >
                {loading ? 'Saving...' : 'Looks right — continue'}
              </button>
              {hasSignificantDiff && !loading && (
                <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                  Fix any issues above to continue
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {/* Add venue bottom sheet */}
      {addVenueOpen && (
        <>
          <div style={styles.sheetOverlay} onClick={resetAddVenueSheet} />
          <div style={styles.addVenueSheet}>
            <div style={styles.sheetDragHandle} />
            <div style={styles.sheetTopRow}>
              <div style={styles.sheetTitleText}>Add venue</div>
              <button style={styles.sheetCloseBtn} onClick={resetAddVenueSheet}>×</button>
            </div>

            {addVenueStep === 'upload' ? (
              <>
                <input
                  style={styles.sheetVenueNameInput}
                  type="text"
                  value={newVenueName}
                  onChange={e => setNewVenueName(e.target.value)}
                  placeholder="Venue name e.g. Jigger & Pony"
                />
                <p style={styles.photoHelper}>
                  Multiple photos: ensure bottom of each overlaps with top of the next.
                </p>
                <div style={styles.photoRow}>
                  {newVenuePhotos.map((file, pi) => (
                    <div key={pi} style={styles.photoThumbWrapper}>
                      <PhotoThumbnail file={file} alt={`Receipt photo ${pi + 1}${newVenueName ? ` for ${newVenueName}` : ''}`} style={styles.photoThumb} />
                      <button style={styles.removePhoto} onClick={() => setNewVenuePhotos(p => p.filter((_, i) => i !== pi))}>×</button>
                    </div>
                  ))}
                  <div style={styles.addPhotoTile} onClick={() => sheetPhotoRef.current?.click()}>+</div>
                  <input
                    ref={sheetPhotoRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={e => {
                      const files = Array.from(e.target.files ?? []);
                      setNewVenuePhotos(p => [...p, ...files]);
                      e.target.value = '';
                    }}
                  />
                </div>

                {newVenueManualItems.length > 0 && (
                  <div style={styles.manualItemsList}>
                    <div style={styles.manualItemsHeader}>
                      <span style={styles.manualColName}>Item</span>
                      <span style={styles.manualColQty}>Qty</span>
                      <span style={styles.manualColPrice}>Price</span>
                      <span style={{ width: '24px' }} />
                    </div>
                    {newVenueManualItems.map((item, i) => (
                      <div key={i} style={styles.manualItemRow}>
                        <input
                          style={{ ...styles.manualInput, flex: 1 }}
                          type="text"
                          value={item.name}
                          onChange={e => setNewVenueManualItems(p => p.map((it, j) => j === i ? { ...it, name: e.target.value } : it))}
                          placeholder="Item name"
                        />
                        <input
                          style={{ ...styles.manualInput, width: '44px' }}
                          type="number"
                          inputMode="numeric"
                          value={item.qty}
                          min="1"
                          onChange={e => setNewVenueManualItems(p => p.map((it, j) => j === i ? { ...it, qty: e.target.value } : it))}
                        />
                        <input
                          style={{ ...styles.manualInput, width: '70px' }}
                          type="number"
                          inputMode="decimal"
                          value={item.price}
                          step="0.01"
                          min="0"
                          onChange={e => setNewVenueManualItems(p => p.map((it, j) => j === i ? { ...it, price: e.target.value } : it))}
                          placeholder="0.00"
                        />
                        <button style={styles.manualRemoveBtn} onClick={() => setNewVenueManualItems(p => p.filter((_, j) => j !== i))}>×</button>
                      </div>
                    ))}
                  </div>
                )}

                <button style={styles.manualAddBtn} onClick={() => setNewVenueManualItems(p => [...p, { name: '', qty: 1, price: '' }])}>
                  + Add item manually
                </button>

                {newVenueError && <p style={{ ...styles.error, marginTop: '8px' }}>{newVenueError}</p>}

                <div style={{ flex: 1 }} />
                <button
                  style={{ ...styles.btnPrimary, opacity: newVenueLoading ? 0.7 : 1, marginTop: '16px', flexShrink: 0 }}
                  onClick={handleSheetParse}
                  disabled={newVenueLoading}
                >
                  {newVenueLoading ? (
                    <><span className="spinner" /> Reading your receipt...</>
                  ) : newVenuePhotos.length > 0 ? 'Parse receipt →' : 'Continue →'}
                </button>
              </>
            ) : (
              <>
                <div style={styles.venueBlock}>
                  <div style={styles.venueHeader}>
                    <span style={styles.venueHeaderText}>{newVenueName}</span>
                    <span style={styles.venueEditHint}>Tap any item to edit</span>
                  </div>

                  {newVenueItems.map(item => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      isEditing={sheetEditingKey === String(item.id)}
                      onToggleEdit={() => setSheetEditingKey(p => p === String(item.id) ? null : String(item.id))}
                      onUpdate={(field, val) => setNewVenueItems(p => p.map(i => i.id === item.id ? { ...i, [field]: val } : i))}
                      onEditChange={(f, v) => { sheetEditValuesRef.current = { ...sheetEditValuesRef.current, [f]: v }; }}
                      onDelete={() => { setNewVenueItems(p => p.filter(i => i.id !== item.id)); setSheetEditingKey(null); }}
                    />
                  ))}

                  <button style={styles.addItemLink} onClick={() => {
                    const newId = Date.now();
                    setNewVenueItems(p => [...p, { id: newId, name: '', quantity: 1, unitPrice: 0 }]);
                    setSheetEditingKey(String(newId));
                  }}>
                    + Add item to {newVenueName}
                  </button>

                  <div style={styles.venueTotals}>
                    <TotalRow label="Subtotal" value={sheetSubtotal()} />
                    {newVenueGst != null && (
                      <TotalRow
                        label={newVenueGst.percent != null ? `GST (${newVenueGst.percent}%)` : 'GST'}
                        value={sheetGstAmount()}
                      />
                    )}
                    {newVenueSc != null && (
                      <TotalRow
                        label={newVenueSc.percent != null ? `Service charge (${newVenueSc.percent}%)` : 'Service charge'}
                        value={sheetScAmount()}
                      />
                    )}
                    <TotalRow label="Total" value={sheetTaxedTotal()} bold />
                  </div>
                </div>

                {newVenueReceiptTotal > 0 && (() => {
                  const sheetDiff = Math.abs(sheetTaxedTotal() - (parseFloat(newVenueUserReceiptTotal) || 0));
                  const sheetDiffOk = sheetDiff < 0.005;
                  return (
                    <div style={{ ...styles.compCard, marginTop: '8px' }}>
                      <div style={styles.compRow}>
                        <span style={styles.compLabel}>Parsed total</span>
                        <span style={styles.compValue}>${sheetTaxedTotal().toFixed(2)}</span>
                      </div>
                      <div style={styles.compRow}>
                        <span style={styles.compLabel}>Receipt total</span>
                        <input
                          style={styles.receiptInput}
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          value={newVenueUserReceiptTotal}
                          onChange={e => setNewVenueUserReceiptTotal(e.target.value)}
                          placeholder="0.00"
                        />
                      </div>
                      <div style={styles.compRow}>
                        <span style={styles.compLabel}>Difference</span>
                        <span style={{ ...styles.compDiff, color: sheetDiffOk ? 'var(--color-success)' : 'var(--color-danger)' }}>
                          {sheetDiffOk ? '✓' : '✗'} ${sheetDiff.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                <div style={{ flex: 1 }} />
                <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexShrink: 0 }}>
                  <button style={{ ...styles.btnSecondary, flex: 1 }} onClick={() => setAddVenueStep('upload')}>
                    Re-parse
                  </button>
                  <button
                    style={{ ...styles.btnPrimary, flex: 1, opacity: newVenueItems.length === 0 ? 0.5 : 1 }}
                    onClick={handleSheetAddVenue}
                    disabled={newVenueItems.length === 0}
                  >
                    Add to session
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
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
    function onUserScroll() {
      onToggleEdit();
    }
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside);
    window.addEventListener('wheel', onUserScroll, { passive: true });
    window.addEventListener('touchmove', onUserScroll, { passive: true });
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('touchstart', outside);
      window.removeEventListener('wheel', onUserScroll);
      window.removeEventListener('touchmove', onUserScroll);
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
  addVenueBtn: {
    width: '100%',
    padding: '11px 14px',
    backgroundColor: 'transparent',
    border: '0.5px dashed var(--border-color)',
    borderRadius: '10px',
    fontSize: '13px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    cursor: 'pointer',
    marginTop: '4px',
    marginBottom: '4px',
    textAlign: 'center',
  },
  sheetOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 200 },
  addVenueSheet: {
    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 201,
    backgroundColor: 'var(--bg-primary)', borderRadius: '20px 20px 0 0',
    height: '95vh', overflowY: 'auto',
    padding: '12px 16px 32px',
    paddingBottom: 'calc(32px + env(safe-area-inset-bottom))',
    display: 'flex', flexDirection: 'column',
  },
  sheetDragHandle: { width: '36px', height: '4px', borderRadius: '2px', backgroundColor: 'var(--border-color)', margin: '0 auto 16px', flexShrink: 0 },
  sheetTopRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexShrink: 0 },
  sheetTitleText: { fontSize: '17px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  sheetCloseBtn: { background: 'none', border: 'none', fontSize: '22px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px', lineHeight: 1 },
  sheetVenueNameInput: {
    width: '100%', border: '0.5px solid var(--border-color)', borderRadius: '8px',
    padding: '10px 12px', fontSize: '15px', backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif',
    outline: 'none', marginBottom: '10px', colorScheme: 'light dark', flexShrink: 0,
    boxSizing: 'border-box',
  },
  photoHelper: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: '10px', flexShrink: 0 },
  photoRow: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px', flexShrink: 0 },
  photoThumbWrapper: { position: 'relative' },
  photoThumb: { width: '72px', height: '72px', borderRadius: '8px', objectFit: 'cover', display: 'block' },
  removePhoto: { position: 'absolute', top: '-6px', right: '-6px', width: '20px', height: '20px', borderRadius: '50%', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', cursor: 'pointer', fontSize: '13px', lineHeight: '20px', textAlign: 'center', padding: 0 },
  addPhotoTile: { width: '72px', height: '72px', borderRadius: '8px', border: '1.5px dashed var(--border-color)', backgroundColor: 'transparent', color: 'var(--text-secondary)', fontSize: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' },
  manualAddBtn: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'transparent', border: '0.5px dashed var(--border-color)', borderRadius: '6px', padding: '7px 12px', cursor: 'pointer', marginTop: '8px', width: '100%', textAlign: 'center', flexShrink: 0 },
  manualItemsList: { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 },
  manualItemsHeader: { display: 'flex', gap: '6px', alignItems: 'center', padding: '0 2px' },
  manualColName: { flex: 1, fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' },
  manualColQty: { width: '44px', fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', flexShrink: 0 },
  manualColPrice: { width: '70px', fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', flexShrink: 0 },
  manualItemRow: { display: 'flex', gap: '6px', alignItems: 'center' },
  manualInput: { padding: '7px 8px', fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', border: '0.5px solid var(--border-color)', borderRadius: '6px', outline: 'none', colorScheme: 'light dark' },
  manualRemoveBtn: { width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '0.5px solid var(--border-color)', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 },
};

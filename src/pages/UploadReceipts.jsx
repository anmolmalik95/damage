import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, getDocs, collection, query, where, updateDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import PageContainer from '../components/PageContainer';
import { useIsDesktop } from '../hooks/useIsDesktop';

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

const venuesDraftKey = id => `draft_upload_${id}`;
const emptyVenue = () => ({ name: '', photos: [], manualItems: [] });

export default function UploadReceipts() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [session, setSession] = useState(null);

  const canRestore = sessionStorage.getItem(`canRestore_upload_${sessionId}`) === 'true';
  const [venues, setVenues] = useState(() => {
    if (!canRestore) return [emptyVenue()];
    try {
      const saved = JSON.parse(sessionStorage.getItem(venuesDraftKey(sessionId)));
      if (Array.isArray(saved) && saved.length > 0) return saved.map(v => ({ name: v.name, photos: [], manualItems: v.manualItems ?? [] }));
    } catch {}
    return [emptyVenue()];
  });
  const [cabs, setCabs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    sessionStorage.removeItem(`canRestore_upload_${sessionId}`);
    getDoc(doc(db, 'sessions', sessionId)).then(snap => {
      if (snap.exists()) setSession(snap.data());
    });
  }, [sessionId]);

  useEffect(() => {
    document.title = session?.name ? `Add receipts · ${session.name} — Unfuck` : 'Unfuck';
  }, [session?.name]);

  function saveVenuesDraft(updated) {
    sessionStorage.setItem(venuesDraftKey(sessionId), JSON.stringify(updated.map(v => ({ name: v.name, manualItems: v.manualItems }))));
  }

  function updateVenueName(index, value) {
    setVenues(prev => {
      const updated = prev.map((v, i) => i === index ? { ...v, name: value } : v);
      saveVenuesDraft(updated);
      return updated;
    });
  }

  function addVenue() {
    setVenues(prev => {
      const updated = [...prev, emptyVenue()];
      saveVenuesDraft(updated);
      return updated;
    });
  }

  function addManualItem(venueIndex) {
    setVenues(prev => {
      const updated = prev.map((v, i) => i === venueIndex
        ? { ...v, manualItems: [...v.manualItems, { name: '', qty: 1, price: '' }] }
        : v
      );
      saveVenuesDraft(updated);
      return updated;
    });
  }

  function updateManualItem(venueIndex, itemIndex, field, value) {
    setVenues(prev => {
      const updated = prev.map((v, i) => i === venueIndex
        ? { ...v, manualItems: v.manualItems.map((item, j) => j === itemIndex ? { ...item, [field]: value } : item) }
        : v
      );
      saveVenuesDraft(updated);
      return updated;
    });
  }

  function removeManualItem(venueIndex, itemIndex) {
    setVenues(prev => {
      const updated = prev.map((v, i) => i === venueIndex
        ? { ...v, manualItems: v.manualItems.filter((_, j) => j !== itemIndex) }
        : v
      );
      saveVenuesDraft(updated);
      return updated;
    });
  }

  function addPhoto(venueIndex, file) {
    if (!file) return;
    setVenues(prev => prev.map((v, i) =>
      i === venueIndex ? { ...v, photos: [...v.photos, file] } : v
    ));
  }

  function addCab() {
    setCabs(prev => [...prev, { id: `cab_${Date.now()}`, from: '', to: '', price: '' }]);
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

  function removePhoto(venueIndex, photoIndex) {
    setVenues(prev => prev.map((v, i) =>
      i === venueIndex
        ? { ...v, photos: v.photos.filter((_, pi) => pi !== photoIndex) }
        : v
    ));
  }

  async function handleParse() {
    const hasPhoto = venues.some(v => v.name.trim() && v.photos.length > 0);
    const hasManual = venues.some(v => v.name.trim() && v.manualItems.some(i => i.name.trim()));
    const hasValidCabs = cabs.some(c => parseFloat(c.price) > 0);
    if (!hasPhoto && !hasManual && !hasValidCabs) {
      setError('Add at least one venue with a photo, manual items, or a cab.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const venuesWithPhotos = venues.filter(v => v.name.trim() && v.photos.length > 0);

      // Cap image sizes before any upload or API call
      const cappedVenues = await Promise.all(
        venuesWithPhotos.map(async venue => ({
          ...venue,
          cappedPhotos: await Promise.all(venue.photos.map(f => capImageSize(f))),
        }))
      );

      // API parse
      const apiPromise = hasPhoto
        ? (async () => {
            const venuePayloads = await Promise.all(
              cappedVenues.map(async venue => {
                const photos = await Promise.all(venue.cappedPhotos.map(fileToBase64));
                return { venueName: venue.name.trim(), photos };
              })
            );
            const apiUrl = import.meta.env.DEV
              ? 'http://localhost:3001/api/parse-receipt'
              : '/api/parse-receipt';
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 55000);
            let res;
            try {
              res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, venues: venuePayloads }),
                signal: controller.signal,
              });
            } catch (err) {
              clearTimeout(timeoutId);
              if (err.name === 'AbortError') throw new Error('Request timed out — please try again with fewer or smaller photos');
              throw err;
            }
            clearTimeout(timeoutId);
            if (!res.ok) {
              const errorData = await res.json().catch(() => ({}));
              throw new Error(errorData.error || `Server error: ${res.status}`);
            }
            return res.json();
          })().catch(err => { throw Object.assign(err, { _source: 'api' }); })
        : Promise.resolve({ venues: [] });

      let apiResult;
      try {
        apiResult = await apiPromise;
      } catch (err) {
        setError(err.message || 'Something went wrong. Please try again.');
        console.error(err);
        setLoading(false);
        return;
      }

      let parsed = apiResult;

      // Merge manual items
      for (const venue of venues) {
        if (!venue.name.trim()) continue;
        const validManual = venue.manualItems.filter(i => i.name.trim());
        if (!validManual.length) continue;
        const existing = parsed.venues?.find(v => (v.venueName || v.name) === venue.name.trim());
        const manualRows = validManual.map(i => ({
          name: i.name.trim(),
          quantity: Math.max(1, parseInt(i.qty) || 1),
          unitPrice: parseFloat(i.price) || 0,
        }));
        if (existing) {
          existing.items = [...(existing.items ?? []), ...manualRows];
        } else {
          parsed.venues = [...(parsed.venues ?? []), { name: venue.name.trim(), venueName: venue.name.trim(), items: manualRows }];
        }
      }

      // Add cabs as Transport venue
      if (hasValidCabs) {
        const validCabs = cabs.filter(c => parseFloat(c.price) > 0);
        const cabItems = validCabs.map(c => ({
          name: cabName(c),
          quantity: 1,
          unitPrice: parseFloat(c.price) || 0,
        }));
        const existing = parsed.venues?.find(v => (v.venueName || v.name) === 'Transport');
        if (existing) {
          existing.items = [...(existing.items ?? []), ...cabItems];
        } else {
          parsed.venues = [...(parsed.venues ?? []), { name: 'Transport', venueName: 'Transport', items: cabItems }];
        }
      }

      sessionStorage.setItem(`canRestore_upload_${sessionId}`, 'true');
      sessionStorage.setItem(`canRestore_confirm_${sessionId}`, 'true');
      navigate(`/session/${sessionId}/confirm`, {
        state: { parsed, venueNames: venues.map(v => v.name.trim()) },
      });

      // Background storage upload — non-blocking, does not affect user flow
      if (cappedVenues.length > 0) {
        (async () => {
          try {
            await Promise.all(
              cappedVenues.map(async venue => {
                const urls = await Promise.all(
                  venue.cappedPhotos.map(async (file, pi) => {
                    const path = `receipts/${sessionId}/${venue.name.trim()}/${pi}_${Date.now()}.jpg`;
                    const fileRef = storageRef(storage, path);
                    await uploadBytes(fileRef, file);
                    return getDownloadURL(fileRef);
                  })
                );
                // Save URLs to Firestore venue doc if it exists
                const venuesSnap = await getDocs(
                  query(collection(db, 'sessions', sessionId, 'venues'), where('name', '==', venue.name.trim()))
                );
                venuesSnap.forEach(d => updateDoc(d.ref, { photoUrls: urls }));
              })
            );
          } catch (err) {
            console.error('Background storage upload failed:', err);
          }
        })();
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
      console.error(err);
      setLoading(false);
    }
  }

  const formattedDate = session?.date
    ? new Date(session.date + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  const parseBtn = (
    <button
      style={{ ...styles.btnPrimary, opacity: loading ? 0.7 : 1 }}
      onClick={handleParse}
      disabled={loading}
    >
      {loading ? (
        <>
          <span className="spinner" />
          Reading your receipt...
        </>
      ) : 'Continue →'}
    </button>
  );

  return (
    <PageContainer noPadBottom={!isDesktop}>
      <div style={styles.header}>
        <button style={styles.back} onClick={() => navigate('/session/new', { state: { back: true } })}>←</button>
        <div>
          <div style={styles.title}>Add receipts</div>
          {session && (
            <div style={styles.subtitle}>{session.name} · {formattedDate}</div>
          )}
        </div>
      </div>

      <div style={styles.venueList}>
        {venues.map((venue, vi) => (
          <VenueBlock
            key={vi}
            venue={venue}
            onNameChange={val => updateVenueName(vi, val)}
            onAddPhoto={file => addPhoto(vi, file)}
            onRemovePhoto={pi => removePhoto(vi, pi)}
            onAddManual={() => addManualItem(vi)}
            onUpdateManual={(ii, field, val) => updateManualItem(vi, ii, field, val)}
            onRemoveManual={ii => removeManualItem(vi, ii)}
          />
        ))}
      </div>

      <div style={styles.venueFooter}>
        <span style={styles.venueCount}>{venues.length} {venues.length === 1 ? 'venue' : 'venues'}</span>
        <button style={styles.addVenueBtn} onClick={addVenue}>+ Add venue</button>
      </div>

      {/* Cabs */}
      {cabs.length > 0 && (
        <div style={styles.cabsBlock}>
          <div style={styles.cabsHeader}>Cabs / Transport</div>
          {cabs.map(cab => (
            <div key={cab.id} style={styles.cabRow}>
              <input
                style={{ ...styles.cabInput, flex: 1 }}
                type="text"
                value={cab.from}
                onChange={e => updateCab(cab.id, 'from', e.target.value)}
                placeholder="From"
              />
              <input
                style={{ ...styles.cabInput, flex: 1 }}
                type="text"
                value={cab.to}
                onChange={e => updateCab(cab.id, 'to', e.target.value)}
                placeholder="To"
              />
              <input
                style={{ ...styles.cabInput, width: '72px' }}
                type="number"
                value={cab.price}
                step="0.01"
                min="0"
                onChange={e => updateCab(cab.id, 'price', e.target.value)}
                placeholder="$0.00"
              />
              <button style={styles.cabRemoveBtn} onClick={() => removeCab(cab.id)}>×</button>
            </div>
          ))}
        </div>
      )}
      <button style={styles.addCabBtn} onClick={addCab}>+ Add cab</button>

      {error && <p style={styles.error}>{error}</p>}

      {isDesktop ? (
        <div style={{ marginTop: '8px' }}>{parseBtn}</div>
      ) : (
        <div style={styles.fixedBar}>{parseBtn}</div>
      )}
    </PageContainer>
  );
}

function VenueBlock({ venue, onNameChange, onAddPhoto, onRemovePhoto, onAddManual, onUpdateManual, onRemoveManual }) {
  const inputRef = useRef(null);

  return (
    <div style={styles.venueBlock}>
      <input
        style={styles.venueNameInput}
        type="text"
        value={venue.name}
        onChange={e => onNameChange(e.target.value)}
        placeholder="Venue name e.g. Jigger & Pony"
      />
      <p style={styles.photoHelper}>
        Multiple photos: ensure bottom of each overlaps with top of the next.
      </p>
      <p style={styles.photoTip}>
        For best results: take the photo in good lighting, hold your phone directly above the receipt (not at an angle), and make sure all prices are clearly visible and in focus.
      </p>
      <div style={styles.photoRow}>
        {venue.photos.map((file, pi) => (
          <div key={pi} style={styles.photoThumbWrapper}>
            <img
              src={URL.createObjectURL(file)}
              alt=""
              style={styles.photoThumb}
            />
            <button style={styles.removePhoto} onClick={() => onRemovePhoto(pi)}>×</button>
          </div>
        ))}
        <div style={styles.addPhotoTile} onClick={() => inputRef.current?.click()}>
          +
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => {
            const files = Array.from(e.target.files ?? []);
            files.forEach(f => onAddPhoto(f));
            e.target.value = '';
          }}
        />
      </div>

      {venue.manualItems.length > 0 && (
        <div style={styles.manualItemsList}>
          <div style={styles.manualItemsHeader}>
            <span style={styles.manualColName}>Item</span>
            <span style={styles.manualColQty}>Qty</span>
            <span style={styles.manualColPrice}>Price</span>
            <span style={{ width: '24px' }} />
          </div>
          {venue.manualItems.map((item, i) => (
            <div key={i} style={styles.manualItemRow}>
              <input
                style={{ ...styles.manualInput, flex: 1 }}
                type="text"
                value={item.name}
                onChange={e => onUpdateManual(i, 'name', e.target.value)}
                placeholder="Item name"
              />
              <input
                style={{ ...styles.manualInput, width: '44px' }}
                type="number"
                value={item.qty}
                min="1"
                onChange={e => onUpdateManual(i, 'qty', e.target.value)}
              />
              <input
                style={{ ...styles.manualInput, width: '70px' }}
                type="number"
                value={item.price}
                step="0.01"
                min="0"
                onChange={e => onUpdateManual(i, 'price', e.target.value)}
                placeholder="0.00"
              />
              <button style={styles.manualRemoveBtn} onClick={() => onRemoveManual(i)}>×</button>
            </div>
          ))}
        </div>
      )}
      <button style={styles.manualAddBtn} onClick={onAddManual}>
        + Add item manually
      </button>
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
    lineHeight: 1.6,
  },
  title: {
    fontSize: '22px',
    fontWeight: 500,
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  subtitle: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    marginTop: '2px',
  },
  venueList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  venueBlock: {
    backgroundColor: 'var(--bg-secondary)',
    borderRadius: '12px',
    padding: '16px',
  },
  venueNameInput: {
    width: '100%',
    border: '0.5px solid var(--border-color)',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '15px',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    outline: 'none',
    marginBottom: '10px',
    colorScheme: 'light dark',
  },
  photoHelper: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    marginBottom: '6px',
  },
  photoTip: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    marginBottom: '12px',
    opacity: 0.7,
  },
  photoRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginBottom: '10px',
  },
  photoThumbWrapper: {
    position: 'relative',
  },
  photoThumb: {
    width: '72px',
    height: '72px',
    borderRadius: '8px',
    objectFit: 'cover',
    display: 'block',
  },
  removePhoto: {
    position: 'absolute',
    top: '-6px',
    right: '-6px',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    backgroundColor: 'var(--text-primary)',
    color: 'var(--bg-primary)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '13px',
    lineHeight: '20px',
    textAlign: 'center',
    padding: 0,
  },
  addPhotoTile: {
    width: '72px',
    height: '72px',
    borderRadius: '8px',
    border: '1.5px dashed var(--border-color)',
    backgroundColor: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '24px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
  },
  manualAddBtn: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'transparent',
    border: '0.5px dashed var(--border-color)',
    borderRadius: '6px',
    padding: '7px 12px',
    cursor: 'pointer',
    marginTop: '8px',
    width: '100%',
    textAlign: 'center',
  },
  manualItemsList: {
    marginTop: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  manualItemsHeader: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    padding: '0 2px',
  },
  manualColName: {
    flex: 1,
    fontSize: '10px',
    color: 'var(--text-tertiary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontWeight: 500,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  manualColQty: {
    width: '44px',
    fontSize: '10px',
    color: 'var(--text-tertiary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontWeight: 500,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    flexShrink: 0,
  },
  manualColPrice: {
    width: '70px',
    fontSize: '10px',
    color: 'var(--text-tertiary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontWeight: 500,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    flexShrink: 0,
  },
  manualItemRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  },
  manualInput: {
    padding: '7px 8px',
    fontSize: '13px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    border: '0.5px solid var(--border-color)',
    borderRadius: '6px',
    outline: 'none',
    colorScheme: 'light dark',
  },
  manualRemoveBtn: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-secondary)',
    border: '0.5px solid var(--border-color)',
    cursor: 'pointer',
    fontSize: '13px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    padding: 0,
  },
  venueFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
  },
  venueCount: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  addVenueBtn: {
    fontSize: '13px',
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: 'var(--text-primary)',
    backgroundColor: 'transparent',
    border: '1px solid var(--text-secondary)',
    borderRadius: '8px',
    padding: '8px 16px',
    cursor: 'pointer',
  },
  error: {
    fontSize: '12px',
    color: 'var(--text-danger)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    marginBottom: '8px',
  },
  btnPrimary: {
    width: '100%',
    padding: '13px',
    fontSize: '14px',
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--btn-primary-bg)',
    color: 'var(--btn-primary-text)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  cabsBlock: {
    backgroundColor: 'var(--bg-secondary)',
    borderRadius: '12px',
    padding: '12px 14px',
    marginBottom: '8px',
  },
  cabsHeader: {
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '10px',
  },
  cabRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    marginBottom: '6px',
  },
  cabInput: {
    padding: '7px 8px',
    fontSize: '13px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    border: '0.5px solid var(--border-color)',
    borderRadius: '6px',
    outline: 'none',
    colorScheme: 'light dark',
    minWidth: 0,
  },
  cabRemoveBtn: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-secondary)',
    border: '0.5px solid var(--border-color)',
    cursor: 'pointer',
    fontSize: '13px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    padding: 0,
  },
  addCabBtn: {
    fontSize: '14px',
    fontWeight: 500,
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    padding: '11px 16px',
    cursor: 'pointer',
    marginTop: '8px',
    marginBottom: '8px',
    width: '100%',
    textAlign: 'center',
  },
  fixedBar: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    padding: '16px',
    backgroundColor: 'var(--bg-primary)',
    borderTop: '0.5px solid var(--border-color)',
  },
};

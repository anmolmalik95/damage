import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
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

const venuesDraftKey = id => `draft_upload_${id}`;

export default function UploadReceipts() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [session, setSession] = useState(null);

  const canRestore = sessionStorage.getItem(`canRestore_upload_${sessionId}`) === 'true';
  const [venues, setVenues] = useState(() => {
    if (!canRestore) return [{ name: '', photos: [] }];
    try {
      const saved = JSON.parse(sessionStorage.getItem(venuesDraftKey(sessionId)));
      if (Array.isArray(saved) && saved.length > 0) return saved.map(v => ({ name: v.name, photos: [] }));
    } catch {}
    return [{ name: '', photos: [] }];
  });
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
    sessionStorage.setItem(venuesDraftKey(sessionId), JSON.stringify(updated.map(v => ({ name: v.name }))));
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
      const updated = [...prev, { name: '', photos: [] }];
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

  function removePhoto(venueIndex, photoIndex) {
    setVenues(prev => prev.map((v, i) =>
      i === venueIndex
        ? { ...v, photos: v.photos.filter((_, pi) => pi !== photoIndex) }
        : v
    ));
  }

  async function handleParse() {
    const valid = venues.some(v => v.name.trim() && v.photos.length > 0);
    if (!valid) {
      setError('Add at least one venue name and one photo.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const venuePayloads = await Promise.all(
        venues
          .filter(v => v.name.trim() && v.photos.length > 0)
          .map(async (venue, venueIndex) => {
            const photos = await Promise.all(venue.photos.map(fileToBase64));
            return { venueIndex, venueName: venue.name.trim(), photos };
          })
      );

      const apiBase = import.meta.env.DEV ? 'http://localhost:3001' : '';
      const res = await fetch(`${apiBase}/api/parse-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, venues: venuePayloads }),
      });

      if (!res.ok) throw new Error('Parsing failed');
      const parsed = await res.json();

      sessionStorage.setItem(`canRestore_upload_${sessionId}`, 'true');
      sessionStorage.setItem(`canRestore_confirm_${sessionId}`, 'true');
      navigate(`/session/${sessionId}/confirm`, { state: { parsed, venueNames: venues.map(v => v.name.trim()) } });
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
      ) : 'Parse receipts →'}
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
          />
        ))}
      </div>

      <div style={styles.venueFooter}>
        <span style={styles.venueCount}>{venues.length} {venues.length === 1 ? 'venue' : 'venues'}</span>
        <button style={styles.addVenueBtn} onClick={addVenue}>+ Add venue</button>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      {isDesktop ? (
        <div style={{ marginTop: '8px' }}>{parseBtn}</div>
      ) : (
        <div style={styles.fixedBar}>{parseBtn}</div>
      )}
    </PageContainer>
  );
}

function VenueBlock({ venue, onNameChange, onAddPhoto, onRemovePhoto }) {
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
          capture="environment"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) onAddPhoto(file);
            e.target.value = '';
          }}
        />
      </div>
      <p style={styles.manualLink}>
        Add item to {venue.name || 'this venue'} manually
      </p>
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
  manualLink: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    textAlign: 'center',
    cursor: 'pointer',
    marginTop: '8px',
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

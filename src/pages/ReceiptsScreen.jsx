import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getDocs, collection, getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useNavigation } from '../context/NavigationContext';
import PageContainer from '../components/PageContainer';
import SkeletonBlock from '../components/SkeletonBlock';
import { BRAND_NAME } from '../brand';

export default function ReceiptsScreen() {
  const { sessionId } = useParams();
  const { navigateBack } = useNavigation();
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sessionName, setSessionName] = useState('');
  const [lightbox, setLightbox] = useState(null); // { urls: string[], index: number }

  useEffect(() => {
    async function load() {
      const [sessionSnap, venuesSnap] = await Promise.all([
        getDoc(doc(db, 'sessions', sessionId)),
        getDocs(collection(db, 'sessions', sessionId, 'venues')),
      ]);
      if (sessionSnap.exists()) setSessionName(sessionSnap.data().name ?? '');
      const venueList = venuesSnap.docs
        .map(d => ({ id: d.id, name: d.data().name ?? '', photoUrls: d.data().photoUrls ?? [], order: d.data().order ?? 0 }))
        .filter(v => v.photoUrls.length > 0)
        .sort((a, b) => a.order - b.order);
      setVenues(venueList);
      setLoading(false);
    }
    load().catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, [sessionId]);

  useEffect(() => {
    document.title = sessionName ? `Receipts · ${sessionName} — ${BRAND_NAME}` : BRAND_NAME;
  }, [sessionName]);

  useEffect(() => {
    function handleKey(e) {
      if (!lightbox) return;
      if (e.key === 'ArrowLeft') prevPhoto();
      if (e.key === 'ArrowRight') nextPhoto();
      if (e.key === 'Escape') setLightbox(null);
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightbox]); // eslint-disable-line react-hooks/exhaustive-deps

  function prevPhoto() {
    setLightbox(l => l ? { ...l, index: Math.max(0, l.index - 1) } : null);
  }
  function nextPhoto() {
    setLightbox(l => l ? { ...l, index: Math.min(l.urls.length - 1, l.index + 1) } : null);
  }

  if (loading) return (
    <PageContainer>
      <div style={st.header}>
        <button style={st.back} onClick={() => navigateBack(`/session/${sessionId}/breakdown`)}>←</button>
        <div><div style={st.title}>Receipts</div></div>
      </div>
      {[...Array(2)].map((_, vi) => (
        <div key={vi} style={{ marginBottom: '24px' }}>
          <SkeletonBlock width="80px" height="11px" style={{ marginBottom: '10px' }} />
          <div style={{ display: 'flex', gap: '8px' }}>
            {[...Array(3)].map((_, i) => (
              <SkeletonBlock key={i} width="80px" height="80px" borderRadius="8px" />
            ))}
          </div>
        </div>
      ))}
    </PageContainer>
  );

  return (
    <PageContainer>
      <div style={st.header}>
        <button style={st.back} onClick={() => navigateBack(`/session/${sessionId}/breakdown`)}>←</button>
        <div>
          <div style={st.title}>Receipts</div>
          {sessionName && <div style={st.subtitle}>{sessionName}</div>}
        </div>
      </div>

      {venues.length === 0 ? (
        <div style={st.empty}>No receipt photos have been uploaded for this session.</div>
      ) : (
        venues.map(venue => (
          <div key={venue.id} style={st.venueGroup}>
            <div style={st.venueLabel}>{venue.name.toUpperCase()}</div>
            <div style={st.photoRow}>
              {venue.photoUrls.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`Receipt photo ${i + 1} for ${venue.name}`}
                  style={st.thumb}
                  onClick={() => setLightbox({ urls: venue.photoUrls, index: i })}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {/* Lightbox */}
      {lightbox && (
        <div style={st.lbBg} onClick={() => setLightbox(null)}>
          <button style={st.lbClose} onClick={() => setLightbox(null)}>×</button>
          <button
            style={{ ...st.lbNav, ...st.lbPrev, opacity: lightbox.index === 0 ? 0.3 : 1 }}
            onClick={e => { e.stopPropagation(); prevPhoto(); }}
            disabled={lightbox.index === 0}
          >‹</button>
          <img
            src={lightbox.urls[lightbox.index]}
            alt={`Receipt photo ${lightbox.index + 1} of ${lightbox.urls.length}`}
            style={st.lbImg}
            onClick={e => e.stopPropagation()}
          />
          <button
            style={{ ...st.lbNav, ...st.lbNext, opacity: lightbox.index === lightbox.urls.length - 1 ? 0.3 : 1 }}
            onClick={e => { e.stopPropagation(); nextPhoto(); }}
            disabled={lightbox.index === lightbox.urls.length - 1}
          >›</button>
          <div style={st.lbCounter}>{lightbox.index + 1} / {lightbox.urls.length}</div>
        </div>
      )}
    </PageContainer>
  );
}

const st = {
  header: { display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '24px' },
  back: { background: 'none', border: 'none', fontSize: '20px', color: 'var(--text-primary)', cursor: 'pointer', padding: '0', lineHeight: 1.6 },
  title: { fontSize: '20px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  subtitle: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px' },
  empty: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', textAlign: 'center', padding: '60px 0' },
  venueGroup: { marginBottom: '24px' },
  venueLabel: { fontSize: '11px', fontWeight: 500, color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '0.06em', marginBottom: '10px' },
  photoRow: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  thumb: { width: '80px', height: '80px', borderRadius: '8px', objectFit: 'cover', cursor: 'pointer', display: 'block' },
  lbBg: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.92)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  lbClose: { position: 'absolute', top: '16px', right: '20px', background: 'none', border: 'none', color: '#fff', fontSize: '32px', cursor: 'pointer', lineHeight: 1, padding: 0, zIndex: 1 },
  lbImg: { maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: '4px' },
  lbNav: { position: 'absolute', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: '28px', cursor: 'pointer', borderRadius: '50%', width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  lbPrev: { left: '16px' },
  lbNext: { right: '16px' },
  lbCounter: { position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', fontSize: '13px', color: 'rgba(255,255,255,0.7)', fontFamily: 'system-ui, -apple-system, sans-serif' },
};

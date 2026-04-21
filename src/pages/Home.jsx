import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsDesktop } from '../hooks/useIsDesktop';

export default function Home() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();

  useEffect(() => { document.title = 'Unfuck'; }, []);

  return (
    <div style={styles.container}>
      <h1 style={{ ...styles.wordmark, fontSize: isDesktop ? '96px' : '72px' }}>UNFUCK</h1>
      <p style={styles.tagline}>Split the bill. No ambiguity.</p>
      <div style={styles.actions}>
        <button style={styles.btnPrimary} onClick={() => navigate('/session/new')}>
          New session
        </button>
        <button style={styles.btnSecondary} onClick={() => navigate('/existing-sessions')}>
          Existing session
        </button>
        <button style={styles.btnSecondary} onClick={() => navigate('/reconcile')}>
          Reconcile sessions
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: 'var(--bg-primary)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '0 32px',
  },
  wordmark: {
    fontFamily: "'Oswald', sans-serif",
    fontWeight: 700,
    letterSpacing: '-0.02em',
    color: 'var(--text-primary)',
    lineHeight: 1,
    marginBottom: '8px',
  },
  tagline: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
    color: 'var(--text-secondary)',
    marginBottom: '52px',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: '100%',
    maxWidth: '320px',
  },
  btnPrimary: {
    width: '100%',
    padding: '13px',
    fontSize: '15px',
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--btn-primary-bg)',
    color: 'var(--btn-primary-text)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  btnSecondary: {
    width: '100%',
    padding: '13px',
    fontSize: '15px',
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'transparent',
    color: 'var(--text-primary)',
    border: '0.5px solid var(--btn-secondary-border)',
    borderRadius: '8px',
    cursor: 'pointer',
  },
};

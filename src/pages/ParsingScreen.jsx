import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useNavigation, useNavigationDirection } from '../context/NavigationContext';
import { takePendingParse } from '../utils/parseState';

export default function ParsingScreen() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { navigateForward } = useNavigation();
  const direction = useNavigationDirection();
  const abortRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    const pending = takePendingParse();
    if (!pending) {
      navigate(`/session/${sessionId}/upload`, { replace: true });
      return;
    }

    abortRef.current = pending.abortController;

    pending.promise
      .then(({ parsed, venueNames }) => {
        if (!mounted) return;
        sessionStorage.setItem(`canRestore_upload_${sessionId}`, 'true');
        sessionStorage.setItem(`canRestore_confirm_${sessionId}`, 'true');
        navigateForward(`/session/${sessionId}/confirm`, { state: { parsed, venueNames } });
      })
      .catch(err => {
        if (!mounted) return;
        if (err.name === 'AbortError') return;
        sessionStorage.setItem(`canRestore_upload_${sessionId}`, 'true');
        setError(err.message || 'Something went wrong. Please try again.');
      });

    return () => { mounted = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleBack() {
    abortRef.current?.abort();
    navigate(`/session/${sessionId}/upload`);
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: direction === 'back' ? -24 : 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: direction === 'back' ? 24 : -24 }}
      transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={st.page}
    >
      <button style={st.back} onClick={handleBack}>←</button>
      <div style={st.center}>
        {error ? (
          <>
            <div style={st.errorTitle}>Something went wrong</div>
            <div style={st.errorMsg}>{error}</div>
            <button style={st.tryAgainBtn} onClick={() => navigate(`/session/${sessionId}/upload`)}>
              Try again
            </button>
          </>
        ) : (
          <>
            <div style={st.spinner} />
            <div style={st.title}>Parsing your receipts...</div>
            <div style={st.subtitle}>
              On the next screen you'll be able to review and correct the parsed items before continuing.
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

const st = {
  page: {
    minHeight: '100vh',
    backgroundColor: 'var(--bg-primary)',
    padding: '20px 16px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
  },
  back: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    padding: '0',
    lineHeight: 1.6,
    alignSelf: 'flex-start',
  },
  center: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '0 16px',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid var(--border-color)',
    borderTopColor: 'var(--text-primary)',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
  title: {
    marginTop: '24px',
    fontSize: '18px',
    fontWeight: 500,
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  subtitle: {
    marginTop: '12px',
    fontSize: '13px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    maxWidth: '280px',
    lineHeight: 1.5,
  },
  errorTitle: {
    fontSize: '18px',
    fontWeight: 500,
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    marginBottom: '8px',
  },
  errorMsg: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    marginBottom: '24px',
    maxWidth: '280px',
    lineHeight: 1.5,
  },
  tryAgainBtn: {
    padding: '11px 24px',
    fontSize: '14px',
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--btn-primary-bg)',
    color: 'var(--btn-primary-text)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
  },
};

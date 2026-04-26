import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

export default function SessionView() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function route() {
      const snap = await getDoc(doc(db, 'sessions', sessionId));
      if (!snap.exists()) {
        setNotFound(true);
        return;
      }
      const status = snap.data().status ?? 'open';
      const hasMember = !!localStorage.getItem(`member_${sessionId}`);

      if (status === 'closed') {
        navigate(`/session/${sessionId}/breakdown`, { replace: true });
        return;
      }
      if (!hasMember) {
        navigate(`/s/${sessionId}`, { replace: true });
        return;
      }
      if (status === 'open') {
        navigate(`/session/${sessionId}/claim`, { replace: true });
      } else {
        navigate(`/session/${sessionId}/breakdown`, { replace: true });
      }
    }
    route();
  }, [sessionId, navigate]);

  if (notFound) {
    return (
      <div style={{ padding: '40px 24px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '8px' }}>Session not found</div>
        <button
          style={{ background: 'none', border: 'none', fontSize: '14px', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
          onClick={() => navigate('/')}
        >
          ← Back to home
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '40px 24px' }}>
      <div style={{ height: '20px', width: '60%', backgroundColor: 'var(--bg-secondary)', borderRadius: '4px', marginBottom: '12px' }} />
      <div style={{ height: '14px', width: '40%', backgroundColor: 'var(--bg-secondary)', borderRadius: '4px' }} />
    </div>
  );
}

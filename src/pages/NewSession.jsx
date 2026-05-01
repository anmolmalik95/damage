import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { collection, doc, getDoc, setDoc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import PageContainer from '../components/PageContainer';
import { BRAND_NAME } from '../brand';

const EVENT_PLACEHOLDERS = [
  "Saturday night out",
  "John's birthday",
  "Friday drinks",
  "Alex's farewell",
  "New Year's eve",
  "Tom's going away",
  "End of year party",
  "Friday hangout",
];

const NAME_PLACEHOLDERS = [
  "Hugh J. Balls",
  "Mike Litoris",
  "Amanda Hugginkiss",
  "Seymour Butts",
  "Al Coholic",
  "Ivana Tinkle",
  "Ben Dover",
  "Chris P. Bacon",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function findAvailableSlug(base) {
  for (let i = 1; i <= 10; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const snap = await getDoc(doc(db, 'sessions', candidate));
    if (!snap.exists()) return candidate;
  }
  return `${base}-${Math.floor(1000 + Math.random() * 9000)}`;
}

const DRAFT_KEY = 'draft_newSession';
const LAST_SESSION_KEY = 'lastSession';

function readDraft() {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY)) ?? {}; } catch { return {}; }
}

export default function NewSession() {
  const navigate = useNavigate();
  const location = useLocation();

  // Only restore draft when navigating back from upload (state.back === true)
  const canRestore = location.state?.back === true;
  const draft = canRestore ? readDraft() : {};

  const [eventName, setEventName] = useState(draft.eventName ?? '');
  const [date, setDate] = useState(draft.date ?? '');
  const [userName, setUserName] = useState(draft.userName ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const eventPlaceholder = useMemo(() => pick(EVENT_PLACEHOLDERS), []);
  const namePlaceholder = useMemo(() => pick(NAME_PLACEHOLDERS), []);

  useEffect(() => { document.title = `New session — ${BRAND_NAME}`; }, []);


  // Persist every keystroke to draft
  useEffect(() => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ eventName, date, userName }));
  }, [eventName, date, userName]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!eventName.trim() || !date || !userName.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const base = generateSlug(eventName.trim());
      const sessionId = await findAvailableSlug(base);

      await setDoc(doc(db, 'sessions', sessionId), {
        name: eventName.trim(),
        date,
        status: 'open',
        billPayer: null,
        createdAt: serverTimestamp(),
        creatorName: userName.trim(),
      });

      const memberRef = await addDoc(
        collection(db, 'sessions', sessionId, 'members'),
        { name: userName.trim(), joinedAt: serverTimestamp(), isCreator: true }
      );

      await updateDoc(doc(db, 'sessions', sessionId), { billPayer: memberRef.id });

      localStorage.setItem(`member_${sessionId}`, memberRef.id);
      localStorage.setItem(`memberName_${sessionId}`, userName.trim());

      sessionStorage.setItem(LAST_SESSION_KEY, JSON.stringify({
        eventName: eventName.trim(), date, userName: userName.trim(), sessionId,
      }));
      sessionStorage.setItem(`canRestore_upload_${sessionId}`, 'true');
      setLoading(false);
      navigate(`/session/${sessionId}/upload`);
    } catch (err) {
      console.error('NewSession submit error:', err);
      setError('Something went wrong — please try again.');
      setLoading(false);
    }
  }

  return (
    <PageContainer>
      <div style={styles.header}>
        <button style={styles.back} onClick={() => navigate('/')}>←</button>
        <span style={styles.title}>New session</span>
      </div>

      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Event name</label>
          <input
            style={styles.input}
            type="text"
            enterKeyHint="next"
            value={eventName}
            onChange={e => setEventName(e.target.value)}
            placeholder={eventPlaceholder}
          />
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Date</label>
          <input
            style={{ ...styles.input, colorScheme: 'light dark', textAlign: 'left' }}
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Your name / nickname</label>
          <input
            style={styles.input}
            type="text"
            enterKeyHint="done"
            value={userName}
            onChange={e => setUserName(e.target.value)}
            placeholder={namePlaceholder}
          />
        </div>

        <div style={styles.divider} />

        <p style={styles.helper}>
          Others can join via a shared link once the session starts.
        </p>

        <button
          type="submit"
          style={{ ...styles.btnPrimary, opacity: loading ? 0.7 : 1 }}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="spinner" />
              Creating...
            </>
          ) : 'Continue →'}
        </button>

        {(!eventName.trim() || !date || !userName.trim()) && !loading && (
          <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            Fill in all fields to continue
          </div>
        )}

        {error && <p style={styles.error}>{error}</p>}
      </form>
    </PageContainer>
  );
}

const styles = {
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '28px',
  },
  back: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    padding: '0',
    lineHeight: 1,
  },
  title: {
    fontSize: '20px',
    fontWeight: 500,
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '16px',
  },
  label: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  input: {
    width: '100%',
    border: '0.5px solid var(--border-color)',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '13px',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    outline: 'none',
    colorScheme: 'light dark',
  },
  divider: {
    borderTop: '0.5px solid var(--border-color)',
    margin: '16px 0',
  },
  helper: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    marginBottom: '16px',
  },
  error: {
    fontSize: '12px',
    color: 'var(--text-danger)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    marginTop: '12px',
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
};

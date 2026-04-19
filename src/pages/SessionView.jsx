import { useParams } from 'react-router-dom';

export default function SessionView() {
  const { sessionId } = useParams();
  return (
    <div style={{ padding: '40px 24px' }}>
      <h2>Session</h2>
      <p>Session ID: {sessionId}</p>
      <p>Coming soon.</p>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useToast } from '../context/ToastContext';

export default function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const { showToast } = useToast();

  useEffect(() => {
    function onOffline() { setOffline(true); }
    function onOnline() {
      setOffline(false);
      showToast('Back online', 'success');
    }
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [showToast]);

  if (!offline) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9998,
      backgroundColor: '#633806', color: '#fff',
      padding: '10px 16px', textAlign: 'center',
      fontSize: '13px', fontWeight: 500,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      No internet connection
    </div>
  );
}

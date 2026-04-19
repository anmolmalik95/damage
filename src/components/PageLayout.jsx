import { useIsDesktop } from '../hooks/useIsDesktop';

export default function PageLayout({ children }) {
  const isDesktop = useIsDesktop();

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: 'var(--bg-primary)',
      padding: isDesktop ? '48px' : '24px',
    }}>
      <div style={{
        maxWidth: '640px',
        margin: '0 auto',
        width: '100%',
      }}>
        {children}
      </div>
    </div>
  );
}

import { useIsDesktop } from '../hooks/useIsDesktop';

export default function PageContainer({ children, noPadBottom }) {
  const isDesktop = useIsDesktop();

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: 'var(--bg-primary)',
      padding: isDesktop ? '48px 48px' : `20px 16px ${noPadBottom ? '80px' : '20px'}`,
    }}>
      <div style={{
        maxWidth: isDesktop ? '680px' : '100%',
        margin: isDesktop ? '0 auto' : undefined,
        width: '100%',
      }}>
        {children}
      </div>
    </div>
  );
}

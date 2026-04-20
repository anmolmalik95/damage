import { motion } from 'framer-motion';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { useNavigationDirection } from '../context/NavigationContext';

export default function PageContainer({ children, noPadBottom }) {
  const isDesktop = useIsDesktop();
  const direction = useNavigationDirection();

  return (
    <motion.div
      initial={{ opacity: 0, x: direction === 'back' ? -24 : 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: direction === 'back' ? 24 : -24 }}
      transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--bg-primary)',
        padding: isDesktop ? '48px 48px' : `20px 16px ${noPadBottom ? '80px' : '20px'}`,
      }}
    >
      <div style={{
        maxWidth: isDesktop ? '680px' : '100%',
        margin: isDesktop ? '0 auto' : undefined,
        width: '100%',
      }}>
        {children}
      </div>
    </motion.div>
  );
}

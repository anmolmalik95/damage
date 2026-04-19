export default function SkeletonBlock({ width = '100%', height = '16px', borderRadius = '6px', style = {} }) {
  return (
    <div style={{
      width, height, borderRadius,
      backgroundColor: 'var(--bg-secondary)',
      backgroundImage: 'linear-gradient(90deg, var(--bg-secondary) 25%, var(--skeleton-shine) 50%, var(--bg-secondary) 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite linear',
      flexShrink: 0,
      ...style,
    }} />
  );
}

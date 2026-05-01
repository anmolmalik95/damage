import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Render error caught by ErrorBoundary:', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      const message = this.state.error?.message ?? 'Unknown error';
      return (
        <div style={styles.page}>
          <div style={styles.card}>
            <div style={styles.title}>Something went wrong on this page</div>
            <div style={styles.body}>
              The page hit an unexpected error. Your data is safe — go back home and try again. If it keeps happening, screenshot this and send it across.
            </div>
            <div style={styles.errorBox}>{message}</div>
            <div style={styles.actions}>
              <button style={styles.btnPrimary} onClick={() => { window.location.href = '/'; }}>
                Go home
              </button>
              <button style={styles.btnSecondary} onClick={() => window.location.reload()}>
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const styles = {
  page: {
    minHeight: '100vh',
    backgroundColor: 'var(--bg-primary)',
    padding: '20px 16px',
    paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: '480px',
    backgroundColor: 'var(--bg-secondary)',
    borderRadius: '12px',
    padding: '20px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  title: {
    fontSize: '17px',
    fontWeight: 500,
    color: 'var(--text-primary)',
    marginBottom: '8px',
  },
  body: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    marginBottom: '16px',
  },
  errorBox: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    backgroundColor: 'var(--bg-primary)',
    padding: '10px 12px',
    borderRadius: '8px',
    fontFamily: 'ui-monospace, monospace',
    border: '0.5px solid var(--border-color)',
    marginBottom: '16px',
    overflowWrap: 'break-word',
  },
  actions: {
    display: 'flex',
    gap: '10px',
  },
  btnPrimary: {
    flex: 1,
    padding: '12px',
    fontSize: '14px',
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'var(--btn-primary-bg)',
    color: 'var(--btn-primary-text)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  btnSecondary: {
    flex: 1,
    padding: '12px',
    fontSize: '14px',
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backgroundColor: 'transparent',
    color: 'var(--text-primary)',
    border: '0.5px solid var(--border-color)',
    borderRadius: '8px',
    cursor: 'pointer',
  },
};

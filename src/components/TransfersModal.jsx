import { motion, AnimatePresence } from 'framer-motion';

export default function TransfersModal({
  open,
  onClose,
  transfers,
  members,
  currentMemberId,
  isAdmin,
  onSetPaid,
}) {
  if (!open) return null;
  const nameOf = id => members.find(m => m.id === id)?.name ?? '?';
  const settledCount = transfers.filter(t => t.status === 'paid').length;

  function canToggle(t) {
    if (isAdmin) return true;
    return t.fromId === currentMemberId || t.toId === currentMemberId;
  }

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        style={s.backdrop}
        onClick={onClose}
      />
      <motion.div
        key="sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
        style={s.sheet}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="All transfers"
      >
        <div style={s.handle} />
        <div style={s.header}>
          <div>
            <div style={s.title}>All transfers</div>
            <div style={s.subtitle}>{settledCount} of {transfers.length} settled</div>
          </div>
          <button style={s.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div style={s.list}>
          {transfers.length === 0 && (
            <div style={s.emptyState}>No transfers in this session.</div>
          )}
          {transfers.map(t => {
            const allowed = canToggle(t);
            const fromName = nameOf(t.fromId);
            const toName = nameOf(t.toId);
            const isCurrentDebtor = t.fromId === currentMemberId;
            const isCurrentCreditor = t.toId === currentMemberId;
            const directionLabel = isCurrentDebtor
              ? `You → ${toName}`
              : isCurrentCreditor
                ? `${fromName} → You`
                : `${fromName} → ${toName}`;

            return (
              <div key={`${t.fromId}__${t.toId}`} style={s.row}>
                <div style={s.rowMain}>
                  <div style={s.rowLeft}>
                    <div style={s.direction}>{directionLabel}</div>
                    {t.status === 'paid' && (
                      <span style={s.statusPaid}>Paid ✓</span>
                    )}
                    {t.status === 'pending' && (
                      <span style={s.statusPending}>Pending</span>
                    )}
                    {t.status === 'reconcile' && (
                      <span style={s.statusReconcile}>Needs reconcile</span>
                    )}
                  </div>
                  <div style={s.rowRight}>
                    <div style={s.amount}>${t.requiredAmount.toFixed(2)}</div>
                  </div>
                </div>

                {t.status === 'reconcile' && (
                  <ReconcilePill transfer={t} allowed={allowed} onSquareUp={() => onSetPaid(t, true)} />
                )}

                {allowed && t.status !== 'reconcile' && (
                  <button
                    style={t.status === 'paid' ? s.unmarkBtn : s.markPaidBtn}
                    onClick={() => onSetPaid(t, t.status !== 'paid')}
                  >
                    {t.status === 'paid' ? 'Unmark paid' : 'Mark paid'}
                  </button>
                )}
                {!allowed && t.status !== 'reconcile' && (
                  <div style={s.notYourTransfer}>Only {fromName}, {toName}, or admin can mark this.</div>
                )}
              </div>
            );
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function ReconcilePill({ transfer, allowed, onSquareUp }) {
  const delta = transfer.requiredAmount - transfer.paidAmount;
  const short = delta > 0;
  const absDelta = Math.abs(delta);
  return (
    <div style={s.reconcileBox}>
      <div style={s.reconcileText}>
        Paid ${transfer.paidAmount.toFixed(2)} · {short ? `short $${absDelta.toFixed(2)}` : `over $${absDelta.toFixed(2)}`}
      </div>
      {allowed && (
        <button style={s.squareUpBtn} onClick={onSquareUp}>
          {short ? 'Mark squared up' : 'Mark refunded'}
        </button>
      )}
    </div>
  );
}

const s = {
  backdrop: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 200 },
  sheet: {
    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 201,
    backgroundColor: 'var(--bg-primary)', borderRadius: '20px 20px 0 0',
    maxHeight: '90vh', overflowY: 'auto',
    padding: '12px 16px 32px',
    paddingBottom: 'calc(32px + env(safe-area-inset-bottom))',
    display: 'flex', flexDirection: 'column',
  },
  handle: { width: '36px', height: '4px', borderRadius: '2px', backgroundColor: 'var(--border-color)', margin: '0 auto 12px', flexShrink: 0 },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px', flexShrink: 0 },
  title: { fontSize: '17px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  subtitle: { fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '2px' },
  closeBtn: { background: 'none', border: 'none', fontSize: '22px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px', lineHeight: 1 },
  list: { display: 'flex', flexDirection: 'column', gap: '10px' },
  emptyState: { fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'system-ui, -apple-system, sans-serif', textAlign: 'center', padding: '20px 0' },
  row: { backgroundColor: 'var(--bg-secondary)', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' },
  rowMain: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
  rowLeft: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: 1 },
  rowRight: { display: 'flex', alignItems: 'center', flexShrink: 0 },
  direction: { fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  amount: { fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  statusPaid: { fontSize: '11px', fontWeight: 500, color: '#27500A', fontFamily: 'system-ui, -apple-system, sans-serif' },
  statusPending: { fontSize: '11px', fontWeight: 500, color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif' },
  statusReconcile: { fontSize: '11px', fontWeight: 500, color: '#9A5A1A', fontFamily: 'system-ui, -apple-system, sans-serif' },
  markPaidBtn: { backgroundColor: 'var(--bg-primary)', border: '0.5px solid var(--border-color)', borderRadius: '6px', padding: '7px', fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer' },
  unmarkBtn: { backgroundColor: '#EAF3DE', border: 'none', borderRadius: '6px', padding: '7px', fontSize: '12px', fontWeight: 500, color: '#27500A', fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer' },
  notYourTransfer: { fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'system-ui, -apple-system, sans-serif', fontStyle: 'italic' },
  reconcileBox: { backgroundColor: '#FAEEDA', borderRadius: '8px', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px' },
  reconcileText: { fontSize: '12px', color: '#633806', fontFamily: 'system-ui, -apple-system, sans-serif' },
  squareUpBtn: { backgroundColor: '#fff', border: '0.5px solid #D9B07E', borderRadius: '6px', padding: '6px', fontSize: '12px', fontWeight: 500, color: '#633806', fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer' },
};

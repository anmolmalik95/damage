// Single source of truth for the per-session debt graph.
// Inputs are the raw Firestore-shaped objects. Output is the canonical
// transfer list that drives the progress bar, settle-up/you're-owed panels,
// the transfers modal, and the per-user card settlement section.

function venueMemberData(venue, claims) {
  const subs = {};
  for (const item of venue.items) {
    const itemClaims = claims.filter(c => c.itemId === item.id);
    for (const claim of itemClaims) {
      if (claim.type === 'whole') {
        subs[claim.memberId] = (subs[claim.memberId] || 0) + (item.unitPrice ?? 0);
      } else if (claim.type === 'shared') {
        const n = claim.sharedWith?.length || 1;
        (claim.sharedWith || []).forEach(mid => {
          subs[mid] = (subs[mid] || 0) + (item.unitPrice ?? 0) / n;
        });
      }
    }
  }
  const totalSub = Object.values(subs).reduce((a, b) => a + b, 0);
  const result = {};
  for (const [memberId, sub] of Object.entries(subs)) {
    const ratio = totalSub > 0 ? sub / totalSub : 0;
    const gst = ratio * (venue.gstAmount || 0);
    const sc = ratio * (venue.serviceChargeAmount || 0);
    result[memberId] = { subtotal: sub, gst, sc, total: sub + gst + sc };
  }
  return result;
}

export function buildRawDebts({ venues, claims, sessionBillPayer, isMultiPayer }) {
  const rawDebts = [];
  for (const venue of venues) {
    const isTransport = venue.name === 'Transport' || venue.isTransport;
    if (isTransport) {
      for (const item of venue.items) {
        const itemBillPayer = item.billPayer || (isMultiPayer ? null : sessionBillPayer);
        if (!itemBillPayer) continue;
        const itemClaims = claims.filter(c => c.itemId === item.id);
        for (const claim of itemClaims) {
          if (claim.type === 'whole') {
            const debtor = claim.memberId;
            if (debtor === itemBillPayer) continue;
            rawDebts.push({ debtorId: debtor, creditorId: itemBillPayer, amount: item.unitPrice ?? 0, label: item.name });
          } else if (claim.type === 'shared') {
            const share = (item.unitPrice ?? 0) / (claim.sharedWith?.length || 1);
            for (const debtor of (claim.sharedWith || [])) {
              if (debtor === itemBillPayer) continue;
              rawDebts.push({ debtorId: debtor, creditorId: itemBillPayer, amount: share, label: item.name });
            }
          }
        }
      }
    } else {
      const vBillPayer = venue.billPayer || (isMultiPayer ? null : sessionBillPayer);
      if (!vBillPayer) continue;
      const memberData = venueMemberData(venue, claims);
      for (const [memberId, data] of Object.entries(memberData)) {
        if (memberId === vBillPayer) continue;
        rawDebts.push({ debtorId: memberId, creditorId: vBillPayer, amount: data.total, label: venue.name });
      }
    }
  }
  return rawDebts;
}

// Greedy net-balance simplification.
export function simplifyDebts(rawDebts) {
  const netBalances = {};
  rawDebts.forEach(d => {
    netBalances[d.debtorId] = (netBalances[d.debtorId] || 0) - d.amount;
    netBalances[d.creditorId] = (netBalances[d.creditorId] || 0) + d.amount;
  });
  const people = Object.entries(netBalances).map(([id, bal]) => ({ id, bal }));
  const transactions = [];
  if (people.length === 0) return transactions;
  for (let i = 0; i < 500; i++) {
    const creditor = people.reduce((a, b) => b.bal > a.bal ? b : a);
    const debtor = people.reduce((a, b) => b.bal < a.bal ? b : a);
    if (creditor.bal < 0.005 || debtor.bal > -0.005) break;
    const amount = Math.min(creditor.bal, -debtor.bal);
    transactions.push({ fromId: debtor.id, toId: creditor.id, amount: Math.round(amount * 100) / 100 });
    creditor.bal -= amount;
    debtor.bal += amount;
  }
  return transactions;
}

export function transferKey(fromId, toId) {
  return `${fromId}__${toId}`;
}

// What a member paid out-of-pocket: sum of full venue/item totals where they're
// the bill payer. Returns total + breakdown by source for explanation UI.
export function computeMemberPaid({ memberId, venues, sessionBillPayer, isMultiPayer }) {
  let total = 0;
  const sources = [];
  for (const venue of venues) {
    const isTransport = venue.name === 'Transport' || venue.isTransport;
    if (isTransport) {
      for (const item of venue.items) {
        const itemBillPayer = item.billPayer || (isMultiPayer ? null : sessionBillPayer);
        if (itemBillPayer !== memberId) continue;
        const amt = (item.unitPrice ?? 0) * (item.quantity ?? 1);
        total += amt;
        sources.push({ label: item.name, amount: amt });
      }
    } else {
      const vBillPayer = venue.billPayer || (isMultiPayer ? null : sessionBillPayer);
      if (vBillPayer !== memberId) continue;
      const subtotal = venue.items.reduce((s, i) => s + (i.unitPrice ?? 0) * (i.quantity ?? 1), 0);
      const amt = subtotal + (venue.gstAmount || 0) + (venue.serviceChargeAmount || 0);
      total += amt;
      sources.push({ label: venue.name, amount: amt });
    }
  }
  return { total, sources };
}

// Returns canonical transfer list with paid status overlaid.
// Each row: { fromId, toId, requiredAmount, paidAmount, paid, status, paidAt }
// status ∈ 'pending' | 'paid' | 'reconcile'
//   'pending'   — not marked paid
//   'paid'      — marked paid AND paidAmount matches requiredAmount (within rounding)
//   'reconcile' — marked paid but paidAmount differs (admin reopened+edited; needs squaring up)
export function computeTransfers({ venues, claims, sessionBillPayer, isMultiPayer, paidStatus }) {
  const rawDebts = buildRawDebts({ venues, claims, sessionBillPayer, isMultiPayer });
  const simplified = simplifyDebts(rawDebts);

  return simplified.map(t => {
    const key = transferKey(t.fromId, t.toId);
    const ps = paidStatus[key] ?? {};
    const paid = ps.paid ?? false;
    const paidAmount = paid ? Number(ps.paidAmount ?? 0) : 0;
    const requiredAmount = t.amount;
    let status;
    if (!paid) status = 'pending';
    else if (Math.abs(paidAmount - requiredAmount) < 0.005) status = 'paid';
    else status = 'reconcile';
    return { fromId: t.fromId, toId: t.toId, requiredAmount, paidAmount, paid, status, paidAt: ps.paidAt ?? null };
  });
}

// Detect legacy paid-status docs and produce the migration plan.
// Old shape: doc id is just the memberId (no `__`), data is { paid, paidAt, selfReported? }
// New shape: doc id is `${debtorId}__${creditorId}`, data is { paid, paidAmount, paidAt }
//
// Returns { writes: [{ id, data }], deletes: [oldId] } — caller applies them.
// Idempotent: if no legacy docs exist, returns empty arrays.
export function planLegacyMigration({ paidStatus, transfers }) {
  const writes = [];
  const deletes = [];
  for (const [docId, data] of Object.entries(paidStatus)) {
    if (docId.includes('__')) continue;
    const oldMemberId = docId;
    const matchingTransfers = transfers.filter(t => t.fromId === oldMemberId);
    if (matchingTransfers.length === 0) {
      deletes.push(oldMemberId);
      continue;
    }
    const wasPaid = data.paid ?? false;
    if (!wasPaid) {
      deletes.push(oldMemberId);
      continue;
    }
    for (const t of matchingTransfers) {
      writes.push({
        id: transferKey(t.fromId, t.toId),
        data: { paid: true, paidAmount: t.requiredAmount, paidAt: data.paidAt ?? null },
      });
    }
    deletes.push(oldMemberId);
  }
  return { writes, deletes };
}

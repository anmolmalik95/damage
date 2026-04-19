import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

// Groups members across sessions by fuzzy name similarity.
// Similar = Levenshtein distance <= 3 OR one name contains the other.
// allMembers: [{ sessionId, memberId, name }]
// Returns clusters where 2+ sessions are represented.
export function clusterMembers(allMembers) {
  const n = allMembers.length;
  const parent = allMembers.map((_, i) => i);

  function find(x) {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }
  function union(x, y) { parent[find(x)] = find(y); }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (allMembers[i].sessionId === allMembers[j].sessionId) continue;
      const a = allMembers[i].name.toLowerCase();
      const b = allMembers[j].name.toLowerCase();
      const similar = levenshtein(a, b) <= 3 || a.includes(b) || b.includes(a);
      if (similar) union(i, j);
    }
  }

  const groups = {};
  allMembers.forEach((m, i) => {
    const root = find(i);
    if (!groups[root]) groups[root] = [];
    groups[root].push(m);
  });

  return Object.values(groups).filter(
    g => g.length >= 2 && new Set(g.map(m => m.sessionId)).size >= 2
  );
}

// Computes a single member's total bill (subtotal + proportional tax) for a session.
export function computeMemberTotal(session, memberId) {
  let grandTotal = 0;
  for (const venue of session.venues) {
    const subs = {};
    for (const item of venue.items) {
      for (const claim of session.claims.filter(c => c.itemId === item.id)) {
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
    const mine = subs[memberId] || 0;
    if (!mine) continue;
    const total = Object.values(subs).reduce((a, b) => a + b, 0);
    const ratio = total > 0 ? mine / total : 0;
    grandTotal += mine + ratio * (venue.gstAmount || 0) + ratio * (venue.serviceChargeAmount || 0);
  }
  return grandTotal;
}

export async function fetchSessionData(sessionId) {
  const [sessionSnap, membersSnap, claimsSnap, venuesSnap] = await Promise.all([
    getDoc(doc(db, 'sessions', sessionId)),
    getDocs(collection(db, 'sessions', sessionId, 'members')),
    getDocs(collection(db, 'sessions', sessionId, 'claims')),
    getDocs(collection(db, 'sessions', sessionId, 'venues')),
  ]);
  if (!sessionSnap.exists()) return null;
  const venues = await Promise.all(
    venuesSnap.docs.map(async vDoc => {
      const itemsSnap = await getDocs(
        collection(db, 'sessions', sessionId, 'venues', vDoc.id, 'items')
      );
      return { id: vDoc.id, ...vDoc.data(), items: itemsSnap.docs.map(d => ({ id: d.id, ...d.data() })) };
    })
  );
  return {
    id: sessionId,
    ...sessionSnap.data(),
    members: membersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    claims: claimsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    venues,
  };
}

// Builds canonical person map from confirmed groups + unmatched individuals.
// Returns { memberToCanonical, canonicals }
// memberToCanonical: `${sessionId}:${memberId}` → canonicalId
// canonicals: canonicalId → { name }
export function buildCanonical(sessions, canonicalGroups) {
  const memberToCanonical = {};
  const canonicals = {};

  canonicalGroups.forEach((group, idx) => {
    const canonicalId = `g${idx}`;
    const first = group[0];
    const session = sessions.find(s => s.id === first.sessionId);
    const member = session?.members.find(m => m.id === first.memberId);
    canonicals[canonicalId] = { name: member?.name ?? '?' };
    group.forEach(({ sessionId, memberId }) => {
      memberToCanonical[`${sessionId}:${memberId}`] = canonicalId;
    });
  });

  sessions.forEach(session => {
    session.members.forEach(member => {
      const key = `${session.id}:${member.id}`;
      if (!memberToCanonical[key]) {
        const canonicalId = `s_${session.id}_${member.id}`;
        memberToCanonical[key] = canonicalId;
        canonicals[canonicalId] = { name: member.name };
      }
    });
  });

  return { memberToCanonical, canonicals };
}

// Returns simplified transactions: [{ from, to, amount }] using net balance matching.
export function simplifyDebts(sessions, memberToCanonical, canonicals) {
  const balances = {};
  Object.keys(canonicals).forEach(id => { balances[id] = 0; });

  sessions.forEach(session => {
    if (!session.billPayer) return;
    const payerKey = `${session.id}:${session.billPayer}`;
    const payerCanonical = memberToCanonical[payerKey];
    if (!payerCanonical) return;

    session.members.forEach(member => {
      const memberCanonical = memberToCanonical[`${session.id}:${member.id}`];
      if (!memberCanonical || memberCanonical === payerCanonical) return;
      const total = computeMemberTotal(session, member.id);
      balances[memberCanonical] -= total;
      balances[payerCanonical] += total;
    });
  });

  const people = Object.entries(balances)
    .map(([id, bal]) => ({ id, name: canonicals[id].name, bal }));

  const transactions = [];
  for (let i = 0; i < 500; i++) {
    const creditor = people.reduce((a, b) => b.bal > a.bal ? b : a);
    const debtor = people.reduce((a, b) => b.bal < a.bal ? b : a);
    if (creditor.bal < 0.005 || debtor.bal > -0.005) break;
    const amount = Math.min(creditor.bal, -debtor.bal);
    transactions.push({ from: debtor.name, to: creditor.name, amount: Math.round(amount * 100) / 100 });
    creditor.bal -= amount;
    debtor.bal += amount;
  }

  return transactions;
}

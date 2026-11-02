import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
export const FACETS = new Set(['static', 'unit', 'documentation', 'live', 'signoff']);
const codes = { S: 'static', U: 'unit', D: 'documentation', L: 'live', O: 'signoff' };

// Clause order is the source backlog's order, not a keyword-derived live heuristic.
const requirements = {
  'GATE-03': ['SUL', 'SL', 'S', 'U'],
  'GATE-07': ['SU', 'SD', 'SL', 'U'],
  'GATE-06': ['SD', 'SUL', 'SU', 'D'],
  'GATE-11': ['L', 'SUL', 'SU', 'L'],
  'GATE-01': ['SU', 'U', 'U', 'S'],
  'GATE-02': ['SUL', 'UL', 'SU', 'U', 'L'],
  'GATE-09': ['UL', 'UL', 'UL', 'U', 'SL'],
  'GATE-04': ['UL', 'SL', 'UL', 'L'],
  'GATE-08': ['UL', 'UL', 'UL', 'U', 'D'],
  'GATE-10': ['UL', 'SUL', 'UL', 'UL', 'U'],
  'GATE-12': ['UL', 'D', 'SU', 'U'],
  'GATE-13': ['UL', 'UL', 'DL', 'D'],
  'GATE-05': ['SL', 'UL', 'UL', 'UL', 'L'],
  'INF-02': ['SL', 'SL', 'SL', 'L'],
  'JVM-05': ['SD', 'S', 'SL', 'SU'],
  'CRT-01': ['D', 'D', 'D'],
  'GOV-01': ['D', 'S', 'D', 'D'],
  'ADR-01': ['DO', 'D', 'DO', 'D'],
  'ARC-01': ['D', 'D', 'SU'],
  'ADR-02': ['DO', 'D', 'D'],
  'INF-01': ['SL', 'SL', 'SL', 'SL'],
  'OBS-03': ['UL', 'DL', 'UL'],
  'INF-04': ['SL', 'SL', 'DL', 'L'],
  'API-02': ['UL', 'UL', 'UL'],
  'API-01': ['UL', 'UL', 'UL', 'L'],
  'INF-03': ['SL', 'SL', 'SL', 'SL'],
  'JVM-01': ['L', 'SL', 'L', 'L'],
  'JVM-02': ['SL', 'UL', 'UL'],
  'INF-06': ['SL', 'SL', 'SL', 'L'],
  'MSG-01': ['S', 'U', 'UL', 'SU'],
  'MSG-07': ['UL', 'UL', 'DL'],
  'JVM-04': ['UL', 'U', 'UL', 'DL'],
  'INF-05': ['SL', 'SL', 'L', 'S'],
  'DAT-01': ['UL', 'UL', 'UL', 'D'],
  'DAT-02': ['SD', 'UL', 'UL'],
  'WEB-01': ['SL', 'UL', 'UL', 'UL'],
  'IDN-01': ['UL', 'UL', 'UL'],
  'IDN-02': ['SL', 'DO', 'UL'],
  'WEB-02': ['SL', 'UL', 'UL'],
  'DOC-01': ['D', 'D', 'SU'],
  'JVM-03': ['SU', 'UL', 'DL'],
  'MSG-02': ['UL', 'UL', 'UL', 'UL'],
  'MSG-03': ['UL', 'UL', 'UL'],
  'OBS-01': ['D', 'SD', 'UL'],
  'OBS-02': ['UL', 'S', 'UL', 'L'],
  'DEM-00': ['UL', 'UL', 'UL', 'UL', 'D'],
  'DEM-03': ['UL', 'SL', 'U', 'UL'],
  'DEM-04': ['UL', 'UL', 'UL', 'UL'],
  'DEM-06': ['UL', 'UL', 'UL'],
  'DEM-12': ['UL', 'UL', 'UL', 'UL'],
  'DEM-13': ['UL', 'UL', 'UL', 'UL'],
  'DEM-01': ['UL', 'UL', 'L', 'UL'],
  'DEM-11': ['UL', 'UL', 'UL'],
  'MSG-04': ['UL', 'UL', 'UL'],
  'DEM-07': ['UL', 'UL', 'UL'],
  'MSG-08': ['UL', 'UL', 'UL'],
  'DEM-08': ['UL', 'UL', 'UL'],
  'DEM-14': ['UL', 'UL', 'UL'],
  'DOC-02': ['D', 'D', 'D'],
  'WEB-03': ['UL', 'UL', 'D', 'UL'],
  'DEM-02': ['UL', 'DL', 'UL'],
  'MSG-06': ['UL', 'UL', 'UL'],
  'DEM-09': ['UL', 'UL', 'UL'],
  'OBS-04': ['UL', 'L', 'UL', 'LO'],
  'OBS-07': ['DL', 'UL', 'D'],
  'DEM-15': ['UL', 'LO', 'UL', 'UL'],
  'MSG-05': ['UL', 'UL', 'UL'],
  'INF-07': ['LO', 'SL', 'DL', 'DO'],
  'DEM-05': ['UL', 'UL', 'UL'],
  'DEM-10': ['UL', 'UL', 'UL'],
  'DOC-03': ['D', 'D', 'D'],
  'CRT-03': ['D', 'D', 'D'],
  'OBS-05': ['SL', 'S', 'L'],
  'DOC-04': ['D', 'D', 'L'],
  'CRT-02': ['LO', 'DL', 'LO', 'D'],
  'OBS-06': ['UL', 'U', 'UL'],
  'EVL-B': ['DL', 'SL', 'D'],
  'EVL-A': ['DO', 'L', 'SL']
};

export function createAcceptanceScopes(cards, sourceBacklogSha256) {
  if (cards.length !== 78 || Object.keys(requirements).length !== 78) throw new Error('Explicit 78-card scope map required');
  return {
    schema: 'contoso.acceptance-scopes.v1',
    sourceBacklogSha256,
    authority: 'Prompt, Brief and approved construction/completion distinction; source review is not live acceptance',
    sourceAcceptanceIsCertification: false,
    cards: Object.fromEntries(cards.map(card => {
      const list = requirements[card.id];
      if (!list || list.length !== card.clauses.length) throw new Error(`Unmapped acceptance clause: ${card.id}`);
      const clauses = list.map((code, index) => ({
        index: index + 1, textSha256: digest(card.clauses[index].text),
        requiredFacets: [...code].map(value => codes[value]),
        liveEvidenceKinds: /^GATE-(?:04|08|09|10|13)$|^DEM-/.test(card.id)
          ? ['azure-monitor-logs']
          : ['azure-monitor-logs', 'azure-arm-state', 'approved-native-runtime', 'approved-native-wire', 'ci-execution'],
        nextAction: code.includes('L')
          ? 'Execute the implemented checker on approved bounded native Azure evidence; retain local checks separately.'
          : code.includes('O') ? 'Obtain the named accountable owner decision; role review votes do not substitute.'
            : 'Execute the source-bound local check or review the completed document and link current evidence.'
      }));
      return [card.id, {
        clauseCount: clauses.length,
        liveClauses: clauses.filter(clause => clause.requiredFacets.includes('live')).map(clause => clause.index),
        clauses
      }];
    }))
  };
}

export function validateAcceptanceScopes(cards, policy, sourceBacklogSha256) {
  if (policy?.schema !== 'contoso.acceptance-scopes.v1' || policy.sourceBacklogSha256 !== sourceBacklogSha256 ||
      policy.sourceAcceptanceIsCertification !== false || !policy.cards || Object.keys(policy.cards).length !== cards.length) {
    throw new Error('Acceptance scope mapping is missing, unapproved, or stale');
  }
  const approved = createAcceptanceScopes(cards, sourceBacklogSha256);
  for (const card of cards) {
    const mapping = policy.cards[card.id];
    if (mapping?.clauseCount !== card.clauses.length || mapping.clauses?.length !== card.clauses.length) throw new Error(`Clause scope count mismatch: ${card.id}`);
    const live = [];
    mapping.clauses.forEach((clause, index) => {
      if (clause.index !== index + 1 || clause.textSha256 !== digest(card.clauses[index].text) ||
          !Array.isArray(clause.requiredFacets) || !clause.requiredFacets.length ||
          new Set(clause.requiredFacets).size !== clause.requiredFacets.length ||
          clause.requiredFacets.some(value => !FACETS.has(value))) throw new Error(`Stale/invalid exact clause scope: ${card.id}/${index + 1}`);
      if (!Array.isArray(clause.liveEvidenceKinds) || !clause.liveEvidenceKinds.length ||
          clause.liveEvidenceKinds.some(value => !['azure-monitor-logs', 'azure-arm-state', 'approved-native-runtime', 'approved-native-wire', 'ci-execution'].includes(value))) throw new Error(`Unmapped native live evidence: ${card.id}`);
      const authoritative = approved.cards[card.id].clauses[index];
      if (JSON.stringify(clause.requiredFacets) !== JSON.stringify(authoritative.requiredFacets) ||
          JSON.stringify(clause.liveEvidenceKinds) !== JSON.stringify(authoritative.liveEvidenceKinds)) {
        throw new Error(`Weakened/unapproved authoritative acceptance facets: ${card.id}/${index + 1}`);
      }
      if (clause.requiredFacets.includes('live')) live.push(index + 1);
    });
    if (JSON.stringify(live) !== JSON.stringify(mapping.liveClauses)) throw new Error(`Inconsistent live scope: ${card.id}`);
  }
  return policy.cards;
}

export function acceptanceFacets(criterion) {
  return criterion.facets ?? [criterion];
}

export function clauseComplete(criterion, policy) {
  if (!criterion || criterion.result !== 'PASS' || !policy) return false;
  const facets = acceptanceFacets(criterion);
  return policy.requiredFacets.every(scope => facets.some(facet => facet.scope === scope && facet.result === 'PASS'));
}

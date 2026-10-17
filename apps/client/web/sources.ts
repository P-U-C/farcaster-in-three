export interface CastSource {
  signer: string;
  requestFid: number | null;
  label: string;
  isThisClient: boolean;
}

export interface SourceGroup {
  id: string;
  label: string;
  requestFid: number | null;
  isThisClient: boolean;
  signers: CastSource[];
}

export function groupSources(sources: CastSource[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();

  for (const source of dedupeSources(sources)) {
    const id = source.isThisClient
      ? `own:${source.signer}`
      : source.requestFid
        ? `requester:${source.requestFid}`
        : `signer:${source.signer}`;
    const existing = groups.get(id);
    if (existing) {
      existing.signers.push(source);
      continue;
    }

    groups.set(id, {
      id,
      label: source.isThisClient
        ? "In Three"
        : source.requestFid
          ? source.label
          : "Unknown client",
      requestFid: source.requestFid,
      isThisClient: source.isThisClient,
      signers: [source],
    });
  }

  return [...groups.values()].sort((left, right) => {
    if (left.isThisClient !== right.isThisClient) return left.isThisClient ? -1 : 1;
    return left.label.localeCompare(right.label);
  });
}

export function toggleSourceGroup(
  excluded: Set<string>,
  signers: string[],
): Set<string> {
  const next = new Set(excluded);
  const anyExcluded = signers.some((signer) => next.has(signer));
  for (const signer of signers) {
    if (anyExcluded) next.delete(signer);
    else next.add(signer);
  }
  return next;
}

function dedupeSources(sources: CastSource[]): CastSource[] {
  return [...new Map(sources.map((source) => [source.signer, source])).values()];
}

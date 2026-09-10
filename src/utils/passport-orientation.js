export function selectBestPassportOrientation(candidates) {
    const validCandidates = Array.isArray(candidates)
        ? candidates.filter((candidate) => candidate && Number.isFinite(candidate.score))
        : [];

    if (validCandidates.length === 0) {
        return { rotation: 0, score: 0, text: '' };
    }

    return validCandidates.reduce((best, candidate) => {
        if (candidate.score > best.score) return candidate;
        if (candidate.score === best.score && candidate.rotation < best.rotation) return candidate;
        return best;
    });
}

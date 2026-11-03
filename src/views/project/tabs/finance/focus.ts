// Cross-tab focus: another tab sets the commitment (and optionally the RFI / CCO) to open when Finance mounts.
let focus: { contractId: string; ccoId?: string } | null = null
export const setFocusCommitment = (contractId: string, ccoId?: string) => { focus = { contractId, ccoId } }
export const takeFocusCommitment = () => { const x = focus; focus = null; return x }

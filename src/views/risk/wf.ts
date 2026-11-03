// Small workflow helpers shared by the risk and safety modules.
import type { AppState } from '@/core/types'
import { actOnWorkflow } from '@/core/engine/workflow'

/**
 * The person who fills in and submits a record has completed the process's first "form" step.
 * If the current user is an assignee on that step (or an administrator), record their submit.
 */
export function submitFirstForm(d: AppState, instId: string | undefined, comment: string) {
  if (!instId) return
  const inst = d.workflows.find((w) => w.id === instId)
  const slot = inst?.active[0]
  if (!inst || !slot) return
  const def = d.workflowDefs.find((x) => x.id === inst.defId)
  const node = def?.nodes.find((n) => n.id === slot.nodeId)
  if (node?.type !== 'form') return
  const me = d.people.find((p) => p.id === d.currentUserId)
  if (slot.assigneeIds.includes(d.currentUserId) || me?.roles.includes('admin')) {
    try { actOnWorkflow(d, inst.id, slot.nodeId, d.currentUserId, 'submit', comment) } catch { /* leave at the form step */ }
  }
}

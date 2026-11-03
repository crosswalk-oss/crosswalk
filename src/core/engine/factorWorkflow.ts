// Submitting a factor model for approval: the publish gate (structure + backtest thresholds), then the
// factor-model-publish workflow (estimating lead approves; approval publishes it and retires the prior version).
import type { AppState } from '../types'
import { backtest, gateCheck, markSubmitted, summarize, validateModel } from './factorModel'
import { actOnWorkflow, recallWorkflow, startWorkflow } from './workflow'

export interface SubmitResult { ok: boolean; reasons: string[]; instId?: string }

/** Why a model cannot be submitted right now (empty when it can). Runs the backtest. */
export function submitBlockers(s: AppState, id: string): string[] {
  const m = s.factorModels.find((x) => x.id === id)
  if (!m) return ['Model not found']
  if (m.status !== 'draft') return [`v${m.version} is ${m.status}; only a draft can be submitted`]
  const v = validateModel(m)
  if (v.length) return v
  return gateCheck(backtest(s, m), s.settings.factorModel.gate).reasons
}

/** Gate, then route for approval. Mutates the draft. Nothing changes when the gate fails. */
export function submitFactorModel(d: AppState, id: string, byId = d.currentUserId, note = ''): SubmitResult {
  const reasons = submitBlockers(d, id)
  if (reasons.length) return { ok: false, reasons }
  const m = d.factorModels.find((x) => x.id === id)!
  const bt = backtest(d, m)
  markSubmitted(d, id, summarize(bt, d.settings.factorModel.gate), byId)
  const inst = startWorkflow(d, 'factor-model-publish', {
    title: `Factor model v${m.version}`, recordType: 'factor-model', recordId: id, startedById: byId,
    data: { note: note || `Backtest MAPE ${bt.mape}%, bias ${bt.bias}%, coverage ${bt.coverage}%`, mape: bt.mape, bias: bt.bias, coverage: bt.coverage },
  })
  if (!inst) return { ok: false, reasons: ['No published factor-model-publish process'] }
  const slot = inst.active[0]
  if (slot && slot.nodeId === 'prep' && slot.assigneeIds.includes(byId)) actOnWorkflow(d, inst.id, 'prep', byId, 'submit', note || 'Submitted for approval')
  return { ok: true, reasons: [], instId: inst.id }
}

/** The approval step sent it back to the submitter (workflow waiting at the submit step again). */
export function returnedForRevision(s: AppState, id: string) {
  const m = s.factorModels.find((x) => x.id === id)
  const inst = m?.workflowInstanceId ? s.workflows.find((w) => w.id === m.workflowInstanceId) : undefined
  if (!m || m.status !== 'in-review' || !inst || inst.status !== 'running') return
  const slot = inst.active.find((a) => a.nodeId === 'prep')
  if (!slot) return
  return { inst, slot, event: [...inst.history].reverse().find((h) => h.action === 'return') }
}

/** Withdraw a model from review (or after it was returned) so it can be edited again. Mutates. */
export function withdrawFactorModel(d: AppState, id: string, byId = d.currentUserId): boolean {
  const m = d.factorModels.find((x) => x.id === id)
  if (!m || m.status !== 'in-review' || !m.workflowInstanceId) return false
  recallWorkflow(d, m.workflowInstanceId, byId)
  return d.factorModels.find((x) => x.id === id)?.status === 'draft'
}

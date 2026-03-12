import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  toSessionRevisionBinding,
  useFluttyCanvasContextV1
} from '@/composables/useFluttyCanvasContextV1'
import type {
  AgentCanvasChatResponseV1,
  AgentDebugDiagnosisEnvelopeV1,
  AgentActionDecisionRequest,
  AgentActionTransitionRecord,
  AgentMessageAppendRequest,
  AgentSessionRecord,
  JobExecutionEventV1,
  AgentSessionRevisionConflict,
  CaseMemoryDeleteStatusV1,
  CaseMemoryOptOutFlagsV1,
  CaseMemoryOptOutStateV1,
  CaseMemoryQueryResponseV1,
  JobEstimateResponseV1,
  JobInspectResponseV1,
  JobResultResponseV1,
  JobStatus,
  JobStatusResponseV1,
  MultimodalReviewRequestV1,
  MultimodalReviewResponseV1,
  SupportEntitlementVerdict,
  SupportExplainLimitResponseV1,
  WorkflowVersionListResponse,
  WorkflowVersionRecord
} from '@/stores/fluttyAgentSessionApi'
import {
  AgentSessionApiError,
  appendAgentSessionMessage,
  chatAgentSession,
  confirmAgentAction,
  createAgentJob,
  createAgentSession,
  diagnoseAgentExecution,
  explainAgentSupportLimit,
  estimateAgentJob,
  getAgentJobResult,
  getAgentMemoryDeleteStatus,
  getAgentMemoryOptOut,
  getAgentJobStatus,
  getAgentMultimodalReview,
  getAgentSession,
  inspectAgentJob,
  isAgentSessionRevisionConflictError,
  listWorkflowVersions,
  queryAgentMemory,
  rejectAgentAction,
  requestAgentMemoryDelete,
  rollbackWorkflowVersion as rollbackWorkflowVersionApi,
  submitAgentMultimodalReview,
  switchWorkflowVersion as switchWorkflowVersionApi,
  updateAgentMemoryOptOut
} from '@/stores/fluttyAgentSessionApi'

const DEFAULT_WORKSPACE_ID = 'ws-comfyui-canvas'
const DEFAULT_PRINCIPAL_ID = 'principal-comfyui-canvas'
const PINNED_Z_INDEX = 3000
const DEFAULT_POSITION = { x: 24, y: 96 }

let nextFloatingWindowZIndex = 2100

function bumpFloatingWindowZIndex() {
  nextFloatingWindowZIndex += 1
  return nextFloatingWindowZIndex
}

export type FluttyAgentShellEventType =
  | 'window-opened'
  | 'window-closed'
  | 'window-focused'
  | 'session-created'
  | 'session-fetched'
  | 'session-message-appended'
  | 'session-action-confirmed'
  | 'session-action-rejected'
  | 'job-estimated'
  | 'job-submitted'
  | 'job-status-observed'
  | 'job-result-observed'
  | 'job-inspect-observed'
  | 'job-diagnose-completed'
  | 'job-review-completed'
  | 'policy-gate-refreshed'
  | 'memory-opt-out-updated'
  | 'memory-query-completed'
  | 'memory-delete-requested'
  | 'memory-delete-status-observed'
  | 'audit-recorded'
  | 'workflow-version-candidate-accepted'
  | 'workflow-version-candidate-rejected'
  | 'workflow-versions-refreshed'
  | 'workflow-version-switched'
  | 'workflow-version-rolled-back'
  | 'session-error'

export interface FluttyAgentShellEvent {
  type: FluttyAgentShellEventType
  at: string
  payload?: Record<string, unknown>
}

type SessionState = 'idle' | 'creating' | 'loading' | 'ready' | 'error'
type WorkflowVersionState = 'idle' | 'loading' | 'ready' | 'error'
type JobExecutionState =
  | 'idle'
  | 'estimating'
  | 'estimate-ready'
  | 'submitting'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'error'
type DiagnoseState = 'idle' | 'loading' | 'ready' | 'error'
type ReviewState = 'idle' | 'loading' | 'ready' | 'error'
type PolicyGateState = 'idle' | 'loading' | 'ready' | 'error'
type MemoryState = 'idle' | 'loading' | 'ready' | 'error'

type PolicyBlockedVerdict =
  | 'upgrade_required'
  | 'budget_blocked'
  | 'concurrency_blocked'
  | 'escalate_required'

interface StandardizedErrorExplanation {
  code: string
  title: string
  detail: string
  action_hint: string
  policy_verdict: SupportEntitlementVerdict | null
}

interface PolicyGateSummary {
  verdict: SupportEntitlementVerdict
  reason_code: string | null
  reason_title: string | null
  reason_detail: string
  unblock_options: string[]
  resolved_plan_id: string | null
  resolved_pricing_path: string | null
  path_specific_cost_explain: string | null
  source: 'support_explain_limit' | 'standardized_error'
  updated_at: string
}

export interface ActionAuditRecord {
  audit_id: string
  action: string
  reason: string
  risk_level: string | null
  requires_confirmation: boolean
  trace_ref: string | null
  at: string
  metadata?: Record<string, unknown>
}

export interface NextWorkflowVersionProposal {
  action_id: string
  proposal_id: string
  title: string | null
  summary: string
  candidate_version_id: string
  base_revision: number | null
  workflow_id: string | null
  risk_level: string | null
  estimated_cost_band: string | null
  created_at: string | null
}

export interface ChatWorkflowDraft {
  workflow: Record<string, unknown>
  provider: string
  model: string
  degraded: boolean
  received_at: string
}

interface ToolPlaneWorkflowProposalCandidate {
  action_id: string
  proposal_id: string
  title: string | null
  summary: string
  candidate_version_id: string
  base_revision: number | null
  workflow_id: string | null
  risk_level: string | null
  estimated_cost_band: string | null
  created_at: string | null
  requires_confirmation: boolean
}

interface ToolPlaneWorkflowSwitchSignal {
  workflow_id: string | null
  version_id: string
  reason: string | null
  at: string | null
  key: string
}

interface ToolPlaneExecutionSignal {
  job_id: string
  status: JobStatus | null
  timeline_events: JobExecutionEventV1[]
  result: Record<string, unknown> | null
  at: string | null
  key: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function normalizeJobStatus(value: unknown): JobStatus | null {
  if (
    value !== 'queued' &&
    value !== 'running' &&
    value !== 'succeeded' &&
    value !== 'failed' &&
    value !== 'canceled'
  ) {
    return null
  }
  return value
}

function isAgentSessionNotFoundError(error: AgentSessionApiError): boolean {
  const detail = asString(asRecord(error.payload)?.detail) ?? ''
  return detail.includes('agent_session_not_found')
}

function resolveSessionActions(
  session: AgentSessionRecord | null
): Record<string, unknown>[] {
  if (!Array.isArray(session?.actions)) return []
  return session.actions
    .map((action) => asRecord(action))
    .filter((action): action is Record<string, unknown> => action !== null)
}

function toNextWorkflowVersionProposal(
  action: Record<string, unknown>
): NextWorkflowVersionProposal | null {
  const status = asString(action.status)
  if (status && status !== 'proposed') return null

  const actionId = asString(action.action_id)
  if (!actionId) return null

  const metadata = asRecord(action.metadata)
  const candidatePayload =
    asRecord(metadata?.next_workflow_version_v1) ??
    asRecord(metadata?.next_version) ??
    metadata

  if (!candidatePayload) return null

  const executionRef = asRecord(action.execution_ref)
  const candidateVersionId =
    asString(candidatePayload.candidate_version_id) ??
    asString(executionRef?.workflow_version_id)
  if (!candidateVersionId) return null

  const confirmation = asRecord(action.confirmation)
  const costEstimate = asRecord(confirmation?.cost_estimate)
  const summary =
    asString(candidatePayload.summary) ??
    asString(action.description) ??
    asString(action.title) ??
    'Agent provided a next workflow version candidate.'

  return {
    action_id: actionId,
    proposal_id: asString(candidatePayload.proposal_id) ?? actionId,
    title: asString(action.title),
    summary,
    candidate_version_id: candidateVersionId,
    base_revision:
      asNumber(candidatePayload.base_revision) ??
      asNumber(candidatePayload.workflow_revision),
    workflow_id:
      asString(candidatePayload.workflow_id) ??
      asString(executionRef?.workflow_id),
    risk_level:
      asString(candidatePayload.risk_level) ??
      asString(confirmation?.risk_level),
    estimated_cost_band:
      asString(candidatePayload.estimated_cost_band) ??
      asString(costEstimate?.band) ??
      asString(costEstimate?.cost_band),
    created_at: asString(action.created_at)
  }
}

function collectToolPlaneRecords(root: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = []
  const stack: unknown[] = [root]
  const seen = new Set<Record<string, unknown>>()
  const recordKeys = [
    'session',
    'tool_plane_v0',
    'tool_plane',
    'workflow_proposal_v1',
    'workflow_version_proposal_v1',
    'workflow_proposal',
    'next_workflow_version_v1',
    'workflow_switch_v1',
    'workflow_version_switch_v1',
    'switched_workflow_version_v1',
    'workflow_switch',
    'execution_loop_v1',
    'execution_loop_event_v1',
    'execution_loop_event',
    'execution_loop',
    'execution_event',
    'execution',
    'inspect',
    'result',
    'audit',
    'audit_record',
    'audit_v1'
  ]
  const arrayKeys = [
    'messages',
    'actions',
    'tool_events',
    'events',
    'execution_loop_events_v1',
    'execution_events',
    'timeline'
  ]

  while (stack.length > 0) {
    const record = asRecord(stack.pop())
    if (!record || seen.has(record)) continue
    seen.add(record)
    records.push(record)

    for (const key of recordKeys) {
      stack.push(record[key])
    }
    for (const key of arrayKeys) {
      for (const item of asArray(record[key])) {
        stack.push(item)
      }
    }
  }

  return records
}

function extractWorkflowProposalCandidate(
  record: Record<string, unknown>
): ToolPlaneWorkflowProposalCandidate | null {
  const status = asString(record.status)
  if (status && status !== 'proposed') return null

  const metadata = asRecord(record.metadata)
  const payload =
    asRecord(record.next_workflow_version_v1) ??
    asRecord(record.workflow_proposal_v1) ??
    asRecord(record.workflow_version_proposal_v1) ??
    asRecord(record.workflow_proposal) ??
    asRecord(metadata?.next_workflow_version_v1) ??
    asRecord(metadata?.workflow_proposal_v1) ??
    asRecord(metadata?.workflow_version_proposal_v1) ??
    asRecord(metadata?.workflow_proposal)

  const resolvedPayload =
    payload ??
    (asString(record.candidate_version_id) ? record : null) ??
    (asString(metadata?.candidate_version_id) ? metadata : null)
  if (!resolvedPayload) return null

  const candidateVersionId =
    asString(resolvedPayload.candidate_version_id) ??
    asString(resolvedPayload.version_id) ??
    asString(resolvedPayload.workflow_version_id)
  if (!candidateVersionId) return null

  const actionId =
    asString(resolvedPayload.action_id) ??
    asString(resolvedPayload.source_action_id) ??
    asString(record.action_id) ??
    asString(record.id) ??
    asString(resolvedPayload.proposal_id) ??
    asString(resolvedPayload.id) ??
    `tool-proposal-${candidateVersionId}`

  const summary =
    asString(resolvedPayload.summary) ??
    asString(resolvedPayload.description) ??
    asString(record.description) ??
    asString(record.title) ??
    'Agent provided a next workflow version candidate.'

  return {
    action_id: actionId,
    proposal_id: asString(resolvedPayload.proposal_id) ?? actionId,
    title: asString(resolvedPayload.title) ?? asString(record.title),
    summary,
    candidate_version_id: candidateVersionId,
    base_revision:
      asNumber(resolvedPayload.base_revision) ??
      asNumber(resolvedPayload.workflow_revision),
    workflow_id:
      asString(resolvedPayload.workflow_id) ??
      asString(resolvedPayload.workflow_path),
    risk_level: asString(resolvedPayload.risk_level),
    estimated_cost_band:
      asString(resolvedPayload.estimated_cost_band) ??
      asString(resolvedPayload.cost_band),
    created_at:
      asString(resolvedPayload.created_at) ??
      asString(record.created_at) ??
      asString(record.updated_at),
    requires_confirmation:
      asBoolean(resolvedPayload.requires_confirmation) ??
      asBoolean(asRecord(record.confirmation)?.requires_confirmation) ??
      true
  }
}

function extractWorkflowSwitchSignal(
  record: Record<string, unknown>
): ToolPlaneWorkflowSwitchSignal | null {
  const metadata = asRecord(record.metadata)
  const payload =
    asRecord(record.workflow_switch_v1) ??
    asRecord(record.workflow_version_switch_v1) ??
    asRecord(record.switched_workflow_version_v1) ??
    asRecord(record.workflow_switch) ??
    asRecord(metadata?.workflow_switch_v1) ??
    asRecord(metadata?.workflow_version_switch_v1) ??
    asRecord(metadata?.switched_workflow_version_v1) ??
    asRecord(metadata?.workflow_switch)

  const resolvedPayload = payload ?? (asString(record.switched_to_version_id) ? record : null)
  if (!resolvedPayload) return null

  const versionId =
    asString(resolvedPayload.version_id) ??
    asString(resolvedPayload.workflow_version_id) ??
    asString(resolvedPayload.switched_to_version_id) ??
    asString(resolvedPayload.current_version_id) ??
    asString(resolvedPayload.rolled_back_to_version_id)
  if (!versionId) return null

  const workflowId =
    asString(resolvedPayload.workflow_id) ??
    asString(resolvedPayload.workflow_path) ??
    asString(record.workflow_id)
  const reason =
    asString(resolvedPayload.reason) ??
    asString(resolvedPayload.switch_reason) ??
    asString(resolvedPayload.summary)
  const at =
    asString(resolvedPayload.recorded_at) ??
    asString(resolvedPayload.updated_at) ??
    asString(resolvedPayload.created_at)
  const key = [workflowId ?? '', versionId, reason ?? '', at ?? ''].join('|')

  return {
    workflow_id: workflowId,
    version_id: versionId,
    reason,
    at,
    key
  }
}

function toTimelineEvent(value: unknown): JobExecutionEventV1 | null {
  const record = asRecord(value)
  if (!record) return null
  const recordedAt = asString(record.recorded_at) ?? asString(record.at)
  const phase = asString(record.phase)
  const message = asString(record.message) ?? asString(record.event)
  if (!recordedAt || !phase || !message) return null

  return {
    recorded_at: recordedAt,
    phase,
    message,
    details: asRecord(record.details)
  }
}

function extractExecutionSignal(
  record: Record<string, unknown>
): ToolPlaneExecutionSignal | null {
  const metadata = asRecord(record.metadata)
  const executionRef = asRecord(record.execution_ref)
  const payload =
    asRecord(record.execution_loop_event_v1) ??
    asRecord(record.execution_loop_event) ??
    asRecord(record.execution_loop_v1) ??
    asRecord(record.execution_event) ??
    asRecord(record.execution_loop) ??
    asRecord(record.execution) ??
    asRecord(metadata?.execution_loop_event_v1) ??
    asRecord(metadata?.execution_loop_event) ??
    asRecord(metadata?.execution_loop_v1) ??
    asRecord(metadata?.execution_event) ??
    asRecord(metadata?.execution_loop) ??
    asRecord(metadata?.execution)

  const resolvedPayload = payload ?? record
  const jobId =
    asString(resolvedPayload.job_id) ??
    asString(resolvedPayload.execution_job_id) ??
    asString(executionRef?.job_id)
  if (!jobId) return null

  const status =
    normalizeJobStatus(asString(resolvedPayload.job_status)) ??
    normalizeJobStatus(asString(resolvedPayload.status))
  const at =
    asString(resolvedPayload.recorded_at) ??
    asString(resolvedPayload.updated_at) ??
    asString(resolvedPayload.created_at)
  const timelineEvents = asArray(resolvedPayload.timeline)
    .map((entry) => toTimelineEvent(entry))
    .filter((entry): entry is JobExecutionEventV1 => entry !== null)
  const inlineEvent = toTimelineEvent(resolvedPayload.timeline_event)
  if (inlineEvent) {
    timelineEvents.push(inlineEvent)
  } else {
    const fallbackInlineEvent = toTimelineEvent(resolvedPayload)
    if (fallbackInlineEvent) {
      timelineEvents.push(fallbackInlineEvent)
    }
  }

  const resultPayload = asRecord(resolvedPayload.result)
  const key = [jobId, status ?? '', at ?? '', String(timelineEvents.length)].join('|')

  return {
    job_id: jobId,
    status,
    timeline_events: timelineEvents,
    result: resultPayload,
    at,
    key
  }
}

function extractAuditPayload(record: Record<string, unknown>): Record<string, unknown> | null {
  const metadata = asRecord(record.metadata)
  return (
    asRecord(record.audit) ??
    asRecord(record.audit_v1) ??
    asRecord(record.audit_event) ??
    asRecord(record.audit_record) ??
    asRecord(record.audit_record_v1) ??
    asRecord(metadata?.audit) ??
    asRecord(metadata?.audit_v1) ??
    asRecord(metadata?.audit_event) ??
    asRecord(metadata?.audit_record) ??
    asRecord(metadata?.audit_record_v1)
  )
}

function resolveSessionMessages(
  session: AgentSessionRecord | null
): Record<string, unknown>[] {
  if (!Array.isArray(session?.messages)) return []
  return session.messages
    .map((message) => asRecord(message))
    .filter((message): message is Record<string, unknown> => message !== null)
}

function newEphemeralId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${random}`
}

function mapJobStatusToExecutionState(status: JobStatus): JobExecutionState {
  switch (status) {
    case 'queued':
      return 'queued'
    case 'running':
      return 'running'
    case 'succeeded':
      return 'succeeded'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'canceled'
    default:
      return 'error'
  }
}

const KNOWN_STANDARDIZED_ERROR_CODES = new Set<string>([
  'budget_blocked',
  'concurrency_blocked',
  'upgrade_required',
  'escalate_required',
  'inspect_not_ready',
  'agent_session_revision_conflict'
])

function normalizeKnownErrorCode(rawCode: string | null): string | null {
  if (!rawCode) return null
  const normalized = rawCode.toLowerCase().trim()
  for (const code of KNOWN_STANDARDIZED_ERROR_CODES) {
    if (normalized === code || normalized.includes(code)) {
      return code
    }
  }
  if (
    normalized.includes('insufficient_credits') ||
    normalized.includes('quota_exceeded')
  ) {
    return 'budget_blocked'
  }
  if (normalized.includes('concurrency')) {
    return 'concurrency_blocked'
  }
  return null
}

function isPolicyBlockedVerdict(
  verdict: SupportEntitlementVerdict | null | undefined
): verdict is PolicyBlockedVerdict {
  return (
    verdict === 'upgrade_required' ||
    verdict === 'budget_blocked' ||
    verdict === 'concurrency_blocked' ||
    verdict === 'escalate_required'
  )
}

function toPolicyBlockedReason(verdict: PolicyBlockedVerdict): string {
  switch (verdict) {
    case 'budget_blocked':
      return 'Budget gate blocked this action. Lower execution cost or raise budget.'
    case 'concurrency_blocked':
      return 'Concurrency gate blocked this action. Wait for running jobs or reduce parallel submissions.'
    case 'upgrade_required':
      return 'Plan entitlement gate blocked this action. Upgrade plan or remove high-tier feature gates.'
    case 'escalate_required':
      return 'Policy requires human escalation before proceeding.'
    default:
      return 'Policy gate blocked this action.'
  }
}

function buildStandardizedErrorExplanation(
  code: string
): StandardizedErrorExplanation | null {
  switch (code) {
    case 'budget_blocked':
      return {
        code,
        title: 'Budget Blocked',
        detail: 'Estimated cost exceeds current budget guardrail.',
        action_hint: 'Lower cost settings or raise budget, then retry.',
        policy_verdict: 'budget_blocked'
      }
    case 'concurrency_blocked':
      return {
        code,
        title: 'Concurrency Blocked',
        detail: 'Current concurrent jobs reached the plan limit.',
        action_hint: 'Wait for active jobs to finish or reduce parallel submissions.',
        policy_verdict: 'concurrency_blocked'
      }
    case 'upgrade_required':
      return {
        code,
        title: 'Upgrade Required',
        detail: 'Current plan does not include required capability gates.',
        action_hint: 'Upgrade plan or switch to a lower-tier capability path.',
        policy_verdict: 'upgrade_required'
      }
    case 'escalate_required':
      return {
        code,
        title: 'Escalation Required',
        detail: 'This action requires human support follow-up.',
        action_hint: 'Create escalation evidence and hand off to support.',
        policy_verdict: 'escalate_required'
      }
    case 'inspect_not_ready':
      return {
        code,
        title: 'Inspect Not Ready',
        detail: 'Execution inspection data is not ready yet.',
        action_hint: 'Refresh execution status and retry after timeline is available.',
        policy_verdict: null
      }
    case 'agent_session_revision_conflict':
      return {
        code,
        title: 'Session Revision Conflict',
        detail: 'Canvas revision changed since this session was bound.',
        action_hint: 'Refresh session context and retry.',
        policy_verdict: null
      }
    default:
      return null
  }
}

function isHighRiskLevel(level: string | null | undefined): boolean {
  return level === 'high' || level === 'critical'
}

export const useFluttyAgentWindowStore = defineStore('fluttyAgentWindow', () => {
  const { captureCanvasContextV1 } = useFluttyCanvasContextV1()

  const isOpen = ref(false)
  const isCollapsed = ref(false)
  const isPinned = ref(false)
  const position = ref({ ...DEFAULT_POSITION })
  const zIndex = ref(bumpFloatingWindowZIndex())

  const sessionId = ref<string | null>(null)
  const session = ref<AgentSessionRecord | null>(null)
  const sessionState = ref<SessionState>('idle')
  const sessionError = ref<string | null>(null)
  const sessionConflict = ref<AgentSessionRevisionConflict | null>(null)
  const sessionRevisionBinding = ref(
    toSessionRevisionBinding(captureCanvasContextV1())
  )

  const workflowVersionState = ref<WorkflowVersionState>('idle')
  const workflowVersionError = ref<string | null>(null)
  const workflowVersionConflict = ref<AgentSessionRevisionConflict | null>(null)
  const workflowId = ref<string | null>(captureCanvasContextV1().workflow.path)
  const currentWorkflowVersionId = ref<string | null>(null)
  const workflowVersions = ref<WorkflowVersionRecord[]>([])
  const latestChatWorkflow = ref<ChatWorkflowDraft | null>(null)
  const executionState = ref<JobExecutionState>('idle')
  const executionError = ref<string | null>(null)
  const executionEstimate = ref<JobEstimateResponseV1 | null>(null)
  const executionConfirmationAccepted = ref(false)
  const activeJobId = ref<string | null>(null)
  const activeJobStatus = ref<JobStatus | null>(null)
  const jobStatus = ref<JobStatusResponseV1 | null>(null)
  const jobResult = ref<JobResultResponseV1 | null>(null)
  const jobInspect = ref<JobInspectResponseV1 | null>(null)
  const diagnoseState = ref<DiagnoseState>('idle')
  const diagnosisError = ref<string | null>(null)
  const diagnosis = ref<AgentDebugDiagnosisEnvelopeV1 | null>(null)
  const reviewState = ref<ReviewState>('idle')
  const reviewError = ref<string | null>(null)
  const review = ref<MultimodalReviewResponseV1 | null>(null)
  const governanceWorkspaceId = ref(
    captureCanvasContextV1().workspace_id ?? DEFAULT_WORKSPACE_ID
  )
  const governancePrincipalId = ref(
    captureCanvasContextV1().principal_id ?? DEFAULT_PRINCIPAL_ID
  )
  const policyGateState = ref<PolicyGateState>('idle')
  const policyGateError = ref<string | null>(null)
  const policyGate = ref<PolicyGateSummary | null>(null)
  const standardizedError = ref<StandardizedErrorExplanation | null>(null)
  const memoryState = ref<MemoryState>('idle')
  const memoryError = ref<string | null>(null)
  const memoryOptOut = ref<CaseMemoryOptOutStateV1 | null>(null)
  const memoryOptOutDraft = ref<CaseMemoryOptOutFlagsV1>({
    learning_opt_out: false,
    retrieval_opt_out: false,
    platform_pattern_opt_out: false
  })
  const memoryQuery = ref<CaseMemoryQueryResponseV1 | null>(null)
  const memoryDeleteStatus = ref<CaseMemoryDeleteStatusV1 | null>(null)
  const actionConfirmationReason = ref('')
  const actionAuditTrail = ref<ActionAuditRecord[]>([])
  const seenAuditRecordIds = new Set<string>()
  const seenWorkflowSwitchSignals = new Set<string>()
  const seenExecutionSignals = new Set<string>()

  const nextWorkflowVersionProposal = computed<NextWorkflowVersionProposal | null>(
    () => {
      const actions = resolveSessionActions(session.value)
      for (const action of actions) {
        const proposal = toNextWorkflowVersionProposal(action)
        if (proposal) return proposal
      }
      return null
    }
  )

  const policyGateVerdict = computed<SupportEntitlementVerdict | null>(
    () => policyGate.value?.verdict ?? standardizedError.value?.policy_verdict ?? null
  )

  const policyGateBlocked = computed(() =>
    isPolicyBlockedVerdict(policyGateVerdict.value)
  )

  const highRiskGateReasonRequired = computed(
    () => policyGateVerdict.value === 'allow_with_notice'
  )

  const highRiskVersionReasonRequired = computed(() =>
    isHighRiskLevel(nextWorkflowVersionProposal.value?.risk_level ?? null)
  )

  const highRiskRevertReasonRequired = computed(() => {
    if (isHighRiskLevel(diagnosis.value?.risk.level)) return true
    return (
      review.value?.recommended_actions.some(
        (action) =>
          action.requires_confirmation ||
          isHighRiskLevel(action.risk_level)
      ) ?? false
    )
  })

  const canSubmitEstimatedJob = computed(
    () =>
      executionState.value === 'estimate-ready' &&
      executionConfirmationAccepted.value &&
      !!workflowId.value &&
      !policyGateBlocked.value
  )

  const canDiagnoseExecution = computed(
    () =>
      activeJobStatus.value === 'failed' || activeJobStatus.value === 'canceled'
  )

  const suggestedRevertVersionId = computed<string | null>(() => {
    const diagnosisVersionId = asString(
      asRecord(diagnosis.value?.patch_handoff)?.target_workflow_version_id
    )
    if (diagnosisVersionId) return diagnosisVersionId

    const reviewSuggestsRevert =
      review.value?.recommended_actions.some(
        (action) => action.action_kind === 'revert'
      ) ??
      false

    if (!reviewSuggestsRevert) return null

    return (
      workflowVersions.value.find(
        (version) => version.version_id !== currentWorkflowVersionId.value
      )?.version_id ?? null
    )
  })

  const eventLog = ref<FluttyAgentShellEvent[]>([])
  const eventSubscribers = new Set<(event: FluttyAgentShellEvent) => void>()

  function emitShellEvent(
    type: FluttyAgentShellEventType,
    payload?: Record<string, unknown>
  ) {
    const event: FluttyAgentShellEvent = {
      type,
      at: new Date().toISOString(),
      payload
    }
    eventLog.value.unshift(event)
    if (eventLog.value.length > 20) {
      eventLog.value.length = 20
    }
    eventSubscribers.forEach((subscriber) => subscriber(event))
  }

  function onShellEvent(subscriber: (event: FluttyAgentShellEvent) => void) {
    eventSubscribers.add(subscriber)
    return () => eventSubscribers.delete(subscriber)
  }

  function upsertSessionActionEntry(updatedAction: Record<string, unknown>) {
    const updatedActionId = asString(updatedAction.action_id)
    if (!updatedActionId || !session.value) return

    const nextActions = Array.isArray(session.value.actions)
      ? [...session.value.actions]
      : []
    const existingIndex = nextActions.findIndex(
      (entry) => asString(asRecord(entry)?.action_id) === updatedActionId
    )

    if (existingIndex >= 0) {
      nextActions[existingIndex] = {
        ...(asRecord(nextActions[existingIndex]) ?? {}),
        ...updatedAction
      }
    } else {
      nextActions.unshift(updatedAction)
    }

    session.value = {
      ...session.value,
      actions: nextActions
    }
  }

  function mergeTimelineEvents(
    current: JobExecutionEventV1[],
    incoming: JobExecutionEventV1[]
  ): JobExecutionEventV1[] {
    const merged: JobExecutionEventV1[] = []
    const seenKeys = new Set<string>()
    for (const event of [...current, ...incoming]) {
      const key = `${event.recorded_at}|${event.phase}|${event.message}`
      if (seenKeys.has(key)) continue
      seenKeys.add(key)
      merged.push(event)
    }
    return merged
  }

  function applyToolPlaneWorkflowProposal(
    candidate: ToolPlaneWorkflowProposalCandidate
  ) {
    if (!session.value) return
    const existingAction = resolveSessionActions(session.value).find(
      (action) => asString(action.action_id) === candidate.action_id
    )
    const existingStatus = asString(existingAction?.status)
    if (existingStatus && existingStatus !== 'proposed') {
      return
    }

    if (candidate.workflow_id) {
      workflowId.value = candidate.workflow_id
    }

    upsertSessionActionEntry({
      action_id: candidate.action_id,
      action_type: 'workflow_patch',
      title: candidate.title ?? 'Apply next workflow version',
      description: candidate.summary,
      status: 'proposed',
      confirmation: {
        requires_confirmation: candidate.requires_confirmation,
        risk_level: candidate.risk_level ?? 'medium'
      },
      execution_ref: {
        workflow_id: candidate.workflow_id,
        workflow_version_id: candidate.candidate_version_id
      },
      metadata: {
        next_workflow_version_v1: {
          proposal_id: candidate.proposal_id,
          workflow_id: candidate.workflow_id,
          base_revision: candidate.base_revision,
          candidate_version_id: candidate.candidate_version_id,
          summary: candidate.summary,
          risk_level: candidate.risk_level,
          estimated_cost_band: candidate.estimated_cost_band,
          created_at: candidate.created_at
        }
      }
    })
  }

  function applyToolPlaneWorkflowSwitch(signal: ToolPlaneWorkflowSwitchSignal) {
    if (seenWorkflowSwitchSignals.has(signal.key)) return
    seenWorkflowSwitchSignals.add(signal.key)

    if (signal.workflow_id) {
      workflowId.value = signal.workflow_id
    }
    markCurrentWorkflowVersion(signal.version_id)
    emitShellEvent('workflow-version-switched', {
      workflow_id: signal.workflow_id ?? workflowId.value,
      version_id: signal.version_id,
      reason: signal.reason,
      source: 'tool-plane',
      recorded_at: signal.at
    })
  }

  function applyToolPlaneExecutionSignal(signal: ToolPlaneExecutionSignal) {
    if (seenExecutionSignals.has(signal.key)) return
    const hasExecutionDetail =
      signal.status !== null ||
      signal.timeline_events.length > 0 ||
      signal.result !== null
    if (!hasExecutionDetail) return
    seenExecutionSignals.add(signal.key)

    const now = signal.at ?? new Date().toISOString()
    activeJobId.value = signal.job_id

    if (signal.status) {
      activeJobStatus.value = signal.status
      executionState.value = mapJobStatusToExecutionState(signal.status)
      jobStatus.value = {
        job_id: signal.job_id,
        status: signal.status,
        created_at: jobStatus.value?.created_at ?? now,
        updated_at: now,
        error: jobStatus.value?.error ?? null
      }
      emitShellEvent('job-status-observed', {
        job_id: signal.job_id,
        status: signal.status,
        source: 'tool-plane'
      })
    }

    if (signal.timeline_events.length > 0) {
      const existingTimeline = jobInspect.value?.timeline ?? []
      const mergedTimeline = mergeTimelineEvents(
        existingTimeline,
        signal.timeline_events
      )
      jobInspect.value = {
        job_id: signal.job_id,
        status:
          signal.status ??
          jobInspect.value?.status ??
          activeJobStatus.value ??
          'queued',
        created_at: jobInspect.value?.created_at ?? now,
        updated_at: now,
        mode: jobInspect.value?.mode ?? 'comfy_workflow',
        workflow_id: jobInspect.value?.workflow_id ?? workflowId.value ?? null,
        flow_uri: jobInspect.value?.flow_uri ?? null,
        output_node_ids: jobInspect.value?.output_node_ids ?? [],
        request_summary: jobInspect.value?.request_summary ?? {},
        runtime_route: jobInspect.value?.runtime_route ?? {},
        compile_report: jobInspect.value?.compile_report ?? null,
        current_phase: jobInspect.value?.current_phase ?? null,
        timeline: mergedTimeline,
        error: jobInspect.value?.error ?? null
      }
      emitShellEvent('job-inspect-observed', {
        job_id: signal.job_id,
        timeline_size: mergedTimeline.length,
        source: 'tool-plane'
      })
    }

    if (signal.result) {
      jobResult.value = {
        job_id: signal.job_id,
        status: signal.status ?? activeJobStatus.value ?? 'running',
        created_at: jobResult.value?.created_at ?? now,
        updated_at: now,
        result: signal.result,
        error: jobResult.value?.error ?? null
      }
      emitShellEvent('job-result-observed', {
        job_id: signal.job_id,
        status: jobResult.value.status,
        source: 'tool-plane'
      })
    }
  }

  function importAuditRecordFromEntry(
    entry: Record<string, unknown>,
    sourceKind: 'message' | 'action' | 'tool-plane'
  ) {
    const directAuditId =
      asString(entry.audit_id) ?? asString(entry.audit_event_id)
    const auditPayload = extractAuditPayload(entry) ?? (directAuditId ? entry : null)
    if (!auditPayload && !directAuditId) return
    const entryId =
      asString(entry.action_id) ??
      asString(entry.message_id) ??
      asString(entry.id) ??
      newEphemeralId('audit-source')
    const auditId =
      asString(auditPayload?.audit_id) ??
      asString(auditPayload?.audit_event_id) ??
      directAuditId ??
      `${sourceKind}:${entryId}`
    if (seenAuditRecordIds.has(auditId)) return

    const confirmation = asRecord(entry.confirmation)
    const action =
      asString(auditPayload?.action) ??
      asString(auditPayload?.event) ??
      asString(entry.action_type) ??
      (sourceKind === 'message'
        ? `message:${asString(entry.role) ?? 'unknown'}`
        : sourceKind)
    const reason =
      asString(auditPayload?.reason) ??
      asString(auditPayload?.decision_reason) ??
      asString(auditPayload?.summary) ??
      action
    const traceRef =
      asString(auditPayload?.trace_ref) ??
      asString(auditPayload?.trace_id) ??
      asString(auditPayload?.job_id) ??
      asString(auditPayload?.action_id) ??
      asString(asRecord(entry.execution_ref)?.job_id)

    appendAuditRecord({
      audit_id: auditId,
      action,
      reason,
      risk_level:
        asString(auditPayload?.risk_level) ??
        asString(confirmation?.risk_level),
      requires_confirmation:
        asBoolean(auditPayload?.requires_confirmation) ??
        asBoolean(confirmation?.requires_confirmation) ??
        false,
      trace_ref: traceRef,
      at:
        asString(auditPayload?.recorded_at) ??
        asString(auditPayload?.at) ??
        asString(entry.updated_at) ??
        asString(entry.created_at) ??
        new Date().toISOString(),
      metadata: {
        source_kind: sourceKind,
        source_entry_id: entryId,
        audit_payload: auditPayload
      }
    })
  }

  function syncAuditTrailFromSessionEntries() {
    for (const action of resolveSessionActions(session.value)) {
      importAuditRecordFromEntry(action, 'action')
    }
    for (const message of resolveSessionMessages(session.value)) {
      importAuditRecordFromEntry(message, 'message')
    }
  }

  function reconcileToolPlaneSignals(payload: unknown) {
    const records = collectToolPlaneRecords(payload)
    for (const record of records) {
      const candidate = extractWorkflowProposalCandidate(record)
      if (candidate) {
        applyToolPlaneWorkflowProposal(candidate)
      }

      const workflowSwitch = extractWorkflowSwitchSignal(record)
      if (workflowSwitch) {
        applyToolPlaneWorkflowSwitch(workflowSwitch)
      }

      const executionSignal = extractExecutionSignal(record)
      if (executionSignal) {
        applyToolPlaneExecutionSignal(executionSignal)
      }

      importAuditRecordFromEntry(record, 'tool-plane')
    }
    syncAuditTrailFromSessionEntries()
  }

  function clearSessionConflict() {
    sessionConflict.value = null
  }

  function clearLatestChatWorkflow() {
    latestChatWorkflow.value = null
  }

  function clearWorkflowVersionConflict() {
    workflowVersionConflict.value = null
  }

  function clearExecutionError() {
    executionError.value = null
    clearStandardizedError()
  }

  function clearDiagnosisState() {
    diagnoseState.value = 'idle'
    diagnosisError.value = null
    diagnosis.value = null
  }

  function clearReviewState() {
    reviewState.value = 'idle'
    reviewError.value = null
    review.value = null
  }

  function bindSessionRevision() {
    sessionRevisionBinding.value = toSessionRevisionBinding(captureCanvasContextV1())
  }

  function syncWorkflowIdFromContext() {
    const contextWorkflowId = captureCanvasContextV1().workflow.path
    if (contextWorkflowId) {
      workflowId.value = contextWorkflowId
      return
    }

    const proposalWorkflowId = nextWorkflowVersionProposal.value?.workflow_id
    if (proposalWorkflowId) {
      workflowId.value = proposalWorkflowId
    }
  }

  function assertSessionRevisionUpToDate() {
    // Session and workflow are decoupled: always refresh request context
    // from the current canvas rather than blocking on revision mismatch.
    bindSessionRevision()
    syncWorkflowIdFromContext()
  }

  function buildRequestContext() {
    return {
      canvas_context_v1: captureCanvasContextV1(),
      session_revision_v1: sessionRevisionBinding.value
    }
  }

  function syncGovernanceIdentityFromContext() {
    const context = captureCanvasContextV1()
    governanceWorkspaceId.value = context.workspace_id ?? DEFAULT_WORKSPACE_ID
    governancePrincipalId.value = context.principal_id ?? DEFAULT_PRINCIPAL_ID
  }

  function clearPolicyGateError() {
    policyGateError.value = null
  }

  function clearMemoryError() {
    memoryError.value = null
  }

  function clearStandardizedError() {
    standardizedError.value = null
  }

  function setPolicyGateFromExplainLimit(
    response: SupportExplainLimitResponseV1
  ) {
    policyGate.value = {
      verdict: response.entitlement_verdict,
      reason_code: response.limit_reason.reason_code,
      reason_title: response.limit_reason.title,
      reason_detail: response.limit_reason.detail,
      unblock_options: [...response.unblock_options],
      resolved_plan_id: response.resolved_plan_id,
      resolved_pricing_path: response.resolved_pricing_path,
      path_specific_cost_explain:
        response.path_specific_cost_explain ??
        response.limit_reason.path_specific_cost_explain ??
        null,
      source: 'support_explain_limit',
      updated_at: new Date().toISOString()
    }
  }

  function setPolicyGateFromStandardizedError(
    explanation: StandardizedErrorExplanation
  ) {
    if (!explanation.policy_verdict) return
    policyGate.value = {
      verdict: explanation.policy_verdict,
      reason_code: explanation.code,
      reason_title: explanation.title,
      reason_detail: explanation.detail,
      unblock_options: [explanation.action_hint],
      resolved_plan_id: null,
      resolved_pricing_path: null,
      path_specific_cost_explain: null,
      source: 'standardized_error',
      updated_at: new Date().toISOString()
    }
    policyGateState.value = 'ready'
    policyGateError.value = null
  }

  function resolveApiErrorCode(error: unknown): string | null {
    if (error instanceof AgentSessionApiError) {
      const payload = asRecord(error.payload)
      const code = normalizeKnownErrorCode(
        asString(payload?.code) ?? asString(payload?.error_code)
      )
      if (code) return code
      const detailCode = normalizeKnownErrorCode(asString(payload?.detail))
      if (detailCode) return detailCode
      return normalizeKnownErrorCode(error.message)
    }
    if (error instanceof Error) {
      return normalizeKnownErrorCode(error.message)
    }
    return null
  }

  function resolveStandardizedErrorMessage(
    error: unknown,
    fallbackMessage: string
  ): string {
    const errorCode = resolveApiErrorCode(error)
    if (!errorCode) {
      clearStandardizedError()
      return error instanceof Error ? error.message : fallbackMessage
    }

    const explanation = buildStandardizedErrorExplanation(errorCode)
    if (!explanation) {
      clearStandardizedError()
      return error instanceof Error ? error.message : fallbackMessage
    }

    standardizedError.value = explanation
    setPolicyGateFromStandardizedError(explanation)
    return `${explanation.title}: ${explanation.detail} ${explanation.action_hint}`
  }

  function resolveActionReason(
    action: string,
    options: {
      required: boolean
      fallbackReason: string
    }
  ): string {
    const { required, fallbackReason } = options
    const reason = actionConfirmationReason.value.trim()
    if (required && !reason) {
      throw new Error(
        `Confirmation reason is required for high-risk action: ${action}.`
      )
    }
    actionConfirmationReason.value = ''
    return reason || fallbackReason
  }

  function appendAuditRecord(record: ActionAuditRecord) {
    if (seenAuditRecordIds.has(record.audit_id)) return
    seenAuditRecordIds.add(record.audit_id)
    actionAuditTrail.value.unshift(record)
    if (actionAuditTrail.value.length > 20) {
      actionAuditTrail.value.length = 20
    }
    emitShellEvent('audit-recorded', {
      audit_id: record.audit_id,
      action: record.action,
      risk_level: record.risk_level,
      requires_confirmation: record.requires_confirmation,
      trace_ref: record.trace_ref
    })
  }

  function recordActionAudit(
    action: string,
    {
      reason,
      riskLevel = null,
      requiresConfirmation = false,
      traceRef = null,
      metadata
    }: {
      reason: string
      riskLevel?: string | null
      requiresConfirmation?: boolean
      traceRef?: string | null
      metadata?: Record<string, unknown>
    }
  ) {
    appendAuditRecord({
      audit_id: newEphemeralId('audit'),
      action,
      reason,
      risk_level: riskLevel,
      requires_confirmation: requiresConfirmation,
      trace_ref: traceRef,
      at: new Date().toISOString(),
      metadata
    })
  }

  function applyMemoryOptOutState(nextState: CaseMemoryOptOutStateV1) {
    memoryOptOut.value = nextState
    memoryOptOutDraft.value = {
      ...nextState.flags
    }
  }

  function handleSessionError(
    stage: string,
    error: unknown,
    fallbackMessage: string
  ) {
    sessionState.value = 'error'

    if (isAgentSessionRevisionConflictError(error)) {
      sessionConflict.value = error.conflict
      sessionError.value = `${error.conflict.message} ${error.conflict.retry_hint}`
      emitShellEvent('session-error', {
        stage,
        code: error.conflict.code,
        recoverable: true
      })
      return
    }

    clearSessionConflict()
    sessionError.value = resolveStandardizedErrorMessage(error, fallbackMessage)
    emitShellEvent('session-error', { stage })
  }

  function handleWorkflowVersionError(
    stage: string,
    error: unknown,
    fallbackMessage: string
  ) {
    workflowVersionState.value = 'error'

    if (isAgentSessionRevisionConflictError(error)) {
      workflowVersionConflict.value = error.conflict
      workflowVersionError.value = `${error.conflict.message} ${error.conflict.retry_hint}`
      emitShellEvent('session-error', {
        stage,
        scope: 'workflow-version',
        code: error.conflict.code,
        recoverable: true
      })
      return
    }

    clearWorkflowVersionConflict()
    workflowVersionError.value = resolveStandardizedErrorMessage(
      error,
      fallbackMessage
    )
    emitShellEvent('session-error', {
      stage,
      scope: 'workflow-version'
    })
  }

  function handleExecutionError(
    stage: string,
    error: unknown,
    fallbackMessage: string
  ) {
    executionState.value = 'error'
    executionError.value = resolveStandardizedErrorMessage(error, fallbackMessage)
    emitShellEvent('session-error', {
      stage,
      scope: 'job-execution'
    })
  }

  function handleDiagnoseError(error: unknown, fallbackMessage: string) {
    diagnoseState.value = 'error'
    diagnosisError.value = resolveStandardizedErrorMessage(error, fallbackMessage)
    emitShellEvent('session-error', {
      stage: 'job_diagnose',
      scope: 'job-execution'
    })
  }

  function handleReviewError(error: unknown, fallbackMessage: string) {
    reviewState.value = 'error'
    reviewError.value = resolveStandardizedErrorMessage(error, fallbackMessage)
    emitShellEvent('session-error', {
      stage: 'job_review',
      scope: 'job-execution'
    })
  }

  function markCurrentWorkflowVersion(versionId: string | null) {
    currentWorkflowVersionId.value = versionId
    workflowVersions.value = workflowVersions.value.map((version) => ({
      ...version,
      is_current: versionId ? version.version_id === versionId : false
    }))
  }

  function applyWorkflowVersionState(response: WorkflowVersionListResponse) {
    workflowId.value = response.workflow_id
    workflowVersions.value = [...response.versions]
    markCurrentWorkflowVersion(response.current_version_id)
  }

  function applyActionTransition(transition: AgentActionTransitionRecord) {
    const updatedAction = asRecord(transition.action)
    if (!updatedAction) return
    upsertSessionActionEntry(updatedAction)
    reconcileToolPlaneSignals(updatedAction)
  }

  function bringToFront() {
    if (isPinned.value) {
      zIndex.value = PINNED_Z_INDEX
      return
    }

    zIndex.value = bumpFloatingWindowZIndex()
    emitShellEvent('window-focused', { z_index: zIndex.value })
  }

  function setPosition(nextX: number, nextY: number) {
    position.value = { x: nextX, y: nextY }
  }

  function closeWindow() {
    isOpen.value = false
    emitShellEvent('window-closed')
  }

  async function openWindow() {
    isOpen.value = true
    bringToFront()
    syncWorkflowIdFromContext()
    emitShellEvent('window-opened')
    try {
      await refreshMemoryOptOutState()
    } catch {
      // keep shell usable even when memory governance endpoints are unavailable
    }
  }

  async function toggleWindow() {
    if (isOpen.value) {
      closeWindow()
      return
    }

    await openWindow()
  }

  function toggleCollapsed() {
    isCollapsed.value = !isCollapsed.value
  }

  function togglePinned() {
    isPinned.value = !isPinned.value
    if (isPinned.value) {
      zIndex.value = PINNED_Z_INDEX
      return
    }

    bringToFront()
  }

  function setWorkflowVersionTarget(nextWorkflowId: string | null) {
    workflowId.value = nextWorkflowId
  }

  async function createSession() {
    sessionState.value = 'creating'
    sessionError.value = null
    clearSessionConflict()
    syncGovernanceIdentityFromContext()
    resetExecutionLoop()

    try {
      const requestContext = buildRequestContext()
      const created = await createAgentSession(
        {
          workspace_id: DEFAULT_WORKSPACE_ID
        },
        requestContext
      )
      sessionId.value = created.session_id
      session.value = created
      reconcileToolPlaneSignals(created)
      sessionState.value = 'ready'
      clearLatestChatWorkflow()
      bindSessionRevision()
      syncWorkflowIdFromContext()
      syncGovernanceIdentityFromContext()
      emitShellEvent('session-created', { session_id: created.session_id })
      return created
    } catch (error) {
      handleSessionError('create', error, 'Failed to create session.')
      throw error
    }
  }

  async function fetchSession(targetSessionId = sessionId.value) {
    if (!targetSessionId) {
      throw new Error('Session id is required for getSession.')
    }

    sessionState.value = 'loading'
    sessionError.value = null
    clearSessionConflict()
    syncGovernanceIdentityFromContext()

    try {
      const fetched = await getAgentSession(targetSessionId, buildRequestContext())
      sessionId.value = fetched.session_id
      session.value = fetched
      reconcileToolPlaneSignals(fetched)
      sessionState.value = 'ready'
      bindSessionRevision()
      syncWorkflowIdFromContext()
      syncGovernanceIdentityFromContext()
      emitShellEvent('session-fetched', { session_id: fetched.session_id })
      return fetched
    } catch (error) {
      handleSessionError('fetch', error, 'Failed to fetch session.')
      throw error
    }
  }

  async function ensureSessionReady() {
    if (!sessionId.value) {
      await createSession()
    }

    return fetchSession(sessionId.value)
  }

  async function createAndLoadSession() {
    const created = await createSession()
    return fetchSession(created.session_id)
  }

  async function appendMessage(
    request: AgentMessageAppendRequest,
    allowSessionRecovery = true
  ) {
    let currentSessionId = sessionId.value
    if (!currentSessionId) {
      const created = await createSession()
      currentSessionId = created.session_id
    }

    sessionState.value = 'loading'
    sessionError.value = null
    clearSessionConflict()

    try {
      assertSessionRevisionUpToDate()

      const requestContext = buildRequestContext()
      const appended = await appendAgentSessionMessage(
        currentSessionId,
        {
          ...request,
          metadata: {
            ...(request.metadata ?? {}),
            canvas_context_v1: requestContext.canvas_context_v1,
            session_revision_v1: requestContext.session_revision_v1
          }
        },
        requestContext
      )

      session.value = appended
      reconcileToolPlaneSignals(appended)
      sessionState.value = 'ready'
      clearLatestChatWorkflow()
      bindSessionRevision()
      syncWorkflowIdFromContext()
      emitShellEvent('session-message-appended', { session_id: currentSessionId })
      return appended
    } catch (error) {
      if (
        allowSessionRecovery &&
        error instanceof AgentSessionApiError &&
        error.status === 404 &&
        isAgentSessionNotFoundError(error)
      ) {
        await createSession()
        return appendMessage(request, false)
      }
      handleSessionError('append_message', error, 'Failed to append message.')
      throw error
    }
  }

  async function appendUserMessage(
    text: string,
    options?: {
      workflow?: Record<string, unknown> | null
      model?: string | null
      temperature?: number
    },
    allowSessionRecovery = true
  ) {
    let currentSessionId = sessionId.value
    if (!currentSessionId) {
      const created = await createSession()
      currentSessionId = created.session_id
    }

    sessionState.value = 'loading'
    sessionError.value = null
    clearSessionConflict()

    try {
      assertSessionRevisionUpToDate()
      syncWorkflowIdFromContext()
      const requestContext = buildRequestContext()
      const chatResponse: AgentCanvasChatResponseV1 = await chatAgentSession(
        currentSessionId,
        {
          user_message: text,
          workflow_id: workflowId.value ?? undefined,
          workflow: options?.workflow ?? undefined,
          model: options?.model ?? undefined,
          temperature: options?.temperature
        },
        requestContext
      )
      session.value = chatResponse.session
      reconcileToolPlaneSignals(chatResponse)
      sessionState.value = 'ready'
      if (
        chatResponse.workflow &&
        typeof chatResponse.workflow === 'object' &&
        !Array.isArray(chatResponse.workflow)
      ) {
        latestChatWorkflow.value = {
          workflow: chatResponse.workflow,
          provider: chatResponse.provider,
          model: chatResponse.model,
          degraded: chatResponse.degraded,
          received_at: new Date().toISOString()
        }
      } else {
        clearLatestChatWorkflow()
      }
      bindSessionRevision()
      syncWorkflowIdFromContext()
      emitShellEvent('session-message-appended', {
        session_id: currentSessionId,
        provider: chatResponse.provider,
        model: chatResponse.model,
        degraded: chatResponse.degraded
      })
      return chatResponse.session
    } catch (error) {
      if (error instanceof AgentSessionApiError && error.status === 404) {
        if (allowSessionRecovery && isAgentSessionNotFoundError(error)) {
          await createSession()
          return appendUserMessage(text, options, false)
        }
        return appendMessage({
          role: 'user',
          text
        })
      }
      handleSessionError('append_message', error, 'Failed to append message.')
      throw error
    }
  }

  function resetExecutionLoop() {
    seenWorkflowSwitchSignals.clear()
    seenExecutionSignals.clear()
    executionState.value = 'idle'
    executionError.value = null
    executionEstimate.value = null
    executionConfirmationAccepted.value = false
    activeJobId.value = null
    activeJobStatus.value = null
    jobStatus.value = null
    jobResult.value = null
    jobInspect.value = null
    policyGateState.value = 'idle'
    policyGateError.value = null
    policyGate.value = null
    clearStandardizedError()
    clearDiagnosisState()
    clearReviewState()
  }

  function setExecutionConfirmationAccepted(accepted: boolean) {
    executionConfirmationAccepted.value = accepted
  }

  function setActionConfirmationReason(reason: string) {
    actionConfirmationReason.value = reason
  }

  function setMemoryOptOutFlag(
    key: keyof CaseMemoryOptOutFlagsV1,
    enabled: boolean
  ) {
    memoryOptOutDraft.value = {
      ...memoryOptOutDraft.value,
      [key]: enabled
    }
  }

  function buildPolicyRuntimeUsage() {
    const estimatedPrice =
      executionEstimate.value?.estimate.estimated_price ?? undefined
    const currentConcurrency =
      activeJobStatus.value === 'running' || activeJobStatus.value === 'queued'
        ? 1
        : 0
    const queueDepth = activeJobStatus.value === 'queued' ? 1 : 0

    return {
      max_budget: estimatedPrice,
      estimated_price: estimatedPrice,
      current_concurrency: currentConcurrency,
      queue_depth: queueDepth
    }
  }

  function resolvePricingPathForPolicy(): 'auto' | 'hosted' | 'byok' {
    const pricingPath = executionEstimate.value?.pricing.pricing_path
    if (pricingPath === 'hosted' || pricingPath === 'byok') return pricingPath
    return 'auto'
  }

  async function refreshPolicyGate(resourceType = 'execution') {
    const currentSessionId = sessionId.value
    if (!currentSessionId) {
      throw new Error('Session id is required before policy gate refresh.')
    }

    syncGovernanceIdentityFromContext()
    policyGateState.value = 'loading'
    clearPolicyGateError()

    try {
      const response = await explainAgentSupportLimit(
        {
          session_id: currentSessionId,
          resource_type: resourceType,
          requested_action: 'submit comfy workflow execution',
          current_usage: buildPolicyRuntimeUsage(),
          plan_id_hint: executionEstimate.value?.pricing.plan_id ?? undefined,
          pricing_path: resolvePricingPathForPolicy()
        },
        buildRequestContext()
      )
      setPolicyGateFromExplainLimit(response)
      policyGateState.value = 'ready'
      emitShellEvent('policy-gate-refreshed', {
        session_id: currentSessionId,
        verdict: response.entitlement_verdict,
        reason_code: response.limit_reason.reason_code
      })
      return response
    } catch (error) {
      policyGateState.value = 'error'
      policyGateError.value = resolveStandardizedErrorMessage(
        error,
        'Failed to refresh policy gate.'
      )
      emitShellEvent('session-error', {
        stage: 'policy_gate_refresh',
        scope: 'policy-gate'
      })
      throw error
    }
  }

  async function refreshMemoryOptOutState() {
    syncGovernanceIdentityFromContext()
    memoryState.value = 'loading'
    clearMemoryError()

    try {
      const response = await getAgentMemoryOptOut(
        governanceWorkspaceId.value,
        governancePrincipalId.value,
        buildRequestContext()
      )
      applyMemoryOptOutState(response)
      memoryState.value = 'ready'
      emitShellEvent('memory-opt-out-updated', {
        workspace_id: response.workspace_id,
        principal_id: response.principal_id,
        effective_at: response.effective_at
      })
      return response
    } catch (error) {
      memoryState.value = 'error'
      memoryError.value = resolveStandardizedErrorMessage(
        error,
        'Failed to load memory opt-out state.'
      )
      emitShellEvent('session-error', {
        stage: 'memory_opt_out_get',
        scope: 'memory-governance'
      })
      throw error
    }
  }

  async function updateMemoryOptOutState(reason?: string) {
    syncGovernanceIdentityFromContext()
    memoryState.value = 'loading'
    clearMemoryError()

    try {
      const response = await updateAgentMemoryOptOut(
        {
          workspace_id: governanceWorkspaceId.value,
          principal_id: governancePrincipalId.value,
          learning_opt_out: memoryOptOutDraft.value.learning_opt_out,
          retrieval_opt_out: memoryOptOutDraft.value.retrieval_opt_out,
          platform_pattern_opt_out:
            memoryOptOutDraft.value.platform_pattern_opt_out
        },
        buildRequestContext()
      )
      applyMemoryOptOutState(response)
      memoryState.value = 'ready'
      const auditReason = reason?.trim() || 'memory_opt_out_update'
      recordActionAudit('memory_opt_out_update', {
        reason: auditReason,
        riskLevel: 'low',
        requiresConfirmation: false,
        traceRef: response.effective_at ?? null,
        metadata: {
          flags: response.flags
        }
      })
      emitShellEvent('memory-opt-out-updated', {
        workspace_id: response.workspace_id,
        principal_id: response.principal_id,
        effective_at: response.effective_at
      })
      return response
    } catch (error) {
      memoryState.value = 'error'
      memoryError.value = resolveStandardizedErrorMessage(
        error,
        'Failed to update memory opt-out state.'
      )
      emitShellEvent('session-error', {
        stage: 'memory_opt_out_put',
        scope: 'memory-governance'
      })
      throw error
    }
  }

  function resolveMemoryIntentTags(): string[] {
    const messages = resolveSessionMessages(session.value)
    const latestUserMessage = [...messages]
      .reverse()
      .find((message) => asString(message.role) === 'user')
    const text =
      asString(latestUserMessage?.text) ??
      asString(latestUserMessage?.message) ??
      ''
    const token = text
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)[0]
    return token ? [token] : ['canvas_execution']
  }

  async function queryMemoryForCurrentSession() {
    const currentSessionId = sessionId.value
    if (!currentSessionId) {
      throw new Error('Session id is required before memory query.')
    }

    syncGovernanceIdentityFromContext()
    memoryState.value = 'loading'
    clearMemoryError()

    try {
      const response = await queryAgentMemory(
        {
          workspace_id: governanceWorkspaceId.value,
          principal_id: governancePrincipalId.value,
          session_id: currentSessionId,
          intent_tags: resolveMemoryIntentTags()
        },
        buildRequestContext()
      )
      memoryQuery.value = response
      memoryState.value = 'ready'
      emitShellEvent('memory-query-completed', {
        query_id: response.query_id,
        candidate_count: response.candidates.length,
        retrieval_bypassed: response.policy_applied.retrieval_bypassed
      })
      recordActionAudit('memory_query', {
        reason: 'memory_query',
        riskLevel: 'low',
        traceRef: response.query_id
      })
      return response
    } catch (error) {
      memoryState.value = 'error'
      memoryError.value = resolveStandardizedErrorMessage(
        error,
        'Failed to query memory candidates.'
      )
      emitShellEvent('session-error', {
        stage: 'memory_query',
        scope: 'memory-governance'
      })
      throw error
    }
  }

  async function refreshMemoryDeleteStatus(
    targetDeleteJobId = memoryDeleteStatus.value?.delete_job_id
  ) {
    if (!targetDeleteJobId) {
      throw new Error('Delete job id is required before delete status refresh.')
    }

    memoryState.value = 'loading'
    clearMemoryError()

    try {
      const response = await getAgentMemoryDeleteStatus(
        targetDeleteJobId,
        buildRequestContext()
      )
      memoryDeleteStatus.value = response
      memoryState.value = 'ready'
      emitShellEvent('memory-delete-status-observed', {
        delete_job_id: response.delete_job_id,
        status: response.status
      })
      return response
    } catch (error) {
      memoryState.value = 'error'
      memoryError.value = resolveStandardizedErrorMessage(
        error,
        'Failed to refresh memory delete status.'
      )
      emitShellEvent('session-error', {
        stage: 'memory_delete_status',
        scope: 'memory-governance'
      })
      throw error
    }
  }

  async function requestMemoryDelete(reason?: string) {
    syncGovernanceIdentityFromContext()
    memoryState.value = 'loading'
    clearMemoryError()

    try {
      const response = await requestAgentMemoryDelete(
        {
          workspace_id: governanceWorkspaceId.value,
          principal_id: governancePrincipalId.value,
          delete_scope: 'user',
          reason: reason ?? 'privacy_cleanup_request'
        },
        buildRequestContext()
      )
      memoryDeleteStatus.value = {
        delete_job_id: response.delete_job_id,
        status: response.status,
        requested_scope: response.requested_scope,
        accepted_at: response.accepted_at,
        updated_at: response.accepted_at,
        deleted_records_count: 0,
        index_pruned_count: 0
      }
      memoryState.value = 'ready'
      emitShellEvent('memory-delete-requested', {
        delete_job_id: response.delete_job_id,
        scope: response.requested_scope
      })
      recordActionAudit('memory_delete', {
        reason: reason?.trim() || 'memory_delete',
        riskLevel: 'medium',
        requiresConfirmation: true,
        traceRef: response.delete_job_id
      })
      return response
    } catch (error) {
      memoryState.value = 'error'
      memoryError.value = resolveStandardizedErrorMessage(
        error,
        'Failed to request memory delete.'
      )
      emitShellEvent('session-error', {
        stage: 'memory_delete',
        scope: 'memory-governance'
      })
      throw error
    }
  }

  async function estimateComfyWorkflowExecution() {
    syncWorkflowIdFromContext()
    const resolvedWorkflowId = workflowId.value
    if (!resolvedWorkflowId) {
      throw new Error('Workflow id is required before estimate.')
    }

    executionState.value = 'estimating'
    clearExecutionError()
    executionEstimate.value = null
    executionConfirmationAccepted.value = false
    policyGateState.value = 'idle'
    policyGateError.value = null
    policyGate.value = null
    clearDiagnosisState()
    clearReviewState()

    try {
      assertSessionRevisionUpToDate()
      const response = await estimateAgentJob(
        {
          mode: 'comfy_workflow',
          workflow_id: resolvedWorkflowId,
          execution_backend: 'auto',
          fallback_policy: 'allow_bridge',
          user_tier: 'standard',
          pricing_path: 'auto',
          currency: 'credits'
        },
        buildRequestContext()
      )
      executionEstimate.value = response
      executionState.value = 'estimate-ready'
      try {
        await refreshPolicyGate('execution')
      } catch {
        // keep estimate usable even when support explain API is temporarily unavailable
      }
      emitShellEvent('job-estimated', {
        workflow_id: resolvedWorkflowId,
        estimated_price: response.estimate.estimated_price
      })
      return response
    } catch (error) {
      handleExecutionError('job_estimate', error, 'Failed to estimate job.')
      throw error
    }
  }

  async function observeExecutionJob(jobId: string) {
    const requestContext = buildRequestContext()
    const statusResponse = await getAgentJobStatus(jobId, requestContext)

    activeJobId.value = jobId
    activeJobStatus.value = statusResponse.status
    jobStatus.value = statusResponse
    executionState.value = mapJobStatusToExecutionState(statusResponse.status)
    emitShellEvent('job-status-observed', {
      job_id: jobId,
      status: statusResponse.status
    })

    const inspectResponse = await inspectAgentJob(jobId, requestContext)
    jobInspect.value = inspectResponse
    emitShellEvent('job-inspect-observed', {
      job_id: jobId,
      timeline_size: inspectResponse.timeline.length
    })

    if (
      statusResponse.status === 'succeeded' ||
      statusResponse.status === 'failed' ||
      statusResponse.status === 'canceled'
    ) {
      try {
        const resultResponse = await getAgentJobResult(jobId, requestContext)
        jobResult.value = resultResponse
        emitShellEvent('job-result-observed', {
          job_id: jobId,
          status: resultResponse.status
        })
      } catch (error) {
        if (!(error instanceof AgentSessionApiError) || error.status !== 409) {
          throw error
        }
      }
    }

    return statusResponse
  }

  async function submitEstimatedExecution() {
    syncWorkflowIdFromContext()
    const resolvedWorkflowId = workflowId.value
    if (!resolvedWorkflowId) {
      throw new Error('Workflow id is required before submit.')
    }
    if (!executionEstimate.value) {
      throw new Error('Execution estimate is required before submit.')
    }
    if (!executionConfirmationAccepted.value) {
      throw new Error('Confirm execution before submit.')
    }
    if (policyGateBlocked.value && policyGateVerdict.value) {
      throw new Error(
        toPolicyBlockedReason(policyGateVerdict.value as PolicyBlockedVerdict)
      )
    }

    executionState.value = 'submitting'
    clearExecutionError()
    clearDiagnosisState()
    clearReviewState()

    try {
      assertSessionRevisionUpToDate()
      const confirmationReason = resolveActionReason('submit_execution', {
        required: highRiskGateReasonRequired.value,
        fallbackReason: `submit_execution:${resolvedWorkflowId}`
      })
      const accepted = await createAgentJob(
        {
          mode: 'comfy_workflow',
          workflow_id: resolvedWorkflowId,
          execution_backend: 'auto',
          fallback_policy: 'allow_bridge',
          user_tier: 'standard',
          pricing_path: 'auto',
          currency: executionEstimate.value.pricing.currency,
          max_budget: executionEstimate.value.estimate.estimated_price,
          idempotency_key: newEphemeralId('agent-window-job')
        },
        buildRequestContext()
      )

      activeJobId.value = accepted.job_id
      activeJobStatus.value = accepted.status
      executionState.value = mapJobStatusToExecutionState(accepted.status)
      emitShellEvent('job-submitted', {
        job_id: accepted.job_id,
        workflow_id: resolvedWorkflowId,
        status: accepted.status,
        confirmation_reason: confirmationReason,
        policy_verdict: policyGateVerdict.value
      })
      recordActionAudit('submit_execution', {
        reason: confirmationReason,
        riskLevel: highRiskGateReasonRequired.value ? 'high' : 'low',
        requiresConfirmation: highRiskGateReasonRequired.value,
        traceRef: accepted.job_id,
        metadata: {
          policy_verdict: policyGateVerdict.value
        }
      })

      await observeExecutionJob(accepted.job_id)
      return accepted
    } catch (error) {
      handleExecutionError('job_submit', error, 'Failed to submit execution job.')
      throw error
    }
  }

  async function refreshExecutionObservation(targetJobId = activeJobId.value) {
    if (!targetJobId) {
      throw new Error('Execution job id is required for status observation.')
    }

    try {
      clearExecutionError()
      return await observeExecutionJob(targetJobId)
    } catch (error) {
      handleExecutionError(
        'job_observe',
        error,
        'Failed to observe execution status.'
      )
      throw error
    }
  }

  async function diagnoseFailedExecution() {
    const targetJobId = activeJobId.value
    if (!targetJobId) {
      throw new Error('Execution job id is required for diagnosis.')
    }
    if (!canDiagnoseExecution.value) {
      throw new Error('Diagnose is available only after failed or canceled execution.')
    }

    diagnoseState.value = 'loading'
    diagnosisError.value = null

    try {
      const response = await diagnoseAgentExecution(
        {
          job_id: targetJobId,
          session_id: sessionId.value ?? undefined,
          workflow_id: workflowId.value ?? undefined,
          workflow_version_id: currentWorkflowVersionId.value ?? undefined,
          include_patch_handoff: true
        },
        buildRequestContext()
      )
      diagnosis.value = response
      diagnoseState.value = 'ready'
      emitShellEvent('job-diagnose-completed', {
        job_id: targetJobId,
        diagnosis_id: response.diagnosis_id,
        stage: response.stage
      })
      return response
    } catch (error) {
      handleDiagnoseError(error, 'Failed to diagnose execution failure.')
      throw error
    }
  }

  function resolveReviewMessageId() {
    const messages = resolveSessionMessages(session.value)
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      const messageId = asString(message.message_id) ?? asString(message.id)
      if (messageId) return messageId
    }
    return newEphemeralId('message')
  }

  function resolveReviewSourceActionId() {
    const actions = resolveSessionActions(session.value)
    for (const action of actions) {
      const actionId = asString(action.action_id) ?? asString(action.id)
      if (actionId) return actionId
    }
    return nextWorkflowVersionProposal.value?.action_id ?? newEphemeralId('action')
  }

  function buildExecutionReviewRequest(jobId: string): MultimodalReviewRequestV1 {
    const currentSessionId = sessionId.value
    if (!currentSessionId) {
      throw new Error('Session id is required before review submit.')
    }

    return {
      review_id: newEphemeralId(`review-${jobId}`),
      session_id: currentSessionId,
      message_id: resolveReviewMessageId(),
      source_action_id: resolveReviewSourceActionId(),
      workspace_id: DEFAULT_WORKSPACE_ID,
      workflow_id: workflowId.value ?? undefined,
      workflow_version: currentWorkflowVersionId.value ?? undefined,
      refs: [
        {
          ref_id: `${jobId}-timeline`,
          ref_type: 'timeline',
          workspace_id: DEFAULT_WORKSPACE_ID,
          timeline_ref: `/v1/jobs/${jobId}/inspect`,
          job_id: jobId
        },
        {
          ref_id: `${jobId}-log`,
          ref_type: 'log',
          workspace_id: DEFAULT_WORKSPACE_ID,
          log_ref: `/v1/jobs/${jobId}`,
          job_id: jobId
        }
      ],
      review_focus: ['runtime_stability', 'quality'],
      output_locale: 'zh-CN'
    }
  }

  async function submitExecutionReview(targetJobId = activeJobId.value) {
    if (!targetJobId) {
      throw new Error('Execution job id is required for review submit.')
    }
    const currentSessionId = sessionId.value
    if (!currentSessionId) {
      throw new Error('Session id is required for review submit.')
    }

    reviewState.value = 'loading'
    reviewError.value = null

    try {
      const request = buildExecutionReviewRequest(targetJobId)
      const submitted = await submitAgentMultimodalReview(
        currentSessionId,
        request,
        buildRequestContext()
      )

      let resolved = submitted
      if (submitted.status !== 'failed') {
        resolved = await getAgentMultimodalReview(
          currentSessionId,
          submitted.review_id,
          buildRequestContext()
        )
      }

      review.value = resolved
      reviewState.value = 'ready'
      emitShellEvent('job-review-completed', {
        job_id: targetJobId,
        review_id: resolved.review_id,
        status: resolved.status
      })
      return resolved
    } catch (error) {
      handleReviewError(error, 'Failed to submit execution review.')
      throw error
    }
  }

  async function requestNextVersionProposalFromDiagnosis() {
    if (!diagnosis.value) {
      throw new Error('Diagnose result is required before requesting next version.')
    }

    const firstFix = diagnosis.value.suggested_fixes[0]
    const summary = diagnosis.value.summary
    const guidance = firstFix
      ? `${firstFix.fix_kind}: ${firstFix.steps.join(' ')}`
      : 'Provide a safe workflow update based on diagnosis.'

    return appendUserMessage(
      `Based on diagnosis ${diagnosis.value.diagnosis_id} (${summary.title}), propose next_workflow_version_v1 for workflow ${
        workflowId.value ?? 'current'
      }. Guidance: ${guidance}`
    )
  }

  async function requestNextVersionProposalFromReview() {
    if (!review.value) {
      throw new Error('Review result is required before requesting next version.')
    }

    const recommendation = review.value.recommended_actions[0]
    const guidance = recommendation
      ? `${recommendation.action_kind}: ${recommendation.rationale}`
      : 'Provide a safe next workflow version proposal based on review.'

    return appendUserMessage(
      `Based on review ${review.value.review_id}, propose next_workflow_version_v1 for workflow ${
        workflowId.value ?? 'current'
      }. Guidance: ${guidance}`
    )
  }

  async function revertFromDiagnoseOrReview(versionId = suggestedRevertVersionId.value) {
    let targetVersionId = versionId
    if (!targetVersionId) {
      await refreshWorkflowVersions()
      targetVersionId =
        workflowVersions.value.find(
          (version) => version.version_id !== currentWorkflowVersionId.value
        )?.version_id ?? null
    }
    if (!targetVersionId) {
      throw new Error('No rollback version target is available.')
    }

    const resolvedReason = resolveActionReason('revert_from_diagnosis_or_review', {
      required: highRiskRevertReasonRequired.value,
      fallbackReason: `diagnose_or_review_revert:${targetVersionId}`
    })
    const response = await rollbackToWorkflowVersion(
      targetVersionId,
      resolvedReason
    )
    recordActionAudit('revert_from_diagnosis_or_review', {
      reason: resolvedReason,
      riskLevel:
        diagnosis.value?.risk.level ??
        (highRiskRevertReasonRequired.value ? 'high' : 'low'),
      requiresConfirmation: highRiskRevertReasonRequired.value,
      traceRef: targetVersionId
    })
    return response
  }

  async function confirmSessionAction(
    actionId: string,
    request: AgentActionDecisionRequest = {}
  ) {
    const currentSessionId = sessionId.value
    if (!currentSessionId) {
      throw new Error('Session id is required for confirmSessionAction.')
    }

    sessionState.value = 'loading'
    sessionError.value = null
    clearSessionConflict()

    try {
      assertSessionRevisionUpToDate()
      const response = await confirmAgentAction(
        currentSessionId,
        actionId,
        request,
        buildRequestContext()
      )
      applyActionTransition(response)
      sessionState.value = 'ready'
      bindSessionRevision()
      syncWorkflowIdFromContext()
      emitShellEvent('session-action-confirmed', {
        session_id: response.session_id,
        action_id: actionId
      })
      return response
    } catch (error) {
      handleSessionError('confirm_action', error, 'Failed to confirm action.')
      throw error
    }
  }

  async function rejectSessionAction(
    actionId: string,
    request: AgentActionDecisionRequest = {}
  ) {
    const currentSessionId = sessionId.value
    if (!currentSessionId) {
      throw new Error('Session id is required for rejectSessionAction.')
    }

    sessionState.value = 'loading'
    sessionError.value = null
    clearSessionConflict()

    try {
      assertSessionRevisionUpToDate()
      const response = await rejectAgentAction(
        currentSessionId,
        actionId,
        request,
        buildRequestContext()
      )
      applyActionTransition(response)
      sessionState.value = 'ready'
      bindSessionRevision()
      syncWorkflowIdFromContext()
      emitShellEvent('session-action-rejected', {
        session_id: response.session_id,
        action_id: actionId
      })
      return response
    } catch (error) {
      handleSessionError('reject_action', error, 'Failed to reject action.')
      throw error
    }
  }

  async function acceptNextWorkflowVersionCandidate(reason?: string) {
    const proposal = nextWorkflowVersionProposal.value
    if (!proposal) {
      throw new Error('No next workflow version candidate is available.')
    }

    const resolvedReason =
      reason ??
      resolveActionReason('accept_next_workflow_version', {
        required: highRiskVersionReasonRequired.value,
        fallbackReason: `accept_next_workflow_version_candidate:${proposal.candidate_version_id}`
      })
    const response = await confirmSessionAction(proposal.action_id, {
      reason: resolvedReason
    })
    markCurrentWorkflowVersion(proposal.candidate_version_id)
    if (
      !workflowVersions.value.some(
        (version) => version.version_id === proposal.candidate_version_id
      )
    ) {
      workflowVersions.value.unshift({
        version_id: proposal.candidate_version_id,
        summary: proposal.summary,
        is_current: true
      })
    }
    emitShellEvent('workflow-version-candidate-accepted', {
      action_id: proposal.action_id,
      proposal_id: proposal.proposal_id,
      candidate_version_id: proposal.candidate_version_id,
      confirmation_reason: resolvedReason
    })
    recordActionAudit('accept_next_workflow_version', {
      reason: resolvedReason,
      riskLevel: proposal.risk_level,
      requiresConfirmation: highRiskVersionReasonRequired.value,
      traceRef: proposal.proposal_id
    })
    return response
  }

  async function rejectNextWorkflowVersionCandidate(reason?: string) {
    const proposal = nextWorkflowVersionProposal.value
    if (!proposal) {
      throw new Error('No next workflow version candidate is available.')
    }

    const resolvedReason =
      reason ??
      resolveActionReason('reject_next_workflow_version', {
        required: highRiskVersionReasonRequired.value,
        fallbackReason: `reject_next_workflow_version_candidate:${proposal.candidate_version_id}`
      })
    const response = await rejectSessionAction(proposal.action_id, {
      reason: resolvedReason
    })
    emitShellEvent('workflow-version-candidate-rejected', {
      action_id: proposal.action_id,
      proposal_id: proposal.proposal_id,
      candidate_version_id: proposal.candidate_version_id,
      confirmation_reason: resolvedReason
    })
    recordActionAudit('reject_next_workflow_version', {
      reason: resolvedReason,
      riskLevel: proposal.risk_level,
      requiresConfirmation: highRiskVersionReasonRequired.value,
      traceRef: proposal.proposal_id
    })
    return response
  }

  async function refreshWorkflowVersions(targetWorkflowId = workflowId.value) {
    syncWorkflowIdFromContext()
    const resolvedWorkflowId = targetWorkflowId ?? workflowId.value
    if (!resolvedWorkflowId) {
      workflowVersionState.value = 'error'
      workflowVersionError.value =
        'Workflow id is required before loading version history.'
      return null
    }

    workflowVersionState.value = 'loading'
    workflowVersionError.value = null
    clearWorkflowVersionConflict()

    try {
      const response = await listWorkflowVersions(
        resolvedWorkflowId,
        buildRequestContext()
      )
      applyWorkflowVersionState(response)
      workflowVersionState.value = 'ready'
      bindSessionRevision()
      emitShellEvent('workflow-versions-refreshed', {
        workflow_id: response.workflow_id,
        version_count: response.versions.length
      })
      return response
    } catch (error) {
      handleWorkflowVersionError(
        'workflow_versions_list',
        error,
        'Failed to load workflow versions.'
      )
      throw error
    }
  }

  async function switchToWorkflowVersion(versionId: string, reason?: string) {
    syncWorkflowIdFromContext()
    const resolvedWorkflowId = workflowId.value
    if (!resolvedWorkflowId) {
      throw new Error('Workflow id is required for version switch.')
    }

    workflowVersionState.value = 'loading'
    workflowVersionError.value = null
    clearWorkflowVersionConflict()

    try {
      assertSessionRevisionUpToDate()
      const response = await switchWorkflowVersionApi(
        resolvedWorkflowId,
        versionId,
        { reason: reason ?? `switch_workflow_version:${versionId}` },
        buildRequestContext()
      )
      applyWorkflowVersionState(response)
      workflowVersionState.value = 'ready'
      bindSessionRevision()
      emitShellEvent('workflow-version-switched', {
        workflow_id: response.workflow_id,
        version_id: response.switched_to_version_id ?? versionId
      })
      return response
    } catch (error) {
      handleWorkflowVersionError(
        'workflow_version_switch',
        error,
        'Failed to switch workflow version.'
      )
      throw error
    }
  }

  async function rollbackToWorkflowVersion(versionId: string, reason?: string) {
    syncWorkflowIdFromContext()
    const resolvedWorkflowId = workflowId.value
    if (!resolvedWorkflowId) {
      throw new Error('Workflow id is required for version rollback.')
    }

    workflowVersionState.value = 'loading'
    workflowVersionError.value = null
    clearWorkflowVersionConflict()

    try {
      assertSessionRevisionUpToDate()
      const response = await rollbackWorkflowVersionApi(
        resolvedWorkflowId,
        versionId,
        { reason: reason ?? `rollback_workflow_version:${versionId}` },
        buildRequestContext()
      )
      applyWorkflowVersionState(response)
      workflowVersionState.value = 'ready'
      bindSessionRevision()
      emitShellEvent('workflow-version-rolled-back', {
        workflow_id: response.workflow_id,
        version_id: response.rolled_back_to_version_id ?? versionId
      })
      return response
    } catch (error) {
      handleWorkflowVersionError(
        'workflow_version_rollback',
        error,
        'Failed to rollback workflow version.'
      )
      throw error
    }
  }

  return {
    isOpen,
    isCollapsed,
    isPinned,
    position,
    zIndex,
    sessionId,
    session,
    sessionState,
    sessionError,
    sessionConflict,
    sessionRevisionBinding,
    nextWorkflowVersionProposal,
    workflowVersionState,
    workflowVersionError,
    workflowVersionConflict,
    workflowId,
    currentWorkflowVersionId,
    workflowVersions,
    latestChatWorkflow,
    executionState,
    executionError,
    executionEstimate,
    executionConfirmationAccepted,
    canSubmitEstimatedJob,
    activeJobId,
    activeJobStatus,
    jobStatus,
    jobResult,
    jobInspect,
    canDiagnoseExecution,
    diagnoseState,
    diagnosisError,
    diagnosis,
    reviewState,
    reviewError,
    review,
    governanceWorkspaceId,
    governancePrincipalId,
    policyGateState,
    policyGateError,
    policyGate,
    policyGateVerdict,
    policyGateBlocked,
    standardizedError,
    memoryState,
    memoryError,
    memoryOptOut,
    memoryOptOutDraft,
    memoryQuery,
    memoryDeleteStatus,
    actionConfirmationReason,
    actionAuditTrail,
    highRiskGateReasonRequired,
    highRiskVersionReasonRequired,
    highRiskRevertReasonRequired,
    suggestedRevertVersionId,
    eventLog,
    onShellEvent,
    emitShellEvent,
    bringToFront,
    setPosition,
    closeWindow,
    openWindow,
    toggleWindow,
    toggleCollapsed,
    togglePinned,
    setWorkflowVersionTarget,
    clearLatestChatWorkflow,
    createSession,
    fetchSession,
    ensureSessionReady,
    createAndLoadSession,
    appendMessage,
    appendUserMessage,
    setExecutionConfirmationAccepted,
    setActionConfirmationReason,
    refreshPolicyGate,
    refreshMemoryOptOutState,
    setMemoryOptOutFlag,
    updateMemoryOptOutState,
    queryMemoryForCurrentSession,
    requestMemoryDelete,
    refreshMemoryDeleteStatus,
    estimateComfyWorkflowExecution,
    submitEstimatedExecution,
    refreshExecutionObservation,
    diagnoseFailedExecution,
    submitExecutionReview,
    requestNextVersionProposalFromDiagnosis,
    requestNextVersionProposalFromReview,
    revertFromDiagnoseOrReview,
    confirmSessionAction,
    rejectSessionAction,
    acceptNextWorkflowVersionCandidate,
    rejectNextWorkflowVersionCandidate,
    refreshWorkflowVersions,
    switchToWorkflowVersion,
    rollbackToWorkflowVersion
  }
})

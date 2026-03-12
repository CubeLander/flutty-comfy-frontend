import type {
  AgentSessionRevisionBindingV1,
  CanvasContextV1
} from '@/composables/useFluttyCanvasContextV1'
import { api } from '@/scripts/api'

export interface AgentSessionCreateRequest {
  workspace_id: string
  principal_context?: Record<string, unknown>
}

export interface AgentMessageAppendRequest {
  role?: 'user' | 'agent' | 'system'
  text: string
  proposed_actions?: unknown[]
  metadata?: Record<string, unknown>
}

export interface AgentActionDecisionRequest {
  reason?: string
}

export interface WorkflowVersionDecisionRequest {
  reason?: string
}

export interface WorkflowVersionRecord {
  version_id: string
  parent_version_id?: string | null
  created_at?: string | null
  summary?: string | null
  label?: string | null
  is_current?: boolean | null
  metadata?: Record<string, unknown> | null
}

export interface WorkflowVersionListResponse {
  workflow_id: string
  current_version_id: string | null
  versions: WorkflowVersionRecord[]
}

export interface WorkflowVersionTransitionResponse
  extends WorkflowVersionListResponse {
  switched_to_version_id?: string | null
  rolled_back_to_version_id?: string | null
}

export interface AgentActionTransitionRecord {
  session_id: string
  action: Record<string, unknown>
}

export interface AgentSessionRecord {
  session_id: string
  workspace_id?: string
  messages?: unknown[]
  actions?: unknown[]
  [key: string]: unknown
}

export interface AgentSessionRequestContext {
  canvas_context_v1?: CanvasContextV1 | null
  session_revision_v1?: AgentSessionRevisionBindingV1 | null
}

export interface AgentSessionRevisionConflict {
  code: string
  recoverable: boolean
  message: string
  retry_hint: string
  expected_workflow_revision: number | null
  actual_workflow_revision: number | null
  expected_workflow_digest: string | null
  actual_workflow_digest: string | null
}

export class AgentSessionApiError extends Error {
  readonly status: number
  readonly payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.name = 'AgentSessionApiError'
    this.status = status
    this.payload = payload
  }
}

export class AgentSessionRevisionConflictError extends Error {
  readonly status: number | null
  readonly payload: unknown
  readonly conflict: AgentSessionRevisionConflict

  constructor(
    conflict: AgentSessionRevisionConflict,
    status: number | null,
    payload: unknown
  ) {
    super(conflict.message)
    this.name = 'AgentSessionRevisionConflictError'
    this.status = status
    this.payload = payload
    this.conflict = conflict
  }
}

async function parseJsonPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function toHeadersMap(
  headers: HeadersInit | undefined
): Record<string, string> {
  if (!headers) return {}

  if (headers instanceof Headers) {
    const mapped: Record<string, string> = {}
    headers.forEach((value, key) => {
      mapped[key] = value
    })
    return mapped
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }

  return { ...headers }
}

function withRequestContext(
  init: RequestInit,
  requestContext?: AgentSessionRequestContext
): RequestInit {
  if (!requestContext) return init

  const headers = toHeadersMap(init.headers)
  const context = requestContext.canvas_context_v1

  if (context) {
    headers['X-Flutty-Canvas-Context'] = context.schema
    headers['X-Flutty-Canvas-Captured-At'] = context.captured_at
    headers['X-Flutty-Selected-Nodes'] = context.selected_nodes.join(',')
    if (context.workflow.revision !== null) {
      headers['X-Flutty-Workflow-Revision'] = String(context.workflow.revision)
    }
    if (context.workflow.digest) {
      headers['X-Flutty-Workflow-Digest'] = context.workflow.digest
    }
    if (context.workspace_id) {
      headers['X-Flutty-Workspace-Id'] = context.workspace_id
    }
    if (context.principal_id) {
      headers['X-Flutty-Principal-Id'] = context.principal_id
    }
    if (context.viewport) {
      headers['X-Flutty-Viewport'] = JSON.stringify(context.viewport)
    }
  }

  const sessionRevision = requestContext.session_revision_v1
  if (sessionRevision) {
    if (sessionRevision.workflow_revision !== null) {
      headers['X-Flutty-Session-Workflow-Revision'] = String(
        sessionRevision.workflow_revision
      )
    }
    if (sessionRevision.workflow_digest) {
      headers['X-Flutty-Session-Workflow-Digest'] =
        sessionRevision.workflow_digest
    }
  }

  return {
    ...init,
    headers
  }
}

function parseRevisionConflict(
  status: number,
  payload: unknown
): AgentSessionRevisionConflict | null {
  if (status !== 409 && status !== 412) return null

  const payloadRecord = asRecord(payload)
  const code =
    asString(payloadRecord?.code) ??
    asString(payloadRecord?.error_code) ??
    'agent_session_revision_conflict'
  const detail = asString(payloadRecord?.detail)
  const reason = `${code} ${detail ?? ''}`.toLowerCase()

  const looksRevisionConflict =
    reason.includes('revision') ||
    reason.includes('stale') ||
    reason.includes('workflow_digest') ||
    reason.includes('canvas_context')

  if (!looksRevisionConflict) return null

  return {
    code,
    recoverable: true,
    message: asString(payloadRecord?.message) ?? 'Session revision conflict.',
    retry_hint: 'Refresh session context and retry.',
    expected_workflow_revision:
      asNumber(payloadRecord?.expected_workflow_revision) ??
      asNumber(payloadRecord?.expected_revision),
    actual_workflow_revision:
      asNumber(payloadRecord?.actual_workflow_revision) ??
      asNumber(payloadRecord?.actual_revision),
    expected_workflow_digest:
      asString(payloadRecord?.expected_workflow_digest) ??
      asString(payloadRecord?.expected_digest),
    actual_workflow_digest:
      asString(payloadRecord?.actual_workflow_digest) ??
      asString(payloadRecord?.actual_digest)
  }
}

function normalizeWorkflowVersionRecord(
  raw: unknown,
  fallbackVersionId: string | null = null
): WorkflowVersionRecord | null {
  const record = asRecord(raw)
  const versionId =
    asString(record?.version_id) ?? asString(record?.id) ?? fallbackVersionId
  if (!versionId) return null

  const isCurrentRaw = record?.is_current

  return {
    version_id: versionId,
    parent_version_id:
      asString(record?.parent_version_id) ?? asString(record?.parent_id),
    created_at: asString(record?.created_at) ?? asString(record?.updated_at),
    summary:
      asString(record?.summary) ??
      asString(record?.description) ??
      asString(record?.title),
    label: asString(record?.label) ?? asString(record?.name),
    is_current: typeof isCurrentRaw === 'boolean' ? isCurrentRaw : null,
    metadata: asRecord(record?.metadata)
  }
}

function normalizeWorkflowVersionResponse(
  payload: unknown,
  fallbackWorkflowId: string
): WorkflowVersionListResponse {
  const payloadRecord = asRecord(payload)
  const workflowRecord = asRecord(payloadRecord?.workflow)
  const workflowId =
    asString(payloadRecord?.workflow_id) ??
    asString(workflowRecord?.workflow_id) ??
    asString(workflowRecord?.id) ??
    fallbackWorkflowId

  const currentVersionId =
    asString(payloadRecord?.current_version_id) ??
    asString(payloadRecord?.active_version_id) ??
    asString(payloadRecord?.current_version) ??
    asString(workflowRecord?.current_version_id) ??
    asString(workflowRecord?.active_version_id)

  const versions = asArray(payloadRecord?.versions)
    .map((entry) => normalizeWorkflowVersionRecord(entry))
    .filter((entry): entry is WorkflowVersionRecord => entry !== null)

  const responseVersion = normalizeWorkflowVersionRecord(
    payloadRecord?.version ?? payloadRecord?.switched_version
  )
  if (
    responseVersion &&
    !versions.some((entry) => entry.version_id === responseVersion.version_id)
  ) {
    versions.unshift(responseVersion)
  }

  const resolvedCurrentVersionId = currentVersionId ?? responseVersion?.version_id ?? null
  const normalizedVersions = versions.map((entry) => ({
    ...entry,
    is_current: resolvedCurrentVersionId
      ? entry.version_id === resolvedCurrentVersionId
      : entry.is_current ?? false
  }))

  if (
    resolvedCurrentVersionId &&
    !normalizedVersions.some(
      (entry) => entry.version_id === resolvedCurrentVersionId
    )
  ) {
    normalizedVersions.unshift({
      version_id: resolvedCurrentVersionId,
      is_current: true
    })
  }

  return {
    workflow_id: workflowId,
    current_version_id: resolvedCurrentVersionId,
    versions: normalizedVersions
  }
}

async function requestAgentSessionApi<T>(
  route: string,
  init: RequestInit,
  requestContext?: AgentSessionRequestContext,
  errorPrefix = 'Agent session API failed'
): Promise<T> {
  const response = await api.fetchApi(route, withRequestContext(init, requestContext))
  const payload = await parseJsonPayload(response)

  if (!response.ok) {
    const revisionConflict = parseRevisionConflict(response.status, payload)
    if (revisionConflict) {
      throw new AgentSessionRevisionConflictError(
        revisionConflict,
        response.status,
        payload
      )
    }
    throw new AgentSessionApiError(
      `${errorPrefix} (${response.status})`,
      response.status,
      payload
    )
  }

  return payload as T
}

export function isAgentSessionRevisionConflictError(
  error: unknown
): error is AgentSessionRevisionConflictError {
  return error instanceof AgentSessionRevisionConflictError
}

export function createLocalSessionRevisionConflictError({
  expected_workflow_revision,
  actual_workflow_revision,
  expected_workflow_digest,
  actual_workflow_digest
}: Omit<
  AgentSessionRevisionConflict,
  'code' | 'recoverable' | 'message' | 'retry_hint'
>): AgentSessionRevisionConflictError {
  return new AgentSessionRevisionConflictError(
    {
      code: 'agent_session_revision_conflict',
      recoverable: true,
      message:
        'Canvas context changed and no longer matches the bound session revision.',
      retry_hint: 'Refresh session context and retry.',
      expected_workflow_revision,
      actual_workflow_revision,
      expected_workflow_digest,
      actual_workflow_digest
    },
    null,
    null
  )
}

export function createAgentSession(
  request: AgentSessionCreateRequest,
  requestContext?: AgentSessionRequestContext
): Promise<AgentSessionRecord> {
  return requestAgentSessionApi<AgentSessionRecord>('/v1/agent/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  }, requestContext)
}

export function getAgentSession(
  sessionId: string,
  requestContext?: AgentSessionRequestContext
): Promise<AgentSessionRecord> {
  return requestAgentSessionApi<AgentSessionRecord>(
    `/v1/agent/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'GET' },
    requestContext
  )
}

export function appendAgentSessionMessage(
  sessionId: string,
  request: AgentMessageAppendRequest,
  requestContext?: AgentSessionRequestContext
): Promise<AgentSessionRecord> {
  return requestAgentSessionApi<AgentSessionRecord>(
    `/v1/agent/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    },
    requestContext
  )
}

function decideAgentAction(
  decision: 'confirm' | 'reject',
  sessionId: string,
  actionId: string,
  request: AgentActionDecisionRequest,
  requestContext?: AgentSessionRequestContext
): Promise<AgentActionTransitionRecord> {
  return requestAgentSessionApi<AgentActionTransitionRecord>(
    `/v1/agent/sessions/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(actionId)}/${decision}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    },
    requestContext
  )
}

export function confirmAgentAction(
  sessionId: string,
  actionId: string,
  request: AgentActionDecisionRequest = {},
  requestContext?: AgentSessionRequestContext
): Promise<AgentActionTransitionRecord> {
  return decideAgentAction(
    'confirm',
    sessionId,
    actionId,
    request,
    requestContext
  )
}

export function rejectAgentAction(
  sessionId: string,
  actionId: string,
  request: AgentActionDecisionRequest = {},
  requestContext?: AgentSessionRequestContext
): Promise<AgentActionTransitionRecord> {
  return decideAgentAction(
    'reject',
    sessionId,
    actionId,
    request,
    requestContext
  )
}

function workflowVersionsRoute(workflowId: string): string {
  return `/v1/workflows/${encodeURIComponent(workflowId)}/versions`
}

export async function listWorkflowVersions(
  workflowId: string,
  requestContext?: AgentSessionRequestContext
): Promise<WorkflowVersionListResponse> {
  const payload = await requestAgentSessionApi<unknown>(
    workflowVersionsRoute(workflowId),
    { method: 'GET' },
    requestContext,
    'Workflow version API failed'
  )
  return normalizeWorkflowVersionResponse(payload, workflowId)
}

export async function switchWorkflowVersion(
  workflowId: string,
  versionId: string,
  request: WorkflowVersionDecisionRequest = {},
  requestContext?: AgentSessionRequestContext
): Promise<WorkflowVersionTransitionResponse> {
  const payload = await requestAgentSessionApi<unknown>(
    `${workflowVersionsRoute(workflowId)}/${encodeURIComponent(versionId)}/switch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    },
    requestContext,
    'Workflow version API failed'
  )
  const normalized = normalizeWorkflowVersionResponse(payload, workflowId)
  const payloadRecord = asRecord(payload)
  const versionRecord = asRecord(payloadRecord?.version)
  return {
    ...normalized,
    switched_to_version_id:
      asString(payloadRecord?.switched_to_version_id) ??
      asString(versionRecord?.version_id) ??
      asString(versionRecord?.id) ??
      versionId
  }
}

export async function rollbackWorkflowVersion(
  workflowId: string,
  versionId: string,
  request: WorkflowVersionDecisionRequest = {},
  requestContext?: AgentSessionRequestContext
): Promise<WorkflowVersionTransitionResponse> {
  const payload = await requestAgentSessionApi<unknown>(
    `${workflowVersionsRoute(workflowId)}/${encodeURIComponent(versionId)}/rollback`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    },
    requestContext,
    'Workflow version API failed'
  )
  const normalized = normalizeWorkflowVersionResponse(payload, workflowId)
  const payloadRecord = asRecord(payload)
  const versionRecord = asRecord(payloadRecord?.version)
  return {
    ...normalized,
    rolled_back_to_version_id:
      asString(payloadRecord?.rolled_back_to_version_id) ??
      asString(payloadRecord?.rollback_to_version_id) ??
      asString(versionRecord?.version_id) ??
      asString(versionRecord?.id) ??
      versionId
  }
}

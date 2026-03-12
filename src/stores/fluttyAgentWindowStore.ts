import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  toSessionRevisionBinding,
  useFluttyCanvasContextV1
} from '@/composables/useFluttyCanvasContextV1'
import type {
  AgentActionDecisionRequest,
  AgentActionTransitionRecord,
  AgentMessageAppendRequest,
  AgentSessionRecord,
  AgentSessionRevisionConflict,
  WorkflowVersionListResponse,
  WorkflowVersionRecord
} from '@/stores/fluttyAgentSessionApi'
import {
  appendAgentSessionMessage,
  confirmAgentAction,
  createAgentSession,
  createLocalSessionRevisionConflictError,
  getAgentSession,
  isAgentSessionRevisionConflictError,
  listWorkflowVersions,
  rejectAgentAction,
  rollbackWorkflowVersion as rollbackWorkflowVersionApi,
  switchWorkflowVersion as switchWorkflowVersionApi
} from '@/stores/fluttyAgentSessionApi'

const DEFAULT_WORKSPACE_ID = 'ws-comfyui-canvas'
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

  function clearSessionConflict() {
    sessionConflict.value = null
  }

  function clearWorkflowVersionConflict() {
    workflowVersionConflict.value = null
  }

  function bindSessionRevision() {
    sessionRevisionBinding.value = toSessionRevisionBinding(captureCanvasContextV1())
  }

  function syncWorkflowIdFromContext() {
    const proposalWorkflowId = nextWorkflowVersionProposal.value?.workflow_id
    if (proposalWorkflowId) {
      workflowId.value = proposalWorkflowId
      return
    }

    const contextWorkflowId = captureCanvasContextV1().workflow.path
    if (contextWorkflowId) {
      workflowId.value = contextWorkflowId
    }
  }

  function assertSessionRevisionUpToDate() {
    const expected = sessionRevisionBinding.value
    if (!expected) return

    const latest = captureCanvasContextV1()
    const latestRevision = latest.workflow.revision
    const latestDigest = latest.workflow.digest

    const revisionMismatch =
      expected.workflow_revision !== null &&
      latestRevision !== null &&
      expected.workflow_revision !== latestRevision
    const digestMismatch =
      !!expected.workflow_digest &&
      !!latestDigest &&
      expected.workflow_digest !== latestDigest

    if (!revisionMismatch && !digestMismatch) return

    throw createLocalSessionRevisionConflictError({
      expected_workflow_revision: expected.workflow_revision,
      actual_workflow_revision: latestRevision,
      expected_workflow_digest: expected.workflow_digest,
      actual_workflow_digest: latestDigest
    })
  }

  function buildRequestContext() {
    return {
      canvas_context_v1: captureCanvasContextV1(),
      session_revision_v1: sessionRevisionBinding.value
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
    sessionError.value = error instanceof Error ? error.message : fallbackMessage
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
    workflowVersionError.value =
      error instanceof Error ? error.message : fallbackMessage
    emitShellEvent('session-error', {
      stage,
      scope: 'workflow-version'
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
    const updatedActionId = asString(updatedAction?.action_id)
    if (!updatedAction || !updatedActionId || !session.value) return

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
    emitShellEvent('window-opened')
    await ensureSessionReady()
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
      sessionState.value = 'ready'
      bindSessionRevision()
      syncWorkflowIdFromContext()
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

    try {
      const fetched = await getAgentSession(targetSessionId, buildRequestContext())
      sessionId.value = fetched.session_id
      session.value = fetched
      sessionState.value = 'ready'
      bindSessionRevision()
      syncWorkflowIdFromContext()
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

  async function appendMessage(request: AgentMessageAppendRequest) {
    const currentSessionId = sessionId.value
    if (!currentSessionId) {
      throw new Error('Session id is required for appendMessage.')
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
      sessionState.value = 'ready'
      bindSessionRevision()
      syncWorkflowIdFromContext()
      emitShellEvent('session-message-appended', { session_id: currentSessionId })
      return appended
    } catch (error) {
      handleSessionError('append_message', error, 'Failed to append message.')
      throw error
    }
  }

  async function appendUserMessage(text: string) {
    return appendMessage({
      role: 'user',
      text
    })
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

    const response = await confirmSessionAction(proposal.action_id, {
      reason:
        reason ??
        `accept_next_workflow_version_candidate:${proposal.candidate_version_id}`
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
      candidate_version_id: proposal.candidate_version_id
    })
    return response
  }

  async function rejectNextWorkflowVersionCandidate(reason?: string) {
    const proposal = nextWorkflowVersionProposal.value
    if (!proposal) {
      throw new Error('No next workflow version candidate is available.')
    }

    const response = await rejectSessionAction(proposal.action_id, {
      reason:
        reason ??
        `reject_next_workflow_version_candidate:${proposal.candidate_version_id}`
    })
    emitShellEvent('workflow-version-candidate-rejected', {
      action_id: proposal.action_id,
      proposal_id: proposal.proposal_id,
      candidate_version_id: proposal.candidate_version_id
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
    createSession,
    fetchSession,
    ensureSessionReady,
    createAndLoadSession,
    appendMessage,
    appendUserMessage,
    confirmSessionAction,
    rejectSessionAction,
    acceptNextWorkflowVersionCandidate,
    rejectNextWorkflowVersionCandidate,
    refreshWorkflowVersions,
    switchToWorkflowVersion,
    rollbackToWorkflowVersion
  }
})

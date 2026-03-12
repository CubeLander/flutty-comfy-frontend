import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  toSessionRevisionBinding,
  useFluttyCanvasContextV1
} from '@/composables/useFluttyCanvasContextV1'
import type {
  AgentActionDecisionRequest,
  AgentMessageAppendRequest,
  AgentSessionRecord,
  AgentSessionRevisionConflict
} from '@/stores/fluttyAgentSessionApi'
import {
  appendAgentSessionMessage,
  confirmAgentAction,
  createAgentSession,
  createLocalSessionRevisionConflictError,
  getAgentSession,
  isAgentSessionRevisionConflictError,
  rejectAgentAction
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
  | 'session-error'

export interface FluttyAgentShellEvent {
  type: FluttyAgentShellEventType
  at: string
  payload?: Record<string, unknown>
}

type SessionState = 'idle' | 'creating' | 'loading' | 'ready' | 'error'

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

  function bindSessionRevision() {
    sessionRevisionBinding.value = toSessionRevisionBinding(captureCanvasContextV1())
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

  async function createSession() {
    sessionState.value = 'creating'
    sessionError.value = null
    clearSessionConflict()

    try {
      const requestContext = buildRequestContext()
      const created = await createAgentSession({
        workspace_id: DEFAULT_WORKSPACE_ID
      }, requestContext)
      sessionId.value = created.session_id
      session.value = created
      sessionState.value = 'ready'
      bindSessionRevision()
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
      sessionState.value = 'ready'
      bindSessionRevision()
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
      sessionState.value = 'ready'
      bindSessionRevision()
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
    createSession,
    fetchSession,
    ensureSessionReady,
    createAndLoadSession,
    appendMessage,
    appendUserMessage,
    confirmSessionAction,
    rejectSessionAction
  }
})

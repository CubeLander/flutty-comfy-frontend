import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFluttyAgentWindowStore } from '@/stores/fluttyAgentWindowStore'

const { mockFetchApi, mockCaptureCanvasContext } = vi.hoisted(() => ({
  mockFetchApi: vi.fn(),
  mockCaptureCanvasContext: vi.fn()
}))

vi.mock('@/scripts/api', () => ({
  api: {
    fetchApi: mockFetchApi
  }
}))

vi.mock('@/composables/useFluttyCanvasContextV1', () => ({
  useFluttyCanvasContextV1: () => ({
    captureCanvasContextV1: mockCaptureCanvasContext
  }),
  toSessionRevisionBinding: (context: {
    workflow: { revision: number | null; digest: string | null }
  }) =>
    context
      ? {
          workflow_revision: context.workflow.revision,
          workflow_digest: context.workflow.digest
        }
      : null
}))

function asJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function buildCanvasContext(
  revision: number,
  digest: string
): {
  schema: 'canvas_context_v1'
  captured_at: string
  workflow: { path: string; revision: number; digest: string }
  selected_nodes: string[]
  viewport: { scale: number; offset: [number, number] }
  workspace_id: string
  principal_id: string
} {
  return {
    schema: 'canvas_context_v1',
    captured_at: '2026-03-12T00:00:00.000Z',
    workflow: {
      path: 'workflows/active.json',
      revision,
      digest
    },
    selected_nodes: ['4', '8'],
    viewport: {
      scale: 1.25,
      offset: [12, -4]
    },
    workspace_id: 'ws-comfyui-canvas',
    principal_id: 'principal-10b'
  }
}

describe('useFluttyAgentWindowStore', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    mockFetchApi.mockReset()
    mockCaptureCanvasContext.mockReset()
    mockCaptureCanvasContext.mockReturnValue(buildCanvasContext(11, 'digest-r11'))
  })

  it('supports basic window interaction state changes', () => {
    const store = useFluttyAgentWindowStore()

    expect(store.isCollapsed).toBe(false)
    store.toggleCollapsed()
    expect(store.isCollapsed).toBe(true)

    expect(store.isPinned).toBe(false)
    store.togglePinned()
    expect(store.isPinned).toBe(true)
    expect(store.zIndex).toBe(3000)

    store.closeWindow()
    expect(store.isOpen).toBe(false)
  })

  it('runs session create/get chain through the adapter', async () => {
    mockFetchApi
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10a',
          workspace_id: 'ws-comfyui-canvas'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10a',
          workspace_id: 'ws-comfyui-canvas',
          messages: [],
          actions: []
        })
      )

    const store = useFluttyAgentWindowStore()
    await store.ensureSessionReady()

    expect(mockFetchApi).toHaveBeenNthCalledWith(
      1,
      '/v1/agent/sessions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Flutty-Canvas-Context': 'canvas_context_v1',
          'X-Flutty-Workflow-Revision': '11',
          'X-Flutty-Workflow-Digest': 'digest-r11',
          'X-Flutty-Workspace-Id': 'ws-comfyui-canvas',
          'X-Flutty-Principal-Id': 'principal-10b'
        })
      })
    )
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      2,
      '/v1/agent/sessions/session-10a',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-Flutty-Session-Workflow-Revision': '11',
          'X-Flutty-Session-Workflow-Digest': 'digest-r11'
        })
      })
    )
    expect(store.sessionId).toBe('session-10a')
    expect(store.sessionState).toBe('ready')
    expect(store.eventLog[0].type).toBe('session-fetched')
  })

  it('injects canvas context and session revision into append message payload', async () => {
    mockFetchApi
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10b',
          workspace_id: 'ws-comfyui-canvas'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10b',
          workspace_id: 'ws-comfyui-canvas',
          messages: [],
          actions: []
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10b',
          workspace_id: 'ws-comfyui-canvas',
          messages: [{ message_id: 'm-1' }],
          actions: []
        })
      )

    const store = useFluttyAgentWindowStore()
    await store.ensureSessionReady()
    await store.appendUserMessage('hello canvas')

    expect(mockFetchApi).toHaveBeenNthCalledWith(
      3,
      '/v1/agent/sessions/session-10b/messages',
      expect.objectContaining({ method: 'POST' })
    )

    const appendPayload = JSON.parse(
      String((mockFetchApi.mock.calls[2][1] as RequestInit).body)
    )
    expect(appendPayload.metadata.canvas_context_v1).toMatchObject({
      schema: 'canvas_context_v1',
      workflow: {
        revision: 11,
        digest: 'digest-r11'
      },
      selected_nodes: ['4', '8'],
      workspace_id: 'ws-comfyui-canvas',
      principal_id: 'principal-10b'
    })
    expect(appendPayload.metadata.session_revision_v1).toEqual({
      workflow_revision: 11,
      workflow_digest: 'digest-r11'
    })
  })

  it('handles revision conflict as recoverable and succeeds after refresh/retry', async () => {
    mockCaptureCanvasContext
      .mockReturnValueOnce(buildCanvasContext(11, 'digest-r11'))
      .mockReturnValueOnce(buildCanvasContext(11, 'digest-r11'))
      .mockReturnValueOnce(buildCanvasContext(11, 'digest-r11'))
      .mockReturnValueOnce(buildCanvasContext(11, 'digest-r11'))
      .mockReturnValueOnce(buildCanvasContext(11, 'digest-r11'))
      .mockReturnValueOnce(buildCanvasContext(12, 'digest-r12'))
      .mockReturnValueOnce(buildCanvasContext(12, 'digest-r12'))
      .mockReturnValueOnce(buildCanvasContext(12, 'digest-r12'))
      .mockReturnValueOnce(buildCanvasContext(12, 'digest-r12'))
      .mockReturnValueOnce(buildCanvasContext(12, 'digest-r12'))
      .mockReturnValueOnce(buildCanvasContext(12, 'digest-r12'))

    mockFetchApi
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10b',
          workspace_id: 'ws-comfyui-canvas'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10b',
          workspace_id: 'ws-comfyui-canvas',
          messages: [],
          actions: []
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10b',
          workspace_id: 'ws-comfyui-canvas',
          messages: [],
          actions: []
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10b',
          workspace_id: 'ws-comfyui-canvas',
          messages: [{ message_id: 'retry-1' }],
          actions: []
        })
      )

    const store = useFluttyAgentWindowStore()
    await store.ensureSessionReady()

    await expect(store.appendUserMessage('stale attempt')).rejects.toMatchObject(
      {
        name: 'AgentSessionRevisionConflictError'
      }
    )
    expect(mockFetchApi).toHaveBeenCalledTimes(2)
    expect(store.sessionConflict?.code).toBe('agent_session_revision_conflict')
    expect(store.sessionError).toContain('Refresh session context and retry.')

    await store.fetchSession()
    await store.appendUserMessage('retry after refresh')

    expect(mockFetchApi).toHaveBeenCalledTimes(4)
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      4,
      '/v1/agent/sessions/session-10b/messages',
      expect.objectContaining({ method: 'POST' })
    )
    expect(store.sessionState).toBe('ready')
  })

  it('emits session-error when create request fails', async () => {
    mockFetchApi.mockResolvedValueOnce(asJsonResponse({ detail: 'boom' }, 500))

    const store = useFluttyAgentWindowStore()
    await expect(store.createSession()).rejects.toThrow()

    expect(store.sessionState).toBe('error')
    expect(store.eventLog[0].type).toBe('session-error')
  })
})

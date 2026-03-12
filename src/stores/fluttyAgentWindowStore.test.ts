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

function buildNextVersionAction(status: 'proposed' | 'confirmed' | 'rejected') {
  return {
    action_id: 'action-next-version',
    action_type: 'workflow_patch',
    title: 'Apply next workflow version',
    description: 'Switch workflow to the candidate version.',
    status,
    confirmation: {
      requires_confirmation: true,
      risk_level: 'medium'
    },
    metadata: {
      next_workflow_version_v1: {
        proposal_id: 'proposal-next-v2',
        workflow_id: 'workflows/active.json',
        base_revision: 11,
        candidate_version_id: 'version-v2',
        summary: 'Improve denoise scheduling with cleaner defaults.',
        estimated_cost_band: 'medium'
      }
    }
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
    mockCaptureCanvasContext.mockReturnValue(buildCanvasContext(12, 'digest-r12'))

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

  it('parses and accepts next workflow version candidate', async () => {
    mockFetchApi
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10c',
          workspace_id: 'ws-comfyui-canvas'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10c',
          workspace_id: 'ws-comfyui-canvas',
          messages: [],
          actions: [buildNextVersionAction('proposed')]
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10c',
          action: buildNextVersionAction('confirmed')
        })
      )

    const store = useFluttyAgentWindowStore()
    await store.ensureSessionReady()

    expect(store.nextWorkflowVersionProposal?.candidate_version_id).toBe(
      'version-v2'
    )

    await store.acceptNextWorkflowVersionCandidate()

    expect(mockFetchApi).toHaveBeenNthCalledWith(
      3,
      '/v1/agent/sessions/session-10c/actions/action-next-version/confirm',
      expect.objectContaining({ method: 'POST' })
    )
    expect(store.nextWorkflowVersionProposal).toBeNull()
    expect(store.currentWorkflowVersionId).toBe('version-v2')
    expect(store.eventLog[0].type).toBe('workflow-version-candidate-accepted')
  })

  it('rejects next workflow version candidate', async () => {
    mockFetchApi
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10c',
          workspace_id: 'ws-comfyui-canvas'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10c',
          workspace_id: 'ws-comfyui-canvas',
          messages: [],
          actions: [buildNextVersionAction('proposed')]
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10c',
          action: buildNextVersionAction('rejected')
        })
      )

    const store = useFluttyAgentWindowStore()
    await store.ensureSessionReady()
    await store.rejectNextWorkflowVersionCandidate()

    expect(mockFetchApi).toHaveBeenNthCalledWith(
      3,
      '/v1/agent/sessions/session-10c/actions/action-next-version/reject',
      expect.objectContaining({ method: 'POST' })
    )
    expect(store.nextWorkflowVersionProposal).toBeNull()
    expect(store.eventLog[0].type).toBe('workflow-version-candidate-rejected')
  })

  it('loads, switches, and rollbacks workflow versions', async () => {
    mockFetchApi
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10c',
          workspace_id: 'ws-comfyui-canvas'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10c',
          workspace_id: 'ws-comfyui-canvas',
          messages: [],
          actions: []
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          workflow_id: 'workflows/active.json',
          current_version_id: 'version-v1',
          versions: [{ version_id: 'version-v1' }, { version_id: 'version-v0' }]
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          workflow_id: 'workflows/active.json',
          switched_to_version_id: 'version-v2',
          current_version_id: 'version-v2',
          versions: [{ version_id: 'version-v2' }, { version_id: 'version-v1' }]
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          workflow_id: 'workflows/active.json',
          rolled_back_to_version_id: 'version-v1',
          current_version_id: 'version-v1',
          versions: [{ version_id: 'version-v1' }, { version_id: 'version-v2' }]
        })
      )

    const store = useFluttyAgentWindowStore()
    await store.ensureSessionReady()
    await store.refreshWorkflowVersions()
    await store.switchToWorkflowVersion('version-v2')
    await store.rollbackToWorkflowVersion('version-v1')

    expect(mockFetchApi).toHaveBeenNthCalledWith(
      3,
      '/v1/workflows/workflows%2Factive.json/versions',
      expect.objectContaining({ method: 'GET' })
    )
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      4,
      '/v1/workflows/workflows%2Factive.json/versions/version-v2/switch',
      expect.objectContaining({ method: 'POST' })
    )
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      5,
      '/v1/workflows/workflows%2Factive.json/versions/version-v1/rollback',
      expect.objectContaining({ method: 'POST' })
    )
    expect(store.currentWorkflowVersionId).toBe('version-v1')
    expect(store.workflowVersions[0].version_id).toBe('version-v1')
  })

  it('stores structured conflict when workflow version switch is stale', async () => {
    mockFetchApi
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10c',
          workspace_id: 'ws-comfyui-canvas'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10c',
          workspace_id: 'ws-comfyui-canvas',
          messages: [],
          actions: []
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse(
          {
            code: 'workflow_revision_conflict',
            detail: 'revision_mismatch',
            expected_workflow_revision: 11,
            actual_workflow_revision: 12
          },
          409
        )
      )

    const store = useFluttyAgentWindowStore()
    await store.ensureSessionReady()

    await expect(store.switchToWorkflowVersion('version-v2')).rejects.toMatchObject(
      {
        name: 'AgentSessionRevisionConflictError'
      }
    )
    expect(store.workflowVersionConflict?.code).toBe('workflow_revision_conflict')
    expect(store.workflowVersionError).toContain('Refresh session context and retry.')
  })

  it('emits session-error when create request fails', async () => {
    mockFetchApi.mockResolvedValueOnce(asJsonResponse({ detail: 'boom' }, 500))

    const store = useFluttyAgentWindowStore()
    await expect(store.createSession()).rejects.toThrow()

    expect(store.sessionState).toBe('error')
    expect(store.eventLog[0].type).toBe('session-error')
  })
})

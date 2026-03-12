import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AgentSessionRevisionConflictError,
  appendAgentSessionMessage
} from '@/stores/fluttyAgentSessionApi'

const { mockFetchApi } = vi.hoisted(() => ({
  mockFetchApi: vi.fn()
}))

vi.mock('@/scripts/api', () => ({
  api: {
    fetchApi: mockFetchApi
  }
}))

function asJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('fluttyAgentSessionApi', () => {
  beforeEach(() => {
    mockFetchApi.mockReset()
  })

  it('injects canvas context and session revision headers on message append', async () => {
    mockFetchApi.mockResolvedValueOnce(
      asJsonResponse({
        session_id: 'session-10b',
        workspace_id: 'ws-comfyui-canvas',
        messages: [],
        actions: []
      })
    )

    await appendAgentSessionMessage(
      'session-10b',
      { role: 'user', text: 'hello' },
      {
        canvas_context_v1: {
          schema: 'canvas_context_v1',
          captured_at: '2026-03-12T12:00:00.000Z',
          workflow: {
            path: 'workflows/active.json',
            revision: 18,
            digest: 'digest-r18'
          },
          selected_nodes: ['2', '5'],
          viewport: { scale: 1.1, offset: [10, -3] },
          workspace_id: 'ws-comfyui-canvas',
          principal_id: 'principal-10b'
        },
        session_revision_v1: {
          workflow_revision: 18,
          workflow_digest: 'digest-r18'
        }
      }
    )

    expect(mockFetchApi).toHaveBeenCalledWith(
      '/v1/agent/sessions/session-10b/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Flutty-Canvas-Context': 'canvas_context_v1',
          'X-Flutty-Workflow-Revision': '18',
          'X-Flutty-Workflow-Digest': 'digest-r18',
          'X-Flutty-Session-Workflow-Revision': '18',
          'X-Flutty-Session-Workflow-Digest': 'digest-r18'
        })
      })
    )
  })

  it('maps revision conflict payload to structured error', async () => {
    mockFetchApi.mockResolvedValueOnce(
      asJsonResponse(
        {
          code: 'agent_session_revision_conflict',
          detail: 'workflow_revision_conflict',
          expected_workflow_revision: 7,
          actual_workflow_revision: 8,
          expected_workflow_digest: 'digest-r7',
          actual_workflow_digest: 'digest-r8'
        },
        409
      )
    )

    let capturedError: unknown = null
    try {
      await appendAgentSessionMessage('session-10b', {
        role: 'user',
        text: 'hello'
      })
    } catch (error) {
      capturedError = error
    }

    expect(capturedError).toBeInstanceOf(AgentSessionRevisionConflictError)
    expect(
      (capturedError as AgentSessionRevisionConflictError).conflict
    ).toMatchObject({
      code: 'agent_session_revision_conflict',
      recoverable: true,
      expected_workflow_revision: 7,
      actual_workflow_revision: 8
    })
  })
})

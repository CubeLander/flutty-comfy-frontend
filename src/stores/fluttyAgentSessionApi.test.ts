import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AgentSessionRevisionConflictError,
  appendAgentSessionMessage,
  listWorkflowVersions,
  rollbackWorkflowVersion,
  switchWorkflowVersion
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

  it('normalizes workflow versions list payload and keeps revision headers', async () => {
    mockFetchApi.mockResolvedValueOnce(
      asJsonResponse({
        workflow: {
          id: 'workflows/active.json',
          active_version_id: 'v2'
        },
        versions: [
          {
            id: 'v2',
            summary: 'New candidate accepted'
          },
          {
            version_id: 'v1',
            label: 'Initial version'
          }
        ]
      })
    )

    const response = await listWorkflowVersions('workflows/active.json', {
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
    })

    expect(mockFetchApi).toHaveBeenCalledWith(
      '/v1/workflows/workflows%2Factive.json/versions',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-Flutty-Canvas-Context': 'canvas_context_v1',
          'X-Flutty-Session-Workflow-Revision': '18'
        })
      })
    )
    expect(response).toMatchObject({
      workflow_id: 'workflows/active.json',
      current_version_id: 'v2',
      versions: [
        {
          version_id: 'v2',
          is_current: true
        },
        {
          version_id: 'v1',
          is_current: false
        }
      ]
    })
  })

  it('supports version switch and rollback endpoints', async () => {
    mockFetchApi
      .mockResolvedValueOnce(
        asJsonResponse({
          workflow_id: 'workflows/active.json',
          switched_to_version_id: 'v3',
          current_version_id: 'v3',
          versions: [{ version_id: 'v3' }, { version_id: 'v2' }]
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          workflow_id: 'workflows/active.json',
          rolled_back_to_version_id: 'v2',
          current_version_id: 'v2',
          versions: [{ version_id: 'v2' }, { version_id: 'v3' }]
        })
      )

    const switchResponse = await switchWorkflowVersion(
      'workflows/active.json',
      'v3'
    )
    const rollbackResponse = await rollbackWorkflowVersion(
      'workflows/active.json',
      'v2'
    )

    expect(mockFetchApi).toHaveBeenNthCalledWith(
      1,
      '/v1/workflows/workflows%2Factive.json/versions/v3/switch',
      expect.objectContaining({
        method: 'POST'
      })
    )
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      2,
      '/v1/workflows/workflows%2Factive.json/versions/v2/rollback',
      expect.objectContaining({
        method: 'POST'
      })
    )
    expect(switchResponse.switched_to_version_id).toBe('v3')
    expect(rollbackResponse.rolled_back_to_version_id).toBe('v2')
  })
})

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

  it('uses chat endpoint and forwards canvas revision headers for user messages', async () => {
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
          session: {
            session_id: 'session-10b',
            workspace_id: 'ws-comfyui-canvas',
            messages: [
              { message_id: 'u-1', role: 'user', text: 'hello canvas' },
              { message_id: 'a-1', role: 'agent', text: 'hello back' }
            ],
            actions: []
          },
          assistant_text: 'hello back',
          workflow: null,
          provider: 'dashscope',
          model: 'qwen-plus',
          degraded: false
        })
      )

    const store = useFluttyAgentWindowStore()
    await store.ensureSessionReady()
    await store.appendUserMessage('hello canvas')

    expect(mockFetchApi).toHaveBeenNthCalledWith(
      3,
      '/v1/agent/sessions/session-10b/chat',
      expect.objectContaining({ method: 'POST' })
    )

    const appendPayload = JSON.parse(
      String((mockFetchApi.mock.calls[2][1] as RequestInit).body)
    )
    expect(appendPayload).toMatchObject({
      user_message: 'hello canvas',
      workflow_id: 'workflows/active.json'
    })
    expect(mockFetchApi.mock.calls[2][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Flutty-Session-Workflow-Revision': '11',
          'X-Flutty-Session-Workflow-Digest': 'digest-r11'
        })
      })
    )
  })

  it('recreates session and retries chat when backend reports session_not_found', async () => {
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
        asJsonResponse(
          {
            detail: 'agent_session_not_found:session-10b'
          },
          404
        )
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10b-new',
          workspace_id: 'ws-comfyui-canvas'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session: {
            session_id: 'session-10b-new',
            workspace_id: 'ws-comfyui-canvas',
            messages: [
              {
                message_id: 'msg-after-recovery-user',
                role: 'user',
                text: 'hello after recovery'
              },
              {
                message_id: 'msg-after-recovery-agent',
                role: 'agent',
                text: 'session recovered'
              }
            ],
            actions: []
          },
          assistant_text: 'session recovered',
          workflow: null,
          provider: 'dashscope',
          model: 'qwen-plus',
          degraded: false
        })
      )

    const store = useFluttyAgentWindowStore()
    await store.ensureSessionReady()
    await store.appendUserMessage('hello after recovery')

    expect(mockFetchApi).toHaveBeenNthCalledWith(
      3,
      '/v1/agent/sessions/session-10b/chat',
      expect.objectContaining({ method: 'POST' })
    )
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      4,
      '/v1/agent/sessions',
      expect.objectContaining({ method: 'POST' })
    )
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      5,
      '/v1/agent/sessions/session-10b-new/chat',
      expect.objectContaining({ method: 'POST' })
    )
    expect(store.sessionId).toBe('session-10b-new')
    expect(store.sessionState).toBe('ready')
    expect(store.sessionError).toBeNull()
  })

  it('refreshes request context after workflow revision changes without forcing session refresh', async () => {
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
          session: {
            session_id: 'session-10b',
            workspace_id: 'ws-comfyui-canvas',
            messages: [
              {
                message_id: 'msg-r12-user',
                role: 'user',
                text: 'follow latest canvas context'
              },
              { message_id: 'msg-r12-agent', role: 'agent', text: 'ack' }
            ],
            actions: []
          },
          assistant_text: 'ack',
          workflow: null,
          provider: 'dashscope',
          model: 'qwen-plus',
          degraded: false
        })
      )

    const store = useFluttyAgentWindowStore()
    await store.ensureSessionReady()
    mockCaptureCanvasContext.mockReturnValue(buildCanvasContext(12, 'digest-r12'))
    await store.appendUserMessage('follow latest canvas context')

    expect(mockFetchApi).toHaveBeenCalledTimes(3)
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      3,
      '/v1/agent/sessions/session-10b/chat',
      expect.objectContaining({ method: 'POST' })
    )
    const appendPayload = JSON.parse(
      String((mockFetchApi.mock.calls[2][1] as RequestInit).body)
    )
    expect(appendPayload).toMatchObject({
      user_message: 'follow latest canvas context',
      workflow_id: 'workflows/active.json'
    })
    expect(mockFetchApi.mock.calls[2][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Flutty-Session-Workflow-Revision': '12',
          'X-Flutty-Session-Workflow-Digest': 'digest-r12'
        })
      })
    )
    expect(store.sessionConflict).toBeNull()
    expect(store.sessionError).toBeNull()
    expect(store.sessionState).toBe('ready')
  })

  it('hydrates next-version proposal from chat tool-plane payload when session actions are absent', async () => {
    mockFetchApi
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10g-c3-proposal',
          workspace_id: 'ws-comfyui-canvas'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10g-c3-proposal',
          workspace_id: 'ws-comfyui-canvas',
          messages: [],
          actions: []
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session: {
            session_id: 'session-10g-c3-proposal',
            workspace_id: 'ws-comfyui-canvas',
            messages: [
              {
                message_id: 'msg-tool-proposal',
                role: 'agent',
                text: 'I drafted version v3 for your review.'
              }
            ],
            actions: []
          },
          assistant_text: 'I drafted version v3 for your review.',
          workflow: null,
          provider: 'dashscope',
          model: 'qwen-plus',
          degraded: false,
          tool_plane_v0: {
            workflow_proposal: {
              action_id: 'action-tool-v3',
              proposal_id: 'proposal-v3',
              workflow_id: 'workflows/active.json',
              candidate_version_id: 'version-v3',
              base_revision: 11,
              summary: 'Improve denoise schedule and preserve seed behavior.',
              risk_level: 'medium',
              estimated_cost_band: 'medium',
              requires_confirmation: true,
              created_at: '2026-03-12T12:10:00.000Z'
            }
          }
        })
      )

    const store = useFluttyAgentWindowStore()
    await store.ensureSessionReady()
    await store.appendUserMessage('propose next workflow version')

    expect(store.nextWorkflowVersionProposal).toMatchObject({
      action_id: 'action-tool-v3',
      proposal_id: 'proposal-v3',
      candidate_version_id: 'version-v3',
      workflow_id: 'workflows/active.json'
    })
    expect(Array.isArray(store.session?.actions)).toBe(true)
    expect(store.session?.actions).toHaveLength(1)
    expect(store.session?.actions?.[0]).toMatchObject({
      action_id: 'action-tool-v3',
      status: 'proposed'
    })
  })

  it('handles workflow switch + execution loop tool-plane events and imports audit fields', async () => {
    mockFetchApi
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10g-c3-toolplane',
          workspace_id: 'ws-comfyui-canvas'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10g-c3-toolplane',
          workspace_id: 'ws-comfyui-canvas',
          messages: [],
          actions: []
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session: {
            session_id: 'session-10g-c3-toolplane',
            workspace_id: 'ws-comfyui-canvas',
            messages: [
              {
                message_id: 'msg-tool-audit',
                role: 'agent',
                text: 'Switch accepted, execution is running.',
                metadata: {
                  audit_v1: {
                    audit_id: 'audit-message-1',
                    action: 'chat_turn',
                    reason: 'tool plane emitted workflow switch',
                    risk_level: 'low',
                    requires_confirmation: false,
                    trace_ref: 'trace-chat-tool',
                    recorded_at: '2026-03-12T12:20:00.000Z'
                  }
                }
              }
            ],
            actions: [
              {
                action_id: 'action-tool-switch',
                action_type: 'workflow_patch',
                status: 'confirmed',
                execution_ref: {
                  workflow_id: 'workflows/active.json',
                  workflow_version_id: 'version-v3',
                  job_id: 'job-tool-1'
                },
                confirmation: {
                  requires_confirmation: true,
                  risk_level: 'medium'
                },
                metadata: {
                  audit: {
                    audit_event_id: 'audit-action-1',
                    action: 'workflow_switch_accept',
                    reason: 'accepted by tool-plane loop',
                    risk_level: 'medium',
                    requires_confirmation: true,
                    trace_ref: 'job-tool-1',
                    recorded_at: '2026-03-12T12:20:01.000Z'
                  }
                }
              }
            ]
          },
          assistant_text: 'Switch accepted, execution is running.',
          workflow: null,
          provider: 'dashscope',
          model: 'qwen-plus',
          degraded: false,
          tool_plane_v0: {
            workflow_switch: {
              workflow_id: 'workflows/active.json',
              switched_to_version_id: 'version-v3',
              reason: 'accept_next_workflow_version',
              recorded_at: '2026-03-12T12:20:02.000Z'
            },
            execution_loop_event: {
              job_id: 'job-tool-1',
              status: 'running',
              recorded_at: '2026-03-12T12:20:03.000Z',
              phase: 'runtime',
              message: 'execution_running',
              details: {
                source: 'langgraph-tool-plane'
              }
            },
            audit: {
              audit_id: 'audit-top-1',
              action: 'execution_status',
              reason: 'runtime moved to running',
              risk_level: 'low',
              requires_confirmation: false,
              trace_ref: 'job-tool-1',
              recorded_at: '2026-03-12T12:20:03.000Z'
            }
          }
        })
      )

    const store = useFluttyAgentWindowStore()
    await store.ensureSessionReady()
    await store.appendUserMessage('execute with current proposal')

    expect(store.currentWorkflowVersionId).toBe('version-v3')
    expect(store.activeJobId).toBe('job-tool-1')
    expect(store.activeJobStatus).toBe('running')
    expect(store.executionState).toBe('running')
    expect(store.jobInspect?.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: 'runtime',
          message: 'execution_running'
        })
      ])
    )
    expect(store.actionAuditTrail.map((entry) => entry.audit_id)).toEqual(
      expect.arrayContaining(['audit-message-1', 'audit-action-1', 'audit-top-1'])
    )
    expect(
      store.eventLog.some(
        (event) =>
          event.type === 'workflow-version-switched' &&
          event.payload?.source === 'tool-plane'
      )
    ).toBe(true)
    expect(
      store.eventLog.some(
        (event) =>
          event.type === 'job-status-observed' &&
          event.payload?.source === 'tool-plane'
      )
    ).toBe(true)
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
    expect(
      store.eventLog.some(
        (event) => event.type === 'workflow-version-candidate-accepted'
      )
    ).toBe(true)
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
    expect(
      store.eventLog.some(
        (event) => event.type === 'workflow-version-candidate-rejected'
      )
    ).toBe(true)
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

  it('runs estimate -> confirm -> submit -> status/result/inspect success loop', async () => {
    mockFetchApi
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10d-success',
          workspace_id: 'ws-comfyui-canvas'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10d-success',
          workspace_id: 'ws-comfyui-canvas',
          messages: [],
          actions: []
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          mode: 'comfy_workflow',
          workflow_id: 'workflows/active.json',
          pricing: {
            pricing_path: 'auto',
            plan_id: 'standard',
            plan_source: 'server_resolved',
            currency: 'credits',
            overage_unit_price: 1,
            concurrency_limit: 2,
            queue_tier: 'standard'
          },
          estimate: {
            billing_mode: 'payg',
            currency: 'credits',
            estimated_compute_units: 1.2,
            unit_price: 1,
            estimated_price: 1.2,
            confidence: 'medium'
          }
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          entitlement_verdict: 'allow',
          limit_reason: {
            reason_code: 'no_blocker',
            title: 'No blocking limit detected',
            detail: 'Current runtime usage fits policy limits.'
          },
          unblock_options: ['Continue'],
          path_specific_cost_explain: 'hosted credits path',
          resolved_plan_id: 'standard',
          resolved_pricing_path: 'auto'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          job_id: 'job-10d-success',
          status: 'queued',
          created_at: '2026-03-12T12:00:00.000Z',
          mode: 'comfy_workflow',
          workflow_id: 'workflows/active.json',
          pricing: {
            pricing_path: 'auto',
            plan_id: 'standard',
            plan_source: 'server_resolved',
            currency: 'credits',
            overage_unit_price: 1,
            concurrency_limit: 2,
            queue_tier: 'standard'
          }
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          job_id: 'job-10d-success',
          status: 'succeeded',
          created_at: '2026-03-12T12:00:00.000Z',
          updated_at: '2026-03-12T12:01:00.000Z'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          job_id: 'job-10d-success',
          status: 'succeeded',
          created_at: '2026-03-12T12:00:00.000Z',
          updated_at: '2026-03-12T12:01:00.000Z',
          mode: 'comfy_workflow',
          workflow_id: 'workflows/active.json',
          output_node_ids: ['7'],
          request_summary: {},
          runtime_route: {},
          timeline: [
            {
              recorded_at: '2026-03-12T12:00:40.000Z',
              phase: 'runtime',
              message: 'execution_succeeded'
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          job_id: 'job-10d-success',
          status: 'succeeded',
          created_at: '2026-03-12T12:00:00.000Z',
          updated_at: '2026-03-12T12:01:00.000Z',
          result: {
            outputs: [{ node_id: '7' }]
          }
        })
      )

    const store = useFluttyAgentWindowStore()
    await store.ensureSessionReady()

    await store.estimateComfyWorkflowExecution()
    expect(store.executionState).toBe('estimate-ready')
    expect(store.executionEstimate?.estimate.estimated_price).toBe(1.2)

    store.setExecutionConfirmationAccepted(true)
    await store.submitEstimatedExecution()

    expect(mockFetchApi).toHaveBeenNthCalledWith(
      3,
      '/v1/jobs/estimate',
      expect.objectContaining({ method: 'POST' })
    )
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      4,
      '/v1/agent/support/explain-limit',
      expect.objectContaining({ method: 'POST' })
    )
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      5,
      '/v1/jobs',
      expect.objectContaining({ method: 'POST' })
    )
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      6,
      '/v1/jobs/job-10d-success',
      expect.objectContaining({ method: 'GET' })
    )
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      7,
      '/v1/jobs/job-10d-success/inspect',
      expect.objectContaining({ method: 'GET' })
    )
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      8,
      '/v1/jobs/job-10d-success/result',
      expect.objectContaining({ method: 'GET' })
    )
    expect(store.activeJobId).toBe('job-10d-success')
    expect(store.executionState).toBe('succeeded')
    expect(store.jobInspect?.timeline).toHaveLength(1)
    expect(store.jobResult?.status).toBe('succeeded')
  })

  it('supports failed execution diagnose/review and loops back to next-version/revert', async () => {
    mockFetchApi
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10d-fail',
          workspace_id: 'ws-comfyui-canvas'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session_id: 'session-10d-fail',
          workspace_id: 'ws-comfyui-canvas',
          messages: [{ message_id: 'msg-10d-1' }],
          actions: [{ action_id: 'action-10d-1' }]
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          mode: 'comfy_workflow',
          workflow_id: 'workflows/active.json',
          pricing: {
            pricing_path: 'auto',
            plan_id: 'standard',
            plan_source: 'server_resolved',
            currency: 'credits',
            overage_unit_price: 1,
            concurrency_limit: 2,
            queue_tier: 'standard'
          },
          estimate: {
            billing_mode: 'payg',
            currency: 'credits',
            estimated_compute_units: 2.1,
            unit_price: 1,
            estimated_price: 2.1,
            confidence: 'medium'
          }
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          entitlement_verdict: 'allow',
          limit_reason: {
            reason_code: 'no_blocker',
            title: 'No blocking limit detected',
            detail: 'Current runtime usage fits policy limits.'
          },
          unblock_options: ['Continue'],
          path_specific_cost_explain: 'hosted credits path',
          resolved_plan_id: 'standard',
          resolved_pricing_path: 'auto'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          job_id: 'job-10d-fail',
          status: 'queued',
          created_at: '2026-03-12T12:00:00.000Z',
          mode: 'comfy_workflow',
          workflow_id: 'workflows/active.json',
          pricing: {
            pricing_path: 'auto',
            plan_id: 'standard',
            plan_source: 'server_resolved',
            currency: 'credits',
            overage_unit_price: 1,
            concurrency_limit: 2,
            queue_tier: 'standard'
          }
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          job_id: 'job-10d-fail',
          status: 'failed',
          created_at: '2026-03-12T12:00:00.000Z',
          updated_at: '2026-03-12T12:01:00.000Z',
          error: { code: 'execution_failed', message: 'runtime failure' }
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          job_id: 'job-10d-fail',
          status: 'failed',
          created_at: '2026-03-12T12:00:00.000Z',
          updated_at: '2026-03-12T12:01:00.000Z',
          mode: 'comfy_workflow',
          workflow_id: 'workflows/active.json',
          output_node_ids: [],
          request_summary: {},
          runtime_route: {},
          timeline: [
            {
              recorded_at: '2026-03-12T12:00:50.000Z',
              phase: 'runtime',
              message: 'execution_failed'
            }
          ],
          error: { code: 'execution_failed', message: 'runtime failure' }
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          job_id: 'job-10d-fail',
          status: 'failed',
          created_at: '2026-03-12T12:00:00.000Z',
          updated_at: '2026-03-12T12:01:00.000Z',
          result: null,
          error: { code: 'execution_failed', message: 'runtime failure' }
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          diagnosis_id: 'diag-10d',
          job_id: 'job-10d-fail',
          stage: 'runtime',
          summary: {
            title: 'Runtime timeout',
            narrative: 'Execution exceeded timeout budget.',
            impact: 'cannot_run'
          },
          root_causes: [
            {
              cause_id: 'cause-timeout',
              stage: 'runtime',
              error_code: 'DG-RUN-001',
              category: 'resource',
              hypothesis: 'Timeout exceeded',
              evidence_ref_ids: ['ev-1'],
              confidence_score: 0.8,
              blocking: true
            }
          ],
          suggested_fixes: [
            {
              fix_id: 'fix-retry',
              cause_ids: ['cause-timeout'],
              fix_kind: 'retry',
              patchable: false,
              requires_confirmation: false,
              risk_level: 'medium',
              steps: ['retry with lower load'],
              expected_effect: 'runtime success'
            }
          ],
          confidence: {
            overall_score: 0.8,
            signal_coverage: 'high',
            conflict_count: 0
          },
          risk: {
            level: 'medium',
            dimensions: ['latency'],
            destructive_change: false,
            requires_confirmation: false
          },
          evidence_refs: [{ ref_id: 'ev-1', source: 'inspect', signal: 'timeout' }],
          patch_handoff: {
            handoff_version: 'debug_patch_handoff.v1',
            source_diagnosis_id: 'diag-10d',
            source_job_id: 'job-10d-fail',
            target_workflow_version_id: 'version-v1',
            patch_intents: [
              {
                cause_id: 'cause-timeout',
                source_fix_id: 'fix-retry',
                operations_hint: ['retry']
              }
            ],
            confirmation: {
              risk_level: 'medium',
              requires_confirmation: false
            },
            confidence_score: 0.8,
            evidence_refs: [{ ref_id: 'ev-1', source: 'inspect', signal: 'timeout' }]
          },
          generated_at: '2026-03-12T12:02:00.000Z'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session: {
            session_id: 'session-10d-fail',
            workspace_id: 'ws-comfyui-canvas',
            messages: [{ message_id: 'msg-10d-next' }],
            actions: [buildNextVersionAction('proposed')]
          },
          assistant_text: 'proposed next version',
          workflow: null,
          provider: 'dashscope',
          model: 'qwen-plus',
          degraded: false
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          review_id: 'review-10d',
          status: 'completed',
          quality_findings: [
            {
              finding_id: 'finding-1',
              category: 'runtime',
              severity: 'medium',
              summary: 'One runtime quality concern found.',
              evidence_ref_ids: ['job-10d-fail-timeline'],
              confidence: 0.6
            }
          ],
          probable_causes: [],
          recommended_actions: [
            {
              recommendation_id: 'rec-1',
              action_kind: 'revert',
              rationale: 'Revert to known stable version.',
              linked_finding_ids: ['finding-1'],
              linked_cause_ids: [],
              risk_level: 'medium',
              requires_confirmation: true
            }
          ],
          version_assistant_hints: [],
          trace: {
            trace_id: 'trace-review-10d',
            session_id: 'session-10d-fail',
            message_id: 'msg-10d-1',
            source_action_id: 'action-10d-1',
            workspace_id: 'ws-comfyui-canvas',
            resolved_ref_ids: ['job-10d-fail-timeline'],
            rejected_refs: [],
            review_model_ref: 'multimodal-review-v1'
          },
          generated_at: '2026-03-12T12:03:00.000Z'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          review_id: 'review-10d',
          status: 'completed',
          quality_findings: [
            {
              finding_id: 'finding-1',
              category: 'runtime',
              severity: 'medium',
              summary: 'One runtime quality concern found.',
              evidence_ref_ids: ['job-10d-fail-timeline'],
              confidence: 0.6
            }
          ],
          probable_causes: [],
          recommended_actions: [
            {
              recommendation_id: 'rec-1',
              action_kind: 'revert',
              rationale: 'Revert to known stable version.',
              linked_finding_ids: ['finding-1'],
              linked_cause_ids: [],
              risk_level: 'medium',
              requires_confirmation: true
            }
          ],
          version_assistant_hints: [],
          trace: {
            trace_id: 'trace-review-10d',
            session_id: 'session-10d-fail',
            message_id: 'msg-10d-1',
            source_action_id: 'action-10d-1',
            workspace_id: 'ws-comfyui-canvas',
            resolved_ref_ids: ['job-10d-fail-timeline'],
            rejected_refs: [],
            review_model_ref: 'multimodal-review-v1'
          },
          generated_at: '2026-03-12T12:03:00.000Z'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          session: {
            session_id: 'session-10d-fail',
            workspace_id: 'ws-comfyui-canvas',
            messages: [{ message_id: 'msg-10d-next-2' }],
            actions: [buildNextVersionAction('proposed')]
          },
          assistant_text: 'proposed next version again',
          workflow: null,
          provider: 'dashscope',
          model: 'qwen-plus',
          degraded: false
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
    await store.estimateComfyWorkflowExecution()
    store.setExecutionConfirmationAccepted(true)
    await store.submitEstimatedExecution()
    await store.diagnoseFailedExecution()
    await store.requestNextVersionProposalFromDiagnosis()
    await store.submitExecutionReview()
    await store.requestNextVersionProposalFromReview()
    store.setActionConfirmationReason('review recommended rollback')
    await store.revertFromDiagnoseOrReview()

    expect(store.executionState).toBe('failed')
    expect(store.diagnosis?.diagnosis_id).toBe('diag-10d')
    expect(store.review?.review_id).toBe('review-10d')
    expect(store.nextWorkflowVersionProposal?.candidate_version_id).toBe('version-v2')
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      9,
      '/v1/agent/debug/diagnose',
      expect.objectContaining({ method: 'POST' })
    )
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      11,
      '/v1/agent/sessions/session-10d-fail/reviews/multimodal',
      expect.objectContaining({ method: 'POST' })
    )
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      13,
      '/v1/agent/sessions/session-10d-fail/chat',
      expect.objectContaining({ method: 'POST' })
    )
    expect(mockFetchApi).toHaveBeenNthCalledWith(
      14,
      '/v1/workflows/workflows%2Factive.json/versions/version-v1/rollback',
      expect.objectContaining({ method: 'POST' })
    )
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

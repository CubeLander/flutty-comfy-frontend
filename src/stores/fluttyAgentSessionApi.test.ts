import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AgentSessionRevisionConflictError,
  appendAgentSessionMessage,
  createAgentJob,
  diagnoseAgentExecution,
  estimateAgentJob,
  getAgentJobResult,
  getAgentJobStatus,
  getAgentMultimodalReview,
  inspectAgentJob,
  listWorkflowVersions,
  rollbackWorkflowVersion,
  submitAgentMultimodalReview,
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

  it('supports jobs + diagnose + multimodal review endpoints', async () => {
    mockFetchApi
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
            estimated_compute_units: 1.4,
            unit_price: 1,
            estimated_price: 1.4,
            confidence: 'medium'
          }
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          job_id: 'job-10d',
          status: 'queued',
          created_at: '2026-03-12T12:10:00.000Z',
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
          job_id: 'job-10d',
          status: 'failed',
          created_at: '2026-03-12T12:10:00.000Z',
          updated_at: '2026-03-12T12:11:00.000Z',
          error: { code: 'execution_failed', message: 'runtime failure' }
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          job_id: 'job-10d',
          status: 'failed',
          created_at: '2026-03-12T12:10:00.000Z',
          updated_at: '2026-03-12T12:11:00.000Z',
          mode: 'comfy_workflow',
          workflow_id: 'workflows/active.json',
          output_node_ids: [],
          request_summary: {},
          runtime_route: {},
          timeline: [
            {
              recorded_at: '2026-03-12T12:10:30.000Z',
              phase: 'runtime',
              message: 'execution_failed'
            }
          ],
          error: { code: 'execution_failed', message: 'runtime failure' }
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          job_id: 'job-10d',
          status: 'failed',
          created_at: '2026-03-12T12:10:00.000Z',
          updated_at: '2026-03-12T12:11:00.000Z',
          result: null,
          error: { code: 'execution_failed', message: 'runtime failure' }
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          diagnosis_id: 'diag-10d',
          job_id: 'job-10d',
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
            source_job_id: 'job-10d',
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
          generated_at: '2026-03-12T12:12:00.000Z'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          review_id: 'review-10d',
          status: 'completed',
          quality_findings: [],
          probable_causes: [],
          recommended_actions: [],
          version_assistant_hints: [],
          trace: {
            trace_id: 'trace-review-10d',
            session_id: 'session-10d',
            message_id: 'msg-10d',
            source_action_id: 'action-10d',
            workspace_id: 'ws-comfyui-canvas',
            resolved_ref_ids: ['job-10d-timeline'],
            rejected_refs: [],
            review_model_ref: 'multimodal-review-v1'
          },
          generated_at: '2026-03-12T12:13:00.000Z'
        })
      )
      .mockResolvedValueOnce(
        asJsonResponse({
          review_id: 'review-10d',
          status: 'completed',
          quality_findings: [],
          probable_causes: [],
          recommended_actions: [],
          version_assistant_hints: [],
          trace: {
            trace_id: 'trace-review-10d',
            session_id: 'session-10d',
            message_id: 'msg-10d',
            source_action_id: 'action-10d',
            workspace_id: 'ws-comfyui-canvas',
            resolved_ref_ids: ['job-10d-timeline'],
            rejected_refs: [],
            review_model_ref: 'multimodal-review-v1'
          },
          generated_at: '2026-03-12T12:13:00.000Z'
        })
      )

    const requestContext = {
      canvas_context_v1: {
        schema: 'canvas_context_v1' as const,
        captured_at: '2026-03-12T12:00:00.000Z',
        workflow: {
          path: 'workflows/active.json',
          revision: 18,
          digest: 'digest-r18'
        },
        selected_nodes: ['2', '5'],
        viewport: { scale: 1.1, offset: [10, -3] as [number, number] },
        workspace_id: 'ws-comfyui-canvas',
        principal_id: 'principal-10d'
      },
      session_revision_v1: {
        workflow_revision: 18,
        workflow_digest: 'digest-r18'
      }
    }

    const estimate = await estimateAgentJob(
      {
        mode: 'comfy_workflow',
        workflow_id: 'workflows/active.json'
      },
      requestContext
    )
    const accepted = await createAgentJob(
      {
        mode: 'comfy_workflow',
        workflow_id: 'workflows/active.json'
      },
      requestContext
    )
    const status = await getAgentJobStatus('job-10d', requestContext)
    const inspect = await inspectAgentJob('job-10d', requestContext)
    const result = await getAgentJobResult('job-10d', requestContext)
    const diagnosis = await diagnoseAgentExecution(
      {
        job_id: 'job-10d'
      },
      requestContext
    )
    const reviewSubmitted = await submitAgentMultimodalReview(
      'session-10d',
      {
        review_id: 'review-10d',
        session_id: 'session-10d',
        message_id: 'msg-10d',
        source_action_id: 'action-10d',
        workspace_id: 'ws-comfyui-canvas',
        refs: [
          {
            ref_id: 'job-10d-timeline',
            ref_type: 'timeline',
            workspace_id: 'ws-comfyui-canvas',
            timeline_ref: '/v1/jobs/job-10d/inspect',
            job_id: 'job-10d'
          }
        ]
      },
      requestContext
    )
    const reviewFetched = await getAgentMultimodalReview(
      'session-10d',
      'review-10d',
      requestContext
    )

    expect(mockFetchApi).toHaveBeenNthCalledWith(
      1,
      '/v1/jobs/estimate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Flutty-Canvas-Context': 'canvas_context_v1',
          'X-Flutty-Session-Workflow-Revision': '18'
        })
      })
    )
    expect(mockFetchApi).toHaveBeenCalledWith(
      '/v1/agent/sessions/session-10d/reviews/multimodal',
      expect.objectContaining({ method: 'POST' })
    )
    expect(mockFetchApi).toHaveBeenCalledWith(
      '/v1/agent/sessions/session-10d/reviews/review-10d',
      expect.objectContaining({ method: 'GET' })
    )
    expect(estimate.estimate.estimated_price).toBe(1.4)
    expect(accepted.job_id).toBe('job-10d')
    expect(status.status).toBe('failed')
    expect(inspect.timeline[0].phase).toBe('runtime')
    expect(result.status).toBe('failed')
    expect(diagnosis.diagnosis_id).toBe('diag-10d')
    expect(reviewSubmitted.review_id).toBe('review-10d')
    expect(reviewFetched.status).toBe('completed')
  })
})

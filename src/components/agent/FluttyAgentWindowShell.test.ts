import { createTestingPinia } from '@pinia/testing'
import { mount } from '@vue/test-utils'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import FluttyAgentWindowShell from '@/components/agent/FluttyAgentWindowShell.vue'
import { useFluttyAgentWindowStore } from '@/stores/fluttyAgentWindowStore'

describe('FluttyAgentWindowShell', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
  })

  it('renders conversation shell and supports collapse/close toggles', async () => {
    const pinia = createTestingPinia({ stubActions: false })
    const store = useFluttyAgentWindowStore(pinia)
    store.isOpen = true

    const wrapper = mount(FluttyAgentWindowShell, {
      global: { plugins: [pinia] }
    })

    await nextTick()

    expect(wrapper.find('[data-testid="flutty-agent-window"]').exists()).toBe(
      true
    )
    expect(
      wrapper.find('[data-testid="flutty-agent-session-section"]').exists()
    ).toBe(true)
    expect(
      wrapper.find('[data-testid="flutty-agent-chat-history"]').exists()
    ).toBe(true)
    expect(
      wrapper.find('[data-testid="flutty-agent-message-input"]').exists()
    ).toBe(true)

    await wrapper.find('[data-testid="flutty-agent-collapse"]').trigger('click')
    expect(store.isCollapsed).toBe(true)
    expect(wrapper.find('[data-testid="flutty-agent-body"]').exists()).toBe(
      false
    )

    await wrapper.find('[data-testid="flutty-agent-close"]').trigger('click')
    expect(store.isOpen).toBe(false)
  })

  it('renders next-version candidate card from session actions', async () => {
    const pinia = createTestingPinia({ stubActions: false })
    const store = useFluttyAgentWindowStore(pinia)
    store.isOpen = true
    store.sessionId = 'session-10c'
    store.session = {
      session_id: 'session-10c',
      actions: [
        {
          action_id: 'action-next',
          action_type: 'workflow_patch',
          status: 'proposed',
          title: 'Apply candidate',
          description: 'Adopt next version candidate',
          confirmation: {
            requires_confirmation: true,
            risk_level: 'low'
          },
          metadata: {
            next_workflow_version_v1: {
              proposal_id: 'proposal-1',
              candidate_version_id: 'version-v2',
              base_revision: 11,
              summary: 'Switch to version-v2'
            }
          }
        }
      ]
    }

    const wrapper = mount(FluttyAgentWindowShell, {
      global: { plugins: [pinia] }
    })

    await nextTick()

    expect(
      wrapper.find('[data-testid="flutty-agent-next-version-card"]').exists()
    ).toBe(true)
    expect(wrapper.text()).toContain('version-v2')
  })

  it('renders execution loop controls inside execution panel modal', async () => {
    const pinia = createTestingPinia({ stubActions: false })
    const store = useFluttyAgentWindowStore(pinia)
    store.isOpen = true
    store.sessionId = 'session-10d'
    store.executionState = 'failed'
    store.executionEstimate = {
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
    }
    store.executionConfirmationAccepted = true
    store.activeJobId = 'job-10d'
    store.activeJobStatus = 'failed'
    store.diagnosis = {
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
          cause_id: 'cause-1',
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
          fix_id: 'fix-1',
          cause_ids: ['cause-1'],
          fix_kind: 'retry',
          patchable: false,
          requires_confirmation: false,
          risk_level: 'medium',
          steps: ['retry'],
          expected_effect: 'success'
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
            cause_id: 'cause-1',
            source_fix_id: 'fix-1',
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
      generated_at: '2026-03-12T12:00:00.000Z'
    }
    store.review = {
      review_id: 'review-10d',
      status: 'completed',
      quality_findings: [
        {
          finding_id: 'finding-1',
          category: 'runtime',
          severity: 'medium',
          summary: 'One runtime quality concern found.',
          evidence_ref_ids: ['job-10d-timeline'],
          confidence: 0.6
        }
      ],
      probable_causes: [],
      recommended_actions: [],
      version_assistant_hints: [],
      trace: {
        trace_id: 'trace-review',
        session_id: 'session-10d',
        message_id: 'msg-10d',
        source_action_id: 'action-10d',
        workspace_id: 'ws-comfyui-canvas',
        resolved_ref_ids: ['job-10d-timeline'],
        rejected_refs: [],
        review_model_ref: 'multimodal-review-v1'
      },
      generated_at: '2026-03-12T12:00:00.000Z'
    }

    const wrapper = mount(FluttyAgentWindowShell, {
      global: { plugins: [pinia] }
    })

    await nextTick()
    await wrapper
      .find('[data-testid="flutty-agent-open-execution-panel"]')
      .trigger('click')
    await nextTick()

    expect(
      wrapper.find('[data-testid="flutty-agent-execution-estimate"]').exists()
    ).toBe(true)
    expect(wrapper.find('[data-testid="flutty-agent-execution-submit"]').exists()).toBe(
      true
    )
    expect(wrapper.find('[data-testid="flutty-agent-diagnosis-card"]').exists()).toBe(
      true
    )
    expect(wrapper.find('[data-testid="flutty-agent-review-card"]').exists()).toBe(
      true
    )
    expect(wrapper.find('[data-testid="flutty-agent-diagnosis-revert"]').exists()).toBe(
      true
    )
  })

  it('shows optimistic user bubble and thinking indicator while waiting for chat response', async () => {
    const pinia = createTestingPinia({ stubActions: false })
    const store = useFluttyAgentWindowStore(pinia)
    store.isOpen = true
    store.sessionState = 'ready'

    let releaseChatRequest: () => void = () => {}
    const chatPending = new Promise<void>((resolve) => {
      releaseChatRequest = () => resolve()
    })

    vi.spyOn(store, 'appendUserMessage').mockImplementation(async () => {
      store.sessionState = 'loading'
      await chatPending
      store.sessionState = 'ready'
      return {
        session_id: 'session-optimistic'
      } as never
    })

    const wrapper = mount(FluttyAgentWindowShell, {
      global: { plugins: [pinia] }
    })

    await nextTick()
    await wrapper.find('[data-testid="flutty-agent-message-input"]').setValue('hello')
    await wrapper.find('[data-testid="flutty-agent-message-send"]').trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('hello')
    expect(
      wrapper.find('[data-testid="flutty-agent-thinking-indicator"]').exists()
    ).toBe(true)
    expect(
      (
        wrapper.find('[data-testid="flutty-agent-message-input"]')
          .element as HTMLTextAreaElement
      ).value
    ).toBe('')

    releaseChatRequest()
    await chatPending
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="flutty-agent-thinking-indicator"]').exists()
      ).toBe(false)
    )
  })
})

import { createTestingPinia } from '@pinia/testing'
import { mount } from '@vue/test-utils'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import FluttyAgentWindowShell from '@/components/agent/FluttyAgentWindowShell.vue'
import { useFluttyAgentWindowStore } from '@/stores/fluttyAgentWindowStore'

describe('FluttyAgentWindowShell', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
  })

  it('renders sections and supports collapse/close toggles', async () => {
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
      wrapper.find('[data-testid="flutty-agent-action-section"]').exists()
    ).toBe(true)
    expect(
      wrapper.find('[data-testid="flutty-agent-execution-section"]').exists()
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
    expect(wrapper.text()).toContain('proposal-1')
  })
})

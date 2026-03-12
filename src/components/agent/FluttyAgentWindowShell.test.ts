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
})

<template>
  <SidebarIcon
    icon="pi pi-comments"
    label="Agent"
    tooltip="Toggle Agent Window"
    :selected="isAgentWindowOpen"
    @click="toggleAgentWindow"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useTelemetry } from '@/platform/telemetry'
import { useFluttyAgentWindowStore } from '@/stores/fluttyAgentWindowStore'

import SidebarIcon from './SidebarIcon.vue'

const agentWindowStore = useFluttyAgentWindowStore()
const isAgentWindowOpen = computed(() => agentWindowStore.isOpen)

const toggleAgentWindow = () => {
  useTelemetry()?.trackUiButtonClicked({
    button_id: 'sidebar_agent_window_toggled'
  })
  void agentWindowStore.toggleWindow()
}
</script>

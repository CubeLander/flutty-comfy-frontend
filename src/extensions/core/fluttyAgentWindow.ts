import { useExtensionService } from '@/services/extensionService'
import { useFluttyAgentWindowStore } from '@/stores/fluttyAgentWindowStore'
import type { ActionBarButton } from '@/types/comfy'

const toggleAgentWindow = async () => {
  await useFluttyAgentWindowStore().toggleWindow()
}

const actionBarButtons: ActionBarButton[] = [
  {
    icon: 'pi pi-comments',
    label: 'Agent',
    tooltip: 'Toggle Flutty Agent Window',
    onClick: () => {
      void toggleAgentWindow()
    }
  }
]

useExtensionService().registerExtension({
  name: 'Flutty.CanvasAgentWindow',
  actionBarButtons,
  commands: [
    {
      id: 'Flutty.AgentWindow.Toggle',
      label: 'Toggle Agent Window',
      icon: 'pi pi-comments',
      function: () => toggleAgentWindow(),
      active: () => useFluttyAgentWindowStore().isOpen
    },
    {
      id: 'Flutty.AgentWindow.Close',
      label: 'Close Agent Window',
      icon: 'pi pi-times',
      function: () => {
        useFluttyAgentWindowStore().closeWindow()
      }
    },
    {
      id: 'Flutty.AgentWindow.BringToFront',
      label: 'Bring Agent Window To Front',
      icon: 'pi pi-window-maximize',
      function: () => {
        const store = useFluttyAgentWindowStore()
        store.bringToFront()
        if (!store.isOpen) {
          void store.openWindow()
        }
      }
    }
  ]
})

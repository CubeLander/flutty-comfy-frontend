<template>
  <div
    v-if="isOpen"
    class="pointer-events-none absolute inset-0"
    data-testid="flutty-agent-window-root"
  >
    <section
      ref="windowRef"
      class="pointer-events-auto absolute w-[420px] max-w-[calc(100%-12px)] overflow-hidden rounded-lg border border-interface-stroke bg-comfy-menu-bg text-sm shadow-xl"
      :style="windowStyle"
      data-testid="flutty-agent-window"
      @pointerdown="bringToFront"
    >
      <header
        class="flex cursor-move items-center justify-between border-b border-interface-stroke bg-comfy-input-bg px-3 py-2"
        data-testid="flutty-agent-window-header"
        @pointerdown="startDrag"
      >
        <div class="flex items-center gap-2 text-xs font-semibold">
          <i class="pi pi-comments" />
          <span>Flutty Agent</span>
          <span class="rounded bg-black/10 px-1.5 py-0.5 font-medium">
            {{ stateLabel }}
          </span>
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="rounded p-1 hover:bg-black/10"
            :aria-label="isPinned ? 'Unpin window' : 'Pin window'"
            :title="isPinned ? '取消置顶' : '置顶'"
            data-testid="flutty-agent-pin"
            @click.stop="togglePinned"
          >
            <i class="pi pi-thumbtack" />
          </button>
          <button
            type="button"
            class="rounded p-1 hover:bg-black/10"
            :aria-label="isCollapsed ? 'Expand window' : 'Collapse window'"
            :title="isCollapsed ? '展开' : '收起'"
            data-testid="flutty-agent-collapse"
            @click.stop="toggleCollapsed"
          >
            <i :class="isCollapsed ? 'pi pi-angle-down' : 'pi pi-minus'" />
          </button>
          <button
            type="button"
            class="rounded p-1 hover:bg-black/10"
            aria-label="Close window"
            title="关闭"
            data-testid="flutty-agent-close"
            @click.stop="closeWindow"
          >
            <i class="pi pi-times" />
          </button>
        </div>
      </header>

      <div
        v-if="!isCollapsed"
        class="grid h-[460px] grid-rows-[minmax(0,1fr)_auto] gap-2"
        data-testid="flutty-agent-body"
      >
        <div class="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,0.9fr)] gap-2 p-3">
          <section
            class="min-h-0 overflow-auto rounded border border-interface-stroke bg-white/30 p-2"
            data-testid="flutty-agent-session-section"
          >
            <div class="mb-2 text-xs font-semibold uppercase tracking-wide">
              会话区 Session
            </div>
            <div class="space-y-1 text-xs">
              <div>session_id: {{ sessionId ?? 'not-created' }}</div>
              <div>
                status:
                {{ sessionState }}
              </div>
              <div v-if="sessionError" class="text-red-600">
                {{ sessionError }}
              </div>
              <div v-else-if="session?.workspace_id">
                workspace_id: {{ session.workspace_id }}
              </div>
            </div>
          </section>

          <div class="grid min-h-0 grid-cols-2 gap-2">
            <section
              class="min-h-0 overflow-auto rounded border border-interface-stroke bg-white/30 p-2"
              data-testid="flutty-agent-action-section"
            >
              <div class="mb-2 text-xs font-semibold uppercase tracking-wide">
                动作区 Actions
              </div>
              <div class="text-xs text-muted-foreground">
                10a 占位：预留 action list / confirm-reject 入口。
              </div>
            </section>
            <section
              class="min-h-0 overflow-auto rounded border border-interface-stroke bg-white/30 p-2"
              data-testid="flutty-agent-execution-section"
            >
              <div class="mb-2 text-xs font-semibold uppercase tracking-wide">
                执行区 Execution
              </div>
              <div class="text-xs text-muted-foreground">
                10a 占位：预留 estimate/submit/observe 状态区。
              </div>
              <div class="mt-2 text-[11px] text-muted-foreground">
                event_bus: {{ latestEventSummary }}
              </div>
            </section>
          </div>
        </div>

        <footer
          class="flex items-center justify-end gap-2 border-t border-interface-stroke px-3 py-2"
        >
          <button
            type="button"
            class="rounded border border-interface-stroke px-2 py-1 text-xs hover:bg-black/5"
            data-testid="flutty-agent-create-session"
            @click="createNewSession"
          >
            New Session
          </button>
          <button
            type="button"
            class="rounded border border-interface-stroke px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-50"
            :disabled="!sessionId"
            data-testid="flutty-agent-refresh-session"
            @click="refreshSession"
          >
            Refresh Session
          </button>
        </footer>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, computed } from 'vue'
import { storeToRefs } from 'pinia'

import { useFluttyAgentWindowStore } from '@/stores/fluttyAgentWindowStore'

interface DragState {
  pointerId: number
  startX: number
  startY: number
  initialX: number
  initialY: number
}

const windowRef = ref<HTMLElement | null>(null)
const dragState = ref<DragState | null>(null)
const store = useFluttyAgentWindowStore()
const {
  isOpen,
  isCollapsed,
  isPinned,
  position,
  zIndex,
  sessionId,
  session,
  sessionState,
  sessionError,
  eventLog
} = storeToRefs(store)

const { bringToFront, setPosition, toggleCollapsed, togglePinned, closeWindow } =
  store

const windowStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  zIndex: zIndex.value
}))

const stateLabel = computed(() => {
  switch (sessionState.value) {
    case 'creating':
      return 'creating'
    case 'loading':
      return 'loading'
    case 'ready':
      return 'ready'
    case 'error':
      return 'error'
    default:
      return 'idle'
  }
})

const latestEventSummary = computed(() => {
  const latest = eventLog.value[0]
  if (!latest) return 'no-event'
  return `${latest.type}@${latest.at}`
})

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

function updatePosition(clientX: number, clientY: number) {
  const target = windowRef.value
  const dragging = dragState.value
  if (!target || !dragging) return

  const parent = target.offsetParent as HTMLElement | null
  const bounds = parent?.getBoundingClientRect()
  const width = target.offsetWidth
  const height = target.offsetHeight

  const minX = 8
  const minY = 8
  const maxX = Math.max(
    minX,
    (bounds?.width ?? window.innerWidth) - width - minX
  )
  const maxY = Math.max(
    minY,
    (bounds?.height ?? window.innerHeight) - height - minY
  )

  const nextX = dragging.initialX + (clientX - dragging.startX)
  const nextY = dragging.initialY + (clientY - dragging.startY)
  setPosition(clamp(nextX, minX, maxX), clamp(nextY, minY, maxY))
}

function stopDrag() {
  dragState.value = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

function onPointerMove(event: PointerEvent) {
  if (!dragState.value || event.pointerId !== dragState.value.pointerId) return
  event.preventDefault()
  updatePosition(event.clientX, event.clientY)
}

function onPointerUp(event: PointerEvent) {
  if (!dragState.value || event.pointerId !== dragState.value.pointerId) return
  stopDrag()
}

function startDrag(event: PointerEvent) {
  if (event.button !== 0) return
  if ((event.target as HTMLElement).closest('button')) return

  dragState.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    initialX: position.value.x,
    initialY: position.value.y
  }

  bringToFront()
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

async function createNewSession() {
  await store.createAndLoadSession()
}

async function refreshSession() {
  await store.fetchSession()
}

onBeforeUnmount(stopDrag)
</script>

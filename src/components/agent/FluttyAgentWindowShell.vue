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

              <div
                v-if="nextWorkflowVersionProposal"
                class="space-y-2 text-xs"
                data-testid="flutty-agent-next-version-card"
              >
                <div class="rounded border border-interface-stroke bg-white/60 p-2">
                  <div class="text-[11px] font-semibold uppercase tracking-wide">
                    下一版本候选
                  </div>
                  <div class="mt-1 font-medium">
                    {{
                      nextWorkflowVersionProposal.title ??
                      nextWorkflowVersionProposal.summary
                    }}
                  </div>
                  <div class="mt-1 text-[11px] text-muted-foreground">
                    {{ nextWorkflowVersionProposal.summary }}
                  </div>
                  <div class="mt-2 space-y-1 text-[11px]">
                    <div>
                      candidate_version:
                      {{ nextWorkflowVersionProposal.candidate_version_id }}
                    </div>
                    <div v-if="nextWorkflowVersionProposal.base_revision !== null">
                      base_revision: {{ nextWorkflowVersionProposal.base_revision }}
                    </div>
                    <div>proposal_id: {{ nextWorkflowVersionProposal.proposal_id }}</div>
                    <div v-if="nextWorkflowVersionProposal.risk_level">
                      risk: {{ nextWorkflowVersionProposal.risk_level }}
                    </div>
                    <div v-if="nextWorkflowVersionProposal.estimated_cost_band">
                      cost_band: {{ nextWorkflowVersionProposal.estimated_cost_band }}
                    </div>
                  </div>
                  <div class="mt-2 flex gap-2">
                    <button
                      type="button"
                      class="rounded border border-interface-stroke px-2 py-1 text-[11px] hover:bg-black/5 disabled:opacity-50"
                      :disabled="sessionState === 'loading'"
                      data-testid="flutty-agent-next-version-accept"
                      @click="acceptNextVersion"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      class="rounded border border-interface-stroke px-2 py-1 text-[11px] hover:bg-black/5 disabled:opacity-50"
                      :disabled="sessionState === 'loading'"
                      data-testid="flutty-agent-next-version-reject"
                      @click="rejectNextVersion"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
              <div
                v-else
                class="text-xs text-muted-foreground"
                data-testid="flutty-agent-next-version-empty"
              >
                当前无“下一版本候选”提案。
              </div>
            </section>
            <section
              class="min-h-0 overflow-auto rounded border border-interface-stroke bg-white/30 p-2"
              data-testid="flutty-agent-execution-section"
            >
              <div class="mb-2 text-xs font-semibold uppercase tracking-wide">
                执行区 Execution
              </div>
              <div class="space-y-1 text-xs" data-testid="flutty-agent-execution-summary">
                <div>workflow_id: {{ workflowId ?? 'unbound' }}</div>
                <div>execution_state: {{ executionState }}</div>
                <div>job_id: {{ activeJobId ?? 'not-submitted' }}</div>
                <div>job_status: {{ activeJobStatus ?? 'unknown' }}</div>
                <div v-if="executionError" class="text-red-600">
                  {{ executionError }}
                </div>
              </div>
              <div
                v-if="executionEstimate"
                class="mt-2 rounded border border-interface-stroke bg-white/60 p-1.5 text-[11px]"
                data-testid="flutty-agent-estimate-card"
              >
                <div>estimate_price: {{ executionEstimate.estimate.estimated_price }}</div>
                <div>currency: {{ executionEstimate.pricing.currency }}</div>
                <div>confidence: {{ executionEstimate.estimate.confidence }}</div>
              </div>
              <label
                class="mt-2 flex items-center gap-1 text-[11px]"
                data-testid="flutty-agent-execution-confirm"
              >
                <input
                  type="checkbox"
                  :checked="executionConfirmationAccepted"
                  @change="onExecutionConfirmationChange"
                />
                <span>确认提交（confirm gate）</span>
              </label>
              <div class="mt-2 flex flex-wrap gap-1 text-[11px]">
                <button
                  type="button"
                  class="rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                  data-testid="flutty-agent-execution-estimate"
                  :disabled="executionState === 'estimating' || executionState === 'submitting'"
                  @click="estimateExecution"
                >
                  Estimate
                </button>
                <button
                  type="button"
                  class="rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                  data-testid="flutty-agent-execution-submit"
                  :disabled="!canSubmitEstimatedJob || executionState === 'submitting'"
                  @click="submitExecution"
                >
                  Submit
                </button>
                <button
                  type="button"
                  class="rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                  data-testid="flutty-agent-execution-refresh"
                  :disabled="!activeJobId"
                  @click="refreshExecution"
                >
                  Refresh Status
                </button>
              </div>
              <div v-if="jobResultSummary" class="mt-2 text-[11px]">
                result: {{ jobResultSummary }}
              </div>
              <ul v-if="inspectHighlights.length > 0" class="mt-2 space-y-1 text-[11px]">
                <li
                  v-for="highlight in inspectHighlights"
                  :key="highlight.recorded_at + highlight.phase"
                  class="rounded border border-interface-stroke bg-white/60 px-1.5 py-1"
                >
                  <div>{{ highlight.phase }} @ {{ highlight.recorded_at }}</div>
                  <div class="text-muted-foreground">{{ highlight.message }}</div>
                </li>
              </ul>

              <div class="mt-3 border-t border-interface-stroke pt-2">
                <div class="text-[11px] font-semibold uppercase tracking-wide">
                  Diagnose / Review
                </div>
                <div v-if="diagnosisError" class="mt-1 text-[11px] text-red-600">
                  {{ diagnosisError }}
                </div>
                <div v-if="reviewError" class="mt-1 text-[11px] text-red-600">
                  {{ reviewError }}
                </div>
                <div class="mt-2 flex flex-wrap gap-1 text-[11px]">
                  <button
                    type="button"
                    class="rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                    data-testid="flutty-agent-diagnose"
                    :disabled="!canDiagnoseExecution || diagnoseState === 'loading'"
                    @click="runDiagnose"
                  >
                    Diagnose
                  </button>
                  <button
                    type="button"
                    class="rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                    data-testid="flutty-agent-review-submit"
                    :disabled="!activeJobId || reviewState === 'loading'"
                    @click="submitReview"
                  >
                    Review
                  </button>
                </div>
              </div>

              <div
                v-if="diagnosis"
                class="mt-2 rounded border border-interface-stroke bg-white/60 p-1.5 text-[11px]"
                data-testid="flutty-agent-diagnosis-card"
              >
                <div class="font-medium">{{ diagnosis.summary.title }}</div>
                <div class="mt-1 text-muted-foreground">
                  {{ diagnosis.summary.narrative }}
                </div>
                <div class="mt-1">stage: {{ diagnosis.stage }}</div>
                <div class="mt-1">risk: {{ diagnosis.risk.level }}</div>
                <ul class="mt-1 space-y-1">
                  <li v-for="cause in diagnosis.root_causes.slice(0, 2)" :key="cause.cause_id">
                    {{ cause.error_code }} - {{ cause.hypothesis }}
                  </li>
                </ul>
                <div class="mt-1 flex flex-wrap gap-1">
                  <button
                    type="button"
                    class="rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                    data-testid="flutty-agent-diagnosis-next-version"
                    :disabled="sessionState === 'loading'"
                    @click="requestNextVersionFromDiagnosis"
                  >
                    Next-Version Proposal
                  </button>
                  <button
                    type="button"
                    class="rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                    data-testid="flutty-agent-diagnosis-revert"
                    :disabled="!suggestedRevertVersionId || workflowVersionState === 'loading'"
                    @click="revertFromDiagnostics"
                  >
                    Revert
                  </button>
                </div>
              </div>

              <div
                v-if="review"
                class="mt-2 rounded border border-interface-stroke bg-white/60 p-1.5 text-[11px]"
                data-testid="flutty-agent-review-card"
              >
                <div class="font-medium">review_id: {{ review.review_id }}</div>
                <div class="mt-1">status: {{ review.status }}</div>
                <div
                  v-if="review.quality_findings.length > 0"
                  class="mt-1 text-muted-foreground"
                >
                  {{ review.quality_findings[0].summary }}
                </div>
                <div class="mt-1 flex flex-wrap gap-1">
                  <button
                    type="button"
                    class="rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                    data-testid="flutty-agent-review-next-version"
                    :disabled="sessionState === 'loading'"
                    @click="requestNextVersionFromReview"
                  >
                    Next-Version Proposal
                  </button>
                  <button
                    type="button"
                    class="rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                    data-testid="flutty-agent-review-revert"
                    :disabled="!suggestedRevertVersionId || workflowVersionState === 'loading'"
                    @click="revertFromDiagnostics"
                  >
                    Revert
                  </button>
                </div>
              </div>

              <div class="mt-3 border-t border-interface-stroke pt-2 text-xs">
                <div class="mb-1 font-semibold uppercase tracking-wide">版本区 Versions</div>
                <div class="space-y-1">
                  <div>current_version: {{ currentWorkflowVersionId ?? 'unknown' }}</div>
                  <div>version_state: {{ workflowVersionState }}</div>
                </div>
                <div
                  v-if="workflowVersionError"
                  class="mt-1 text-[11px] text-red-600"
                  data-testid="flutty-agent-version-error"
                >
                  {{ workflowVersionError }}
                </div>
                <div
                  v-if="workflowVersionConflict"
                  class="mt-1 rounded border border-red-200 bg-red-50 p-1 text-[11px] text-red-700"
                  data-testid="flutty-agent-version-conflict"
                >
                  <div>code: {{ workflowVersionConflict.code }}</div>
                  <div>{{ workflowVersionConflict.retry_hint }}</div>
                </div>
                <button
                  type="button"
                  class="rounded border border-interface-stroke px-2 py-1 text-[11px] hover:bg-black/5 disabled:opacity-50"
                  :disabled="workflowVersionState === 'loading'"
                  data-testid="flutty-agent-version-refresh"
                  @click="refreshWorkflowVersions"
                >
                  Refresh Versions
                </button>
              </div>
              <ul
                class="mt-2 space-y-2 text-[11px]"
                data-testid="flutty-agent-version-history"
              >
                <li
                  v-for="version in workflowVersions"
                  :key="version.version_id"
                  class="rounded border border-interface-stroke bg-white/60 p-1.5"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="truncate">{{ version.version_id }}</span>
                    <span v-if="version.is_current" class="rounded bg-black/10 px-1 py-0.5">
                      current
                    </span>
                  </div>
                  <div v-if="version.summary" class="mt-1 text-muted-foreground">
                    {{ version.summary }}
                  </div>
                  <div class="mt-1 flex gap-1">
                    <button
                      type="button"
                      class="rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                      :disabled="
                        workflowVersionState === 'loading' ||
                        version.version_id === currentWorkflowVersionId
                      "
                      @click="switchVersion(version.version_id)"
                    >
                      Switch
                    </button>
                    <button
                      type="button"
                      class="rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                      :disabled="workflowVersionState === 'loading'"
                      @click="rollbackVersion(version.version_id)"
                    >
                      Rollback
                    </button>
                  </div>
                </li>
              </ul>
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
  nextWorkflowVersionProposal,
  workflowVersionState,
  workflowVersionError,
  workflowVersionConflict,
  workflowId,
  currentWorkflowVersionId,
  workflowVersions,
  executionState,
  executionError,
  executionEstimate,
  executionConfirmationAccepted,
  canSubmitEstimatedJob,
  activeJobId,
  activeJobStatus,
  jobResult,
  jobInspect,
  canDiagnoseExecution,
  diagnoseState,
  diagnosisError,
  diagnosis,
  reviewState,
  reviewError,
  review,
  suggestedRevertVersionId,
  eventLog
} = storeToRefs(store)

const {
  bringToFront,
  setPosition,
  toggleCollapsed,
  togglePinned,
  closeWindow,
  setExecutionConfirmationAccepted,
  estimateComfyWorkflowExecution,
  submitEstimatedExecution,
  refreshExecutionObservation,
  diagnoseFailedExecution,
  submitExecutionReview,
  requestNextVersionProposalFromDiagnosis,
  requestNextVersionProposalFromReview,
  revertFromDiagnoseOrReview
} = store

const windowStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  zIndex: zIndex.value
}))

const stateLabel = computed(() => {
  if (executionState.value === 'running') return 'running'
  if (executionState.value === 'failed') return 'failed'
  if (executionState.value === 'succeeded') return 'succeeded'

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

const jobResultSummary = computed(() => {
  if (!jobResult.value) return null
  const result = jobResult.value.result
  const resultRecord =
    result && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : null
  const outputs =
    resultRecord && Array.isArray(resultRecord.outputs)
      ? resultRecord.outputs.length
      : 0
  const images =
    resultRecord && Array.isArray(resultRecord.images)
      ? resultRecord.images.length
      : 0
  return `status=${jobResult.value.status}, outputs=${outputs}, images=${images}`
})

const inspectHighlights = computed(() => {
  if (!Array.isArray(jobInspect.value?.timeline)) return []
  return jobInspect.value.timeline.slice(-3).reverse()
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

function onExecutionConfirmationChange(event: Event) {
  const target = event.target as HTMLInputElement | null
  setExecutionConfirmationAccepted(!!target?.checked)
}

async function createNewSession() {
  await store.createAndLoadSession()
}

async function refreshSession() {
  await store.fetchSession()
}

async function acceptNextVersion() {
  await store.acceptNextWorkflowVersionCandidate()
}

async function rejectNextVersion() {
  await store.rejectNextWorkflowVersionCandidate()
}

async function estimateExecution() {
  await estimateComfyWorkflowExecution()
}

async function submitExecution() {
  await submitEstimatedExecution()
}

async function refreshExecution() {
  await refreshExecutionObservation()
}

async function runDiagnose() {
  await diagnoseFailedExecution()
}

async function submitReview() {
  await submitExecutionReview()
}

async function requestNextVersionFromDiagnosis() {
  await requestNextVersionProposalFromDiagnosis()
}

async function requestNextVersionFromReview() {
  await requestNextVersionProposalFromReview()
}

async function revertFromDiagnostics() {
  await revertFromDiagnoseOrReview()
}

async function refreshWorkflowVersions() {
  await store.refreshWorkflowVersions()
}

async function switchVersion(versionId: string) {
  await store.switchToWorkflowVersion(versionId)
}

async function rollbackVersion(versionId: string) {
  await store.rollbackToWorkflowVersion(versionId)
}

onBeforeUnmount(stopDrag)
</script>

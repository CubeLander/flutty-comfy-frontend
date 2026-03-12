<template>
  <div
    v-if="isOpen"
    class="pointer-events-none absolute inset-0"
    data-testid="flutty-agent-window-root"
  >
    <section
      ref="windowRef"
      class="pointer-events-auto absolute w-[460px] max-w-[calc(100%-12px)] overflow-hidden rounded-lg border border-interface-stroke bg-comfy-menu-bg text-sm shadow-xl"
      :style="windowStyle"
      data-testid="flutty-agent-window"
      @pointerdown="bringToFront"
    >
      <header
        class="flex cursor-move items-center justify-between border-b border-interface-stroke bg-comfy-input-bg px-3 py-2"
        data-testid="flutty-agent-window-header"
        @pointerdown="startDrag"
      >
        <div class="min-w-0 flex items-center gap-2 text-xs font-semibold text-slate-500">
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
            aria-label="Execution panel"
            title="Execution Panel"
            data-testid="flutty-agent-open-execution-panel"
            @click.stop="openExecutionPanel"
          >
            <i class="pi pi-bolt" />
          </button>
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
        class="grid h-[560px] grid-rows-[minmax(0,1fr)_auto]"
        data-testid="flutty-agent-body"
      >
        <div class="min-h-0 overflow-auto p-3">
          <div
            class="mb-2 text-[11px] tracking-wide text-slate-400"
            data-testid="flutty-agent-session-section"
          >
            {{ sessionId ? '已连接会话' : '发送第一条消息开始会话' }} · 当前工作流:
            {{ workflowId ?? 'unbound' }}
          </div>

          <div class="space-y-2" data-testid="flutty-agent-chat-history">
            <article
              v-for="item in chatMessages"
              :key="item.id"
              class="rounded border px-3 py-2 text-[13px] leading-5"
              :class="
                item.role === 'user'
                  ? 'ml-10 border-sky-200 bg-sky-100/90 text-black'
                  : item.role === 'agent'
                    ? 'mr-10 border-slate-200 bg-slate-100 text-black'
                    : 'border-slate-200 bg-slate-50 text-black'
              "
            >
              <div class="mb-1 text-[10px] uppercase tracking-wide text-black/60">
                {{
                  item.role === 'user'
                    ? 'You'
                    : item.role === 'agent'
                      ? 'Agent'
                      : 'System'
                }}
              </div>
              <div class="whitespace-pre-wrap break-words">{{ item.text }}</div>
              <button
                v-if="item.workflowVersionId"
                type="button"
                class="mt-1 text-[11px] text-blue-700 underline underline-offset-2 hover:text-blue-800"
                @click="switchVersion(item.workflowVersionId)"
              >
                切换到版本 {{ item.workflowVersionId }}
              </button>
            </article>

            <article
              v-if="isWaitingAssistantReply"
              class="mr-10 rounded border border-slate-200 bg-slate-100 px-3 py-2 text-[13px] leading-5 text-black"
              data-testid="flutty-agent-thinking-indicator"
            >
              <div class="mb-1 text-[10px] uppercase tracking-wide text-black/60">
                Agent
              </div>
              <div class="text-black/70">Thinking...</div>
            </article>

            <article
              v-if="nextWorkflowVersionProposal"
              class="rounded border border-slate-200 bg-slate-100 p-3 text-[13px] leading-5 text-black"
              data-testid="flutty-agent-next-version-card"
            >
              <div class="mt-1 font-medium">
                {{
                  nextWorkflowVersionProposal.title ??
                  nextWorkflowVersionProposal.summary
                }}
              </div>
              <div class="mt-1 text-[12px] text-black/70">
                {{ nextWorkflowVersionProposal.summary }}
              </div>
              <div class="mt-1 text-[12px]">
                candidate_version: {{ nextWorkflowVersionProposal.candidate_version_id }}
              </div>
              <div class="mt-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  class="rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                  :disabled="
                    sessionState === 'loading' ||
                    (highRiskVersionReasonRequired && isActionReasonEmpty)
                  "
                  data-testid="flutty-agent-next-version-accept"
                  @click="acceptNextVersion"
                >
                  Accept
                </button>
                <button
                  type="button"
                  class="rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                  :disabled="
                    sessionState === 'loading' ||
                    (highRiskVersionReasonRequired && isActionReasonEmpty)
                  "
                  data-testid="flutty-agent-next-version-reject"
                  @click="rejectNextVersion"
                >
                  Reject
                </button>
                <button
                  type="button"
                  class="rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                  :disabled="workflowVersionState === 'loading'"
                  @click="switchVersion(nextWorkflowVersionProposal.candidate_version_id)"
                >
                  Switch To Candidate
                </button>
              </div>
            </article>

            <article
              v-if="latestChatWorkflow"
              class="rounded border border-sky-200 bg-sky-50 p-3 text-[12px] leading-5 text-black"
              data-testid="flutty-agent-chat-workflow-draft"
            >
              <div class="font-medium">Agent Workflow 提案</div>
              <div class="mt-1 text-[11px] text-black/70">
                provider: {{ latestChatWorkflow.provider }} · model:
                {{ latestChatWorkflow.model }}
                <span v-if="latestChatWorkflow.degraded"> · degraded</span>
              </div>
              <div class="mt-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  class="rounded border border-slate-300 px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                  data-testid="flutty-agent-apply-workflow"
                  :disabled="sessionState === 'loading'"
                  @click="applyChatWorkflowToCanvas"
                >
                  应用到画布
                </button>
                <button
                  type="button"
                  class="rounded border border-slate-300 px-1.5 py-0.5 hover:bg-black/5"
                  data-testid="flutty-agent-dismiss-workflow"
                  @click="dismissChatWorkflowDraft"
                >
                  暂不应用
                </button>
              </div>
              <div v-if="workflowApplyHint" class="mt-1 text-[11px] text-black/70">
                {{ workflowApplyHint }}
              </div>
              <div v-if="workflowApplyError" class="mt-1 text-[11px] text-red-600">
                {{ workflowApplyError }}
              </div>
            </article>

            <article
              v-if="workflowVersions.length > 0"
              class="rounded border border-slate-200 bg-slate-100 p-3 text-[12px] text-black"
              data-testid="flutty-agent-version-history"
            >
              <div class="font-medium">版本切换</div>
              <div class="mt-1 flex flex-wrap gap-1">
                <button
                  v-for="version in workflowVersions.slice(0, 6)"
                  :key="version.version_id"
                  type="button"
                  class="rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                  :disabled="
                    workflowVersionState === 'loading' ||
                    version.version_id === currentWorkflowVersionId
                  "
                  @click="switchVersion(version.version_id)"
                >
                  {{ version.is_current ? 'Current' : 'Switch' }}
                  {{ version.version_id }}
                </button>
              </div>
              <div
                v-if="workflowVersionError"
                class="mt-1 text-[11px] text-red-600"
                data-testid="flutty-agent-version-error"
              >
                {{ workflowVersionError }}
              </div>
            </article>

            <article
              v-if="activeJobId"
              class="rounded border border-slate-200 bg-slate-100 p-3 text-[12px] text-slate-700"
            >
              <div class="font-medium">执行状态</div>
              <div class="mt-1">job_id: {{ activeJobId }}</div>
              <div>status: {{ activeJobStatus ?? executionState }}</div>
              <button
                type="button"
                class="mt-1 rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5"
                @click="openExecutionPanel"
              >
                打开执行弹窗
              </button>
            </article>

            <article
              v-if="sessionError"
              class="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700"
            >
              {{ sessionError }}
            </article>
          </div>
        </div>

        <footer class="border-t border-interface-stroke px-3 py-2">
          <div class="flex items-end gap-2">
            <textarea
              v-model="draftMessage"
              class="min-h-[56px] flex-1 resize-none rounded border border-interface-stroke bg-white px-2 py-1 text-[13px] leading-5 text-black"
              rows="2"
              placeholder="输入消息给 Agent（Enter 发送，Shift+Enter 换行）"
              data-testid="flutty-agent-message-input"
              @keydown="onComposerKeydown"
            />
            <div class="flex flex-col gap-1">
              <select
                v-model="selectedChatModel"
                class="rounded border border-interface-stroke bg-white px-2 py-1 text-[11px] text-black"
                data-testid="flutty-agent-model-select"
                title="选择对话模型"
              >
                <option
                  v-for="model in chatModelOptions"
                  :key="model.value"
                  :value="model.value"
                >
                  {{ model.label }}
                </option>
              </select>
              <button
                type="button"
                class="rounded border border-interface-stroke px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-50"
                data-testid="flutty-agent-message-send"
                :disabled="sendMessageDisabled"
                @click="sendMessage"
              >
                Send
              </button>
              <button
                type="button"
                class="rounded border border-interface-stroke px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-50"
                :disabled="!sessionId || sessionState === 'loading'"
                data-testid="flutty-agent-refresh-session"
                @click="refreshSession"
              >
                Refresh
              </button>
            </div>
          </div>
        </footer>
      </div>

      <div
        v-if="isExecutionPanelOpen"
        class="pointer-events-auto absolute inset-0 z-[3100] bg-black/35 p-3"
        @pointerdown.self="closeExecutionPanel"
      >
        <section class="flex h-full flex-col rounded-lg border border-interface-stroke bg-comfy-menu-bg shadow-xl">
          <header class="flex items-center justify-between border-b border-interface-stroke px-3 py-2">
            <div class="text-xs font-semibold uppercase tracking-wide">
              Execution Panel
            </div>
            <button
              type="button"
              class="rounded p-1 hover:bg-black/10"
              aria-label="Close execution panel"
              @click="closeExecutionPanel"
            >
              <i class="pi pi-times" />
            </button>
          </header>

          <div class="min-h-0 overflow-auto p-3 text-xs" data-testid="flutty-agent-execution-panel">
            <div class="space-y-1" data-testid="flutty-agent-execution-summary">
              <div>workflow_id: {{ workflowId ?? 'unbound' }}</div>
              <div>execution_state: {{ executionState }}</div>
              <div>job_id: {{ activeJobId ?? 'not-submitted' }}</div>
              <div>job_status: {{ activeJobStatus ?? 'unknown' }}</div>
              <div v-if="executionError" class="text-red-600">{{ executionError }}</div>
            </div>

            <div
              class="mt-2 rounded border border-interface-stroke bg-white/60 p-1.5 text-[11px]"
              data-testid="flutty-agent-policy-gate-card"
            >
              <div class="font-semibold uppercase tracking-wide">Policy Gate</div>
              <div class="mt-1">verdict: {{ policyGateVerdict ?? 'not-evaluated' }}</div>
              <div v-if="policyGate?.reason_title" class="mt-1">
                reason: {{ policyGate.reason_title }}
              </div>
              <div class="mt-1 text-muted-foreground">
                {{
                  policyGate?.reason_detail ??
                  'Use Explain Gate to fetch entitlement verdict and limit reason.'
                }}
              </div>
              <div v-if="policyGateError" class="mt-1 text-red-600">
                {{ policyGateError }}
              </div>
              <div
                v-if="standardizedError"
                class="mt-1 rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-amber-800"
                data-testid="flutty-agent-standardized-error"
              >
                {{ standardizedError.code }}: {{ standardizedError.detail }}
              </div>
              <button
                type="button"
                class="mt-2 rounded border border-interface-stroke px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                data-testid="flutty-agent-policy-refresh"
                :disabled="policyGateState === 'loading' || !sessionId"
                @click="refreshPolicy"
              >
                Explain Gate
              </button>
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

            <label class="mt-2 block text-[11px]" data-testid="flutty-agent-audit-reason-input">
              <span>确认理由 / 审计说明</span>
              <input
                type="text"
                class="mt-1 w-full rounded border border-interface-stroke bg-white/80 px-1.5 py-1 text-[11px]"
                :value="actionConfirmationReason"
                placeholder="高风险动作需要填写理由"
                @input="onActionReasonInput"
              />
            </label>

            <div
              v-if="
                highRiskGateReasonRequired ||
                highRiskVersionReasonRequired ||
                highRiskRevertReasonRequired
              "
              class="mt-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-[11px] text-amber-800"
              data-testid="flutty-agent-high-risk-reason-notice"
            >
              当前存在高风险动作，提交前请填写确认理由并留存审计。
            </div>

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
                :disabled="
                  !canSubmitEstimatedJob ||
                  executionState === 'submitting' ||
                  (highRiskGateReasonRequired && isActionReasonEmpty)
                "
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
                  :disabled="
                    !suggestedRevertVersionId ||
                    workflowVersionState === 'loading' ||
                    (highRiskRevertReasonRequired && isActionReasonEmpty)
                  "
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
                  :disabled="
                    !suggestedRevertVersionId ||
                    workflowVersionState === 'loading' ||
                    (highRiskRevertReasonRequired && isActionReasonEmpty)
                  "
                  @click="revertFromDiagnostics"
                >
                  Revert
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { useFluttyAgentWindowStore } from '@/stores/fluttyAgentWindowStore'

interface DragState {
  pointerId: number
  startX: number
  startY: number
  initialX: number
  initialY: number
}

interface ChatMessageView {
  id: string
  role: 'user' | 'agent' | 'system'
  text: string
  createdAt: string | null
  workflowVersionId: string | null
}

interface ChatModelOption {
  value: string
  label: string
}

const CHAT_MODEL_STORAGE_KEY = 'flutty-agent-chat-model'
const chatModelOptions: ChatModelOption[] = [
  { value: 'qwen-plus', label: 'qwen-plus (平衡)' },
  { value: 'qwen-max', label: 'qwen-max (文字质量)' },
  { value: 'qwen-turbo', label: 'qwen-turbo (响应速度)' }
]

const windowRef = ref<HTMLElement | null>(null)
const dragState = ref<DragState | null>(null)
const draftMessage = ref('')
const selectedChatModel = ref<string>(chatModelOptions[0].value)
const pendingUserMessages = ref<ChatMessageView[]>([])
const isWaitingAssistantReply = ref(false)
const isExecutionPanelOpen = ref(false)
const workflowApplyHint = ref<string | null>(null)
const workflowApplyError = ref<string | null>(null)
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
  workflowId,
  currentWorkflowVersionId,
  workflowVersions,
  latestChatWorkflow,
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
  policyGateState,
  policyGateError,
  policyGate,
  policyGateVerdict,
  standardizedError,
  actionConfirmationReason,
  highRiskGateReasonRequired,
  highRiskVersionReasonRequired,
  highRiskRevertReasonRequired,
  suggestedRevertVersionId
} = storeToRefs(store)

const {
  bringToFront,
  setPosition,
  toggleCollapsed,
  togglePinned,
  closeWindow,
  clearLatestChatWorkflow,
  setExecutionConfirmationAccepted,
  setActionConfirmationReason,
  refreshPolicyGate,
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

const committedChatMessages = computed<ChatMessageView[]>(() => {
  if (!Array.isArray(session.value?.messages)) return []

  return session.value.messages
    .map((entry, index) => {
      const message = asRecord(entry)
      if (!message) return null

      const roleRaw = asString(message.role)?.toLowerCase()
      const role: ChatMessageView['role'] =
        roleRaw === 'user' || roleRaw === 'system' ? roleRaw : 'agent'

      const content = message.content
      const contentText = Array.isArray(content)
        ? content
            .map((part) => asString(asRecord(part)?.text))
            .filter((part): part is string => !!part)
            .join('\n')
        : null
      const text =
        asString(message.text) ??
        asString(message.message) ??
        asString(content) ??
        contentText ??
        '[structured message]'

      const metadata = asRecord(message.metadata)
      const workflowVersionId =
        asString(metadata?.workflow_version_id) ??
        asString(metadata?.target_workflow_version_id)

      return {
        id:
          asString(message.message_id) ??
          asString(message.id) ??
          `message-${index}`,
        role,
        text,
        createdAt: asString(message.created_at),
        workflowVersionId
      }
    })
    .filter((message): message is ChatMessageView => message !== null)
    .slice(-60)
})

const chatMessages = computed<ChatMessageView[]>(() =>
  [...committedChatMessages.value, ...pendingUserMessages.value].slice(-60)
)

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

const isActionReasonEmpty = computed(
  () => actionConfirmationReason.value.trim().length === 0
)

const sendMessageDisabled = computed(
  () =>
    draftMessage.value.trim().length === 0 ||
    sessionState.value === 'loading' ||
    isWaitingAssistantReply.value
)

if (typeof window !== 'undefined') {
  try {
    const savedChatModel = window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY)
    if (savedChatModel) {
      selectedChatModel.value = savedChatModel
    }
  } catch {
    // Ignore persistence read failure.
  }
}

watch(selectedChatModel, (model) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CHAT_MODEL_STORAGE_KEY, model)
  } catch {
    // Ignore persistence write failure.
  }
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
  const maxX = Math.max(minX, (bounds?.width ?? window.innerWidth) - width - minX)
  const maxY = Math.max(minY, (bounds?.height ?? window.innerHeight) - height - minY)

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

function onActionReasonInput(event: Event) {
  const target = event.target as HTMLInputElement | null
  setActionConfirmationReason(target?.value ?? '')
}

function openExecutionPanel() {
  isExecutionPanelOpen.value = true
}

function closeExecutionPanel() {
  isExecutionPanelOpen.value = false
}

async function captureCurrentWorkflowSnapshot() {
  try {
    const { app } = await import('@/scripts/app')
    const serialized = app.rootGraph?.serialize?.()
    if (!serialized || typeof serialized !== 'object' || Array.isArray(serialized)) {
      return null
    }
    return serialized as unknown as Record<string, unknown>
  } catch {
    return null
  }
}

async function sendMessage() {
  const text = draftMessage.value.trim()
  if (!text || isWaitingAssistantReply.value) return
  workflowApplyHint.value = null
  workflowApplyError.value = null
  draftMessage.value = ''
  const pendingId = `pending-user-${Date.now()}`
  pendingUserMessages.value = [
    ...pendingUserMessages.value,
    {
      id: pendingId,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
      workflowVersionId: null
    }
  ]
  isWaitingAssistantReply.value = true
  try {
    const workflow = await captureCurrentWorkflowSnapshot()
    await store.appendUserMessage(text, {
      workflow,
      model: selectedChatModel.value.trim() || null
    })
  } catch {
    draftMessage.value = text
  } finally {
    pendingUserMessages.value = pendingUserMessages.value.filter(
      (message) => message.id !== pendingId
    )
    isWaitingAssistantReply.value = false
  }
}

function onComposerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  if (sendMessageDisabled.value) return
  void sendMessage()
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

async function refreshPolicy() {
  await refreshPolicyGate()
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

async function switchVersion(versionId: string) {
  await store.switchToWorkflowVersion(versionId)
}

async function applyChatWorkflowToCanvas() {
  const draft = latestChatWorkflow.value
  if (!draft) return
  workflowApplyHint.value = null
  workflowApplyError.value = null
  try {
    const { app } = await import('@/scripts/app')
    await app.loadGraphData(
      draft.workflow as never,
      true,
      true,
      workflowId.value ?? null
    )
    workflowApplyHint.value = '已应用 workflow 到当前画布。'
    clearLatestChatWorkflow()
  } catch (error) {
    workflowApplyError.value =
      error instanceof Error
        ? `应用 workflow 失败: ${error.message}`
        : '应用 workflow 失败。'
  }
}

function dismissChatWorkflowDraft() {
  workflowApplyHint.value = null
  workflowApplyError.value = null
  clearLatestChatWorkflow()
}

onBeforeUnmount(stopDrag)
</script>

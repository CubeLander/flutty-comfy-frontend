import { storeToRefs } from 'pinia'

import { useCurrentUser } from '@/composables/auth/useCurrentUser'
import {
  useWorkflowStore,
  type LoadedComfyWorkflow
} from '@/platform/workflow/management/stores/workflowStore'
import { fnv1a } from '@/platform/workflow/persistence/base/hashUtil'
import { useTeamWorkspaceStore } from '@/platform/workspace/stores/teamWorkspaceStore'
import { useCanvasStore } from '@/renderer/core/canvas/canvasStore'
import { app } from '@/scripts/app'

export interface CanvasViewportV1 {
  scale: number
  offset: [number, number]
}

export interface CanvasWorkflowContextV1 {
  path: string | null
  revision: number | null
  digest: string | null
}

export interface CanvasContextV1 {
  schema: 'canvas_context_v1'
  captured_at: string
  workflow: CanvasWorkflowContextV1
  selected_nodes: string[]
  viewport: CanvasViewportV1 | null
  workspace_id: string | null
  principal_id: string | null
}

export interface AgentSessionRevisionBindingV1 {
  workflow_revision: number | null
  workflow_digest: string | null
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null'

  const valueType = typeof value
  if (valueType === 'number' || valueType === 'boolean') {
    return JSON.stringify(value)
  }
  if (valueType === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (valueType === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    const body = entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')
    return `{${body}}`
  }

  return JSON.stringify(String(value))
}

function computeWorkflowDigest(snapshot: unknown): string | null {
  if (!snapshot) return null
  const canonical = stableStringify(snapshot)
  return fnv1a(canonical).toString(16).padStart(8, '0')
}

function resolveWorkflowSnapshot(
  activeWorkflow: LoadedComfyWorkflow | null
): unknown | null {
  if (activeWorkflow?.activeState) {
    return activeWorkflow.activeState
  }

  try {
    return app.rootGraph?.serialize() ?? null
  } catch {
    return null
  }
}

function readWorkflowRevision(snapshot: unknown): number | null {
  if (
    snapshot &&
    typeof snapshot === 'object' &&
    'revision' in snapshot &&
    typeof (snapshot as { revision?: unknown }).revision === 'number'
  ) {
    return (snapshot as { revision: number }).revision
  }

  const graphRevision = app.graph?.revision
  return typeof graphRevision === 'number' ? graphRevision : null
}

function resolveViewport(): CanvasViewportV1 | null {
  const ds = app.canvas?.ds
  if (!ds) return null

  return {
    scale: ds.scale,
    offset: [ds.offset[0], ds.offset[1]]
  }
}

export function toSessionRevisionBinding(
  context: CanvasContextV1 | null
): AgentSessionRevisionBindingV1 | null {
  if (!context) return null
  return {
    workflow_revision: context.workflow.revision,
    workflow_digest: context.workflow.digest
  }
}

export function useFluttyCanvasContextV1() {
  const workflowStore = useWorkflowStore()
  const canvasStore = useCanvasStore()
  const workspaceStore = useTeamWorkspaceStore()
  const { selectedNodeIds } = storeToRefs(canvasStore)
  const { workspaceId } = storeToRefs(workspaceStore)

  function resolvePrincipalId(): string | null {
    try {
      const { resolvedUserInfo } = useCurrentUser()
      return resolvedUserInfo.value?.id ?? null
    } catch {
      // In tests or non-app contexts, auth injection may be unavailable.
      return null
    }
  }

  function captureCanvasContextV1(): CanvasContextV1 {
    const activeWorkflow = workflowStore.activeWorkflow
    const workflowSnapshot = resolveWorkflowSnapshot(activeWorkflow)
    const revision = readWorkflowRevision(workflowSnapshot)

    return {
      schema: 'canvas_context_v1',
      captured_at: new Date().toISOString(),
      workflow: {
        path: activeWorkflow?.path ?? null,
        revision,
        digest: computeWorkflowDigest(workflowSnapshot)
      },
      selected_nodes: Array.from(selectedNodeIds.value).sort(),
      viewport: resolveViewport(),
      workspace_id: workspaceId.value,
      principal_id: resolvePrincipalId()
    }
  }

  return {
    captureCanvasContextV1
  }
}

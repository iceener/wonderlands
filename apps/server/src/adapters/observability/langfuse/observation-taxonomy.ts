export type LangfuseObservationType =
  | 'event'
  | 'span'
  | 'generation'
  | 'agent'
  | 'tool'
  | 'chain'
  | 'retriever'
  | 'evaluator'
  | 'embedding'
  | 'guardrail'

/**
 * Canonical Langfuse observation taxonomy for runtime-exported traces.
 * Keep this explicit so new runtime events map deliberately instead of drifting
 * via ad hoc `asType` literals in the exporter.
 */
export const LANGFUSE_OBSERVATION_TAXONOMY = {
  current: {
    childRun: {
      asType: 'agent',
      sourceEvents: ['run.created', 'run.completed', 'run.failed', 'run.waiting'],
      stage: 'child_run',
    },
    reasoningSummary: {
      asType: 'event',
      sourceEvents: ['reasoning.summary.done'],
      stage: 'reasoning_summary',
    },
    rootRun: {
      asType: 'agent',
      sourceEvents: ['run.created', 'run.completed', 'run.failed', 'run.waiting'],
      stage: 'root_run',
    },
    toolCall: {
      asType: 'tool',
      sourceEvents: ['tool.called', 'tool.completed', 'tool.failed'],
      stage: 'tool_call',
    },
    turnGeneration: {
      asType: 'generation',
      sourceEvents: [
        'turn.started',
        'generation.started',
        'generation.completed',
        'generation.failed',
      ],
      stage: 'turn_generation',
    },
    webSearch: {
      asType: 'retriever',
      sourceEvents: ['web_search.progress'],
      stage: 'web_search',
    },
  },
  future: {
    chain: {
      asType: 'chain',
      reservedFor: ['context_handoff', 'pipeline_transform'],
      stage: 'future_chain',
    },
    embedding: {
      asType: 'embedding',
      reservedFor: ['embedding_generation'],
      stage: 'future_embedding',
    },
    evaluation: {
      asType: 'evaluator',
      reservedFor: ['response_eval', 'judge_eval'],
      stage: 'future_evaluation',
    },
    guardrail: {
      asType: 'guardrail',
      reservedFor: ['safety_check', 'moderation_check'],
      stage: 'future_guardrail',
    },
    retrieval: {
      asType: 'retriever',
      reservedFor: ['knowledge_retrieval', 'vector_search'],
      stage: 'future_retrieval',
    },
  },
} as const satisfies {
  current: Record<
    string,
    {
      asType: LangfuseObservationType
      sourceEvents: readonly string[]
      stage: string
    }
  >
  future: Record<
    string,
    {
      asType: LangfuseObservationType
      reservedFor: readonly string[]
      stage: string
    }
  >
}

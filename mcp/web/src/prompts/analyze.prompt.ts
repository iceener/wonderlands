/**
 * Analyze Prompt with Autocompletion
 *
 * Demonstrates the completable() wrapper for argument autocompletion.
 * When clients request completion, the callback provides suggestions.
 */

import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import type { GetPromptResult, PromptMessage } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { HandlerExtra } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Available analysis topics for autocompletion.
 */
const ANALYSIS_TOPICS = [
  'performance',
  'security',
  'accessibility',
  'code-quality',
  'architecture',
  'testing',
  'documentation',
  'dependencies',
];

/**
 * Available depth levels.
 */
const DEPTH_LEVELS = ['quick', 'standard', 'deep'] as const;

/**
 * Find topics matching a prefix.
 */
function findMatchingTopics(prefix: string): string[] {
  const lower = prefix.toLowerCase();
  return ANALYSIS_TOPICS.filter((topic) => topic.toLowerCase().startsWith(lower));
}

/**
 * Argument schema with completable topic field.
 *
 * The completable() wrapper enables autocompletion for the 'topic' argument.
 * When a client requests completion, it will receive matching suggestions.
 */
export const analyzeArgsSchema = {
  topic: completable(
    z.string().min(1).describe('Analysis topic (e.g., performance, security, accessibility)'),
    async (value: string) => {
      // Return matching topics for autocompletion
      return findMatchingTopics(value);
    },
  ),
  depth: z
    .enum(DEPTH_LEVELS)
    .optional()
    .default('standard')
    .describe('Analysis depth: quick, standard, or deep'),
  includeRecommendations: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include actionable recommendations'),
};

/**
 * Validated args type (extract from the completable schema).
 */
interface AnalyzeArgs {
  topic: string;
  depth: (typeof DEPTH_LEVELS)[number];
  includeRecommendations: boolean;
}

/**
 * Validate the analyze arguments.
 */
function validateArgs(args: unknown): AnalyzeArgs {
  const schema = z.object({
    topic: z.string().min(1),
    depth: z.enum(DEPTH_LEVELS).default('standard'),
    includeRecommendations: z.boolean().default(true),
  });

  const result = schema.safeParse(args);
  if (!result.success) {
    throw new Error(`Invalid arguments: ${result.error.errors.map((e) => e.message).join(', ')}`);
  }

  return result.data;
}

/**
 * Analyze prompt definition.
 */
export const analyzePrompt = {
  name: 'analyze',
  description: `Generate an analysis prompt for a specific topic.

Available topics: ${ANALYSIS_TOPICS.join(', ')}

Parameters:
- topic: What to analyze (with autocompletion)
- depth: How thorough the analysis should be
- includeRecommendations: Whether to include action items

The prompt will guide the assistant to perform a structured analysis.`,

  argsSchema: analyzeArgsSchema,

  /**
   * Generate analysis prompt messages.
   */
  handler: async (args: unknown, _extra: HandlerExtra): Promise<GetPromptResult> => {
    const { topic, depth, includeRecommendations } = validateArgs(args);

    logger.info('analyze', { message: 'Generating analysis prompt', topic, depth });

    const depthInstructions = {
      quick: 'Provide a brief overview focusing on the most critical points.',
      standard: 'Provide a balanced analysis covering key areas with some detail.',
      deep: 'Provide an in-depth analysis exploring all aspects thoroughly.',
    };

    const recommendationsClause = includeRecommendations
      ? '\n\nInclude specific, actionable recommendations prioritized by impact.'
      : '';

    const messages: PromptMessage[] = [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Please analyze the following topic: **${topic}**

${depthInstructions[depth]}

Structure your analysis with:
1. Current state assessment
2. Key findings
3. Areas of concern
4. Opportunities for improvement${recommendationsClause}`,
        },
      },
    ];

    return {
      description: `${depth} analysis of ${topic}`,
      messages,
    };
  },
};

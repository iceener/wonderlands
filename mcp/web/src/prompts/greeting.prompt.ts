import type { GetPromptResult, PromptMessage } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { promptsMetadata } from '../config/metadata.js';
import type { HandlerExtra } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Greeting Prompt
 *
 * A simple demonstration prompt that generates personalized greetings.
 */

export const greetingArgsSchema = z
  .object({
    name: z.string().min(1).describe('Name to greet'),
    style: z
      .enum(['formal', 'casual', 'enthusiastic'])
      .optional()
      .default('casual')
      .describe('Greeting style'),
  })
  .strict();

export type GreetingArgs = z.infer<typeof greetingArgsSchema>;

const greetings = {
  formal: (name: string) => `Good day, ${name}. How may I assist you today?`,
  casual: (name: string) => `Hey ${name}! What's up?`,
  enthusiastic: (name: string) => `WOW, ${name}! SO GREAT to see you! 🎉`,
};

export const greetingPrompt = {
  name: promptsMetadata.greeting.name,
  description: promptsMetadata.greeting.description,
  argsSchema: greetingArgsSchema,

  /**
   * Greeting handler.
   *
   * @param args - Prompt arguments
   * @param extra - SDK context
   */
  handler: async (args: unknown, _extra: HandlerExtra): Promise<GetPromptResult> => {
    // Validate arguments
    const validation = greetingArgsSchema.safeParse(args);
    if (!validation.success) {
      throw new Error(
        `Invalid arguments: ${validation.error.errors.map((e) => e.message).join(', ')}`,
      );
    }

    const { name, style } = validation.data;

    logger.info('greeting', { message: 'Generating greeting', name, style });

    const greetingText = greetings[style](name);

    const messages: PromptMessage[] = [
      {
        role: 'user',
        content: {
          type: 'text',
          text: greetingText,
        },
      },
    ];

    return {
      description: `Greeting for ${name} in ${style} style`,
      messages,
    };
  },
};

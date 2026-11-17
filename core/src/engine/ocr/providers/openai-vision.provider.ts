import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { IVisionLlmProvider, IVisionLlmInput } from '../../../contracts';

@Injectable()
export class OpenAiVisionProvider implements IVisionLlmProvider {
  readonly id = 'openai';
  private readonly logger = new Logger(OpenAiVisionProvider.name);
  private readonly client?: OpenAI;
  private readonly modelName: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.client = new OpenAI({
        apiKey,
        baseURL: process.env.OPENAI_BASE_URL,
      });
    }
    this.modelName = process.env.OPENAI_VISION_MODEL ?? 'gpt-4o-mini';
  }

  isAvailable(): boolean {
    return Boolean(this.client);
  }

  async generateText(input: IVisionLlmInput): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAiVisionProvider chưa được cấu hình API key');
    }

    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: 'system', content: input.systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: input.userInstruction },
            {
              type: 'image_url',
              image_url: {
                url: `data:${input.mimeType};base64,${input.base64Data}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
    });

    return response.choices[0]?.message?.content?.trim() ?? '';
  }
}

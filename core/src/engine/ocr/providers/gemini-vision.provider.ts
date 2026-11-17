import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI, type Part } from '@google/generative-ai';
import { ORCHESTRATION_CONSTANTS } from '@agent/core/constants';
import { IVisionLlmProvider, IVisionLlmInput } from '../../../contracts';

@Injectable()
export class GeminiVisionProvider implements IVisionLlmProvider {
  readonly id = 'gemini';
  private readonly logger = new Logger(GeminiVisionProvider.name);
  private readonly client?: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.client = new GoogleGenerativeAI(apiKey);
    }
    this.modelName =
      process.env.OCR_VISION_MODEL ??
      ORCHESTRATION_CONSTANTS.DEFAULT_VISION_MODEL ??
      'gemini-2.0-flash';
  }

  isAvailable(): boolean {
    return Boolean(this.client);
  }

  async generateText(input: IVisionLlmInput): Promise<string> {
    if (!this.client) {
      throw new Error('GeminiVisionProvider chưa được cấu hình API key');
    }

    const model = this.client.getGenerativeModel({
      model: this.modelName,
      systemInstruction: input.systemPrompt,
    });

    const parts: (string | Part)[] = [
      { text: input.userInstruction },
      { inlineData: { mimeType: input.mimeType, data: input.base64Data } },
    ];

    const result = await model.generateContent(parts);
    return result.response.text().trim();
  }
}

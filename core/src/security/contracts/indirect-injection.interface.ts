import type {
  EInjectionCategory,
  EInjectionThreatLevel,
} from '../constants/indirect-injection.constants';

export {
  EInjectionCategory,
  EInjectionThreatLevel,
} from '../constants/indirect-injection.constants';

export interface IInjectionSignatureMatch {
  readonly category: EInjectionCategory;
  readonly matchedText: string;
}

export interface IContentSanitizationResult {
  readonly sanitizedText: string;
  readonly hasModifications: boolean;
}

export interface IInjectionEvaluationResult {
  readonly threatLevel: EInjectionThreatLevel;
  readonly matches: readonly IInjectionSignatureMatch[];
  readonly contentHash: string;
  readonly wrappedXml: string;
}

export interface IIndirectPromptInjectionGuard {
  evaluateToolOutput(
    rawToolOutput: unknown,
    toolName: string,
  ): IInjectionEvaluationResult;
}

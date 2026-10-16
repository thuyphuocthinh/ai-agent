import { StrictJsonValue } from '@agent/core/common';
import { ResponseProcessor } from '../../common/agentic-openapi-parser';
import { PiiScrubberUtil } from './pii-scrubber.util';

export class PiiScrubProcessor implements ResponseProcessor {
  process(data: unknown): unknown {
    return PiiScrubberUtil.scrub(data as StrictJsonValue);
  }
}

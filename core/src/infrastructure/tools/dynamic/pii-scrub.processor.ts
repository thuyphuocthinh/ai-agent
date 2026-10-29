import { StrictJsonValue } from '@agent/core/common';
import { ResponseProcessor } from 'agentic-openapi-parser';
import { PiiScrubberUtil } from '../../../common/text/pii/pii-scrubber.util';

export class PiiScrubProcessor implements ResponseProcessor {
  process(data: unknown): unknown {
    return PiiScrubberUtil.scrub(data as StrictJsonValue);
  }
}

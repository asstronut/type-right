import { makeSlipId, type Slip, type SlipKind } from '../slips';
import { RateLimitedError, type Engine } from '../engine';

export interface LanguageToolConfig {
  apiUrl: string;
  language: string;
}

interface LanguageToolMatch {
  message: string;
  shortMessage: string;
  offset: number;
  length: number;
  replacements: { value: string }[];
  rule: {
    issueType?: string;
    category: { id: string; name: string };
  };
}

interface LanguageToolResponse {
  matches: LanguageToolMatch[];
}

export function createLanguageToolEngine(config: LanguageToolConfig): Engine {
  return {
    async check(text: string): Promise<Slip[]> {
      const response = await fetch(`${config.apiUrl}/v2/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ text, language: config.language }),
      });

      if (response.status === 429) {
        throw new RateLimitedError(parseRetryAfterMs(response.headers.get('Retry-After')));
      }
      if (!response.ok) {
        throw new Error(`LanguageTool request failed: ${response.status}`);
      }

      const data = (await response.json()) as LanguageToolResponse;
      return data.matches.map((match) => toSlip(text, match));
    },
  };
}

function toSlip(text: string, match: LanguageToolMatch): Slip {
  const start = match.offset;
  const end = match.offset + match.length;
  const kind = kindFromIssueType(match.rule.issueType);
  return {
    id: makeSlipId(kind, text.slice(start, end)),
    start,
    end,
    kind,
    type: match.shortMessage || match.rule.category.name,
    explanation: match.message,
    suggestions: match.replacements.map((r) => r.value),
    source: 'languagetool',
  };
}

function kindFromIssueType(issueType: string | undefined): SlipKind {
  switch (issueType) {
    case 'misspelling':
      return 'spelling';
    case 'grammar':
      return 'grammar';
    default:
      return 'wording';
  }
}

function parseRetryAfterMs(header: string | null): number | undefined {
  const seconds = Number(header);
  return header && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

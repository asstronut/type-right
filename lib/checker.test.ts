import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkText } from './checker';
import { createLanguageToolEngine } from './engines/language-tool';
import type { Engine } from './engine';

describe('checkText', () => {
  it('returns no errors for blank text without calling the engine', async () => {
    const check = vi.fn();
    const languageTool: Engine = { check };

    const errors = await checkText('   ', { languageTool });

    expect(errors).toEqual([]);
    expect(check).not.toHaveBeenCalled();
  });

  describe('with LanguageTool faked at the HTTP layer', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      fetchMock.mockReset();
    });

    it('produces the expected spelling Error with correct offsets from a canned LT response', async () => {
      const text = 'I will recieve it';
      const start = text.indexOf('recieve');
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            matches: [
              {
                message: 'Possible spelling mistake found.',
                shortMessage: 'Spelling mistake',
                offset: start,
                length: 'recieve'.length,
                replacements: [{ value: 'receive' }],
                rule: {
                  issueType: 'misspelling',
                  category: { id: 'TYPOS', name: 'Possible Typo' },
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      const languageTool = createLanguageToolEngine({
        apiUrl: 'https://api.languagetool.org',
        language: 'en-US',
      });

      const errors = await checkText(text, { languageTool });

      expect(errors).toEqual([
        {
          id: expect.any(String),
          start,
          end: start + 'recieve'.length,
          kind: 'spelling',
          type: 'Spelling mistake',
          explanation: 'Possible spelling mistake found.',
          suggestions: ['receive'],
          source: 'languagetool',
        },
      ]);
    });
  });
});

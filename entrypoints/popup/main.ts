import { browser } from 'wxt/browser';
import { ERROR_KINDS, type ErrorKind } from '../../lib/errors';
import type { ErrorTally } from '../../lib/error-tally';
import type { TallyMessage } from '../../lib/messages';
import { isSiteDisabled, isSiteExcluded, normalizeSite, type Settings } from '../../lib/settings';
import { store } from '../../lib/store';

const counts = document.querySelector<HTMLDivElement>('#counts')!;
const countsEmpty = document.querySelector<HTMLParagraphElement>('#countsEmpty')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
const siteHeading = document.querySelector<HTMLHeadingElement>('#site')!;
const exclude = document.querySelector<HTMLButtonElement>('#exclude')!;
const disable = document.querySelector<HTMLButtonElement>('#disable')!;
const siteHint = document.querySelector<HTMLParagraphElement>('#siteHint')!;

const KIND_LABELS: Record<ErrorKind, string> = { spelling: 'Spelling', grammar: 'Grammar', wording: 'Wording' };

/** Each kind's type labels with their counts, most frequent first. */
function renderTally(tally: ErrorTally): void {
  const sections = ERROR_KINDS.flatMap((kind) => {
    const byType = Object.entries(tally.counts[kind] ?? {}).sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
    if (!byType.length) return [];
    const heading = document.createElement('h2');
    heading.textContent = KIND_LABELS[kind];
    const list = document.createElement('ul');
    list.append(
      ...byType.map(([type, n]) => {
        const item = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = type;
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = String(n);
        item.append(label, count);
        return item;
      }),
    );
    return [heading, list];
  });
  counts.replaceChildren(...sections);
  countsEmpty.hidden = sections.length > 0;
  reset.disabled = sections.length === 0;
}

/** The current tab's site, as the site lists store it, or `undefined` for pages Type Right never runs on. */
async function currentSite(): Promise<string | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return undefined;
  const url = new URL(tab.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  return normalizeSite(url.hostname);
}

/** Each button adds the site to its list; a site already covered by the list says so instead. */
function renderSite(site: string | undefined, settings: Settings): void {
  if (!site) {
    siteHeading.textContent = 'This page';
    exclude.disabled = disable.disabled = true;
    siteHint.textContent = 'Type Right does not run on this page.';
    return;
  }
  siteHeading.textContent = site;
  const excluded = isSiteExcluded(site, settings);
  const disabled = isSiteDisabled(site, settings);
  exclude.disabled = excluded || disabled;
  exclude.textContent = excluded ? 'Excluded from LLM' : 'Exclude this site from LLM';
  disable.disabled = disabled;
  disable.textContent = disabled ? 'Turned off on this site' : 'Turn off on this site';
  siteHint.textContent = '';
}

const site = await currentSite();

exclude.addEventListener('click', () => void store.addSite('excludedSites', site!));
disable.addEventListener('click', () => void store.addSite('disabledSites', site!));

reset.addEventListener('click', () => {
  const message: TallyMessage = { type: 'reset-tally' };
  void browser.runtime.sendMessage(message);
});

document.querySelector('#options')!.addEventListener('click', (event) => {
  event.preventDefault();
  void browser.runtime.openOptionsPage();
});

store.watchTally(renderTally);
store.watchSettings((settings) => renderSite(site, settings));
renderTally(await store.getTally());
renderSite(site, await store.getSettings());

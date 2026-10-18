# X: compose post

The compose dialog at `/compose/post`. The home timeline's inline composer stays in the DOM behind the dialog, so two `tweetTextarea_0` editors are visible at once.

```text
## path
x.com/compose/post
## focused root
<div aria-activedescendant="typeaheadFocus-0.<id>" aria-autocomplete="list" aria-controls="typeaheadDropdownWrapped-2" aria-describedby="placeholder-b4uhj" aria-label="Post text" aria-multiline="true" class="notranslate public-DraftEditor-content" contenteditable="true" data-testid="tweetTextarea_0" role="textbox" spellcheck="true" tabindex="0" no-focustrapview-refocus="true" style="outline: none; user-select: text; white-space: pre-wrap; overflow-wrap: break-wo">
## ancestors (nearest first)
<div class="DraftEditor-editorContainer">
<div class="DraftEditor-root">
<div class="r-1niwhzg r-17gur6a r-1yadl64 r-deolkf r-homxoj r-poiln3 r-7cikom r-1ny4l3l r-1t" data-testid="tweetTextarea_0RichTextInputContainer" style="min-height: 96px; max-height: 720px; overflow: hidden auto;">
<div class="false draftjs-styles_0 ">
<div class="css-g5y9jx r-xoduu5 r-xyw6el r-13qz1uu r-1e084wi">
<div dir="ltr" class="css-146c3p1 r-bcqeeo r-1ttztb7 r-qvutc0 r-37j5jr r-adyw6z r-135wba7 r-16dba41 r-" style="color: rgb(231, 233, 234);">
## all editables (* = focused)
* visible <div aria-activedescendant="typeaheadFocus-0.<id>" aria-autocomplete="list" aria-controls="typeaheadDropdownWrapped-2" aria-describedby="placeholder-b4uhj" aria-label="Post text" aria-multiline="true" class="notranslate public-DraftEditor-content" contenteditable="true" data-testid="tweetTextarea_0" role="textbox" spellcheck="true" tabindex="0" no-focustrapview-refocus="true" style="outline: none; user-select: text; white-space: pre-wrap; overflow-wrap: break-wo">
  visible <div aria-activedescendant="typeaheadFocus-0.<id>" aria-autocomplete="list" aria-controls="typeaheadDropdownWrapped-1" aria-describedby="placeholder-6dm4f" aria-label="Post text" aria-multiline="true" class="notranslate public-DraftEditor-content" contenteditable="true" data-testid="tweetTextarea_0" role="textbox" spellcheck="true" tabindex="0" no-focustrapview-refocus="true" style="outline: none; user-select: text; white-space: pre-wrap; overflow-wrap: break-wo">
## shadow hosts
(none)
## iframes
hidden  (no src) contenteditables:0
## innerText
"Reminder for @team: the deadline for the survey is tomorrow. Use `survey_final.csv` for your answers.\nDo not edit the headers.\n\n\nOur manager wrote \"late submissions will not be accepted\" in the last email 😬 You can upload the file here: https://example.com/upload. Please be carefull"
## textContent
"Reminder for @team: the deadline for the survey is tomorrow. Use `survey_final.csv` for your answers.Do not edit the headers.Our manager wrote \"late submissions will not be accepted\" in the last email 😬 You can upload the file here: https://example.com/upload. Please be carefull"
```

```html
<div aria-activedescendant="typeaheadFocus-0.&lt;id&gt;" aria-autocomplete="list" aria-controls="typeaheadDropdownWrapped-2" aria-describedby="placeholder-b4uhj" aria-label="Post text" aria-multiline="true" class="notranslate public-DraftEditor-content" contenteditable="true" data-testid="tweetTextarea_0" role="textbox" spellcheck="true" tabindex="0" no-focustrapview-refocus="true" style="outline: none; user-select: text; white-space: pre-wrap; overflow-wrap: break-wo"><div data-contents="true"><div class="" data-block="true" data-editor="b4uhj" data-offset-key="bf91j-0-0"><div data-offset-key="bf91j-0-0" class="public-DraftStyleDefault-block public-DraftStyleDefault-ltr"><span data-offset-key="bf91j-0-0"><span data-text="true">Reminder for </span></span><span style="color: rgb(29, 155, 240);"><span data-offset-key="bf91j-1-0"><span data-text="true">@team</span></span></span><span data-offset-key="bf91j-2-0"><span data-text="true">: the deadline for the survey is tomorrow. Use `survey_final.csv` for your answers.</span></span></div></div><div class="" data-block="true" data-editor="b4uhj" data-offset-key="d6if3-0-0"><div data-offset-key="d6if3-0-0" class="public-DraftStyleDefault-block public-DraftStyleDefault-ltr"><span data-offset-key="d6if3-0-0"><span data-text="true">Do not edit the headers.</span></span></div></div><div class="" data-block="true" data-editor="b4uhj" data-offset-key="55uev-0-0"><div data-offset-key="55uev-0-0" class="public-DraftStyleDefault-block public-DraftStyleDefault-ltr"><span data-offset-key="55uev-0-0"><br data-text="true"></span></div></div><div class="" data-block="true" data-editor="b4uhj" data-offset-key="17mvd-0-0"><div data-offset-key="17mvd-0-0" class="public-DraftStyleDefault-block public-DraftStyleDefault-ltr"><span data-offset-key="17mvd-0-0"><span data-text="true">Our manager wrote "late submissions will not be accepted" in the last email </span></span><span style="background-image: url(&quot;https://abs.twimg.com/emoji/v2/svg/1f62c.svg&quot;); backgroun"><span style="clip-path: circle(0% at center center);"><span data-offset-key="17mvd-1-0"><span data-text="true">😬</span></span></span></span><span data-offset-key="17mvd-2-0"><span data-text="true"> You can upload the file here: </span></span><span style="color: rgb(29, 155, 240);"><span data-offset-key="17mvd-3-0"><span data-text="true">https://example.com/upload</span></span></span><span data-offset-key="17mvd-4-0"><span data-text="true">. Please be carefull</span></span></div></div></div></div>
```

# Slack: message composer

Composer in a DM with Slackbot. The mentioned member is renamed "Dana" here.

```text
## path
app.slack.com/client/<id>/<id>
## focused root
<div class="ql-editor" data-gramm="false" contenteditable="true" dir="auto" role="textbox" tabindex="0" data-qa="texty_input" data-team-id="<id>" data-feat="composer" aria-label="Message to Slackbot" aria-describedby="context_bar_text-8a24f1fd" aria-multiline="true" spellcheck="true">
## ancestors (nearest first)
<div data-qa="message_input" data-message-input="true" data-channel-id="<id>" data-thread-ts="<id>.000000" data-thread-key="<id>-<id>.000000" data-view-context="slackbot-ai-conversation" class="c-texty_input--supports_opaque_blocks c-texty_input_unstyled ql-container focus" style="--min-lines: 1; --max-lines: 16;">
<div class="c-texty_input_unstyled__container c-texty_input_unstyled__container--size_medium" data-buttons="1">
<div class="c-basic_container__body">
<div class="p-message_input__input_container_unstyled c-wysiwyg_container c-wysiwyg_containe" style="--max-lines: 16;">
<div class="p-threads_footer__input p-message_input_unstyled p-message_input_unstyled--attac" role="group" aria-label="composer">
<div class="p-threads_footer__input_container p-threads_footer__input_container--sticky_comp" data-qa="reply_container">
## all editables (* = focused)
* visible <div class="ql-editor" data-gramm="false" contenteditable="true" dir="auto" role="textbox" tabindex="0" data-qa="texty_input" data-team-id="<id>" data-feat="composer" aria-label="Message to Slackbot" aria-describedby="context_bar_text-8a24f1fd" aria-multiline="true" spellcheck="true">
  hidden  <div class="ql-clipboard" contenteditable="true" tabindex="-1" aria-hidden="true">
## shadow hosts
(none)
## iframes
(none)
## innerText
"Hi @Dana, the weekly report is ready for review. I ran refresh_all.py this morning.\n\nPlease check the totals before noon.\n\n\n\n\nDana said \"the numbers look fine\" yesterday, so we are almost done  The full report is at https://example.com/weekly-report and I'll send the remaning charts later."
## textContent
"Hi @Dana, the weekly report is ready for review. I ran refresh_all.py this morning.Please check the totals before noon.Dana said \"the numbers look fine\" yesterday, so we are almost done ﻿﻿ The full report is at https://example.com/weekly-report and I'll send the remaning charts later."
```

`textContent` has two U+FEFF characters around the emoji `<img>`.

```html
<div class="ql-editor" data-gramm="false" contenteditable="true" dir="auto" role="textbox" tabindex="0" data-qa="texty_input" data-team-id="&lt;id&gt;" data-feat="composer" aria-label="Message to Slackbot" aria-describedby="context_bar_text-8a24f1fd" aria-multiline="true" spellcheck="true"><p>Hi <ts-mention data-id="&lt;id&gt;" data-label="@Dana" spellcheck="false" class="c-member_slug c-member_slug--link ts_tip_texty" dir="ltr">@Dana</ts-mention>, the weekly report is ready for review. I ran <code>refresh_all.py</code> this morning.</p><p>Please check the totals before noon.</p><p><br></p><p>Dana said "the numbers look fine" yesterday, so we are almost done <img data-id=":slightly_smiling_face:" data-title=":slightly_smiling_face:" data-stringify-text=":slightly_smiling_face:" class="emoji" src="data:…" alt="slightly smiling face emoji" style="background-image: url(https://slack-imgs.com/…"> The full report is at https://example.com/weekly-report and I'll send the remaning charts later.</p></div>
```

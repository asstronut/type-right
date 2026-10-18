# Gmail: compose body

New-message compose window, no recipients. Focus had moved off the body when the capture ran, so the root was picked with `[g_editable="true"][contenteditable="true"]`, and there is no ancestor list for the focused element.

```text
## path
mail.google.com/mail/u/0/
## root (selected by [g_editable=true])
<div id=":t4" class="Am aiL Al editable LW-avf tS-tW" hidefocus="true" aria-label="Message Body" writingsuggestions="false" g_editable="true" role="textbox" aria-multiline="true" contenteditable="true" tabindex="1" style="direction: ltr; min-height: 225px;" itacorner="6,7:1,1,0,0" spellcheck="false" aria-owns=":vk" aria-controls=":vk" aria-expanded="false">
## ancestors (nearest first)
<div class="aO7">
<div id=":t8" class="Ar Au" style="display: block;">
<td class="Ap">
<tr>
<tbody>
<table cellpadding="0" class="cf An" id="undefined">
<div>
<div id=":qv" class="ZyRVue">
## all editables
  hidden  <div jsname="ZeIRi" enterkeyhint="send" spellcheck="true" autocomplete="chr-off" jslog="203842;track:click,keyboard_enter;u014N:cOuCgd,SYhH9d;" class="Pv5YRd TIYGAd VMkJgc" contenteditable="true" tabindex="0" role="combobox" aria-label="Ask Gemini" aria-expanded="false" aria-controls="ucc-2" aria-autocomplete="list" autofocus="" jsaction="focus:.CLIENT;focusin:.CLIENT" style="--ae-generativeai-promptbox-max-lines: 7;">
  hidden  <textarea id=":ta" class="Ak aiL" style="" aria-label="Message Body" spellcheck="true" itacorner="6,7:1,1,0,0" tabindex="1" form="nosend">
  visible <div id=":t4" class="Am aiL Al editable LW-avf tS-tW" hidefocus="true" aria-label="Message Body" writingsuggestions="false" g_editable="true" role="textbox" aria-multiline="true" contenteditable="true" tabindex="1" style="direction: ltr; min-height: 225px;" itacorner="6,7:1,1,0,0" spellcheck="false" aria-owns=":vk" aria-controls=":vk" aria-expanded="false">
## shadow hosts
(none)
## iframes
visible (no src) contenteditables:0
visible ogs.google.com contenteditables:x-origin
hidden  studio.workspace.google.com contenteditables:x-origin
hidden  contacts.google.com contenteditables:x-origin
hidden  accounts.google.com contenteditables:x-origin
hidden  mail.google.com contenteditables:0
## innerText
"​@budi thanks for fixing the bug! I merged your change into `main`.\nThe build passed on the first try.\n\nBudi's note was short: \"it works on my machine.\" Let's hope it works everywhere  See https://example.com/pull/42 if you want to check the diffrence.\n\n\n\n--\n\nSender Name\n"
## textContent
"​@budi thanks for fixing the bug! I merged your change into `main`.The build passed on the first try.Budi's note was short: \"it works on my machine.\" Let's hope it works everywhere  See https://example.com/pull/42 if you want to check the diffrence.-- Sender Name"
```

```html
<div id=":t4" class="Am aiL Al editable LW-avf tS-tW" hidefocus="true" aria-label="Message Body" writingsuggestions="false" g_editable="true" role="textbox" aria-multiline="true" contenteditable="true" tabindex="1" style="direction: ltr; min-height: 225px;" itacorner="6,7:1,1,0,0" spellcheck="false" aria-owns=":vk" aria-controls=":vk" aria-expanded="false"><div><div class="gmail_default" style="font-family: georgia, serif;">​<span style="font-family: Arial, Helvetica, sans-serif; background-color: transparent;">@budi thanks for fixing the bug! I merged your change into `main`.</span></div>The build passed on the first try.<br><br>Budi's note was short: "it works on my machine." Let's hope it works everywhere <img data-emoji="✅" class="an1" alt="✅" aria-label="✅" draggable="false" src="https://fonts.gstatic.com/s/e/notoemoji/17.0/2705/72.png" loading="lazy"> See https://example.com/pull/42 if you want to check the diffrence.<br clear="all"></div><div><br></div><span class="gmail_signature_prefix">-- </span><br><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature"><div dir="ltr"><font face="georgia,serif">Sender Name<br></font></div></div></div>
```

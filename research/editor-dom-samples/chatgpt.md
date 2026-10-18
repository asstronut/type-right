# ChatGPT: prompt box

The text here was pasted, not typed. Every run carries `data-prompt-literal-paste`, and the lines are `<br>`s inside one `<p>`. Typed text may produce one `<p>` per Enter instead.

```text
## path
chatgpt.com/
## focused root
<div contenteditable="true" aria-multiline="true" dir="auto" role="textbox" spellcheck="true" tabindex="0" translate="no" class="ProseMirror ProseMirror-focused" data-composer-markdown="" aria-label="Ask ChatGPT" data-virtualkeyboard="true">
## ancestors (nearest first)
<div data-rich-text-layout="multiline" role="presentation" class="text-size-chat *:text-size-chat in-[[data-composer-body]:has([data-composer-expa" data-composer-input-layout="multiline" data-composer-input-variant="default" style="transform: none; transform-origin: 50% 50% 0px;">
<div class="ComposerLayoutInput-KwIAr_ flex-grow overflow-y-auto" data-composer-layout="multiline" data-composer-spacing="default" data-composer-input-variant="default" data-composer-input="" data-composer-animate-layout="">
<div class="contents">
<div class="min-w-0 AdaptiveFooterInput-zji599 col-span-full row-start-1 -mx-2" data-composer-layout="multiline" style="height: auto; opacity: 1; transform: none; transform-origin: 50% 50% 0px;">
<div class="ComposerLayoutFooter-_8IVRO" data-composer-footer-responsive="" data-composer-layout="multiline" data-composer-rows="stacked" data-composer-spacing="default">
<div class="ComposerLayoutBody-uBBf1A" data-composer-layout="multiline" data-composer-body="" style="border-radius: 28px; transform: none; transform-origin: 50% 50% 0px;">
## all editables (* = focused)
* visible <div contenteditable="true" aria-multiline="true" dir="auto" role="textbox" spellcheck="true" tabindex="0" translate="no" class="ProseMirror ProseMirror-focused" data-composer-markdown="" aria-label="Ask ChatGPT" data-virtualkeyboard="true">
## shadow hosts
div
## iframes
hidden  cdn.platform.openai.com contenteditables:x-origin
## innerText
"Hello @tomi, your order has been shipped. The tracking code is `ID123456`.\nIt should arrive in three days.\n\nThe courier promised \"delivery before the weekend\" 📦 You can track the package at \nhttps://example.com/track. Sorry for the delay with your previus order."
## textContent
"Hello @tomi, your order has been shipped. The tracking code is `ID123456`.It should arrive in three days.The courier promised \"delivery before the weekend\" 📦 You can track the package at https://example.com/track. Sorry for the delay with your previus order."
```

The `\n` before the URL in `innerText` comes from the `inline-flow` link chip.

```html
<div contenteditable="true" aria-multiline="true" dir="auto" role="textbox" spellcheck="true" tabindex="0" translate="no" class="ProseMirror ProseMirror-focused" data-composer-markdown="" aria-label="Ask ChatGPT" data-virtualkeyboard="true"><p><span data-prompt-literal-paste="">Hello @tomi, your order has been shipped. The tracking code is `ID123456`.<br>It should arrive in three days.<br><br>The courier promised "delivery before the weekend" 📦 You can track the package at </span><span rich-link-source-app-id="" class="Mention-hIgCkC" data-appearance="inline-mention" data-layout="inline-flow" data-font-weight="medium" data-tone="accent" data-underline-on-hover="" data-breakable-url="" text-link-href="https://example.com/track" data-rich-text-generated-autolink=""><span class="Label-arpLwJ"><span data-prompt-literal-paste=""><span data-inline-url-icon="" class="Mention-hIgCkC ProseMirror-widget" data-appearance="inline-mention" data-layout="inline-flow" data-font-weight="medium" data-tone="accent" data-underline-on-hover="" aria-hidden="true" contenteditable="false"><span class="IconContainer-K62H88 SlotSizedIconContainer-xXGVqL" contenteditable="false"><svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="Icon-TZxsTm SlotSizedIcon-mWPuaA"><path d="M10 2.125C14.3492 2.125 17.875 5.65076 17.875 10C17.875 14.3492 14.3492 17.875 1"></path></svg></span><span class="Label-arpLwJ"></span></span>https://example.com/track</span></span></span><span data-prompt-literal-paste="">. Sorry for the delay with your previus order.</span></p></div>
```

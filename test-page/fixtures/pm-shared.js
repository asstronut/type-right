export function modelText(doc) {
  return doc.textBetween(0, doc.content.size, '\n', '\ufffc');
}

export function findLastWord(doc, word, skipTypes) {
  let found = null;
  doc.forEach((block, offset) => {
    if (skipTypes.includes(block.type.name)) return;
    block.descendants((node, pos) => {
      if (!node.isText) return;
      const index = node.text.lastIndexOf(word);
      if (index < 0) return;
      const from = offset + 1 + pos + index;
      found = { from, to: from + word.length };
    });
  });
  if (!found) throw new Error(`"${word}" is not in the document outside its code blocks and quotes`);
  return found;
}

export function elementsNotChecked(host) {
  return [...host.querySelectorAll('pre, blockquote')];
}

export function inlineCode(host) {
  return [...host.querySelectorAll('code')].filter((code) => !code.closest('pre'));
}

// Return one replacement and the text to select after inserting it.
export function formatMarkdown(value, start, end, action) {
  let selected = value.slice(start, end);
  const wrap = (before, after, placeholder) => {
    const text = selected || placeholder;
    return { start, end, text: before + text + after, selectStart: before.length, selectEnd: before.length + text.length };
  };
  if (action === 'bold') return wrap('**', '**', 'bold text');
  if (action === 'italic') return wrap('*', '*', 'italic text');
  if (action === 'link') {
    const result = wrap('[', '](https://example.com)', 'link text');
    if (selected) {
      result.selectStart = selected.length + 3;
      result.selectEnd = result.selectStart + 'https://example.com'.length;
    }
    return result;
  }
  if (['heading', 'list', 'numbered', 'checkbox', 'quote'].includes(action)) {
    start = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
    const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
    const next = value.indexOf('\n', last);
    end = next === -1 ? value.length : next;
    const prefixes = { heading: '## ', list: '- ', checkbox: '- [ ] ', quote: '> ' };
    const text = value.slice(start, end).split('\n').map((line, index) => {
      const prefix = action === 'numbered' ? `${index + 1}. ` : prefixes[action];
      return prefix + (line.replace(/^(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|>\s?)/, '') || (action === 'heading' ? 'Heading' : 'List item'));
    }).join('\n');
    return { start, end, text, selectStart: 0, selectEnd: text.length };
  }
  const leading = start > 0 ? (value[start - 1] === '\n' ? '\n' : '\n\n') : '';
  const trailing = end < value.length ? (value[end] === '\n' ? '\n' : '\n\n') : '\n';
  if (action === 'code') {
    const fence = '`'.repeat(Math.max(3, ...Array.from(selected.matchAll(/`+/g), match => match[0].length + 1)));
    const text = selected || 'Your code here';
    const before = leading + fence + '\n';
    return { start, end, text: before + text + '\n' + fence + trailing, selectStart: before.length, selectEnd: before.length + text.length };
  }
  if (action === 'table') {
    // Insert tables after a selection so existing prose is never discarded.
    start = end;
    const before = start > 0 ? '\n\n' : '';
    const text = '| Column 1 | Column 2 |\n| --- | --- |\n| Text | Text |\n| Text | Text |';
    return { start, end, text: before + text + trailing, selectStart: before.length + 2, selectEnd: before.length + 10 };
  }
  throw new Error(`Unknown format: ${action}`);
}

export function parseMarkdownBlocks(markdown = '') {
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
  const isTableSeparator = (line) => {
    if (!isTableRow(line)) return false;
    return line
      .trim()
      .slice(1, -1)
      .split('|')
      .every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
  };
  const parseTableRow = (line) => (
    line
      .trim()
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim())
  );

  const pushParagraph = (paragraphLines) => {
    const text = paragraphLines.join('\n').trim();
    if (text) blocks.push({ type: 'paragraph', text });
  };

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }

    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      const codeLines = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index++;
      }
      if (index < lines.length) index++;
      blocks.push({ type: 'code', language: fence[1] || '', text: codeLines.join('\n') });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      index++;
      continue;
    }

    if (
      isTableRow(line) &&
      index + 1 < lines.length &&
      isTableSeparator(lines[index + 1])
    ) {
      const headers = parseTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index])) {
        const row = parseTableRow(lines[index]);
        rows.push(headers.map((_, cellIndex) => row[cellIndex] || ''));
        index++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, '').trim());
        index++;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, '').trim());
        index++;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    const paragraphLines = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```/.test(lines[index]) &&
      !/^(#{1,3})\s+/.test(lines[index]) &&
      !(
        isTableRow(lines[index]) &&
        index + 1 < lines.length &&
        isTableSeparator(lines[index + 1])
      ) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index++;
    }
    pushParagraph(paragraphLines);
  }

  return blocks;
}

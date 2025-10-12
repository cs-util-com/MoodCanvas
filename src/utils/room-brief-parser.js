export function parseRoomBrief(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Room brief text must be a string');
  }
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return { paragraph: '', bullets: [] };
  }

  const lines = normalized.split(/\n+/);
  const paragraphLines = [];
  const bullets = [];
  let bulletMode = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isBulletLine(line)) {
      bulletMode = true;
      bullets.push(normalizeBullet(line));
    } else if (bulletMode) {
      bullets.push(line);
    } else {
      paragraphLines.push(line);
    }
  }

  const paragraph = collapseWhitespace(paragraphLines.join(' '));
  const trimmedBullets = bullets.map((entry) => collapseWhitespace(entry)).filter(Boolean).slice(0, 5);

  return {
    paragraph,
    bullets: trimmedBullets,
  };
}

function isBulletLine(line) {
  return /^[-*•\d+\.]/.test(line);
}

function normalizeBullet(line) {
  return line.replace(/^[-*•\d+\.\s]+/, '').trim();
}

function collapseWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}


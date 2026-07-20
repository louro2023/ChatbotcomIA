const crypto = require('crypto');

function normalizeInstagramText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeInstagramPostUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const match = parsed.pathname.match(/^\/(p|reel)\/([A-Za-z0-9_-]+)\/?$/);
    if (parsed.protocol !== 'https:' || hostname !== 'instagram.com' || !match) return '';
    return `https://www.instagram.com/${match[1]}/${match[2]}/`;
  } catch (_error) {
    return '';
  }
}

function parseInstagramKeywords(value) {
  const unique = new Map();
  for (const rawKeyword of String(value || '').split(/[\n,;]+/)) {
    const original = rawKeyword.trim().slice(0, 80);
    const normalized = normalizeInstagramText(original);
    if (normalized && !unique.has(normalized)) unique.set(normalized, original);
    if (unique.size >= 100) break;
  }
  return [...unique.values()];
}

function instagramPostStateKey(postUrl) {
  return crypto.createHash('sha256').update(String(postUrl || '')).digest('hex');
}

function instagramCommentKey(comment) {
  const source = comment?.permalink || `${comment?.username || ''}|${comment?.datetime || ''}|${comment?.text || ''}`;
  return crypto.createHash('sha256').update(source).digest('hex');
}

function findInstagramKeyword(commentText, keywords) {
  const normalizedComment = normalizeInstagramText(commentText);
  return (keywords || []).find(keyword => normalizedComment.includes(normalizeInstagramText(keyword))) || '';
}

function collectNewInstagramMatches(post, comments, keywords, scanStartedAt = new Date().toISOString(), options = {}) {
  const processExisting = options.processExisting === true;
  const previousScanAt = post.lastScanAt ? Date.parse(post.lastScanAt) : 0;
  const notBefore = options.notBefore ? Date.parse(options.notBefore) : NaN;
  const matchesFound = [];
  let newComments = 0;
  let ignoredBeforeMonitor = 0;
  let withoutKeyword = 0;
  let alreadyMatched = 0;
  for (const comment of comments || []) {
    const commentKey = instagramCommentKey(comment);
    const wasProcessed = Boolean(post.processed[commentKey]);
    if (wasProcessed && !processExisting) continue;
    if (!wasProcessed) post.processed[commentKey] = { timestamp: scanStartedAt, username: comment.username };
    if (!previousScanAt && !processExisting) continue;
    const commentTime = comment.datetime ? Date.parse(comment.datetime) : NaN;
    if (!processExisting && Number.isFinite(notBefore) && Number.isFinite(commentTime) && commentTime < notBefore - 60000) {
      ignoredBeforeMonitor++;
      continue;
    }
    newComments++;
    const keyword = findInstagramKeyword(comment.text, keywords);
    if (!keyword) {
      withoutKeyword++;
      continue;
    }
    const usernameKey = String(comment.username || '').toLocaleLowerCase('pt-BR');
    if (!usernameKey) continue;
    if (processExisting && post.matches[usernameKey]) {
      alreadyMatched++;
      continue;
    }
    const match = { ...comment, keyword, timestamp: scanStartedAt };
    post.matches[usernameKey] = match;
    matchesFound.push(match);
  }
  post.lastScanAt = scanStartedAt;
  return { newComments, newMatches: matchesFound.length, matchesFound, ignoredBeforeMonitor, withoutKeyword, alreadyMatched };
}

function extractInstagramCommentsFromPage() {
  const reservedPaths = new Set(['accounts', 'direct', 'explore', 'p', 'reel', 'reels', 'stories']);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const results = [];
  const seen = new Set();
  const roots = [];
  const rootElements = new Set();
  const isProfileAnchor = anchor => {
    try {
      const parts = new URL(anchor.href).pathname.split('/').filter(Boolean);
      return parts.length === 1 && !reservedPaths.has(parts[0].toLowerCase()) && /^[A-Za-z0-9._]+$/.test(parts[0]);
    } catch (_error) {
      return false;
    }
  };
  const isCommentPermalink = anchor => {
    try {
      const url = new URL(anchor.href);
      return /\/(?:p|reel)\/[^/]+\/c\/[^/]+\/?$/i.test(url.pathname) || url.searchParams.has('comment_id');
    } catch (_error) {
      return false;
    }
  };
  const getCommentText = (root, username) => {
    const ignored = /^(responder|reply|curtir|like|ver tradução|see translation|ocultar respostas|hide replies|ver respostas|view replies)$/i;
    const relativeTime = /^(agora|now|\d+\s*(?:s|seg|min|m|h|d|sem|w|a|y))$/i;
    const values = [...root.querySelectorAll('span[dir="auto"], div[dir="auto"]')]
      .filter(element => !element.querySelector('span[dir="auto"], div[dir="auto"]'))
      .filter(element => !element.querySelector('time'))
      .map(element => normalize(element.textContent))
      .filter(text => text && text.toLowerCase() !== username.toLowerCase() && !text.startsWith('@') && !ignored.test(text) && !relativeTime.test(text));
    return [...new Set(values)].sort((left, right) => right.length - left.length)[0] || '';
  };
  const addRoot = (root, permalink = '') => {
    if (!root || rootElements.has(root)) return;
    rootElements.add(root);
    roots.push({ root, permalink });
  };

  for (const link of [...document.querySelectorAll('a[href]')].filter(isCommentPermalink)) {
    let current = link.parentElement;
    for (let depth = 0; current && depth < 9; depth++, current = current.parentElement) {
      const author = [...current.querySelectorAll('a[href]')].find(isProfileAnchor);
      if (!author) continue;
      const username = new URL(author.href).pathname.split('/').filter(Boolean)[0];
      if (!getCommentText(current, username)) continue;
      addRoot(current, link.href);
      break;
    }
  }

  for (const item of document.querySelectorAll('article ul li')) addRoot(item);

  if (!roots.length) {
    for (const time of document.querySelectorAll('time')) {
      let current = time.parentElement;
      for (let depth = 0; current && depth < 9; depth++, current = current.parentElement) {
        const reply = [...current.querySelectorAll('button, div[role="button"]')]
          .some(element => /^(responder|reply)$/i.test(normalize(element.textContent)));
        const author = [...current.querySelectorAll('a[href]')].find(isProfileAnchor);
        if (!reply || !author) continue;
        const username = new URL(author.href).pathname.split('/').filter(Boolean)[0];
        if (!getCommentText(current, username)) continue;
        addRoot(current);
        break;
      }
    }
  }

  for (const { root, permalink: knownPermalink } of roots) {
    const anchors = [...root.querySelectorAll('a[href]')];
    const author = anchors.find(isProfileAnchor);
    if (!author) continue;
    const username = new URL(author.href).pathname.split('/').filter(Boolean)[0];
    const text = getCommentText(root, username);
    if (!text) continue;
    const time = root.querySelector('time');
    const permalink = knownPermalink || anchors.find(isCommentPermalink)?.href || '';
    const signature = `${username.toLowerCase()}|${time?.dateTime || ''}|${text}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    results.push({ username, name: username, text, datetime: time?.dateTime || '', permalink });
  }
  return results.slice(0, 500);
}

function findInstagramReplyPointOnPage(target) {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const targetText = normalize(target.text);
  const targetProfilePath = `/${target.username}/`;
  const center = element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      ? { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) }
      : null;
  };
  const findReplyAbove = start => {
    let current = start;
    for (let depth = 0; current && depth < 10; depth++, current = current.parentElement) {
      const hasAuthor = [...current.querySelectorAll('a[href]')].some(anchor => {
        try { return new URL(anchor.href).pathname === targetProfilePath; } catch (_error) { return false; }
      });
      if (!hasAuthor || !normalize(current.textContent).includes(targetText)) continue;
      const reply = [...current.querySelectorAll('button, div[role="button"]')]
        .find(element => /^(responder|reply)$/i.test(normalize(element.textContent)));
      if (reply) return center(reply);
    }
    return null;
  };
  if (target.permalink) {
    const permalink = [...document.querySelectorAll('a[href]')].find(anchor => {
      try { return new URL(anchor.href).pathname === new URL(target.permalink).pathname; } catch (_error) { return false; }
    });
    const point = permalink && findReplyAbove(permalink);
    if (point) return point;
  }
  for (const profile of document.querySelectorAll('a[href]')) {
    try {
      if (new URL(profile.href).pathname === targetProfilePath) {
        const point = findReplyAbove(profile);
        if (point) return point;
      }
    } catch (_error) {
      // Ignore malformed links inserted by third-party content.
    }
  }
  return null;
}

function findInstagramCommentSubmitPointOnPage() {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  let root = document.activeElement;
  for (let depth = 0; root && depth < 8; depth++, root = root.parentElement) {
    const submit = [...root.querySelectorAll('button, div[role="button"]')]
      .find(element => /^(publicar|postar|post|enviar|send)$/i.test(normalize(element.textContent)) && !element.disabled);
    if (submit) {
      const rect = submit.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) };
    }
  }
  return null;
}

function findInstagramDirectSubmitPointOnPage() {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  let root = document.activeElement;
  for (let depth = 0; root && depth < 9; depth++, root = root.parentElement) {
    const submit = [...root.querySelectorAll('button, div[role="button"]')]
      .find(element => /^(enviar|send)$/i.test(normalize(element.textContent)) && !element.disabled);
    if (submit) {
      const rect = submit.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) };
    }
  }
  return null;
}

module.exports = {
  collectNewInstagramMatches,
  extractInstagramCommentsFromPage,
  findInstagramCommentSubmitPointOnPage,
  findInstagramDirectSubmitPointOnPage,
  findInstagramKeyword,
  findInstagramReplyPointOnPage,
  instagramCommentKey,
  instagramPostStateKey,
  normalizeInstagramPostUrl,
  normalizeInstagramText,
  parseInstagramKeywords
};

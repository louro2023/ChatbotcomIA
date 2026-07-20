const assert = require('assert/strict');
const {
  collectNewInstagramMatches,
  findInstagramKeyword,
  instagramCommentKey,
  instagramPostStateKey,
  normalizeInstagramPostUrl,
  normalizeInstagramText,
  parseInstagramKeywords
} = require('../Electron/instagram-utils');

assert.equal(normalizeInstagramText('  CURRÍCULO  '), 'curriculo');
assert.equal(normalizeInstagramText('CuRsO\nOnline'), 'curso online');
assert.equal(findInstagramKeyword('Quero receber o CURRÍCULO', ['curso', 'curriculo']), 'curriculo');
assert.equal(findInstagramKeyword('Quero o e-book', ['curso', 'pdf']), '');

assert.deepEqual(
  parseInstagramKeywords('Curso, currículo\nCURSO; PDF'),
  ['Curso', 'currículo', 'PDF']
);

assert.equal(normalizeInstagramPostUrl('https://instagram.com/p/ABC_123/?utm_source=x'), 'https://www.instagram.com/p/ABC_123/');
assert.equal(normalizeInstagramPostUrl('https://www.instagram.com/reel/xyz-789/'), 'https://www.instagram.com/reel/xyz-789/');
assert.equal(normalizeInstagramPostUrl('https://evil.example/p/ABC_123/'), '');
assert.equal(normalizeInstagramPostUrl('javascript:alert(1)'), '');
assert.equal(normalizeInstagramPostUrl('https://www.instagram.com/explore/'), '');

const comment = { username: 'maria', datetime: '2026-07-20T10:00:00Z', text: 'Quero o curso', permalink: '' };
assert.equal(instagramCommentKey(comment), instagramCommentKey({ ...comment }));
assert.notEqual(instagramCommentKey(comment), instagramCommentKey({ ...comment, text: 'Quero o PDF' }));
assert.equal(instagramPostStateKey('https://www.instagram.com/p/ABC/'), instagramPostStateKey('https://www.instagram.com/p/ABC/'));

const post = { lastScanAt: '', processed: {}, matches: {}, commentedUsers: {}, directUsers: {} };
const oldComment = { username: 'maria', datetime: '2026-07-20T10:00:00Z', text: 'Quero o curso', permalink: '/p/ABC/c/1/' };
const baseline = collectNewInstagramMatches(post, [oldComment], ['curso'], '2026-07-20T10:01:00Z');
assert.deepEqual({ newComments: baseline.newComments, newMatches: baseline.newMatches }, { newComments: 0, newMatches: 0 });

const newComment = { username: 'joao', datetime: '2026-07-20T10:02:00Z', text: 'QUERO O CURRÍCULO', permalink: '/p/ABC/c/2/' };
const secondScan = collectNewInstagramMatches(post, [oldComment, newComment], ['curriculo'], '2026-07-20T10:03:00Z');
assert.equal(secondScan.newComments, 1);
assert.equal(secondScan.newMatches, 1);
assert.equal(post.matches.joao.keyword, 'curriculo');

const repeatedScan = collectNewInstagramMatches(post, [newComment], ['curriculo'], '2026-07-20T10:04:00Z');
assert.deepEqual({ newComments: repeatedScan.newComments, newMatches: repeatedScan.newMatches }, { newComments: 0, newMatches: 0 });

const recovered = collectNewInstagramMatches(post, [oldComment], ['curso'], '2026-07-20T10:05:00Z', { processExisting: true });
assert.deepEqual({ newComments: recovered.newComments, newMatches: recovered.newMatches }, { newComments: 1, newMatches: 1 });
assert.equal(post.matches.maria.keyword, 'curso');

const recoveredAgain = collectNewInstagramMatches(post, [oldComment], ['curso'], '2026-07-20T10:06:00Z', { processExisting: true });
assert.deepEqual({ newComments: recoveredAgain.newComments, newMatches: recoveredAgain.newMatches }, { newComments: 1, newMatches: 0 });

const delayedPost = { lastScanAt: '', processed: {}, matches: {}, commentedUsers: {}, directUsers: {} };
const delayedBaseline = { username: 'antigo', datetime: '2026-07-20T09:00:00Z', text: 'curso', permalink: '/p/ABC/c/10/' };
collectNewInstagramMatches(delayedPost, [delayedBaseline], ['curso'], '2026-07-20T10:01:00Z', { notBefore: '2026-07-20T10:00:00Z' });
collectNewInstagramMatches(delayedPost, [], ['curso'], '2026-07-20T10:04:00Z', { notBefore: '2026-07-20T10:00:00Z' });
const revealedLate = { username: 'atrasado', datetime: '2026-07-20T10:02:00Z', text: 'Quero o CURSO', permalink: '/p/ABC/c/11/' };
const delayedResult = collectNewInstagramMatches(delayedPost, [revealedLate], ['curso'], '2026-07-20T10:05:00Z', { notBefore: '2026-07-20T10:00:00Z' });
assert.deepEqual({ newComments: delayedResult.newComments, newMatches: delayedResult.newMatches, ignored: delayedResult.ignoredBeforeMonitor }, { newComments: 1, newMatches: 1, ignored: 0 });

const historicRevealedLate = { username: 'historico', datetime: '2026-07-20T09:30:00Z', text: 'curso', permalink: '/p/ABC/c/12/' };
const historicResult = collectNewInstagramMatches(delayedPost, [historicRevealedLate], ['curso'], '2026-07-20T10:06:00Z', { notBefore: '2026-07-20T10:00:00Z' });
assert.deepEqual({ newComments: historicResult.newComments, newMatches: historicResult.newMatches, ignored: historicResult.ignoredBeforeMonitor }, { newComments: 0, newMatches: 0, ignored: 1 });

console.log('Lógica do monitor do Instagram validada com sucesso.');

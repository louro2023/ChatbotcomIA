const assert = require('assert/strict');
const puppeteer = require('puppeteer');
const {
  extractInstagramCommentsFromPage,
  findInstagramCommentSubmitPointOnPage,
  findInstagramDirectSubmitPointOnPage,
  findInstagramReplyPointOnPage
} = require('../Electron/instagram-utils');
const { typeInstagramMessage } = require('../Electron/instagram-browser');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section class="current-instagram-comment">
        <div class="comment-content">
          <div>
            <span dir="auto"><a href="https://www.instagram.com/ana.curriculo/"><span dir="auto">ana.curriculo</span></a></span>
            <span dir="auto"><a href="https://www.instagram.com/p/ABC/c/202/"><time datetime="2026-07-20T10:04:00Z">1 min</time></a></span>
          </div>
          <div><span dir="auto">Quero o PDF</span></div>
        </div>
        <div><div role="button" id="currentReply" onclick="this.dataset.clicked='true'"><span dir="auto"><span>Responder</span></span></div></div>
      </section>
      <article><ul>
        <li>
          <h3><a href="https://www.instagram.com/maria.silva/">maria.silva</a></h3>
          <div><span dir="auto">Quero o CURRÍCULO, por favor!</span></div>
          <time datetime="2026-07-20T10:02:00Z"></time>
          <a href="https://www.instagram.com/p/ABC/?comment_id=101">2 min</a>
          <button>Responder</button>
        </li>
        <li>
          <a href="https://www.instagram.com/joao_21/">joao_21</a>
          <span dir="auto">ebook</span>
          <time datetime="2026-07-20T10:03:00Z"></time>
          <button>Reply</button>
        </li>
      </ul></article>
      <form id="commentSubmitFixture">
        <textarea id="commentEditor">@sabrina.almeidalima</textarea>
        <button type="button" id="commentSubmit" onclick="this.dataset.clicked='true'">Postar</button>
      </form>
      <div id="directSubmitFixture">
        <div id="directEditor" contenteditable="true" role="textbox">mensagem</div>
        <button type="button" id="directSubmit" onclick="this.dataset.clicked='true'">Send</button>
      </div>
    `);
    const comments = await page.evaluate(extractInstagramCommentsFromPage);
    assert.equal(comments.length, 3);
    assert.deepEqual(comments.map(comment => comment.username), ['ana.curriculo', 'maria.silva', 'joao_21']);
    assert.equal(comments[0].text, 'Quero o PDF');
    assert.match(comments[0].permalink, /\/p\/ABC\/c\/202\//);
    assert.equal(comments[1].text, 'Quero o CURRÍCULO, por favor!');
    assert.match(comments[1].permalink, /comment_id=101/);
    const replyPoint = await page.evaluate(findInstagramReplyPointOnPage, comments[0]);
    assert.equal(Number.isFinite(replyPoint?.x) && Number.isFinite(replyPoint?.y), true);
    await page.mouse.click(replyPoint.x, replyPoint.y);
    assert.equal(await page.$eval('#currentReply', element => element.dataset.clicked === 'true'), true);
    await page.focus('#commentEditor');
    await typeInstagramMessage(page, await page.$('#commentEditor'), 'Caiaque!!!!!', { separateFromExisting: true });
    assert.equal(await page.$eval('#commentEditor', element => element.value), '@sabrina.almeidalima Caiaque!!!!!');
    const commentSubmitPoint = await page.evaluate(findInstagramCommentSubmitPointOnPage);
    assert.equal(Number.isFinite(commentSubmitPoint?.x) && Number.isFinite(commentSubmitPoint?.y), true);
    await page.mouse.click(commentSubmitPoint.x, commentSubmitPoint.y);
    assert.equal(await page.$eval('#commentSubmit', element => element.dataset.clicked === 'true'), true);
    await page.focus('#directEditor');
    const directSubmitPoint = await page.evaluate(findInstagramDirectSubmitPointOnPage);
    assert.equal(Number.isFinite(directSubmitPoint?.x) && Number.isFinite(directSubmitPoint?.y), true);
    await page.mouse.click(directSubmitPoint.x, directSubmitPoint.y);
    assert.equal(await page.$eval('#directSubmit', element => element.dataset.clicked === 'true'), true);
    console.log('Leitura resiliente de comentários do Instagram validada com sucesso.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});

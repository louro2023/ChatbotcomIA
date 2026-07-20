async function typeInstagramMessage(page, element, message, options = {}) {
  const box = await element.boundingBox();
  if (!box) throw new Error('O editor de mensagem não está visível para receber o clique.');
  await page.mouse.click(box.x + (box.width / 2), box.y + (box.height / 2));

  // O Instagram preenche @usuario ao responder e o clique visual pode deixar o
  // cursor no meio da menção. Control+End garante que a mensagem seja anexada.
  await page.keyboard.down('Control');
  await page.keyboard.press('End');
  await page.keyboard.up('Control');

  if (options.separateFromExisting === true) {
    const existing = await element.evaluate(node => String('value' in node ? node.value : node.textContent || ''));
    if (existing && !/\s$/.test(existing)) await page.keyboard.type(' ');
  }

  const lines = String(message || '').split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (lines[index]) await page.keyboard.type(lines[index], { delay: 18 });
    if (index < lines.length - 1) {
      await page.keyboard.down('Shift');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Shift');
    }
  }
}

module.exports = { typeInstagramMessage };

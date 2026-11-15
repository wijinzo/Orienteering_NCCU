// Shared fullscreen dialogue pieces. Callers own story state and game rules.
export function storyNode(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
export function storyButton(text, handler, primary = false) {
  const element = storyNode('button', text, primary ? 'primary-button' : '');
  element.type = 'button'; element.onclick = handler;
  return element;
}
export function storyNext(handler) {
  const element = storyButton('▾', handler);
  element.className = 'story-next'; element.setAttribute('aria-label', '繼續對話');
  return element;
}
export function renderStoryScene(container, { text, actions = [], character = '奶龍', image = '/assets/characters/nailong.png' }) {
  const actor = storyNode('div', undefined, 'story-actor');
  const portrait = storyNode('img'); portrait.src = image; portrait.alt = character; portrait.width = 1058; portrait.height = 1444;
  actor.append(portrait);
  const paper = storyNode('div', undefined, 'story-paper');
  paper.append(storyNode('span', character, 'speaker'), storyNode('p', text, 'story-copy'));
  const controls = storyNode('div', undefined, 'story-controls'); controls.append(...actions); paper.append(controls);
  const advance = actions.length === 1 && actions[0].classList.contains('story-next') ? actions[0] : null;
  if (advance) {
    paper.classList.add('story-paper-advance');
    paper.addEventListener('click', event => {
      if (event.target.closest('button, input, a, select, textarea') || advance.disabled) return;
      advance.click();
    });
  }
  container.append(actor, paper);
}

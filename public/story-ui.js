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
  if (actions.length === 1 && actions[0].classList.contains('story-next')) paper.classList.add('story-paper-advance');
  // Options can be replaced with a next prompt after rendering (e.g. a late reader).
  // Resolve the live controls so the whole dialogue still advances in that case.
  paper.addEventListener('click', event => {
    if (event.target.closest('button, input, a, select, textarea')) return;
    const currentActions = [...controls.children];
    const advance = currentActions.length === 1 && currentActions[0].classList.contains('story-next') ? currentActions[0] : null;
    if (advance && !advance.disabled) advance.click();
  });
  container.append(actor, paper);
}

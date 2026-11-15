import {startAchievements} from './achievements.js';
import { createApi, createProgressStore } from './progress.js';
import { startJourney, stopJourney, renderJourneyProgress } from './journey.js';
import { startCheckpoint, protectExternalScan } from './checkpoint.js';
import {startJourneyLibrary,stopJourneyLibrary} from './journey-library.js';
import {startPrologue} from './prologue.js';

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'nccu-orienteering.token';
const DEVICE_KEY = 'nccu-orienteering.device';
let token = null, store = null, session = 0;
let teamProgress = null, lastProgressSnapshot = null;
const api = createApi(() => token);
const views = ['loading-view', 'login-view', 'recovery-view', 'home-view', 'scan-identity-view'];
const show = (id) => { for (const view of views) $(view).hidden = view !== id; };
function errorText(id, message) { $(id).textContent = message ?? ''; $(id).hidden = !message; }
function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch {} }
function loginScreen(message = '') {
  stopJourneyLibrary();
  stopJourney();
  teamProgress = null; lastProgressSnapshot = null;
  session += 1;
  token = null; clearToken(); store?.dispose(); store = null;
  $('login-form').reset(); $('invite-code').type = 'password';
  $('toggle-invite').textContent = '顯示'; $('toggle-invite').setAttribute('aria-pressed', 'false');
  $('choices-record').textContent = ''; $('completed-list').replaceChildren(); $('player-label').textContent = '';
  errorText('login-error', message); show('login-view');
  protectExternalScan();
}
function expired() { loginScreen('登入已過期，請選擇原組別並輸入邀請碼，接續你的身分。'); }
function dateText(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
function renderProgress(snapshot) {
  lastProgressSnapshot = snapshot;
  const { state, progress: personal, error } = snapshot;
  if (!personal) return;
  const progress = teamProgress ? { ...personal,
    completed_checkpoints: [...new Set([...personal.completed_checkpoints.filter(id => !['1', '2', '3', '4', '5', '7', '8', '9', '10', '11', '12', '13'].includes(id)), ...teamProgress.completed_checkpoints])],
    choices: { ...personal.choices, ...teamProgress.choices },
  } : personal;
  renderJourneyProgress(progress);
  $('completed-count').textContent = progress.completed_checkpoints.length;
  $('current-checkpoint').textContent = progress.current_checkpoint ?? '尚未開始';
  $('updated-at').textContent = dateText(progress.updated_at);
  $('save-status').textContent = { loaded: '已載入', saving: '保存中…', saved: '已保存', error: '尚未保存' }[state];
  $('save-status').dataset.state = state;
  $('retry-save').hidden = state !== 'error';
  errorText('progress-error', error?.message);
  $('completed-list').replaceChildren(...(progress.completed_checkpoints.length ? progress.completed_checkpoints : ['尚無完成紀錄']).map((id) => {
    const item = document.createElement('li'); item.textContent = id; return item;
  }));
  $('choices-record').textContent = Object.keys(progress.choices).length ? JSON.stringify(progress.choices, null, 2) : '尚無選擇紀錄';
}
function enterHome(player, progress) {
  store?.dispose();
  store = createProgressStore({ api, onChange: renderProgress, onAuthExpired: expired });
  store.initialize(progress);
  $('player-label').textContent = player.player_code;
  const match = /^\/checkpoint\/([A-Za-z0-9_-]{1,80})\/?$/.exec(location.pathname);
  $('checkpoint-notice').hidden = true;
  if (match) $('checkpoint-message').textContent = `你已抵達關卡 ${match[1]}。`;
  show('home-view');
  startJourney(api, player);
  startCheckpoint(api, player);
  startJourneyLibrary(api,player);
  startPrologue(api,player);
  startAchievements(api,player);
}

async function restore() {
  const attempt = ++session;
  show('loading-view');
  try {
    const { player } = await api('/api/me',{wait:true,waitLabel:'正在確認你的冒險者身分…'});
    const { progress } = await api('/api/progress',{wait:true,waitLabel:'正在找回你的旅程…'});
    if (attempt === session) enterHome(player, progress);
  } catch (error) {
    if (attempt !== session) return;
    if (error.code === 'AUTH_INVALID') return expired();
    $('recovery-message').textContent = error.message; show('recovery-view');
  }
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const selected = document.querySelector('input[name="team_number"]:checked');
  if (!selected) return errorText('login-error', '請先選擇組別。');
  const attempt = ++session;
  const button = $('login-button'); button.disabled = true; button.firstElementChild.textContent = '登入中…';
  errorText('login-error', '');
  try {
    let deviceKey;
    try {
      deviceKey = localStorage.getItem(DEVICE_KEY);
      if (!/^[a-f0-9]{64}$/.test(deviceKey ?? '')) {
        deviceKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(DEVICE_KEY, deviceKey);
      }
    } catch { throw new Error('瀏覽器無法保存身分，請允許網站儲存資料後再試。'); }
    const result = await api('/api/auth/login', { method: 'POST', token: null, body: { team_number: Number(selected.value), device_key: deviceKey, invite_code: $('invite-code').value } });
    if (attempt !== session) return;
    try { localStorage.setItem(TOKEN_KEY, result.token); }
    catch { throw new Error('瀏覽器無法保存登入資料，請允許網站儲存資料後再試。'); }
    token = result.token; $('invite-code').value = '';
    enterHome(result.player, result.progress);
  } catch (error) { if (attempt === session) errorText('login-error', error.message); }
  finally { button.disabled = false; button.firstElementChild.textContent = '加入隊伍'; }
});
$('toggle-invite').addEventListener('click', () => {
  const visible = $('invite-code').type === 'password';
  $('invite-code').type = visible ? 'text' : 'password';
  $('toggle-invite').textContent = visible ? '隱藏' : '顯示';
  $('toggle-invite').setAttribute('aria-pressed', String(visible));
});
function logout() {
  if (store?.hasUnsavedChanges() && !confirm('還有尚未保存的進度。確定要登出並捨棄這些變更嗎？')) return;
  loginScreen();
}
$('logout-button').addEventListener('click', logout);
$('choose-team-again').addEventListener('click', logout);
$('recovery-logout').addEventListener('click', logout);
$('retry-restore').addEventListener('click', restore);
$('reload-progress').addEventListener('click', async () => {
  const activeStore = store, attempt = session;
  $('reload-progress').disabled = true;
  try { await activeStore.load(); }
  catch (error) {
    if (attempt !== session) return;
    if (error.code === 'AUTH_INVALID') expired(); else errorText('progress-error', error.message);
  } finally { $('reload-progress').disabled = false; }
});
$('retry-save').addEventListener('click', () => store?.retry());
window.addEventListener('beforeunload', (event) => { if (store?.hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('checkpoint-progress', event => { teamProgress = event.detail; if (lastProgressSnapshot) renderProgress(lastProgressSnapshot); });
window.addEventListener('storage', (event) => {
  if (event.key === TOKEN_KEY || event.key === null) {
    stopJourney();
    teamProgress = null; lastProgressSnapshot = null;
    // Prevent another tab's login from silently changing which player receives saves.
    session += 1; store?.dispose(); store = null;
    try { token = localStorage.getItem(TOKEN_KEY); } catch { token = null; }
    if (token) restore(); else loginScreen();
  }
});

// Future checkpoint pages call this only when their state changes.
// There is deliberately no game/score logic attached in version 1.
export function getProgress() { return store?.getProgress() ?? null; }
export async function saveProgress(next) {
  if (!store) throw new Error('請先登入。');
  return store.update(next);
}

try { token = localStorage.getItem(TOKEN_KEY); } catch {}
if (token) restore(); else if (!protectExternalScan()) show('login-view');

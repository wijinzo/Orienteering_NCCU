import {beginNetworkWait} from './network-wait.js';
// Shared by the homepage and future checkpoint pages. No offline persistence.
export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

export function createApi(getToken, request = fetch, waitFor = beginNetworkWait) {
  return async (path, { method = 'GET', body, token = getToken(), timeoutMs = 15000, wait = method !== 'GET', waitLabel, signal } = {}) => {
    const finish=wait?waitFor(waitLabel??'奶蛙正在幫你傳遞訊息…'):()=>{};
    try {
    let response;
    try {
      response = await request(path, {
        method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs), cache: 'no-store',
      });
    } catch { throw new ApiError('連線暫時中斷，請確認網路後重試。', 0, 'NETWORK_ERROR'); }
    let result;
    try { result = await response.json(); }
    catch { throw new ApiError('伺服器尚未就緒，請稍後重試。', response.status, 'SERVER_UNAVAILABLE'); }
    if (!response.ok) throw new ApiError(result.error ?? '操作失敗，請稍後重試。', response.status, result.code);
    return result;
    } finally { finish(); }
  };
}

export function editableProgress(progress) {
  return {
    current_checkpoint: progress.current_checkpoint,
    completed_checkpoints: structuredClone(progress.completed_checkpoints),
    choices: structuredClone(progress.choices),
  };
}

// Serializes writes; an older response can never replace newer edits in this page.
export function createProgressStore({ api, onChange = () => {}, onAuthExpired = () => {} }) {
  let saved = null, draft = null, pending = false, running = null, disposed = false;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const emit = (state, error = null) => {
    if (!disposed) onChange({ state, error, progress: structuredClone(draft ?? saved) });
  };
  async function flush() {
    if (running) return running;
    running = (async () => {
      while (pending && !disposed) {
        pending = false;
        const snapshot = editableProgress(draft);
        emit('saving');
        try {
          const result = await api('/api/progress', { method: 'PUT', body: snapshot });
          if (disposed) return;
          saved = structuredClone(result.progress);
          if (equal(editableProgress(draft), snapshot)) draft = structuredClone(saved);
        } catch (error) {
          if (disposed) return;
          pending = true;
          emit('error', error);
          if (error.code === 'AUTH_INVALID') onAuthExpired(error);
          return;
        }
      }
      if (!disposed) emit('saved');
    })().finally(() => { running = null; });
    return running;
  }
  return {
    initialize(progress) { saved = structuredClone(progress); draft = structuredClone(progress); pending = false; emit('loaded'); },
    getProgress() { return structuredClone(draft); },
    hasUnsavedChanges() { return pending || running !== null; },
    async load() {
      if (pending || running) throw new ApiError('還有尚未保存的變更，請先重試保存。', 0, 'UNSAVED_CHANGES');
      const result = await api('/api/progress',{wait:true,waitLabel:'正在找回你的探索紀錄…'});
      if (!disposed) this.initialize(result.progress);
    },
    async update(next) {
      if (disposed || !saved) throw new Error('Progress store is not ready');
      const value = editableProgress(next);
      if (equal(value, editableProgress(draft)) && !pending) return;
      draft = { ...value, updated_at: saved.updated_at };
      pending = true;
      return flush();
    },
    retry() { return pending ? flush() : Promise.resolve(); },
    dispose() { disposed = true; pending = false; saved = null; draft = null; },
  };
}

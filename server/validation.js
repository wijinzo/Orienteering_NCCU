export class InputError extends Error {}
export function parseRegistration(body) {
  if (!isRecord(body) || !Number.isInteger(body.team_number) || body.team_number < 1 || body.team_number > 10) throw new InputError('請選擇第 1～10 組。');
  if (typeof body.device_key !== 'string' || !/^[a-f0-9]{64}$/.test(body.device_key)) throw new InputError('無法辨識此裝置，請重新整理後再試。');
  if (typeof body.invite_code !== 'string' || !body.invite_code || body.invite_code.length > 200) throw new InputError('請輸入活動邀請碼。');
  return { teamNumber: body.team_number, deviceKey: body.device_key, inviteCode: body.invite_code };
}
export const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseProgress(body) {
  if (!isRecord(body)) throw new InputError('進度格式錯誤。');
  const fields = ['current_checkpoint', 'completed_checkpoints', 'choices'];
  if (Object.keys(body).some((key) => !fields.includes(key)) || fields.some((key) => !(key in body))) {
    throw new InputError('進度僅接受 current_checkpoint、completed_checkpoints、choices 三個欄位。');
  }
  const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
  if (body.current_checkpoint !== null && !validId(body.current_checkpoint)) throw new InputError('目前關卡格式錯誤。');
  if (!Array.isArray(body.completed_checkpoints) || body.completed_checkpoints.length > 100 ||
      !body.completed_checkpoints.every(validId)) throw new InputError('已完成關卡格式錯誤。');
  if (!isRecord(body.choices) || JSON.stringify(body.choices).length > 16000) throw new InputError('選擇紀錄格式錯誤或過大。');
  return {
    current_checkpoint: body.current_checkpoint,
    completed_checkpoints: [...new Set(body.completed_checkpoints)],
    choices: body.choices,
  };
}

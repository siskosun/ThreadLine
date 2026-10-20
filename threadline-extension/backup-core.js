/* Portable state backups for ThreadLine. Never include model API keys or browser cookies. */
const ThreadLineBackup = (() => {
  const FORMAT = 'threadline-state-backup-v1';
  const MAX_BYTES = 2_000_000;
  const SNAPSHOT_LIMIT = 5;
  const MAX_URL_LENGTH = 900;
  function assertState(state) {
    const migrated = ThreadLineCore.migrate(state);
    for (const [key,chat] of Object.entries(migrated.chats)) {
      if (chat.key && chat.key !== key) throw new Error('备份包含不一致的对话标识');
      if (typeof chat.title !== 'string' || !Number.isInteger(chat.seenVersion) || chat.seenVersion < 0)
        throw new Error('备份中的对话数据无效');
      if (chat.url && (typeof chat.url !== 'string' || chat.url.length > MAX_URL_LENGTH || !ThreadLineCore.isChatURL(chat.url)))
        throw new Error('备份中的对话链接不受支持');
    }
    return migrated;
  }
  function create(state, snapshots=[]) {
    return {
      format:FORMAT, exportedAt:new Date().toISOString(), schema:ThreadLineCore.SCHEMA,
      state: assertState(state),
      snapshots:snapshots.slice(-SNAPSHOT_LIMIT).map(s=>({at:s.at,reason:s.reason,revision:s.state?.revision}))
    };
  }
  function parse(input) {
    if (typeof input !== 'string' || input.length > MAX_BYTES) throw new Error('备份文件超过 2MB 或内容无效');
    let data;
    try { data = JSON.parse(input); } catch { throw new Error('备份不是有效 JSON'); }
    if (data?.format !== FORMAT || !data.state || !Number.isInteger(data.schema)) throw new Error('不是 ThreadLine 的有效状态备份');
    if (data.schema > ThreadLineCore.SCHEMA) throw new Error('该备份来自更新版本，请先升级扩展');
    return assertState(data.state);
  }
  return {FORMAT,MAX_BYTES,SNAPSHOT_LIMIT,create,parse,assertState};
})();
if (typeof globalThis !== 'undefined') globalThis.ThreadLineBackup = ThreadLineBackup;
if (typeof module !== 'undefined') module.exports = ThreadLineBackup;

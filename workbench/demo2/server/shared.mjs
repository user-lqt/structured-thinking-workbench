import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const token = () => randomBytes(24).toString('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// A single Node process serializes each compare-and-write without an await in between.
export function sharedProjects(directory) {
  mkdirSync(directory, { recursive: true });
  const fileOf = (id) => /^[a-zA-Z0-9_-]{1,64}$/.test(id || '') ? path.join(directory, `${id}.json`) : null;
  const read = (id) => { const file = fileOf(id); return file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; };
  const save = (row) => {
    const file = fileOf(row.id);
    writeFileSync(`${file}.tmp`, JSON.stringify(row));
    renameSync(`${file}.tmp`, file);
  };
  const auth = (req, id) => {
    const key = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const row = read(id);
    if (!row) return null;
    const role = same(key, row.owner) ? 'organizer' : same(key, row.editor) ? 'member' : same(key, row.viewer) ? 'viewer' : '';
    return role ? { row, role } : null;
  };
  const publicRow = (row, role) => ({ id: row.id, revision: row.revision, updatedAt: row.updatedAt, doc: row.doc, role });
  return {
    auth,
    read,
    create(doc, requestedId) {
      if (read(requestedId)) return { status: 409, error: '该项目已经共享，请使用原组织者邀请链接进入。' };
      const id = fileOf(requestedId) && !read(requestedId) ? requestedId : `shared-${token().slice(0, 16)}`;
      const row = { id, revision: 1, owner: token(), editor: token(), viewer: token(), doc, updatedAt: new Date().toISOString() };
      save(row);
      return { ...publicRow(row, 'organizer'), tokens: { organizer: row.owner, member: row.editor, viewer: row.viewer } };
    },
    get(session) { return publicRow(session.row, session.role); },
    update(session, revision, doc) {
      const row = read(session.row.id);
      if (session.role === 'viewer') return { status: 403, error: '只读邀请不能修改项目。' };
      if (revision !== row.revision) return { status: 409, error: '另一位成员已保存新版本。你的本机草稿已保留，请先下载草稿，再载入共享版本。', revision: row.revision };
      row.doc = doc;
      row.revision++;
      row.updatedAt = new Date().toISOString();
      save(row);
      return publicRow(row, session.role);
    },
    rotate(session) {
      if (session.role !== 'organizer') return { status: 403, error: '只有组织者可以重置邀请链接。' };
      const row = read(session.row.id);
      row.editor = token(); row.viewer = token();
      save(row);
      return { tokens: { organizer: row.owner, member: row.editor, viewer: row.viewer } };
    }
  };
}

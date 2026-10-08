import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { absent, ownedDirectory, safePath, scopeId } from './workspace-io.js';

const bytes = value => typeof value === 'string' ? Buffer.from(value) : Buffer.from(value.base64, 'base64');
const exists = filename => { try { fs.lstatSync(filename); return true; } catch (error) { if (absent(error)) return false; throw error; } };
const write = (filename, value) => { const fd = fs.openSync(filename, 'wx', 0o600); try { fs.writeFileSync(fd, bytes(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };

// The SQLite intent is committed before any skill moves. Recovery only accepts
// recorded before/after hashes, and never replaces an unexpected file.
export class PublicationJournal {
 constructor(db, io, leasePath, checkpoint = () => {}) {
  this.db = db; this.io = io; this.checkpoint = checkpoint; this.lease = new DatabaseSync(leasePath); this.lease.exec('PRAGMA busy_timeout=0;');
  db.exec(`PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY,scope TEXT NOT NULL,state TEXT NOT NULL,owner INTEGER NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,payload TEXT NOT NULL,error TEXT);
   CREATE INDEX IF NOT EXISTS publication_scope ON publications(scope,updated);
   CREATE TABLE IF NOT EXISTS publication_paths(path TEXT PRIMARY KEY,publication TEXT NOT NULL);`);
 }
 transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
 withLease(fn, busy) {
  try { this.lease.exec('BEGIN IMMEDIATE'); } catch (error) { if (error.errcode===5||/database is locked/.test(error.message)) return busy(); throw error; }
  try { return fn(); } finally { this.lease.exec('ROLLBACK'); }
 }
 paths(spec) {
  if (fs.realpathSync(spec.cwd) !== spec.cwd || !this.io.editable(spec.cwd, path.join(spec.root, spec.target, 'SKILL.md'))) throw new Error('技能目录范围已变化');
  const destination = safePath(spec.root, spec.target), parent = path.dirname(spec.root);
  if (path.dirname(spec.transaction) !== parent || !/^\.dsh-workshop-[a-f0-9-]{36}$/.test(path.basename(spec.transaction))) throw new Error('发布记录路径无效');
  const transaction = safePath(parent, path.basename(spec.transaction));
  if (spec.previous && spec.action !== 'duplicate') {
   if (path.dirname(spec.previous) !== spec.root || safePath(spec.root, path.basename(spec.previous)) !== spec.previous) throw new Error('原技能目录范围已变化');
  }
  return { destination, transaction, old: path.join(transaction, 'previous'), next: path.join(transaction, 'next') };
 }
 read(filename, flat, limits) { return exists(filename) ? this.io.read(filename, flat, limits) : null; }
 rows(cwd) {
  return this.db.prepare("SELECT id,state,created,updated,error,payload FROM publications WHERE scope=? AND state IN ('prepared','committed','needs-review') ORDER BY updated DESC").all(scopeId(cwd)).map(row => {
   const spec = JSON.parse(row.payload);
   return { id: row.id, name: spec.name, state: row.state, created: row.created, updated: row.updated, error: row.error, recoveryDirectory: spec.transaction };
  });
 }
 update(id, state, error = null) {
  if (['cleaned', 'rolled-back'].includes(state)) this.db.prepare('DELETE FROM publications WHERE id=?').run(id);
  else this.db.prepare('UPDATE publications SET state=?,owner=0,updated=?,error=? WHERE id=?').run(state, Date.now(), error, id);
 }
 settled(id, applied) {
  this.transaction(() => {
   this.db.prepare("UPDATE proposals SET state=? WHERE id=? AND state IN ('publishing','needs-review')").run(applied ? 'applied' : 'pending', id);
   this.update(id, applied ? 'committed' : 'rolled-back');
   if (applied) this.db.prepare('UPDATE publications SET owner=? WHERE id=?').run(process.pid, id);
   this.db.prepare('DELETE FROM publication_paths WHERE publication=?').run(id);
  });
 }
 needsReview(id) {
  this.transaction(() => {
   this.update(id, 'needs-review', '文件与发布记录不一致，已保留现场；处理外部改动后重新核对。');
   this.db.prepare("UPDATE proposals SET state='needs-review' WHERE id=? AND state='publishing'").run(id);
  });
 }
 stagingMatches(filename, spec) {
  if (!exists(filename)) return true;
  const info = fs.lstatSync(filename); if (info.isSymbolicLink()) return false;
  if (spec.outputFlat) return info.isFile() && info.size <= spec.limits.maxSkillBytes && fs.readFileSync(filename).equals(bytes(spec.files['SKILL.md']));
  if (!info.isDirectory()) return false;
  const walk = (directory, prefix = '') => {
   for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = prefix + entry.name, target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return false;
    if (entry.isDirectory()) { if (!Object.keys(spec.files).some(file => file.startsWith(name + '/')) || !walk(target, name + '/')) return false; }
    else if (!entry.isFile() || !Object.hasOwn(spec.files, name) || fs.statSync(target).size > spec.limits.maxBundleBytes || !fs.readFileSync(target).equals(bytes(spec.files[name]))) return false;
   }
   return true;
  };
  return walk(filename);
 }
 cleanup(spec, locations) {
  if (!exists(locations.transaction)) return true;
  const info = fs.lstatSync(locations.transaction);
  if (info.isSymbolicLink() || !info.isDirectory() || fs.realpathSync(locations.transaction) !== locations.transaction) return false;
  const entries = fs.readdirSync(locations.transaction);
  if (entries.some(name => !['previous', 'next'].includes(name))) return false;
  if (!this.stagingMatches(locations.old, { ...spec, outputFlat: spec.originalFlat, files: spec.beforeFiles })) return false;
  if (!this.stagingMatches(locations.next, spec)) return false;
  // Both paths were checked against the durable intent, including all child
  // files and links. This removes only the transaction owned by this proposal.
  const remove = filename => {
   const item = fs.lstatSync(filename); if (item.isSymbolicLink()) throw new Error('恢复目录出现链接');
   if (item.isDirectory()) { for (const name of fs.readdirSync(filename)) remove(path.join(filename, name)); fs.rmdirSync(filename); }
   else { fs.unlinkSync(filename); this.checkpoint('cleanup-file'); }
  };
  remove(locations.transaction); return true;
 }
 reconcile(row, rollback = false) {
  const spec = JSON.parse(row.payload), locations = this.paths(spec);
  const proposal = this.db.prepare('SELECT state FROM proposals WHERE id=?').get(row.id);
  if (!proposal) throw new Error('发布提案不存在');
  if (proposal.state === 'applied') {
   if (!this.cleanup(spec, locations)) throw new Error('恢复目录出现外部修改');
   this.update(row.id, 'cleaned'); return;
  }
  const previous = spec.previous ? this.read(spec.previous, spec.originalFlat, spec.limits) : null;
  const destination = this.read(locations.destination, spec.outputFlat, spec.limits);
  const old = this.read(locations.old, spec.originalFlat, spec.limits);
  const moved = !!spec.previous && spec.action !== 'duplicate';
  const originalUnchanged = !moved || previous === spec.beforeHash;
  const originalMoved = moved && old === spec.beforeHash && previous === null;
  const published = spec.action === 'delete' ? originalMoved && destination === null : destination === spec.afterHash && (!moved || old === spec.beforeHash) && (spec.previous === locations.destination || !moved || previous === null);
  if (published && !rollback) {
   this.settled(row.id, true);
   if (!this.cleanup(spec, locations)) throw new Error('恢复目录出现外部修改');
   this.update(row.id, 'cleaned'); this.io.notify(spec, locations.destination); return;
  }
  if (published && rollback && spec.action !== 'delete') {
   if (exists(locations.next)) throw new Error('暂存文件与发布状态冲突');
   fs.renameSync(locations.destination, locations.next);
  } else if (!published && destination !== (spec.previous === locations.destination ? spec.beforeHash : null) && !(originalMoved && destination === null)) throw new Error('目标技能出现外部修改');
  if (old !== null && old !== spec.beforeHash) throw new Error('原技能备份出现外部修改');
  if (moved && !originalUnchanged) {
   if (!originalMoved && !(published && rollback && (spec.previous === locations.destination || previous === null))) throw new Error('原技能出现外部修改');
   if (exists(spec.previous) || old !== spec.beforeHash) throw new Error('恢复原技能需要重新审阅');
   fs.renameSync(locations.old, spec.previous);
  }
  if (!this.cleanup(spec, locations)) throw new Error('暂存目录出现外部修改');
  this.settled(row.id, false);
  this.io.notify(spec, locations.destination);
  if(spec.source)this.io.notify({...spec,action:'delete'},locations.destination);
 }
 recover(cwd) {
  this.withLease(()=>this.recoverLocked(cwd),()=>{});return cwd?this.rows(cwd):undefined;
 }
 recoverLocked(cwd) {
  const rows = this.db.prepare("SELECT * FROM publications WHERE state IN ('prepared','committed','needs-review')" + (cwd ? ' AND scope=?' : '')).all(...cwd ? [scopeId(cwd)] : []);
  for (const row of rows) {
   const claim = this.db.prepare('UPDATE publications SET owner=? WHERE id=? AND owner=? AND state=? AND updated=?').run(process.pid, row.id, row.owner, row.state, row.updated);
   if (claim.changes !== 1) continue;
   try { this.reconcile(row); } catch { this.needsReview(row.id); }
  }
 }
 apply(cwd, proposal, limits) {
  return this.withLease(()=>this.applyLocked(cwd,proposal,limits),()=>{throw new Error('技能正在另一个进程发布，请稍后重试');});
 }
 applyLocked(cwd, proposal, limits) {
  const transaction = path.join(path.dirname(proposal.root), '.dsh-workshop-' + randomUUID());
  const spec = { cwd: fs.realpathSync(cwd), name: proposal.name, action: proposal.action, root: proposal.root, target: proposal.target, source: proposal.source, previous: proposal.source ? (proposal.flat ? proposal.source : path.dirname(proposal.source)) : null, originalFlat: proposal.flat, outputFlat: proposal.flat && !['rename', 'duplicate'].includes(proposal.action), beforeHash: proposal.baseRevision, afterHash: proposal.action === 'delete' ? null : this.io.hash(proposal.files), beforeFiles: proposal.before, files: proposal.files, transaction, limits };
  const locations = this.paths(spec), resources = [...new Set([locations.destination, ...spec.previous && spec.action !== 'duplicate' ? [spec.previous] : []])];
  this.transaction(() => {
   const changed = this.db.prepare("UPDATE proposals SET state='publishing' WHERE id=? AND state='pending'").run(proposal.id); if (changed.changes !== 1) throw new Error('此提案已经处理');
   this.db.prepare('INSERT OR REPLACE INTO publications VALUES(?,?,?,?,?,?,?,NULL)').run(proposal.id, scopeId(cwd), 'prepared', process.pid, Date.now(), Date.now(), JSON.stringify(spec));
   for (const resource of resources) this.db.prepare('INSERT INTO publication_paths VALUES(?,?)').run(resource.toLocaleLowerCase('en-US'), proposal.id);
  });
  try {
   this.checkpoint('intent'); ownedDirectory(path.dirname(transaction), path.basename(transaction));
   if (spec.action !== 'delete') {
    if (spec.outputFlat) write(locations.next, spec.files['SKILL.md']);
    else { fs.mkdirSync(locations.next); for (const [relative, value] of Object.entries(spec.files)) { const filename = safePath(locations.next, relative); fs.mkdirSync(path.dirname(filename), { recursive: true }); write(filename, value); this.checkpoint('staged-file'); } }
   }
   this.checkpoint('staged');
   if (spec.previous && this.read(spec.previous, spec.originalFlat, limits) !== spec.beforeHash) throw new Error('准备发布时技能被外部修改，提案未发布');
   if (spec.previous && spec.action !== 'duplicate') fs.renameSync(spec.previous, locations.old);
   this.checkpoint('moved');
   if (spec.action !== 'delete') fs.renameSync(locations.next, locations.destination);
   this.checkpoint('published'); this.settled(proposal.id, true); this.checkpoint('committed');
   try { if (this.cleanup(spec, locations)) this.update(proposal.id, 'cleaned'); else this.needsReview(proposal.id); } catch { this.needsReview(proposal.id); }
   this.io.notify(spec, locations.destination);
  } catch (error) {
   const row = this.db.prepare('SELECT * FROM publications WHERE id=?').get(proposal.id);
   try { this.reconcile(row, true); } catch { this.needsReview(proposal.id); }
   throw error;
  }
 }
 close(){this.lease.close();}
}

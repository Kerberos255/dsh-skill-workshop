import test from 'node:test';
import assert from 'node:assert/strict';
import {crc32} from 'node:zlib';
import {readZip} from '../zip.js';
const cfg={maxBundleBytes:1024,maxBundleFiles:3};
function archive(name,data){
 const filename=Buffer.from(name),content=Buffer.from(data),crc=crc32(content);
 const local=Buffer.alloc(30);
 local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(0x0800,6);local.writeUInt32LE(crc,14);
 local.writeUInt32LE(content.length,18);local.writeUInt32LE(content.length,22);local.writeUInt16LE(filename.length,26);
 const central=Buffer.alloc(46);
 central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(0x0800,8);
 central.writeUInt32LE(crc,16);central.writeUInt32LE(content.length,20);central.writeUInt32LE(content.length,24);
 central.writeUInt16LE(filename.length,28);
 const count=Buffer.alloc(22);count.writeUInt32LE(0x06054b50,0);
 count.writeUInt16LE(1,8);count.writeUInt16LE(1,10);count.writeUInt32LE(central.length+filename.length,12);
 count.writeUInt32LE(local.length+filename.length+content.length,16);
 return Buffer.concat([local,filename,content,central,filename,count]);
}
test('readZip extracts one bounded UTF-8 SKILL.md',()=>{
 const zip=archive('skill/SKILL.md','# Sample skill');
 const files=readZip(zip,cfg);
 assert.equal(files['SKILL.md'],'# Sample skill');
});
test('zip slip names are rejected',()=>{
 assert.throws(()=>readZip(archive('../SKILL.md','bad'),cfg),/路径/);
 assert.throws(()=>readZip(archive('C:/SKILL.md','bad'),cfg),/路径/);
});
test('incomplete zip, absent SKILL.md and CRC mismatch are rejected',()=>{
 assert.throws(()=>readZip(Buffer.from('bad'),cfg));
 assert.throws(()=>readZip(archive('readme.md','text'),cfg),/SKILL/);
 const corrupt=archive('SKILL.md','hello');corrupt[35]^=2;
 assert.throws(()=>readZip(corrupt,cfg));
});

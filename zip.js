import { inflateRawSync, crc32 } from 'node:zlib';
import { isUtf8 } from 'node:buffer';

// Small bounded reader, never extracts paths to disk or runs imported resources.
// ZIP64, encryption, links and unsupported compression need explicit conversion.
export function readZip(bytes, config) {
 if(!Buffer.isBuffer(bytes)||bytes.length<22||bytes.length>config.maxBundleBytes*2)throw new Error('ZIP 大小无效');
 let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
 if(end<0)throw new Error('ZIP 目录不完整');
 const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16);
 if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||count!==bytes.readUInt16LE(end+8)||count===65535||count>config.maxBundleFiles*3+100||offset+size!==end)throw new Error('ZIP 分卷、ZIP64 或条目数量不受支持');
 const entries=[],seen=new Set(),regions=[];let cursor=offset,total=0;
 for(let i=0;i<count;i++){
  if(cursor+46>end||bytes.readUInt32LE(cursor)!==0x02014b50)throw new Error('ZIP 目录条目损坏');
  const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),crc=bytes.readUInt32LE(cursor+16),compressed=bytes.readUInt32LE(cursor+20),length=bytes.readUInt32LE(cursor+24),nameLength=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),attributes=bytes.readUInt32LE(cursor+38),local=bytes.readUInt32LE(cursor+42),stop=cursor+46+nameLength+extra+comment;
  if(stop>end||!nameLength||flags&~0x080e||![0,8].includes(method)||compressed===0xffffffff||length===0xffffffff||local===0xffffffff||bytes.readUInt16LE(cursor+34))throw new Error('ZIP 使用了不支持的编码或压缩方式');
  const rawName=bytes.subarray(cursor+46,cursor+46+nameLength);
  if(!isUtf8(rawName)||(!(flags&0x0800)&&rawName.some(value=>value>127)))throw new Error('ZIP 文件名必须使用 UTF-8');
  const name=rawName.toString('utf8'),directory=name.endsWith('/'),parts=(directory?name.slice(0,-1):name).split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'||/[\\:\0<>"|?*]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw new Error('ZIP 包含无效或越界路径');
  const key=name.normalize('NFKC').toLocaleLowerCase('en-US');if(seen.has(key))throw new Error('ZIP 包含重复文件名');seen.add(key);
  const type=(attributes>>>16)&0o170000;
  if(type&&type!==(directory?0o040000:0o100000))throw new Error('ZIP 包含链接或特殊文件');
  if(local+30>offset||bytes.readUInt32LE(local)!==0x04034b50||bytes.readUInt16LE(local+6)!==flags||bytes.readUInt16LE(local+8)!==method)throw new Error('ZIP 本地条目损坏');
  const localName=bytes.readUInt16LE(local+26),start=local+30+localName+bytes.readUInt16LE(local+28),finish=start+compressed;
  if(start>offset||finish>offset||!bytes.subarray(local+30,local+30+localName).equals(rawName)||regions.some(([a,b])=>local<b&&finish>a))throw new Error('ZIP 文件数据重叠或名称不匹配');
  regions.push([local,finish]);cursor=stop;
  if(directory){if(length)throw new Error('ZIP 目录包含文件数据');continue;}
  total+=length;if(total>config.maxBundleBytes||entries.length>=config.maxBundleFiles)throw new Error('ZIP 解压大小或文件数量超过限制');
  let value;try{value=method===0?bytes.subarray(start,finish):inflateRawSync(bytes.subarray(start,finish),{maxOutputLength:Math.max(1,length)});}catch{throw new Error('ZIP 压缩数据损坏或超过声明大小');}
  if(value.length!==length||crc32(value)!==crc)throw new Error('ZIP 文件校验失败');
  entries.push([name,value]);
 }
 if(cursor!==end)throw new Error('ZIP 目录长度不匹配');
 const skills=entries.filter(([name])=>name==='SKILL.md'||name.endsWith('/SKILL.md'));
 if(skills.length!==1)throw new Error('ZIP 必须包含一个 SKILL.md');
 const prefix=skills[0][0].slice(0,-8),files=Object.create(null);
 for(const [name,value]of entries){if(!name.startsWith(prefix))throw new Error('ZIP 资源必须位于同一个技能目录');const relative=name.slice(prefix.length);files[relative]=isUtf8(value)&&!value.includes(0)?value.toString('utf8'):{base64:value.toString('base64')};}
 return files;
}

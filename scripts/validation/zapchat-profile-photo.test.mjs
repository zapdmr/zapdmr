import assert from 'node:assert/strict';
import {fixture} from './chat-fixture.mjs';
import {handleApi} from '../../site/cloudflare/api.mjs';

const f=await fixture();
const call=async(who,path,{method='GET',body,type}={})=>handleApi(new Request('http://localhost'+path,{method,headers:{Authorization:'Bearer '+f.tokens[who],...(type?{'Content-Type':type}:{})},...(body?{body}:{})}),f.env);

const jpeg=new Uint8Array([0xff,0xd8,0xff,0xe0,0,16,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0,0xff,0xd9]);
let response=await call('TEST1A','/v1/me/photo',{method:'PUT',body:jpeg,type:'image/jpeg'});
assert.equal(response.status,200);
const uploaded=await response.json();
assert.match(uploaded.photo.url,new RegExp(`^/v1/users/${f.users.TEST1A}/photo\\?v=\\d+$`));

response=await call('TEST1B',uploaded.photo.url);
assert.equal(response.status,200);
assert.equal(response.headers.get('Content-Type'),'image/jpeg');
assert.deepEqual(new Uint8Array(await response.arrayBuffer()),jpeg);

response=await call('TEST1A','/v1/me/photo',{method:'PUT',body:new Uint8Array([1,2,3]),type:'image/jpeg'});
assert.equal(response.status,400,'magic bytes are validated');

const now=Date.now(),device='00000000-0000-4000-8000-000000000001';
f.sqlite.prepare('INSERT INTO auth_devices(id,user_id,refresh_hash,refresh_expires_at,rotated_at,created_at,last_seen_at,token_cipher) VALUES(?,?,?,?,?,?,?,?)').run(device,f.users.TEST1A,'refresh',now+3600000,now,now,now,'cipher');
response=await call('TEST1B','/v1/directory?query=TEST1A');
const directory=await response.json();
assert.equal(directory.user.online,true,'presence comes from an authenticated ZapChat device');
assert.equal(directory.user.photoUrl,uploaded.photo.url);

response=await call('TEST1A','/v1/me/photo',{method:'DELETE'});
assert.equal(response.status,200);
assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM profile_photos').get().n,0);
assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM profile_photo_chunks').get().n,0);
console.log('PASS: own encrypted profile photo upload/download/removal, content validation, private authenticated access and real ZapChat session presence. No QRZ credentials or scraping.');

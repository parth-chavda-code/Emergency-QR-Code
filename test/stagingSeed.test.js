import test from 'node:test';
import assert from 'node:assert/strict';
import { stagingSeedConfig, syntheticProfiles } from '../scripts/seed-staging.js';
import { profileSchema } from '../backend/validation/profile.js';
import { prepareProfileStorage, readPublicSnapshot } from '../backend/security/profileStorage.js';
const env={STAGING_MONGODB_URI:'mongodb://127.0.0.1:27018/emergency_qr_staging?replicaSet=emergencyQrDev',STAGING_PROFILE_ENCRYPTION_KEY:'ab'.repeat(32),STAGING_SEED_PASSWORD:'Synthetic-test-only!2026'};
test('staging seeder refuses local/default and wrong database configuration',()=>{
 assert.equal(stagingSeedConfig(env).uri,env.STAGING_MONGODB_URI);
 for(const uri of [undefined,'mongodb://127.0.0.1:27018/emergency_qr','mongodb://127.0.0.1:27017/admin','https://example.test/emergency_qr_staging'])assert.throws(()=>stagingSeedConfig({...env,STAGING_MONGODB_URI:uri}));
 assert.throws(()=>stagingSeedConfig({dbconnection:env.STAGING_MONGODB_URI}));
 assert.throws(()=>stagingSeedConfig({...env,STAGING_SEED_PASSWORD:'weak'}));
 assert.throws(()=>stagingSeedConfig({...env,STAGING_PROFILE_ENCRYPTION_KEY:'bad'}));
});
test('synthetic fixtures validate, encrypt and include a private-by-default scenario',()=>{
 for(const fixture of syntheticProfiles){
  assert.match(fixture.email,/@example\.test$/);
  const profile=profileSchema.parse(fixture.profile);
  const stored={_id:'507f1f77bcf86cd799439011',...prepareProfileStorage('507f1f77bcf86cd799439011',profile,env.STAGING_PROFILE_ENCRYPTION_KEY)};
  assert.ok(!JSON.stringify(stored).includes(profile.displayName));
  const publicData=readPublicSnapshot(stored,env.STAGING_PROFILE_ENCRYPTION_KEY);
  assert.equal(Object.hasOwn(publicData,'dob'),false);
  if(fixture.email==='demo.private@example.test')assert.deepEqual(publicData,{});
 }
});

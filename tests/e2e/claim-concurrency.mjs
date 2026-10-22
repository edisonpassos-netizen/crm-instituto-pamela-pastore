import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const run=promisify(execFile);
const args=['-X','-t','-A','-v','ON_ERROR_STOP=1','-c'];
const sql=q=>execFileSync('psql',[...args,q],{encoding:'utf8'}).trim();
sql(`INSERT INTO crm_automation_queue(id,dedupe_key,event_type,source_type,source_id,channel,status,scheduled_at,payload) VALUES
('33333333-3333-4333-8333-333333333331','qa-concurrent-1','lead_follow_up_requested','task','qa-concurrent-1','internal','pending','1900-01-01','{}'),
('33333333-3333-4333-8333-333333333332','qa-concurrent-2','lead_follow_up_requested','task','qa-concurrent-2','internal','pending','1900-01-01','{}'),
('33333333-3333-4333-8333-333333333333','qa-concurrent-external','follow_up','task','qa-external','whatsapp','pending','1900-01-01','{}');`);
const q='BEGIN; SELECT id FROM claim_due_internal_automation_jobs(1); SELECT pg_sleep(0.3); COMMIT;';
const results=await Promise.all([run('psql',[...args,q]),run('psql',[...args,q])]);
const claimed=results.flatMap(r=>r.stdout.match(/33333333-3333-4333-8333-33333333333[12]/g)||[]);
assert.equal(claimed.length,2);assert.equal(new Set(claimed).size,2);
assert.equal(sql("SELECT status FROM crm_automation_queue WHERE dedupe_key='qa-concurrent-external'"),'pending');
assert.equal(sql("SELECT min(attempts)||','||max(attempts) FROM crm_automation_queue WHERE dedupe_key IN ('qa-concurrent-1','qa-concurrent-2')"),'1,1');
sql("UPDATE crm_automation_queue SET locked_at=now()-interval '11 minutes' WHERE dedupe_key='qa-concurrent-1'");
assert.equal(sql("SELECT id FROM claim_due_internal_automation_jobs(1)"),'33333333-3333-4333-8333-333333333331');
assert.equal(sql("SELECT attempts FROM crm_automation_queue WHERE dedupe_key='qa-concurrent-1'"),'2');
sql("DELETE FROM crm_automation_queue WHERE dedupe_key LIKE 'qa-concurrent-%'");
console.log('PASS DATABASE_CONCURRENCY: independent transactions claim disjoint jobs; external untouched; expired lock recovered');

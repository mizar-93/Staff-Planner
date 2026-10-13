import pg from 'pg';
import {getProductionRetentionStart,retainProductionRecords} from './retention.mjs';
export const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
export async function cleanupProductionRecords() {
  // Database-side atomic cleanup prevents racing GETs from overwriting newer entries.
  await pool.query(`UPDATE planner_data d SET value = COALESCE((
    SELECT jsonb_object_agg(item.key,item.value) FROM jsonb_each(d.value) item
    WHERE item.key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR item.key >= $1
  ), '{}'::jsonb), version=version+1
  WHERE d.key='staff_production_records_enc' AND jsonb_typeof(d.value)='object'
    AND EXISTS(SELECT 1 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(d.value)='object' THEN d.value ELSE '{}'::jsonb END) k(date) WHERE k.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND k.date < $1)`,[getProductionRetentionStart()]);
}
export async function data(shift, key) {
  if(key==='staff_production_records_enc') await cleanupProductionRecords();
  return (await pool.query('SELECT value,version FROM planner_data WHERE shift_id=$1 AND key=$2',[shift,key])).rows[0] || {value:null,version:0};
}
export async function save(shift,key,value,version) {
  if(key==='staff_production_records_enc') {
    if(!value || typeof value!=='object' || Array.isArray(value)) throw Error('Invalid production records');
    value=retainProductionRecords(value);
  }
  if (version === 0) return (await pool.query('INSERT INTO planner_data(shift_id,key,value) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING version',[shift,key,JSON.stringify(value)])).rows[0];
  return (await pool.query('UPDATE planner_data SET value=$3,version=version+1 WHERE shift_id=$1 AND key=$2 AND version=$4 RETURNING version',[shift,key,JSON.stringify(value),version])).rows[0];
}

import pg from 'pg';
export const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
export async function data(shift, key) {
  return (await pool.query('SELECT value,version FROM planner_data WHERE shift_id=$1 AND key=$2',[shift,key])).rows[0] || {value:null,version:0};
}
export async function save(shift,key,value,version) {
  if (version === 0) return (await pool.query('INSERT INTO planner_data(shift_id,key,value) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING version',[shift,key,JSON.stringify(value)])).rows[0];
  return (await pool.query('UPDATE planner_data SET value=$3,version=version+1 WHERE shift_id=$1 AND key=$2 AND version=$4 RETURNING version',[shift,key,JSON.stringify(value),version])).rows[0];
}

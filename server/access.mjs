export const shifts = ['shift-1', 'shift-2', 'shift-3'];
export const roles = ['production_manager', 'shift_leader', 'worker'];
export function isDeputy(user) { return user?.active === true && user.role === 'worker' && user.deputy === true; }
export function canDelegate(leader, worker) {
  return leader?.active === true && leader.role === 'shift_leader' && worker?.active === true && worker.role === 'worker' && leader.shift_id === worker.shift_id;
}
export function validDeputySchedule(schedule, people) {
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return false;
  const ids=new Set(people.map(person=>person.id));
  const days=['Måndag','Tisdag','Onsdag','Torsdag','Fredag'];
  return Object.entries(schedule).every(([task,entries]) => task.length>0 && entries && typeof entries==='object' && !Array.isArray(entries) && Object.entries(entries).every(([day,id])=>days.includes(day) && (id==='' || ids.has(id))));
}
const bases = ['staff_people_enc','staff_schedule_enc','staff_training_leaders_enc','staff_training_locations_enc','staff_extra_person_locations_enc','staff_break_plan_enc','staff_schedule_priority_lines_enc','staff_assessments_enc','staff_departments_enc','staff_test_results_enc','staff_machine_skills_enc','staff_machine_skill_updated_at_enc','staff_machine_restrictions_enc','staff_machine_skill_details_enc','staff_audit_log_enc','staff_production_records_enc','staff_production_settings_enc','staff_todos_enc','staff_work_items_enc','staff_work_item_trash_enc','staff_safety_snapshots_enc','staff_automatic_backups_enc','staff_schedule_templates_enc','staff_app_settings_enc'];
export function validKey(key) {
  return bases.includes(key) || /^(staff_schedule_enc|staff_training_leaders_enc|staff_training_locations_enc|staff_break_plan_enc|staff_schedule_priority_lines_enc):\d{4}-\d{2}-\d{2}$/.test(key);
}
export function allowed(user, shift, key, write = false) {
  if (!user?.active || !shifts.includes(shift) || !validKey(key)) return false;
  if (user.role === 'worker') return false; // Workers use a filtered projection endpoint only.
  if (user.role === 'shift_leader') return user.shift_id === shift;
  if (user.role === 'production_manager') return !write || key !== 'staff_todos_enc';
  return false;
}
export function workerSchedule(schedule, people, user) {
  const group = people.filter(p => p.groupId === user.group_id).map(p => ({id:p.id,name:p.name}));
  const ids = new Set(group.map(p => p.id));
  const filtered = Object.fromEntries(Object.entries(schedule || {}).map(([task, days]) => [task,
    Object.fromEntries(Object.entries(days || {}).map(([day,id]) => [day,ids.has(id) ? id : '']))]));
  return {people:group,schedule:filtered};
}

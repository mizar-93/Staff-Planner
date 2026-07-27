const TASKS = [
  "GD1",
  "GD2",
  "GD3",
  "GD4",
  "Logimark",
  "ETIKETTO",
  "miniLogimark",
  "Packa L1",
  "Packa L2/3",
  "Packa L4",
  "Utbildning 1",
  "Utbildning 2"
];

const DAYS = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"];
const DEFAULT_PEOPLE = [];
const DEFAULT_DEPARTMENTS = ["GD", "ETIKETTO", "Logimark", "Packa"];

const BASIC_ASSESSMENT_ITEMS = [
  "Punktlig och pålitlig",
  "Kan arbeta i skift (dag/kväll)",
  "Följer hygienregler, klädregler och säkerhetsrutiner",
  "Närvaro och frånvarohantering",
  "Accepterar och följer instruktioner",
  "Uppträder professionellt"
];

const PERFORMANCE_ASSESSMENT_ITEMS = [
  "Kvalitetsmedvetenhet och noggrannhet",
  "Följer GMP, interna regler och hanterar produkt korrekt",
  "Förståelse för arbetsmoment och instruktioner",
  "Arbetstempo och uthållighet",
  "Självständighet och ansvar",
  "Tar feedback och utvecklas i arbetet",
  "Samarbete och kommunikation",
  "Attityd till arbete, regler och skiftarbete"
];

const STORAGE_KEYS = {
  sessionPassword: "app_session_password",
  salt: "app_salt",
  check: "app_check",
  people: "staff_people_enc",
  peopleYear: "staff_people_year",
  schedule: "staff_schedule_enc",
  scheduleWeek: "staff_schedule_week",
  trainingLeaders: "staff_training_leaders_enc",
  trainingLeadersWeek: "staff_training_leaders_week",
  trainingLocations: "staff_training_locations_enc",
  trainingLocationsWeek: "staff_training_locations_week",
  breakPlan: "staff_break_plan_enc",
  breakPlanWeek: "staff_break_plan_week",
  assessments: "staff_assessments_enc",
  departments: "staff_departments_enc",
  testResults: "staff_test_results_enc",
  machineSkills: "staff_machine_skills_enc",
  machineSkillUpdatedAt: "staff_machine_skill_updated_at_enc",
  machineRestrictions: "staff_machine_restrictions_enc",
  machineSkillDetails: "staff_machine_skill_details_enc",
  auditLog: "staff_audit_log_enc",
  productionRecords: "staff_production_records_enc",
  productionSettings: "staff_production_settings_enc",
  legacyPeople: "staff_people",
  legacySchedule: "staff_schedule"
};

const SELECTED_WEEK_KEY = "staff_selected_week";

const AUTH_MODES = {
  login: {
    title: "Logga in",
    buttonText: "Logga in",
    showConfirm: false
  },
  create: {
    title: "Skapa lösenord",
    buttonText: "Spara lösenord",
    showConfirm: true
  }
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let sessionKey = null;
let appUnlocked = false;
let addMessageTimeoutId = null;
let selectedBreakDay = DAYS[0];
let selectedAssessmentPersonId = "";
let selectedTestPersonId = "";
let selectedProductionDate = formatDateKey(new Date());
let selectedCompetencyPersonId = "";
let assessmentFormOpen = false;

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function formatDateKey(date) {
  return [
    date.getFullYear(),
    padNumber(date.getMonth() + 1),
    padNumber(date.getDate())
  ].join("-");
}

function getCurrentYearKey() {
  return String(new Date().getFullYear());
}

function getActualStartOfWeek() {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  const diff = today.getDate() - day + (day === 0 ? -6 : 1);

  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);

  return monday;
}

function getStartOfWeek() {
  const stored = sessionStorage.getItem(SELECTED_WEEK_KEY);
  if (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored)) {
    const [year, month, day] = stored.split("-").map(Number);
    const selected = new Date(year, month - 1, day);
    selected.setHours(0, 0, 0, 0);
    if (!Number.isNaN(selected.getTime())) return selected;
  }

  return getActualStartOfWeek();
}

function getSelectedWeekKey() {
  return formatDateKey(getStartOfWeek());
}

function getWeekStorageKey(baseKey) {
  return `${baseKey}:${getSelectedWeekKey()}`;
}

function getDatesForWeek() {
  const monday = getStartOfWeek();

  return DAYS.map((_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return `${date.getDate()}/${date.getMonth() + 1}`;
  });
}

function formatWeekRange() {
  const monday = getStartOfWeek();
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const formatter = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" });
  return `${formatter.format(monday)} – ${formatter.format(friday)} ${friday.getFullYear()}`;
}

async function changeSelectedWeek(dayOffset) {
  const selected = getStartOfWeek();
  selected.setDate(selected.getDate() + dayOffset);
  sessionStorage.setItem(SELECTED_WEEK_KEY, formatDateKey(selected));
  renderWeekNavigation();
  await renderSchedule();
  await renderBreakPlanner();
}

function renderWeekNavigation() {
  const header = document.querySelector(".main .header");
  const hasWeeklyView = document.getElementById("scheduleGrid") || document.getElementById("breakPlanner");
  if (!header || !hasWeeklyView) return;

  let navigation = document.getElementById("weekNavigation");
  if (!navigation) {
    navigation = document.createElement("div");
    navigation.id = "weekNavigation";
    navigation.className = "week-navigation";
    header.appendChild(navigation);
  }

  navigation.innerHTML = "";
  const previous = document.createElement("button");
  const current = document.createElement("button");
  const next = document.createElement("button");
  const range = document.createElement("div");
  previous.type = current.type = next.type = "button";
  previous.textContent = "← Föregående";
  current.textContent = "Denna vecka";
  next.textContent = "Nästa →";
  range.className = "week-range";
  range.innerHTML = `<span>Vald vecka</span><strong>${formatWeekRange()}</strong>`;
  previous.addEventListener("click", () => changeSelectedWeek(-7));
  current.addEventListener("click", async () => {
    sessionStorage.setItem(SELECTED_WEEK_KEY, formatDateKey(getActualStartOfWeek()));
    renderWeekNavigation();
    await renderSchedule();
    await renderBreakPlanner();
  });
  next.addEventListener("click", () => changeSelectedWeek(7));
  navigation.append(previous, range, current, next);
}

function makeId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getJsonItem(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Could not parse localStorage item: ${key}`, error);
    return fallback;
  }
}

function storeSessionPassword(password) {
  sessionStorage.setItem(STORAGE_KEYS.sessionPassword, password);
}

function getStoredSessionPassword() {
  return sessionStorage.getItem(STORAGE_KEYS.sessionPassword) || "";
}

function clearStoredSessionPassword() {
  sessionStorage.removeItem(STORAGE_KEYS.sessionPassword);
}

function clearPersistentData() {
  Object.entries(STORAGE_KEYS).forEach(([name, key]) => {
    if (name === "sessionPassword") return;
    localStorage.removeItem(key);
  });

  const weeklyPrefixes = [
    STORAGE_KEYS.schedule,
    STORAGE_KEYS.trainingLeaders,
    STORAGE_KEYS.trainingLocations,
    STORAGE_KEYS.breakPlan
  ].map(key => `${key}:`);

  Object.keys(localStorage).forEach(key => {
    if (weeklyPrefixes.some(prefix => key.startsWith(prefix))) {
      localStorage.removeItem(key);
    }
  });
}

function removeStoredAppData() {
  clearPersistentData();
  clearStoredSessionPassword();
}

function createEmptySchedule() {
  return Object.fromEntries(
    TASKS.map(task => [
      task,
      Object.fromEntries(DAYS.map(day => [day, ""]))
    ])
  );
}

function normalizeSchedule(schedule) {
  const normalized = createEmptySchedule();

  TASKS.forEach(task => {
    DAYS.forEach(day => {
      normalized[task][day] = schedule?.[task]?.[day] ?? "";
    });
  });

  return normalized;
}

function createEmptyTrainingLeaders() {
  return Object.fromEntries(
    TASKS.filter(task => task.includes("Utbildning")).map(task => [
      task,
      Object.fromEntries(DAYS.map(day => [day, ""]))
    ])
  );
}

function normalizeTrainingLeaders(trainingLeaders) {
  const normalized = createEmptyTrainingLeaders();

  Object.keys(normalized).forEach(task => {
    DAYS.forEach(day => {
      normalized[task][day] = trainingLeaders?.[task]?.[day] ?? "";
    });
  });

  return normalized;
}

function createEmptyTrainingLocations() {
  return Object.fromEntries(
    TASKS.filter(task => task.includes("Utbildning")).map(task => [
      task,
      Object.fromEntries(DAYS.map(day => [day, ""]))
    ])
  );
}

function normalizeTrainingLocations(trainingLocations) {
  const normalized = createEmptyTrainingLocations();

  Object.keys(normalized).forEach(task => {
    DAYS.forEach(day => {
      normalized[task][day] = trainingLocations?.[task]?.[day] ?? "";
    });
  });

  return normalized;
}

function createEmptyBreakPlan() {
  return Object.fromEntries(DAYS.map(day => [day, {
    mode: "together",
    togetherStart: "",
    togetherSecondStart: "",
    group1Break1: "",
    group1Break2: "",
    group2Break1: "",
    group2Break2: "",
    groups: {},
    workplaces: {}
  }]));
}

function normalizeBreakPlan(breakPlan) {
  const normalized = createEmptyBreakPlan();

  DAYS.forEach(day => {
    const stored = breakPlan?.[day] ?? {};
    normalized[day] = {
      ...normalized[day],
      ...stored,
      mode: ["together", "together_split", "split"].includes(stored.mode)
        ? stored.mode
        : "together",
      groups: stored.groups && typeof stored.groups === "object" ? stored.groups : {},
      workplaces: stored.workplaces && typeof stored.workplaces === "object"
        ? stored.workplaces
        : {}
    };
  });

  return normalized;
}

function getAssignedPeopleForDay(schedule, day, excludedTask = "") {
  const assignedPeople = new Set();

  TASKS.forEach(task => {
    if (task === excludedTask) return;

    const personId = schedule?.[task]?.[day];
    if (personId) {
      assignedPeople.add(personId);
    }
  });

  return assignedPeople;
}

function getTrainingLeadersForDay(trainingLeaders, day, excludedTask = "") {
  const leaders = new Set();

  TASKS.filter(task => task.includes("Utbildning")).forEach(task => {
    if (task === excludedTask) return;
    const personId = trainingLeaders?.[task]?.[day];
    if (personId) leaders.add(personId);
  });

  return leaders;
}

function getTaskDepartment(task) {
  if (/^GD\d+$/i.test(task)) return "GD";
  if (task === "ETIKETTO") return "ETIKETTO";
  if (task === "Logimark" || task === "miniLogimark") return "Logimark";
  if (task.startsWith("Packa")) return "Packa";
  return "";
}

async function createFairWeeklySchedule() {
  const [people, skills, restrictions, currentSchedule, trainingLeaders, trainingLocations] = await Promise.all([
    getPeople(),
    getMachineSkills(),
    getMachineRestrictions(),
    getSchedule(),
    getTrainingLeaders(),
    getTrainingLocations()
  ]);
  const availablePeople = people.filter(
    person => getPersonAvailability(person) === "available"
  );
  const productionTasks = TASKS.filter(task => !task.includes("Utbildning"));
  const eligiblePeople = availablePeople.filter(person => {
    const personSkills = Array.isArray(skills[person.id]) ? skills[person.id] : [];
    return personSkills.some(skill => ["GD", "ETIKETTO", "Logimark", "Packa"].includes(skill));
  });

  if (!eligiblePeople.length) {
    return {
      ok: false,
      message: "Ingen tillgänglig person har registrerad kompetens ännu."
    };
  }

  const schedule = createEmptySchedule();
  TASKS.filter(task => task.includes("Utbildning")).forEach(task => {
    DAYS.forEach(day => {
      schedule[task][day] = currentSchedule[task]?.[day] ?? "";
    });
  });

  const stats = Object.fromEntries(eligiblePeople.map((person, index) => [
    person.id,
    {
      total: 0,
      byTask: {},
      byDepartment: {},
      lastTask: "",
      lastDepartment: "",
      order: index
    }
  ]));
  let assignmentCount = 0;
  let unfilledCount = 0;

  DAYS.forEach((day, dayIndex) => {
    const assignedToday = new Set();
    TASKS.filter(task => task.includes("Utbildning")).forEach(task => {
      const personId = schedule[task]?.[day];
      if (personId) {
        assignedToday.add(personId);
        if (stats[personId]) stats[personId].total += 1;
      }
      const leaderId = trainingLeaders?.[task]?.[day];
      if (leaderId) assignedToday.add(leaderId);
    });

    const taskOffset = dayIndex % productionTasks.length;
    const tasksForDay = [
      ...productionTasks.slice(taskOffset),
      ...productionTasks.slice(0, taskOffset)
    ];

    tasksForDay.forEach((task, taskIndex) => {
      const reservedForTraining = TASKS.filter(item => item.includes("Utbildning"))
        .some(item => schedule?.[item]?.[day] && trainingLocations?.[item]?.[day] === task);
      if (reservedForTraining) return;

      const department = getTaskDepartment(task);
      const candidates = eligiblePeople
        .filter(person => {
          if (assignedToday.has(person.id)) return false;
          const personSkills = Array.isArray(skills[person.id]) ? skills[person.id] : [];
          if (!personSkills.includes(department)) return false;
          const personRestrictions = Array.isArray(restrictions[person.id])
            ? restrictions[person.id]
            : [];
          return !(department === "GD" && personRestrictions.includes("GD"));
        })
        .sort((first, second) => {
          const firstStats = stats[first.id];
          const secondStats = stats[second.id];
          const score = personStats => (
            personStats.total * 1000 +
            (personStats.lastTask === task ? 300 : 0) +
            (personStats.lastDepartment === department ? 100 : 0) +
            (personStats.byTask[task] || 0) * 20 +
            (personStats.byDepartment[department] || 0) * 5 +
            ((personStats.order - dayIndex - taskIndex + eligiblePeople.length * 4)
              % eligiblePeople.length)
          );
          return score(firstStats) - score(secondStats);
        });

      const selectedPerson = candidates[0];
      if (!selectedPerson) {
        unfilledCount += 1;
        return;
      }

      schedule[task][day] = selectedPerson.id;
      assignedToday.add(selectedPerson.id);
      const personStats = stats[selectedPerson.id];
      personStats.total += 1;
      personStats.byTask[task] = (personStats.byTask[task] || 0) + 1;
      personStats.byDepartment[department] =
        (personStats.byDepartment[department] || 0) + 1;
      personStats.lastTask = task;
      personStats.lastDepartment = department;
      assignmentCount += 1;
    });
  });

  return {
    ok: true,
    schedule,
    trainingLocations,
    assignmentCount,
    unfilledCount,
    message: unfilledCount
      ? `Schemat skapades med ${assignmentCount} placeringar. ${unfilledCount} platser saknar behörig personal.`
      : `Veckoschemat är klart med ${assignmentCount} rättvist fördelade placeringar.`
  };
}

function showSchedulePreview(result, people) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const modal = document.createElement("section");
    modal.className = "schedule-preview-modal";
    const nameById = Object.fromEntries(people.map(person => [person.id, person.name]));
    const rows = TASKS.filter(task => !task.includes("Utbildning")).map(task => `
      <div class="preview-task">${escapeHtml(task)}</div>
      ${DAYS.map(day => {
        const trainingTask = TASKS.filter(item => item.includes("Utbildning"))
          .find(item => result.schedule?.[item]?.[day] && result.trainingLocations?.[item]?.[day] === task);
        const value = trainingTask ? "Utbildning" : nameById[result.schedule[task]?.[day]] || "—";
        return `<div${trainingTask ? ' class="preview-training"' : ""}>${escapeHtml(value)}</div>`;
      }).join("")}
    `).join("");
    modal.innerHTML = `
      <div class="preview-heading"><div><small>FÖRHANDSVISNING</small><h3>Veckoschema</h3><p>${escapeHtml(result.message)}</p></div><button type="button" class="preview-close" aria-label="Stäng">×</button></div>
      <div class="schedule-preview-grid"><div class="preview-task preview-header">Uppgift</div>${DAYS.map(day => `<div class="preview-header">${escapeHtml(day)}</div>`).join("")}${rows}</div>
      <div class="preview-actions"><button type="button" class="btn preview-cancel">Avbryt</button><button type="button" class="btn primary preview-save">Spara schema</button></div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const close = accepted => { overlay.remove(); resolve(accepted); };
    modal.querySelector(".preview-close").addEventListener("click", () => close(false));
    modal.querySelector(".preview-cancel").addEventListener("click", () => close(false));
    modal.querySelector(".preview-save").addEventListener("click", () => close(true));
    overlay.addEventListener("click", event => { if (event.target === overlay) close(false); });
  });
}

function setupAutoSchedule() {
  const button = document.getElementById("autoScheduleBtn");
  const message = document.getElementById("autoScheduleMessage");
  if (!button || button.dataset.bound === "true") return;

  button.dataset.bound = "true";
  button.addEventListener("click", async () => {
    const shouldCreate = confirm(
      "Vill du skapa ett nytt schema för den valda veckan? Nuvarande produktionsplaceringar ersätts, men utbildningsraderna behålls."
    );
    if (!shouldCreate) return;

    button.disabled = true;
    button.textContent = "Skapar schema…";
    if (message) {
      message.textContent = "Kompetenser och tillgänglighet kontrolleras…";
      message.className = "auto-schedule-message";
    }

    try {
      const result = await createFairWeeklySchedule();
      if (message) {
        message.textContent = result.message;
        message.className = `auto-schedule-message ${result.ok ? "success" : "error"}`;
      }
      if (result.ok) {
        const accepted = await showSchedulePreview(result, await getPeople());
        if (!accepted) {
          if (message) message.textContent = "Förhandsvisningen stängdes utan att schemat ändrades.";
          return;
        }
        await saveSchedule(result.schedule);
        await addAuditEvent("schedule", "Veckoschema skapat", `${result.assignmentCount} placeringar för ${formatWeekRange()}`);
        await renderSchedule();
        await renderBreakPlanner();
      }
    } catch (error) {
      console.error(error);
      if (message) {
        message.textContent = "Det gick inte att skapa schemat. Försök igen.";
        message.className = "auto-schedule-message error";
      }
    } finally {
      button.disabled = false;
      button.textContent = "Skapa veckoschema";
    }
  });
}

function toBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function fromBase64(base64) {
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

function randomBytes(length = 16) {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function deriveAesKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 250000,
      hash: "SHA-256"
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptJson(data, key) {
  const iv = randomBytes(12);
  const plaintext = encoder.encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

  return {
    iv: toBase64(iv),
    data: toBase64(ciphertext)
  };
}

async function decryptJson(payload, key) {
  const iv = fromBase64(payload.iv);
  const data = fromBase64(payload.data);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);

  return JSON.parse(decoder.decode(plaintext));
}

async function encryptStoredItem(keyName, value) {
  if (!appUnlocked || !sessionKey) return;

  const encrypted = await encryptJson(value, sessionKey);
  localStorage.setItem(keyName, JSON.stringify(encrypted));
}

async function decryptStoredItem(keyName, fallback) {
  if (!appUnlocked || !sessionKey) return fallback;

  const raw = localStorage.getItem(keyName);
  if (!raw) return null;

  try {
    return await decryptJson(JSON.parse(raw), sessionKey);
  } catch (error) {
    console.error(`Failed to decrypt item: ${keyName}`, error);
    return fallback;
  }
}

function getAuthElements() {
  return {
    authScreen: document.getElementById("authScreen"),
    appShell: document.getElementById("appShell"),
    authTitle: document.getElementById("authTitle"),
    authBtn: document.getElementById("authBtn"),
    passwordInput: document.getElementById("passwordInput"),
    passwordConfirmInput: document.getElementById("passwordConfirmInput"),
    wipeBtn: document.getElementById("wipeBtn"),
    logoutBtn: document.getElementById("logoutBtn")
  };
}

function bindOnce(element, eventName, handler) {
  if (!element || element.dataset.bound === "true") return;

  element.dataset.bound = "true";
  element.addEventListener(eventName, handler);
}

function bindEnterToClick(input, button) {
  bindOnce(input, "keydown", event => {
    if (event.key !== "Enter") return;

    event.preventDefault();
    button?.click();
  });
}

function resetAuthInputs(passwordInput, passwordConfirmInput) {
  if (passwordInput) passwordInput.value = "";
  if (passwordConfirmInput) passwordConfirmInput.value = "";
}

function setAuthenticatedView(isAuthenticated) {
  document.body.classList.toggle("app-authenticated", isAuthenticated);
}

function finishInitialViewSetup() {
  document.body.classList.remove("app-booting");
}

function updateAuthMode(isLoginMode, authTitle, authBtn, passwordConfirmInput) {
  const mode = isLoginMode ? AUTH_MODES.login : AUTH_MODES.create;

  if (authTitle) authTitle.textContent = mode.title;
  if (authBtn) authBtn.textContent = mode.buttonText;
  if (passwordConfirmInput) {
    passwordConfirmInput.style.display = mode.showConfirm ? "block" : "none";
  }
}

function showAuthMessage(text, isError = true) {
  const authMessage = document.getElementById("authMessage");
  if (!authMessage) return;

  authMessage.textContent = text;
  authMessage.classList.remove("hidden");
  authMessage.classList.toggle("error", isError);
  authMessage.classList.toggle("success", !isError);
}

function clearAuthMessage() {
  const authMessage = document.getElementById("authMessage");
  if (!authMessage) return;

  authMessage.textContent = "";
  authMessage.classList.add("hidden");
  authMessage.classList.remove("error", "success");
}

function hasPasswordSetup() {
  return Boolean(localStorage.getItem(STORAGE_KEYS.salt) && localStorage.getItem(STORAGE_KEYS.check));
}

async function setupPassword(password) {
  const salt = randomBytes(16);
  const key = await deriveAesKey(password, salt);
  const checkPayload = await encryptJson({ ok: true }, key);
  const people = getJsonItem(STORAGE_KEYS.legacyPeople, DEFAULT_PEOPLE);
  const schedule = getJsonItem(STORAGE_KEYS.legacySchedule, createEmptySchedule());

  localStorage.setItem(STORAGE_KEYS.salt, toBase64(salt));
  localStorage.setItem(STORAGE_KEYS.check, JSON.stringify(checkPayload));

  sessionKey = key;
  appUnlocked = true;

  await encryptStoredItem(STORAGE_KEYS.people, people);
  localStorage.setItem(STORAGE_KEYS.peopleYear, getCurrentYearKey());
  await encryptStoredItem(getWeekStorageKey(STORAGE_KEYS.schedule), schedule);
  localStorage.setItem(STORAGE_KEYS.scheduleWeek, getSelectedWeekKey());

  localStorage.removeItem(STORAGE_KEYS.legacyPeople);
  localStorage.removeItem(STORAGE_KEYS.legacySchedule);
  storeSessionPassword(password);
}

async function unlockApp(password) {
  const saltBase64 = localStorage.getItem(STORAGE_KEYS.salt);
  const checkRaw = localStorage.getItem(STORAGE_KEYS.check);

  if (!saltBase64 || !checkRaw) return false;

  try {
    const salt = fromBase64(saltBase64);
    const key = await deriveAesKey(password, salt);
    const check = await decryptJson(JSON.parse(checkRaw), key);

    if (check.ok !== true) return false;

    sessionKey = key;
    appUnlocked = true;
    storeSessionPassword(password);

    return true;
  } catch (error) {
    console.error("Unlock failed:", error);
    return false;
  }
}

function lockApp() {
  sessionKey = null;
  appUnlocked = false;
  clearStoredSessionPassword();
}

async function restoreSession() {
  if (!hasPasswordSetup() || appUnlocked) return false;

  const password = getStoredSessionPassword();
  if (!password) return false;

  const unlocked = await unlockApp(password);
  if (!unlocked) clearStoredSessionPassword();

  return unlocked;
}

function wipeAllData() {
  removeStoredAppData();
  lockApp();
  location.reload();
}

async function getPeople() {
  if (!appUnlocked || !sessionKey) return [];

  const people = await decryptStoredItem(STORAGE_KEYS.people, []);
  const storedYearKey = localStorage.getItem(STORAGE_KEYS.peopleYear);

  if (people === null || storedYearKey !== getCurrentYearKey()) {
    const empty = [];
    await savePeople(empty);
    return empty;
  }

  return Array.isArray(people) ? people : [];
}

async function savePeople(people) {
  await encryptStoredItem(STORAGE_KEYS.people, people);
  localStorage.setItem(STORAGE_KEYS.peopleYear, getCurrentYearKey());
}

function getPersonAvailability(person) {
  return ["sick", "vacation", "unavailable"].includes(person?.availability)
    ? person.availability
    : "available";
}

function getAvailabilityLabel(status) {
  if (status === "sick") return "Sjuk";
  if (status === "vacation") return "Semester";
  if (status === "unavailable") return "Inte tillgänglig";
  return "Tillgänglig";
}

function getUnavailableMessage(person) {
  const status = getPersonAvailability(person);
  if (status === "sick") return `${person.name} är sjuk och kan inte schemaläggas.`;
  if (status === "vacation") return `${person.name} är på semester och kan inte schemaläggas.`;
  if (status === "unavailable") return `${person.name} är inte tillgänglig och kan inte schemaläggas.`;
  return "";
}

function renderAvailabilitySummary(scheduleRoot, people) {
  const card = scheduleRoot.parentElement;
  if (!card) return;

  let summary = card.querySelector(".availability-summary");
  if (!summary) {
    summary = document.createElement("section");
    summary.className = "availability-summary";
    card.insertBefore(summary, scheduleRoot);
  }

  const unavailablePeople = people.filter(
    person => getPersonAvailability(person) !== "available"
  );
  summary.innerHTML = "";

  const heading = document.createElement("div");
  heading.className = "availability-summary-heading";
  const headingText = document.createElement("div");
  const title = document.createElement("strong");
  const subtitle = document.createElement("span");
  const count = document.createElement("span");
  title.textContent = "Frånvaro";
  subtitle.textContent = unavailablePeople.length
    ? "Dessa personer kan inte schemaläggas"
    : "Alla är tillgängliga";
  count.className = `availability-count${unavailablePeople.length ? " has-absence" : ""}`;
  count.textContent = String(unavailablePeople.length);
  headingText.append(title, subtitle);
  heading.append(headingText, count);
  summary.appendChild(heading);

  if (!unavailablePeople.length) {
    const allAvailable = document.createElement("div");
    allAvailable.className = "availability-all-clear";
    allAvailable.innerHTML = "<span>✓</span> Ingen registrerad frånvaro";
    summary.appendChild(allAvailable);
    return;
  }

  const chips = document.createElement("div");
  chips.className = "availability-chips";
  unavailablePeople.forEach(person => {
    const status = getPersonAvailability(person);
    const chip = document.createElement("div");
    const dot = document.createElement("span");
    const text = document.createElement("span");
    const label = document.createElement("small");
    chip.className = `availability-chip availability-chip-${status}`;
    chip.title = getUnavailableMessage(person);
    dot.className = "availability-chip-dot";
    text.textContent = person.name;
    label.textContent = getAvailabilityLabel(status);
    chip.append(dot, text, label);
    chips.appendChild(chip);
  });
  summary.appendChild(chips);
}

function renderTrainingScheduleSummary(scheduleRoot, people, schedule, trainingLocations) {
  const card = scheduleRoot.parentElement;
  if (!card) return;

  const entries = [];
  TASKS.filter(task => task.includes("Utbildning")).forEach(task => {
    DAYS.forEach(day => {
      const personId = schedule?.[task]?.[day];
      const person = people.find(item => item.id === personId);
      if (!person) return;
      entries.push({
        person,
        day,
        task,
        location: trainingLocations?.[task]?.[day] || "Plats ej vald"
      });
    });
  });

  let summary = card.querySelector(".training-schedule-summary");
  if (!entries.length) {
    summary?.remove();
    return;
  }

  if (!summary) {
    summary = document.createElement("section");
    summary.className = "training-schedule-summary";
    card.insertBefore(summary, scheduleRoot);
  }
  summary.innerHTML = "";

  const heading = document.createElement("div");
  heading.className = "training-schedule-heading";
  heading.innerHTML = `<div><strong>Utbildning denna vecka</strong><span>Planerade personer och utbildningsplatser</span></div><b>${entries.length}</b>`;
  const list = document.createElement("div");
  list.className = "training-schedule-list";

  entries.forEach(({ person, day, task, location }) => {
    const item = document.createElement("div");
    const info = document.createElement("div");
    const dayLabel = document.createElement("small");
    const name = document.createElement("strong");
    const locationLabel = document.createElement("span");
    item.className = "training-schedule-person";
    item.title = `${person.name} har ${task.toLowerCase()} på ${location} (${day})`;
    dayLabel.textContent = day;
    name.textContent = person.name;
    locationLabel.textContent = `Utbildning · ${location}`;
    info.append(name, locationLabel);
    item.append(dayLabel, info);
    list.appendChild(item);
  });

  summary.append(heading, list);
}

async function getAssessments() {
  if (!appUnlocked || !sessionKey) return [];
  const assessments = await decryptStoredItem(STORAGE_KEYS.assessments, []);
  return Array.isArray(assessments) ? assessments : [];
}

async function saveAssessments(assessments) {
  await encryptStoredItem(STORAGE_KEYS.assessments, assessments);
}

async function getDepartments() {
  if (!appUnlocked || !sessionKey) return [...DEFAULT_DEPARTMENTS];
  const departments = await decryptStoredItem(STORAGE_KEYS.departments, null);
  if (!Array.isArray(departments)) {
    await saveDepartments(DEFAULT_DEPARTMENTS);
    return [...DEFAULT_DEPARTMENTS];
  }
  return departments;
}

async function saveDepartments(departments) {
  await encryptStoredItem(STORAGE_KEYS.departments, departments);
}

async function getTestResults() {
  if (!appUnlocked || !sessionKey) return {};
  const results = await decryptStoredItem(STORAGE_KEYS.testResults, {});
  return results && typeof results === "object" && !Array.isArray(results) ? results : {};
}

async function saveTestResults(results) {
  await encryptStoredItem(STORAGE_KEYS.testResults, results);
}

async function getMachineSkills() {
  if (!appUnlocked || !sessionKey) return {};
  const skills = await decryptStoredItem(STORAGE_KEYS.machineSkills, {});
  return skills && typeof skills === "object" && !Array.isArray(skills) ? skills : {};
}

async function saveMachineSkills(skills) {
  await encryptStoredItem(STORAGE_KEYS.machineSkills, skills);
}

async function getMachineSkillUpdatedAt() {
  if (!appUnlocked || !sessionKey) return {};
  const timestamps = await decryptStoredItem(STORAGE_KEYS.machineSkillUpdatedAt, {});
  return timestamps && typeof timestamps === "object" && !Array.isArray(timestamps)
    ? timestamps
    : {};
}

async function saveMachineSkillUpdatedAt(timestamps) {
  await encryptStoredItem(STORAGE_KEYS.machineSkillUpdatedAt, timestamps);
}

async function getMachineRestrictions() {
  if (!appUnlocked || !sessionKey) return {};
  const restrictions = await decryptStoredItem(STORAGE_KEYS.machineRestrictions, {});
  return restrictions && typeof restrictions === "object" && !Array.isArray(restrictions)
    ? restrictions
    : {};
}

async function saveMachineRestrictions(restrictions) {
  await encryptStoredItem(STORAGE_KEYS.machineRestrictions, restrictions);
}

async function getMachineSkillDetails() {
  if (!appUnlocked || !sessionKey) return {};
  const details = await decryptStoredItem(STORAGE_KEYS.machineSkillDetails, {});
  return details && typeof details === "object" && !Array.isArray(details) ? details : {};
}

async function saveMachineSkillDetails(details) {
  await encryptStoredItem(STORAGE_KEYS.machineSkillDetails, details);
}

async function getProductionRecords() {
  if (!appUnlocked || !sessionKey) return {};
  const records = await decryptStoredItem(STORAGE_KEYS.productionRecords, {});
  return records && typeof records === "object" && !Array.isArray(records) ? records : {};
}

async function saveProductionRecords(records) {
  await encryptStoredItem(STORAGE_KEYS.productionRecords, records);
}

async function getProductionSettings() {
  if (!appUnlocked || !sessionKey) return { dailyTarget: 160, factoryRecord: 0 };
  const settings = await decryptStoredItem(STORAGE_KEYS.productionSettings, {});
  return { dailyTarget: Number(settings?.dailyTarget) || 160, factoryRecord: Number(settings?.factoryRecord) || 0 };
}

async function saveProductionSettings(settings) {
  await encryptStoredItem(STORAGE_KEYS.productionSettings, settings);
}

async function getAuditLog() {
  if (!appUnlocked || !sessionKey) return [];
  const events = await decryptStoredItem(STORAGE_KEYS.auditLog, []);
  return Array.isArray(events) ? events : [];
}

async function addAuditEvent(type, title, detail = "", undo = null) {
  const events = await getAuditLog();
  events.unshift({ id: makeId(), type, title, detail, undo, createdAt: new Date().toISOString() });
  await encryptStoredItem(STORAGE_KEYS.auditLog, events.slice(0, 500));
  void renderDashboard();
}

async function applyAuditUndo(event) {
  const undo = event?.undo;
  if (!undo || !confirm(`Återställ ändringen: ${event.title}?`)) return;
  if (undo.action === "availability") {
    const people = await getPeople(); const person = people.find(item => item.id === undo.personId);
    if (person) { person.availability = undo.value; await savePeople(people); }
  } else if (undo.action === "test") {
    const results = await getTestResults(); results[undo.personId] ??= {};
    if (undo.value === "" || undo.value === undefined) delete results[undo.personId][undo.department];
    else results[undo.personId][undo.department] = undo.value;
    await saveTestResults(results);
  } else if (undo.action === "skill") {
    const skills = await getMachineSkills(); const set = new Set(skills[undo.personId] || []);
    if (undo.enabled) set.add(undo.department); else set.delete(undo.department);
    skills[undo.personId] = [...set]; await saveMachineSkills(skills);
    if (undo.department === "GD" && undo.enabled) {
      const restrictions = await getMachineRestrictions();
      restrictions[undo.personId] = (restrictions[undo.personId] || []).filter(item => item !== "GD");
      await saveMachineRestrictions(restrictions);
    }
  } else if (undo.action === "restriction") {
    const restrictions = await getMachineRestrictions(); const set = new Set(restrictions[undo.personId] || []);
    if (undo.enabled) set.add("GD"); else set.delete("GD");
    restrictions[undo.personId] = [...set]; await saveMachineRestrictions(restrictions);
    if (undo.enabled) {
      const skills = await getMachineSkills();
      skills[undo.personId] = (skills[undo.personId] || []).filter(item => item !== "GD");
      await saveMachineSkills(skills);
    }
  }
  const events = await getAuditLog();
  const stored = events.find(item => item.id === event.id); if (stored) stored.undo = null;
  await encryptStoredItem(STORAGE_KEYS.auditLog, events);
  await addAuditEvent("restore", `${event.title} återställd`, "Tidigare värde återställt");
  await refreshAppViews();
}

async function getSchedule() {
  if (!appUnlocked || !sessionKey) return createEmptySchedule();

  const weekKey = getSelectedWeekKey();
  const weeklyStorageKey = getWeekStorageKey(STORAGE_KEYS.schedule);
  let schedule = await decryptStoredItem(weeklyStorageKey, createEmptySchedule());
  const storedWeekKey = localStorage.getItem(STORAGE_KEYS.scheduleWeek);

  if (schedule === null && storedWeekKey === weekKey) {
    schedule = await decryptStoredItem(STORAGE_KEYS.schedule, createEmptySchedule());
    if (schedule !== null) await saveSchedule(schedule);
  }

  if (schedule === null) return createEmptySchedule();
  return normalizeSchedule(schedule);
}

async function saveSchedule(schedule) {
  await encryptStoredItem(getWeekStorageKey(STORAGE_KEYS.schedule), normalizeSchedule(schedule));
  localStorage.setItem(STORAGE_KEYS.scheduleWeek, getSelectedWeekKey());
}

async function getTrainingLeaders() {
  if (!appUnlocked || !sessionKey) return createEmptyTrainingLeaders();

  const weekKey = getSelectedWeekKey();
  let trainingLeaders = await decryptStoredItem(
    getWeekStorageKey(STORAGE_KEYS.trainingLeaders),
    createEmptyTrainingLeaders()
  );
  const storedWeekKey = localStorage.getItem(STORAGE_KEYS.trainingLeadersWeek);

  if (trainingLeaders === null && storedWeekKey === weekKey) {
    trainingLeaders = await decryptStoredItem(STORAGE_KEYS.trainingLeaders, createEmptyTrainingLeaders());
    if (trainingLeaders !== null) await saveTrainingLeaders(trainingLeaders);
  }

  if (trainingLeaders === null) return createEmptyTrainingLeaders();
  return normalizeTrainingLeaders(trainingLeaders);
}

async function saveTrainingLeaders(trainingLeaders) {
  await encryptStoredItem(
    getWeekStorageKey(STORAGE_KEYS.trainingLeaders),
    normalizeTrainingLeaders(trainingLeaders)
  );
  localStorage.setItem(STORAGE_KEYS.trainingLeadersWeek, getSelectedWeekKey());
}

async function getTrainingLocations() {
  if (!appUnlocked || !sessionKey) return createEmptyTrainingLocations();

  const weekKey = getSelectedWeekKey();
  let locations = await decryptStoredItem(
    getWeekStorageKey(STORAGE_KEYS.trainingLocations),
    createEmptyTrainingLocations()
  );
  const storedWeekKey = localStorage.getItem(STORAGE_KEYS.trainingLocationsWeek);

  if (locations === null && storedWeekKey === weekKey) {
    locations = await decryptStoredItem(STORAGE_KEYS.trainingLocations, createEmptyTrainingLocations());
    if (locations !== null) await saveTrainingLocations(locations);
  }

  if (locations === null) return createEmptyTrainingLocations();
  return normalizeTrainingLocations(locations);
}

async function saveTrainingLocations(trainingLocations) {
  await encryptStoredItem(
    getWeekStorageKey(STORAGE_KEYS.trainingLocations),
    normalizeTrainingLocations(trainingLocations)
  );
  localStorage.setItem(STORAGE_KEYS.trainingLocationsWeek, getSelectedWeekKey());
}

async function getBreakPlan() {
  if (!appUnlocked || !sessionKey) return createEmptyBreakPlan();

  const weekKey = getSelectedWeekKey();
  let breakPlan = await decryptStoredItem(
    getWeekStorageKey(STORAGE_KEYS.breakPlan),
    createEmptyBreakPlan()
  );
  const storedWeekKey = localStorage.getItem(STORAGE_KEYS.breakPlanWeek);

  if (breakPlan === null && storedWeekKey === weekKey) {
    breakPlan = await decryptStoredItem(STORAGE_KEYS.breakPlan, createEmptyBreakPlan());
    if (breakPlan !== null) await saveBreakPlan(breakPlan);
  }

  if (breakPlan === null) return createEmptyBreakPlan();
  return normalizeBreakPlan(breakPlan);
}

async function saveBreakPlan(breakPlan) {
  await encryptStoredItem(getWeekStorageKey(STORAGE_KEYS.breakPlan), normalizeBreakPlan(breakPlan));
  localStorage.setItem(STORAGE_KEYS.breakPlanWeek, getSelectedWeekKey());
}

function formatBreakEnd(start, durationMinutes) {
  if (!start) return "Välj tid";

  const [hours, minutes] = start.split(":").map(Number);
  const total = hours * 60 + minutes + durationMinutes;
  return `${padNumber(Math.floor(total / 60) % 24)}:${padNumber(total % 60)}`;
}

function getScheduledPeopleForDay(schedule, people, day) {
  const scheduledIds = new Set();
  TASKS.forEach(task => {
    const personId = schedule?.[task]?.[day];
    if (personId) scheduledIds.add(personId);
  });
  return people.filter(person => scheduledIds.has(person.id));
}

function makeTimeField(labelText, value, duration, onChange) {
  const field = document.createElement("label");
  const title = document.createElement("span");
  const input = document.createElement("select");
  const end = document.createElement("span");

  field.className = "break-time-field";
  title.textContent = `${labelText} · ${duration} min`;
  input.className = "break-time-select";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "--:--";
  input.appendChild(emptyOption);

  for (let totalMinutes = 0; totalMinutes < 24 * 60; totalMinutes += 30) {
    const option = document.createElement("option");
    const time = `${padNumber(Math.floor(totalMinutes / 60))}:${padNumber(totalMinutes % 60)}`;
    option.value = time;
    option.textContent = time;
    input.appendChild(option);
  }

  input.value = value;
  end.className = "break-end-time";
  end.textContent = value ? `Slut ${formatBreakEnd(value, duration)}` : "Välj starttid";
  input.addEventListener("change", async () => {
    end.textContent = input.value
      ? `Slut ${formatBreakEnd(input.value, duration)}`
      : "Välj starttid";
    await onChange(input.value);
  });
  field.append(title, input, end);
  return field;
}

async function renderBreakPlanner() {
  const root = document.getElementById("breakPlanner");
  if (!root) return;

  const people = await getPeople();
  const schedule = await getSchedule();
  const breakPlan = await getBreakPlan();
  const dayPlan = breakPlan[selectedBreakDay];
  const scheduledPeople = getScheduledPeopleForDay(schedule, people, selectedBreakDay);

  root.innerHTML = "";

  const dayTabs = document.createElement("div");
  dayTabs.className = "break-day-tabs";
  DAYS.forEach(day => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `break-day-tab${day === selectedBreakDay ? " active" : ""}`;
    button.textContent = day;
    button.addEventListener("click", () => {
      selectedBreakDay = day;
      renderBreakPlanner();
    });
    dayTabs.appendChild(button);
  });

  const controls = document.createElement("div");
  const modeLabel = document.createElement("label");
  const modeSelect = document.createElement("select");
  controls.className = "break-controls";
  modeLabel.className = "break-mode-field";
  modeLabel.innerHTML = "<span>Rastupplägg</span>";
  modeSelect.className = "schedule-select";
  modeSelect.innerHTML = `
    <option value="together">Gemensam rast · 60 minuter</option>
    <option value="together_split">Gemensamt · 2 × 30 minuter</option>
    <option value="split">Två grupper · 2 × 30 minuter</option>
  `;
  modeSelect.value = dayPlan.mode;
  modeSelect.addEventListener("change", async () => {
    dayPlan.mode = modeSelect.value;
    await saveBreakPlan(breakPlan);
    await renderBreakPlanner();
  });
  modeLabel.appendChild(modeSelect);
  controls.appendChild(modeLabel);

  root.append(dayTabs, controls);

  if (dayPlan.mode === "together" || dayPlan.mode === "together_split") {
    const panel = document.createElement("div");
    panel.className = "break-group-panel together";
    const isSplitTogether = dayPlan.mode === "together_split";
    panel.innerHTML = `<div class="break-group-title"><strong>Hela gruppen</strong><span>${isSplitTogether ? "2 × 30 min" : "60 min"}</span></div>`;

    if (isSplitTogether) {
      panel.appendChild(makeTimeField("Rast 1", dayPlan.togetherStart, 30, async value => {
        dayPlan.togetherStart = value;
        await saveBreakPlan(breakPlan);
      }));
      panel.appendChild(makeTimeField("Rast 2", dayPlan.togetherSecondStart, 30, async value => {
        dayPlan.togetherSecondStart = value;
        await saveBreakPlan(breakPlan);
      }));
    } else {
      panel.appendChild(makeTimeField("Starttid", dayPlan.togetherStart, 60, async value => {
        dayPlan.togetherStart = value;
        await saveBreakPlan(breakPlan);
      }));
    }

    root.appendChild(panel);
    return;
  }

  const assignment = document.createElement("section");
  const assignmentHeading = document.createElement("div");
  const assignmentList = document.createElement("div");
  assignment.className = "break-assignment";
  assignmentHeading.className = "break-assignment-heading";
  assignmentHeading.innerHTML = `
    <div>
      <h4>Fördela personal</h4>
      <p>Välj grupp för varje person som arbetar den här dagen.</p>
    </div>
    <span>${scheduledPeople.length} personer</span>
  `;
  assignmentList.className = "break-assignment-list";

  scheduledPeople.forEach(person => {
    const row = document.createElement("div");
    const personInfo = document.createElement("div");
    const name = document.createElement("strong");
    const selections = document.createElement("div");
    const workplaceSelect = document.createElement("select");
    const groupSelect = document.createElement("select");
    row.className = "break-assignment-row";
    personInfo.className = "break-person-info";
    name.textContent = person.name;
    personInfo.appendChild(name);
    selections.className = "break-person-selections";

    const selectedGroup = dayPlan.groups[person.id];
    const usedWorkplaces = new Set(
      scheduledPeople
        .filter(other => other.id !== person.id && dayPlan.groups[other.id] === selectedGroup)
        .map(other => dayPlan.workplaces[other.id])
        .filter(Boolean)
    );

    workplaceSelect.className = "break-workplace-select";
    workplaceSelect.innerHTML = selectedGroup
      ? "<option value=\"\">Välj maskin / avdelning</option>"
      : "<option value=\"\">Välj grupp först</option>";
    workplaceSelect.disabled = selectedGroup !== 1 && selectedGroup !== 2;
    TASKS.filter(task => !task.includes("Utbildning")).forEach(task => {
      if (usedWorkplaces.has(task) && dayPlan.workplaces[person.id] !== task) return;

      const option = document.createElement("option");
      option.value = task;
      option.textContent = task;
      workplaceSelect.appendChild(option);
    });
    workplaceSelect.value = dayPlan.workplaces[person.id] ?? "";
    workplaceSelect.addEventListener("change", async () => {
      if (workplaceSelect.value) {
        dayPlan.workplaces[person.id] = workplaceSelect.value;
      } else {
        delete dayPlan.workplaces[person.id];
      }
      await saveBreakPlan(breakPlan);
      await renderBreakPlanner();
    });

    groupSelect.className = "break-person-group-select";
    groupSelect.innerHTML = `
      <option value="">Välj grupp</option>
      <option value="1">Grupp 1</option>
      <option value="2">Grupp 2</option>
    `;
    groupSelect.value = dayPlan.groups[person.id] ?? "";
    groupSelect.addEventListener("change", async () => {
      if (groupSelect.value) {
        const newGroup = Number(groupSelect.value);
        const selectedWorkplace = dayPlan.workplaces[person.id];
        const workplaceIsUsed = scheduledPeople.some(other =>
          other.id !== person.id &&
          dayPlan.groups[other.id] === newGroup &&
          dayPlan.workplaces[other.id] === selectedWorkplace
        );

        dayPlan.groups[person.id] = newGroup;
        if (selectedWorkplace && workplaceIsUsed) {
          delete dayPlan.workplaces[person.id];
        }
      } else {
        delete dayPlan.groups[person.id];
        delete dayPlan.workplaces[person.id];
      }
      await saveBreakPlan(breakPlan);
      await renderBreakPlanner();
    });
    selections.append(groupSelect, workplaceSelect);
    row.append(personInfo, selections);
    assignmentList.appendChild(row);
  });

  if (!scheduledPeople.length) {
    assignmentList.innerHTML = "<p class=\"break-empty\">Ingen personal är schemalagd den här dagen.</p>";
  }

  assignment.append(assignmentHeading, assignmentList);
  root.appendChild(assignment);

  const groupsGrid = document.createElement("div");
  groupsGrid.className = "break-groups-grid";
  [1, 2].forEach(groupNumber => {
    const panel = document.createElement("div");
    const title = document.createElement("div");
    panel.className = `break-group-panel group-${groupNumber}`;
    title.className = "break-group-title";
    title.innerHTML = `<strong>Grupp ${groupNumber}</strong><span>2 × 30 min</span>`;
    panel.appendChild(title);

    const groupPeople = scheduledPeople
      .filter(person => dayPlan.groups[person.id] === groupNumber);
    const members = document.createElement("div");
    members.className = "break-group-summary";

    if (groupPeople.length) {
      groupPeople.forEach(person => {
        const member = document.createElement("div");
        const memberName = document.createElement("strong");
        const memberWorkplace = document.createElement("span");
        member.className = "break-group-person";
        memberName.textContent = person.name;
        memberWorkplace.textContent = dayPlan.workplaces[person.id] || "Ingen placering";
        member.append(memberName, memberWorkplace);
        members.appendChild(member);
      });
    } else {
      members.innerHTML = "<p class=\"break-empty\">Ingen person vald</p>";
    }

    panel.appendChild(members);

    panel.appendChild(makeTimeField("Rast 1", dayPlan[`group${groupNumber}Break1`], 30, async value => {
      dayPlan[`group${groupNumber}Break1`] = value;
      await saveBreakPlan(breakPlan);
      await renderBreakPlanner();
    }));
    panel.appendChild(makeTimeField("Rast 2", dayPlan[`group${groupNumber}Break2`], 30, async value => {
      dayPlan[`group${groupNumber}Break2`] = value;
      await saveBreakPlan(breakPlan);
      await renderBreakPlanner();
    }));
    groupsGrid.appendChild(panel);
  });
  root.appendChild(groupsGrid);
}

function getAssessmentAverage(assessment) {
  const scores = Object.values(assessment.ratings || {})
    .map(item => Number(item.score))
    .filter(score => score >= 1 && score <= 5);
  if (!scores.length) return "—";
  return (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1);
}

function assessmentHasProblems(assessment) {
  if (!assessment) return false;
  const hasFailedRequirement = Object.values(assessment.basic || {})
    .some(item => item.answer === "Nej");
  const hasLowScore = Object.values(assessment.ratings || {})
    .some(item => {
      const score = Number(item.score);
      return score > 0 && score <= 2;
    });
  const hasNegativeDecision = assessment.classification?.startsWith("D") ||
    assessment.recommendation === "Rekommenderas ej";
  return hasFailedRequirement || hasLowScore || hasNegativeDecision;
}

function assessmentHasImproved(current, previous) {
  if (!current || !previous) return false;
  let improved = false;
  let declined = false;

  PERFORMANCE_ASSESSMENT_ITEMS.forEach((_, index) => {
    const currentScore = Number(current.ratings?.[index]?.score);
    const previousScore = Number(previous.ratings?.[index]?.score);
    if (!currentScore || !previousScore) return;
    if (currentScore > previousScore) improved = true;
    if (currentScore < previousScore && currentScore <= 2) declined = true;
  });
  BASIC_ASSESSMENT_ITEMS.forEach((_, index) => {
    const currentAnswer = current.basic?.[index]?.answer;
    const previousAnswer = previous.basic?.[index]?.answer;
    if (previousAnswer === "Nej" && currentAnswer === "Ja") improved = true;
    if (previousAnswer === "Ja" && currentAnswer === "Nej") declined = true;
  });

  const currentAverage = Number(getAssessmentAverage(current));
  const previousAverage = Number(getAssessmentAverage(previous));
  if (Number.isFinite(currentAverage) && Number.isFinite(previousAverage)) {
    if (currentAverage - previousAverage >= 0.15) improved = true;
    if (previousAverage - currentAverage >= 0.15) declined = true;
  }
  if (current.classification?.startsWith("D") || current.recommendation === "Rekommenderas ej") {
    declined = true;
  }
  return improved && !declined;
}

function getPersonAssessmentStatus(personAssessments) {
  if (!personAssessments.length) {
    return { className: "status-none", label: "Ingen bedömning" };
  }

  const chronological = [...personAssessments].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt))
  );
  const latest = chronological[chronological.length - 1];
  const previous = chronological.length > 1 ? chronological[chronological.length - 2] : null;
  const latestHasProblems = assessmentHasProblems(latest);
  const previousHadProblems = assessmentHasProblems(previous);
  const hasImproved = assessmentHasImproved(latest, previous);

  if (previousHadProblems && hasImproved) {
    return { className: "status-ready", label: "Har förbättrats" };
  }
  if (latestHasProblems || (previousHadProblems && !hasImproved)) {
    return { className: "status-problem", label: "Behöver uppföljning" };
  }

  if (personAssessments.length === 1) {
    return { className: "status-one", label: "1 bedömning" };
  }
  return { className: "status-ready", label: `${personAssessments.length} bedömningar` };
}

function buildAssessmentSummary(assessment, previousAssessment = null) {
  const averageText = getAssessmentAverage(assessment);
  const average = Number(averageText);
  const strengths = [];
  const development = [];
  const unmetRequirements = [];

  PERFORMANCE_ASSESSMENT_ITEMS.forEach((item, index) => {
    const score = Number(assessment.ratings?.[index]?.score);
    if (score >= 4) strengths.push(item);
    if (score > 0 && score <= 2) development.push(item);
  });
  BASIC_ASSESSMENT_ITEMS.forEach((item, index) => {
    if (assessment.basic?.[index]?.answer === "Nej") unmetRequirements.push(item);
  });

  let level = "Det finns inte tillräckligt med poäng för en helhetsbild ännu.";
  if (Number.isFinite(average)) {
    if (average >= 4.3) level = `Mycket stark prestation med ett snitt på ${averageText} av 5.`;
    else if (average >= 3.5) level = `Stabil och bra prestation med ett snitt på ${averageText} av 5.`;
    else if (average >= 2.7) level = `Godkänd nivå med ett snitt på ${averageText} av 5, med tydliga utvecklingsmöjligheter.`;
    else level = `Prestationen behöver stöd och uppföljning; snittet är ${averageText} av 5.`;
  }

  const summary = {
    level,
    strengths,
    development,
    unmetRequirements,
    comparison: null
  };
  if (!previousAssessment) return summary;

  const improved = [];
  const unchangedNeeds = [];
  const declined = [];
  PERFORMANCE_ASSESSMENT_ITEMS.forEach((item, index) => {
    const current = Number(assessment.ratings?.[index]?.score);
    const previous = Number(previousAssessment.ratings?.[index]?.score);
    if (!current || !previous) return;
    if (current > previous) improved.push(`${item} (${previous}→${current})`);
    else if (current < previous) declined.push(`${item} (${previous}→${current})`);
    else if (current <= 3) unchangedNeeds.push(`${item} (${current}/5)`);
  });

  BASIC_ASSESSMENT_ITEMS.forEach((item, index) => {
    const current = assessment.basic?.[index]?.answer;
    const previous = previousAssessment.basic?.[index]?.answer;
    if (previous === "Nej" && current === "Ja") improved.push(`${item} (Nej→Ja)`);
    else if (previous === "Ja" && current === "Nej") declined.push(`${item} (Ja→Nej)`);
    else if (previous === "Nej" && current === "Nej") unchangedNeeds.push(`${item} (fortsatt Nej)`);
  });

  const previousAverage = Number(getAssessmentAverage(previousAssessment));
  let trend = "Snittutvecklingen kan inte jämföras ännu.";
  if (Number.isFinite(average) && Number.isFinite(previousAverage)) {
    const difference = average - previousAverage;
    if (difference >= 0.15) trend = `Snittet har förbättrats från ${previousAverage.toFixed(1)} till ${average.toFixed(1)}.`;
    else if (difference <= -0.15) trend = `Snittet har minskat från ${previousAverage.toFixed(1)} till ${average.toFixed(1)}.`;
    else trend = `Snittet är i stort sett oförändrat (${previousAverage.toFixed(1)}→${average.toFixed(1)}).`;
  }
  summary.comparison = { trend, improved, unchangedNeeds, declined };
  return summary;
}

function renderSummaryList(title, items, emptyText, className) {
  return `
    <div class="assessment-summary-column ${className}">
      <strong>${title}</strong>
      ${items.length
        ? `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        : `<p>${emptyText}</p>`}
    </div>
  `;
}

function renderAssessmentRecord(assessment, previousAssessment = null, assessmentNumber = 1) {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const content = document.createElement("div");
  const basicRows = BASIC_ASSESSMENT_ITEMS.map((item, index) => {
    const result = assessment.basic?.[index] || {};
    return `<li><span>${escapeHtml(item)}</span><strong>${escapeHtml(result.answer || "Ej bedömt")}</strong>${result.comment ? `<small>${escapeHtml(result.comment)}</small>` : ""}</li>`;
  }).join("");
  const ratingRows = PERFORMANCE_ASSESSMENT_ITEMS.map((item, index) => {
    const result = assessment.ratings?.[index] || {};
    return `<li><span>${escapeHtml(item)}</span><strong>${escapeHtml(result.score || "—")}/5</strong>${result.comment ? `<small>${escapeHtml(result.comment)}</small>` : ""}</li>`;
  }).join("");
  const automaticSummary = buildAssessmentSummary(assessment, previousAssessment);
  const comparisonHtml = automaticSummary.comparison
    ? `
      <div class="assessment-progress-summary">
        <h5>Utveckling sedan föregående bedömning</h5>
        <p class="assessment-trend">${escapeHtml(automaticSummary.comparison.trend)}</p>
        <div class="assessment-summary-grid">
          ${renderSummaryList("Förbättrats", automaticSummary.comparison.improved, "Inga tydliga förbättringar registrerade ännu.", "positive")}
          ${renderSummaryList("Inte förbättrats", automaticSummary.comparison.unchangedNeeds, "Inga kvarstående svagheter i jämförbara punkter.", "neutral")}
          ${renderSummaryList("Försämrats", automaticSummary.comparison.declined, "Ingen försämring registrerad.", "negative")}
        </div>
      </div>
    `
    : "";

  details.className = "assessment-record";
  summary.innerHTML = `
    <div><strong>${escapeHtml(assessment.date || "Utan datum")}</strong><span>${escapeHtml(assessment.period || "Ingen period")}</span></div>
    <div class="assessment-record-score"><span>Snitt</span><strong>${getAssessmentAverage(assessment)}</strong></div>
  `;
  content.className = "assessment-record-content";
  content.innerHTML = `
    <div class="assessment-auto-summary">
      <div class="assessment-auto-summary-heading"><div><span>Automatisk sammanfattning</span><h5>Bedömning ${assessmentNumber}</h5></div><strong>${getAssessmentAverage(assessment)}/5</strong></div>
      <p class="assessment-level-text">${escapeHtml(automaticSummary.level)}</p>
      <div class="assessment-summary-grid">
        ${renderSummaryList("Styrkor", automaticSummary.strengths, "Inga styrkor med betyg 4–5 registrerade.", "positive")}
        ${renderSummaryList("Behöver utvecklas", automaticSummary.development, "Inga områden med betyg 1–2 registrerade.", "neutral")}
        ${renderSummaryList("Grundkrav: Nej", automaticSummary.unmetRequirements, "Alla besvarade grundkrav är godkända.", "negative")}
      </div>
      ${comparisonHtml}
    </div>
    <div class="assessment-facts">
      <span><small>Skift / avdelning</small><strong>${escapeHtml(assessment.shiftDepartment || "—")}</strong></span>
      <span><small>Skiftledare</small><strong>${escapeHtml(assessment.leader || "—")}</strong></span>
      <span><small>Arbetade pass</small><strong>${escapeHtml(assessment.totalShifts || "—")}</strong></span>
      <span><small>Frånvaro</small><strong>${escapeHtml(assessment.absence || "—")}</strong></span>
    </div>
    <h5>Grundkrav</h5><ul class="assessment-results">${basicRows}</ul>
    <h5>Arbetsutförande</h5><ul class="assessment-results">${ratingRows}</ul>
    <div class="assessment-notes">
      <div><small>Styrkor</small><p>${escapeHtml(assessment.strengths || "—")}</p></div>
      <div><small>Utvecklingsområden</small><p>${escapeHtml(assessment.development || "—")}</p></div>
      <div><small>Motivering</small><p>${escapeHtml(assessment.motivation || "—")}</p></div>
    </div>
    <div class="assessment-decision">
      <span><small>Heltid i skiftet</small><strong>${escapeHtml(assessment.fullTime || "—")}</strong></span>
      <span><small>Potential</small><strong>${escapeHtml(assessment.potential || "—")}</strong></span>
      <span><small>Rekommendation</small><strong>${escapeHtml(assessment.recommendation || "—")}</strong></span>
      <span><small>Intern klassning</small><strong>${escapeHtml(assessment.classification || "—")}</strong></span>
    </div>
  `;
  details.append(summary, content);
  return details;
}

function createAssessmentForm(person, onCancel) {
  const form = document.createElement("form");
  const today = formatDateKey(new Date());
  form.className = "assessment-form";
  form.innerHTML = `
    <div class="assessment-form-heading">
      <div><span>Ny bedömning</span><h3>${escapeHtml(person.name)}</h3></div>
      <button class="btn" type="button" id="cancelAssessment">Avbryt</button>
    </div>

    <section class="assessment-section">
      <div class="assessment-section-title"><span>1</span><div><h4>Grunduppgifter</h4><p>Period och arbetsinformation</p></div></div>
      <div class="assessment-form-grid">
        <label>Medarbetare<input name="employeeName" value="${escapeHtml(person.name)}" readonly /></label>
        <label>Datum<input type="date" name="date" value="${today}" required /></label>
        <label>Bedömningsperiod<select name="period"><option value="">Välj period</option><option>Efter 1 månad</option><option>Efter 3 månader</option><option>Efter 6 månader</option></select></label>
        <label>Skift / avdelning<input name="shiftDepartment" placeholder="Exempel: Dag / Packa" /></label>
        <label>Skiftledare<input name="leader" placeholder="Namn" /></label>
        <label>Antal arbetade pass<input name="totalShifts" type="number" min="0" placeholder="0" /></label>
        <label>Frånvaro / orsak<input name="absence" placeholder="Antal och eventuell orsak" /></label>
      </div>
    </section>

    <section class="assessment-section">
      <div class="assessment-section-title"><span>2</span><div><h4>Grundkrav</h4><p>Markera Ja eller Nej och lägg till kommentar vid behov</p></div></div>
      <div class="assessment-basic-list">
        ${BASIC_ASSESSMENT_ITEMS.map((item, index) => `
          <div class="assessment-basic-row">
            <strong>${escapeHtml(item)}</strong>
            <select name="basicAnswer${index}"><option value="">Ej bedömt</option><option>Ja</option><option>Nej</option></select>
            <input name="basicComment${index}" placeholder="Kommentar (valfri)" />
          </div>
        `).join("")}
      </div>
    </section>

    <section class="assessment-section">
      <div class="assessment-section-title"><span>3</span><div><h4>Arbetsutförande och beteende</h4><p>1 = Bristfällig · 3 = Godkänd · 5 = Mycket bra</p></div></div>
      <div class="assessment-rating-list">
        ${PERFORMANCE_ASSESSMENT_ITEMS.map((item, index) => `
          <div class="assessment-rating-row">
            <strong>${escapeHtml(item)}</strong>
            <div class="rating-options">
              ${[1, 2, 3, 4, 5].map(score => `<label><input type="radio" name="rating${index}" value="${score}" /><span>${score}</span></label>`).join("")}
            </div>
            <input name="ratingComment${index}" placeholder="Kommentar (valfri)" />
          </div>
        `).join("")}
      </div>
    </section>

    <section class="assessment-section">
      <div class="assessment-section-title"><span>4</span><div><h4>Sammanfattning</h4><p>Styrkor, utveckling och rekommendation</p></div></div>
      <div class="assessment-text-grid">
        <label>Styrkor<textarea name="strengths" rows="3" placeholder="Vad fungerar särskilt bra?"></textarea></label>
        <label>Utvecklingsområden / stöd<textarea name="development" rows="3" placeholder="Vad behöver utvecklas?"></textarea></label>
      </div>
      <div class="assessment-form-grid">
        <label>Heltid i ditt skift?<select name="fullTime"><option value="">Välj</option><option>Ja, utan tvekan</option><option>Ja, med viss upplärning</option><option>Osäker</option><option>Nej</option></select></label>
        <label>Potential för fast anställning<select name="potential"><option value="">Välj</option><option>Hög</option><option>Medel</option><option>Låg</option></select></label>
        <label>Rekommendation<select name="recommendation"><option value="">Välj</option><option>Rekommenderas för fortsatt anställning</option><option>Förlängd prövotid</option><option>Fortsatt bemanning</option><option>Rekommenderas ej</option></select></label>
        <label>Intern klassning<select name="classification"><option value="">Välj</option><option>A – Rekryteringsbar direkt</option><option>B – Bra resurs, utvecklingsbar</option><option>C – Fungerar men ej rekrytering</option><option>D – Ej lämplig</option></select></label>
      </div>
      <label>Motivering<textarea name="motivation" rows="3" placeholder="Samlad motivering"></textarea></label>
    </section>

    <div class="assessment-submit-bar"><span>Bedömningen sparas säkert i personens historik.</span><button class="btn primary" type="submit">Spara bedömning</button></div>
  `;

  form.querySelector("#cancelAssessment").addEventListener("click", onCancel);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = new FormData(form);
    const assessments = await getAssessments();
    const basic = {};
    const ratings = {};
    BASIC_ASSESSMENT_ITEMS.forEach((_, index) => {
      basic[index] = { answer: data.get(`basicAnswer${index}`), comment: data.get(`basicComment${index}`).trim() };
    });
    PERFORMANCE_ASSESSMENT_ITEMS.forEach((_, index) => {
      ratings[index] = { score: data.get(`rating${index}`) || "", comment: data.get(`ratingComment${index}`).trim() };
    });
    assessments.push({
      id: makeId(), personId: person.id, employeeName: person.name, createdAt: new Date().toISOString(),
      date: data.get("date"), period: data.get("period"), shiftDepartment: data.get("shiftDepartment").trim(),
      leader: data.get("leader").trim(), totalShifts: data.get("totalShifts"), absence: data.get("absence").trim(),
      basic, ratings, strengths: data.get("strengths").trim(), development: data.get("development").trim(),
      fullTime: data.get("fullTime"), potential: data.get("potential"), recommendation: data.get("recommendation"),
      classification: data.get("classification"), motivation: data.get("motivation").trim()
    });
    await saveAssessments(assessments);
    await addAuditEvent("assessment", `${person.name}: bedömning sparad`, data.get("date"));
    assessmentFormOpen = false;
    await renderAssessments();
  });
  return form;
}

async function renderAssessments() {
  const root = document.getElementById("assessmentPage");
  if (!root) return;
  const people = await getPeople();
  const assessments = await getAssessments();
  if (!selectedAssessmentPersonId && people.length) selectedAssessmentPersonId = people[0].id;
  const selectedPerson = people.find(person => person.id === selectedAssessmentPersonId);

  root.innerHTML = "";
  const peoplePanel = document.createElement("aside");
  const peopleList = document.createElement("div");
  peoplePanel.className = "assessment-people-panel card";
  peoplePanel.innerHTML = `
    <div class="assessment-panel-heading"><div><h3>Medarbetare</h3><p>${people.length} personer</p></div></div>
    <div class="assessment-status-legend">
      <span class="status-none">Ej bedömd</span>
      <span class="status-one">En gång</span>
      <span class="status-ready">2+ gånger</span>
      <span class="status-problem">Följ upp</span>
    </div>
  `;
  peopleList.className = "assessment-people-list";
  people.forEach(person => {
    const personAssessments = assessments.filter(item => item.personId === person.id);
    const status = getPersonAssessmentStatus(personAssessments);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `assessment-person-button ${status.className}${person.id === selectedAssessmentPersonId ? " active" : ""}`;
    button.innerHTML = `<span>${escapeHtml(person.name)}</span><small>${escapeHtml(status.label)}</small>`;
    button.addEventListener("click", async () => {
      selectedAssessmentPersonId = person.id;
      assessmentFormOpen = false;
      await renderAssessments();
    });
    peopleList.appendChild(button);
  });
  if (!people.length) peopleList.innerHTML = "<p class=\"assessment-empty\">Lägg till personal först.</p>";
  peoplePanel.appendChild(peopleList);

  const content = document.createElement("section");
  content.className = "assessment-content card";
  if (!selectedPerson) {
    content.innerHTML = "<div class=\"assessment-empty-state\"><strong>Välj en medarbetare</strong><p>Personens bedömningar visas här.</p></div>";
  } else if (assessmentFormOpen) {
    content.appendChild(createAssessmentForm(selectedPerson, async () => {
      assessmentFormOpen = false;
      await renderAssessments();
    }));
  } else {
    const personAssessments = assessments
      .filter(item => item.personId === selectedPerson.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    const heading = document.createElement("div");
    const records = document.createElement("div");
    heading.className = "assessment-content-heading";
    heading.innerHTML = `<div><span>Bedömningshistorik</span><h3>${escapeHtml(selectedPerson.name)}</h3><p>${escapeHtml(selectedPerson.company || "")}</p></div>`;
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "btn primary";
    addButton.textContent = "+ Ny bedömning";
    addButton.addEventListener("click", async () => {
      assessmentFormOpen = true;
      await renderAssessments();
    });
    heading.appendChild(addButton);
    records.className = "assessment-records";
    const chronologicalAssessments = [...personAssessments].sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt))
    );
    personAssessments.forEach((assessment, displayIndex) => {
      const chronologicalIndex = chronologicalAssessments.findIndex(item => item.id === assessment.id);
      const previousAssessment = chronologicalIndex > 0
        ? chronologicalAssessments[chronologicalIndex - 1]
        : null;
      const record = renderAssessmentRecord(
        assessment,
        previousAssessment,
        chronologicalIndex + 1
      );
      if (displayIndex === 0) record.open = true;
      records.appendChild(record);
    });
    if (!personAssessments.length) records.innerHTML = "<div class=\"assessment-empty-state\"><strong>Ingen bedömning ännu</strong><p>Skapa den första bedömningen för medarbetaren.</p></div>";
    content.append(heading, records);
  }
  root.append(peoplePanel, content);
}

function makeCell(text, className = "") {
  const div = document.createElement("div");
  div.className = `cell ${className}`.trim();
  div.textContent = text;
  return div;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return map[character];
  });
}

async function renderSchedule() {
  const root = document.getElementById("scheduleGrid");
  if (!root) return;

  const [people, schedule, trainingLeaders, trainingLocations, skills, restrictions] =
    await Promise.all([
      getPeople(),
      getSchedule(),
      getTrainingLeaders(),
      getTrainingLocations(),
      getMachineSkills(),
      getMachineRestrictions()
    ]);
  const dates = getDatesForWeek();

  renderAvailabilitySummary(root, people);
  renderTrainingScheduleSummary(root, people, schedule, trainingLocations);
  root.innerHTML = "";
  root.appendChild(makeCell("Uppgift", "header task"));

  DAYS.forEach((day, index) => {
    const header = document.createElement("div");
    header.className = "cell header day-header";
    header.innerHTML = `
      <span class="day-name-full">${day}</span>
      <span class="day-name-short">${day.slice(0, 2)}</span>
      <small>${dates[index]}</small>
    `;
    root.appendChild(header);
  });

  TASKS.forEach(task => {
    const isTrainingTask = task.includes("Utbildning");
    const trainingVariantClass = task === "Utbildning 1"
      ? "utbildning-1"
      : task === "Utbildning 2"
        ? "utbildning-2"
        : "";
    const taskClassName = isTrainingTask
      ? `task utbildning ${trainingVariantClass}`
      : "task";

    root.appendChild(makeCell(task, taskClassName));

    DAYS.forEach(day => {
      const cell = document.createElement("div");
      const select = document.createElement("select");
      const emptyOption = document.createElement("option");
      const assignedPeople = getAssignedPeopleForDay(schedule, day, task);
      const dayTrainingLeaders = getTrainingLeadersForDay(trainingLeaders, day);
      const selectedPersonId = schedule[task]?.[day] ?? "";
      const trainingReservation = !isTrainingTask
        ? TASKS.filter(item => item.includes("Utbildning")).map(trainingTask => ({
            trainingTask,
            person: people.find(person => person.id === schedule?.[trainingTask]?.[day]),
            location: trainingLocations?.[trainingTask]?.[day]
          })).find(entry => entry.person && entry.location === task)
        : null;

      cell.className = isTrainingTask
        ? `cell utbildning ${trainingVariantClass}`
        : "cell";
      select.className = "schedule-select";

      if (isTrainingTask) {
        select.setAttribute("aria-label", `Person under utbildning för ${task} ${day}`);
      }

      emptyOption.value = "";
      emptyOption.textContent = isTrainingTask ? "Välj person" : "-- Välj --";
      select.appendChild(emptyOption);

      if (trainingReservation) {
        const trainingOption = document.createElement("option");
        trainingOption.value = "__training__";
        trainingOption.textContent = `Utbildning · ${trainingReservation.person.name}`;
        trainingOption.selected = true;
        select.appendChild(trainingOption);
        select.disabled = true;
        select.classList.add("schedule-training-reserved");
        select.title = `${trainingReservation.person.name} har utbildning på ${task}`;
      }

      people.forEach(person => {
        if (trainingReservation) return;
        if (assignedPeople.has(person.id) && person.id !== selectedPersonId) {
          return;
        }

        if (!isTrainingTask && dayTrainingLeaders.has(person.id) && person.id !== selectedPersonId) {
          return;
        }

        const availability = getPersonAvailability(person);
        if (availability !== "available") return;
        let eligibilityLabel = "";
        if (!isTrainingTask) {
          const department = getTaskDepartment(task);
          const personSkills = Array.isArray(skills[person.id]) ? skills[person.id] : [];
          const personRestrictions = Array.isArray(restrictions[person.id])
            ? restrictions[person.id]
            : [];
          const isRestricted = department === "GD" && personRestrictions.includes("GD");
          const isEligible = personSkills.includes(department) && !isRestricted;
          if (!isEligible) {
            eligibilityLabel = isRestricted ? "Får inte GD" : "Kompetens saknas";
          }
        }

        const option = document.createElement("option");
        option.value = person.id;
        option.textContent = eligibilityLabel
          ? `${person.name} — ${eligibilityLabel}`
          : person.name;
        option.selected = selectedPersonId === person.id;
        option.disabled = Boolean(eligibilityLabel);
        if (eligibilityLabel) {
          option.className = eligibilityLabel === "Får inte GD"
            ? "schedule-option-restricted"
            : "schedule-option-missing-skill";
          option.title = eligibilityLabel;
        }
        select.appendChild(option);
      });

      const scheduledPerson = people.find(person => person.id === selectedPersonId);
      const scheduledAvailability = getPersonAvailability(scheduledPerson);
      if (scheduledPerson && scheduledAvailability !== "available") {
        select.classList.add(`schedule-person-${scheduledAvailability}`);
        select.title = getUnavailableMessage(scheduledPerson);
      }

      select.addEventListener("change", async () => {
        const selectedId = select.value;
        const assignedElsewhere = getAssignedPeopleForDay(schedule, day, task);
        const selectedPerson = people.find(person => person.id === selectedId);

        if (selectedPerson && getPersonAvailability(selectedPerson) !== "available") {
          alert(getUnavailableMessage(selectedPerson));
          await renderSchedule();
          return;
        }

        if (selectedId && assignedElsewhere.has(selectedId)) {
          alert("Den här personen är redan schemalagd i en annan avdelning samma dag.");
          await renderSchedule();
          return;
        }

        if (!isTrainingTask && selectedId && getTrainingLeadersForDay(trainingLeaders, day).has(selectedId)) {
          alert("Den här personen är vald som handledare och kan inte samtidigt arbeta på en maskin.");
          await renderSchedule();
          return;
        }

        schedule[task] ??= {};
        schedule[task][day] = selectedId;

        if (
          isTrainingTask &&
          (!selectedId || trainingLeaders[task]?.[day] === selectedId)
        ) {
          trainingLeaders[task][day] = "";
          await saveTrainingLeaders(trainingLeaders);
        }

        if (isTrainingTask && !selectedId && trainingLocations[task]?.[day]) {
          trainingLocations[task][day] = "";
          await saveTrainingLocations(trainingLocations);
        }

        await saveSchedule(schedule);
        await addAuditEvent("schedule", `${task} · ${day}`, selectedPerson ? `${selectedPerson.name} schemalagd` : "Placering rensad");
        await renderSchedule();
        await renderBreakPlanner();
      });

      if (isTrainingTask) {
        const personLabel = document.createElement("label");
        personLabel.className = "training-field-label";
        personLabel.innerHTML = "<span>1</span> Person";
        cell.append(personLabel, select);
      } else {
        cell.appendChild(select);
      }

      if (isTrainingTask) {
        const leaderLabel = document.createElement("label");
        const leaderSelect = document.createElement("select");
        const emptyLeaderOption = document.createElement("option");
        const selectedLeaderId = trainingLeaders[task]?.[day] ?? "";
        const assignedPeopleForLeader = getAssignedPeopleForDay(schedule, day);
        const otherTrainingLeaders = getTrainingLeadersForDay(trainingLeaders, day, task);
        const locationLabel = document.createElement("label");
        const locationSelect = document.createElement("select");
        const emptyLocationOption = document.createElement("option");
        const selectedLocation = trainingLocations[task]?.[day] ?? "";

        cell.classList.add("training-cell");
        leaderLabel.className = "training-field-label";
        leaderLabel.innerHTML = "<span>2</span> Handledare";
        leaderSelect.className = "schedule-select training-leader-select";
        leaderSelect.setAttribute("aria-label", `Handledare för ${task} ${day}`);
        leaderSelect.disabled = !selectedPersonId;
        emptyLeaderOption.value = "";
        emptyLeaderOption.textContent = "Välj handledare";
        leaderSelect.appendChild(emptyLeaderOption);

        people.forEach(person => {
          if (person.id === selectedPersonId) return;
          if (assignedPeopleForLeader.has(person.id) && person.id !== selectedLeaderId) return;
          if (otherTrainingLeaders.has(person.id) && person.id !== selectedLeaderId) return;

          const availability = getPersonAvailability(person);
          if (availability !== "available") return;

          const option = document.createElement("option");
          option.value = person.id;
          option.textContent = person.name;
          option.selected = selectedLeaderId === person.id;
          leaderSelect.appendChild(option);
        });

        const selectedLeader = people.find(person => person.id === selectedLeaderId);
        const leaderAvailability = getPersonAvailability(selectedLeader);
        if (selectedLeader && leaderAvailability !== "available") {
          leaderSelect.classList.add(`schedule-person-${leaderAvailability}`);
          leaderSelect.title = getUnavailableMessage(selectedLeader);
        }

        leaderSelect.addEventListener("change", async () => {
          const leaderId = leaderSelect.value;
          if (leaderId && getAssignedPeopleForDay(schedule, day).has(leaderId)) {
            alert("Den här personen arbetar redan på en maskin eller avdelning den här dagen.");
            await renderSchedule();
            return;
          }
          if (leaderId && getTrainingLeadersForDay(trainingLeaders, day, task).has(leaderId)) {
            alert("Den här personen är redan handledare för en annan utbildning den här dagen.");
            await renderSchedule();
            return;
          }
          trainingLeaders[task] ??= {};
          trainingLeaders[task][day] = leaderId;
          await saveTrainingLeaders(trainingLeaders);
          await addAuditEvent("schedule", `${task} · ${day}`, leaderId ? `${people.find(person => person.id === leaderId)?.name || "Handledare"} vald som handledare` : "Handledare rensad");
          await renderSchedule();
          await renderBreakPlanner();
        });

        cell.appendChild(leaderLabel);
        cell.appendChild(leaderSelect);

        locationLabel.className = "training-field-label";
        locationLabel.innerHTML = "<span>3</span> Maskin / avdelning";
        locationSelect.className = "schedule-select training-location-select";
        locationSelect.setAttribute("aria-label", `Maskin eller avdelning för ${task} ${day}`);
        locationSelect.disabled = !selectedPersonId;
        emptyLocationOption.value = "";
        emptyLocationOption.textContent = "Välj plats";
        locationSelect.appendChild(emptyLocationOption);

        TASKS.filter(location => !location.includes("Utbildning")).forEach(location => {
          const option = document.createElement("option");
          const occupiedBy = schedule?.[location]?.[day];
          const reservedByOtherTraining = TASKS.filter(item => item.includes("Utbildning") && item !== task)
            .some(item => trainingLocations?.[item]?.[day] === location && schedule?.[item]?.[day]);
          option.value = location;
          option.textContent = occupiedBy || reservedByOtherTraining
            ? `${location} · Upptagen`
            : location;
          option.selected = selectedLocation === location;
          option.disabled = selectedLocation !== location && Boolean(occupiedBy || reservedByOtherTraining);
          locationSelect.appendChild(option);
        });

        locationSelect.addEventListener("change", async () => {
          const nextLocation = locationSelect.value;
          if (nextLocation && schedule?.[nextLocation]?.[day]) {
            alert("Den här maskinen eller avdelningen är redan upptagen den här dagen.");
            await renderSchedule();
            return;
          }
          const usedByOtherTraining = TASKS.filter(item => item.includes("Utbildning") && item !== task)
            .some(item => trainingLocations?.[item]?.[day] === nextLocation && schedule?.[item]?.[day]);
          if (nextLocation && usedByOtherTraining) {
            alert("Platsen används redan av en annan utbildning den här dagen.");
            await renderSchedule();
            return;
          }
          trainingLocations[task] ??= {};
          trainingLocations[task][day] = nextLocation;
          await saveTrainingLocations(trainingLocations);
          await renderSchedule();
        });

        cell.appendChild(locationLabel);
        cell.appendChild(locationSelect);
      }

      root.appendChild(cell);
    });
  });
}

async function renderPeople() {
  const list = document.getElementById("peopleList");
  if (!list) return;

  const allPeople = await getPeople();
  const query = (document.getElementById("peopleSearch")?.value || "").trim().toLocaleLowerCase();
  const statusFilter = document.getElementById("availabilityFilter")?.value || "";
  const people = allPeople.filter(person =>
    (!query || `${person.name} ${person.company || ""}`.toLocaleLowerCase().includes(query)) &&
    (!statusFilter || getPersonAvailability(person) === statusFilter)
  );
  list.innerHTML = "";

  people.forEach(person => {
    const row = document.createElement("div");
    const meta = document.createElement("div");
    const actions = document.createElement("div");
    const availabilitySelect = document.createElement("select");
    const editBtn = document.createElement("button");
    const deleteBtn = document.createElement("button");
    const availability = getPersonAvailability(person);

    row.className = `person-row person-row-${availability}`;
    meta.className = "person-meta";
    actions.className = "person-actions";
    availabilitySelect.className = `person-availability person-availability-${availability}`;
    availabilitySelect.setAttribute("aria-label", `Tillgänglighet för ${person.name}`);
    availabilitySelect.title = availability === "available"
      ? `${person.name} är tillgänglig.`
      : getUnavailableMessage(person);
    editBtn.className = "btn";
    deleteBtn.className = "btn danger";

    meta.innerHTML = `
      <h3 title="${escapeHtml(availabilitySelect.title)}">${escapeHtml(person.name)}</h3>
      <p>${escapeHtml(person.company || "")}</p>
    `;

    [
      ["available", "Tillgänglig"],
      ["sick", "Sjuk"],
      ["vacation", "Semester"],
      ["unavailable", "Inte tillgänglig"]
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = availability === value;
      availabilitySelect.appendChild(option);
    });

    availabilitySelect.addEventListener("change", async () => {
      person.availability = availabilitySelect.value;
      await savePeople(allPeople);
      await addAuditEvent("availability", `${person.name}: ${getAvailabilityLabel(availabilitySelect.value)}`, "Tillgänglighet uppdaterad", { action: "availability", personId: person.id, value: availability });

      if (availabilitySelect.value !== "available") {
        const schedule = await getSchedule();
        const trainingLeaders = await getTrainingLeaders();
        const trainingLocations = await getTrainingLocations();

        TASKS.forEach(task => {
          DAYS.forEach(day => {
            if (schedule[task]?.[day] === person.id) {
              schedule[task][day] = "";
              if (task.includes("Utbildning") && trainingLocations[task]?.[day]) {
                trainingLocations[task][day] = "";
              }
            }
            if (trainingLeaders[task]?.[day] === person.id) {
              trainingLeaders[task][day] = "";
            }
          });
        });

        await saveSchedule(schedule);
        await saveTrainingLeaders(trainingLeaders);
        await saveTrainingLocations(trainingLocations);
      }

      await refreshAppViews();
    });

    editBtn.textContent = "Redigera";
    editBtn.onclick = () => editPerson(person.id);

    deleteBtn.textContent = "Ta bort";
    deleteBtn.onclick = () => deletePerson(person.id);

    actions.append(availabilitySelect, editBtn, deleteBtn);
    row.append(meta, actions);
    list.appendChild(row);
  });
  if (!people.length) {
    list.innerHTML = `<div class="empty-state">${allPeople.length ? "Ingen personal matchar filtret." : "Ingen personal har lagts till ännu."}</div>`;
  }
}

function getTestResultClass(score) {
  if (score === "" || score === null || score === undefined) return "not-tested";
  const numericScore = Number(score);
  if (numericScore >= 4) return "test-high";
  if (numericScore >= 3) return "test-medium";
  return "test-low";
}

async function renderTestResults() {
  const root = document.getElementById("testResultsGrid");
  if (!root) return;

  const [allPeople, departments, results] = await Promise.all([
    getPeople(),
    getDepartments(),
    getTestResults()
  ]);
  const testQuery = (document.getElementById("testSearch")?.value || "").trim().toLocaleLowerCase();
  const people = allPeople.filter(person => !testQuery || `${person.name} ${person.company || ""}`.toLocaleLowerCase().includes(testQuery));
  const form = document.getElementById("departmentForm");
  const input = document.getElementById("departmentNameInput");
  const message = document.getElementById("departmentMessage");
  const departmentList = document.getElementById("departmentList");

  if (form && input && form.dataset.bound !== "true") {
    form.dataset.bound = "true";
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const name = input.value.trim();
      const currentDepartments = await getDepartments();

      if (!name) return;
      if (currentDepartments.some(item => item.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        if (message) {
          message.textContent = "Avdelningen finns redan.";
          message.className = "inline-message error";
        }
        return;
      }

      currentDepartments.push(name);
      await saveDepartments(currentDepartments);
      await addAuditEvent("department", `${name} tillagd`, "Ny avdelning");
      input.value = "";
      if (message) {
        message.textContent = `${name} har lagts till.`;
        message.className = "inline-message success";
      }
      await renderTestResults();
      await renderMachineSkills();
      await renderTrainingReminders();
    });
  }

  if (departmentList) {
    departmentList.innerHTML = "";
    departments.forEach(department => {
      const chip = document.createElement("div");
      const name = document.createElement("span");
      const removeButton = document.createElement("button");
      chip.className = "department-chip";
      name.textContent = department;
      removeButton.type = "button";
      removeButton.className = "department-remove";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", `Ta bort ${department}`);
      removeButton.title = `Ta bort ${department}`;
      removeButton.addEventListener("click", async () => {
        const shouldRemove = confirm(
          `Vill du ta bort ${department}? Testresultat och maskinbehörighet för avdelningen tas också bort.`
        );
        if (!shouldRemove) return;

        const [currentDepartments, currentResults, currentSkills, currentRestrictions, currentDetails] = await Promise.all([
          getDepartments(),
          getTestResults(),
          getMachineSkills(),
          getMachineRestrictions(),
          getMachineSkillDetails()
        ]);
        const updatedDepartments = currentDepartments.filter(item => item !== department);
        Object.values(currentResults).forEach(personResults => {
          if (personResults && typeof personResults === "object") {
            delete personResults[department];
          }
        });
        Object.keys(currentSkills).forEach(personId => {
          if (Array.isArray(currentSkills[personId])) {
            currentSkills[personId] = currentSkills[personId].filter(item => item !== department);
          }
        });
        Object.keys(currentRestrictions).forEach(personId => {
          if (Array.isArray(currentRestrictions[personId])) {
            currentRestrictions[personId] =
              currentRestrictions[personId].filter(item => item !== department);
          }
        });
        Object.values(currentDetails).forEach(personDetails => { if (personDetails && typeof personDetails === "object") delete personDetails[department]; });

        await Promise.all([
          saveDepartments(updatedDepartments),
          saveTestResults(currentResults),
          saveMachineSkills(currentSkills),
          saveMachineRestrictions(currentRestrictions),
          saveMachineSkillDetails(currentDetails)
        ]);
        await addAuditEvent("department", `${department} borttagen`, "Resultat och kompetenser rensades");
        if (message) {
          message.textContent = `${department} har tagits bort.`;
          message.className = "inline-message success";
        }
        await renderTestResults();
        await renderMachineSkills();
        await renderTrainingReminders();
      });
      chip.append(name, removeButton);
      departmentList.appendChild(chip);
    });
  }

  root.innerHTML = "";
  root.className = "assessment-layout test-results-layout";
  if (!people.length) {
    root.innerHTML = `<div class="empty-state">${allPeople.length ? "Ingen personal matchar sökningen." : "Lägg till personal innan du registrerar testresultat."}</div>`;
    return;
  }

  if (selectedTestPersonId && !people.some(person => person.id === selectedTestPersonId)) {
    selectedTestPersonId = "";
  }

  const peoplePanel = document.createElement("aside");
  const peopleList = document.createElement("div");
  peoplePanel.className = "assessment-people-panel card";
  peoplePanel.innerHTML = `
    <div class="assessment-panel-heading">
      <div><h3>Medarbetare</h3><p>${people.length} personer</p></div>
    </div>
  `;
  peopleList.className = "assessment-people-list";

  people.forEach(person => {
    const testedCount = departments.filter(
      department => results[person.id]?.[department] !== undefined
    ).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `assessment-person-button status-none${
      person.id === selectedTestPersonId ? " active" : ""
    }`;
    button.innerHTML = `
      <span>${escapeHtml(person.name)}</span>
      <small>${testedCount} av ${departments.length} testade</small>
    `;
    button.addEventListener("click", async () => {
      selectedTestPersonId = person.id;
      await renderTestResults();
    });
    peopleList.appendChild(button);
  });
  peoplePanel.appendChild(peopleList);

  const content = document.createElement("section");
  content.className = "assessment-content card test-result-content";
  const selectedPerson = people.find(person => person.id === selectedTestPersonId);

  if (!selectedPerson) {
    content.innerHTML = `
      <div class="assessment-empty-state">
        <strong>Välj en medarbetare</strong>
        <p>Personens testresultat visas här efter att du har valt ett namn.</p>
      </div>
    `;
    root.append(peoplePanel, content);
    return;
  }

  const heading = document.createElement("div");
  const fields = document.createElement("div");
  heading.className = "competency-person-heading test-result-person-heading";
  heading.innerHTML = `
    <div><h3>${escapeHtml(selectedPerson.name)}</h3><p>${escapeHtml(selectedPerson.company || "Inget företag")}</p></div>
    <span>Testresultat</span>
  `;
  fields.className = "test-department-grid";

  departments.forEach(department => {
      const field = document.createElement("label");
      const label = document.createElement("span");
      const inputWrap = document.createElement("div");
      const scoreInput = document.createElement("input");
      const suffix = document.createElement("small");
      const storedScore = results[selectedPerson.id]?.[department] ?? "";
      field.className = "test-score-field";
      label.textContent = department;
      inputWrap.className = `test-score-input ${getTestResultClass(storedScore)}`;
      scoreInput.type = "number";
      scoreInput.min = "0";
      scoreInput.max = "5";
      scoreInput.step = "1";
      scoreInput.inputMode = "numeric";
      scoreInput.value = storedScore;
      scoreInput.placeholder = "—";
      scoreInput.setAttribute("aria-label", `${selectedPerson.name}, ${department}`);
      suffix.textContent = "/ 5";

      scoreInput.addEventListener("change", async () => {
        let value = scoreInput.value === "" ? "" : Math.round(Number(scoreInput.value));
        if (value !== "") value = Math.max(0, Math.min(5, value));
        scoreInput.value = value;
        results[selectedPerson.id] ??= {};
        if (value === "") delete results[selectedPerson.id][department];
        else results[selectedPerson.id][department] = value;
        inputWrap.className = `test-score-input ${getTestResultClass(value)}`;
        await saveTestResults(results);
        await addAuditEvent("test", `${selectedPerson.name}: ${department}`, value === "" ? "Resultat borttaget" : `Resultat ${value}/5`, { action: "test", personId: selectedPerson.id, department, value: storedScore });
      });

      inputWrap.append(scoreInput, suffix);
      field.append(label, inputWrap);
      fields.appendChild(field);
    });
  content.append(heading, fields);
  root.append(peoplePanel, content);
}

async function renderTrainingReminders() {
  const main = document.querySelector("#appShell .main");
  if (!main) return;

  const [people, departments, skills, timestamps] = await Promise.all([
    getPeople(),
    getDepartments(),
    getMachineSkills(),
    getMachineSkillUpdatedAt()
  ]);
  const now = Date.now();
  const monthInMilliseconds = 30 * 24 * 60 * 60 * 1000;
  let timestampsChanged = false;

  people.forEach(person => {
    if (!timestamps[person.id]) {
      timestamps[person.id] = new Date(now).toISOString();
      timestampsChanged = true;
    }
  });
  if (timestampsChanged) await saveMachineSkillUpdatedAt(timestamps);

  const reminders = people.flatMap(person => {
    const personSkills = Array.isArray(skills[person.id]) ? skills[person.id] : [];
    const learnedCount = personSkills.filter(machine => departments.includes(machine)).length;
    const lastUpdated = new Date(timestamps[person.id]).getTime();
    const elapsed = Number.isFinite(lastUpdated) ? now - lastUpdated : 0;
    const knowsEveryMachine = departments.length > 0 && learnedCount >= departments.length;

    if (learnedCount !== 1 || knowsEveryMachine || elapsed < monthInMilliseconds) return [];
    return [{
      person,
      machine: personSkills.find(item => departments.includes(item)) || personSkills[0],
      days: Math.floor(elapsed / (24 * 60 * 60 * 1000))
    }];
  });

  let panel = document.getElementById("trainingReminderPanel");
  if (!reminders.length) {
    panel?.remove();
    return;
  }

  if (!panel) {
    panel = document.createElement("section");
    panel.id = "trainingReminderPanel";
    panel.className = "training-reminder-panel";
    const header = main.querySelector(".header");
    if (header) header.insertAdjacentElement("afterend", panel);
    else main.prepend(panel);
  }

  panel.innerHTML = `
    <div class="training-reminder-icon" aria-hidden="true">!</div>
    <div class="training-reminder-content">
      <div class="training-reminder-heading">
        <div>
          <span>Utbildningspåminnelse</span>
          <strong>Dags att planera ny maskinutbildning</strong>
        </div>
        <span class="training-reminder-count">${reminders.length}</span>
      </div>
      <p>Följande personer har endast en maskin registrerad och ingen ny kompetens har lagts till på minst 30 dagar.</p>
      <div class="training-reminder-people">
        ${reminders.map(item => `
          <div class="training-reminder-person" title="${escapeHtml(item.person.name)} behöver en ny utbildningsplan">
            <span>${escapeHtml(item.person.name)}</span>
            <small>${escapeHtml(item.machine || "En maskin")} · ${item.days} dagar</small>
          </div>
        `).join("")}
      </div>
    </div>
    <a class="btn primary training-reminder-action" href="maskiner.html">Planera utbildning</a>
  `;
}

async function renderMachineSkills() {
  const root = document.getElementById("machineSkillsGrid");
  if (!root) return;

  const [allPeople, departments, skills, timestamps, restrictions, details] = await Promise.all([
    getPeople(),
    getDepartments(),
    getMachineSkills(),
    getMachineSkillUpdatedAt(),
    getMachineRestrictions(),
    getMachineSkillDetails()
  ]);
  const machineQuery = (document.getElementById("machineSearch")?.value || "").trim().toLocaleLowerCase();
  const machineFilter = document.getElementById("machineFilter")?.value || "";
  const people = allPeople.filter(person => {
    const personSkills = Array.isArray(skills[person.id]) ? skills[person.id] : [];
    const personRestrictions = Array.isArray(restrictions[person.id]) ? restrictions[person.id] : [];
    const matchesQuery = !machineQuery || `${person.name} ${person.company || ""}`.toLocaleLowerCase().includes(machineQuery);
    const matchesFilter = !machineFilter ||
      (machineFilter === "complete" && departments.length > 0 && departments.every(item => personSkills.includes(item))) ||
      (machineFilter === "incomplete" && !departments.every(item => personSkills.includes(item))) ||
      (machineFilter === "restricted" && personRestrictions.includes("GD"));
    return matchesQuery && matchesFilter;
  });
  const nowIso = new Date().toISOString();
  let timestampsChanged = false;
  people.forEach(person => {
    if (!timestamps[person.id]) {
      timestamps[person.id] = nowIso;
      timestampsChanged = true;
    }
  });
  if (timestampsChanged) await saveMachineSkillUpdatedAt(timestamps);
  root.innerHTML = "";

  if (!people.length) {
    root.innerHTML = `<div class="empty-state">${allPeople.length ? "Ingen personal matchar filtret." : "Lägg till personal innan du registrerar maskinbehörighet."}</div>`;
    return;
  }

  if (selectedCompetencyPersonId && !people.some(person => person.id === selectedCompetencyPersonId)) {
    selectedCompetencyPersonId = "";
  }
  root.className = "assessment-layout competency-layout";
  const peoplePanel = document.createElement("aside");
  const peopleList = document.createElement("div");
  const content = document.createElement("section");
  peoplePanel.className = "assessment-people-panel card competency-people-panel";
  peoplePanel.innerHTML = `<div class="assessment-panel-heading"><div><h3>Medarbetare</h3><p>${people.length} personer</p></div></div>`;
  peopleList.className = "assessment-people-list";
  people.forEach(person => {
    const personSkills = Array.isArray(skills[person.id]) ? skills[person.id] : [];
    const isRestricted = Array.isArray(restrictions[person.id]) && restrictions[person.id].includes("GD");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.personId = person.id;
    button.className = `assessment-person-button competency-person-button status-${personSkills.length >= departments.length && departments.length ? "ready" : personSkills.length ? "one" : "none"}${person.id === selectedCompetencyPersonId ? " active" : ""}`;
    button.innerHTML = `<span>${escapeHtml(person.name)}</span><small>${personSkills.length} av ${departments.length}${isRestricted ? " · Får inte GD" : ""}</small>`;
    button.addEventListener("click", () => { selectedCompetencyPersonId = person.id; void renderMachineSkills(); });
    peopleList.appendChild(button);
  });
  peoplePanel.appendChild(peopleList);
  content.className = "assessment-content card competency-content";
  const selectedPerson = people.find(person => person.id === selectedCompetencyPersonId);
  if (!selectedPerson) {
    content.innerHTML = `<div class="competency-empty-state"><span>✓</span><strong>Välj en medarbetare</strong><p>Personens maskinkompetenser och utbildningsuppgifter visas här.</p></div>`;
    root.append(peoplePanel, content);
    return;
  }

  {
    const person = selectedPerson;
    const card = document.createElement("article");
    const heading = document.createElement("div");
    const machineGrid = document.createElement("div");
    const personSkills = new Set(Array.isArray(skills[person.id]) ? skills[person.id] : []);
    const personRestrictions = new Set(
      Array.isArray(restrictions[person.id]) ? restrictions[person.id] : []
    );
    card.className = "competency-person-card";
    heading.className = "competency-person-heading";
    heading.innerHTML = `
      <div><h3>${escapeHtml(person.name)}</h3><p>${escapeHtml(person.company || "Inget företag")}</p></div>
      <span>${personSkills.size} av ${departments.length}</span>
    `;
    machineGrid.className = "machine-skill-grid";

    departments.forEach(department => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      const indicator = document.createElement("span");
      const text = document.createElement("span");
      const isRestricted = department === "GD" && personRestrictions.has("GD");
      label.className = `machine-skill${personSkills.has(department) ? " is-qualified" : ""}${
        isRestricted ? " is-restricted" : ""
      }`;
      checkbox.type = "checkbox";
      checkbox.checked = personSkills.has(department);
      indicator.className = "machine-skill-indicator";
      text.textContent = department;
      checkbox.addEventListener("change", async () => {
        if (checkbox.checked) {
          personSkills.add(department);
          if (department === "GD") personRestrictions.delete("GD");
        }
        else personSkills.delete(department);
        skills[person.id] = [...personSkills];
        restrictions[person.id] = [...personRestrictions];
        label.classList.toggle("is-qualified", checkbox.checked);
        label.classList.remove("is-restricted");
        const restrictionButton = label.querySelector(".gd-restriction-toggle");
        if (restrictionButton) {
          restrictionButton.setAttribute("aria-pressed", "false");
        }
        heading.querySelector(":scope > span").textContent =
          `${personSkills.size} av ${departments.length}`;
        const listStatus = peoplePanel.querySelector(`[data-person-id="${person.id}"] small`);
        if (listStatus) listStatus.textContent = `${personSkills.size} av ${departments.length}`;
        if (checkbox.checked) timestamps[person.id] = new Date().toISOString();
        await Promise.all([
          saveMachineSkills(skills),
          saveMachineSkillUpdatedAt(timestamps),
          saveMachineRestrictions(restrictions)
        ]);
        await addAuditEvent("competency", `${person.name}: ${department}`, checkbox.checked ? "Kompetens tillagd" : "Kompetens borttagen", { action: "skill", personId: person.id, department, enabled: !checkbox.checked });
        await renderTrainingReminders();
      });
      label.append(checkbox, indicator, text);

      if (department === "GD") {
        const restrictionButton = document.createElement("button");
        restrictionButton.type = "button";
        restrictionButton.className = "gd-restriction-toggle";
        restrictionButton.textContent = "Får inte";
        restrictionButton.setAttribute("aria-pressed", String(isRestricted));
        restrictionButton.title = "Personen får inte arbeta på GD";
        restrictionButton.addEventListener("click", async event => {
          event.preventDefault();
          event.stopPropagation();
          const shouldRestrict = !personRestrictions.has("GD");
          if (shouldRestrict) {
            personRestrictions.add("GD");
            personSkills.delete("GD");
            checkbox.checked = false;
            label.classList.remove("is-qualified");
          } else {
            personRestrictions.delete("GD");
          }
          label.classList.toggle("is-restricted", shouldRestrict);
          restrictionButton.setAttribute("aria-pressed", String(shouldRestrict));
          skills[person.id] = [...personSkills];
          restrictions[person.id] = [...personRestrictions];
          heading.querySelector(":scope > span").textContent =
            `${personSkills.size} av ${departments.length}`;
          const listStatus = peoplePanel.querySelector(`[data-person-id="${person.id}"] small`);
          if (listStatus) listStatus.textContent = `${personSkills.size} av ${departments.length}${shouldRestrict ? " · Får inte GD" : ""}`;
          await Promise.all([
            saveMachineSkills(skills),
            saveMachineRestrictions(restrictions)
          ]);
          await addAuditEvent("restriction", `${person.name}: GD`, shouldRestrict ? "Får inte aktiverad" : "Får inte borttagen", { action: "restriction", personId: person.id, enabled: !shouldRestrict });
          await renderTrainingReminders();
        });
        label.appendChild(restrictionButton);
      }
      const detailPanel = document.createElement("div");
      const savedDetail = details[person.id]?.[department] || {};
      detailPanel.className = `machine-detail-panel${checkbox.checked ? "" : " hidden"}`;
      detailPanel.innerHTML = `
        <label>Nivå<select class="skill-level"><option value="training">Under upplärning</option><option value="independent">Självständig</option><option value="trainer">Kan lära ut</option></select></label>
        <label>Datum<input class="skill-date" type="date" value="${escapeHtml(savedDetail.date || "")}" /></label>
        <label>Utbildare<input class="skill-trainer" value="${escapeHtml(savedDetail.trainer || "")}" placeholder="Namn" /></label>
        <label class="skill-notes-label">Anteckning<input class="skill-notes" value="${escapeHtml(savedDetail.notes || "")}" placeholder="Valfri anteckning" /></label>
      `;
      detailPanel.querySelector(".skill-level").value = savedDetail.level || "independent";
      const saveDetail = async () => {
        details[person.id] ??= {};
        details[person.id][department] = {
          level: detailPanel.querySelector(".skill-level").value,
          date: detailPanel.querySelector(".skill-date").value,
          trainer: detailPanel.querySelector(".skill-trainer").value.trim(),
          notes: detailPanel.querySelector(".skill-notes").value.trim()
        };
        await saveMachineSkillDetails(details);
        await addAuditEvent("competency", `${person.name}: ${department} uppdaterad`, getAvailabilityLabel("available"));
      };
      detailPanel.querySelectorAll("input, select").forEach(field => field.addEventListener("change", saveDetail));
      checkbox.addEventListener("change", () => detailPanel.classList.toggle("hidden", !checkbox.checked));
      const machineItem = document.createElement("div");
      machineItem.className = "machine-skill-item";
      machineItem.append(label, detailPanel);
      machineGrid.appendChild(machineItem);
    });
    card.append(heading, machineGrid);
    content.appendChild(card);
  }
  root.append(peoplePanel, content);
}

async function getScheduleForDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = date.getDay();
  date.setDate(date.getDate() - weekday + (weekday === 0 ? -6 : 1));
  const weekKey = formatDateKey(date);
  const schedule = await decryptStoredItem(`${STORAGE_KEYS.schedule}:${weekKey}`, null);
  return schedule ? normalizeSchedule(schedule) : createEmptySchedule();
}

function showProductionCelebration(total, previousRecord) {
  const notice = document.createElement("div");
  notice.className = "record-celebration";
  notice.innerHTML = `<span>★</span><div><small>NYTT FABRIKSREKORD</small><strong>Bra jobbat!</strong><p>${total} box · tidigare rekord ${previousRecord}</p></div><button type="button">×</button>`;
  document.body.appendChild(notice);
  const close = () => notice.remove();
  notice.querySelector("button").addEventListener("click", close);
  setTimeout(close, 8000);
}

async function renderProduction() {
  const root = document.getElementById("productionPage");
  if (!root) return;
  const [people, records, settings, schedule] = await Promise.all([
    getPeople(), getProductionRecords(), getProductionSettings(), getScheduleForDate(selectedProductionDate)
  ]);
  const machines = ["GD1", "GD2", "GD3", "GD4"];
  const stored = records[selectedProductionDate];
  const dayIndex = (() => {
    const [year, month, day] = selectedProductionDate.split("-").map(Number);
    const value = new Date(year, month - 1, day).getDay();
    return value >= 1 && value <= 5 ? value - 1 : -1;
  })();
  const scheduleDay = dayIndex >= 0 ? DAYS[dayIndex] : "";
  const record = stored || {
    date: selectedProductionDate,
    target: settings.dailyTarget,
    machines: Object.fromEntries(machines.map(machine => [machine, {
      personId: scheduleDay ? schedule[machine]?.[scheduleDay] || "" : "", result: "", comment: ""
    }]))
  };
  const historicalTotals = Object.values(records).map(item => Number(item.total) || 0);
  const highestRecorded = Math.max(0, ...historicalTotals);
  const total = machines.reduce((sum, machine) => sum + (Number(record.machines?.[machine]?.result) || 0), 0);
  const target = Number(record.target) || settings.dailyTarget;
  const personOptions = (selectedId, savedName = "") => `<option value="">Välj person</option>${selectedId && !people.some(person => person.id === selectedId) ? `<option value="${selectedId}" selected>${escapeHtml(savedName || "Tidigare personal")}</option>` : ""}${people.map(person => `<option value="${person.id}"${person.id === selectedId ? " selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}`;
  root.innerHTML = `
    <div class="production-toolbar card"><label>Datum<input id="productionDate" type="date" value="${selectedProductionDate}" /></label><div class="production-settings"><label>Dagligt mål<input id="productionTarget" type="number" min="0" value="${target}" /></label><label>Fabriksrekord<input id="factoryRecord" type="number" min="0" value="${settings.factoryRecord}" /></label></div><button id="syncScheduleBtn" class="btn" type="button">Hämta från Schema</button><button id="saveProductionBtn" class="btn primary" type="button">Spara dagen</button></div>
    <div class="production-kpis"><article id="productionTotalCard" class="${total >= target ? "goal-card-met" : "goal-card-missed"}"><span>Dagens produktion</span><strong id="productionTotal">${total}</strong><small>box totalt</small></article><article><span>Dagligt mål</span><strong id="productionGoalValue">${target}</strong><small>box</small></article><article><span>Fabriksrekord</span><strong id="factoryRecordValue">${settings.factoryRecord}</strong><small>officiellt rekord</small></article><article><span>Högsta registrerade</span><strong>${highestRecorded}</strong><small>i historiken</small></article></div>
    <section class="production-entry card"><div class="production-heading"><div><small>DAGLIG PRODUKTION</small><h3>${new Date(selectedProductionDate + "T12:00:00").toLocaleDateString("sv-SE", { weekday:"long", year:"numeric", month:"long", day:"numeric" })}</h3></div><span id="productionStatus" class="production-status ${total >= target ? "goal-met" : "goal-missed"}">${total >= target ? "Målet uppnått" : "Under målet"}</span></div><div class="production-machine-list">${machines.map(machine => { const item = record.machines?.[machine] || {}; return `<article class="production-machine-row"><strong>${machine.replace("GD", "GD-")}</strong><label>Operatör<select data-machine="${machine}" data-field="personId">${personOptions(item.personId, item.personName)}</select></label><label>Resultat (BOX)<input data-machine="${machine}" data-field="result" class="production-result" type="number" min="0" value="${item.result ?? ""}" placeholder="0" /></label><label class="production-comment">Kommentar<input data-machine="${machine}" data-field="comment" value="${escapeHtml(item.comment || "")}" placeholder="Kommentar, stopp eller material" /></label></article>`; }).join("")}</div></section>
    <section class="production-history card"><div class="production-history-heading"><div><h3>Historik</h3><p>Öppna en tidigare dag för att visa eller ändra resultatet.</p></div><span>${Object.keys(records).length} dagar</span></div><div class="production-history-list">${Object.values(records).sort((a,b) => b.date.localeCompare(a.date)).map(item => `<button type="button" data-production-date="${item.date}" class="${item.date === selectedProductionDate ? "active" : ""}"><span>${new Date(item.date + "T12:00:00").toLocaleDateString("sv-SE")}</span><strong>${item.total || 0} box</strong><small class="${Number(item.total) >= Number(item.target) ? "history-met" : "history-missed"}">${Number(item.total) >= Number(item.target) ? "Mål uppnått" : "Under mål"}</small></button>`).join("") || '<div class="empty-state">Ingen produktion sparad ännu.</div>'}</div></section>
  `;
  const updateSummary = () => {
    const currentTotal = [...root.querySelectorAll(".production-result")].reduce((sum, input) => sum + (Number(input.value) || 0), 0);
    const currentTarget = Number(root.querySelector("#productionTarget").value) || 0;
    const currentFactoryRecord = Number(root.querySelector("#factoryRecord").value) || 0;
    root.querySelector("#productionTotal").textContent = currentTotal;
    root.querySelector("#productionGoalValue").textContent = currentTarget;
    root.querySelector("#factoryRecordValue").textContent = currentFactoryRecord;
    root.querySelector("#productionTotalCard").className = currentTotal >= currentTarget ? "goal-card-met" : "goal-card-missed";
    const status = root.querySelector("#productionStatus");
    status.textContent = currentTotal >= currentTarget ? "Målet uppnått" : "Under målet";
    status.className = `production-status ${currentTotal >= currentTarget ? "goal-met" : "goal-missed"}`;
  };
  root.querySelectorAll(".production-result, #productionTarget, #factoryRecord").forEach(input => input.addEventListener("input", updateSummary));
  root.querySelector("#productionDate").addEventListener("change", event => { selectedProductionDate = event.target.value; void renderProduction(); });
  root.querySelector("#syncScheduleBtn").addEventListener("click", async () => {
    const currentSchedule = await getScheduleForDate(selectedProductionDate);
    machines.forEach(machine => { const select = root.querySelector(`[data-machine="${machine}"][data-field="personId"]`); select.value = scheduleDay ? currentSchedule[machine]?.[scheduleDay] || "" : ""; });
  });
  root.querySelector("#saveProductionBtn").addEventListener("click", async () => {
    const previousRecord = Number(root.querySelector("#factoryRecord").value) || 0;
    const dayRecord = { date: selectedProductionDate, target: Number(root.querySelector("#productionTarget").value) || 0, machines: {}, updatedAt: new Date().toISOString() };
    machines.forEach(machine => { const personId = root.querySelector(`[data-machine="${machine}"][data-field="personId"]`).value; dayRecord.machines[machine] = { personId, personName: people.find(person => person.id === personId)?.name || "", result: Number(root.querySelector(`[data-machine="${machine}"][data-field="result"]`).value) || 0, comment: root.querySelector(`[data-machine="${machine}"][data-field="comment"]`).value.trim() }; });
    dayRecord.total = machines.reduce((sum, machine) => sum + dayRecord.machines[machine].result, 0);
    records[selectedProductionDate] = dayRecord;
    settings.dailyTarget = dayRecord.target;
    settings.factoryRecord = previousRecord;
    const brokeRecord = dayRecord.total > settings.factoryRecord;
    if (brokeRecord) settings.factoryRecord = dayRecord.total;
    await Promise.all([saveProductionRecords(records), saveProductionSettings(settings)]);
    await addAuditEvent("production", `Produktion ${selectedProductionDate}`, `${dayRecord.total} box`);
    if (brokeRecord) showProductionCelebration(dayRecord.total, previousRecord);
    await renderProduction();
    await renderDashboard();
  });
  root.querySelectorAll("[data-production-date]").forEach(button => button.addEventListener("click", () => { selectedProductionDate = button.dataset.productionDate; void renderProduction(); }));
}

async function renderDashboard() {
  const root = document.getElementById("dashboardPage");
  if (!root) return;
  const [people, departments, skills, results, events, productionRecords] = await Promise.all([
    getPeople(), getDepartments(), getMachineSkills(), getTestResults(), getAuditLog(), getProductionRecords()
  ]);
  const sick = people.filter(person => getPersonAvailability(person) === "sick").length;
  const vacation = people.filter(person => getPersonAvailability(person) === "vacation").length;
  const fullyQualified = people.filter(person => {
    const personSkills = Array.isArray(skills[person.id]) ? skills[person.id] : [];
    return departments.length > 0 && departments.every(item => personSkills.includes(item));
  }).length;
  const tested = people.filter(person => Object.keys(results[person.id] || {}).length > 0).length;
  const latestProduction = Object.values(productionRecords).sort((a, b) => b.date.localeCompare(a.date))[0];
  root.innerHTML = `
    <div class="dashboard-stats">
      <article><span>Personal</span><strong>${people.length}</strong><small>registrerade</small></article>
      <article class="stat-red"><span>Sjuka</span><strong>${sick}</strong><small>ej tillgängliga</small></article>
      <article class="stat-yellow"><span>Semester</span><strong>${vacation}</strong><small>frånvarande</small></article>
      <article class="stat-green"><span>Full kompetens</span><strong>${fullyQualified}</strong><small>alla maskiner</small></article>
      <article><span>Testade</span><strong>${tested}</strong><small>av ${people.length}</small></article>
      <article><span>Senaste produktion</span><strong>${latestProduction?.total || 0}</strong><small>${latestProduction?.date || "ingen dag"}</small></article>
    </div>
    <div class="dashboard-columns">
      <section class="card data-tools-card"><div><h3>Data och säkerhet</h3><p>Exportera en krypterad säkerhetskopia eller återställ från en tidigare fil.</p></div><div class="data-tool-actions"><button id="exportDataBtn" class="btn primary" type="button">Exportera backup</button><button id="importDataBtn" class="btn" type="button">Importera backup</button><input id="importDataInput" type="file" accept="application/json,.json" hidden></div></section>
      <section class="card audit-card"><div class="audit-heading"><div><h3>Senaste ändringar</h3><p>De senaste aktiviteterna i systemet</p></div><span>${events.length}</span></div><div class="audit-list">${events.slice(0, 20).map(event => `<article><span class="audit-dot"></span><div><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.detail || "")}</p><small>${new Date(event.createdAt).toLocaleString("sv-SE")}</small></div>${event.undo ? `<button class="audit-undo" data-audit-id="${event.id}" type="button">Återställ</button>` : ""}</article>`).join("") || '<div class="empty-state">Inga ändringar registrerade ännu.</div>'}</div></section>
    </div>
  `;
  setupDataTools();
  root.querySelectorAll(".audit-undo").forEach(button => button.addEventListener("click", () => {
    const event = events.find(item => item.id === button.dataset.auditId);
    if (event) void applyAuditUndo(event);
  }));
}

function setupDataTools() {
  const exportButton = document.getElementById("exportDataBtn");
  const importButton = document.getElementById("importDataBtn");
  const input = document.getElementById("importDataInput");
  if (exportButton && exportButton.dataset.bound !== "true") {
    exportButton.dataset.bound = "true";
    exportButton.addEventListener("click", () => {
      const data = {};
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith("staff_") || [STORAGE_KEYS.salt, STORAGE_KEYS.check].includes(key)) data[key] = localStorage.getItem(key);
      });
      const payload = { app: "Staff Planner", version: 1, exportedAt: new Date().toISOString(), data };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `staff-planner-backup-${formatDateKey(new Date())}.json`;
      link.click();
      URL.revokeObjectURL(url);
      void addAuditEvent("backup", "Backup exporterad", formatDateKey(new Date()));
    });
  }
  if (importButton && input && importButton.dataset.bound !== "true") {
    importButton.dataset.bound = "true";
    importButton.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        if (payload?.app !== "Staff Planner" || !payload.data || typeof payload.data !== "object") throw new Error("Invalid backup");
        if (!confirm("Importen ersätter all lokal data. Vill du fortsätta?")) return;
        clearPersistentData();
        Object.entries(payload.data).forEach(([key, value]) => { if (typeof value === "string") localStorage.setItem(key, value); });
        clearStoredSessionPassword();
        location.reload();
      } catch (error) {
        alert("Backupfilen är ogiltig eller skadad.");
      }
    });
  }
}

function setupMobileNavigation() {
  const sidebar = document.querySelector(".sidebar");
  const nav = sidebar?.querySelector(".nav");
  const logo = sidebar?.querySelector(".logo");
  if (!sidebar || !nav || !logo || sidebar.querySelector(".mobile-nav-toggle")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mobile-nav-toggle";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", "Öppna meny");
  button.innerHTML = "<span></span><span></span><span></span>";
  logo.insertAdjacentElement("afterend", button);
  button.addEventListener("click", () => {
    const open = sidebar.classList.toggle("nav-open");
    button.setAttribute("aria-expanded", String(open));
  });
}

function setupFilterControls() {
  [
    ["peopleSearch", "input", renderPeople], ["availabilityFilter", "change", renderPeople],
    ["testSearch", "input", renderTestResults], ["machineSearch", "input", renderMachineSkills],
    ["machineFilter", "change", renderMachineSkills]
  ].forEach(([id, eventName, render]) => {
    const element = document.getElementById(id);
    if (!element || element.dataset.bound === "true") return;
    element.dataset.bound = "true";
    element.addEventListener(eventName, () => void render());
  });
}

async function refreshAppViews() {
  await renderSchedule();
  await renderBreakPlanner();
  await renderPeople();
  await renderAssessments();
  await renderTestResults();
  await renderMachineSkills();
  await renderTrainingReminders();
  await renderDashboard();
  await renderProduction();
}

async function editPerson(id) {
  const people = await getPeople();
  const person = people.find(item => item.id === id);
  if (!person) return;

  const newName = prompt("Nytt namn:", person.name);
  if (newName === null) return;

  const newCompany = prompt("Nytt företag:", person.company || "");
  if (newCompany === null) return;

  person.name = newName.trim() || person.name;
  person.company = newCompany.trim();

  await savePeople(people);
  await addAuditEvent("person", `${person.name} redigerad`, person.company || "");
  await refreshAppViews();
}

async function deletePerson(id) {
  const shouldDelete = confirm("Vill du ta bort personen och alla personens bedömningar?");
  if (!shouldDelete) return;

  const allPeople = await getPeople();
  const removedPerson = allPeople.find(person => person.id === id);
  const people = allPeople.filter(person => person.id !== id);
  const schedule = await getSchedule();
  const trainingLeaders = await getTrainingLeaders();
  const assessments = (await getAssessments()).filter(item => item.personId !== id);
  const testResults = await getTestResults();
  const machineSkills = await getMachineSkills();
  const machineSkillUpdatedAt = await getMachineSkillUpdatedAt();
  const machineRestrictions = await getMachineRestrictions();
  const machineSkillDetails = await getMachineSkillDetails();

  await savePeople(people);
  delete testResults[id];
  delete machineSkills[id];
  delete machineSkillUpdatedAt[id];
  delete machineRestrictions[id];
  delete machineSkillDetails[id];

  TASKS.forEach(task => {
    DAYS.forEach(day => {
      if (schedule[task]?.[day] === id) {
        schedule[task][day] = "";
      }
    });
  });

  await saveSchedule(schedule);

  Object.keys(trainingLeaders).forEach(task => {
    DAYS.forEach(day => {
      if (trainingLeaders[task]?.[day] === id) {
        trainingLeaders[task][day] = "";
      }
    });
  });

  await saveTrainingLeaders(trainingLeaders);
  await saveAssessments(assessments);
  await saveTestResults(testResults);
  await saveMachineSkills(machineSkills);
  await saveMachineSkillUpdatedAt(machineSkillUpdatedAt);
  await saveMachineRestrictions(machineRestrictions);
  await saveMachineSkillDetails(machineSkillDetails);
  await addAuditEvent("person", `${removedPerson?.name || "Person"} borttagen`, "Personal och kopplade uppgifter raderades");
  if (selectedAssessmentPersonId === id) selectedAssessmentPersonId = "";
  if (selectedTestPersonId === id) selectedTestPersonId = "";
  await refreshAppViews();
}

function clearAddSuccessMessage(message) {
  if (addMessageTimeoutId) {
    clearTimeout(addMessageTimeoutId);
    addMessageTimeoutId = null;
  }

  if (!message) return;

  message.classList.add("hidden");
  message.classList.remove("success", "error");
}

function showAddSuccessMessage(message) {
  if (!message) return;

  clearAddSuccessMessage(message);
  message.textContent = "Person tillagd";
  message.classList.remove("hidden", "error");
  message.classList.add("success");

  addMessageTimeoutId = setTimeout(() => {
    clearAddSuccessMessage(message);
  }, 2000);
}

function setupAddForm() {
  const form = document.getElementById("addForm");
  if (!form) return;

  const nameInput = document.getElementById("nameInput");
  const companyInput = document.getElementById("companyInput");
  const clearBtn = document.getElementById("clearBtn");
  const message = document.getElementById("message");

  bindOnce(form, "submit", async event => {
    event.preventDefault();

    const name = nameInput.value.trim();
    const company = companyInput.value.trim();

    if (!name) return;

    const people = await getPeople();
    people.push({
      id: makeId(),
      name,
      company
    });

    await savePeople(people);
    await addAuditEvent("person", `${name} tillagd`, company);
    form.reset();
    showAddSuccessMessage(message);
  });

  bindOnce(clearBtn, "click", () => {
    form.reset();
    clearAddSuccessMessage(message);
  });
}

function initializeAppContent() {
  renderWeekNavigation();
  void renderSchedule();
  void renderBreakPlanner();
  void renderPeople();
  void renderAssessments();
  void renderTestResults();
  void renderMachineSkills();
  void renderTrainingReminders();
  void renderDashboard();
  void renderProduction();
  setupAddForm();
  setupAutoSchedule();
  setupMobileNavigation();
  setupFilterControls();
}

async function openAppUI() {
  const { authScreen, appShell, logoutBtn } = getAuthElements();

  setAuthenticatedView(true);
  authScreen?.classList.add("hidden");
  appShell?.classList.remove("hidden");
  finishInitialViewSetup();

  bindOnce(logoutBtn, "click", async () => {
    lockApp();
    await setupAuthUI();
  });

  initializeAppContent();
}

async function setupAuthUI() {
  const {
    authScreen,
    appShell,
    authTitle,
    authBtn,
    passwordInput,
    passwordConfirmInput,
    wipeBtn
  } = getAuthElements();

  if (!authScreen || !appShell) {
    finishInitialViewSetup();
    initializeAppContent();
    return;
  }

  if (await restoreSession()) {
    await openAppUI();
    return;
  }

  setAuthenticatedView(false);
  appShell.classList.add("hidden");
  authScreen.classList.remove("hidden");
  finishInitialViewSetup();
  clearAuthMessage();
  resetAuthInputs(passwordInput, passwordConfirmInput);
  updateAuthMode(hasPasswordSetup(), authTitle, authBtn, passwordConfirmInput);

  bindOnce(authBtn, "click", async () => {
    clearAuthMessage();

    const password = passwordInput?.value.trim() || "";
    const confirmPassword = passwordConfirmInput?.value.trim() || "";
    const isLoginMode = hasPasswordSetup();

    if (password.length < 6) {
      showAuthMessage("Lösenordet måste vara minst 6 tecken.");
      return;
    }

    if (!isLoginMode && password !== confirmPassword) {
      showAuthMessage("Lösenorden matchar inte.");
      return;
    }

    try {
      const success = isLoginMode ? await unlockApp(password) : true;

      if (isLoginMode && !success) {
        showAuthMessage("Fel lösenord.");
        return;
      }

      if (!isLoginMode) {
        await setupPassword(password);
      }

      await openAppUI();
      resetAuthInputs(passwordInput, passwordConfirmInput);
    } catch (error) {
      console.error(error);
      showAuthMessage(
        isLoginMode ? "Det gick inte att logga in." : "Det gick inte att skapa lösenord."
      );
    }
  });

  bindOnce(wipeBtn, "click", () => {
    if (confirm("Vill du radera all lokal data?")) {
      wipeAllData();
    }
  });

  bindEnterToClick(passwordInput, authBtn);
  bindEnterToClick(passwordConfirmInput, authBtn);
}

document.addEventListener("DOMContentLoaded", () => {
  void setupAuthUI();
});

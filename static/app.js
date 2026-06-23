const state = {
  bootstrap: null,
  session: null,
  stepIndex: 0,
  eligibilityChoice: null,
  dashboardUnlocked: false,
  enumeratorControls: false,
};

const landing = document.querySelector("#landing");
const dashboard = document.querySelector("#dashboard");
const respondent = document.querySelector("#respondent");
const experimentHeaderActions = document.querySelector("#experiment-header-actions");
const respondentEntryForm = document.querySelector("#respondent-entry-form");
const respondentEntryStatus = document.querySelector("#respondent-entry-status");
const enumeratorLoginForm = document.querySelector("#enumerator-login-form");
const enumeratorLoginStatus = document.querySelector("#enumerator-login-status");
const quickCreateSessionButton = document.querySelector("#quick-create-session");
const sessionForm = document.querySelector("#session-form");
const sessionCreateStatus = document.querySelector("#session-create-status");
const sessionList = document.querySelector("#session-list");
const refreshButton = document.querySelector("#refresh-sessions");
const candidateCsvInput = document.querySelector("#candidate-csv");
const importCandidatesButton = document.querySelector("#import-candidates");
const candidateImportStatus = document.querySelector("#candidate-import-status");

const BENCHMARK_RANGES = {
  reach_indicator: {
    min: 320,
    median: 950,
    max: 4100,
    unit: "accounts reached per post",
  },
  interaction_indicator: {
    min: 12,
    median: 54,
    max: 280,
    unit: "interactions per post",
  },
};

const CONDITIONAL_REASON_LABELS = {
  productivity: {
    yes: "Task performance is impressive",
    no: "Task performance is disappointing",
  },
  placebo: {
    yes: "Additional Information suggests good fit",
    no: "Additional Information suggests poor fit",
  },
};

const CONDITIONAL_REASON_LABEL_SET = new Set(
  Object.values(CONDITIONAL_REASON_LABELS).flatMap((labels) => Object.values(labels))
);
const OTHER_REASON_LABEL = "Other reason (please specify)";

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  return response.json();
}

function moneyToInteger(value) {
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    return Number.NaN;
  }
  return Number(normalized);
}

function formatStatus(session) {
  return `${session.response_count}/${session.expected_response_count} responses`;
}

function treatmentLabel(treatmentArm) {
  const labels = {
    hidden: "Hidden",
    hidden_placebo: "Hidden + additional information",
    transparent: "Transparent",
    transparent_placebo: "Transparent + additional information",
  };
  return labels[treatmentArm] || treatmentArm;
}

function fillSelect(select, rows, labelKey = "name") {
  select.innerHTML = "";
  rows.forEach((row) => {
    const option = document.createElement("option");
    option.value = row.id;
    option.textContent = row[labelKey];
    select.append(option);
  });
}

async function loadBootstrap() {
  state.bootstrap = await api("/api/bootstrap");
  fillSelect(sessionForm.elements.enumeratorId, state.bootstrap.enumerators);
  fillSelect(sessionForm.elements.candidateSetId, state.bootstrap.candidateSets);
}

function showLanding() {
  landing.classList.remove("hidden");
  dashboard.classList.add("hidden");
  respondent.classList.add("hidden");
  experimentHeaderActions.classList.add("hidden");
}

function sessionLocator(session) {
  return session.session_code || String(session.id);
}

function sessionUrl(session) {
  return `${location.origin}${location.pathname}?session=${encodeURIComponent(sessionLocator(session))}`;
}

async function loadSessions() {
  const { sessions } = await api("/api/sessions");
  sessionList.innerHTML = "";
  if (sessions.length === 0) {
    sessionList.innerHTML = "<p class=\"muted\">No sessions yet.</p>";
    return;
  }

  sessions.forEach((session) => {
    const row = document.createElement("article");
    row.className = "session-row";
    row.innerHTML = `
      <div>
        <h3>${session.employer_name}</h3>
        <p class="meta">
          ${session.business_name || "No business name"} - ${session.enumerator_name} -
          ${treatmentLabel(session.treatment_arm)} - ${session.mode} -
          ${session.candidate_count}/${session.requested_candidate_count} candidates
        </p>
        <p class="meta">
          Session code: <strong>${sessionLocator(session)}</strong> -
          <a href="${sessionUrl(session)}" target="_blank" rel="noreferrer">Respondent link</a>
        </p>
        <span class="status">${session.status} - ${formatStatus(session)}</span>
      </div>
      <div class="session-actions">
        <button class="secondary rename-session-code" type="button">Rename code</button>
        <button class="secondary delete-session" type="button">Delete session</button>
        <button class="open-session" type="button">Open session</button>
      </div>
    `;
    row.querySelector(".open-session").addEventListener("click", () => openSession(session.id, { enumeratorControls: true }));
    row.querySelector(".rename-session-code").addEventListener("click", () => renameSessionCode(session));
    row.querySelector(".delete-session").addEventListener("click", () => deleteSession(session));
    sessionList.append(row);
  });
}

async function renameSessionCode(session) {
  const currentCode = sessionLocator(session);
  const newCode = window.prompt("Enter new session code", currentCode);
  if (newCode === null) {
    return;
  }
  const trimmed = newCode.trim();
  if (!trimmed || trimmed === currentCode) {
    return;
  }
  await api(`/api/session/${encodeURIComponent(session.id)}/code`, {
    method: "POST",
    body: JSON.stringify({ sessionCode: trimmed }),
  });
  await loadSessions();
}

async function deleteSession(session) {
  const confirmed = window.confirm(
    `Delete session for ${session.employer_name}? This removes saved responses and randomization records for this session.`
  );
  if (!confirmed) {
    return;
  }
  await api(`/api/session/${session.id}`, { method: "DELETE" });
  await loadSessions();
}

function candidateById(candidateId) {
  return state.session.candidates.find((candidate) => candidate.id === candidateId);
}

function responseKey(candidateId, stage) {
  return `${candidateId}:${stage}`;
}

function existingResponsesMap() {
  const map = new Map();
  state.session.responses.forEach((response) => {
    map.set(responseKey(response.candidate_id, response.stage), response);
  });
  return map;
}

function existingDraftsMap() {
  const map = new Map();
  (state.session.drafts || []).forEach((draft) => {
    map.set(responseKey(draft.candidate_id, draft.stage), draft.response);
  });
  return map;
}

async function openSession(sessionId, options = {}) {
  state.session = await api(`/api/session/${sessionId}`);
  state.stepIndex = state.session.resumeStepIndex;
  state.eligibilityChoice = null;
  state.enumeratorControls = Boolean(options.enumeratorControls);
  landing.classList.add("hidden");
  dashboard.classList.add("hidden");
  respondent.classList.remove("hidden");
  renderStep();
}

function renderStep() {
  const step = state.session.flow[state.stepIndex];
  if (step.kind === "transparent_intro" || step.kind === "hidden_intro") {
    renderEligibilityIntro(step.kind);
    addEnumeratorDashboardButton();
    return;
  }
  if (step.kind === "employer_characteristics") {
    renderEmployerCharacteristics();
    addEnumeratorDashboardButton();
    return;
  }
  if (step.kind === "candidate_review_intro") {
    renderCandidateReviewIntro();
    addEnumeratorDashboardButton();
    return;
  }
  if (step.kind === "transparent_productivity_definition") {
    renderProductivityDefinition("transparent");
    addEnumeratorDashboardButton();
    return;
  }
  if (step.kind === "hidden_reveal_productivity_definition") {
    renderProductivityDefinition("hidden_reveal");
    addEnumeratorDashboardButton();
    return;
  }
  if (
    step.kind === "transparent_productivity_reading" ||
    step.kind === "hidden_reveal_productivity_reading"
  ) {
    renderProductivityReadingGuide();
    addEnumeratorDashboardButton();
    return;
  }
  if (step.kind === "candidate") {
    renderCandidate(step);
    addEnumeratorDashboardButton();
    return;
  }
  renderComplete();
  addEnumeratorDashboardButton();
}

function previousStep() {
  if (state.stepIndex === 0) {
    returnHomeWithPasscode();
    return;
  }
  const currentStep = state.session.flow[state.stepIndex];
  if (currentStep.kind === "hidden_reveal_productivity_definition") {
    requestPasscode("Staff Passcode", async () => {
      state.stepIndex -= 1;
      renderStep();
    });
    return;
  }
  state.stepIndex -= 1;
  renderStep();
}

function nextStep() {
  state.stepIndex += 1;
  renderStep();
}

function navigationButtons(nextLabel = "Continue", options = {}) {
  const previousDisabled = options.disablePrevious ? "disabled" : "";
  return `
    <div class="nav-actions">
      <button class="secondary previous-screen" type="button" ${previousDisabled}>Previous</button>
      <button class="continue-screen" type="button">${nextLabel}</button>
    </div>
  `;
}

function attachNavigation(container, onNext = nextStep) {
  container.querySelector(".previous-screen").addEventListener("click", previousStep);
  container.querySelector(".continue-screen").addEventListener("click", onNext);
}

async function showDashboard() {
  state.dashboardUnlocked = true;
  landing.classList.add("hidden");
  respondent.classList.add("hidden");
  dashboard.classList.remove("hidden");
  experimentHeaderActions.classList.add("hidden");
  await loadSessions();
}

function closePasscodeDialog() {
  document.querySelector(".passcode-backdrop")?.remove();
}

function requestPasscode(title, onSuccess) {
  closePasscodeDialog();
  document.body.insertAdjacentHTML(
    "beforeend",
    `
      <div class="passcode-backdrop" role="presentation">
        <form class="passcode-dialog" aria-label="Enumerator passcode">
          <h2>${title}</h2>
          <label>
            Passcode
            <input name="passcode" type="password" inputmode="numeric" autocomplete="off" required>
          </label>
          <p class="passcode-error muted"></p>
          <div class="nav-actions">
            <button class="secondary cancel-passcode" type="button">Cancel</button>
            <button type="submit">Continue</button>
          </div>
        </form>
      </div>
    `
  );
  const dialog = document.querySelector(".passcode-dialog");
  const input = dialog.elements.passcode;
  input.focus();
  dialog.querySelector(".cancel-passcode").addEventListener("click", closePasscodeDialog);
  dialog.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (input.value !== "501") {
      dialog.querySelector(".passcode-error").textContent = "Incorrect passcode.";
      input.value = "";
      input.focus();
      return;
    }
    closePasscodeDialog();
    await onSuccess();
  });
}

function returnToDashboardWithPasscode() {
  requestPasscode("Staff Passcode", showDashboard);
}

function closeQuickCreateDialog() {
  document.querySelector(".quick-create-backdrop")?.remove();
}

function openQuickCreateDialog() {
  closeQuickCreateDialog();
  document.body.insertAdjacentHTML(
    "beforeend",
    `
      <div class="passcode-backdrop quick-create-backdrop" role="presentation">
        <form class="quick-create-dialog" id="quick-create-form" aria-label="Create new guided session">
          <h2>Create New Session</h2>
          <p class="muted">Complete the session details, then create the guided session.</p>
          <div class="quick-create-grid">
            <label>
              Employer name
              <input name="employerName" required placeholder="Respondent name">
            </label>
            <label>
              Session code
              <input name="sessionCode" placeholder="Optional, e.g. PILOT-A1">
            </label>
            <label>
              Business name
              <input name="businessName" placeholder="MSME name">
            </label>
            <label>
              Contact
              <input name="contact" placeholder="Phone or email">
            </label>
            <label>
              Enumerator
              <select name="enumeratorId" required></select>
            </label>
            <label>
              Treatment arm
              <select name="treatmentArm" required>
                <option value="hidden">Hidden</option>
                <option value="hidden_placebo">Hidden + additional information</option>
                <option value="transparent">Transparent</option>
                <option value="transparent_placebo">Transparent + additional information</option>
              </select>
            </label>
            <label>
              Candidate set
              <select name="candidateSetId" required></select>
            </label>
            <label>
              Number of candidates to review
              <select name="candidateLimit" required>
                <option value="3">3 candidates</option>
                <option value="5">5 candidates</option>
                <option value="10">10 candidates</option>
                <option value="15">15 candidates</option>
                <option value="20" selected>20 candidates</option>
              </select>
            </label>
            <label>
              Delivery mode
              <select name="mode" required>
                <option value="online">Online guided</option>
                <option value="offline">Offline guided</option>
              </select>
            </label>
            <label>
              Randomization seed
              <input name="randomizationSeed" inputmode="numeric" placeholder="Optional">
            </label>
          </div>
          <p class="quick-create-status muted" aria-live="polite"></p>
          <div class="nav-actions">
            <button class="secondary quick-create-cancel" type="button">Cancel</button>
            <button type="submit">Create guided session</button>
          </div>
        </form>
      </div>
    `
  );
  const form = document.querySelector("#quick-create-form");
  fillSelect(form.elements.enumeratorId, state.bootstrap.enumerators);
  fillSelect(form.elements.candidateSetId, state.bootstrap.candidateSets);
  form.elements.employerName.focus();
  form.querySelector(".quick-create-cancel").addEventListener("click", closeQuickCreateDialog);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const created = await createSessionFromForm(
      form,
      form.querySelector(".quick-create-status")
    );
    if (!created) {
      return;
    }
    closeQuickCreateDialog();
    await loadBootstrap();
    await loadSessions();
    await openSession(created.sessionId, { enumeratorControls: true });
  });
}

function requestQuickCreateSession() {
  requestPasscode("Staff Passcode", openQuickCreateDialog);
}

function returnHomeWithPasscode() {
  requestPasscode("Home Passcode", async () => {
    state.enumeratorControls = false;
    showLanding();
  });
}

function addEnumeratorDashboardButton() {
  experimentHeaderActions.classList.remove("hidden");
}

experimentHeaderActions.querySelector(".home-passcode").addEventListener("click", returnHomeWithPasscode);
quickCreateSessionButton.addEventListener("click", requestQuickCreateSession);

function renderEligibilityIntro(kind) {
  respondent.innerHTML = `
    <article class="text-page">
      <h2>Session Introduction</h2>
      <p>
        Thank you for joining this session.
      </p>
      <p>
        In this session, we would like to understand your preferences when considering candidates
        for a social media admin, social media manager, or related digital creative role.
      </p>
      <p>
        Before continuing, we first need to confirm whether your business is currently hiring or
        planning to hire someone for this type of position. We will also ask several questions
        about you and your business before the candidate review begins.
      </p>
      <p>
        To appreciate your time and participation, you will receive an IDR 350,000 participation
        fee after completing the session.
      </p>
      <p>
        In addition, your careful review will help us identify candidates from our talent pool who
        may be a good match for your role. <strong>This may help reduce the time and effort needed
        in your hiring process.</strong> For this reason, please review each part of the session
        seriously and answer based on your genuine assessment.
      </p>
      <p>
        Are you currently hiring or planning to hire someone for a social media admin, social media
        manager, or related digital creative position within the next 3 months?
      </p>
      <form id="eligibility-form">
        <div class="eligibility-options">
          <label>
            <input type="radio" name="eligibility" value="currently_hiring" required>
            <span>Yes, currently hiring</span>
          </label>
          <label>
            <input type="radio" name="eligibility" value="considering_hiring" required>
            <span>Yes, planning to hire within the next 3 months</span>
          </label>
          <label>
            <input type="radio" name="eligibility" value="not_eligible" required>
            <span>No</span>
          </label>
        </div>
        ${navigationButtons("Continue")}
      </form>
    </article>
  `;
  const form = respondent.querySelector("#eligibility-form");
  if (state.eligibilityChoice) {
    form.elements.eligibility.value = state.eligibilityChoice;
  }
  attachNavigation(respondent, () => {
    if (!form.reportValidity()) {
      return;
    }
    state.eligibilityChoice = form.elements.eligibility.value;
    if (state.eligibilityChoice === "not_eligible") {
      renderIneligibleEnd();
      return;
    }
    nextStep();
  });
}

function renderCandidateReviewIntro() {
  respondent.innerHTML = `
    <article class="text-page">
      <h2>Candidate Profile Review</h2>
      <p>
        In this session, you will review a number of candidate profiles relevant to entry-level
        social media management or related digital creative work. These profiles are constructed
        based on real resumes submitted by participants in our talent pool.
      </p>
      <p>
        Please review each candidate carefully and answer the follow-up questions based on your
        genuine assessment. Your careful and honest assessment of each profile is important because
        it will help identify candidates who <strong>best suit</strong> your social media and
        digital creative role requirements.
      </p>
      ${navigationButtons("Continue")}
    </article>
  `;
  attachNavigation(respondent);
}

function radioOptions(name, options) {
  return options.map(([value, label]) => `
    <label class="compact-option">
      <input type="radio" name="${name}" value="${value}" required>
      <span>${label}</span>
    </label>
  `).join("");
}

function renderEmployerCharacteristics() {
  const currentYear = new Date().getFullYear();
  respondent.innerHTML = `
    <article class="characteristics-page">
      <div class="characteristics-heading">
        <div>
          <h2>About You and Your Business</h2>
          <p class="muted">Please answer the following questions before reviewing the candidate profiles.</p>
        </div>
      </div>
      <form id="characteristics-form">
        <div class="characteristics-grid">
          <section class="characteristics-section">
            <h3>A. Respondent characteristics</h3>
            <fieldset class="compact-fieldset">
              <legend>A1. Gender</legend>
              <div class="compact-options">
                ${radioOptions("gender", [["male", "Male"], ["female", "Female"], ["prefer_not_to_say", "Prefer not to say"]])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>A2. Date of birth</legend>
              <div class="inline-inputs">
                <label>Month
                  <select name="birthMonth" required>
                    <option value="">Select</option>
                    ${Array.from({ length: 12 }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join("")}
                  </select>
                </label>
                <label>Year
                  <input class="year-input" name="birthYear" type="number" min="1900" max="${currentYear - 15}" step="1" inputmode="numeric" required>
                </label>
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>A3. Highest level of education completed</legend>
              <div class="compact-options">
                ${radioOptions("education", [
                  ["primary_or_below", "Primary school or below"],
                  ["junior_secondary", "Junior secondary school"],
                  ["senior_or_vocational", "Senior secondary / vocational high school"],
                  ["diploma", "Diploma"],
                  ["bachelor", "Bachelor's degree"],
                  ["master_or_above", "Master's degree or above"],
                ])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>A4. Role in the business</legend>
              <div class="compact-options">
                ${radioOptions("businessRole", [
                  ["owner", "Owner"], ["co_owner", "Co-owner"], ["manager", "Manager"],
                  ["hr_recruitment", "HR / recruitment staff"], ["other", "Other"],
                ])}
              </div>
              <input class="conditional-other hidden" name="businessRoleOther" placeholder="Please specify role">
            </fieldset>
          </section>

          <section class="characteristics-section">
            <h3>B. Business characteristics</h3>
            <fieldset class="compact-fieldset">
              <legend>B1. Main business sector</legend>
              <div class="compact-options">
                ${radioOptions("businessSector", [
                  ["manufacturing", "Manufacturing"],
                  ["accommodation_food", "Accommodation and food service activities"],
                  ["wholesale_retail", "Wholesale and retail trade"],
                  ["personal_services", "Other personal service activities (beauty services)"],
                  ["other", "Other sector"],
                ])}
              </div>
              <input class="conditional-other hidden" name="businessSectorOther" placeholder="Please specify sector">
            </fieldset>
            <div class="compact-pair">
              <label><strong>B2. Year business was established</strong>
                <input class="year-input" name="establishedYear" type="number" min="1900" max="${currentYear}" step="1" inputmode="numeric" required>
              </label>
              <fieldset class="compact-fieldset">
                <legend>B3. Number of workers</legend>
                <div class="compact-options two-up">
                  ${radioOptions("workers", [["1_4", "1–4"], ["5_19", "5–19"], ["20_99", "20–99"], ["100_plus", "100 or more"]])}
                </div>
              </fieldset>
            </div>
            <fieldset class="compact-fieldset">
              <legend>B4. Approximate annual revenue</legend>
              <div class="compact-options">
                ${radioOptions("annualRevenue", [
                  ["less_300m", "Less than IDR 300 million"],
                  ["300m_to_2_5b", "IDR 300 million to less than IDR 2.5 billion"],
                  ["2_5b_to_50b", "IDR 2.5 billion to less than IDR 50 billion"],
                  ["50b_plus", "IDR 50 billion or more"],
                  ["prefer_not_to_say", "Prefer not to say"],
                ])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>B5. Business location</legend>
              <div class="inline-inputs">
                <label>City<input name="city" required></label>
                <label>Province<input name="province" required></label>
              </div>
            </fieldset>
          </section>

          <section class="characteristics-section">
            <h3>C. Digital-related activity</h3>
            <fieldset class="compact-fieldset">
              <legend>C2. Current use of social media for business</legend>
              <p class="compact-prompt">Does your business currently have an active social media account for marketing or sales purposes?</p>
              <div class="compact-options two-up">
                ${radioOptions("activeSocialMedia", [["yes", "Yes"], ["no", "No"]])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset platforms-fieldset">
              <legend>C3. Platforms currently used</legend>
              <p class="compact-prompt">Select all that apply.</p>
              <div class="compact-options two-up platform-options">
                ${[
                  ["instagram", "Instagram"], ["tiktok", "TikTok"], ["facebook", "Facebook"],
                  ["whatsapp_business", "WhatsApp Business"], ["youtube", "YouTube"],
                  ["x_twitter", "X / Twitter"], ["other", "Other"],
                ].map(([value, label]) => `
                  <label class="compact-option">
                    <input type="checkbox" name="platforms" value="${value}">
                    <span>${label}</span>
                  </label>
                `).join("")}
              </div>
              <input class="conditional-other hidden" name="platformOther" placeholder="Please specify platform">
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>C4. Previous hiring experience</legend>
              <p class="compact-prompt">Has your business hired someone specifically to manage social media, content, or digital promotion before?</p>
              <div class="compact-options two-up">
                ${radioOptions("previousDigitalHiring", [["yes", "Yes"], ["no", "No"]])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>C5. Most recent work arrangement</legend>
              <p class="compact-prompt">What arrangement was most recently used, or do you plan to use for the next hiring?</p>
              <div class="compact-options">
                ${radioOptions("workArrangement", [
                  ["full_time", "Full-time employee"], ["part_time", "Part-time employee"],
                  ["freelancer", "Freelancer / project-based worker"],
                  ["family_informal", "Family member / informal help"], ["other", "Other"],
                ])}
              </div>
              <input class="conditional-other hidden" name="workArrangementOther" placeholder="Please specify arrangement">
            </fieldset>
          </section>

          <section class="characteristics-section">
            <h3>D. Participation motivation</h3>
            <fieldset class="compact-fieldset">
              <legend>D1. Importance of candidate-matching benefit</legend>
              <p class="compact-prompt">How important is the possibility of being matched with potential candidates in motivating you to participate in this session?</p>
              <div class="importance-scale">
                ${radioOptions("matchingBenefitImportance", [["1", "1 Not important"], ["2", "2 Slightly"], ["3", "3 Moderately"], ["4", "4 Important"], ["5", "5 Very important"]])}
              </div>
            </fieldset>
          </section>
        </div>
        <div class="nav-actions">
          <button class="secondary previous-characteristics" type="button">Previous</button>
          <button type="submit">Save and continue</button>
        </div>
      </form>
    </article>
  `;

  const form = respondent.querySelector("#characteristics-form");
  populateCharacteristicsForm(form, state.session.characteristics);
  attachCharacteristicsConditions(form);
  form.querySelector(".previous-characteristics").addEventListener("click", previousStep);
  form.addEventListener("submit", submitEmployerCharacteristics);
}

function populateCharacteristicsForm(form, saved) {
  if (!saved) return;
  const values = {
    gender: saved.gender,
    birthMonth: saved.birth_month,
    birthYear: saved.birth_year,
    education: saved.education,
    businessRole: saved.business_role,
    businessRoleOther: saved.business_role_other,
    businessSector: saved.business_sector,
    businessSectorOther: saved.business_sector_other,
    establishedYear: saved.established_year,
    workers: saved.workers,
    annualRevenue: saved.annual_revenue,
    city: saved.city,
    province: saved.province,
    activeSocialMedia: saved.active_social_media,
    platformOther: saved.platform_other,
    previousDigitalHiring: saved.previous_digital_hiring,
    workArrangement: saved.work_arrangement,
    workArrangementOther: saved.work_arrangement_other,
    matchingBenefitImportance: saved.matching_benefit_importance,
  };
  Object.entries(values).forEach(([name, value]) => {
    if (value !== undefined && value !== null && form.elements[name]) {
      form.elements[name].value = value;
    }
  });
  (saved.platforms || []).forEach((platform) => {
    const checkbox = form.querySelector(`input[name="platforms"][value="${platform}"]`);
    if (checkbox) checkbox.checked = true;
  });
}

function attachCharacteristicsConditions(form) {
  const toggleOther = (name, expectedValue, otherName) => {
    const selected = form.elements[name].value;
    const input = form.elements[otherName];
    const active = selected === expectedValue;
    input.classList.toggle("hidden", !active);
    input.required = active;
    if (!active) input.value = "";
  };
  const togglePlatformOther = () => {
    const otherChecked = Boolean(form.querySelector('input[name="platforms"][value="other"]:checked'));
    const input = form.elements.platformOther;
    input.classList.toggle("hidden", !otherChecked);
    input.required = otherChecked;
    if (!otherChecked) input.value = "";
  };
  const togglePlatforms = () => {
    const active = form.elements.activeSocialMedia.value === "yes";
    form.querySelector(".platforms-fieldset").classList.toggle("disabled-section", !active);
    form.querySelectorAll('input[name="platforms"]').forEach((input) => {
      input.disabled = !active;
      if (!active) input.checked = false;
    });
    if (!active) form.elements.platformOther.value = "";
    togglePlatformOther();
  };

  form.addEventListener("change", (event) => {
    if (event.target.name === "businessRole") toggleOther("businessRole", "other", "businessRoleOther");
    if (event.target.name === "businessSector") toggleOther("businessSector", "other", "businessSectorOther");
    if (event.target.name === "workArrangement") toggleOther("workArrangement", "other", "workArrangementOther");
    if (event.target.name === "activeSocialMedia") togglePlatforms();
    if (event.target.name === "platforms") togglePlatformOther();
  });

  toggleOther("businessRole", "other", "businessRoleOther");
  toggleOther("businessSector", "other", "businessSectorOther");
  toggleOther("workArrangement", "other", "workArrangementOther");
  togglePlatforms();
}

async function submitEmployerCharacteristics(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  data.platforms = [...form.querySelectorAll('input[name="platforms"]:checked')].map((input) => input.value);
  if (data.activeSocialMedia === "yes" && data.platforms.length === 0) {
    alert("Please select at least one social media platform currently used.");
    return;
  }
  await api(`/api/session/${state.session.session.id}/characteristics`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  state.session = await api(`/api/session/${state.session.session.id}`);
  state.stepIndex += 1;
  renderStep();
}

function renderProductivityDefinition(variant) {
  const isReveal = variant === "hidden_reveal";
  const title = "Candidate Performance Information";
  const transition = isReveal
    ? `
      <p>Thank you. You have now completed the first review of all candidate profiles.</p>
      <p>
        In the next section, you will review the same candidate profiles again. This time, each
        profile will include information from the candidate's performance test. As before, please
        answer the follow-up questions based on your genuine assessment.
      </p>
    `
    : "";

  respondent.innerHTML = `
    <article class="text-page productivity-info-page">
      <h2>${title}</h2>
      <div class="productivity-info-copy">
        ${transition}
        <section class="information-copy-section">
          <h3>Introduction</h3>
          <p>
            We understand that it can be difficult to judge how well a candidate will perform in
            this role based on a profile alone. For this reason, all candidates completed a
            standardized social media performance test.
          </p>
        </section>
        <section class="information-copy-section">
          <h3>How Candidate Performance Was Assessed</h3>
          <ul>
            <li>
              The test took place over three weeks in a <strong>competition setting</strong>. All
              candidates completed it under the same general conditions and received the same
              participation compensation.
            </li>
            <li>The <strong>three best performers received additional prizes</strong>.</li>
            <li>
              Candidates were free to use any software or AI tools to create content. However,
              they were not allowed to buy followers or generate fake interactions.
            </li>
          </ul>
        </section>
        <section class="information-copy-section">
          <h3>Performance Indicators</h3>
          <p>We use two indicators to assess candidate performance: <strong>Reach</strong> and <strong>Interaction</strong>.</p>
          <p>
            <strong>Reach-type indicator:</strong> shows how broadly a candidate's content reached
            an audience. It is measured as the average number of <strong>unique accounts reached per post</strong>
            during the evaluation period. This is different from views: one account may view a post
            more than once, but it is counted only once for reach.
          </p>
          <p>
            <strong>Interaction-type indicator:</strong> shows how audiences responded to a
            candidate's content. It is measured as the average number of interactions per post
            during the evaluation period. Interactions include likes or reactions, comments,
            reposts, shares, and saves.
          </p>
        </section>
        <p>
          In the next section, the candidate profiles will include information from this test to
          summarize how each candidate performed in managing social media content and attracting
          audience response.
        </p>
      </div>
      <section class="metric-examples" aria-label="Examples of performance indicators">
        <h3>Performance Indicator Illustrations</h3>
        <article class="metric-example">
          <h4>Reach-Type Indicator Illustration</h4>
          <img src="/assets/reach-example.jpg" alt="Example platform insight showing accounts reached">
        </article>
        <article class="metric-example">
          <h4>Interaction-Type Indicator Illustration</h4>
          <img src="/assets/interaction-example.jpg" alt="Example platform insight showing likes, comments, reposts, shares, and saves">
        </article>
      </section>
      <p class="muted">
        These screenshots are examples only. Candidate-specific values will be shown on each
        candidate profile.
      </p>
      ${navigationButtons("Continue")}
    </article>
  `;
  attachNavigation(respondent);
}

function renderGuideScale(label, position, showCallout = false) {
  const markerClass = performanceMarkerClass(position);
  return `
    <div class="guide-metric">
      <p><strong>${label}</strong></p>
      <div class="guide-track${showCallout ? " guide-track-with-callout" : ""}">
        ${showCallout ? `<span class="marker-callout" style="--guide-position: ${position}%">Candidate's position <span aria-hidden="true">&darr;</span></span>` : ""}
        <span class="scale-tick scale-min"></span>
        <span class="scale-tick scale-median"></span>
        <span class="scale-tick scale-max"></span>
        <span class="guide-marker ${markerClass}" style="--guide-position: ${position}%"></span>
      </div>
      <div class="guide-scale-labels">
        <span>Minimum</span><span>Median</span><span>Maximum</span>
      </div>
    </div>
  `;
}

function renderProductivityReadingGuide() {
  const examples = [
    {
      title: "Lowest observed performance",
      tone: "performance-case-low",
      reach: 0,
      interaction: 0,
      explanation: "Both markers are at the minimum. This candidate recorded the lowest observed Reach and Interaction performance in the talent pool.",
    },
    {
      title: "Highest observed performance",
      tone: "performance-case-high",
      reach: 100,
      interaction: 100,
      explanation: "Both markers are at the maximum. This candidate recorded the highest observed Reach and Interaction performance in the talent pool.",
    },
    {
      title: "Lower reach, stronger interaction",
      tone: "performance-case-mixed-warm",
      reach: 25,
      interaction: 75,
      explanation: "Reach is between the minimum and median, while Interaction is between the median and maximum. This candidate has lower reach but stronger interaction relative to the talent pool.",
    },
    {
      title: "Stronger reach, lower interaction",
      tone: "performance-case-mixed-cool",
      reach: 75,
      interaction: 25,
      explanation: "Reach is between the median and maximum, while Interaction is between the minimum and median. This candidate has stronger reach but lower interaction relative to the talent pool.",
    },
  ];

  respondent.innerHTML = `
    <article class="text-page performance-reading-page">
      <h2>How to Read Candidate Performance Information</h2>
      <section class="performance-reading-key">
        <div class="key-copy">
          <p>
            The dot shows the candidate's position for that indicator. The line runs from the
            <strong class="scale-value-low">lowest</strong> observed performance in the talent pool to the
            <strong class="scale-value-high">highest</strong> observed performance, with the median in the
            <strong>middle</strong>.
          </p>
          <div class="benchmark-summary">
            <strong>Talent-pool benchmark</strong>
            <span>Reach: minimum <strong class="scale-value-low">320</strong>, median <strong class="scale-value-median">950</strong>, maximum <strong class="scale-value-high">4,100</strong> accounts reached per post.</span>
            <span>Interaction: minimum <strong class="scale-value-low">12</strong>, median <strong class="scale-value-median">54</strong>, maximum <strong class="scale-value-high">280</strong> interactions per post.</span>
          </div>
          <ul class="reading-key-points">
            <li>The benchmark is calculated from all candidates' standardized-task results.</li>
            <li>The median means that half of candidates scored below it and half scored above it.</li>
            <li>The raw number gives the actual average per post; the line shows the candidate's relative position.</li>
          </ul>
        </div>
        <div class="key-scale" aria-label="Example performance scale">
          ${renderGuideScale("Example indicator", 68, true)}
        </div>
      </section>
      <h3 class="performance-guide-heading">Possible Cases of Candidate Performance</h3>
      <section class="performance-guide-examples" aria-label="Examples of interpreting performance information">
        ${examples.map((example) => `
          <article class="performance-guide-card ${example.tone}">
            <h3>${example.title}</h3>
            ${renderGuideScale("Reach-type indicator", example.reach)}
            ${renderGuideScale("Interaction-type indicator", example.interaction)}
            <p>${example.explanation}</p>
          </article>
        `).join("")}
      </section>
      ${navigationButtons("Continue")}
    </article>
  `;
  attachNavigation(respondent);
}

function renderIneligibleEnd() {
  respondent.innerHTML = `
    <article class="text-page">
      <h2>End Screen</h2>
      <p>
        Thank you for your time. Based on the eligibility response, this session will not continue
        to the candidate evaluation screens.
      </p>
      <div class="nav-actions">
        <button class="secondary previous-screen" type="button">Previous</button>
      </div>
    </article>
  `;
  respondent.querySelector(".previous-screen").addEventListener("click", renderStep);
  addEnumeratorDashboardButton();
}

function renderComplete() {
  respondent.innerHTML = `
    <article class="text-page">
      <h2>Session Complete</h2>
      <p>Thank you for your time and careful responses. Your session is complete.</p>
      <p>We appreciate the care you took in reviewing the candidate profiles.</p>
      <div class="nav-actions">
        <button class="secondary previous-screen" type="button">Previous</button>
      </div>
    </article>
  `;
  respondent.querySelector(".previous-screen").addEventListener("click", previousStep);
}

function renderCandidate(step) {
  const template = document.querySelector("#candidate-template");
  const node = template.content.cloneNode(true);
  const card = node.querySelector(".candidate-card");
  const candidate = candidateById(step.candidate_id);
  const response = existingResponsesMap().get(responseKey(candidate.id, step.stage));
  const draft = response ? null : existingDraftsMap().get(responseKey(candidate.id, step.stage));
  const savedResponse = response || draft;

  card.querySelector(".eyebrow").textContent = `Profile ${candidate.code}`;
  card.querySelector("h2").textContent = candidate.pseudonym;

  const grid = card.querySelector(".candidate-grid");
  const appendField = (container, key, value, className = "field") => {
    const field = document.createElement("div");
    field.className = className;
    field.innerHTML = `<strong>${labelize(key)}</strong><span>${value}</span>`;
    container.append(field);
  };
  const identity = document.createElement("section");
  identity.className = "candidate-identity";
  const avatar = document.createElement("img");
  const gender = String(candidate.baseline.gender || "").toLowerCase();
  const isFemale = gender === "female";
  avatar.className = "candidate-avatar";
  avatar.src = isFemale ? "/assets/default-female-avatar.svg" : "/assets/default-male-avatar.svg";
  avatar.alt = isFemale ? "Default female profile avatar" : "Default male profile avatar";
  const basicInformation = document.createElement("div");
  basicInformation.className = "candidate-basic-information";
  ["gender", "age"].forEach((key) => {
    if (candidate.baseline[key]) appendField(basicInformation, key, candidate.baseline[key]);
  });
  identity.append(avatar, basicInformation);
  grid.append(identity);
  const education = document.createElement("section");
  education.className = "education-summary";
  education.innerHTML = `
    <div><strong>Education Level</strong><span>${candidate.baseline.education_level || "Not specified"}</span></div>
    <div><strong>Education Major</strong><span>${candidate.baseline.education_major || "Not specified"}</span></div>
  `;
  basicInformation.append(education);
  if (candidate.baseline.relevant_experience) {
    appendField(grid, "relevant_experience", candidate.baseline.relevant_experience, "supporting-summary");
  }
  if (candidate.baseline.skills) {
    appendField(grid, "relevant_skills", candidate.baseline.skills, "supporting-summary");
  }

  const informationBlock = card.querySelector(".productivity-block");
  const showsProductivity = Boolean(step.show_productivity);
  const showsAdditionalInformation = Boolean(step.show_additional_information);
  if (showsProductivity) {
    informationBlock.innerHTML = `<h3>Candidate Performance Information</h3>`;
    Object.entries(candidate.productivity).forEach(([key, value]) => {
      if (key === "benchmark") {
        return;
      }
      const field = document.createElement("div");
      field.className = "performance-metric";
      field.innerHTML = `
        <p><strong>${labelize(key)}:</strong> ${formatCandidateMetric(key, value, candidate.pseudonym)}</p>
        ${renderBenchmarkScale(key, value, candidate.pseudonym)}
      `;
      informationBlock.append(field);
    });
  }
  if (showsAdditionalInformation) {
    const additionalInformation = document.createElement("section");
    additionalInformation.className = "additional-information-subsection";
    additionalInformation.innerHTML = "<h3>Additional Information</h3>";
    Object.entries(candidate.placebo).forEach(([key, value]) => {
      const field = document.createElement("p");
      field.innerHTML = `<strong>${labelize(key)}:</strong> ${value}`;
      additionalInformation.append(field);
    });
    if (showsProductivity) {
      informationBlock.append(additionalInformation);
    } else {
      informationBlock.classList.add("placeholder");
      informationBlock.innerHTML = "";
      informationBlock.append(additionalInformation);
    }
  }
  if (!showsProductivity && !showsAdditionalInformation) {
    informationBlock.remove();
  }

  const form = card.querySelector(".response-form");
  form.dataset.showProductivity = String(showsProductivity);
  form.dataset.showAdditionalInformation = String(showsAdditionalInformation);
  const reasonOptions = card.querySelector(".reason-options");
  const rankedReasons = card.querySelector(".ranked-reasons");

  form.addEventListener("change", (event) => {
    if (event.target.name === "hireInterest") {
      form.dataset.reasonsConfirmed = "";
      form.dataset.offerConfirmed = "";
      renderReasons(form, reasonOptions, rankedReasons, null);
    }
    updateCandidateProgression(form);
  });
  form.elements.wageValue.addEventListener("input", () => updateCandidateProgression(form));
  form.elements.wageValue.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmWageStep(form);
    }
  });
  form.elements.conditionalWageOffer.addEventListener("input", () => {
    form.dataset.offerConfirmed = "";
    updateCandidateProgression(form);
  });
  form.elements.conditionalWageOffer.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmOfferStep(form);
    }
  });
  form.querySelector(".wage-next").addEventListener("click", () => confirmWageStep(form));
  form.querySelector(".reasons-done").addEventListener("click", () => confirmReasonsStep(form));
  form.querySelector(".offer-next").addEventListener("click", () => confirmOfferStep(form));
  form.querySelector(".save-candidate-draft").addEventListener("click", () => saveCandidateDraft(form, step, candidate));
  form.querySelector(".previous-step").addEventListener("click", previousStep);
  form.addEventListener("submit", (event) => submitCandidateResponse(event, step, candidate));

  if (savedResponse) {
    form.dataset.wageConfirmed = "true";
    const values = response ? {
      wageValue: response.wage_value,
      hireInterest: response.hire_interest,
      conditionalWageOffer: response.conditional_wage_offer,
    } : savedResponse;
    if (values.wageValue !== null && values.wageValue !== undefined) {
      form.elements.wageValue.value = values.wageValue;
    }
    if (values.hireInterest) {
      form.elements.hireInterest.value = values.hireInterest;
      form.dataset.reasonsConfirmed = "true";
    }
    if (values.conditionalWageOffer !== null && values.conditionalWageOffer !== undefined) {
      form.elements.conditionalWageOffer.value = values.conditionalWageOffer;
      form.dataset.offerConfirmed = "true";
    }
  }

  renderReasons(form, reasonOptions, rankedReasons, response, draft);
  updateCandidateProgression(form, Boolean(response));
  respondent.innerHTML = "";
  respondent.append(card);
}

function setProgressiveFieldset(fieldset, visible) {
  fieldset.classList.toggle("progressive-concealed", !visible);
  fieldset.disabled = !visible;
}

function updateCandidateProgression(form, revealAll = false) {
  const wageAnswered = Number.isSafeInteger(moneyToInteger(form.elements.wageValue.value));
  if (!wageAnswered) {
    form.dataset.wageConfirmed = "";
    form.dataset.reasonsConfirmed = "";
    form.dataset.offerConfirmed = "";
  }
  form.querySelector(".wage-next").disabled = !wageAnswered;

  const wageConfirmed = revealAll || form.dataset.wageConfirmed === "true";
  const hiringVisible = wageAnswered && wageConfirmed;
  setProgressiveFieldset(form.querySelector(".question-hiring"), hiringVisible);

  const hiringAnswered = hiringVisible && Boolean(form.elements.hireInterest.value);
  const reasonsVisible = revealAll || hiringAnswered;
  setProgressiveFieldset(form.querySelector(".question-reasons"), reasonsVisible);

  const hasRatedReason = [...form.querySelectorAll('input[type="range"][name^="score-"]')]
    .some((input) => Number(input.value) > 0);
  if (!hasRatedReason) {
    form.dataset.offerConfirmed = "";
  }
  form.querySelector(".reasons-done").disabled = !(reasonsVisible && hasRatedReason);

  const reasonsConfirmed = revealAll || form.dataset.reasonsConfirmed === "true";
  const offerVisible = reasonsVisible && hasRatedReason && reasonsConfirmed;
  setProgressiveFieldset(form.querySelector(".question-offer"), offerVisible);

  const offerAnswered = Number.isSafeInteger(moneyToInteger(form.elements.conditionalWageOffer.value));
  form.querySelector(".offer-next").disabled = !(offerVisible && offerAnswered);

  const offerConfirmed = revealAll || form.dataset.offerConfirmed === "true";
  form.querySelector(".save-candidate-response").disabled = !(offerVisible && offerAnswered && offerConfirmed);
}

function confirmWageStep(form) {
  const wageAnswered = Number.isSafeInteger(moneyToInteger(form.elements.wageValue.value));
  if (!wageAnswered) {
    form.elements.wageValue.reportValidity();
    return;
  }
  form.dataset.wageConfirmed = "true";
  updateCandidateProgression(form);
  form.elements.hireInterest[0]?.focus();
}

function confirmReasonsStep(form) {
  const hasRatedReason = [...form.querySelectorAll('input[type="range"][name^="score-"]')]
    .some((input) => Number(input.value) > 0);
  if (!hasRatedReason) {
    alert("Please give at least one reason an importance score above zero before continuing.");
    return;
  }
  const otherReasonInput = form.querySelector(".other-reason-input:not(:disabled)");
  if (otherReasonInput && !otherReasonInput.value.trim()) {
    alert("Please specify the other reason before continuing.");
    otherReasonInput.focus();
    return;
  }
  form.dataset.reasonsConfirmed = "true";
  form.dataset.offerConfirmed = "";
  updateCandidateProgression(form);
  form.elements.conditionalWageOffer.focus();
}

function confirmOfferStep(form) {
  const offerAnswered = Number.isSafeInteger(moneyToInteger(form.elements.conditionalWageOffer.value));
  if (!offerAnswered) {
    form.elements.conditionalWageOffer.reportValidity();
    return;
  }
  form.dataset.offerConfirmed = "true";
  updateCandidateProgression(form);
  form.querySelector(".save-candidate-response").focus();
}

function renderReasons(form, reasonOptions, rankedReasons, response, draft = null) {
  const hireInterest = form.elements.hireInterest.value;
  const reasonsLegend = form.querySelector(".reasons-legend");
  reasonOptions.innerHTML = "";
  rankedReasons.innerHTML = "";
  if (!hireInterest) {
    reasonsLegend.textContent = "Reason for hiring / not hiring";
    reasonOptions.innerHTML = "<p class=\"muted\">Choose hiring interest first.</p>";
    return;
  }

  reasonsLegend.textContent = hireInterest === "yes" ? "Reasons for hiring" : "Reasons for not hiring";

  const canUseCompletedReasons = response && response.hire_interest === hireInterest;
  const canUseDraftReasons = draft && draft.hireInterest === hireInterest;
  const ranked = canUseCompletedReasons ? JSON.parse(response.ranked_reasons_json) : [];
  const savedScores = canUseCompletedReasons && response.reason_scores_json
    ? JSON.parse(response.reason_scores_json)
    : (canUseDraftReasons ? draft.reasonScores || {} : {});
  const savedOtherReasonText = canUseCompletedReasons
    ? response.other_reason_text || ""
    : (canUseDraftReasons ? draft.otherReasonText || "" : "");
  const visibleConditionalLabels = new Set();
  if (form.dataset.showProductivity === "true") {
    visibleConditionalLabels.add(CONDITIONAL_REASON_LABELS.productivity[hireInterest]);
  }
  if (form.dataset.showAdditionalInformation === "true") {
    visibleConditionalLabels.add(CONDITIONAL_REASON_LABELS.placebo[hireInterest]);
  }
  const reasons = state.session.reasons.filter((reason) => {
    if (reason.applies_to !== hireInterest) {
      return false;
    }
    if (!CONDITIONAL_REASON_LABEL_SET.has(reason.label)) {
      return true;
    }
    return visibleConditionalLabels.has(reason.label);
  });

  reasons.forEach((reason) => {
    const line = document.createElement("label");
    line.className = "reason-line";
    const isOtherReason = reason.label === OTHER_REASON_LABEL;
    line.innerHTML = `
      <span>${renderReasonLabel(reason.label)}</span>
      <span class="reason-rating">
        <input type="range" name="score-${reason.id}" min="0" max="100" step="1" value="0">
        <output>0</output>
      </span>
      ${isOtherReason ? `<input class="other-reason-input hidden" name="otherReasonText" maxlength="300" disabled placeholder="Please specify">` : ""}
    `;
    const score = line.querySelector(`input[name="score-${reason.id}"]`);
    const output = line.querySelector("output");
    const savedScore = savedScores[String(reason.id)];
    const legacyRankIndex = ranked.indexOf(reason.id);
    if (savedScore !== undefined) {
      score.value = savedScore;
    } else if (legacyRankIndex >= 0) {
      score.value = Math.max(0, 100 - legacyRankIndex * 25);
    }
    output.textContent = score.value;
    const otherReasonInput = line.querySelector(".other-reason-input");
    if (otherReasonInput) {
      otherReasonInput.value = savedOtherReasonText;
      const updateOtherReasonInput = () => {
        const enabled = Number(score.value) > 0;
        otherReasonInput.disabled = !enabled;
        otherReasonInput.required = enabled;
        otherReasonInput.classList.toggle("hidden", !enabled);
      };
      updateOtherReasonInput();
      otherReasonInput.addEventListener("input", () => {
        form.dataset.reasonsConfirmed = "";
        form.dataset.offerConfirmed = "";
        updateCandidateProgression(form);
      });
      score.addEventListener("input", updateOtherReasonInput);
    }
    score.addEventListener("input", () => {
      output.textContent = score.value;
      form.dataset.reasonsConfirmed = "";
      form.dataset.offerConfirmed = "";
      updateCandidateProgression(form);
    });
    reasonOptions.append(line);
  });
}

function renderReasonLabel(label) {
  if (label.startsWith("Additional Information")) {
    const reference = "Additional Information";
    return `<strong class="reason-information-reference placebo-reference">${reference}</strong>${label.slice(reference.length)}`;
  }
  if (label.startsWith("Task performance")) {
    const reference = "Task performance";
    return `<strong class="reason-information-reference productivity-reference">${reference}</strong>${label.slice(reference.length)}`;
  }
  return label;
}

function collectReasonScores(form) {
  const reasonScores = {};
  form.querySelectorAll('input[type="range"][name^="score-"]').forEach((input) => {
    const reasonId = Number(input.name.replace("score-", ""));
    reasonScores[reasonId] = Number(input.value);
  });
  return reasonScores;
}

async function saveCandidateDraft(form, step, candidate) {
  const status = form.querySelector(".draft-status");
  const button = form.querySelector(".save-candidate-draft");
  button.disabled = true;
  status.textContent = "Saving...";
  try {
    await api(`/api/session/${state.session.session.id}/response/draft`, {
      method: "POST",
      body: JSON.stringify({
        candidateId: candidate.id,
        stage: step.stage,
        wageValue: moneyToInteger(form.elements.wageValue.value),
        hireInterest: form.elements.hireInterest.value || null,
        reasonScores: collectReasonScores(form),
        otherReasonText: form.elements.otherReasonText?.value || "",
        conditionalWageOffer: moneyToInteger(form.elements.conditionalWageOffer.value),
      }),
    });
    state.session = await api(`/api/session/${state.session.session.id}`);
    status.textContent = "Draft saved";
  } catch (error) {
    status.textContent = error.message || "Could not save draft";
  } finally {
    button.disabled = false;
  }
}

async function submitCandidateResponse(event, step, candidate) {
  event.preventDefault();
  const form = event.currentTarget;
  const wageValue = moneyToInteger(form.elements.wageValue.value);
  const conditionalWageOffer = moneyToInteger(form.elements.conditionalWageOffer.value);
  if (!Number.isSafeInteger(wageValue) || !Number.isSafeInteger(conditionalWageOffer)) {
    alert("Please enter both salary amounts as whole numbers only.");
    return;
  }
  const reasonScores = collectReasonScores(form);
  const selectedReasons = Object.keys(reasonScores).map(Number);
  const rankedReasons = selectedReasons
    .map((reasonId) => ({
      reasonId,
      score: reasonScores[reasonId],
    }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.reasonId);

  if (!selectedReasons.some((reasonId) => reasonScores[reasonId] > 0)) {
    alert("Please give at least one reason an importance score above zero.");
    return;
  }
  await api(`/api/session/${state.session.session.id}/response`, {
    method: "POST",
    body: JSON.stringify({
      candidateId: candidate.id,
      stage: step.stage,
      wageValue,
      hireInterest: form.elements.hireInterest.value,
      selectedReasons,
      rankedReasons,
      reasonScores,
      otherReasonText: form.elements.otherReasonText?.value || "",
      conditionalWageOffer,
      showProductivity: form.dataset.showProductivity === "true",
      showAdditionalInformation: form.dataset.showAdditionalInformation === "true",
      startedAt: new Date().toISOString(),
    }),
  });

  state.session = await api(`/api/session/${state.session.session.id}`);
  state.stepIndex += 1;
  renderStep();
}

function labelize(key) {
  if (key === "gpa") {
    return "GPA";
  }
  const labels = {
    education_level: "Education Level",
    education_major: "Education Major",
    relevant_skills: "Relevant Skills",
    reach_indicator: "Reach-type indicator",
    interaction_indicator: "Interaction-type indicator",
    benchmark: "Talent-pool benchmark",
  };
  if (labels[key]) {
    return labels[key];
  }
  return key.replaceAll("_", " ");
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US");
}

function parseMetricValue(text) {
  const match = String(text).match(/:\s*([\d,]+)/);
  return match ? Number(match[1].replaceAll(",", "")) : null;
}

function formatCandidateMetric(key, textValue, candidateName) {
  const value = parseMetricValue(textValue);
  const formattedValue = Number.isFinite(value) ? formatNumber(value) : textValue;
  if (key === "reach_indicator") {
    return `Average accounts reached per post by ${candidateName}: ${formattedValue}`;
  }
  if (key === "interaction_indicator") {
    return `Average interactions per post by ${candidateName}: ${formattedValue}`;
  }
  return textValue;
}

function benchmarkPosition(value, range) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= range.median) {
    const lowerSpan = Math.max(1, range.median - range.min);
    return Math.max(0, Math.min(50, ((value - range.min) / lowerSpan) * 50));
  }
  const upperSpan = Math.max(1, range.max - range.median);
  return Math.max(50, Math.min(100, 50 + ((value - range.median) / upperSpan) * 50));
}

function performanceMarkerClass(position) {
  if (position <= 0) return "marker-low";
  if (position < 50) return "marker-low-mid";
  if (position === 50) return "marker-median";
  if (position < 100) return "marker-high-mid";
  return "marker-high";
}

function renderBenchmarkScale(key, textValue, candidateName) {
  const range = BENCHMARK_RANGES[key];
  if (!range) {
    return "";
  }
  const candidateValue = parseMetricValue(textValue);
  const markerPosition = benchmarkPosition(candidateValue, range);
  const markerClass = performanceMarkerClass(markerPosition);
  const candidateLabel = Number.isFinite(candidateValue)
    ? `<p class="scale-caption">${candidateName} performance: ${formatNumber(candidateValue)} ${range.unit}</p>`
    : "";
  return `
    <div class="benchmark-scale" style="--candidate-position: ${markerPosition}%">
      <div class="scale-track" aria-hidden="true">
        <span class="scale-tick scale-min"></span>
        <span class="scale-tick scale-median"></span>
        <span class="scale-tick scale-max"></span>
        ${Number.isFinite(candidateValue) ? `<span class="candidate-marker ${markerClass}"></span>` : ""}
      </div>
      <div class="scale-labels">
        <span>Min ${formatNumber(range.min)}</span>
        <span>Median ${formatNumber(range.median)}</span>
        <span>Max ${formatNumber(range.max)}</span>
      </div>
      ${candidateLabel}
    </div>
  `;
}

async function createSessionFromForm(form, statusElement) {
  const submitButton = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form).entries());
  if (!data.randomizationSeed) {
    delete data.randomizationSeed;
  }
  submitButton.disabled = true;
  statusElement.textContent = "Creating session...";
  try {
    return await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify(data),
    });
  } catch (error) {
    statusElement.textContent = error.message || "Could not create the session.";
    return null;
  } finally {
    submitButton.disabled = false;
  }
}

sessionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const created = await createSessionFromForm(form, sessionCreateStatus);
  if (!created) {
    return;
  }
  form.reset();
  await loadBootstrap();
  await loadSessions();
  sessionCreateStatus.textContent = `Session ${created.sessionCode} created.`;
});

refreshButton.addEventListener("click", loadSessions);

respondentEntryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const sessionId = respondentEntryForm.elements.sessionId.value.trim();
  respondentEntryStatus.textContent = "";
  try {
    await openSession(sessionId);
  } catch (error) {
    respondentEntryStatus.textContent = error.message;
  }
});

enumeratorLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const passcode = enumeratorLoginForm.elements.passcode.value;
  if (passcode !== "501") {
    enumeratorLoginStatus.textContent = "Incorrect passcode.";
    enumeratorLoginForm.elements.passcode.value = "";
    enumeratorLoginForm.elements.passcode.focus();
    return;
  }
  enumeratorLoginStatus.textContent = "";
  enumeratorLoginForm.reset();
  await showDashboard();
});

importCandidatesButton.addEventListener("click", async () => {
  const file = candidateCsvInput.files[0];
  if (!file) {
    candidateImportStatus.textContent = "Choose a CSV file first.";
    return;
  }
  const csvText = await file.text();
  const response = await fetch("/api/candidates/import", {
    method: "POST",
    headers: { "Content-Type": "text/csv; charset=utf-8" },
    body: csvText,
  });
  const result = await response.json();
  if (!response.ok) {
    candidateImportStatus.textContent = result.error || "Import failed.";
    return;
  }
  candidateImportStatus.textContent = `Imported ${result.imported} candidate rows.`;
  candidateCsvInput.value = "";
  await loadBootstrap();
});

loadBootstrap()
  .then(async () => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session");
    if (sessionId) {
      await openSession(sessionId);
      return;
    }
    showLanding();
  })
  .catch((error) => {
    document.body.innerHTML = `<main><section class="panel"><h2>Startup error</h2><p>${error.message}</p></section></main>`;
  });
